"""
diagnostico_etiqueta.py

Imprime una etiqueta de DIAGNOSTICO con una regla numerada cada 50 dots y un
marco alrededor de toda el area imprimible. Sirve para responder dos cosas
cuando una etiqueta sale cortada:

  1) Hasta que altura (en dots) imprime realmente la Zebra: la ultima marca
     visible dice donde se corta. 203 dpi = 8 dots/mm, asi que el rollo real
     de 10 x 8.2 cm son 800 x 656 dots.
  2) Si la impresora esta descalibrada: el marco debe verse COMPLETO y
     centrado en la etiqueta fisica; si aparece recorrido o cortado, hay que
     calibrar el sensor de medio (boton de pausa+cancelar en la ZT410, o
     'Calibrate' en el menu) en vez de tocar el layout.

Uso (con el bridge de la Zebra corriendo):
    .venv\\Scripts\\python bridge\\diagnostico_etiqueta.py
"""
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

# Las medidas se toman del bridge para que NUNCA queden desfasadas con lo
# que se imprime de verdad (tenerlas duplicadas aqui ya causo confusion).
from zebra_bridge import (  # noqa: E402
    ETIQUETA_ALTO_DOTS as ALTO_DOTS,
    ETIQUETA_ANCHO_DOTS as ANCHO_DOTS,
    imprimir_etiqueta,
)


def zpl_regla() -> str:
    lineas = ["^XA", "^LH0,0", f"^PW{ANCHO_DOTS}", f"^LL{ALTO_DOTS}"]
    # Marco de toda el area imprimible.
    lineas.append(f"^FO5,5^GB{ANCHO_DOTS - 10},{ALTO_DOTS - 10},3^FS")
    # Regla vertical: una marca numerada cada 50 dots.
    for y in range(50, ALTO_DOTS - 20, 50):
        lineas.append(f"^FO20,{y}^GB160,3,3^FS")
        lineas.append(f"^FO200,{max(0, y - 14)}^A0N,28,28^FDy={y}^FS")
    # Referencias horizontales en la mitad y en el extremo derecho.
    lineas.append(f"^FO{ANCHO_DOTS // 2},40^GB3,{ALTO_DOTS - 80},3^FS")
    lineas.append(f"^FO{ANCHO_DOTS - 220},{ALTO_DOTS // 2}^A0N,34,34^FDBORDE DERECHO^FS")
    lineas.append("^XZ")
    return "\n".join(lineas)


if __name__ == "__main__":
    resultado = imprimir_etiqueta(zpl_regla())
    print(resultado["mensaje"])
    print(
        "\nRevisa la etiqueta impresa:\n"
        "  - Si el marco sale COMPLETO y la ultima marca es y=600 o mas, la\n"
        "    impresora imprime toda la etiqueta (el problema seria del layout).\n"
        "  - Si se corta antes (p.ej. la ultima marca visible es y=150), la\n"
        "    Zebra esta descalibrada o configurada con una etiqueta mas corta:\n"
        "    hay que calibrarla con el rollo puesto."
    )
