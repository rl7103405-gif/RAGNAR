// DONDE VIVE UNA ORDEN DE TRABAJO DENTRO DEL PLAN: de que orden de compra
// cuelga y a quien va.
//
// Sale de la junta del 17-08 y de lo que Roberto pidio el 18-08: el arbol no
// puede vivir solo en su pestana. Textual del dueno sobre los niveles:
//
//   America  -> folio y orden de trabajo (ella COMPLETA las OT)
//   Lindbergh-> orden de trabajo, "le da igual el folio", pero TIENE QUE
//               CUMPLIR ordenes de compra
//   el papa  -> solo orden de compra
//   Adrian   -> solo sube el plan
//
// Lindbergh pide por OT y necesita ver, en el mismo lugar, cuanto lleva de la
// OC. Eso es lo que resuelve este archivo: cualquier pantalla que tenga una OT
// a la mano (Tareas, Historial, lo que venga) puede preguntar aqui de que
// orden de compra es y a quien va, sin volver a armar el arbol entero.
//
// ⚠️ Una sola consulta por lote de OT, cacheada por sesion. La alternativa era
// una consulta por tarjeta, y en la pantalla de Tareas hay 124 tarjetas.
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { MAX_IN, normalizarOt, versionActiva } from './planMaestro'

// ot -> { oc, destino } | null (null = el plan no conoce esa OT)
const cache = new Map()
let versionCacheada = null

/** Al subir un plan nuevo lo cacheado ya no vale. */
export function olvidarUbicaciones() {
  cache.clear()
  versionCacheada = null
}

/**
 * Ubica varias OT de golpe. Devuelve Map ot -> { oc, destino } (solo las que
 * el plan conoce; las demas simplemente no estan en el Map).
 *
 * NUNCA lanza: si no hay plan, si falla la red o si falta el indice, devuelve
 * lo que tenga. Una pantalla que ya funcionaba sin esto no se puede caer por
 * un adorno.
 */
export async function ubicarOts(ots) {
  const limpias = [...new Set((ots || []).map(normalizarOt).filter(Boolean))]
  const salida = new Map()
  if (!limpias.length) return salida

  try {
    const versionId = await versionActiva()
    if (!versionId) return salida
    // Si cambio el plan, lo cacheado es de otra version y ya no aplica.
    if (versionId !== versionCacheada) {
      cache.clear()
      versionCacheada = versionId
    }

    const faltantes = limpias.filter((ot) => !cache.has(ot))
    for (let i = 0; i < faltantes.length; i += MAX_IN) {
      const lote = faltantes.slice(i, i + MAX_IN)
      const snap = await getDocs(
        query(
          collection(db, 'planMaestroLineas'),
          where('versionId', '==', versionId),
          where('ot', 'in', lote)
        )
      )
      // Una OT tiene un renglon por codigo; puede que solo algunos traigan el
      // destino lleno. Se toma el primero que lo tenga, no el primero a secas.
      const porOt = new Map()
      snap.docs.forEach((d) => {
        const l = d.data()
        const previa = porOt.get(l.ot)
        if (!previa) porOt.set(l.ot, { oc: l.oc || '', destino: l.destino || '' })
        else if (!previa.destino && l.destino) previa.destino = l.destino
      })
      // Las que no aparecieron tambien se cachean, como null: sin eso se
      // volveria a consultar por ellas en cada render.
      lote.forEach((ot) => cache.set(ot, porOt.get(ot) || null))
    }
  } catch (err) {
    console.warn('[Plan] No se pudieron ubicar las ordenes de trabajo:', err?.message)
  }

  limpias.forEach((ot) => {
    const u = cache.get(ot)
    if (u) salida.set(ot, u)
  })
  return salida
}
