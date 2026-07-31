"""
lanzador.py

Arranca los DOS puentes locales (bascula y Zebra) en un solo proceso, para
poder empaquetarlos como UN ejecutable que se instala con doble clic en la PC
del modulo, sin necesidad de tener Python.

Cada puente corre su propio servidor uvicorn en un hilo:
    bascula -> http://localhost:8001
    zebra   -> http://localhost:8002

La ventana queda abierta mostrando el estado; cerrarla apaga los dos puentes
(y con ellos la lectura de peso y la impresion de etiquetas).
"""
import sys
import threading
import time
from pathlib import Path

# Al correr como script suelto (no empaquetado) hay que poder importar los
# modulos hermanos de esta carpeta.
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).parent))

import uvicorn  # noqa: E402

import bascula_bridge  # noqa: E402
import zebra_bridge  # noqa: E402


def _correr(app, puerto, nombre):
    try:
        uvicorn.run(app, host="127.0.0.1", port=puerto, log_level="warning")
    except Exception as exc:  # pragma: no cover - salvaguarda de arranque
        print(f"  [{nombre}] se detuvo: {exc}")


def calibrar():
    """Le reensena a la Zebra el tamano real del rollo y recalibra su sensor."""
    import calibrar_zebra

    print("=" * 62)
    print("  RAGNAR - Calibrar la impresora Zebra")
    print("=" * 62)
    print()
    alto_cm = zebra_bridge.ETIQUETA_ALTO_DOTS / 80
    ancho_cm = zebra_bridge.ETIQUETA_ANCHO_DOTS / 80
    print(f"  Configurando para etiquetas de {ancho_cm:.1f} x {alto_cm:.1f} cm")
    resultado = zebra_bridge.imprimir_etiqueta(calibrar_zebra.ZPL_CALIBRACION)
    print(f"  {resultado['mensaje']}")
    print()
    print("  La impresora va a sacar 2-3 etiquetas EN BLANCO: es normal,")
    print("  las esta midiendo. Cuando termine, corre 'Comprobar etiqueta'.")
    print()
    input("  Presiona ENTER para cerrar...")


def comprobar():
    """Imprime la regla de diagnostico para ver el area util real."""
    import diagnostico_etiqueta

    print("=" * 62)
    print("  RAGNAR - Comprobar el area de impresion")
    print("=" * 62)
    print()
    resultado = zebra_bridge.imprimir_etiqueta(diagnostico_etiqueta.zpl_regla())
    print(f"  {resultado['mensaje']}")
    print()
    print(f"  La regla debe llegar hasta y={zebra_bridge.ETIQUETA_ALTO_DOTS - 60}")
    print("  y el marco verse COMPLETO, todo en UNA sola etiqueta.")
    print("  Si sale cortada, corre primero 'Calibrar Zebra'.")
    print()
    input("  Presiona ENTER para cerrar...")


def main():
    print("=" * 62)
    print("  RAGNAR - Puentes de bascula e impresora Zebra")
    print("=" * 62)
    print()
    print("  Esta ventana debe quedarse ABIERTA mientras se trabaja.")
    print("  Si la cierras, la app deja de leer el peso y de imprimir.")
    print()

    # La bascula se busca sola en los puertos COM; la Zebra se detecta por su
    # driver de Windows. Se informa el estado para que quien instala sepa de
    # inmediato si falta conectar algo.
    impresora = zebra_bridge._buscar_impresora_windows()
    if zebra_bridge.ZEBRA_IP:
        print(f"  Impresora Zebra: por red en {zebra_bridge.ZEBRA_IP}")
    elif impresora:
        print(f"  Impresora Zebra: {impresora}")
    else:
        print("  Impresora Zebra: NO DETECTADA (conectala por USB y reinicia esta ventana)")
    print(f"  Bascula: buscando en los puertos COM ({bascula_bridge.COM_PORT_CONFIG})")
    print()

    for app, puerto, nombre in (
        (bascula_bridge.app, bascula_bridge.BRIDGE_PORT, "bascula"),
        (zebra_bridge.app, zebra_bridge.BRIDGE_PORT, "zebra"),
    ):
        hilo = threading.Thread(target=_correr, args=(app, puerto, nombre), daemon=True)
        hilo.start()
        print(f"  Puente de {nombre} escuchando en http://localhost:{puerto}")

    print()
    print("  LISTO. Ya puedes usar la app en https://quini-ragnar.web.app")
    print("  (deja esta ventana abierta y minimizada)")
    print()

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\n  Puentes detenidos.")


if __name__ == "__main__":
    # Un solo ejecutable hace las tres cosas segun el argumento: empaquetar
    # tres .exe separados triplicaba el tamano (cada uno lleva Python entero).
    accion = sys.argv[1].lower() if len(sys.argv) > 1 else ""
    if accion == "calibrar":
        calibrar()
    elif accion == "comprobar":
        comprobar()
    else:
        main()
