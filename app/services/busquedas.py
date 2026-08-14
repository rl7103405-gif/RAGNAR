"""
Busquedas compartidas del historial de capturas y de los documentos de
embarque (PDF). Las usan tanto la pantalla de Administracion como la de
Historial (disponible para todos los usuarios con sesion).
"""
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Bulto, Embarque


def _parsear_fecha(valor: str | None, campo: str) -> datetime | None:
    """Fecha 'YYYY-MM-DD' de los filtros de búsqueda; None si viene vacía."""
    if not valor or not valor.strip():
        return None
    try:
        return datetime.strptime(valor.strip(), "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{campo} inválida: usa el formato AAAA-MM-DD")


def _validar_rango_fechas(desde: datetime | None, hasta_exclusiva: datetime | None) -> None:
    """`hasta_exclusiva` ya trae el +1 día aplicado; se compara contra ella
    para que 'desde == hasta' (mismo día) siga siendo un rango válido."""
    if desde is not None and hasta_exclusiva is not None and desde >= hasta_exclusiva:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser mayor que la final")


def _fecha_hasta_inclusiva(fecha_hasta: datetime | None, campo: str) -> datetime | None:
    """Convierte el 'hasta' del filtro en el límite exclusivo del día siguiente."""
    if fecha_hasta is None:
        return None
    try:
        return fecha_hasta + timedelta(days=1)
    except OverflowError:
        raise HTTPException(status_code=400, detail=f"{campo} fuera de rango")


def _patron_like(texto: str) -> str:
    """Escapa \\, % y _ para usarse como patrón LIKE/ILIKE literal (con
    escape='\\\\'): sin esto, un pedido con guion bajo real (ej. '7887_REPO')
    matchea de más porque '_' es el comodín de un solo carácter."""
    escapado = texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escapado}%"


def _texto_filtro(valor: str | None, campo: str) -> str | None:
    """Filtro de texto libre: recortado, sin control chars, tope de longitud."""
    texto = (valor or "").strip()
    if not texto:
        return None
    if len(texto) > 100 or any(ord(c) < 32 or ord(c) == 127 for c in texto):
        raise HTTPException(status_code=400, detail=f"Filtro de {campo} inválido")
    return texto


def buscar_bultos(
    db: Session,
    folio: str | None = None,
    codigo: str | None = None,
    operador: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
) -> list[dict]:
    """Historial de capturas con búsqueda por folio, código, operador y rango de fechas.

    Las fechas comparan contra CUALQUIER timestamp del bulto (validación,
    producción, ruteo, procesos finales o embarque): un bulto aparece si tuvo
    actividad dentro del rango.
    """
    filtro_folio = _texto_filtro(folio, "folio")
    filtro_codigo = _texto_filtro(codigo, "código")
    filtro_operador = _texto_filtro(operador, "operador")
    fecha_desde = _parsear_fecha(desde, "Fecha inicial")
    fecha_hasta = _parsear_fecha(hasta, "Fecha final")
    fecha_hasta = _fecha_hasta_inclusiva(fecha_hasta, "Fecha final")  # inclusivo: todo el día final
    _validar_rango_fechas(fecha_desde, fecha_hasta)

    q = db.query(Bulto)
    if filtro_folio:
        q = q.filter(Bulto.folio.ilike(_patron_like(filtro_folio), escape="\\"))
    if filtro_codigo:
        q = q.filter(Bulto.codigo_producto.ilike(_patron_like(filtro_codigo), escape="\\"))
    if filtro_operador:
        patron = _patron_like(filtro_operador)
        q = q.filter(or_(
            Bulto.operador_validacion.ilike(patron, escape="\\"),
            Bulto.operador_produccion.ilike(patron, escape="\\"),
            Bulto.operador_ruteo.ilike(patron, escape="\\"),
            Bulto.operador_procesos_finales.ilike(patron, escape="\\"),
            Bulto.operador_embarque.ilike(patron, escape="\\"),
        ))
    columnas_fecha = (
        Bulto.timestamp_validacion,
        Bulto.timestamp_produccion,
        Bulto.timestamp_ruteo,
        Bulto.timestamp_procesos_finales,
        Bulto.timestamp_embarque,
    )
    if fecha_desde is not None and fecha_hasta is not None:
        # Un mismo evento (columna) debe caer completo dentro del rango.
        q = q.filter(or_(*[(col >= fecha_desde) & (col < fecha_hasta) for col in columnas_fecha]))
    elif fecha_desde is not None:
        q = q.filter(or_(*[col >= fecha_desde for col in columnas_fecha]))
    elif fecha_hasta is not None:
        q = q.filter(or_(*[col < fecha_hasta for col in columnas_fecha]))

    bultos = q.order_by(Bulto.id.desc()).limit(500).all()
    return [
        {
            "folio": b.folio,
            "estatus": b.estatus,
            "pedido_id": b.pedido_id,
            "cliente": b.cliente,
            "codigo_producto": b.codigo_producto,
            "docenas": b.docenas,
            "peso_produccion": b.peso_produccion,
            "peso_procesos_finales": b.peso_procesos_finales,
            "diferencia_gramos": b.diferencia_gramos,
            "diferencia_porcentaje": b.diferencia_porcentaje,
            "diferencia_alerta": b.diferencia_alerta,
            "operador_validacion": b.operador_validacion,
            "operador_produccion": b.operador_produccion,
            "operador_ruteo": b.operador_ruteo,
            "operador_procesos_finales": b.operador_procesos_finales,
            "operador_embarque": b.operador_embarque,
            "timestamp_validacion": b.timestamp_validacion.isoformat() if b.timestamp_validacion else None,
            "timestamp_produccion": b.timestamp_produccion.isoformat() if b.timestamp_produccion else None,
            "timestamp_ruteo": b.timestamp_ruteo.isoformat() if b.timestamp_ruteo else None,
            "timestamp_procesos_finales": b.timestamp_procesos_finales.isoformat() if b.timestamp_procesos_finales else None,
            "timestamp_embarque": b.timestamp_embarque.isoformat() if b.timestamp_embarque else None,
        }
        for b in bultos
    ]


def buscar_embarques(
    db: Session,
    pedido: str | None = None,
    maquila: str | None = None,
    operador: str | None = None,
    folio: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    ruta_documento_base: str = "/api/embarque/documento",
) -> list[dict]:
    """Documentos de salida (PDF) generados, con búsqueda por maquila (destino),
    quién lo generó, fecha, pedido o un folio contenido en el pedido.

    `ruta_documento_base` permite que cada pantalla arme la URL de descarga
    hacia su propio endpoint autorizado.
    """
    filtro_pedido = _texto_filtro(pedido, "pedido")
    filtro_maquila = _texto_filtro(maquila, "maquila")
    filtro_operador = _texto_filtro(operador, "operador")
    filtro_folio = _texto_filtro(folio, "folio")
    fecha_desde = _parsear_fecha(desde, "Fecha inicial")
    fecha_hasta = _parsear_fecha(hasta, "Fecha final")
    fecha_hasta = _fecha_hasta_inclusiva(fecha_hasta, "Fecha final")
    _validar_rango_fechas(fecha_desde, fecha_hasta)

    q = db.query(Embarque)
    if filtro_pedido:
        q = q.filter(Embarque.pedido_id.ilike(_patron_like(filtro_pedido), escape="\\"))
    if filtro_maquila:
        q = q.filter(Embarque.maquila.ilike(_patron_like(filtro_maquila), escape="\\"))
    if filtro_operador:
        q = q.filter(Embarque.operador.ilike(_patron_like(filtro_operador), escape="\\"))
    if filtro_folio:
        # Encontrar el documento por un folio que viaja en él: subconsulta de
        # los pedidos que contienen ese folio, sin materializarla en Python.
        subq = (
            db.query(Bulto.pedido_id)
            .filter(Bulto.folio.ilike(_patron_like(filtro_folio), escape="\\"), Bulto.pedido_id.isnot(None))
            .distinct()
            .subquery()
        )
        q = q.filter(Embarque.pedido_id.in_(select(subq.c.pedido_id)))
    if fecha_desde is not None:
        q = q.filter(Embarque.fecha_embarque >= fecha_desde)
    if fecha_hasta is not None:
        q = q.filter(Embarque.fecha_embarque < fecha_hasta)

    embarques = q.order_by(Embarque.id.desc()).limit(200).all()
    pedido_ids = [e.pedido_id for e in embarques if e.pedido_id is not None]
    folios_por_pedido: dict[str, list[str]] = {}
    if pedido_ids:
        filas_folios = (
            db.query(Bulto.pedido_id, Bulto.folio)
            .filter(Bulto.pedido_id.in_(pedido_ids), Bulto.estatus == "embarcado")
            .order_by(Bulto.folio)
            .all()
        )
        for pedido_id, folio_b in filas_folios:
            folios_por_pedido.setdefault(pedido_id, []).append(folio_b)

    resultado = []
    for e in embarques:
        folios = folios_por_pedido.get(e.pedido_id, [])[:60]
        resultado.append({
            "id": e.id,
            "pedido_id": e.pedido_id,
            "maquila": e.maquila,
            "operador": e.operador,
            "fecha_embarque": e.fecha_embarque.isoformat() if e.fecha_embarque else None,
            "total_bultos": e.total_bultos,
            "total_docenas": e.total_docenas,
            "total_peso": e.total_peso,
            "folios": folios,
            "documento_generado": e.documento_generado,
            "url_documento": f"{ruta_documento_base}/{e.id}" if e.documento_generado else None,
        })
    return resultado
