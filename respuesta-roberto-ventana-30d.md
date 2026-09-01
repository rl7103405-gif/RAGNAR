# Respuesta a Roberto — ventana 30 días y diferencia 3,451 vs 3,417

Hola Roberto, buen día.

Qué bueno que el diario del 30 y 31 corrió bien, y que los 91 nuevos + 3,326 idénticos cuajaron.

## ¿Reportamos aceptadas o solo el 200?

La API **sí nos devuelve detalle**, no solo el HTTP 200. Ejemplo de lo que recibimos:

```json
{
  "ok": true,
  "procesados": 3451,
  "resumen": {
    "nuevos": 0,
    "actualizados": 0,
    "sinCambios": 3451,
    "omitidosViejos": 0,
    "enriquecidos": 0
  },
  "rechazados": 0,
  "duplicados": 0,
  "errores": 0
}
```

El **3,451** que te reporté el sábado 29 es el número de **filas que salieron de SQL y que tu endpoint contestó en `procesados`**. Ese día tu lado nos dijo `procesados: 3451` y `rechazados: 0`.

## La diferencia de 34

Hoy (31 ago) volví a contar en SQL la misma consulta del diario:

- Filas en ventana: **3,417**
- Distintos `Folio+Codigo`: **3,417**
- Sin folio o sin código: **0**
- Claves repetidas: **0**

**3,451 − 3,417 = 34.**  
Cuadra con una **ventana móvil**: el envío del 29 incluía 34 folios que el 31 **ya no entran** en “últimos 30 días”. Tu conteo guardado (3,417) coincide con lo que SQL tiene **ahora** en esa ventana, y con 91 + 3,326 del envío del 31.

No parece que se hayan perdido 34 por rechazo (aquel lote vino con `rechazados: 0`). Si ustedes conservan un rato los que ya salieron de nuestra ventana, el número de Firestore puede moverse un poco respecto al último POST; si caducan al no venir en el lote del día, deberían quedar en 3,417.

## ¿De cuántos días es la ventana?

**30 días**, sobre `FechaActualizacion` (hora del SQL en planta, `GETDATE()` del servidor):

```sql
WHERE FechaActualizacion >= DATEADD(DAY, -30, GETDATE())
```

Un solo lote, `tipo: copia_completa`, `tabla: codigos_ruta`. Fechas naive locales; `Nopedido` texto completo.

Cuando quieras seguimos con las otras tablas.

Gracias,  
Juan
