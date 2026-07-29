"""
calibrar_zebra.py

Le ensena a la Zebra el tamano REAL de las etiquetas y recalibra su sensor.

Sintoma que resuelve: la etiqueta sale cortada a los pocos centimetros y el
siguiente trabajo se imprime encimado en la misma etiqueta fisica (varios
"DEPORTIVOS QUINI" en un solo pedazo). Eso pasa cuando la impresora cree que
las etiquetas son mas cortas de lo que son -- no es problema del layout.

Manda por ZPL:
  ^MNY   medios NO continuos con separacion entre etiquetas (gap sensing)
  ^LL    longitud de etiqueta en dots
  ^PW    ancho de impresion en dots
  ^JUS   guarda la configuracion en la memoria permanente de la impresora
  ~JC    fuerza la calibracion del sensor midiendo etiquetas reales
         (expulsa 2-3 etiquetas EN BLANCO: es normal)

Uso (con el bridge de la Zebra corriendo):
    .venv\\Scripts\\python bridge\\calibrar_zebra.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from zebra_bridge import ETIQUETA_ALTO_DOTS, ETIQUETA_ANCHO_DOTS, imprimir_etiqueta  # noqa: E402

ZPL_CALIBRACION = f"""^XA
^MNY
^LL{ETIQUETA_ALTO_DOTS}
^PW{ETIQUETA_ANCHO_DOTS}
^LH0,0
^JUS
^XZ
~JC"""


if __name__ == "__main__":
    alto_cm = ETIQUETA_ALTO_DOTS / 80
    ancho_cm = ETIQUETA_ANCHO_DOTS / 80
    print(f"Configurando la Zebra para etiquetas de {ancho_cm:.1f} x {alto_cm:.1f} cm")
    print(f"  ({ETIQUETA_ANCHO_DOTS} x {ETIQUETA_ALTO_DOTS} dots a 203 dpi)")
    resultado = imprimir_etiqueta(ZPL_CALIBRACION)
    print(resultado["mensaje"])
    print(
        "\nLa impresora va a avanzar 2-3 etiquetas EN BLANCO mientras se\n"
        "calibra: es normal, esta midiendo las etiquetas reales.\n"
        "Cuando termine, vuelve a correr:\n"
        "    .venv\\Scripts\\python bridge\\diagnostico_etiqueta.py\n"
        "y la regla debe llegar hasta y=600 en UNA sola etiqueta."
    )
