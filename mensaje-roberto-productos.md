# Mensaje a Roberto — siguiente tabla: Productos

Hola Roberto,

Perfecto, seguimos con **Productos**.

Hoy el catálogo en SQL tiene **~40,713** filas (PK `CodigoProducto`). No tiene sentido una ventana de 30 días como en ruteo: si solo mando los “nuevos”, los códigos viejos dejarían de ir y se te caducarían igual que los folios quietos. Por eso la **ventana completa** aquí es el **catálogo entero, una vez al día**. Tú escribes solo lo que cambió.

Tope de 5,000 por POST → serían **9 lotes** con el mismo `syncId`, `tipo: "copia_completa"`.

## Confirmar de tu lado antes de disparar

1. ¿Mismo endpoint `ruteoImport` y la misma API key?
2. El campo `tabla` lo mandaría como **`productos`**. ¿Lo das de alta así en tu allowlist?
3. Llave que proponemos: **`CodigoProducto`** (texto, no número: hay códigos como `#7081-G` y `.809`).

## Columnas (tal cual SQL)

| Campo | Tipo | Notas |
|---|---|---|
| CodigoProducto | texto | PK |
| Articulo | texto | |
| Descripcion | texto | |
| Talla | texto | |
| Color | texto | |
| Referencia | texto | |
| NoCategoria | número | |
| TCiclo | texto | ej. `01:47:00` |
| EsFichaFinal | true/false | |
| Linea_Producto | texto | |
| Tipo_Producto | texto | |
| Prenda | texto | |
| TipoMaquina | texto | |
| Bordado | texto | |

Ejemplo real:

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

Cuando confirmes el nombre `productos` (o el que uses), disparo la primera copia y dejo el diario en SERVIDOR-HP. **Pedidos / PedidosDetalles** los vemos enseguida, igual: primero el nombre `tabla` y si van juntos o en dos syncs.

Gracias,
Juan
