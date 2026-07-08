from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Bulto, Embarque, Maquila
from app.auth import usuario_actual, usuario_actual_api
from app.services.pdf_embarque import generar_pdf_embarque

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/embarque", response_class=HTMLResponse)
def vista_embarque(request: Request, usuario: dict = Depends(usuario_actual)):
    return templates.TemplateResponse("embarque.html", {"request": request, "usuario": usuario})


@router.get("/api/embarque/pedidos")
def listar_pedidos_activos(db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    """Pedidos con al menos un folio listo para embarcar (o ya en proceso de embarque)."""
    filas = (
        db.query(Bulto.pedido_id)
        .filter(Bulto.pedido_id.isnot(None))
        .filter(Bulto.estatus.in_(["procesos_finales", "embarcado"]))
        .distinct()
        .all()
    )
    pedidos = []
    for (pedido_id,) in filas:
        bultos_pedido = db.query(Bulto).filter(Bulto.pedido_id == pedido_id).all()
        total = len(bultos_pedido)
        embarcados = len([b for b in bultos_pedido if b.estatus == "embarcado"])
        pedidos.append({
            "pedido_id": pedido_id,
            "total_bultos": total,
            "bultos_embarcados": embarcados,
            "completo": embarcados == total and total > 0,
        })
    return pedidos


@router.get("/api/embarque/pedido/{pedido_id}")
def detalle_pedido(pedido_id: str, db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    bultos = db.query(Bulto).filter(Bulto.pedido_id == pedido_id).order_by(Bulto.folio).all()
    if not bultos:
        raise HTTPException(status_code=404, detail="Pedido sin folios registrados")
    return {
        "pedido_id": pedido_id,
        "folios": [
            {
                "folio": b.folio,
                "estatus": b.estatus,
                "codigo_producto": b.codigo_producto,
                "docenas": b.docenas,
                "peso": b.peso_procesos_finales or b.peso_produccion,
                "listo_para_embarcar": b.estatus == "procesos_finales",
                "embarcado": b.estatus == "embarcado",
            }
            for b in bultos
        ],
    }


class EscanearFolio(BaseModel):
    folio: str
    pedido_id: str


@router.post("/api/embarque/escanear")
def escanear_folio_embarque(
    datos: EscanearFolio,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    bulto = db.query(Bulto).filter(Bulto.folio == datos.folio.strip()).first()
    if bulto is None:
        raise HTTPException(status_code=404, detail=f"El folio {datos.folio} no existe")

    if bulto.pedido_id != datos.pedido_id:
        raise HTTPException(
            status_code=409,
            detail=f"El folio {bulto.folio} NO pertenece al pedido {datos.pedido_id} (pertenece a {bulto.pedido_id})",
        )
    if bulto.estatus == "embarcado":
        raise HTTPException(status_code=409, detail=f"El folio {bulto.folio} ya fue embarcado")
    if bulto.estatus != "procesos_finales":
        raise HTTPException(
            status_code=409,
            detail=f"El folio {bulto.folio} no ha completado procesos finales (estatus: {bulto.estatus})",
        )
    if bulto.peso_procesos_finales is None:
        raise HTTPException(status_code=409, detail=f"El folio {bulto.folio} no tiene peso registrado")

    bulto.estatus = "embarcado"
    bulto.timestamp_embarque = datetime.now()
    bulto.operador_embarque = usuario["nombre_completo"]
    db.commit()

    total_pedido = db.query(Bulto).filter(Bulto.pedido_id == datos.pedido_id).count()
    embarcados_pedido = db.query(Bulto).filter(
        Bulto.pedido_id == datos.pedido_id, Bulto.estatus == "embarcado"
    ).count()

    return {
        "ok": True,
        "folio": bulto.folio,
        "pedido_completo": embarcados_pedido == total_pedido,
        "total_pedido": total_pedido,
        "embarcados_pedido": embarcados_pedido,
    }


# ---------- Catalogo de maquilas (destinos) ----------

@router.get("/api/embarque/maquilas")
def listar_maquilas(db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    maquilas = db.query(Maquila).filter(Maquila.activo == True).order_by(Maquila.nombre).all()  # noqa: E712
    return [{"id": m.id, "nombre": m.nombre} for m in maquilas]


class NuevaMaquila(BaseModel):
    nombre: str


@router.post("/api/embarque/maquilas")
def agregar_maquila(
    datos: NuevaMaquila,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    nombre = datos.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre de la maquila no puede estar vacío")
    existente = db.query(Maquila).filter(Maquila.nombre == nombre).first()
    if existente:
        if existente.activo:
            raise HTTPException(status_code=409, detail=f"La maquila '{nombre}' ya existe")
        existente.activo = True  # reactivar si estaba desactivada
        db.commit()
        return {"ok": True, "id": existente.id, "nombre": existente.nombre}
    maquila = Maquila(nombre=nombre, activo=True)
    db.add(maquila)
    db.commit()
    db.refresh(maquila)
    return {"ok": True, "id": maquila.id, "nombre": maquila.nombre}


@router.delete("/api/embarque/maquilas/{maquila_id}")
def desactivar_maquila(
    maquila_id: int,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    maquila = db.query(Maquila).filter(Maquila.id == maquila_id).first()
    if maquila is None:
        raise HTTPException(status_code=404, detail="Maquila no encontrada")
    maquila.activo = False  # no se borra: los embarques viejos conservan su historial
    db.commit()
    return {"ok": True}


class GenerarDocumento(BaseModel):
    pedido_id: str
    maquila: str | None = None


@router.post("/api/embarque/generar")
def generar_documento_embarque(
    datos: GenerarDocumento,
    db: Session = Depends(get_db),
    usuario: dict = Depends(usuario_actual_api),
):
    bultos = db.query(Bulto).filter(
        Bulto.pedido_id == datos.pedido_id, Bulto.estatus == "embarcado"
    ).order_by(Bulto.folio).all()
    if not bultos:
        raise HTTPException(status_code=409, detail="No hay folios embarcados para este pedido")

    total_no_embarcados = db.query(Bulto).filter(
        Bulto.pedido_id == datos.pedido_id, Bulto.estatus != "embarcado"
    ).count()
    if total_no_embarcados > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Todavía faltan {total_no_embarcados} folio(s) por escanear en este pedido",
        )

    maquila = (datos.maquila or "").strip() or None

    ruta_pdf = generar_pdf_embarque(datos.pedido_id, bultos, usuario["nombre_completo"], maquila=maquila)

    total_docenas = sum(b.docenas or 0 for b in bultos)
    total_peso = sum((b.peso_procesos_finales or b.peso_produccion or 0) for b in bultos)

    embarque = Embarque(
        pedido_id=datos.pedido_id,
        fecha_embarque=datetime.now(),
        total_bultos=len(bultos),
        total_docenas=total_docenas,
        total_peso=total_peso,
        documento_generado=True,
        ruta_documento=ruta_pdf,
        operador=usuario["nombre_completo"],
        maquila=maquila,
    )
    db.add(embarque)
    db.commit()
    db.refresh(embarque)

    return {
        "ok": True,
        "embarque_id": embarque.id,
        "total_bultos": embarque.total_bultos,
        "total_docenas": embarque.total_docenas,
        "total_peso": embarque.total_peso,
        "url_documento": f"/api/embarque/documento/{embarque.id}",
    }


@router.get("/api/embarque/documento/{embarque_id}")
def descargar_documento(embarque_id: int, db: Session = Depends(get_db), usuario: dict = Depends(usuario_actual_api)):
    embarque = db.query(Embarque).filter(Embarque.id == embarque_id).first()
    if embarque is None or not embarque.ruta_documento:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return FileResponse(
        embarque.ruta_documento,
        media_type="application/pdf",
        filename=f"embarque_{embarque.pedido_id}.pdf",
    )
