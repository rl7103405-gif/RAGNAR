# RAGNAR — Manual de Manuel (Producto Terminado)

*18 de septiembre de 2026. Manuel entra a PT en lugar de Valeria (se va el
30-sep); capacitación el lunes 21-sep. El PDF para imprimir es
`Manual RAGNAR - Manuel (Producto Terminado).pdf` y se genera de
`docs/manual-manuel-producto-terminado.html` con Edge headless:*

    msedge --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="<pdf>" "file:///<html>"

*Si cambian las pantallas de PT, se edita el HTML y se regenera.*

Diferencias con el de Valeria (14-sep):

- Empieza con **"Quini en dos minutos"** (el flujo de un pedido) y un
  vocabulario (OC, PO#, OT, código, bulto y folio, maquila, remisión, docena,
  pack, PL): Manuel no conoce la empresa.
- **Cierre** en Embarcar ya no se llena: es una columna de solo lectura.
- Los tres frenos de Embarcar: empaque no reconocido, packs **sin precio**
  (importe en $0) y entrega ya registrada.
- **Decidir pares por pack** en el Detalle del Inventario de PT (pack en
  conflicto / suelto supuesto), que el de Valeria no traía.
- Caso difícil nuevo: el papel de la maquila viene por código y la pantalla por
  OT (pendiente #78 de app-ragnar: no se pueden cuadrar uno con el otro).
- Checklist de la primera semana.

La contraseña va a mano en la línea del recuadro, nunca en el documento.
