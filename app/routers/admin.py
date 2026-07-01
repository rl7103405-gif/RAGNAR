from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Bulto, ConfigRangoPeso, Embarque
from app.auth import usuario_actual, usuario_actual_api
from app.atalanta import atalanta_disponible
from app.zebra_print import zebra_configurada

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/admin", response_class=HTMLResponse)
def vista_admin(request: Request, usuario: dict = Depends(usuario_actual)):
    return templates.TemplateResponse("admin.html", {"request": request, "usuario": usuario})


@router.get("/api/admin/bultos")
def listar_bultos(db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    bultos = db.query(Bulto).order_by(Bulto.id.desc()).limit(500).all()
    return [
        {
            "folio": b.folio,
            "estatus": b.estatus,
            "pedido_id": b.pedido_id,
            "cliente": b.cliente,
            "codigo_producto": b.codigo_producto,
            "docenas": b.docenas,
            "peso_produccion": b.peso_produccion,
            "peso_procesos_finales": b.peso_procesos_finales,
            "diferencia_gramos": b.diferencia_gramos,
            "diferencia_porcentaje": b.diferencia_porcentaje,
            "diferencia_alerta": b.diferencia_alerta,
            "operador_produccion": b.operador_produccion,
            "operador_ruteo": b.operador_ruteo,
            "operador_procesos_finales": b.operador_procesos_finales,
            "operador_embarque": b.operador_embarque,
            "timestamp_produccion": b.timestamp_produccion.isoformat() if b.timestamp_produccion else None,
            "timestamp_procesos_finales": b.timestamp_procesos_finales.isoformat() if b.timestamp_procesos_finales else None,
        }
        for b in bultos
    ]


@router.get("/api/admin/estatus-sistema")
def estatus_sistema(db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    total_bultos = db.query(Bulto).count()
    por_estatus = {}
    for estatus in ("produccion", "ruteado", "procesos_finales", "embarcado"):
        por_estatus[estatus] = db.query(Bulto).filter(Bulto.estatus == estatus).count()

    return {
        "total_bultos": total_bultos,
        "por_estatus": por_estatus,
        "total_embarques": db.query(Embarque).count(),
        "atalanta_disponible": atalanta_disponible(),
        "zebra_configurada": zebra_configurada(),
    }


@router.get("/api/admin/rango-peso")
def config_rango_peso(db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
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


@router.get("/api/admin/reporte-diferencias")
def reporte_diferencias(db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
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
