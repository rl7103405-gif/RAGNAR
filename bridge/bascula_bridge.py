"""
bascula_bridge.py

Script INDEPENDIENTE que corre en cada PC que tiene una bascula TORREY EQM-400/800
conectada por USB (puerto serie, normalmente COM3 en Windows).

Expone un endpoint HTTP local:
    GET /peso  ->  {"peso": 1234.5, "unidad": "g", "estable": true, "error": null}

La app principal (servidor central) llama a este endpoint local desde el navegador
de esa misma PC (ej. http://localhost:8001/peso) cuando el operador presiona el
boton de "Capturar peso".

Uso:
    pip install pyserial fastapi uvicorn
    python bascula_bridge.py

Configuracion via variables de entorno (o .env en el mismo folder):
    COM_PORT=COM3
    BAUD_RATE=9600
    BASCULA_BRIDGE_PORT=8001
"""
import logging
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
except ImportError:
    serial = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [bascula_bridge] %(message)s")
logger = logging.getLogger("bascula_bridge")

COM_PORT = os.getenv("COM_PORT", "COM3")
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
BRIDGE_PORT = int(os.getenv("BASCULA_BRIDGE_PORT", "8001"))

# La bascula TORREY normalmente envia lineas como "   1.250 kg" o "ST,+001.25,kg"
PATRON_PESO = re.compile(r"([-+]?\d+\.?\d*)")

app = FastAPI(title="Bascula Bridge - Deportivos Quini")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

estado = {"peso": None, "unidad": "g", "estable": False, "error": "Sin lectura todavia", "ultima_actualizacion": None}
_lock = threading.Lock()


def _parsear_linea(linea: str):
    """Extrae el valor numerico de peso de una linea cruda de la bascula."""
    match = PATRON_PESO.search(linea)
    if not match:
        return None
    valor = float(match.group(1))
    unidad = "kg" if "kg" in linea.lower() else "g"
    # Normalizamos siempre a gramos para que el resto del sistema trabaje en una sola unidad.
    peso_gramos = valor * 1000 if unidad == "kg" else valor
    estable = "us" not in linea.lower()  # muchas basculas mandan "US" (unstable) mientras se mueve la aguja
    return peso_gramos, estable


def _hilo_lectura_serial():
    """Hilo en background que mantiene la conexion serial abierta y actualiza el estado global."""
    while True:
        if serial is None:
            with _lock:
                estado["error"] = "pyserial no esta instalado (pip install pyserial)"
            time.sleep(5)
            continue

        try:
            with serial.Serial(COM_PORT, BAUD_RATE, timeout=2) as puerto:
                logger.info("Conectado a la bascula en %s @ %s baud", COM_PORT, BAUD_RATE)
                with _lock:
                    estado["error"] = None
                while True:
                    linea = puerto.readline().decode(errors="ignore").strip()
                    if not linea:
                        continue
                    resultado = _parsear_linea(linea)
                    if resultado is None:
                        continue
                    peso_gramos, estable = resultado
                    with _lock:
                        estado["peso"] = round(peso_gramos, 1)
                        estado["unidad"] = "g"
                        estado["estable"] = estable
                        estado["error"] = None
                        estado["ultima_actualizacion"] = time.strftime("%Y-%m-%d %H:%M:%S")
        except Exception as exc:
            logger.warning("Error de conexion con la bascula en %s: %s. Reintentando en 5s...", COM_PORT, exc)
            with _lock:
                estado["error"] = f"No se pudo conectar al puerto {COM_PORT}: {exc}"
            time.sleep(5)


@app.get("/peso")
def obtener_peso():
    """Devuelve la ultima lectura de peso conocida."""
    with _lock:
        return dict(estado)


@app.get("/status")
def status():
    with _lock:
        conectado = estado["error"] is None
        return {"conectado": conectado, "puerto": COM_PORT, "baud_rate": BAUD_RATE, **estado}


@app.on_event("startup")
def iniciar_hilo_lectura():
    hilo = threading.Thread(target=_hilo_lectura_serial, daemon=True)
    hilo.start()


if __name__ == "__main__":
    logger.info("Iniciando bascula_bridge en puerto %s (bascula en %s)", BRIDGE_PORT, COM_PORT)
    uvicorn.run(app, host="0.0.0.0", port=BRIDGE_PORT)
