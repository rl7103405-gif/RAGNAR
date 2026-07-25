"""
Estacion de Validacion — puente mientras no hay acceso SQL al ERP.

El operador escanea un folio; solo se aceptan folios presentes en el Excel
de ruteo importado (tabla folios_ruteo). Se pesa el bulto y se compara
contra el peso teorico del catalogo (peso unitario del codigo x total de
docenas x multiplicador configurable):

- modo 'observacion' (prueba/calibracion): registra la diferencia, nunca retiene.
- modo 'enforcement': si |diferencia| > tolerancia, el bulto queda RETENIDO
  (no imprime etiqueta ni avanza; un administrador puede liberarlo).

Si pasa, se imprime la etiqueta con la leyenda VALIDADO y el bulto queda
listo para Procesos Finales.
"""
import math
from datetime import datetime

from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, commit_seguro, candado_escritura
from app.models import Bulto, FolioRuteo, CatalogoPeso, AuditoriaRecaptura
from app.auth import requiere_estacion, requiere_estacion_vista
from app.zebra_print import generar_zpl_etiqueta, imprimir_etiqueta
from app.validation import normalizar_folio, canonizar_folio, validar_peso

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def _datos_folio_ruteo(db: Session, folio: str):
    """Busca el folio en el ruteo importado y arma el contexto de validacion."""
    registro = db.query(FolioRuteo).filter(FolioRuteo.folio == folio).first()
    if registro is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"El folio {folio} NO está en el ruteo importado: bulto bloqueado. "
                "Verifica el folio o importa el Excel de ruteo del día en Administración."
            ),
        )
    catalogo = db.query(CatalogoPeso).filter(CatalogoPeso.codigo == registro.codigo).first()
    if catalogo is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"El código {registro.codigo} del folio {folio} no está en el catálogo de pesos. "
                "Importa el Excel de códigos/productos del día en Administración."
            ),
        )
    unidades = registro.total if registro.total is not None else registro.docenas
    if unidades is None or unidades <= 0:
        raise HTTPException(status_code=409, detail=f"El folio {folio} no tiene docenas registradas en el ruteo")
    peso_teorico = catalogo.peso_unitario_gramos * unidades * settings.MULTIPLICADOR_VALIDACION
    if not math.isfinite(peso_teorico) or peso_teorico <= 0:
        raise HTTPException(
            status_code=409,
            detail=f"El peso teórico del folio {folio} es inválido (revisa el catálogo de pesos del código {registro.codigo})",
        )
    return registro, catalogo, unidades, peso_teorico


@router.get("/validacion", response_class=HTMLResponse)
def vista_validacion(request: Request, usuario: dict = Depends(requiere_estacion_vista("validacion"))):
    return templates.TemplateResponse("validacion.html", {
        "request": request,
        "usuario": usuario,
        "modo": settings.VALIDACION_MODO,
        "tolerancia": settings.TOLERANCIA_VALIDACION_PORCENTAJE,
    })


@router.get("/api/validacion/consultar/{folio}")
def consultar(folio: str, db: Session = Depends(get_db), usuario: dict = Depends(requiere_estacion("validacion"))):
    folio = canonizar_folio(normalizar_folio(folio))
    registro, catalogo, unidades, peso_teorico = _datos_folio_ruteo(db, folio)
    bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
    docenas_reales = registro.docenas if registro.docenas is not None else unidades
    return {
        "folio": folio,
        "codigo_producto": registro.codigo,
        "docenas": docenas_reales,
        "unidades": unidades,
        "pedido_id": registro.pedido_id,
        "peso_unitario_gramos": catalogo.peso_unitario_gramos,
        "peso_teorico": peso_teorico,
        "multiplicador": settings.MULTIPLICADOR_VALIDACION,
        "tolerancia_porcentaje": settings.TOLERANCIA_VALIDACION_PORCENTAJE,
        "modo": settings.VALIDACION_MODO,
        "estatus_actual": bulto.estatus if bulto else None,
        "ya_validado": bulto is not None and bulto.estatus in ("validado", "retenido"),
        "ya_avanzo": bulto is not None and bulto.estatus in ("procesos_finales", "embarcado"),
    }


class GuardarValidacion(BaseModel):
    folio: str
    peso: float
    sobrescribir: bool = False
    marca_confirmada: str | None = None


@router.post("/api/validacion/guardar")
def guardar_validacion(
    datos: GuardarValidacion,
    db: Session = Depends(get_db),
    usuario: dict = Depends(requiere_estacion("validacion")),
):
    if not settings.VALIDACION_ACTIVA:
        raise HTTPException(
            status_code=409,
            detail="La estación de Validación está desactivada: usa Producción/Ruteadores",
        )
    folio = canonizar_folio(normalizar_folio(datos.folio))
    peso = validar_peso(datos.peso, settings.PESO_MAX_GRAMOS)

    with candado_escritura:
        registro, catalogo, unidades, peso_teorico = _datos_folio_ruteo(db, folio)
        bulto = db.query(Bulto).filter(Bulto.folio == folio).first()

        if bulto is not None and bulto.estatus in ("procesos_finales", "embarcado"):
            raise HTTPException(
                status_code=409,
                detail=f"El folio {folio} ya avanzó a '{bulto.estatus}' y no puede revalidarse aquí",
            )

        es_revalidacion = bulto is not None and bulto.estatus in ("validado", "retenido")
        if es_revalidacion:
            marca_actual = bulto.timestamp_validacion.isoformat() if bulto.timestamp_validacion else None
            if not datos.sobrescribir:
                return {
                    "ok": False,
                    "requiere_sobrescribir": True,
                    "marca": marca_actual,
                    "mensaje": (
                        f"El folio {folio} ya fue validado: {(bulto.peso_validacion or 0) / 1000:.2f} kg "
                        f"({bulto.estatus}) por {bulto.operador_validacion or 'desconocido'}. "
                        "¿Sobrescribir con la nueva captura? Si la etiqueta anterior ya está pegada, retírala."
                    ),
                }
            if datos.marca_confirmada != marca_actual:
                # Entre el "requiere_sobrescribir" y este POST, otro operador
                # revalido el mismo folio: no se pisa a ciegas, se vuelve a
                # pedir confirmacion con la marca (y los datos) mas recientes.
                return {
                    "ok": False,
                    "requiere_sobrescribir": True,
                    "marca": marca_actual,
                    "mensaje": (
                        f"El folio {folio} fue revalidado por alguien más mientras confirmabas "
                        f"(ahora: {(bulto.peso_validacion or 0) / 1000:.2f} kg, {bulto.estatus}, "
                        f"por {bulto.operador_validacion or 'desconocido'}). Revisa y confirma de nuevo."
                    ),
                }

        diferencia_pct = (peso - peso_teorico) / peso_teorico * 100
        fuera_de_tolerancia = abs(diferencia_pct) > settings.TOLERANCIA_VALIDACION_PORCENTAJE
        retener = fuera_de_tolerancia and settings.VALIDACION_MODO == "enforcement"

        if bulto is None:
            bulto = Bulto(folio=folio)
            db.add(bulto)

        if es_revalidacion:
            db.add(AuditoriaRecaptura(
                folio=folio,
                estacion="validacion",
                descripcion=(
                    f"revalidación: {(bulto.peso_validacion or 0) / 1000:.2f} kg ({bulto.estatus}) "
                    f"-> {peso / 1000:.2f} kg ({'retenido' if retener else 'validado'}) "
                    f"(validado antes por {bulto.operador_validacion or 'desconocido'})"
                ),
                operador=usuario["nombre_completo"],
                timestamp=datetime.now(),
            ))

        bulto.codigo_producto = registro.codigo
        bulto.docenas = registro.docenas if registro.docenas is not None else unidades
        bulto.pedido_id = registro.pedido_id
        cliente = registro.nombre_guia
        bulto.cliente = cliente if cliente and cliente.upper() != "SIN RUTA" else bulto.cliente
        # peso_validacion es la fuente de verdad; peso_produccion se llena con
        # el mismo valor para que procesos finales, calibración, embarque y
        # reportes existentes sigan funcionando sin cambios.
        bulto.peso_validacion = peso
        bulto.peso_produccion = peso
        bulto.peso_teorico = round(peso_teorico, 2)
        bulto.diferencia_validacion_porcentaje = round(diferencia_pct, 3)
        bulto.multiplicador_aplicado = settings.MULTIPLICADOR_VALIDACION
        bulto.tolerancia_aplicada = settings.TOLERANCIA_VALIDACION_PORCENTAJE
        bulto.timestamp_validacion = datetime.now()
        bulto.operador_validacion = usuario["nombre_completo"]
        bulto.estatus = "retenido" if retener else "validado"
        bulto.etiqueta_impresa = False

        if retener:
            db.add(AuditoriaRecaptura(
                folio=folio,
                estacion="validacion",
                descripcion=(
                    f"RETENIDO: peso {peso / 1000:.2f} kg vs teórico {peso_teorico / 1000:.2f} kg "
                    f"({diferencia_pct:+.1f}%, tolerancia ±{settings.TOLERANCIA_VALIDACION_PORCENTAJE:.0f}%)"
                ),
                operador=usuario["nombre_completo"],
                timestamp=datetime.now(),
            ))

        commit_seguro(db)
        db.refresh(bulto)
        marca_validacion = bulto.timestamp_validacion
        zpl = None
        if not retener:
            zpl = _generar_etiqueta_validacion(bulto)

    resultado_impresion = None
    if zpl is not None:
        # La impresión sale del candado: es una llamada de red que puede tardar.
        resultado_impresion = imprimir_etiqueta(zpl)
        with candado_escritura:
            db.refresh(bulto)
            if bulto.timestamp_validacion == marca_validacion:
                bulto.etiqueta_impresa = resultado_impresion["enviado"]
                commit_seguro(db)

    return {
        "ok": True,
        "folio": folio,
        "retenido": retener,
        "fuera_de_tolerancia": fuera_de_tolerancia,
        "modo": settings.VALIDACION_MODO,
        "peso": peso,
        "peso_teorico": round(peso_teorico, 2),
        "diferencia_porcentaje": round(diferencia_pct, 2),
        "tolerancia_porcentaje": settings.TOLERANCIA_VALIDACION_PORCENTAJE,
        "impresion": resultado_impresion,
    }


class ReimprimirEtiqueta(BaseModel):
    folio: str


@router.post("/api/validacion/reimprimir")
def reimprimir_etiqueta(
    datos: ReimprimirEtiqueta,
    db: Session = Depends(get_db),
    usuario: dict = Depends(requiere_estacion("validacion")),
):
    folio = canonizar_folio(normalizar_folio(datos.folio))
    with candado_escritura:
        bulto = db.query(Bulto).filter(Bulto.folio == folio).first()
        if bulto is None or bulto.estatus != "validado":
            raise HTTPException(status_code=409, detail="Solo se puede reimprimir la etiqueta de un folio validado")
        marca_validacion = bulto.timestamp_validacion
        zpl = _generar_etiqueta_validacion(bulto)

    resultado = imprimir_etiqueta(zpl)
    with candado_escritura:
        db.refresh(bulto)
        if bulto.timestamp_validacion == marca_validacion:
            bulto.etiqueta_impresa = resultado["enviado"]
            commit_seguro(db)
    return {"ok": True, "impresion": resultado}


def _generar_etiqueta_validacion(bulto: Bulto) -> str:
    return generar_zpl_etiqueta(
        folio=bulto.folio,
        codigo_producto=bulto.codigo_producto or "",
        docenas=f"{bulto.docenas:g}" if bulto.docenas is not None else "",
        pedido_id=bulto.pedido_id or "",
        cliente=bulto.cliente or "",
        peso_produccion=str(bulto.peso_validacion or ""),
        fecha=datetime.now().strftime("%d/%m/%Y"),
        leyenda="VALIDADO",
    )
