// Consulta suelta al CATALOGO DE PRODUCTOS: de un codigo a su descripcion,
// modelo y talla.
//
// La remision de la maquila pide esas tres columnas y el catalogo ya las tiene
// para sus 38 mil codigos, asi que la maquila NO las teclea: se llenan solas.
// Un dato que ya existe y se le pide a la gente otra vez es una invitacion a
// que se escriba distinto cada vez.
//
// Distinto de cruceProducto.js, que hace lo mismo DENTRO de la transaccion de
// captura y ademas congela el resultado en el bulto. Aqui solo se consulta
// para pintar un papel: si falla, el papel sale con lo que haya.
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { claveDeCodigo, shardDeCodigo, NUM_SHARDS_CATALOGO } from './catalogoClaves'

// Shards del catalogo ya bajados en esta sesion: `${versionId}||${shard}` ->
// promesa del mapa de productos. La clave lleva la VERSION, asi que un
// catalogo recargado nunca sirve shards del anterior.
const cacheShards = new Map()

/**
 * Devuelve un Map codigo -> { descripcion, modelo, talla, color }.
 *
 * NUNCA lanza: si no hay catalogo o falla la lectura, devuelve lo que alcanzo.
 * Los codigos se agrupan por shard para no leer el mismo documento dos veces.
 */
export async function datosDeCodigos(codigos) {
  const salida = new Map()
  const limpios = [...new Set((codigos || []).map((c) => String(c || '').trim()).filter(Boolean))]
  if (!limpios.length) return salida

  try {
    const cfg = await getDoc(doc(db, 'config', 'catalogoActual'))
    const versionId = cfg.exists() ? cfg.data().versionId : null
    if (!versionId) return salida
    // Mismo candado que la captura: si el catalogo vigente esta partido
    // distinto de como esta version espera, el shard calculado apuntaria al
    // lugar equivocado y daria un falso "no encontrado".
    const numShards = cfg.data().numShards
    if (numShards !== undefined && numShards !== NUM_SHARDS_CATALOGO) {
      console.warn('[Catalogo] Particionado distinto del esperado; no se completan los datos.')
      return salida
    }

    const porShard = new Map()
    limpios.forEach((c) => {
      const sh = shardDeCodigo(c)
      if (!porShard.has(sh)) porShard.set(sh, [])
      porShard.get(sh).push(c)
    })

    // En PARALELO y con cache de sesion: cada shard pesa ~250 KB (38 mil
    // codigos repartidos en 64) y bajarlos uno tras otro, otra vez en cada
    // Excel, era parte del "se tarda muchisimo". La promesa se cachea para
    // que dos consultas simultaneas del mismo shard compartan una descarga.
    await Promise.all(
      [...porShard.entries()].map(async ([sh, delShard]) => {
        const claveCache = `${versionId}||${sh}`
        if (!cacheShards.has(claveCache)) {
          const promesa = getDoc(doc(db, 'catalogoVersiones', versionId, 'shards', sh))
            .then((snap) => (snap.exists() ? snap.data().productos || {} : {}))
          promesa.catch(() => cacheShards.delete(claveCache))
          cacheShards.set(claveCache, promesa)
        }
        const productos = await cacheShards.get(claveCache)
        delShard.forEach((c) => {
          const e = productos[claveDeCodigo(c)]
          if (e) {
            salida.set(c, {
              descripcion: e.descripcion || '',
              modelo: e.modelo || '',
              talla: e.talla || '',
              color: e.color || ''
            })
          }
        })
      })
    )
  } catch (err) {
    console.warn('[Catalogo] No se pudieron leer los datos de los codigos:', err?.message)
  }
  return salida
}

/**
 * De un CODIGO DE BARRAS al codigo de producto de Quini.
 *
 * El resumen de pagos a maquilas identifica el producto por codigo de barras
 * (asi lo confirmo Cielo el 24-08: "todos deberian ser codigos de barras"),
 * mientras que las tareas y la remision lo identifican por el codigo de Quini.
 * Este es el puente: sin el, amarrar un precio a un producto es trabajo manual
 * renglon por renglon.
 *
 * El indice lo escribe cargar_catalogo.mjs en la MISMA version del catalogo,
 * en catalogoVersiones/{version}/barras/{shard}. Si el archivo con el que se
 * cargo el catalogo no traia columna de barras, esa coleccion no existe y aqui
 * simplemente no se encuentra nada — no es un error.
 *
 * Devuelve el codigo de producto, o null si no hay puente.
 */
export async function codigoDeBarras(barras) {
  const limpio = String(barras || '').replace(/\D/g, '')
  if (limpio.length < 8) return null
  try {
    const cfg = await getDoc(doc(db, 'config', 'catalogoActual'))
    if (!cfg.exists()) return null
    const versionId = cfg.data().versionId
    if (!versionId) return null
    const numShards = cfg.data().numShards
    if (numShards !== undefined && numShards !== NUM_SHARDS_CATALOGO) {
      console.warn('[Catalogo] Particionado distinto del esperado; no se busca por barras.')
      return null
    }
    const snap = await getDoc(
      doc(db, 'catalogoVersiones', versionId, 'barras', shardDeCodigo(limpio))
    )
    if (!snap.exists()) return null
    return (snap.data().codigos || {})[claveDeCodigo(limpio)] || null
  } catch (err) {
    console.warn('[Catalogo] No se pudo buscar el codigo de barras:', err?.message)
    return null
  }
}
