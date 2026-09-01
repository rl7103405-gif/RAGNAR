# Mensaje a Roberto — Productos (columnas + ejemplo) y la duda de los 30 días

Hola Roberto,

## Folio corregido después de 30 días

El filtro no es “folios creados hace menos de 30 días”. Es:

```sql
WHERE FechaActualizacion >= DATEADD(DAY, -30, GETDATE())
```

Si alguien corrige el folio **y** SICAP pisa `FechaActualizacion` (lo habitual al guardar), ese folio **vuelve a entrar** a la ventana y te llega otra vez.

Si el cambio **no** toca `FechaActualizacion`, o nadie lo vuelve a guardar, **no** te llega. Queda fuera hasta que esa fecha se mueva.

No es urgente cambiarlo; solo para que lo tengas claro.

---

## Productos — no disparo hasta que me avises

Quedó: misma URL y clave, `tabla: "productos"`, llave `CodigoProducto`. Me espero a tu lista blanca.

## Columnas (tal cual `AlmacenesQuini.dbo.Productos`)

Hoy: **40,743** filas, PK `CodigoProducto` (texto, unique). Cero vacíos en artículo, descripción, talla, color y referencia.

No hay columna que se llame `Modelo`. Lo más cercano:

| Lo que usas tú | Columna en SQL | Qué es en la práctica |
|---|---|---|
| Código | `CodigoProducto` | PK. Puede traer `#`, puntos, letras (`#7081-G`, `WKDSS26Q211`). |
| Descripción / nombre | `Articulo` | Nombre comercial (`PANTUFLETA NIÑOS`, `QUARTER CABALLERO`). |
| ¿Modelo? | no existe con ese nombre | Suele parecerse a `Referencia` o `Linea_Producto` (marca/línea: DISNEY, WEEKEND, POLO). A veces `Descripcion` es un código corto, **no** un texto largo. |
| Talla | `Talla` | Texto (`13`, `CABALLERO`, `DAMA`). |
| Color | `Color` | Texto (`ROSA`, `GRIS`, `MARINO`). |

Todas las columnas que mandaría:

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `CodigoProducto` | texto (20) | no | **PK / llave** |
| `Articulo` | texto (200) | no | Nombre del artículo |
| `Descripcion` | texto (100) | no | En SICAP suele ser código compacto, a veces igual al `CodigoProducto` |
| `Talla` | texto (80) | no | |
| `Color` | texto (50) | no | |
| `Referencia` | texto (100) | no | Marca / referencia |
| `NoCategoria` | número | no | |
| `TCiclo` | texto (50) | sí | Tiempo de ciclo, ej. `01:47:00` |
| `EsFichaFinal` | true/false | sí | Casi todo es `false` (31 en `true`, 1,519 nulos) |
| `Linea_Producto` | texto (30) | no | Línea |
| `Tipo_Producto` | texto (30) | no | |
| `Prenda` | texto (50) | no | |
| `TipoMaquina` | texto (50) | sí | ~16,783 vacíos |
| `Bordado` | texto (50) | sí | ~33,911 vacíos |

**Ejemplo real 1:**

```json
{
  "CodigoProducto": "#7081-G",
  "Articulo": "PANTUFLETA NIÑOS",
  "Descripcion": "PFMINNIROSROS",
  "Talla": "13",
  "Color": "ROSA",
  "Referencia": "DISNEY",
  "NoCategoria": 2,
  "TCiclo": "01:47:00",
  "EsFichaFinal": false,
  "Linea_Producto": "DISNEY",
  "Tipo_Producto": "NINGUNO",
  "Prenda": "CALCETIN",
  "TipoMaquina": "ZHENXING _ 144 _ 3.5 _ 36",
  "Bordado": "NEGRO"
}
```

**Ejemplo real 2** (código más “de operación”):

```json
{
  "CodigoProducto": "WKDSS26Q211",
  "Articulo": "QUARTER CABALLERO",
  "Descripcion": "WKDSS26Q211",
  "Talla": "CABALLERO",
  "Color": "GRIS",
  "Referencia": "WEEKEND",
  "NoCategoria": 2,
  "TCiclo": "02:01:00",
  "EsFichaFinal": false,
  "Linea_Producto": "QUARRY",
  "Tipo_Producto": "NINGUNO",
  "Prenda": "CALCETIN",
  "TipoMaquina": "ZHENXING _ 144 _ 3.5 _ 36",
  "Bordado": null
}
```

Régimen: **catálogo entero, una vez al día**, `tipo: "copia_completa"`, tope 5,000 → **9 lotes** con el mismo `syncId`. Tú escribes solo lo que cambió. No es ventana de 30 días (si no, se te caerían los códigos viejos).

Cuando me avises que `productos` ya está en tu lista blanca, disparo la primera carga.

---

## ¿Es lo mismo que el reporte de códigos de SCQ?

**Misma familia (SICAP / SQL de planta), no el mismo corte.**

- El **12 de agosto** te puse **40,666** = `COUNT(*)` de **`AlmacenesQuini.dbo.Productos`** (catálogo maestro). Hoy van **40,743**: el archivo crece (códigos nuevos), por eso te faltaban en operación.
- Tu reporte SCQ con **38,498** **no** es ese `COUNT(*)`. En SQL, el número más parecido es productos **con ficha de materiales** (`ProductosMateriales`): **38,547** códigos distintos ahora (el 12 de agosto eran 38,471). Sobra un margen de ~50: puede ser fecha del Excel, un filtro de SCQ, o códigos que el reporte no incluye.

O sea: **Productos es la fuente completa**; el Excel de SCQ parece un **subconjunto** (muy cerca de “los que tienen ficha”). Si me pasas dos o tres códigos que salen en SCQ y uno que *no* te salga ahí, te confirmo el amarre exacto.

Pedidos y PedidosDetalles, siguiente round, va.

Gracias,
Juan
