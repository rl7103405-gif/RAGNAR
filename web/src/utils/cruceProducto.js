// Resuelve, DENTRO de la transaccion de guardado del bulto, el cruce
// folio -> foliosRuteo -> catalogo, y arma el snapshot de producto que se
// congela en bultos/{folio}. El PDF de salida usa exclusivamente ese
// snapshot: si el Excel o el catalogo cambian despues de pesar, el documento
// ya emitido no cambia de contenido.
//
// Al leer todo con tx.get, un fallo de red truena la transaccion completa
// (el operador ve el error y reintenta) en vez de degradarse en silencio a
// "N/A": aqui 'sin_ruteo'/'sin_catalogo' significan que el dato NO EXISTE,
// nunca que no se pudo consultar.
import { doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { ORIGEN_NINGUNA, ORIGEN_PLAN, ORIGEN_TEXTO, otDelTexto } from './otResuelta'
import { idDePedido, normalizarOt } from './planMaestroNucleo'
import { shardDeCodigo, claveDeCodigo, NUM_SHARDS_CATALOGO } from './catalogoClaves'

export const CRUCE_COMPLETO = 'completo'
export const CRUCE_SIN_RUTEO = 'sin_ruteo'
export const CRUCE_SIN_CATALOGO = 'sin_catalogo'

/** Devuelve { producto, cruce, catalogoVersion } listos para guardarse en el
 *  documento del bulto. producto es null si el folio no viene en el Excel. */
export async function resolverProductoEnTx(tx, folio) {
  const ruteoSnap = await tx.get(doc(db, 'foliosRuteo', folio))
  if (!ruteoSnap.exists()) {
    return { producto: null, cruce: CRUCE_SIN_RUTEO, catalogoVersion: null }
  }
  const r = ruteoSnap.data()

  // --- LA ORDEN DE TRABAJO ---------------------------------------------
  // El plan maestro manda; el texto del pedido es el respaldo. Se resuelve
  // AQUI, una sola vez, y se congela: si se resolviera al vuelo en el arbol,
  // la version del plan de la semana que entra reclasificaria produccion ya
  // contada y los numeros de la semana pasada cambiarian solos.
  //
  // Las dos lecturas van con tx.get como el resto. Que el plan no exista NO es
  // un error: exists() da false y se sigue con el texto, que es exactamente lo
  // que hacia la app antes de que Adrian subiera nada.
  let ot = otDelTexto(r.pedido)
  let otOrigen = ot ? ORIGEN_TEXTO : ORIGEN_NINGUNA
  if (r.pedido) {
    const planSnap = await tx.get(doc(db, 'config', 'planMaestroActivo'))
    const versionId = planSnap.exists() ? planSnap.data().versionId : null
    if (versionId) {
      const pedidoSnap = await tx.get(
        doc(db, 'planMaestroPedidos', idDePedido(versionId, r.pedido))
      )
      if (pedidoSnap.exists()) {
        const delPlan = normalizarOt(pedidoSnap.data().ot)
        if (delPlan) {
          ot = delPlan
          otOrigen = ORIGEN_PLAN
        }
      }
    }
  }

  // descripcion/modelo/color pueden venir del propio Excel (formato
  // Seguimiento de Folios); sirven de respaldo si el catalogo no tiene el
  // codigo. El catalogo, cuando si lo tiene, manda sobre estos valores.
  const producto = {
    codigo: r.codigo ?? null,
    docenas: r.docenas ?? null,
    pares: r.pares ?? null,
    total: r.total ?? null,
    pedido: r.pedido ?? null,
    // La ORDEN DE TRABAJO, congelada aqui y no derivada despues.
    //
    // Se sigue pudiendo derivar del pedido (y para los bultos viejos es lo
    // unico que hay), pero guardarla resuelve algo que la derivacion no puede:
    // 'foliosRuteo' se purga a los 15 dias y una orden de compra tarda
    // SEMANAS en completarse. Sin este campo, el arbol de una orden con mas de
    // dos semanas encuentra cero folios de sus primeras OT y las pinta en 0% —
    // que se lee igual que "no se ha producido nada", cuando en realidad ya
    // se produjo y el rastro se purgo.
    ot,
    // De donde salio: 'plan' (lo dijo el plan maestro), 'texto' (se leyo del
    // pedido) o 'ninguna'. Sin esto, un dia que los numeros no cuadren no hay
    // manera de saber si el bulto se agrupo por el dato bueno o por el
    // respaldo, y esa pregunta se vuelve incontestable con el tiempo.
    otOrigen,
    nombreGuia: r.nombreGuia ?? null,
    descripcion: r.descripcion ?? null,
    modelo: r.modelo ?? null,
    talla: null,
    color: r.color ?? null,
    referencia: null,
    linea: null
  }
  if (!producto.codigo) {
    return { producto, cruce: CRUCE_SIN_CATALOGO, catalogoVersion: null }
  }

  const configSnap = await tx.get(doc(db, 'config', 'catalogoActual'))
  if (!configSnap.exists() || !configSnap.data().versionId) {
    return { producto, cruce: CRUCE_SIN_CATALOGO, catalogoVersion: null }
  }
  const numShards = configSnap.data().numShards
  if (numShards !== undefined && numShards !== NUM_SHARDS_CATALOGO) {
    // Que truene la transaccion explicitamente en vez de degradar a
    // sin_catalogo: si el catalogo vigente esta particionado distinto de
    // como esta version de la app lo espera, shardDeCodigo() apuntaria al
    // shard equivocado y el cruce daria un falso "no encontrado".
    throw new Error(
      `El catalogo vigente usa ${numShards} shards y esta version de la app espera ${NUM_SHARDS_CATALOGO}. Recarga el catalogo o actualiza la app.`
    )
  }
  const versionId = configSnap.data().versionId
  const shardSnap = await tx.get(
    doc(db, 'catalogoVersiones', versionId, 'shards', shardDeCodigo(producto.codigo))
  )
  const entrada = shardSnap.exists()
    ? (shardSnap.data().productos || {})[claveDeCodigo(producto.codigo)]
    : undefined
  if (!entrada) {
    return { producto, cruce: CRUCE_SIN_CATALOGO, catalogoVersion: versionId }
  }
  return {
    producto: {
      ...producto,
      // El catalogo manda; si algun campo suyo viene vacio se conserva el
      // respaldo que traiga el Excel (o null).
      descripcion: entrada.descripcion ?? producto.descripcion,
      modelo: entrada.modelo ?? producto.modelo,
      talla: entrada.talla ?? null,
      color: entrada.color ?? producto.color,
      referencia: entrada.referencia ?? null,
      linea: entrada.linea ?? null
    },
    cruce: CRUCE_COMPLETO,
    catalogoVersion: versionId
  }
}
