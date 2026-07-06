from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Bulto
from app.auth import usuario_actual, usuario_actual_api
from app.services.calibracion import evaluar_peso_final

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/procesos", response_class=HTMLResponse)
def vista_procesos(request: Request, usuario: dict = Depends(usuario_actual)):
    return templates.TemplateResponse("procesos.html", {"request": request, "usuario": usuario})


@router.get("/api/procesos/consultar/{folio}")
def consultar(folio: str, db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    bulto = db.query(Bulto).filter(Bulto.folio == folio.strip()).first()
    if bulto is None:
        raise HTTPException(status_code=404, detail=f"El folio {folio} no existe")
    if bulto.estatus not in ("ruteado", "procesos_finales"):
        raise HTTPException(
            status_code=409,
            detail=f"El folio {folio} todavía no ha sido ruteado (estatus actual: {bulto.estatus})",
        )
    return {
        "folio": bulto.folio,
        "peso_produccion": bulto.peso_produccion,
        "codigo_producto": bulto.codigo_producto,
        "pedido_id": bulto.pedido_id,
        "cliente": bulto.cliente,
        "ya_procesado": bulto.estatus == "procesos_finales",
    }


class GuardarPesoFinal(BaseModel):
    folio: str
    peso: float
    confirmar_fuera_de_rango: bool = False


@router.post("/api/procesos/guardar")
def guardar_peso_final(
    datos: GuardarPesoFinal,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    bulto = db.query(Bulto).filter(Bulto.folio == datos.folio.strip()).first()
    if bulto is None:
        raise HTTPException(status_code=404, detail="Folio no encontrado")
    if bulto.estatus not in ("ruteado", "procesos_finales"):
        raise HTTPException(status_code=409, detail="El folio todavía no ha sido ruteado")
    if datos.peso <= 0:
        raise HTTPException(status_code=400, detail="Peso inválido")

    bulto.peso_procesos_finales = datos.peso
    db.flush()

    resultado = evaluar_peso_final(db, bulto)

    if resultado.get("alerta") and not datos.confirmar_fuera_de_rango:
        db.rollback()
        return {
            "ok": False,
            "requiere_confirmacion": True,
            "diferencia_gramos": resultado["diferencia_gramos"],
            "diferencia_porcentaje": resultado["diferencia_porcentaje"],
            "rango_min": resultado.get("rango_min"),
            "rango_max": resultado.get("rango_max"),
            "mensaje": "La diferencia de peso está fuera del rango esperado. Confirme para continuar.",
        }

    if resultado.get("alerta"):
        bulto.confirmacion_manual = True

    bulto.timestamp_procesos_finales = datetime.now()
    bulto.operador_procesos_finales = usuario["nombre_completo"]
    bulto.estatus = "procesos_finales"
    db.commit()
    db.refresh(bulto)

    return {
        "ok": True,
        "folio": bulto.folio,
        "peso_produccion": bulto.peso_produccion,
        "peso_procesos_finales": bulto.peso_procesos_finales,
        "diferencia_gramos": resultado["diferencia_gramos"],
        "diferencia_porcentaje": resultado["diferencia_porcentaje"],
        "fase": resultado["fase"],
        "alerta": resultado.get("alerta"),
    }
