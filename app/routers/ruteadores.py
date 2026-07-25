from datetime import datetime
import math

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, commit_seguro, candado_escritura
from app.models import Bulto, AuditoriaRecaptura
from app.auth import requiere_estacion, requiere_estacion_vista
from app.atalanta import consultar_folio, atalanta_disponible
from app.zebra_print import generar_zpl_etiqueta, imprimir_etiqueta
from app.validation import normalizar_folio, canonizar_folio, normalizar_pedido, normalizar_texto, validar_docenas

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/ruteadores", response_class=HTMLResponse)
def vista_ruteadores(request: Request, usuario: dict = Depends(requiere_estacion_vista("ruteadores"))):
    return templates.TemplateResponse("ruteadores.html", {"request": request, "usuario": usuario})


@router.post("/api/ruteadores/consultar/{folio}")
def consultar(folio: str, db: Session = Depends(get_db), usuario: dict = Depends(requiere_estacion("ruteadores"))):
    folio = canonizar_folio(normalizar_folio(folio))
    bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
    if bulto is None:
        raise HTTPException(status_code=404, detail=f"El folio {folio} no ha sido pesado en producción")
    if bulto.peso_produccion is None or not math.isfinite(bulto.peso_produccion) or bulto.peso_produccion <= 0:
        raise HTTPException(status_code=409, detail=f"El folio {folio} no tiene peso de producción registrado")

    datos_atalanta = consultar_folio(folio)
    if datos_atalanta:
        with candado_escritura:
            # Cerrar la transacción de la consulta inicial para no conservar
            # un snapshot anterior mientras Atalanta estaba respondiendo.
            db.rollback()
            bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
            if bulto is None:
                raise HTTPException(status_code=404, detail=f"El folio {folio} ya no existe")
            if bulto.estatus not in ("procesos_finales", "embarcado"):
                bulto.codigo_producto = datos_atalanta.get("codigo_producto") or bulto.codigo_producto
                if datos_atalanta.get("docenas") is not None:
                    bulto.docenas = datos_atalanta["docenas"]
                bulto.pedido_id = datos_atalanta.get("pedido_id") or bulto.pedido_id
                bulto.cliente = datos_atalanta.get("cliente") or bulto.cliente
                bulto.fecha_entrega = datos_atalanta.get("fecha_entrega") or bulto.fecha_entrega
                commit_seguro(db)
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
    sobrescribir: bool = False
    marca_confirmada: str | None = None


@router.post("/api/ruteadores/confirmar")
def confirmar_ruteo(
    datos: ConfirmarRuteo,
    db: Session = Depends(get_db),
    usuario: dict = Depends(requiere_estacion("ruteadores")),
):
    if settings.VALIDACION_ACTIVA:
        # Bloqueado mientras la estación de Validación esté activa (el bulto
        # se etiqueta ahí). Se desactiva con VALIDACION_ACTIVA=false en .env.
        raise HTTPException(
            status_code=409,
            detail="Ruteadores está deshabilitada: usa la estación de Validación",
        )
    folio = canonizar_folio(normalizar_folio(datos.folio))
    codigo_producto = normalizar_texto(datos.codigo_producto, "Código de producto", maximo=100)
    docenas = validar_docenas(datos.docenas)
    pedido_id = normalizar_pedido(datos.pedido_id) if datos.pedido_id is not None else None
    cliente = normalizar_texto(datos.cliente, "Cliente", maximo=200)

    with candado_escritura:
        bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
        if bulto is None:
            raise HTTPException(status_code=404, detail="Folio no encontrado")
        if bulto.peso_produccion is None or not math.isfinite(bulto.peso_produccion) or bulto.peso_produccion <= 0:
            raise HTTPException(status_code=409, detail="El folio no tiene peso de producción")
        if bulto.estatus in ("procesos_finales", "embarcado"):
            raise HTTPException(
                status_code=409,
                detail=f"El folio {bulto.folio} ya avanzó a '{bulto.estatus}' y no puede regresarse a ruteado",
            )

        # Re-ruteo: el bulto ya fue confirmado antes. Se exige confirmación
        # explícita y queda registro de los datos anteriores en auditoría.
        if bulto.estatus == "ruteado":
            marca_actual = bulto.timestamp_ruteo.isoformat() if bulto.timestamp_ruteo else None
            if not datos.sobrescribir:
                return {
                    "ok": False,
                    "requiere_sobrescribir": True,
                    "marca": marca_actual,
                    "mensaje": (
                        f"El folio {bulto.folio} ya fue ruteado por {bulto.operador_ruteo or 'desconocido'}. "
                        "¿Volver a confirmarlo (se reimprime la etiqueta y se actualizan los datos)?"
                    ),
                }
            if datos.marca_confirmada != marca_actual:
                # Entre el "requiere_sobrescribir" y este POST, otro operador
                # re-ruteo el mismo folio: no se pisa a ciegas, se vuelve a
                # pedir confirmacion con los datos mas recientes.
                return {
                    "ok": False,
                    "requiere_sobrescribir": True,
                    "marca": marca_actual,
                    "mensaje": (
                        f"El folio {bulto.folio} fue re-ruteado por alguien más mientras confirmabas "
                        f"(ahora por {bulto.operador_ruteo or 'desconocido'}). Revisa y confirma de nuevo."
                    ),
                }
            db.add(AuditoriaRecaptura(
                folio=bulto.folio,
                estacion="ruteadores",
                descripcion=(
                    f"re-ruteo; datos anteriores: código={bulto.codigo_producto}, docenas={bulto.docenas}, "
                    f"pedido={bulto.pedido_id}, cliente={bulto.cliente} "
                    f"(ruteado antes por {bulto.operador_ruteo or 'desconocido'})"
                ),
                operador=usuario["nombre_completo"],
                timestamp=datetime.now(),
            ))

        # Permite capturar manualmente los datos si Atalanta no está disponible.
        bulto.codigo_producto = codigo_producto or bulto.codigo_producto
        bulto.docenas = docenas if docenas is not None else bulto.docenas
        bulto.pedido_id = pedido_id or bulto.pedido_id
        bulto.cliente = cliente or bulto.cliente

        # Sin pedido el bulto queda ruteado pero nunca puede aparecer en Embarque.
        bulto.pedido_id = normalizar_pedido(bulto.pedido_id)
        if bulto.docenas is not None:
            bulto.docenas = validar_docenas(bulto.docenas)

        bulto.estatus = "ruteado"
        bulto.timestamp_ruteo = datetime.now()
        bulto.operador_ruteo = usuario["nombre_completo"]

        commit_seguro(db)

        marca_ruteo = bulto.timestamp_ruteo
        zpl = generar_zpl_etiqueta(
            folio=bulto.folio,
            codigo_producto=bulto.codigo_producto or "",
            docenas=str(bulto.docenas) if bulto.docenas is not None else "",
            pedido_id=bulto.pedido_id or "",
            cliente=bulto.cliente or "",
            peso_produccion=str(bulto.peso_produccion),
            fecha=datetime.now().strftime("%d/%m/%Y"),
        )

    # La impresión hace una llamada de red hacia la Zebra: se hace fuera del
    # candado para no bloquear a las demás peticiones mientras la impresora
    # responde (o no responde).
    resultado_impresion = imprimir_etiqueta(zpl)
    with candado_escritura:
        db.refresh(bulto)
        # Un re-ruteo concurrente puede haber generado otra etiqueta mientras
        # la impresora respondía; no atribuirle el resultado de esta impresión.
        if bulto.timestamp_ruteo == marca_ruteo:
            bulto.etiqueta_impresa = resultado_impresion["enviado"]
            commit_seguro(db)

    return {
        "ok": True,
        "folio": bulto.folio,
        "estatus": bulto.estatus,
        "impresion": resultado_impresion,
        "zpl": zpl,
    }
