"""
Historial compartido: cualquier usuario con sesión (todas las estaciones)
puede buscar capturas por folio/código/operador/fechas y documentos de
embarque (PDF) por maquila/folio/pedido/operador/fechas, y descargar los PDF.

La lógica de búsqueda vive en services/busquedas.py (compartida con la
pantalla de Administración).
"""
import os

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Embarque
from app.auth import usuario_actual, usuario_actual_api
from app.services.busquedas import buscar_bultos, buscar_embarques
from app.services.pdf_embarque import CARPETA_PDF

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/historial", response_class=HTMLResponse)
def vista_historial(request: Request, usuario: dict = Depends(usuario_actual)):
    return templates.TemplateResponse("historial.html", {"request": request, "usuario": usuario})


@router.get("/api/historial/bultos")
def historial_bultos(
    folio: str | None = None,
    codigo: str | None = None,
    operador: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    return buscar_bultos(db, folio=folio, codigo=codigo, operador=operador, desde=desde, hasta=hasta)


@router.get("/api/historial/embarques")
def historial_embarques(
    pedido: str | None = None,
    maquila: str | None = None,
    operador: str | None = None,
    folio: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    return buscar_embarques(
        db, pedido=pedido, maquila=maquila, operador=operador,
        folio=folio, desde=desde, hasta=hasta,
        ruta_documento_base="/api/historial/documento",
    )


@router.get("/api/historial/documento/{embarque_id}")
def descargar_documento_historial(
    embarque_id: int,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    """Descarga del PDF para cualquier usuario con sesión (misma verificación
    de ruta segura que el endpoint de la estación de embarque)."""
    embarque = db.query(Embarque).filter(Embarque.id == embarque_id).first()
    if embarque is None or not embarque.ruta_documento:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    carpeta = os.path.realpath(CARPETA_PDF)
    ruta = os.path.realpath(embarque.ruta_documento)
    try:
        ruta_permitida = os.path.commonpath([carpeta, ruta]) == carpeta
    except ValueError:
        ruta_permitida = False
    if not ruta_permitida or not os.path.isfile(ruta):
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    nombre_descarga = "".join(c if c.isalnum() or c in "._-" else "_" for c in embarque.pedido_id)[:80]
    return FileResponse(
        ruta,
        media_type="application/pdf",
        filename=f"embarque_{nombre_descarga or 'pedido'}.pdf",
    )
