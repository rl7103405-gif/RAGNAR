// Llama al bridge local (bridge/zebra_bridge.py) que corre en la misma PC y
// tiene la Zebra conectada. La generacion del ZPL vive en el bridge (Python),
// no aqui, para no duplicar esa logica ya probada.
const BASE_URL = import.meta.env.VITE_ZEBRA_BRIDGE_URL || 'http://localhost:8002'

export async function imprimirEtiqueta({
  folio,
  codigoProducto = '',
  docenas = '',
  pedidoId = '',
  cliente = '',
  pesoGramos = '',
  fecha = '',
  leyenda = ''
}) {
  try {
    const resp = await fetch(`${BASE_URL}/imprimir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folio,
        codigo_producto: codigoProducto,
        docenas,
        pedido_id: pedidoId,
        cliente,
        peso_gramos: pesoGramos,
        fecha,
        leyenda
      })
    })
    if (!resp.ok) {
      const detalle = await resp.text().catch(() => '')
      return { enviado: false, mensaje: `Bridge respondio con error: ${resp.status} ${detalle}` }
    }
    return await resp.json()
  } catch (e) {
    return {
      enviado: false,
      mensaje: 'No se pudo conectar al bridge de la Zebra en esta PC (bridge/zebra_bridge.py). ' +
        'Verifica que este corriendo.'
    }
  }
}
