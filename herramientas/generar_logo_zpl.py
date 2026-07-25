"""
Herramienta de un solo uso: convierte el logo PNG de Deportivos Quini a un
bloque ZPL ^GFA monocromo para incrustarlo en las etiquetas de la Zebra.

Uso (desde la raiz del proyecto):
    .venv\\Scripts\\python.exe herramientas\\generar_logo_zpl.py "ruta\\al\\logo.png"

Genera app/static/logo_quini.zpl con una sola linea:
    ^GFA,<total>,<total>,<bytes_por_fila>,<hex>

zebra_print.py carga ese archivo al arrancar; si no existe, las etiquetas se
imprimen sin logo. Requiere Pillow (pip install pillow), que es dependencia
solo de esta herramienta, no de la app.
"""
import sys
import os

from PIL import Image

TAMANO = 144          # lado del logo en dots (144 x 144 a 203 dpi = ~18 x 18 mm)
UMBRAL = 128          # luminancia < UMBRAL -> pixel negro (sin dithering)
SALIDA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "static", "logo_quini.zpl")


def main():
    if len(sys.argv) != 2:
        print("Uso: python herramientas/generar_logo_zpl.py <ruta al logo.png>")
        sys.exit(1)
    ruta_logo = sys.argv[1]

    imagen = Image.open(ruta_logo)

    # Componer transparencia sobre fondo blanco antes de binarizar.
    if imagen.mode in ("RGBA", "LA", "P"):
        imagen = imagen.convert("RGBA")
        fondo = Image.new("RGBA", imagen.size, (255, 255, 255, 255))
        imagen = Image.alpha_composite(fondo, imagen)
    imagen = imagen.convert("L")

    # Preservar proporcion con padding blanco hasta un cuadrado TAMANO x TAMANO.
    imagen.thumbnail((TAMANO, TAMANO), Image.LANCZOS)
    lienzo = Image.new("L", (TAMANO, TAMANO), 255)
    lienzo.paste(imagen, ((TAMANO - imagen.width) // 2, (TAMANO - imagen.height) // 2))

    # Binarizar sin dithering: 1 = negro (bit encendido imprime en ZPL).
    bytes_por_fila = TAMANO // 8
    filas_hex = []
    pixeles = lienzo.load()
    for y in range(TAMANO):
        fila = bytearray(bytes_por_fila)
        for x in range(TAMANO):
            if pixeles[x, y] < UMBRAL:
                fila[x // 8] |= 0x80 >> (x % 8)
        filas_hex.append(fila.hex().upper())

    total_bytes = bytes_por_fila * TAMANO
    gfa = f"^GFA,{total_bytes},{total_bytes},{bytes_por_fila},{''.join(filas_hex)}"

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, "w", encoding="ascii") as f:
        f.write(gfa)

    negros = sum(fila.count("F") for fila in filas_hex)  # aproximado, solo informativo
    print(f"Logo convertido: {TAMANO}x{TAMANO} dots, {total_bytes} bytes ({bytes_por_fila}/fila).")
    print(f"Guardado en: {SALIDA}")
    print("Verifica la proporcion de negro; si salio invertido (fondo negro), avisa.")


if __name__ == "__main__":
    main()
