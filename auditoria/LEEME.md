# Scripts de Auditoría — Deportivos Quini (Proyecto RAGNAR)

Herramientas reutilizables generadas a partir de las auditorías de junio-julio 2026.
**Regla de unidades:** 1 docena = 12 pares = 24 piezas. SCQ y Remisiones en docenas; Microsip en piezas.

## Cómo usarlos en un chat nuevo de Claude
1. Sube estos 5 archivos como **archivos del proyecto RAGNAR** (o al chat directamente)
2. Sube los archivos de **datos actualizados** que pida cada script
3. Pide a Claude: *"corre compulsa_triple.py con estos archivos"* — Claude ajusta las rutas del CONFIG y ejecuta

Requisitos (Claude los instala solo): `pandas, openpyxl, xlrd, python-calamine`

---

## 1. `compulsa_triple.py` — Compulsa SCQ vs Remisiones vs Microsip
**Datos que necesita:**
- Reporte de folios del SCQ (.xls, "Seguimiento de folios")
- BASE_REMISIONES.xlsx (hoja REMISIONES: folio, docenas, remisión, maquilero)
- COMPULSA_LOTES.xlsx (Microsip → reporte "Lotes con actividad" de Procesos Iniciales)

**Entrega:** semáforo por folio (vivo en 3 sistemas 🔴 / vivo SCQ+Micro cerrado 🟠 / diferencias 🟡 / OK 🟢), hoja de urgentes y una hoja por maquilero con columnas de firma para auditoría física.

## 2. `validacion_entradas.py` — Folios generados vs entradas a Microsip
**Datos que necesita:**
- FOLIOS_GENERADOS.xlsx (folios generados en SCQ con docenas)
- COMPULSA_LOTES.xlsx (mismo kardex de lotes)
- BASE_REMISIONES.xlsx (opcional, cruza faltantes)

**Entrega:** qué folios NO tienen Entrada por Producción y cuáles entraron con cantidad distinta; los faltantes se cruzan contra remisiones para detectar los GRAVES (ya enviados a maquilero sin registro).

## 3. `auditoria_maquila.py` — Balance de semielaborado por maquila
**Datos que necesita:**
- Kardex de los artículos del almacén de la maquila (Microsip)
- RESUMEN_GENERAL_MAQUILAS.xlsx (hoja "RESUMEN GENERAL ENSAMBLES")
- Existencia física reportada por el maquilero (hoja INV: código, docenas)
- En CONFIG: nombre de la maquila, fecha desde, e **inventario inicial** si no se cargó en Microsip

**Entrega:** balance completo (traspasado + ajustes − entregado − devuelto = teórico vs reportado), comparativo de inventario por código con semáforo, y detalle por artículo separando SEMIELABORADO de PACKS.

**Lecciones incorporadas (auditoría Edgar Munguía):**
- Los artículos con entradas por *Ensamble* son packs; su Traspaso(salida) NO es devolución
- Los ajustes entrada/salida son sustituciones de códigos (efecto casi neto cero)
- Si Microsip tiene mucho más inventario que el físico → ensambles sin capturar

## 4. `valuacion_inventarios.py` — Inventarios de maquilas valuados
**Datos que necesita:**
- Un archivo de inventario por maquila (código + docenas)
- Catálogo de costos de Microsip (código, descripción, costo) — indicar en CONFIG si el costo es por PIEZA o por DOCENA

**Entrega:** resumen por maquila (docenas, piezas, valor $), detalle valuado por código con descripción, y lista de códigos sin costo para completar el catálogo.

## `quini_lib.py` — Librería compartida
Funciones de carga y parsing (SCQ, remisiones, kardex de lotes, kardex de artículos) y helpers de Excel. **Debe estar en la misma carpeta que los demás scripts.**

---

## Historial de decisiones que estos scripts asumen
- Folio SCQ ≡ Lote Microsip
- Folio "vivo" en SCQ = algún paso Cerrado/Volteado/Hormado en 0 (Pareado no discrimina)
- Folios en remisiones sin SCQ = proceso correcto (ya concluyeron)
- WIP en planta = folios sin remisión (normal)
- Devoluciones de maquila = Traspaso(entrada) en procesos iniciales / Traspaso(salida) de semielaborado puro en almacén maquila
