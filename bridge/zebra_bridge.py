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
    pip install fastapi uvicorn python-dotenv
    python bridge/zebra_bridge.py

Configuracion via variables de entorno (o .env en la raiz del proyecto):
    ZEBRA_IP=192.168.1.50
    ZEBRA_PORT=9100
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [zebra_bridge] %(message)s")
logger = logging.getLogger("zebra_bridge")

ZEBRA_IP = os.getenv("ZEBRA_IP", "").strip()
ZEBRA_PORT = int(os.getenv("ZEBRA_PORT", "9100"))
BRIDGE_PORT = int(os.getenv("ZEBRA_BRIDGE_PORT", "8002"))

# Dimensiones de la etiqueta en dots (203 dpi, 8 dots/mm). Etiqueta fisica de
# 10 cm x 8.2 cm (800 x 656 dots). Igual que app/zebra_print.py.
ETIQUETA_ANCHO_DOTS = 800
ETIQUETA_ALTO_DOTS = 656
MARGEN_DOTS = 30

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


def _modulo_barcode(folio: str) -> int:
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
        "Folio de %d caracteres: ni con modulo 2 cabe el barcode en %d dots; se usara modulo 1.",
        n, ancho_util,
    )
    return 1


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

    x = MARGEN_DOTS
    ancho_util = ETIQUETA_ANCHO_DOTS - 2 * MARGEN_DOTS

    logo = ""
    ancho_titulo = ancho_util
    if _LOGO_ZPL is not None:
        x_logo = ETIQUETA_ANCHO_DOTS - MARGEN_DOTS - LOGO_LADO_DOTS
        logo = f"^FO{x_logo},{MARGEN_DOTS}{_LOGO_ZPL}^FS\n"
        ancho_titulo = ancho_util - LOGO_LADO_DOTS - 20

    modulo = _modulo_barcode(folio)

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


def zebra_configurada() -> bool:
    return bool(ZEBRA_IP)


def imprimir_etiqueta(zpl: str) -> dict:
    if not zebra_configurada():
        logger.info("Impresora Zebra no configurada (ZEBRA_IP vacio). ZPL generado pero no enviado.")
        return {"enviado": False, "mensaje": "Impresora no configurada (ZEBRA_IP vacio en .env)"}
    try:
        with socket.create_connection((ZEBRA_IP, ZEBRA_PORT), timeout=5) as sock:
            sock.sendall(zpl.encode("utf-8"))
        return {"enviado": True, "mensaje": "Etiqueta enviada a la impresora"}
    except Exception as exc:
        logger.warning("Error enviando etiqueta a Zebra %s:%s -> %s", ZEBRA_IP, ZEBRA_PORT, exc)
        return {"enviado": False, "mensaje": f"No se pudo conectar a la impresora: {exc}"}


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
    docenas: str = ""
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
    zpl = generar_zpl_etiqueta(
        folio=folio,
        codigo_producto=datos.codigo_producto,
        docenas=datos.docenas,
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
    return {"configurada": zebra_configurada(), "ip": ZEBRA_IP or None, "puerto": ZEBRA_PORT}


if __name__ == "__main__":
    logger.info(
        "Iniciando zebra_bridge en puerto %s (impresora en %s:%s)",
        BRIDGE_PORT, ZEBRA_IP or "NO CONFIGURADA", ZEBRA_PORT,
    )
    # 127.0.0.1: solo el navegador de esta misma PC necesita llamar al bridge.
    uvicorn.run(app, host="127.0.0.1", port=BRIDGE_PORT)
