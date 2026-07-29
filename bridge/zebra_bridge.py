"""
zebra_bridge.py

Script INDEPENDIENTE que corre en la PC donde esta conectada la impresora
Zebra (ZT410/ZM400), igual en espiritu que bascula_bridge.py. La app web
(RAGNAR, en Firebase Hosting) no puede abrir un socket TCP directo a la
impresora desde el navegador, asi que este bridge local recibe los datos por
HTTP y hace la conexion de red hacia la Zebra.

Expone un endpoint HTTP local:
    POST /imprimir  {folio, codigo_producto, docenas, pedido_id, cliente,
                      peso_gramos, fecha, leyenda}
                 -> {"enviado": bool, "mensaje": str, "zpl": str}

La generacion del ZPL (plantilla de la etiqueta, logo, barcode) es la misma
logica ya probada en app/zebra_print.py -- se reutiliza tal cual, solo
leyendo ZEBRA_IP/ZEBRA_PORT directo de variables de entorno (no importa
app/config.py para no arrastrar validaciones de arranque de toda la app
principal, que no aplican a este bridge).

Uso:
    pip install fastapi uvicorn python-dotenv pywin32
    python bridge/zebra_bridge.py

Configuracion via variables de entorno (o .env en la raiz del proyecto).
Dos modos, en este orden de prioridad:
  1) Red (la Zebra tiene cable de red propio):
       ZEBRA_IP=192.168.1.50
       ZEBRA_PORT=9100
  2) USB (la Zebra esta conectada por USB a esta PC, instalada como
     impresora de Windows con el driver ZDesigner). Se usa cuando
     ZEBRA_IP esta vacio:
       ZEBRA_PRINTER_NAME=AUTO   (AUTO busca una impresora instalada cuyo
                                  nombre contenga ZDesigner/Zebra; tambien
                                  puede ponerse el nombre exacto)
    ZEBRA_BRIDGE_PORT=8002
"""
import logging
import math
import os
import re
import socket
import unicodedata
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import win32print
except ImportError:
    win32print = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [zebra_bridge] %(message)s")
logger = logging.getLogger("zebra_bridge")

ZEBRA_IP = os.getenv("ZEBRA_IP", "").strip()
ZEBRA_PORT = int(os.getenv("ZEBRA_PORT", "9100"))
ZEBRA_PRINTER_NAME = os.getenv("ZEBRA_PRINTER_NAME", "AUTO").strip()
BRIDGE_PORT = int(os.getenv("ZEBRA_BRIDGE_PORT", "8002"))

# Dimensiones de la etiqueta en dots (203 dpi, 8 dots/mm). Rollo real medido
# por Roberto el 2026-07-28: 10 cm x 8.3 cm = 800 x 664 dots.
ETIQUETA_ANCHO_DOTS = 800
ETIQUETA_ALTO_DOTS = 664
MARGEN_DOTS = 30
# El borde izquierdo del cabezal recorta un poco el primer caracter de cada
# linea (la "D" de DEPORTIVOS, la "F" de Folio...): el contenido arranca unos
# dots mas adentro que el margen derecho. 60 dots = 7.5 mm.
MARGEN_IZQ_DOTS = 60
# Ancho real disponible para el contenido. UNA sola fuente de verdad: la usan
# tanto el layout (^FB de los textos) como _modulo_barcode al elegir el grosor
# de barra. Si cada uno calculara el suyo, el barcode podria elegirse mas
# ancho de lo que cabe y salir pegado al borde derecho.
ANCHO_UTIL_DOTS = ETIQUETA_ANCHO_DOTS - MARGEN_IZQ_DOTS - MARGEN_DOTS

_RUTA_LOGO = Path(__file__).parent.parent / "app" / "static" / "logo_quini.zpl"
_PATRON_GFA = re.compile(r"^\^GFA,(\d+),(\d+),(\d+),([0-9A-Fa-f]+)$")
LOGO_LADO_DOTS = 144


def _cargar_logo_zpl():
    try:
        contenido = _RUTA_LOGO.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        logger.warning("Logo no encontrado en %s: las etiquetas saldran SIN logo.", _RUTA_LOGO)
        return None
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning("No se pudo leer el logo (%s): etiquetas sin logo. %s", _RUTA_LOGO, exc)
        return None

    match = _PATRON_GFA.match(contenido)
    if not match:
        logger.warning("El archivo del logo %s no tiene formato ^GFA valido: etiquetas sin logo.", _RUTA_LOGO)
        return None
    total, total2, por_fila, hexdata = int(match.group(1)), int(match.group(2)), int(match.group(3)), match.group(4)
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


def _texto_zpl(valor: str, maximo: int = 100) -> str:
    texto = unicodedata.normalize("NFKD", str(valor or ""))
    texto = texto.encode("ascii", errors="ignore").decode("ascii")
    texto = " ".join(texto.replace("^", " ").replace("~", " ").split())
    return texto[:maximo] or "-"


def _peso_gramos_a_kg_texto(peso_gramos) -> str:
    try:
        gramos = float(peso_gramos)
    except (TypeError, ValueError):
        return "-"
    if not math.isfinite(gramos) or gramos < 0:
        return "-"
    return f"{gramos / 1000:.2f}"


# Zona de silencio de Code128: 10 modulos de "quiet zone" a cada lado del
# barcode (20 en total). Se usa TANTO al elegir el modulo como al calcular
# el ancho real del barcode para centrarlo (x_barcode).
_ZONA_SILENCIO_MODULOS = 20


def _modulos_code128(folio: str) -> int:
    """Modulos estimados de datos+overhead (start+check+stop) de un barcode
    Code128 para este folio, SIN zonas de silencio. Subset C (2 digitos por
    modulo, 11 modulos por par) para folios puramente numericos; subset B
    (11 modulos por caracter, +1 shift si el numero de digitos es impar)
    para folios alfanumericos. Unificada aqui para que _modulo_barcode
    (elegir modulo 3/2/1) y el centrado del barcode (x_barcode) usen
    EXACTAMENTE la misma aritmetica -- antes cada uno la calculaba por su
    cuenta con formulas ligeramente distintas.
    """
    n = len(folio)
    if folio.isdigit():
        if n % 2 == 0:
            return 11 * (n // 2) + 35
        return 11 * ((n + 1) // 2) + 11 + 35  # un shift extra por el digito suelto
    return 11 * n + 35


def _modulo_barcode(folio: str) -> tuple[int, bool]:
    """Elige el modulo (grosor de barra) 3/2/1 mas grande que quepa en el
    ancho util de la etiqueta, incluyendo zonas de silencio. Devuelve
    (modulo, cabe): cabe=False si ni siquiera modulo 1 alcanza (se usa
    modulo 1 de todos modos, con posible recorte)."""
    modulos = _modulos_code128(folio)
    ancho_util = ANCHO_UTIL_DOTS
    for modulo in (3, 2, 1):
        if modulo * (modulos + _ZONA_SILENCIO_MODULOS) <= ancho_util:
            return modulo, True

    logger.warning(
        "Folio de %d caracteres: ni con modulo 1 cabe el barcode en %d dots; "
        "se usara modulo 1 de todos modos (posible recorte).",
        len(folio), ancho_util,
    )
    return 1, False


def generar_zpl_etiqueta(
    folio: str,
    codigo_producto: str = "",
    docenas: str = "",
    pedido_id: str = "",
    cliente: str = "",
    peso_gramos: str = "",
    fecha: str = "",
    leyenda: str = "",
) -> str:
    folio = _texto_zpl(folio, 50)
    folio_display = folio[:21]
    codigo_producto = _texto_zpl(codigo_producto, 28)
    docenas = _texto_zpl(docenas, 8)
    pedido_id = _texto_zpl(pedido_id, 16)
    cliente = _texto_zpl(cliente, 80)
    peso_kg = _peso_gramos_a_kg_texto(peso_gramos)
    fecha = _texto_zpl(fecha, 12)
    leyenda = _texto_zpl(leyenda, 20) if leyenda else ""

    # Layout ORIGINAL alineado a la izquierda (logo arriba a la derecha).
    # El rediseño centrado quedo EN PAUSA: el rollo real de etiquetas de la
    # planta es mas chico que los 10 x 8.2 cm asumidos y el contenido salia
    # cortado; en cuanto Roberto pase la medida real se rehace el layout a
    # ese tamano (probablemente compacto), centrado y completo.
    x = MARGEN_IZQ_DOTS
    ancho_util = ANCHO_UTIL_DOTS

    logo = ""
    ancho_titulo = ancho_util
    if _LOGO_ZPL is not None:
        x_logo = ETIQUETA_ANCHO_DOTS - MARGEN_DOTS - LOGO_LADO_DOTS
        logo = f"^FO{x_logo},{MARGEN_DOTS}{_LOGO_ZPL}^FS\n"
        ancho_titulo = ancho_util - LOGO_LADO_DOTS - 20

    modulo, _cabe = _modulo_barcode(folio)

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
        cuerpo = f"""^CF0,28
^FO{x},372^FB{ancho_util},1,0,L^FDCodigo producto: {codigo_producto}^FS
^FO{x},408^FB{ancho_util},1,0,L^FDDocenas: {docenas}    Pedido: {pedido_id}^FS
^FO{x},444^FB{ancho_util},2,0,L^FDCliente: {cliente}^FS
^CF0,34
^FO{x},514^FB{ancho_util},1,0,C^FD*** {leyenda} ***^FS
^CF0,38
^FO{x},554^FB{ancho_util},1,0,L^FDPeso: {peso_kg} kg^FS
^CF0,26
^FO{x},598^FB{ancho_util},1,0,L^FDFecha: {fecha}^FS
^XZ"""
    else:
        cuerpo = f"""^CF0,28
^FO{x},380^FB{ancho_util},1,0,L^FDCodigo producto: {codigo_producto}^FS
^FO{x},418^FB{ancho_util},1,0,L^FDDocenas: {docenas}    Pedido: {pedido_id}^FS
^FO{x},456^FB{ancho_util},2,0,L^FDCliente: {cliente}^FS
^CF0,40
^FO{x},535^FB{ancho_util},1,0,L^FDPeso: {peso_kg} kg^FS
^CF0,28
^FO{x},587^FB{ancho_util},1,0,L^FDFecha: {fecha}^FS
^XZ"""
    return encabezado + cuerpo


def _buscar_impresora_windows() -> str | None:
    """Nombre de la impresora Zebra instalada en Windows, o None.

    Con ZEBRA_PRINTER_NAME=AUTO se busca una cuyo nombre contenga
    ZDesigner/Zebra (asi la instala el driver oficial); si se configuro un
    nombre exacto, se verifica que exista tal cual.
    """
    if win32print is None:
        return None
    try:
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        nombres = [imp[2] for imp in win32print.EnumPrinters(flags)]
    except Exception as exc:
        logger.warning("No se pudieron enumerar las impresoras de Windows: %s", exc)
        return None
    if ZEBRA_PRINTER_NAME.upper() != "AUTO":
        return ZEBRA_PRINTER_NAME if ZEBRA_PRINTER_NAME in nombres else None
    for nombre in nombres:
        if "ZDESIGNER" in nombre.upper() or "ZEBRA" in nombre.upper():
            return nombre
    return None


def zebra_configurada() -> bool:
    return bool(ZEBRA_IP) or _buscar_impresora_windows() is not None


def _imprimir_via_red(zpl: str) -> dict:
    try:
        with socket.create_connection((ZEBRA_IP, ZEBRA_PORT), timeout=5) as sock:
            sock.sendall(zpl.encode("utf-8"))
        return {"enviado": True, "mensaje": "Etiqueta enviada a la impresora"}
    except Exception as exc:
        logger.warning("Error enviando etiqueta a Zebra %s:%s -> %s", ZEBRA_IP, ZEBRA_PORT, exc)
        return {"enviado": False, "mensaje": f"No se pudo conectar a la impresora: {exc}"}


# Banderas de PRINTER_INFO_2.Status (WinSpool.h) que indican que la
# etiqueta quedo en cola pero probablemente NO salio fisicamente. Se leen
# con getattr por si una version vieja de pywin32 no las expone; el valor
# de respaldo es el documentado por Microsoft para esa constante.
_BANDERAS_PROBLEMA_IMPRESORA = [
    (getattr(win32print, "PRINTER_STATUS_OFFLINE", 0x00000080), "esta fuera de linea"),
    (getattr(win32print, "PRINTER_STATUS_PAUSED", 0x00000001), "esta en pausa"),
    (getattr(win32print, "PRINTER_STATUS_ERROR", 0x00000002), "reporta un error"),
    (getattr(win32print, "PRINTER_STATUS_PAPER_OUT", 0x00000010), "sin papel"),
    (getattr(win32print, "PRINTER_STATUS_PAPER_JAM", 0x00000008), "papel atascado"),
    (getattr(win32print, "PRINTER_STATUS_NOT_AVAILABLE", 0x00001000), "no esta disponible"),
]


def _problemas_impresora(h, nombre_impresora: str) -> list[str]:
    """Lista en espanol de problemas que reporta la impresora, o [] si
    ninguna bandera conocida esta prendida (o no se pudo consultar)."""
    try:
        status = win32print.GetPrinter(h, 2)["Status"]
    except Exception as exc:
        logger.warning("No se pudo consultar el estado de '%s': %s", nombre_impresora, exc)
        return []
    return [texto for bandera, texto in _BANDERAS_PROBLEMA_IMPRESORA if status & bandera]


def _imprimir_via_windows(zpl: str, nombre_impresora: str) -> dict:
    """Manda el ZPL crudo (datatype RAW) a la cola de impresion de Windows.

    Es la via correcta para una Zebra conectada por USB: el driver ZDesigner
    pasa los bytes RAW directo a la impresora sin reinterpretarlos.
    """
    try:
        h = win32print.OpenPrinter(nombre_impresora)
    except Exception as exc:
        logger.warning("No se pudo abrir la impresora '%s': %s", nombre_impresora, exc)
        return {"enviado": False, "mensaje": f"No se pudo abrir la impresora '{nombre_impresora}': {exc}"}
    try:
        datos_bytes = zpl.encode("utf-8")
        escritos = None
        win32print.StartDocPrinter(h, 1, ("Etiqueta RAGNAR", None, "RAW"))
        try:
            win32print.StartPagePrinter(h)
            escritos = win32print.WritePrinter(h, datos_bytes)
            win32print.EndPagePrinter(h)
        finally:
            win32print.EndDocPrinter(h)
        if escritos != len(datos_bytes):
            logger.warning(
                "Escritura parcial al spooler en '%s': %s/%s bytes",
                nombre_impresora, escritos, len(datos_bytes),
            )
            return {
                "enviado": False,
                "mensaje": "Escritura parcial al spooler; NO salio la etiqueta, reintenta.",
            }
        problemas = _problemas_impresora(h, nombre_impresora)
        if problemas:
            return {
                "enviado": True,
                "mensaje": (
                    f"Etiqueta EN COLA, pero la impresora reporta: {', '.join(problemas)}. "
                    "Revisa la impresora."
                ),
            }
        return {"enviado": True, "mensaje": f"Etiqueta enviada a la impresora ({nombre_impresora})"}
    except Exception as exc:
        logger.warning("Error imprimiendo en '%s': %s", nombre_impresora, exc)
        return {"enviado": False, "mensaje": f"Error imprimiendo en '{nombre_impresora}': {exc}"}
    finally:
        win32print.ClosePrinter(h)


def imprimir_etiqueta(zpl: str) -> dict:
    if ZEBRA_IP:
        return _imprimir_via_red(zpl)
    nombre = _buscar_impresora_windows()
    if nombre is not None:
        return _imprimir_via_windows(zpl, nombre)
    logger.info("Impresora Zebra no configurada (sin ZEBRA_IP y sin impresora USB detectada).")
    return {
        "enviado": False,
        "mensaje": (
            "No se encontro la impresora: configura ZEBRA_IP en .env (Zebra de red) "
            "o conecta/instala la Zebra por USB (driver ZDesigner)"
        )
    }


# ---- API HTTP local ----

app = FastAPI(title="Zebra Bridge - Deportivos Quini")

# Origenes permitidos: la app de RAGNAR en Firebase Hosting y el servidor de
# desarrollo local de Vite. Solo esas paginas legitimamente necesitan pedirle
# a esta PC que imprima.
_ORIGENES_PERMITIDOS = [
    "https://quini-ragnar.web.app",
    "https://quini-ragnar.firebaseapp.com",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGENES_PERMITIDOS,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):5173$",
    allow_methods=["POST"],
    allow_headers=["*"],
)


class SolicitudImpresion(BaseModel):
    folio: str
    codigo_producto: str = ""
    # docenas llega como numero (JS number) desde el cruce con el Excel del
    # dia; igual que peso_gramos, Pydantic v2 no coerciona int/float a str.
    docenas: float | int | str = ""
    pedido_id: str = ""
    cliente: str = ""
    # El cliente web manda peso_gramos como numero (JS number). Con Pydantic
    # v2 no hay coercion automatica de int/float a str, asi que hay que
    # aceptar los tres tipos aqui (antes solo "str" y el endpoint devolvia
    # 422 con cualquier peso real).
    peso_gramos: float | int | str = ""
    fecha: str = ""
    leyenda: str = ""


@app.post("/imprimir")
def imprimir(datos: SolicitudImpresion):
    folio = (datos.folio or "").strip()
    if not folio:
        raise HTTPException(status_code=400, detail="Folio vacio")
    peso_gramos_texto = str(datos.peso_gramos) if datos.peso_gramos != "" else ""
    # Docenas numericas se imprimen sin decimales inutiles (22.0 -> "22").
    docenas_texto = datos.docenas
    if isinstance(docenas_texto, (int, float)) and not isinstance(docenas_texto, bool):
        docenas_texto = (
            str(int(docenas_texto)) if float(docenas_texto).is_integer() else str(docenas_texto)
        )
    zpl = generar_zpl_etiqueta(
        folio=folio,
        codigo_producto=datos.codigo_producto,
        docenas=docenas_texto,
        pedido_id=datos.pedido_id,
        cliente=datos.cliente,
        peso_gramos=peso_gramos_texto,
        fecha=datos.fecha,
        leyenda=datos.leyenda,
    )
    resultado = imprimir_etiqueta(zpl)
    return {**resultado, "zpl": zpl}


@app.get("/status")
def status():
    impresora_usb = None if ZEBRA_IP else _buscar_impresora_windows()
    return {
        "configurada": zebra_configurada(),
        "modo": "red" if ZEBRA_IP else ("usb" if impresora_usb else None),
        "ip": ZEBRA_IP or None,
        "puerto": ZEBRA_PORT,
        "impresora_windows": impresora_usb,
    }


if __name__ == "__main__":
    if ZEBRA_IP:
        destino = f"red {ZEBRA_IP}:{ZEBRA_PORT}"
    else:
        impresora = _buscar_impresora_windows()
        destino = f"USB '{impresora}'" if impresora else "NO CONFIGURADA"
    logger.info("Iniciando zebra_bridge en puerto %s (impresora: %s)", BRIDGE_PORT, destino)
    # 127.0.0.1: solo el navegador de esta misma PC necesita llamar al bridge.
    uvicorn.run(app, host="127.0.0.1", port=BRIDGE_PORT)
