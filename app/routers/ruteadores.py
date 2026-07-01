from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Bulto
from app.auth import usuario_actual, usuario_actual_api
from app.atalanta import consultar_folio, atalanta_disponible
from app.zebra_print import generar_zpl_etiqueta, imprimir_etiqueta

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/ruteadores", response_class=HTMLResponse)
def vista_ruteadores(request: Request, usuario: dict = Depends(usuario_actual)):
    return templates.TemplateResponse("ruteadores.html", {"request": request, "usuario": usuario})


@router.get("/api/ruteadores/consultar/{folio}")
def consultar(folio: str, db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    folio = folio.strip()
    bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
    if bulto is None:
        raise HTTPException(status_code=404, detail=f"El folio {folio} no ha sido pesado en produccion")
    if bulto.peso_produccion is None:
        raise HTTPException(status_code=409, detail=f"El folio {folio} no tiene peso de produccion registrado")

    datos_atalanta = consultar_folio(folio)
    if datos_atalanta:
        bulto.codigo_producto = datos_atalanta.get("codigo_producto") or bulto.codigo_producto
        bulto.docenas = datos_atalanta.get("docenas") or bulto.docenas
        bulto.pedido_id = datos_atalanta.get("pedido_id") or bulto.pedido_id
        bulto.cliente = datos_atalanta.get("cliente") or bulto.cliente
        bulto.fecha_entrega = datos_atalanta.get("fecha_entrega") or bulto.fecha_entrega
        db.commit()
        db.refresh(bulto)

    return {
        "folio": bulto.folio,
        "peso_produccion": bulto.peso_produccion,
        "codigo_producto": bulto.codigo_producto,
        "docenas": bulto.docenas,
        "pedido_id": bulto.pedido_id,
        "cliente": bulto.cliente,
        "fecha_entrega": bulto.fecha_entrega,
        "estatus": bulto.estatus,
        "ya_ruteado": bulto.estatus not in ("produccion",),
        "atalanta_disponible": atalanta_disponible(),
    }


class ConfirmarRuteo(BaseModel):
    folio: str
    codigo_producto: str | None = None
    docenas: float | None = None
    pedido_id: str | None = None
    cliente: str | None = None


@router.post("/api/ruteadores/confirmar")
def confirmar_ruteo(
    datos: ConfirmarRuteo,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    bulto = db.query(Bulto).filter(Bulto.folio == datos.folio.strip()).first()
    if bulto is None:
        raise HTTPException(status_code=404, detail="Folio no encontrado")
    if bulto.peso_produccion is None:
        raise HTTPException(status_code=409, detail="El folio no tiene peso de produccion")

    # Permite capturar manualmente los datos si Atalanta no esta disponible.
    bulto.codigo_producto = datos.codigo_producto or bulto.codigo_producto
    bulto.docenas = datos.docenas if datos.docenas is not None else bulto.docenas
    bulto.pedido_id = datos.pedido_id or bulto.pedido_id
    bulto.cliente = datos.cliente or bulto.cliente

    bulto.estatus = "ruteado"
    bulto.timestamp_ruteo = datetime.now()
    bulto.operador_ruteo = usuario["nombre_completo"]

    zpl = generar_zpl_etiqueta(
        folio=bulto.folio,
        codigo_producto=bulto.codigo_producto or "",
        docenas=str(bulto.docenas) if bulto.docenas else "",
        pedido_id=bulto.pedido_id or "",
        cliente=bulto.cliente or "",
        peso_produccion=str(bulto.peso_produccion),
        fecha=datetime.now().strftime("%d/%m/%Y"),
    )
    resultado_impresion = imprimir_etiqueta(zpl)
    bulto.etiqueta_impresa = resultado_impresion["enviado"]

    db.commit()

    return {
        "ok": True,
        "folio": bulto.folio,
        "estatus": bulto.estatus,
        "impresion": resultado_impresion,
        "zpl": zpl,
    }
