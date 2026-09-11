# Plantilla TP-Quini v1 — plan para programar

Preparado por Claude (Opus) el 2026-09-11 a pedido de Roberto: *"quiero crear un
formato para que todos se vean iguales y sea más fácil para el sistema calificar...
orden, orden, orden... tú lo planeas y Fable lo codea y lo mete a RAGNAR"*.

Diseño criticado por Codex (una ronda, ver "Debate" al final). Página visual para
Roberto y Lety: artifact "Plantilla TP-Quini".

---

## 1. Qué resuelve (medido el 11-sep sobre los 120 xlsx de la biblioteca)

| Hallazgo | Dato |
|---|---|
| El bloque de pedido está en las mismas celdas | 90 de 101 (9 corridos +2 filas/+2 columnas, 2 en otro lado) |
| 18 tech packs no traen hoja INFORMACION DE PEDIDOS | 18 de 120 |
| Nombre de la hoja de caja | "EMPAQUE CAJA" 73 · "EMPAQUE FINAL" 43 |
| Hojas con nombre del diseño ("CIW10 - 513089001", "ACOMODO WKD225T401") | frecuentes; 7 archivos repiten ETIQUETAS/ACOMODO/HABILITADO por modelo |
| Traen columna USA (avíos por pack) | 4 de 120 |
| Logo de Quini | imagen en la fila 0 de CADA hoja; la calificación v1 lo cuenta como "foto" |
| Datos que se contradicen | CPD32-UN-01711: hoja pedido dice 4504385856, hoja etiquetas dice OC_4504385861 |
| Formas y flechas por archivo | 52–61 formas, 7–30 conectores → ExcelJS las pierde si reescribe |

## 2. Reglas del formato (decisiones)

1. **Un archivo = un modelo/variante.** Varias tallas van en la tabla de pedido, no
   en hojas repetidas. Si un pack mezcla modelos distintos, es otro tech pack.
2. **Una sola fuente por dato:** la hoja `1 PEDIDO`. Las hojas 2–6 repiten la banda
   de encabezado con FÓRMULAS que apuntan a la hoja 1, pero **RAGNAR nunca lee el
   resultado de una fórmula**: lee siempre la celda original (ExcelJS no calcula y
   el resultado guardado puede venir vacío o viejo).
3. **Nombres y orden de hojas fijos:** `1 PEDIDO`, `2 CODIGOS Y RUTA`, `3 AVIOS`,
   `4 EMPAQUE INDIVIDUAL`, `5 PACKS EN BOLSA`, `6 CAJA`, y `_RAGNAR` (oculta).
   Son los siete rubros de Lety (RUBROS_TECH_PACK): la foto no es hoja, son las
   zonas de foto de las hojas 1, 4, 5 y 6. **No se agrega ni se quita un rubro.**
4. **Banda de encabezado idéntica** en las filas 1–3 de todas las hojas: logo en la
   zona reservada `A1:B3`, título de la hoja, modelo, OC, fecha, cliente, marca,
   elaboró, y la marca de plantilla `TP-QUINI v1`.
5. **Logo:** siempre en `A1:B3` y en ningún otro lado. Las imágenes cuyo ancla cae
   dentro de la banda NO cuentan como foto. (Si Roberto prefiere quitarlo del todo,
   solo se deja la zona vacía; no cambia nada más.)
6. **Fotos en zonas declaradas.** Cada zona tiene nombre (`FOTO_REFERENCIA`,
   `FOTO_INDIVIDUAL`, `FOTO_BOLSA`, `FOTO_CAJA`) y rango. Una imagen cuenta para una
   zona si su rectángulo de anclaje (`tl`/`br`) se cruza con el rango. Flechas y
   formas dentro de la zona son libres.
7. **Datos por nombres definidos + manifiesto.** Cada campo tiene un nombre de libro
   (`TP_CLIENTE`, `TP_OC`...) que apunta a UNA celda o tabla. Además `_RAGNAR` guarda
   `plantilla=TP-QUINI`, `version=1`, y un manifiesto `campo → hoja!rango`. Si el
   archivo dice ser v1 y le falta una hoja, nombre o tabla: **"plantilla dañada"**,
   se dice qué falta y no se adivina.
8. **Listas desplegables** en tejido, sistema de talla, procesos de ruta y "talla o
   TODAS" de avíos. Son ayuda de captura, no candado: todo se vuelve a validar al subir.

## 3. Las hojas

### 1 PEDIDO
| Campo | Nombre | Tipo (banda: etiqueta en C/F/I, dato en D:E, G:H, J) |
|---|---|---|
| Cliente | `TP_CLIENTE` | texto (prellenado del destino del plan) |
| Marca | `TP_MARCA` | texto |
| Modelo | `TP_MODELO` | texto (`CPD32-UN/01711`) |
| Variante / color | `TP_VARIANTE` | texto |
| Prenda | `TP_PRENDA` | texto |
| Tipo de tejido | `TP_TEJIDO` | lista (CIRCULAR, RECTILINEO...) — Lety fija la lista |
| Sistema de talla | `TP_SISTEMA_TALLA` | lista (DAMA, CABALLERO, NIÑO 4-6...) |
| Fecha | `TP_FECHA` | fecha |
| Elaboró | `TP_ELABORO` | texto |
| Orden de compra | `TP_OC` | texto (del plan) |
| Pares por pack | `TP_PACK` | entero 1–24 |
| Packs del pedido | `TP_PACKS` | entero |
| Pares / docenas | `TP_PARES`, `TP_DOCENAS` | **fórmulas solo visuales**; RAGNAR recalcula |
| Tabla del pedido | `TP_TABLA_PEDIDO` | TALLA · OT · CÓDIGO INTERNO · CLAVE MICROSIP · DESCRIPCIÓN MICROSIP · UPC · DOCENAS |
| Foto de referencia | `FOTO_REFERENCIA` | zona |

### 2 CODIGOS Y RUTA
- `TP_TABLA_CODIGOS`: CÓDIGO · TALLA · COLOR CUERPO · BORDADO · HILO/LECHUGA · zona de imagen por renglón.
- `TP_RUTA`: PROCESO 1..7 con lista (TEJIDO, CERRADO, VOLTEADO, HORMADO, PAREADO, HABILITADO, EMBALAJE, …).

### 3 AVIOS (antes ETIQUETAS)
- `TP_TABLA_AVIOS`: CLAVE · DESCRIPCIÓN · **USA POR PACK** (decimal ≥ 0) · CÓMO SE USA (texto: "6 packs dentro de una bolsa") · TALLA (o TODAS) · imagen.
- ENVIAR = USA × `TP_PACKS` como fórmula visual. Toda fila con descripción necesita clave del catálogo `avios/{clave}`.
- Es la hoja que ya lee `web/src/utils/aviosTechPack.js` (botón "Avíos que necesita").

### 4 EMPAQUE INDIVIDUAL · 5 PACKS EN BOLSA · 6 CAJA
- Texto de instrucciones (`TP_INDIVIDUAL_TEXTO`, `TP_BOLSA_TEXTO`, `TP_CAJA_TEXTO`).
- Número operativo: `TP_PACKS_POR_BOLSA` (hoja 5), `TP_DOCENAS_POR_CAJA` (hoja 6).
- Zona de foto `FOTO_INDIVIDUAL` / `FOTO_BOLSA` / `FOTO_CAJA` con flechas libres.

### _RAGNAR (oculta)
`plantilla`, `version`, `generadoEn`, `generadoDesdeOt`, `generadoPorUid`, manifiesto.
Ocultarla evita accidentes, no es seguridad.

## 4. Calificación v2 (escala aparte de la v1)

Siete rubros con el mismo peso (confirmado por Roberto el 11-sep).
Cada rubro se cumple solo si pasan TODAS sus comprobaciones:

| Rubro | Comprobaciones |
|---|---|
| Pedido | cliente, marca, modelo, prenda, tejido, fecha, elaboró, OC, pack; ≥1 renglón con OT + clave Microsip + docenas > 0; OC y OT coinciden con el plan vigente (si no, "conflicto", no se elige) |
| Códigos y ruta | cada código de la tabla de pedido aparece con color de cuerpo; ≥1 proceso válido |
| Avíos | ≥1 avío; toda clave en catálogo; USA numérico ≥ 0; ninguna fila sin clave |
| Empaque individual | texto o imagen en `FOTO_INDIVIDUAL` |
| Packs en bolsa | `TP_PACKS_POR_BOLSA` numérico + imagen en `FOTO_BOLSA` |
| Caja | `TP_DOCENAS_POR_CAJA` numérico + imagen en `FOTO_CAJA` |
| Fotos | las cuatro zonas con ≥1 imagen (el logo no cuenta) |

**Estados separados** (Codex): `subido` → `no conforme` / `conforme` (automático) →
`aprobado` (lo marca Lety o su equipo). Guardar un archivo incompleto se permite, pero
nunca se ve como aprobado.

Los 120 viejos conservan `medicion` v1 y se muestran como "formato anterior". No se
mezclan las dos escalas en un mismo promedio.

## 5. Cómo nace un tech pack

1. En Tech packs, "Nuevo tech pack" desde una OT (solo `puedeEditarTechPacks`).
2. RAGNAR arma un Excel NUEVO con ExcelJS, prellenado con lo que sabe el plan:
   cliente/destino, OC, OT, códigos, docenas; PACK si la descripción dice "3PACK"
   (`paresPorPack` de `utils/entregasPL.js`). Lo descarga.
3. Lety lo completa en Excel: fotos, flechas, avíos con USA, textos.
4. Lo sube: el validador corre en el navegador y muestra qué falta, campo por campo,
   ANTES de guardar.
5. Queda `conforme` o `no conforme`; Lety lo aprueba.

**Nunca se reescribe un archivo de Lety.** Se guarda tal cual (chunks + sha256 como hoy).

## 6. Los 120 que ya existen

- Quedan como "formato anterior" con su calificación v1.
- Herramienta opcional "Pasar al formato nuevo": arma un **borrador migrado** con cada
  campo acompañado de valor, celda de origen, confianza y conflicto. Lety confirma.
  El 90 % de coincidencia de posiciones no es 90 % de exactitud.
- Prioridad: los tech packs de OT vivas del plan.

## 7. Qué NO se hace

- No leer resultados de fórmulas.
- No identificar datos por coordenadas ni por nombre de hoja solamente (va el manifiesto).
- No contar toda imagen como foto.
- No duplicar hojas por modelo.
- No reescribir ni "normalizar" el original.
- No mezclar calificación v1 y v2.
- No ampliar los rubros de Lety.

## 8. Trabajo para Fable, en orden

| Fase | Entrega | Archivos |
|---|---|---|
| F1 | El esquema en código, fuente única para generador y validador: hojas, campos, nombres, zonas, listas, versión | `web/src/utils/plantillaTechPack.js` + prueba sintética |
| F2 | Generador del Excel prellenado desde una OT + botón "Nuevo tech pack" | `web/src/utils/generarPlantillaTechPack.js`, `PanelTechPacks.jsx` |
| F3 | Validador puro + calificación v2 + estados; se corre al subir y en `medir_tech_packs.mjs` (v2) | `web/src/utils/validarTechPack.js`, `techPacks.js`, `scripts/medir_tech_packs.mjs` |
| F4 | Reglas: `techPackDocValido` acepta `validacion` y `estado`; `aprobado` solo rol `desarrollo` | `firestore.rules` → **auditoría + arnés `probar_reglas_diseno.mjs` antes del deploy** (tope de 1,000 expresiones) |
| F5 | `aviosTechPack.js` lee la hoja 3 por nombres cuando el archivo es v1 | `aviosTechPack.js` |
| F6 | Borrador migrado para los 120 (Roberto: se migran todos) | script + pantalla de revisión |

**Riesgos que F3/F4 deben cubrir:** la calificación la escribe el cliente al subir, así
que es informativa; la verdad la vuelve a medir el script con Admin SDK. Límites de
tamaño (15 MB, hojas, celdas, imágenes) antes de abrir el archivo en el navegador.

**Pruebas de aceptación:** sintéticas (plantilla generada → validada = 0 faltantes;
borrar un nombre = "plantilla dañada"; imagen en banda ≠ foto; fórmula sin resultado
no rompe nada), y a mano: abrir, llenar, guardar y resubir en Excel Windows, Excel Mac
y LibreOffice.

## 9. Decisiones de Roberto (2026-09-11, misma tarde)

- Logo: **en su zona fija** `A1:B3`.
- Los siete rubros **pesan igual**.
- Las listas de tejido, sistema de talla y procesos las mantiene **Lety**.
- El formato **se exige desde ya** y **se migran los 120** existentes ("sé que vamos a tardar, pero cambiar todos"). F6 deja de ser opcional.

## Debate con Codex (una ronda)

Aceptado: manifiesto en `_RAGNAR`; fórmulas solo visuales; un modelo por archivo con
tabla de tallas; estados subido/conforme/aprobado; fotos por zona geométrica; migración
como borrador con origen por campo; "plantilla dañada" en vez de adivinar; matriz de
pruebas Windows/Mac/LibreOffice; límites de tamaño.

No aceptado: "USA numérico es demasiado restrictivo por tallas". USA es la cantidad de
un avío por pack, no la talla; debe ser número. Las tallas sí van como texto con su
sistema (`TP_SISTEMA_TALLA`).
