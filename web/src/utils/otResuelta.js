// LA ORDEN DE TRABAJO DE UN PEDIDO: un solo lugar que lo decida.
//
// Antes la OT se adivinaba del texto del pedido con otDePedido() — los
// primeros 4 digitos. Con el plan maestro real enfrente (2026-08-18) se midio
// que eso falla en 863 de 3419 renglones:
//
//   838  'C_6648_REPOSICION_CHYPCT201_UNITALLA_OT:6872'  -> no daba NADA
//    25  '7512_REPOSICION_7551'                          -> daba 7512 y es 7551
//
// Los 25 son los peligrosos: no fallan, contestan una OT que SI existe. El
// folio se cuelga de la orden equivocada y nadie lo nota nunca.
//
// EL PLAN MANDA, EL TEXTO ES EL RESPALDO. Adrian sube el plan y ahi viene, por
// cada texto de pedido, cual es su OT de verdad. Se consulta eso primero; solo
// si el plan no conoce ese pedido se cae a leerlo del texto.
//
// ⚠️ POR QUE SE CONGELA Y NO SE RESUELVE CADA VEZ. La tentacion era que el
// arbol consultara el plan al vuelo para cada bulto. Esta mal: cuando Adrian
// suba la version de la semana que entra, produccion YA CONTADA se
// reclasificaria sola y los numeros de la semana pasada dejarian de cuadrar
// sin que nadie tocara nada. Por eso la OT se resuelve UNA VEZ, al capturar, y
// se guarda dentro del bulto (`producto.ot`) junto con de donde salio
// (`producto.otOrigen`). Lo capturado no cambia de orden retroactivamente.
//
// ⚠️ Y LA CAPTURA NUNCA SE ROMPE POR ESTO. Esto corre en la bascula con el
// operador esperando. Si el plan no responde, si no hay red, si no hay plan
// subido todavia: se cae al texto y se sigue. Ninguna ruta de aqui lanza.
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { idDePedido, normalizarOt, normalizarPedido, planVigente } from './planMaestro'
import { otDelTexto } from './planMaestroNucleo.js'

/** De donde salio la OT de un bulto. Se guarda junto a ella. */
export const ORIGEN_PLAN = 'plan'
export const ORIGEN_TEXTO = 'texto'
export const ORIGEN_NINGUNA = 'ninguna'

// otDelTexto vive en el nucleo (sin Firebase) porque tambien la usa pdf.js.
export { otDelTexto } from './planMaestroNucleo.js'

// ---------------------------------------------------------------------------
// Cache de sesion
// ---------------------------------------------------------------------------
// Una estacion captura decenas de bultos del mismo pedido seguidos, y el arbol
// resuelve el mismo puñado de pedidos al abrir cada orden. Sin cache seria una
// lectura por bulto.
let versionCacheada = null
let versionCacheadaEn = 0 // Date.now() de cuando se guardo, para el TTL
let cargandoVersion = null
// Se incrementa en cada olvidarCacheDelPlan(). Una promesa de
// versionVigente() en vuelo captura la generacion al arrancar; si el olvido
// corre antes de que resuelva, la generacion ya no coincide y la promesa,
// al resolver, no debe reescribir la cache recien limpiada con un dato viejo.
let generacionCache = 0
const cachePedidos = new Map() // pedidoClave -> ot | null (null = el plan no lo tiene)

// Cuanto dura la version cacheada antes de volver a leerla. Sin esto, una
// pestana que nunca sube el plan (la estacion, America) se queda para
// siempre con la version que vio al abrir: si Adrian sube un plan nuevo a
// media jornada, esa pestana seguiria resolviendo OT contra el plan viejo.
const TTL_VERSION_MS = 5 * 60 * 1000

/** Se llama al subir un plan nuevo o al cerrar sesion: lo cacheado ya no vale. */
export function olvidarCacheDelPlan() {
  versionCacheada = null
  versionCacheadaEn = 0
  cargandoVersion = null
  cachePedidos.clear()
  generacionCache += 1
}

/** El versionId vigente, cacheado con TTL. Devuelve null si no hay plan o si falla. */
async function versionVigente() {
  const sigueVigente = versionCacheada !== null && Date.now() - versionCacheadaEn < TTL_VERSION_MS
  if (sigueVigente) return versionCacheada
  if (!cargandoVersion) {
    const generacionAlArrancar = generacionCache
    cargandoVersion = planVigente()
      .then((p) => {
        const nueva = p?.versionId || ''
        cargandoVersion = null
        // El olvido corrio mientras esta promesa estaba en vuelo: no pisar
        // la cache que ya se limpio con una version que dejo de aplicar.
        if (generacionCache !== generacionAlArrancar) return nueva
        // La version SI cambio (no solo vencio el TTL con el mismo id): lo
        // resuelto en cachePedidos es de la version anterior y ya no sirve.
        if (versionCacheada !== null && versionCacheada !== nueva) cachePedidos.clear()
        versionCacheada = nueva
        versionCacheadaEn = Date.now()
        return nueva
      })
      .catch((err) => {
        // Sin plan se sigue trabajando con el texto. Se avisa en consola y no
        // se cachea el fallo, para que el siguiente intento lo vuelva a probar.
        console.warn('[OT] No se pudo leer el plan vigente:', err?.message)
        cargandoVersion = null
        return ''
      })
  }
  return cargandoVersion
}

/**
 * La OT de un pedido: primero el plan, si no el texto.
 *
 * Devuelve siempre { ot, origen }. Nunca lanza y nunca deja a la captura sin
 * respuesta: en el peor caso devuelve { ot: null, origen: 'ninguna' }, que es
 * lo mismo que decia la app antes de que existiera el plan.
 */
export async function resolverOt(pedido) {
  const respaldo = otDelTexto(pedido)
  const clave = normalizarPedido(pedido)
  if (!clave) return { ot: null, origen: ORIGEN_NINGUNA }

  if (cachePedidos.has(clave)) {
    const delPlan = cachePedidos.get(clave)
    if (delPlan) return { ot: delPlan, origen: ORIGEN_PLAN }
    return respaldo ? { ot: respaldo, origen: ORIGEN_TEXTO } : { ot: null, origen: ORIGEN_NINGUNA }
  }

  try {
    const versionId = await versionVigente()
    if (versionId) {
      const snap = await getDoc(doc(db, 'planMaestroPedidos', idDePedido(versionId, clave)))
      const ot = snap.exists() ? normalizarOt(snap.data().ot) : ''
      cachePedidos.set(clave, ot || null)
      if (ot) return { ot, origen: ORIGEN_PLAN }
    }
  } catch (err) {
    // Red caida, permisos, lo que sea: no se cachea el fallo y se sigue con el
    // texto. Un bulto sin capturar es peor que un bulto con la OT derivada.
    console.warn('[OT] No se pudo consultar el plan para', clave, '-', err?.message)
  }

  return respaldo ? { ot: respaldo, origen: ORIGEN_TEXTO } : { ot: null, origen: ORIGEN_NINGUNA }
}

/**
 * Resuelve varios pedidos de golpe, reusando la cache.
 *
 * Lo usa el arbol para el puñado de pedidos distintos que trae el ruteo (unas
 * decenas), no para los miles de renglones del plan: bajar el diccionario
 * entero costaria mas de mil lecturas cada vez que alguien abre la pestana.
 *
 * Devuelve un Map pedidoClave -> { ot, origen }.
 */
export async function resolverVarios(pedidos) {
  const claves = [...new Set(pedidos.map(normalizarPedido).filter(Boolean))]
  const salida = new Map()
  // En serie a proposito: son decenas, y en paralelo un plan grande podria
  // abrir cien conexiones a la vez desde una PC de planta.
  for (const clave of claves) salida.set(clave, await resolverOt(clave))
  return salida
}
