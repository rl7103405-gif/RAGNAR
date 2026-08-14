import statistics
from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException, UploadFile, File, Form
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, commit_seguro, candado_escritura
from app.models import Bulto, CatalogoPeso, ConfigRangoPeso, Embarque, FolioRuteo, AuditoriaRecaptura
from app.auth import requiere_estacion, requiere_estacion_vista
from app.atalanta import atalanta_disponible
from app.zebra_print import zebra_configurada
from app.validation import normalizar_folio, canonizar_folio, normalizar_texto
from app.services.busquedas import buscar_bultos, buscar_embarques
from app.services.importar_excel import (
    ErrorImportacion,
    parsear_folios_ruteo,
    escribir_folios_ruteo,
    parsear_catalogo_pesos,
    escribir_catalogo_pesos,
)
from app.routers.auth_router import desbloquear_ip

# Tope del upload de Excel (el catálogo diario real pesa ~16 MB).
MAX_TAMANO_EXCEL = 60 * 1024 * 1024

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

# Sin estaciones adicionales: solo el usuario admin entra aqui.
solo_admin = requiere_estacion()


@router.get("/admin", response_class=HTMLResponse)
def vista_admin(request: Request, usuario: dict = Depends(requiere_estacion_vista())):
    return templates.TemplateResponse("admin.html", {"request": request, "usuario": usuario})


@router.get("/api/admin/bultos")
def listar_bultos(
    folio: str | None = None,
    codigo: str | None = None,
    operador: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_admin),
):
    """Historial de capturas con búsqueda (lógica compartida en services/busquedas.py)."""
    return buscar_bultos(db, folio=folio, codigo=codigo, operador=operador, desde=desde, hasta=hasta)


@router.get("/api/admin/embarques")
def listar_embarques(
    pedido: str | None = None,
    maquila: str | None = None,
    operador: str | None = None,
    folio: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_admin),
):
    """Documentos de salida (PDF) con búsqueda (lógica compartida en services/busquedas.py)."""
    return buscar_embarques(
        db, pedido=pedido, maquila=maquila, operador=operador,
        folio=folio, desde=desde, hasta=hasta,
    )


@router.get("/api/admin/estatus-sistema")
def estatus_sistema(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    total_bultos = db.query(Bulto).count()
    por_estatus = {}
    for estatus in ("produccion", "ruteado", "validado", "retenido", "procesos_finales", "embarcado"):
        por_estatus[estatus] = db.query(Bulto).filter(Bulto.estatus == estatus).count()

    ultima_importacion_folios = (
        db.query(FolioRuteo.fecha_importacion).order_by(FolioRuteo.fecha_importacion.desc()).first()
    )
    ultima_importacion_catalogo = (
        db.query(CatalogoPeso.fecha_importacion).order_by(CatalogoPeso.fecha_importacion.desc()).first()
    )
    return {
        "total_bultos": total_bultos,
        "por_estatus": por_estatus,
        "total_embarques": db.query(Embarque).count(),
        "atalanta_disponible": atalanta_disponible(),
        "zebra_configurada": zebra_configurada(),
        "validacion_activa": settings.VALIDACION_ACTIVA,
        "validacion_modo": settings.VALIDACION_MODO,
        "folios_ruteo_importados": db.query(FolioRuteo).count(),
        "codigos_catalogo": db.query(CatalogoPeso).count(),
        "ultima_importacion_folios": ultima_importacion_folios[0].isoformat() if ultima_importacion_folios and ultima_importacion_folios[0] else None,
        "ultima_importacion_catalogo": ultima_importacion_catalogo[0].isoformat() if ultima_importacion_catalogo and ultima_importacion_catalogo[0] else None,
    }


@router.get("/api/admin/rango-peso")
def config_rango_peso(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    config = db.query(ConfigRangoPeso).filter(ConfigRangoPeso.activo == True).first()  # noqa: E712
    bultos_en_calibracion = db.query(Bulto).filter(Bulto.diferencia_porcentaje.isnot(None)).count()

    return {
        "calibrado": config is not None,
        "bultos_muestra_actuales": bultos_en_calibracion,
        "config": None if config is None else {
            "bultos_muestra": config.bultos_muestra,
            "promedio_diferencia": config.promedio_diferencia,
            "max_diferencia": config.max_diferencia,
            "tolerancia_porcentaje": config.tolerancia_porcentaje,
            "fecha_calculo": config.fecha_calculo.isoformat() if config.fecha_calculo else None,
        },
    }


@router.get("/api/admin/recapturas")
def listar_recapturas(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    """Auditoría: sobrescrituras confirmadas de pesos y re-ruteos."""
    filas = db.query(AuditoriaRecaptura).order_by(AuditoriaRecaptura.id.desc()).limit(200).all()
    return [
        {
            "folio": r.folio,
            "estacion": r.estacion,
            "descripcion": r.descripcion,
            "operador": r.operador,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        }
        for r in filas
    ]


# ---------- Estacion de Validacion: importaciones, retenidos y calibracion ----------

TAMANO_BLOQUE_LECTURA = 1024 * 1024  # 1 MB


def _leer_upload_excel(archivo: UploadFile) -> bytes:
    """Lee el upload por bloques y aborta en cuanto se excede el tamaño máximo,
    en vez de leerlo completo a RAM antes de comprobar el límite."""
    nombre = archivo.filename or ""
    if not nombre.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="El archivo debe ser un Excel .xlsx")
    partes = []
    total = 0
    while True:
        bloque = archivo.file.read(TAMANO_BLOQUE_LECTURA)
        if not bloque:
            break
        total += len(bloque)
        if total > MAX_TAMANO_EXCEL:
            raise HTTPException(status_code=400, detail="El archivo excede el tamaño máximo permitido (60 MB)")
        partes.append(bloque)
    contenido = b"".join(partes)
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    return contenido


def _respuesta_error_importacion(exc: ErrorImportacion) -> HTTPException:
    detalle = exc.mensaje
    if exc.errores:
        detalle += ". Primeros errores: " + " | ".join(exc.errores[:10])
    return HTTPException(status_code=400, detail=detalle)


@router.post("/api/admin/importar-folios")
def importar_folios(
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_admin),
):
    # Endpoint sincrono: FastAPI lo corre en threadpool, asi que el parseo con
    # openpyxl (sincrono y pesado) no bloquea el event loop del resto de la app.
    contenido = _leer_upload_excel(archivo)
    try:
        # El parseo/validación es lo pesado y no toca la BD; solo la escritura
        # final requiere el candado.
        datos = parsear_folios_ruteo(contenido, archivo.filename)
        with candado_escritura:
            resumen = escribir_folios_ruteo(datos, db)
            commit_seguro(db)
    except ErrorImportacion as exc:
        db.rollback()
        raise _respuesta_error_importacion(exc)
    return {"ok": True, **resumen}


@router.post("/api/admin/importar-catalogo")
def importar_catalogo(
    archivo: UploadFile = File(...),
    sobrescribir: bool = Form(False),
    marca_confirmada: str | None = Form(None),
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_admin),
):
    contenido = _leer_upload_excel(archivo)
    try:
        datos = parsear_catalogo_pesos(contenido, archivo.filename)
        with candado_escritura:
            resumen = escribir_catalogo_pesos(datos, db, sobrescribir=sobrescribir, marca_confirmada=marca_confirmada)
            if resumen.get("ok") is False:
                db.rollback()
                return resumen
            commit_seguro(db)
    except ErrorImportacion as exc:
        db.rollback()
        raise _respuesta_error_importacion(exc)
    return {"ok": True, **resumen}


@router.get("/api/admin/retenidos")
def listar_retenidos(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    bultos = db.query(Bulto).filter(Bulto.estatus == "retenido").order_by(Bulto.timestamp_validacion.desc()).all()
    return [
        {
            "folio": b.folio,
            "codigo_producto": b.codigo_producto,
            "docenas": b.docenas,
            "pedido_id": b.pedido_id,
            "peso_validacion": b.peso_validacion,
            "peso_teorico": b.peso_teorico,
            "diferencia_porcentaje": b.diferencia_validacion_porcentaje,
            "tolerancia_aplicada": b.tolerancia_aplicada,
            "operador": b.operador_validacion,
            "timestamp": b.timestamp_validacion.isoformat() if b.timestamp_validacion else None,
        }
        for b in bultos
    ]


class LiberarRetenido(BaseModel):
    folio: str
    motivo: str


@router.post("/api/admin/liberar-retenido")
def liberar_retenido(
    datos: LiberarRetenido,
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_admin),
):
    motivo = normalizar_texto(datos.motivo, "Motivo", maximo=300, requerido=True)
    folio = canonizar_folio(normalizar_folio(datos.folio))
    with candado_escritura:
        bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
        if bulto is None or bulto.estatus != "retenido":
            raise HTTPException(status_code=404, detail="El folio no está retenido")
        bulto.estatus = "validado"
        db.add(AuditoriaRecaptura(
            folio=bulto.folio,
            estacion="validacion",
            descripcion=(
                f"LIBERADO por administración: peso {(bulto.peso_validacion or 0) / 1000:.2f} kg vs "
                f"teórico {(bulto.peso_teorico or 0) / 1000:.2f} kg "
                f"({bulto.diferencia_validacion_porcentaje or 0:+.1f}%). Motivo: {motivo}"
            ),
            operador=usuario["nombre_completo"],
            timestamp=datetime.now(),
        ))
        commit_seguro(db)
    return {"ok": True, "folio": bulto.folio}


@router.get("/api/admin/sugerencia-multiplicador")
def sugerencia_multiplicador(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    """Deduce el multiplicador real a partir de los bultos ya pesados en Validación.

    Por cada bulto: multiplicador_observado = peso_real / (peso_unitario x docenas).
    Se sugiere la MEDIANA (robusta ante bultos atípicos). No se aplica solo:
    el administrador decide y lo cambia en .env (MULTIPLICADOR_VALIDACION).
    """
    bultos = (
        db.query(Bulto)
        .filter(Bulto.peso_validacion.isnot(None), Bulto.peso_teorico.isnot(None))
        .order_by(Bulto.timestamp_validacion.desc())
        .limit(200)
        .all()
    )
    observaciones = []
    for b in bultos:
        if not b.peso_teorico or not b.multiplicador_aplicado or not b.docenas:
            continue
        peso_unitario_por_docenas = b.peso_teorico / b.multiplicador_aplicado
        if peso_unitario_por_docenas <= 0:
            continue
        observaciones.append({
            "folio": b.folio,
            "codigo": b.codigo_producto,
            "multiplicador_observado": round(b.peso_validacion / peso_unitario_por_docenas, 3),
        })
    valores = [o["multiplicador_observado"] for o in observaciones]
    return {
        "muestras": len(valores),
        "multiplicador_configurado": settings.MULTIPLICADOR_VALIDACION,
        "sugerencia_mediana": round(statistics.median(valores), 2) if valores else None,
        "minimo": round(min(valores), 2) if valores else None,
        "maximo": round(max(valores), 2) if valores else None,
        "observaciones": observaciones[:50],
    }


class DesbloquearLogin(BaseModel):
    ip: str = "todas"


@router.post("/api/admin/desbloquear-login")
def desbloquear_login(
    datos: DesbloquearLogin,
    usuario: dict = Depends(solo_admin),
):
    """Limpia el rate-limit de /login (ver app/routers/auth_router.py) para
    una IP especifica o para todas. Util cuando una estacion compartida
    queda bloqueada por errores de tecleo de varios operadores, sin tener
    que reiniciar el servidor completo.

    Ejemplo de uso con curl (requiere cookie de sesion de un usuario admin):
      curl -X POST http://localhost:8000/api/admin/desbloquear-login \
           -H "Content-Type: application/json" \
           -d "{\"ip\": \"192.168.1.50\"}" \
           -b "quini_sesion=<cookie_de_sesion_admin>"
    Con {"ip": "todas"} (o sin body, el default ya es "todas") limpia el
    rate-limit de todas las IPs.
    """
    eliminadas = desbloquear_ip(datos.ip)
    return {"ok": True, "entradas_eliminadas": eliminadas}


@router.get("/api/admin/reporte-diferencias")
def reporte_diferencias(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    bultos = (
        db.query(Bulto)
        .filter(Bulto.diferencia_porcentaje.isnot(None))
        .order_by(Bulto.timestamp_procesos_finales.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "folio": b.folio,
            "peso_produccion": b.peso_produccion,
            "peso_procesos_finales": b.peso_procesos_finales,
            "diferencia_gramos": b.diferencia_gramos,
            "diferencia_porcentaje": b.diferencia_porcentaje,
            "alerta": b.diferencia_alerta,
            "confirmacion_manual": b.confirmacion_manual,
            "timestamp": b.timestamp_procesos_finales.isoformat() if b.timestamp_procesos_finales else None,
        }
        for b in bultos
    ]
