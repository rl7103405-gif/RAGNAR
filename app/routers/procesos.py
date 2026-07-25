from datetime import datetime
import math

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, commit_seguro, flush_seguro, candado_escritura
from app.models import Bulto, AuditoriaRecaptura
from app.auth import requiere_estacion, requiere_estacion_vista
from app.services.calibracion import evaluar_peso_final
from app.validation import normalizar_folio, canonizar_folio, validar_peso

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/procesos", response_class=HTMLResponse)
def vista_procesos(request: Request, usuario: dict = Depends(requiere_estacion_vista("procesos"))):
    return templates.TemplateResponse("procesos.html", {"request": request, "usuario": usuario})


@router.get("/api/procesos/consultar/{folio}")
def consultar(folio: str, db: Session = Depends(get_db), usuario: dict = Depends(requiere_estacion("procesos"))):
    folio = canonizar_folio(normalizar_folio(folio))
    bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
    if bulto is None:
        raise HTTPException(status_code=404, detail=f"El folio {folio} no existe")
    if bulto.estatus == "retenido":
        raise HTTPException(
            status_code=409,
            detail=f"El folio {folio} está RETENIDO por diferencia de peso; un administrador debe liberarlo",
        )
    if bulto.estatus not in ("ruteado", "validado", "procesos_finales"):
        raise HTTPException(
            status_code=409,
            detail=f"El folio {folio} todavía no ha sido ruteado ni validado (estatus actual: {bulto.estatus})",
        )
    if bulto.peso_produccion is None or not math.isfinite(bulto.peso_produccion) or bulto.peso_produccion <= 0:
        raise HTTPException(status_code=409, detail="El folio no tiene un peso de producción válido")
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
    sobrescribir: bool = False
    marca_confirmada: str | None = None


@router.post("/api/procesos/guardar")
def guardar_peso_final(
    datos: GuardarPesoFinal,
    db: Session = Depends(get_db),
    usuario: dict = Depends(requiere_estacion("procesos")),
):
    folio = canonizar_folio(normalizar_folio(datos.folio))
    peso = validar_peso(datos.peso, settings.PESO_MAX_GRAMOS)

    with candado_escritura:
        bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
        if bulto is None:
            raise HTTPException(status_code=404, detail="Folio no encontrado")
        if bulto.estatus == "retenido":
            raise HTTPException(
                status_code=409,
                detail="El folio está RETENIDO por diferencia de peso; un administrador debe liberarlo",
            )
        if bulto.estatus not in ("ruteado", "validado", "procesos_finales"):
            raise HTTPException(status_code=409, detail="El folio todavía no ha sido ruteado ni validado")
        if (
            bulto.peso_produccion is None
            or not math.isfinite(bulto.peso_produccion)
            or bulto.peso_produccion <= 0
        ):
            raise HTTPException(status_code=409, detail="El folio no tiene un peso de producción válido")

        # Re-captura: el bulto ya tiene peso final. Se exige confirmación explícita
        # y se deja rastro en auditoría de quién sobrescribió qué.
        es_recaptura = bulto.estatus == "procesos_finales" and bulto.peso_procesos_finales is not None
        if es_recaptura:
            marca_actual = bulto.timestamp_procesos_finales.isoformat() if bulto.timestamp_procesos_finales else None
            if not datos.sobrescribir:
                return {
                    "ok": False,
                    "requiere_sobrescribir": True,
                    "marca": marca_actual,
                    "mensaje": (
                        f"El folio {bulto.folio} ya fue pesado en procesos finales: "
                        f"{bulto.peso_procesos_finales / 1000:.2f} kg por {bulto.operador_procesos_finales or 'desconocido'}. "
                        "¿Sobrescribir con la nueva captura?"
                    ),
                }
            if datos.marca_confirmada != marca_actual:
                # Entre el "requiere_sobrescribir" y este POST, otro operador
                # recapturo el mismo folio: no se pisa a ciegas, se vuelve a
                # pedir confirmacion con los datos mas recientes.
                return {
                    "ok": False,
                    "requiere_sobrescribir": True,
                    "marca": marca_actual,
                    "mensaje": (
                        f"El folio {bulto.folio} fue recapturado por alguien más mientras confirmabas "
                        f"(ahora: {bulto.peso_procesos_finales / 1000:.2f} kg por {bulto.operador_procesos_finales or 'desconocido'}). "
                        "Revisa y confirma de nuevo."
                    ),
                }
        if es_recaptura:
            db.add(AuditoriaRecaptura(
                folio=bulto.folio,
                estacion="procesos",
                descripcion=(
                    f"peso_procesos_finales: {bulto.peso_procesos_finales / 1000:.2f} kg -> {peso / 1000:.2f} kg "
                    f"(capturado antes por {bulto.operador_procesos_finales or 'desconocido'})"
                ),
                operador=usuario["nombre_completo"],
                timestamp=datetime.now(),
            ))

        bulto.peso_procesos_finales = peso
        flush_seguro(db)

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

        # En una re-captura dentro de rango debe limpiarse la confirmación que
        # pudo pertenecer al peso anterior.
        bulto.confirmacion_manual = bool(resultado.get("alerta"))

        bulto.timestamp_procesos_finales = datetime.now()
        bulto.operador_procesos_finales = usuario["nombre_completo"]
        bulto.estatus = "procesos_finales"
        commit_seguro(db)
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
        "rango_min": resultado.get("rango_min"),
        "rango_max": resultado.get("rango_max"),
    }
