from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, commit_seguro, candado_escritura
from app.models import Bulto
from app.auth import requiere_estacion, requiere_estacion_vista
from app.validation import normalizar_folio, canonizar_folio, validar_peso

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/produccion", response_class=HTMLResponse)
def vista_produccion(request: Request, usuario: dict = Depends(requiere_estacion_vista("produccion"))):
    return templates.TemplateResponse("produccion.html", {"request": request, "usuario": usuario})


class GuardarPesoProduccion(BaseModel):
    folio: str
    peso: float


@router.post("/api/produccion/guardar")
def guardar_peso_produccion(
    datos: GuardarPesoProduccion,
    db: Session = Depends(get_db),
    usuario: dict = Depends(requiere_estacion("produccion")),
):
    if settings.VALIDACION_ACTIVA:
        # Mientras la estación de Validación está activa, Producción queda
        # bloqueada para que ningún bulto se salte la validación contra el
        # Excel de ruteo. Se desactiva con VALIDACION_ACTIVA=false en .env.
        raise HTTPException(
            status_code=409,
            detail="Producción está deshabilitada: usa la estación de Validación",
        )
    folio = canonizar_folio(normalizar_folio(datos.folio))
    peso = validar_peso(datos.peso, settings.PESO_MAX_GRAMOS)

    with candado_escritura:
        bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
        if bulto is None:
            bulto = Bulto(folio=folio, estatus="produccion")
            db.add(bulto)

        if bulto.estatus != "produccion" or bulto.peso_produccion is not None:
            raise HTTPException(
                status_code=409,
                detail=f"El folio {folio} ya fue pesado en producción (estatus actual: {bulto.estatus})",
            )

        bulto.peso_produccion = peso
        bulto.timestamp_produccion = datetime.now()
        bulto.operador_produccion = usuario["nombre_completo"]
        bulto.estatus = "produccion"
        commit_seguro(db)
        db.refresh(bulto)

    return {
        "ok": True,
        "folio": bulto.folio,
        "peso_produccion": bulto.peso_produccion,
        "timestamp": bulto.timestamp_produccion.isoformat(),
        "operador": bulto.operador_produccion,
    }
