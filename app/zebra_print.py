"""
Generacion e impresion de etiquetas ZPL para impresoras Zebra (ZT410/ZM400).

Etiqueta fisica: 10 cm x 8.2 cm. A 203 dpi (8 dots/mm) = 800 x 656 dots.

La IP/puerto de la impresora se configuran en .env (ZEBRA_IP, ZEBRA_PORT).
Mientras ZEBRA_IP este vacio, imprimir_etiqueta() no intenta conectarse
y solo devuelve el ZPL generado (modo "impresora no configurada").

El logo (app/static/logo_quini.zpl, generado con herramientas/generar_logo_zpl.py)
se incrusta en la esquina superior derecha; si el archivo no existe o esta
corrupto, la etiqueta se imprime sin logo y se registra una advertencia.
"""
import logging
import re as _re
import socket
import unicodedata
from pathlib import Path

from app.config import settings

logger = logging.getLogger("zebra_print")

# Dimensiones de la etiqueta en dots (203 dpi, 8 dots/mm).
ETIQUETA_ANCHO_DOTS = 800   # 10 cm
ETIQUETA_ALTO_DOTS = 656    # 8.2 cm
MARGEN_DOTS = 30            # margen fisico: imprimir al borde suele recortar

_RUTA_LOGO = Path(__file__).parent / "static" / "logo_quini.zpl"
_PATRON_GFA = _re.compile(r"^\^GFA,(\d+),(\d+),(\d+),([0-9A-Fa-f]+)$")
LOGO_LADO_DOTS = 144


def _cargar_logo_zpl() -> str | None:
    """Carga y valida el bloque ^GFA del logo. Devuelve None si no es usable."""
    try:
        contenido = _RUTA_LOGO.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        logger.warning("Logo no encontrado en %s: las etiquetas saldran SIN logo. "
                       "Generarlo con herramientas/generar_logo_zpl.py", _RUTA_LOGO)
        return None
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning("No se pudo leer el logo (%s): etiquetas sin logo. %s", _RUTA_LOGO, exc)
        return None

    match = _PATRON_GFA.match(contenido)
    if not match:
        logger.warning("El archivo del logo %s no tiene formato ^GFA valido: etiquetas sin logo.", _RUTA_LOGO)
        return None
    total, total2, por_fila, hexdata = int(match.group(1)), int(match.group(2)), int(match.group(3)), match.group(4)
    # El layout de la etiqueta reserva exactamente 144x144 dots para el logo:
    # se exige ese tamano exacto (18 bytes/fila x 144 filas = 2592 bytes).
    esperado = (LOGO_LADO_DOTS // 8) * LOGO_LADO_DOTS
    if (
        total != total2
        or total != esperado
        or por_fila != LOGO_LADO_DOTS // 8
        or len(hexdata) != total * 2
    ):
        logger.warning("El logo %s no mide 144x144 dots como exige el layout: etiquetas sin logo.", _RUTA_LOGO)
        return None
    return contenido


_LOGO_ZPL = _cargar_logo_zpl()


def logo_disponible() -> bool:
    return _LOGO_ZPL is not None


def _texto_zpl(valor: str, maximo: int = 100) -> str:
    """Convierte texto capturado a ASCII e impide inyectar comandos ZPL."""
    texto = unicodedata.normalize("NFKD", str(valor or ""))
    texto = texto.encode("ascii", errors="ignore").decode("ascii")
    texto = " ".join(texto.replace("^", " ").replace("~", " ").split())
    return texto[:maximo] or "-"


import math as _math


def _peso_gramos_a_kg_texto(peso_produccion: str) -> str:
    """Convierte el peso (que llega en gramos, como string) a texto en kg.

    Ante un valor no numerico, no finito o negativo devuelve '-' en vez de
    imprimir basura ('nan kg', 'inf kg') en la etiqueta fisica.
    """
    try:
        gramos = float(peso_produccion)
    except (TypeError, ValueError):
        return "-"
    if not _math.isfinite(gramos) or gramos < 0:
        return "-"
    return f"{gramos / 1000:.2f}"


def _modulo_barcode(folio: str) -> int:
    """Ancho de modulo (^BY) segun la longitud (y contenido) del folio, para
    que el Code128 no se salga del ancho util de la etiqueta.

    Aproximacion del numero de modulos que ocupa el Code128:
    - Folios solo con digitos: ZPL en modo automatico usa el subset C, que
      codifica pares de digitos en ~11 modulos cada uno (~5.5 modulos/digito).
    - Cualquier otro folio (alfanumerico): subset B, ~11 modulos por caracter.
    En ambos casos se suma ~35 modulos de overhead (start/stop/checksum/quiet).

    Se elige el modulo mas grande entre {3, 2} cuyo ancho estimado quepa en
    el ancho util de la etiqueta. Solo como ultimo recurso (folios
    alfanumericos muy largos, >30 caracteres aprox.) se regresa 1, dejando
    aviso en el log porque un modulo de 1 dot (~0.125mm a 203dpi) es
    practicamente ilegible para escaneres de mano.
    """
    n = len(folio)
    if folio.isdigit():
        modulos_estimados = 11 * (n / 2) + 35
    else:
        modulos_estimados = 11 * n + 35

    ancho_util = ETIQUETA_ANCHO_DOTS - 2 * MARGEN_DOTS
    for modulo in (3, 2):
        if modulo * modulos_estimados <= ancho_util:
            return modulo

    logger.warning(
        "Folio de %d caracteres (modulos estimados %.1f): ni siquiera con "
        "modulo 2 el barcode Code128 cabe en el ancho util de %d dots; se "
        "usara modulo 1, que puede ser dificil de leer con escaner de mano.",
        n, modulos_estimados, ancho_util,
    )
    return 1


def generar_zpl_etiqueta(
    folio: str,
    codigo_producto: str = "",
    docenas: str = "",
    pedido_id: str = "",
    cliente: str = "",
    peso_produccion: str = "",
    fecha: str = "",
    leyenda: str = "",
) -> str:
    """
    Genera el comando ZPL de la etiqueta que se pega al bulto.
    Etiqueta fisica de 10 x 8.2 cm (800 x 656 dots a 203 dpi).

    'peso_produccion' llega en GRAMOS (unidad interna del sistema) y se
    muestra en KG en la etiqueta.

    El texto se mantiene sin acentos a proposito: muchas Zebra usan la
    codepage por defecto de la impresora y no interpretan UTF-8 sin el
    comando ^CI28, que no todos los firmwares soportan.
    """
    folio = _texto_zpl(folio, 50)          # valor completo, va codificado en el barcode
    folio_display = folio[:21]             # texto legible junto al logo (cabe a fuente 40)
    codigo_producto = _texto_zpl(codigo_producto, 28)
    docenas = _texto_zpl(docenas, 8)
    pedido_id = _texto_zpl(pedido_id, 16)
    cliente = _texto_zpl(cliente, 80)      # hasta 2 lineas en el ^FB
    peso_kg = _peso_gramos_a_kg_texto(peso_produccion)
    fecha = _texto_zpl(fecha, 12)
    leyenda = _texto_zpl(leyenda, 20) if leyenda else ""

    x = MARGEN_DOTS
    ancho_util = ETIQUETA_ANCHO_DOTS - 2 * MARGEN_DOTS

    # Logo en la esquina superior derecha (si esta disponible).
    logo = ""
    ancho_titulo = ancho_util
    if _LOGO_ZPL is not None:
        x_logo = ETIQUETA_ANCHO_DOTS - MARGEN_DOTS - LOGO_LADO_DOTS
        logo = f"^FO{x_logo},{MARGEN_DOTS}{_LOGO_ZPL}^FS\n"
        ancho_titulo = ancho_util - LOGO_LADO_DOTS - 20

    modulo = _modulo_barcode(folio)

    # La linea legible del barcode va desactivada (ultimo parametro N):
    # el folio ya se imprime como texto arriba y con folios largos la linea
    # legible se saldria del ancho de la etiqueta.
    encabezado = f"""^XA
^LH0,0
^PW{ETIQUETA_ANCHO_DOTS}
^LL{ETIQUETA_ALTO_DOTS}
{logo}^CF0,52
^FO{x},{MARGEN_DOTS}^FB{ancho_titulo},1,0,L^FDDEPORTIVOS QUINI^FS
^CF0,40
^FO{x},100^FB{ancho_titulo},1,0,L^FDFolio: {folio_display}^FS
^BY{modulo},3,170
^FO{x},185^BCN,170,N,N,N
^FD{folio}^FS
"""
    if leyenda:
        # Con leyenda (ej. VALIDADO) el bloque de datos se compacta para que
        # quepa la linea extra sin salirse de los 656 dots de alto.
        cuerpo = f"""^CF0,28
^FO{x},372^FB{ancho_util},1,0,L^FDCodigo producto: {codigo_producto}^FS
^FO{x},408^FB{ancho_util},1,0,L^FDDocenas: {docenas}    Pedido: {pedido_id}^FS
^FO{x},444^FB{ancho_util},2,0,L^FDCliente: {cliente}^FS
^CF0,34
^FO{x},514^FB{ancho_util},1,0,C^FD*** {leyenda} ***^FS
^CF0,38
^FO{x},554^FB{ancho_util},1,0,L^FDPeso produccion: {peso_kg} kg^FS
^CF0,26
^FO{x},598^FB{ancho_util},1,0,L^FDFecha: {fecha}^FS
^XZ"""
    else:
        cuerpo = f"""^CF0,28
^FO{x},380^FB{ancho_util},1,0,L^FDCodigo producto: {codigo_producto}^FS
^FO{x},418^FB{ancho_util},1,0,L^FDDocenas: {docenas}    Pedido: {pedido_id}^FS
^FO{x},456^FB{ancho_util},2,0,L^FDCliente: {cliente}^FS
^CF0,40
^FO{x},535^FB{ancho_util},1,0,L^FDPeso produccion: {peso_kg} kg^FS
^CF0,28
^FO{x},587^FB{ancho_util},1,0,L^FDFecha: {fecha}^FS
^XZ"""
    return encabezado + cuerpo


def zebra_configurada() -> bool:
    return settings.zebra_configurada


def imprimir_etiqueta(zpl: str) -> dict:
    """
    Envia el comando ZPL a la impresora Zebra por red (puerto 9100 estandar).

    Devuelve {"enviado": bool, "mensaje": str}. Nunca lanza excepcion:
    si la impresora no esta configurada o no responde, se reporta en el mensaje
    para que la vista pueda mostrar el estatus sin tumbar la app.
    """
    if not zebra_configurada():
        logger.info("Impresora Zebra no configurada (ZEBRA_IP vacio). ZPL generado pero no enviado.")
        return {"enviado": False, "mensaje": "Impresora no configurada (ZEBRA_IP vacio en .env)"}

    try:
        with socket.create_connection((settings.ZEBRA_IP, settings.ZEBRA_PORT), timeout=5) as sock:
            sock.sendall(zpl.encode("utf-8"))
        return {"enviado": True, "mensaje": "Etiqueta enviada a la impresora"}
    except Exception as exc:
        logger.warning("Error enviando etiqueta a Zebra %s:%s -> %s", settings.ZEBRA_IP, settings.ZEBRA_PORT, exc)
        return {"enviado": False, "mensaje": f"No se pudo conectar a la impresora: {exc}"}
