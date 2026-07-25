"""
bascula_bridge.py

Script INDEPENDIENTE que corre en cada PC que tiene una bascula TORREY EQM-400/800
conectada por USB (puerto serie, normalmente COM3 en Windows).

Expone un endpoint HTTP local:
    GET /peso  ->  {"peso": 1234.5, "unidad": "g", "estable": true, "error": null, "vigente": true}

La app principal (servidor central) llama a este endpoint local desde el navegador
de esa misma PC (ej. http://localhost:8001/peso) cuando el operador presiona el
boton de "Capturar peso".

Protocolo con la bascula: la TORREY EQM no transmite el peso por su cuenta, hay
que pedirselo mandando el comando ASCII 'P' por el puerto serie (protocolo de
pregunta-respuesta estandar en la familia TORREY EQ/EQM). Este script lo hace
automaticamente, aproximadamente una vez por segundo, mientras el hilo de
lectura esta activo -- no requiere presionar ningun boton en la bascula.

Uso:
    pip install pyserial fastapi uvicorn
    python bascula_bridge.py

Configuracion via variables de entorno (o .env en el mismo folder):
    COM_PORT=COM3   (o COM_PORT=AUTO para que el bridge busque solo el puerto correcto,
                     util porque Windows puede asignarle un numero de COM distinto cada
                     vez que se conecta el cable USB en un puerto fisico diferente)
    BAUD_RATE=9600
    BASCULA_BRIDGE_PORT=8001
"""
import logging
import math
import os
import re
import threading
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None
    list_ports = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [bascula_bridge] %(message)s")
logger = logging.getLogger("bascula_bridge")

COM_PORT_CONFIG = os.getenv("COM_PORT", "COM3")
AUTO_DETECT = COM_PORT_CONFIG.strip().upper() == "AUTO"
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
BRIDGE_PORT = int(os.getenv("BASCULA_BRIDGE_PORT", "8001"))
# Puerto donde corre la app principal (app/config.py: APP_PORT): es la unica
# que legitimamente llama a este bridge desde el navegador de esta PC.
APP_PORT = int(os.getenv("APP_PORT", "8000"))

# En modo AUTO_DETECT, cuanto tiempo se prueban en paralelo todos los puertos
# candidatos (mandando el comando de solicitud de peso a cada uno) antes de
# darlos por no-bascula y reintentar el ciclo completo.
TIEMPO_PRUEBA_AUTO_SEGUNDOS = 15

# La bascula TORREY normalmente envia lineas como "   1.250 kg" o "ST,+001.25,kg"
PATRON_PESO = re.compile(r"([-+]?\d+\.?\d*)")

# Varias basculas TORREY (familia EQ/EQM) usan un protocolo de pregunta-respuesta:
# no transmiten nada por su cuenta, hay que mandarles el comando 'P' para que
# respondan con el peso actual. Se manda antes de cada lectura; si la bascula
# en uso SI transmite sola (push), este comando extra no le afecta.
COMANDO_SOLICITUD_PESO = b"P\r\n"


# Rango fisicamente plausible para un bulto de calcetines/producto textil.
# Se usa solo como validacion barata durante la busqueda automatica de puerto
# (mismo orden de magnitud que PESO_MAX_GRAMOS en .env.example de la app
# principal; este script es independiente y no importa esa configuracion).
PESO_MIN_GRAMOS_VALIDO = 0
PESO_MAX_GRAMOS_VALIDO = 100000

# Cadencia de solicitud de peso: aunque la bascula responda mas rapido, no
# mandamos el comando 'P' mas de una vez por segundo aproximadamente.
INTERVALO_SOLICITUD_SEGUNDOS = 1


def _solicitar_peso(conexion) -> None:
    # Si falla la escritura, la conexión dejó de ser confiable. Propagar el
    # error permite que el hilo cierre el puerto y ejecute su reconexión normal.
    conexion.write(COMANDO_SOLICITUD_PESO)

app = FastAPI(title="Bascula Bridge - Deportivos Quini")
# CORS restringido al origen real que sirve la app principal: la pagina que
# el operador tiene abierta (http://localhost:<APP_PORT> o la IP de la LAN
# del servidor central en ese mismo puerto) es la unica que legitimamente
# necesita llamar a este bridge desde el navegador de esta PC.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=rf"^http://(localhost|127\.0\.0\.1|(\d{{1,3}}\.){{3}}\d{{1,3}}):{APP_PORT}$",
    allow_methods=["GET"],
    allow_headers=["*"],
)

estado = {
    "peso": None,
    "unidad": "g",
    "estable": False,
    "error": "Sin lectura todavia",
    "ultima_actualizacion": None,
    "ultima_actualizacion_ts": None,
    "puerto_detectado": None if AUTO_DETECT else COM_PORT_CONFIG,
}
_lock = threading.Lock()

# El hilo de lectura pide el peso (comando 'P') aproximadamente una vez por segundo.
# Si la ultima lectura valida ya tiene mas de este tiempo, algo se estanco (bascula
# desconectada a medias, puerto colgado) y no debe mostrarse como si fuera vigente.
TIEMPO_VIGENCIA_SEGUNDOS = 5


def _parsear_linea(linea: str):
    """Extrae el valor numerico de peso de una linea cruda de la bascula."""
    match = PATRON_PESO.search(linea)
    if not match:
        return None
    valor = float(match.group(1))
    if not math.isfinite(valor):
        return None
    unidad = "kg" if "kg" in linea.lower() else "g"
    # Normalizamos siempre a gramos para que el resto del sistema trabaje en una sola unidad.
    peso_gramos = valor * 1000 if unidad == "kg" else valor
    estable = "us" not in linea.lower()  # muchas basculas mandan "US" (unstable) mientras se mueve la aguja
    return peso_gramos, estable


def _puertos_candidatos() -> list[str]:
    """Puertos a probar: el fijo de .env, o todos los detectados por Windows en modo AUTO."""
    if not AUTO_DETECT:
        return [COM_PORT_CONFIG]
    return [p.device for p in list_ports.comports()]


def _leer_puerto(puerto: str) -> None:
    """Abre 'puerto' (ya confirmado) y lee lineas indefinidamente mientras responda.

    Se usa en modo COM_PORT fijo (se confia desde la primera lectura) y en modo
    AUTO una vez que ya se determino, via '_probar_puerto_auto', cual de los
    candidatos es la bascula real. Nunca retorna normalmente: cuando el puerto
    falla (bascula desconectada), la excepcion se propaga al caller.
    """
    with serial.Serial(puerto, BAUD_RATE, timeout=1) as conexion:
        logger.info("Conectado a la bascula en %s @ %s baud", puerto, BAUD_RATE)
        with _lock:
            # Nunca conservar como vigente el peso del bulto anterior durante
            # una reconexión rápida, aunque todavía no hayan pasado 5 segundos.
            estado["peso"] = None
            estado["estable"] = False
            estado["error"] = None
            estado["ultima_actualizacion"] = None
            estado["ultima_actualizacion_ts"] = None
            estado["puerto_detectado"] = puerto
        while True:
            _solicitar_peso(conexion)
            linea = conexion.readline().decode(errors="ignore").strip()
            resultado = _parsear_linea(linea) if linea else None
            # Mismo filtro de rango fisicamente plausible que usa la busqueda
            # automatica de puerto (_probar_puerto_auto): sin esto, en modo
            # COM fijo cualquier ruido serial que parseara como numero se
            # registraba como si fuera un peso real.
            if resultado is not None and not (
                PESO_MIN_GRAMOS_VALIDO <= resultado[0] <= PESO_MAX_GRAMOS_VALIDO
            ):
                resultado = None
            if resultado is None:
                time.sleep(INTERVALO_SOLICITUD_SEGUNDOS)
                continue
            peso_gramos, estable = resultado
            with _lock:
                estado["peso"] = round(peso_gramos, 1)
                estado["unidad"] = "g"
                estado["estable"] = estable
                estado["error"] = None
                estado["ultima_actualizacion"] = time.strftime("%Y-%m-%d %H:%M:%S")
                estado["ultima_actualizacion_ts"] = time.monotonic()
            time.sleep(INTERVALO_SOLICITUD_SEGUNDOS)


def _probar_puerto_auto(puerto: str, detener: threading.Event, resultado: dict, resultado_lock: threading.Lock) -> None:
    """Prueba un puerto candidato en modo AUTO, en paralelo con los demas.

    Exige 2 lecturas validas consecutivas (via '_parsear_linea', y dentro del
    rango fisicamente plausible PESO_MIN_GRAMOS_VALIDO..PESO_MAX_GRAMOS_VALIDO)
    antes de dar por confirmado que 'puerto' es la bascula real, para no
    confundir con un dispositivo Bluetooth u otro puerto serie que responda al
    comando 'P' con basura que por casualidad parsea como un numero. Si
    confirma, guarda el puerto ganador en 'resultado' (bajo
    'resultado_lock') y activa 'detener' para que los demas hilos de prueba
    dejen de intentar. Retorna sin hacer nada si 'detener' ya esta activo
    (otro puerto ya gano) o si se acaba TIEMPO_PRUEBA_AUTO_SEGUNDOS sin
    confirmar.
    """
    limite = time.monotonic() + TIEMPO_PRUEBA_AUTO_SEGUNDOS
    lecturas_validas_consecutivas = 0
    try:
        with serial.Serial(puerto, BAUD_RATE, timeout=1) as conexion:
            while time.monotonic() < limite and not detener.is_set():
                _solicitar_peso(conexion)
                linea = conexion.readline().decode(errors="ignore").strip()
                resultado_parseo = _parsear_linea(linea) if linea else None
                if resultado_parseo is None or not (
                    PESO_MIN_GRAMOS_VALIDO <= resultado_parseo[0] <= PESO_MAX_GRAMOS_VALIDO
                ):
                    lecturas_validas_consecutivas = 0
                    time.sleep(INTERVALO_SOLICITUD_SEGUNDOS)
                    continue
                lecturas_validas_consecutivas += 1
                if lecturas_validas_consecutivas >= 2:
                    with resultado_lock:
                        if resultado["puerto"] is None:
                            resultado["puerto"] = puerto
                    detener.set()
                    return
                time.sleep(INTERVALO_SOLICITUD_SEGUNDOS)
    except Exception as exc:
        logger.info("Puerto %s no disponible durante la busqueda automatica: %s", puerto, exc)


def _hilo_lectura_serial():
    """Hilo en background que mantiene la conexion serial abierta y actualiza el estado global."""
    while True:
        if serial is None:
            with _lock:
                estado["error"] = "pyserial no esta instalado (pip install pyserial)"
            time.sleep(5)
            continue

        try:
            candidatos = _puertos_candidatos()
        except Exception as exc:
            logger.warning("No se pudieron enumerar los puertos serie: %s", exc)
            with _lock:
                estado["error"] = "No se pudieron enumerar los puertos serie disponibles."
            time.sleep(5)
            continue
        if not candidatos:
            with _lock:
                estado["error"] = "No se detecto ningun puerto serie disponible en esta PC."
            time.sleep(5)
            continue

        if not AUTO_DETECT:
            try:
                _leer_puerto(COM_PORT_CONFIG)
            except Exception as exc:
                logger.warning("Puerto %s no disponible o se desconecto: %s", COM_PORT_CONFIG, exc)
            mensaje = f"No se pudo conectar al puerto {COM_PORT_CONFIG}."
            with _lock:
                estado["error"] = mensaje
            logger.warning("%s Reintentando en 5s...", mensaje)
            time.sleep(5)
            continue

        # Modo AUTO: probar todos los candidatos EN PARALELO (un hilo por puerto),
        # mandando el comando de solicitud de peso ('P') y escuchando la respuesta
        # simultaneamente durante TIEMPO_PRUEBA_AUTO_SEGUNDOS. No requiere que el
        # operador haga nada en la bascula, sin importar cual de los puertos
        # resulte ser la bascula real.
        with _lock:
            estado["error"] = (
                f"Buscando la bascula en los puertos: {', '.join(candidatos)}. "
                f"Verifica que este encendida."
            )
        detener = threading.Event()
        resultado = {"puerto": None}
        resultado_lock = threading.Lock()
        hilos = [
            threading.Thread(
                target=_probar_puerto_auto,
                args=(puerto, detener, resultado, resultado_lock),
                daemon=True,
            )
            for puerto in candidatos
        ]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=TIEMPO_PRUEBA_AUTO_SEGUNDOS + 2)

        with resultado_lock:
            puerto_encontrado = resultado["puerto"]

        if puerto_encontrado is None:
            mensaje = (
                f"No se encontro una bascula respondiendo en ningun puerto serie "
                f"({', '.join(candidatos)}). Verifica el cable/USB y que este encendida."
            )
            with _lock:
                estado["error"] = mensaje
                estado["puerto_detectado"] = None
            logger.warning("%s Reintentando en 5s...", mensaje)
            time.sleep(5)
            continue

        try:
            _leer_puerto(puerto_encontrado)
        except Exception as exc:
            logger.warning("Puerto %s (bascula confirmada) se desconecto: %s", puerto_encontrado, exc)
            with _lock:
                estado["error"] = "Bascula desconectada, reintentando..."
                estado["puerto_detectado"] = None


@app.get("/peso")
def obtener_peso():
    """Devuelve la ultima lectura de peso conocida."""
    with _lock:
        resultado = dict(estado)
    ts = resultado.pop("ultima_actualizacion_ts", None)
    # El bridge pide el peso activamente (comando 'P') aproximadamente una vez por
    # segundo, pero aun asi una lectura vieja puede pertenecer a un bulto distinto
    # al que esta ahora sobre la bascula (ej. si el hilo de lectura se detuvo).
    # "vigente" le indica al frontend si puede confiar en ella.
    resultado["vigente"] = ts is not None and (time.monotonic() - ts) <= TIEMPO_VIGENCIA_SEGUNDOS
    return resultado


@app.get("/status")
def status():
    with _lock:
        conectado = estado["error"] is None
        return {
            "conectado": conectado,
            "modo_puerto": "auto" if AUTO_DETECT else "fijo",
            "baud_rate": BAUD_RATE,
            **estado,
        }


@app.on_event("startup")
def iniciar_hilo_lectura():
    hilo = threading.Thread(target=_hilo_lectura_serial, daemon=True)
    hilo.start()


if __name__ == "__main__":
    logger.info(
        "Iniciando bascula_bridge en puerto %s (bascula en %s)",
        BRIDGE_PORT,
        "deteccion automatica" if AUTO_DETECT else COM_PORT_CONFIG,
    )
    # 127.0.0.1: la pagina web de esta misma PC es la unica que necesita leer
    # la bascula; no se expone el puerto al resto de la red.
    uvicorn.run(app, host="127.0.0.1", port=BRIDGE_PORT)
