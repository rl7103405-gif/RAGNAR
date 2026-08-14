from datetime import datetime
import logging
import math
import os

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db, commit_seguro, candado_escritura
from app.models import Bulto, Embarque, FolioRuteo, Maquila
from app.auth import requiere_estacion, requiere_estacion_vista
from app.atalanta import atalanta_disponible, consultar_folios_de_pedido
from app.services.pdf_embarque import CARPETA_PDF, generar_pdf_embarque
from app.validation import normalizar_folio, canonizar_folio, normalizar_pedido, normalizar_texto

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")
logger = logging.getLogger("embarque")

# Dependencia común: solo la estación de embarque (y admin) usa estos endpoints.
solo_embarque = requiere_estacion("embarque")


def _folios_esperados(pedido_id: str, db: Session) -> set[str] | None:
    """Universo de folios que el pedido DEBE contener para poder cerrarse.

    Prioridad: Atalanta (cuando está configurado). Sin Atalanta, el Excel de
    ruteo importado (folios_ruteo) es la fuente local del universo esperado —
    así un folio del pedido que nunca pasó por Validación sí se detecta como
    faltante aunque no exista en la tabla de bultos.
    """
    if atalanta_disponible():
        folios = consultar_folios_de_pedido(pedido_id)
        if not folios:
            raise HTTPException(
                status_code=503,
                detail="Atalanta no devolvió los folios del pedido; no es seguro cerrar el embarque en este momento",
            )
        return {canonizar_folio(folio) for folio in folios}

    folios_ruteo = db.query(FolioRuteo.folio).filter(FolioRuteo.pedido_id == pedido_id).all()
    if folios_ruteo:
        return {canonizar_folio(f) for (f,) in folios_ruteo}
    return None


@router.get("/embarque", response_class=HTMLResponse)
def vista_embarque(request: Request, usuario: dict = Depends(requiere_estacion_vista("embarque"))):
    return templates.TemplateResponse("embarque.html", {"request": request, "usuario": usuario})


@router.get("/api/embarque/pedidos")
def listar_pedidos_activos(db: Session = Depends(get_db), usuario: dict = Depends(solo_embarque)):
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


@router.get("/api/embarque/pedido/{pedido_id:path}")
def detalle_pedido(pedido_id: str, db: Session = Depends(get_db), usuario: dict = Depends(solo_embarque)):
    pedido_id = normalizar_pedido(pedido_id)
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
    usuario: dict = Depends(solo_embarque),
):
    folio = canonizar_folio(normalizar_folio(datos.folio))
    pedido_id = normalizar_pedido(datos.pedido_id)
    folios_esperados = _folios_esperados(pedido_id, db)
    if folios_esperados is not None and folio not in folios_esperados:
        raise HTTPException(status_code=409, detail=f"El folio {folio} no pertenece al pedido {pedido_id} según el ruteo")
    # Sin Atalanta ni Excel de ruteo importado no hay universo confiable contra
    # el cual comparar: no se bloquea el escaneo (fail-closed rompería el
    # flujo), pero se marca explícitamente para que no quede en silencio.
    sin_referencia_folios = folios_esperados is None

    with candado_escritura:
        bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
        if bulto is None:
            raise HTTPException(status_code=404, detail=f"El folio {folio} no existe")

        if bulto.pedido_id != pedido_id:
            raise HTTPException(
                status_code=409,
                detail=f"El folio {bulto.folio} NO pertenece al pedido {pedido_id} (pertenece a {bulto.pedido_id})",
            )
        if bulto.estatus == "embarcado":
            raise HTTPException(status_code=409, detail=f"El folio {bulto.folio} ya fue embarcado")
        if bulto.estatus != "procesos_finales":
            raise HTTPException(
                status_code=409,
                detail=f"El folio {bulto.folio} no ha completado procesos finales (estatus: {bulto.estatus})",
            )
        if (
            bulto.peso_procesos_finales is None
            or not math.isfinite(bulto.peso_procesos_finales)
            or bulto.peso_procesos_finales <= 0
        ):
            raise HTTPException(status_code=409, detail=f"El folio {bulto.folio} no tiene peso registrado")

        bulto.estatus = "embarcado"
        bulto.timestamp_embarque = datetime.now()
        bulto.operador_embarque = usuario["nombre_completo"]
        commit_seguro(db)

        total_pedido = db.query(Bulto).filter(Bulto.pedido_id == pedido_id).count()
        embarcados_pedido = db.query(Bulto).filter(
            Bulto.pedido_id == pedido_id, Bulto.estatus == "embarcado"
        ).count()

    return {
        "ok": True,
        "folio": bulto.folio,
        "pedido_completo": embarcados_pedido == total_pedido,
        "total_pedido": total_pedido,
        "embarcados_pedido": embarcados_pedido,
        "sin_referencia_folios": sin_referencia_folios,
    }


# ---------- Catalogo de maquilas (destinos) ----------

@router.get("/api/embarque/maquilas")
def listar_maquilas(db: Session = Depends(get_db), usuario: dict = Depends(solo_embarque)):
    maquilas = db.query(Maquila).filter(Maquila.activo == True).order_by(Maquila.nombre).all()  # noqa: E712
    return [{"id": m.id, "nombre": m.nombre} for m in maquilas]


class NuevaMaquila(BaseModel):
    nombre: str


@router.post("/api/embarque/maquilas")
def agregar_maquila(
    datos: NuevaMaquila,
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_embarque),
):
    nombre = normalizar_texto(datos.nombre, "Nombre de maquila", maximo=200, requerido=True)
    with candado_escritura:
        existente = db.query(Maquila).filter(func.lower(Maquila.nombre) == nombre.lower()).first()
        if existente:
            if existente.activo:
                raise HTTPException(status_code=409, detail=f"La maquila '{nombre}' ya existe")
            existente.activo = True  # reactivar si estaba desactivada
            commit_seguro(db)
            return {"ok": True, "id": existente.id, "nombre": existente.nombre}
        maquila = Maquila(nombre=nombre, activo=True)
        db.add(maquila)
        commit_seguro(db)
        db.refresh(maquila)
    return {"ok": True, "id": maquila.id, "nombre": maquila.nombre}


@router.delete("/api/embarque/maquilas/{maquila_id}")
def desactivar_maquila(
    maquila_id: int,
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_embarque),
):
    with candado_escritura:
        maquila = db.query(Maquila).filter(Maquila.id == maquila_id).first()
        if maquila is None:
            raise HTTPException(status_code=404, detail="Maquila no encontrada")
        maquila.activo = False  # no se borra: los embarques viejos conservan su historial
        commit_seguro(db)
    return {"ok": True}


class GenerarDocumento(BaseModel):
    pedido_id: str
    maquila: str | None = None
    regenerar: bool = False


@router.post("/api/embarque/generar")
def generar_documento_embarque(
    datos: GenerarDocumento,
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_embarque),
):
    pedido_id = normalizar_pedido(datos.pedido_id)
    maquila = normalizar_texto(datos.maquila, "Maquila", maximo=200, requerido=True)
    folios_esperados = _folios_esperados(pedido_id, db)
    # Igual que en /api/embarque/escanear: sin Atalanta ni Excel de ruteo no
    # hay universo confiable para comparar. No se bloquea el cierre (fail-
    # closed rompería el flujo cuando de plano no hay referencia), pero queda
    # una advertencia explícita en la respuesta en vez de un silencio.
    sin_referencia_folios = folios_esperados is None

    with candado_escritura:
        maquila_activa = db.query(Maquila).filter(
            func.lower(Maquila.nombre) == maquila.lower(), Maquila.activo == True  # noqa: E712
        ).first()
        if maquila_activa is None:
            raise HTTPException(status_code=400, detail="Selecciona una maquila activa del catálogo")
        maquila = maquila_activa.nombre

        todos_los_bultos = db.query(Bulto).filter(Bulto.pedido_id == pedido_id).order_by(Bulto.folio).all()
        for bulto in todos_los_bultos:
            if bulto.peso_procesos_finales is not None and (
                not math.isfinite(bulto.peso_procesos_finales) or bulto.peso_procesos_finales <= 0
            ):
                raise HTTPException(status_code=409, detail=f"El folio {bulto.folio} tiene un peso final inválido")
            if bulto.docenas is not None and (not math.isfinite(bulto.docenas) or bulto.docenas < 0):
                raise HTTPException(status_code=409, detail=f"El folio {bulto.folio} tiene una cantidad de docenas inválida")
        folios_locales = [canonizar_folio(b.folio) for b in todos_los_bultos]
        if len(folios_locales) != len(set(folios_locales)):
            raise HTTPException(status_code=409, detail="El pedido contiene folios duplicados equivalentes y no puede cerrarse")
        if folios_esperados is not None:
            locales = set(folios_locales)
            faltantes = sorted(folios_esperados - locales)
            sobrantes = sorted(locales - folios_esperados)
            if faltantes or sobrantes:
                partes = []
                if faltantes:
                    partes.append(f"faltan en la app: {', '.join(faltantes[:10])}")
                if sobrantes:
                    partes.append(f"no pertenecen al pedido: {', '.join(sobrantes[:10])}")
                raise HTTPException(status_code=409, detail="Los folios no coinciden con el ruteo; " + "; ".join(partes))

        bultos = [b for b in todos_los_bultos if b.estatus == "embarcado"]
        if not bultos:
            raise HTTPException(status_code=409, detail="No hay folios embarcados para este pedido")

        total_no_embarcados = len(todos_los_bultos) - len(bultos)
        if total_no_embarcados > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Todavía faltan {total_no_embarcados} folio(s) por escanear en este pedido",
            )

        # Si ya se generó un documento para este pedido, no se genera otro en
        # automático (evita duplicados por doble clic); se pide confirmación
        # explícita para volver a generarlo.
        existente = (
            db.query(Embarque)
            .filter(Embarque.pedido_id == pedido_id, Embarque.documento_generado == True)  # noqa: E712
            .order_by(Embarque.id.desc())
            .first()
        )
        if existente and not datos.regenerar:
            return {
                "ok": False,
                "requiere_confirmacion": True,
                "mensaje": (
                    f"Ya existe un documento de salida para el pedido {pedido_id}, "
                    f"generado por {existente.operador or 'desconocido'}. ¿Volver a generarlo?"
                ),
                "url_documento": f"/api/embarque/documento/{existente.id}",
            }

        try:
            ruta_pdf = generar_pdf_embarque(pedido_id, bultos, usuario["nombre_completo"], maquila=maquila)
        except Exception as exc:
            logger.exception("No se pudo generar el PDF del pedido %s", pedido_id)
            raise HTTPException(status_code=500, detail="No se pudo generar el documento PDF") from exc

        total_docenas = sum(b.docenas or 0 for b in bultos)
        total_peso = sum((b.peso_procesos_finales or b.peso_produccion or 0) for b in bultos)

        embarque = Embarque(
            pedido_id=pedido_id,
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
        try:
            commit_seguro(db)
        except Exception:
            try:
                os.remove(ruta_pdf)
            except OSError:
                pass
            raise
        db.refresh(embarque)

    return {
        "ok": True,
        "embarque_id": embarque.id,
        "total_bultos": embarque.total_bultos,
        "total_docenas": embarque.total_docenas,
        "total_peso": embarque.total_peso,
        "url_documento": f"/api/embarque/documento/{embarque.id}",
        "sin_referencia_folios": sin_referencia_folios,
    }


@router.get("/api/embarque/documento/{embarque_id}")
def descargar_documento(embarque_id: int, db: Session = Depends(get_db), usuario: dict = Depends(solo_embarque)):
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
