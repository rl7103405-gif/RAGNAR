from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Bulto
from app.auth import usuario_actual, usuario_actual_api

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/produccion", response_class=HTMLResponse)
def vista_produccion(request: Request, usuario: dict = Depends(usuario_actual)):
    return templates.TemplateResponse("produccion.html", {"request": request, "usuario": usuario})


class GuardarPesoProduccion(BaseModel):
    folio: str
    peso: float


@router.post("/api/produccion/guardar")
def guardar_peso_produccion(
    datos: GuardarPesoProduccion,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    folio = datos.folio.strip()
    if not folio:
        raise HTTPException(status_code=400, detail="Folio vacio")
    if datos.peso <= 0:
        raise HTTPException(status_code=400, detail="Peso invalido")

    bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
    if bulto is None:
        bulto = Bulto(folio=folio, estatus="produccion")
        db.add(bulto)

    if bulto.estatus != "produccion" or bulto.peso_produccion is not None:
        raise HTTPException(
            status_code=409,
            detail=f"El folio {folio} ya fue pesado en produccion (estatus actual: {bulto.estatus})",
        )

    bulto.peso_produccion = datos.peso
    bulto.timestamp_produccion = datetime.now()
    bulto.operador_produccion = usuario["nombre_completo"]
    bulto.estatus = "produccion"
    db.commit()
    db.refresh(bulto)

    return {
        "ok": True,
        "folio": bulto.folio,
        "peso_produccion": bulto.peso_produccion,
        "timestamp": bulto.timestamp_produccion.isoformat(),
        "operador": bulto.operador_produccion,
    }
