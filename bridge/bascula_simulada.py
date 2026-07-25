"""
Bascula SIMULADA para probar el sistema sin la bascula fisica.

Se comporta exactamente igual que bascula_bridge.py (mismo endpoint
GET /peso en el puerto 8001) pero devuelve un peso aleatorio realista
en lugar de leer el puerto COM3.

Uso:
    python bascula_simulada.py

Cuando llegue la bascula real, usar bascula_bridge.py en su lugar.
"""
import random
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(title="Bascula SIMULADA - Deportivos Quini")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Peso base simulado: un bulto tipico de ~1.5 kg con variacion pequena
PESO_BASE = 1500.0


@app.get("/peso")
def obtener_peso():
    peso = round(PESO_BASE + random.uniform(-8, 8), 1)
    # "vigente": True porque esta simulacion siempre genera una lectura fresca en cada
    # llamada (igual que la bascula real, que ahora se consulta activamente con el
    # comando 'P' aproximadamente una vez por segundo). Mantiene el mismo contrato de respuesta.
    return {
        "peso": peso,
        "unidad": "g",
        "estable": True,
        "error": None,
        "vigente": True,
        "ultima_actualizacion": time.strftime("%Y-%m-%d %H:%M:%S"),
        "puerto_detectado": "SIMULADO",
    }


@app.get("/status")
def status():
    return {"conectado": True, "modo": "SIMULADO", "puerto": "N/A"}


if __name__ == "__main__":
    print("=" * 50)
    print("BASCULA SIMULADA corriendo en el puerto 8001")
    print("Devuelve pesos aleatorios de ~1500 g para pruebas.")
    print("Cuando llegue la bascula real usa bascula_bridge.py")
    print("=" * 50)
    uvicorn.run(app, host="127.0.0.1", port=8001)
