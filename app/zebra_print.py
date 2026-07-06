"""
Generacion e impresion de etiquetas ZPL para la Zebra ZM400.

La IP/puerto de la impresora se configuran en .env (ZEBRA_IP, ZEBRA_PORT).
Mientras ZEBRA_IP este vacio, imprimir_etiqueta() no intenta conectarse
y solo devuelve el ZPL generado (modo "impresora no configurada").
"""
import logging
import socket

from app.config import settings

logger = logging.getLogger("zebra_print")


def generar_zpl_etiqueta(
    folio: str,
    codigo_producto: str = "",
    docenas: str = "",
    pedido_id: str = "",
    cliente: str = "",
    peso_produccion: str = "",
    fecha: str = "",
) -> str:
    """
    Genera el comando ZPL de la etiqueta que se pega al bulto.

    El texto se mantiene sin acentos a proposito: muchas Zebra mas antiguas
    (como la ZM400) usan la codepage por defecto de la impresora y no
    interpretan UTF-8 sin el comando ^CI28, que no todos los firmwares
    soportan. Usar solo ASCII evita imprimir caracteres corruptos en el
    bulto fisico hasta poder confirmar el soporte de la impresora real.
    """
    codigo_producto = codigo_producto or "-"
    docenas = docenas or "-"
    pedido_id = pedido_id or "-"
    cliente = cliente or "-"
    peso_produccion = peso_produccion or "-"
    fecha = fecha or "-"

    zpl = f"""^XA
^CF0,30
^FO30,20^FDDEPORTIVOS QUINI^FS
^CF0,25
^FO30,60^FDFolio: {folio}^FS
^BY2,3,60
^FO30,95^BCN,60,Y,N,N
^FD{folio}^FS
^CF0,22
^FO30,180^FDProducto: {codigo_producto}^FS
^FO30,210^FDDocenas: {docenas}^FS
^FO30,240^FDPedido: {pedido_id}^FS
^FO30,270^FDCliente: {cliente}^FS
^FO30,300^FDPeso produccion: {peso_produccion} g^FS
^FO30,330^FDFecha: {fecha}^FS
^XZ"""
    return zpl


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
