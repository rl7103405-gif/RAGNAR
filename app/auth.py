"""Autenticacion simple por usuario, basada en sesion de cookie firmada."""
import logging
import hashlib
import secrets

from itsdangerous import URLSafeTimedSerializer, BadSignature
from fastapi import Request, HTTPException, status, Depends
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings
from app.database import SessionLocal
from app.models import Usuario

logger = logging.getLogger("auth")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
serializer = URLSafeTimedSerializer(settings.SECRET_KEY, salt="quini-sesion")

COOKIE_NAME = "quini_sesion"
SESION_MAX_AGE = 60 * 60 * 12


def _huella_credencial(password_hash: str) -> str:
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verificar_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def crear_cookie_sesion(usuario: Usuario) -> str:
    return serializer.dumps({
        "id": usuario.id,
        "nombre_usuario": usuario.nombre_usuario,
        "nombre_completo": usuario.nombre_completo,
        "estacion": usuario.estacion,
        "cred": _huella_credencial(usuario.password_hash),
    })


def leer_sesion(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        sesion = serializer.loads(token, max_age=SESION_MAX_AGE)
    except BadSignature:
        return None
    # Cookies de versiones anteriores no traen estación/huella: se invalidan
    # para que el acceso siempre refleje el usuario vigente en la base.
    if not isinstance(sesion, dict) or "estacion" not in sesion or "cred" not in sesion:
        return None
    db = SessionLocal()
    try:
        usuario = db.get(Usuario, sesion.get("id"))
        if (
            usuario is None
            or not usuario.activo
            or usuario.nombre_usuario != sesion.get("nombre_usuario")
            or usuario.nombre_completo != sesion.get("nombre_completo")
            or usuario.estacion != sesion.get("estacion")
            or not secrets.compare_digest(_huella_credencial(usuario.password_hash), sesion["cred"])
        ):
            return None
    except (SQLAlchemyError, TypeError, ValueError) as exc:
        logger.warning("No se pudo validar la sesión contra la base de datos: %s", exc)
        return None
    finally:
        db.close()
    return sesion


class NoAutenticado(Exception):
    """Se lanza cuando una vista requiere sesion y no hay ninguna activa."""


class AccesoDenegado(Exception):
    """Se lanza cuando el usuario tiene sesion pero no pertenece a la estacion."""

    def __init__(self, estacion_usuario: str | None):
        self.estacion_usuario = estacion_usuario


def usuario_actual(request: Request) -> dict:
    """Dependencia para vistas HTML: redirige a /login si no hay sesion."""
    sesion = leer_sesion(request)
    if not sesion:
        raise NoAutenticado()
    return sesion


def usuario_actual_api(request: Request) -> dict:
    """Dependencia para endpoints JSON: responde 401 si no hay sesion."""
    sesion = leer_sesion(request)
    if not sesion:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")
    return sesion


def requiere_estacion(*estaciones: str):
    """Dependencia para endpoints JSON: exige pertenecer a una de las estaciones.

    El usuario admin siempre tiene acceso a todas las estaciones.
    """
    def dependencia(usuario: dict = Depends(usuario_actual_api)) -> dict:
        estacion = usuario.get("estacion")
        if estacion != "admin" and estacion not in estaciones:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tu usuario no tiene acceso a esta estación",
            )
        return usuario
    return dependencia


def requiere_estacion_vista(*estaciones: str):
    """Dependencia para vistas HTML: redirige a la estacion propia si no corresponde."""
    def dependencia(usuario: dict = Depends(usuario_actual)) -> dict:
        estacion = usuario.get("estacion")
        if estacion != "admin" and estacion not in estaciones:
            raise AccesoDenegado(estacion)
        return usuario
    return dependencia


RUTA_POR_ESTACION = {
    "produccion": "/produccion",
    "ruteadores": "/ruteadores",
    "validacion": "/validacion",
    "procesos": "/procesos",
    "embarque": "/embarque",
    "admin": "/admin",
}


def _generar_password() -> str:
    """Contrasena aleatoria corta pero no adivinable, facil de dictar."""
    return secrets.token_urlsafe(9)


def crear_usuarios_default(db: Session):
    """Crea usuarios iniciales si la tabla esta vacia, con contrasenas aleatorias.

    Las contrasenas se imprimen UNA sola vez en la consola del servidor al
    primer arranque; el administrador debe anotarlas y repartirlas.
    """
    if db.query(Usuario).count() > 0:
        return
    usuarios_default = [
        ("produccion", "Operador Producción", "produccion"),
        ("ruteadores", "Personal Ruteadores", "ruteadores"),
        ("america", "América", "procesos"),
        ("embarque", "América Embarque", "embarque"),
        ("admin", "Administrador", "admin"),
    ]
    credenciales = []
    for nombre_usuario, nombre_completo, estacion in usuarios_default:
        password = _generar_password()
        credenciales.append((nombre_usuario, password))
        db.add(Usuario(
            nombre_usuario=nombre_usuario,
            nombre_completo=nombre_completo,
            password_hash=hash_password(password),
            estacion=estacion,
            activo=True,
        ))
    db.commit()
    # Las contraseñas NO se loggean en texto plano (pueden persistir en logs
    # del servidor/capturas de consola): solo se muestran en la salida directa
    # de la herramienta que las genera.
    logger.warning(
        "Usuarios iniciales creados (%s). Corre 'python generar_credenciales.py' para "
        "ver/regenerar sus contraseñas.",
        ", ".join(nombre_usuario for nombre_usuario, _ in credenciales),
    )


def ensure_usuario_validacion(db: Session):
    """Crea el usuario de la estación de Validación si no existe todavía.

    'crear_usuarios_default' no sirve para esto: sale en cuanto la tabla tiene
    cualquier usuario, y las bases existentes ya tienen los 5 originales.
    Idempotente: si el usuario ya existe no hace nada.
    """
    if db.query(Usuario).filter(Usuario.nombre_usuario == "validacion").first():
        return
    password = _generar_password()
    db.add(Usuario(
        nombre_usuario="validacion",
        nombre_completo="Estación de Validación",
        password_hash=hash_password(password),
        estacion="validacion",
        activo=True,
    ))
    db.commit()
    # La contraseña NO se loggea en texto plano; ver nota en crear_usuarios_default.
    logger.warning(
        "Usuario 'validacion' creado. Corre 'python generar_credenciales.py' para ver/regenerar su contraseña."
    )
