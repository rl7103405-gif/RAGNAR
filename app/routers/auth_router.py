import secrets
import threading
import time

from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Usuario
from app.auth import (
    hash_password, verificar_password, crear_cookie_sesion, leer_sesion, COOKIE_NAME,
    RUTA_POR_ESTACION, SESION_MAX_AGE,
)

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

# ── Rate limiting de /login (en memoria) ──────────────────────────────────
# Protege contra fuerza bruta / credential stuffing. Dos contadores porque
# uno solo es evadible: (usuario, IP) frena a alguien insistiendo con una
# cuenta fija; IP-solo frena a alguien rotando de usuario desde la misma
# maquina. El umbral de IP es mas alto para no castigar de mas una NAT
# compartida (varias PCs de la LAN salen con la misma IP).
# Se pierde al reiniciar el servidor o con --workers > 1: aceptable porque
# arrancar_servidor.bat corre uvicorn con un solo proceso (ver ese archivo).
_lock_intentos = threading.Lock()
_intentos_usuario_ip: dict[tuple[str, str], dict] = {}
_intentos_ip: dict[str, dict] = {}

UMBRAL_USUARIO_IP = 5
BLOQUEO_USUARIO_IP_SEG = 5 * 60
UMBRAL_IP = 30
BLOQUEO_IP_SEG = 15 * 60
VENTANA_OLVIDO_SEG = 15 * 60  # sin fallos nuevos en este lapso, se olvida el contador
MAX_ENTRADAS = 10_000  # tope para que claves arbitrarias no inflen los dicts sin limite

# Hash dummy fijo (calculado una sola vez al importar el modulo) para que el
# login siempre corra una verificacion bcrypt, exista o no el usuario. Sin
# esto, el cortocircuito de "usuario no existe" evita el costo de bcrypt
# (~100ms) y la diferencia de tiempo permite enumerar usuarios validos.
_HASH_DUMMY = hash_password(secrets.token_hex(16))


def _purgar(contadores: dict, ahora: float) -> None:
    vencidos = [
        clave for clave, dato in contadores.items()
        if dato["bloqueado_hasta"] <= ahora and ahora - dato["ultimo"] > VENTANA_OLVIDO_SEG
    ]
    for clave in vencidos:
        del contadores[clave]
    if len(contadores) > MAX_ENTRADAS:
        # Solo se purgan por tamaño las entradas NO bloqueadas actualmente:
        # una entrada bloqueada deja de recibir fallos nuevos (el handler
        # corta en _tiempo_bloqueado antes de llamar a _registrar_fallo), asi
        # que su "ultimo" queda congelado y seria la primera candidata a
        # eviction por antigueedad. Sin esta exclusion, un atacante podria
        # inflar el diccionario con miles de entradas falsas para forzar que
        # su propio bloqueo se purgue antes de tiempo.
        candidatas = [(k, v) for k, v in contadores.items() if v["bloqueado_hasta"] <= ahora]
        candidatas.sort(key=lambda kv: kv[1]["ultimo"])
        for clave, _ in candidatas[: max(0, len(contadores) - MAX_ENTRADAS)]:
            contadores.pop(clave, None)


def _tiempo_bloqueado(request: Request, nombre_usuario: str) -> tuple[str, float]:
    """Devuelve (ip, segundos restantes de bloqueo; 0 si no está bloqueado)."""
    ip = request.client.host if request.client else "desconocida"
    ahora = time.monotonic()
    with _lock_intentos:
        dato_usuario = _intentos_usuario_ip.get((nombre_usuario, ip))
        dato_ip = _intentos_ip.get(ip)
        restante_usuario = dato_usuario["bloqueado_hasta"] - ahora if dato_usuario else 0
        restante_ip = dato_ip["bloqueado_hasta"] - ahora if dato_ip else 0
    return ip, max(restante_usuario, restante_ip, 0)


def _registrar_fallo(ip: str, nombre_usuario: str) -> None:
    ahora = time.monotonic()
    with _lock_intentos:
        du = _intentos_usuario_ip.setdefault((nombre_usuario, ip), {"fallos": 0, "bloqueado_hasta": 0.0, "ultimo": ahora})
        du["fallos"] += 1
        du["ultimo"] = ahora
        if du["fallos"] >= UMBRAL_USUARIO_IP:
            du["bloqueado_hasta"] = ahora + BLOQUEO_USUARIO_IP_SEG
            du["fallos"] = 0

        di = _intentos_ip.setdefault(ip, {"fallos": 0, "bloqueado_hasta": 0.0, "ultimo": ahora})
        di["fallos"] += 1
        di["ultimo"] = ahora
        if di["fallos"] >= UMBRAL_IP:
            di["bloqueado_hasta"] = ahora + BLOQUEO_IP_SEG
            di["fallos"] = 0

        _purgar(_intentos_usuario_ip, ahora)
        _purgar(_intentos_ip, ahora)


def desbloquear_ip(ip: str | None) -> int:
    """Limpia el rate-limit de /login de una IP especifica, o de todas si
    'ip' es None o "todas". Pensado para que un admin libere una estacion
    compartida bloqueada por acumulacion de errores de tecleo entre varios
    operadores, sin tener que reiniciar el servidor completo (lo que
    resetearia el rate-limit de TODAS las estaciones, no solo la afectada).
    Se expone via POST /api/admin/desbloquear-login en app/routers/admin.py.

    Devuelve el numero de entradas eliminadas.
    """
    eliminadas = 0
    with _lock_intentos:
        if ip is None or ip == "todas":
            eliminadas = len(_intentos_ip) + len(_intentos_usuario_ip)
            _intentos_ip.clear()
            _intentos_usuario_ip.clear()
        else:
            if _intentos_ip.pop(ip, None) is not None:
                eliminadas += 1
            claves_usuario = [clave for clave in _intentos_usuario_ip if clave[1] == ip]
            for clave in claves_usuario:
                del _intentos_usuario_ip[clave]
                eliminadas += 1
    return eliminadas


def _limpiar_en_exito(ip: str, nombre_usuario: str) -> None:
    # Solo se limpia el contador especifico de (usuario, ip): un login exitoso
    # no debe borrar el historial de fallos de otros usuarios probados desde
    # la misma IP (evitaria el freno contra alguien rotando de usuario).
    with _lock_intentos:
        _intentos_usuario_ip.pop((nombre_usuario, ip), None)


@router.get("/login", response_class=HTMLResponse)
def login_form(request: Request, error: str | None = None):
    if leer_sesion(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request, "error": error})


@router.post("/login")
def login_submit(
    request: Request,
    nombre_usuario: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    nombre_usuario = nombre_usuario.strip()
    if not nombre_usuario or len(nombre_usuario) > 100 or len(password) > 200:
        return RedirectResponse("/login?error=Usuario+o+contrase%C3%B1a+incorrectos", status_code=303)

    ip, espera = _tiempo_bloqueado(request, nombre_usuario)
    if espera > 0:
        espera_seg = int(espera) + 1
        respuesta = templates.TemplateResponse(
            "login.html",
            {"request": request, "error": f"Demasiados intentos. Espera {espera_seg} segundos e intenta de nuevo."},
            status_code=429,
        )
        respuesta.headers["Retry-After"] = str(espera_seg)
        return respuesta

    usuario = db.query(Usuario).filter(
        Usuario.nombre_usuario == nombre_usuario, Usuario.activo == True  # noqa: E712
    ).first()
    # Siempre se ejecuta la verificacion bcrypt (contra el hash real o, si el
    # usuario no existe, contra el dummy) para que el tiempo de respuesta no
    # delate si el nombre de usuario es valido.
    hash_a_verificar = usuario.password_hash if usuario else _HASH_DUMMY
    credenciales_ok = verificar_password(password, hash_a_verificar) and usuario is not None
    if not credenciales_ok:
        _registrar_fallo(ip, nombre_usuario)
        return RedirectResponse("/login?error=Usuario+o+contrase%C3%B1a+incorrectos", status_code=303)

    _limpiar_en_exito(ip, nombre_usuario)
    destino = RUTA_POR_ESTACION.get(usuario.estacion, "/")

    response = RedirectResponse(destino, status_code=303)
    response.set_cookie(
        COOKIE_NAME,
        crear_cookie_sesion(usuario),
        httponly=True,
        max_age=SESION_MAX_AGE,
        samesite="strict",
        path="/",
        secure=(request.url.scheme == "https"),
    )
    return response


@router.get("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE_NAME, path="/", samesite="strict")
    return response


@router.get("/", response_class=HTMLResponse)
def raiz(request: Request):
    sesion = leer_sesion(request)
    if not sesion:
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse("inicio.html", {
        "request": request,
        "usuario": sesion,
        "validacion_activa": settings.VALIDACION_ACTIVA,
    })
