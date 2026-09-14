// De donde salen los pares por pack de cada codigo (la parte con Firebase).
// La decision vive en packsPorCodigo.js (pura); aqui solo se junta la
// evidencia y se guardan los valores manuales.
//
//   config/packsFuentes   Microsip (por modelo) y tech packs (por codigo). Lo
//                         escribe SOLO scripts/cargar_packs_fuentes.mjs (Admin
//                         SDK): PT y consulta no pueden leer los tech packs, y
//                         asi solo ven el dato derivado.
//   planMaestroPedidos    el texto del pedido de Adrian, por OT. Se lee al
//                         momento, asi que cuando Adrian resube el plan la
//                         tabla se actualiza sola.
//   packsManuales/{codigo}  lo que decide Valeria o Cielo (con el valor
//                         anterior anotado; no se borra).
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { versionActiva, normalizarOt } from './planMaestro'
import { datosDeCodigos } from './datosDelCatalogo'
import {
  PARES_MAX,
  PARES_MIN,
  evidenciasDeCodigo,
  idPackManual,
  resolverPack
} from './packsPorCodigo'

export class ErrorPackManual extends Error {}

/** Quien puede decidir un pack a mano (las reglas dicen lo mismo). */
export const ROLES_PACK_MANUAL = ['pt', 'consulta', 'admin']

let promesaFuentes = null

/** config/packsFuentes, una vez por sesion. Si no existe o falla: vacio (todo
 *  sale de los pedidos o como supuesto, que es la verdad sin esa carga). */
export function cargarFuentesPacks() {
  if (!promesaFuentes) {
    promesaFuentes = getDoc(doc(db, 'config', 'packsFuentes'))
      .then((s) => {
        const d = s.exists() ? s.data() : {}
        return { microsip: d.microsip || {}, techpack: d.techpack || {}, cargado: s.exists(), cargadoEn: d.cargadoEn || null }
      })
      .catch((err) => {
        promesaFuentes = null
        console.warn('[packs] No se pudo leer config/packsFuentes:', err?.code || err)
        return { microsip: {}, techpack: {}, cargado: false, error: true }
      })
  }
  return promesaFuentes
}

const cachePedidos = new Map() // `${versionId}|${ot}` -> [textos]

/** Map ot -> [textos de pedido] del plan vigente. Por lotes de 30 (tope del
 *  operador 'in'), con cache por version del plan. */
export async function textosDePedidoDeOts(ots) {
  const salida = new Map()
  const limpias = [...new Set((ots || []).map((o) => normalizarOt(o)).filter(Boolean))]
  if (!limpias.length) return salida
  const versionId = await versionActiva()
  if (!versionId) return salida
  const faltan = limpias.filter((o) => !cachePedidos.has(`${versionId}|${o}`))
  for (let i = 0; i < faltan.length; i += 30) {
    const lote = faltan.slice(i, i + 30)
    const snap = await getDocs(
      query(collection(db, 'planMaestroPedidos'), where('versionId', '==', versionId), where('ot', 'in', lote))
    )
    const porOt = new Map(lote.map((o) => [o, []]))
    for (const d of snap.docs) {
      const x = d.data()
      const o = normalizarOt(x.ot)
      if (porOt.has(o) && x.pedidoTexto) porOt.get(o).push(String(x.pedidoTexto))
    }
    for (const [o, textos] of porOt) cachePedidos.set(`${versionId}|${o}`, textos)
  }
  for (const o of limpias) salida.set(o, cachePedidos.get(`${versionId}|${o}`) || [])
  return salida
}

/** Map codigo -> documento manual (o nada si no hay). */
export async function manualesDeCodigos(codigos, esPrueba) {
  const salida = new Map()
  const ids = [...new Set((codigos || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))]
  await Promise.all(
    ids.map(async (c) => {
      const id = idPackManual(c, esPrueba)
      if (!id) return
      const s = await getDoc(doc(db, 'packsManuales', id))
      if (s.exists()) salida.set(c, s.data())
    })
  )
  return salida
}

/**
 * Resuelve el pack de varios codigos de una vez.
 *
 * @param {Array<{codigo:string, ots:string[], modelo?:string}>} lista
 * @param {boolean} esPrueba  el corral de las cuentas demo tiene sus propios manuales
 * @returns Map codigo(MAYUSCULAS) -> resolucion (+ modelo)
 */
export async function resolverPacksDeCodigos(lista, esPrueba) {
  const porCodigo = new Map()
  for (const it of lista || []) {
    const c = String(it?.codigo || '').trim().toUpperCase()
    if (!c) continue
    const g = porCodigo.get(c) || { codigo: c, ots: new Set(), modelo: '' }
    for (const o of it.ots || []) if (o) g.ots.add(normalizarOt(o))
    if (!g.modelo && it.modelo) g.modelo = it.modelo
    porCodigo.set(c, g)
  }
  const codigos = [...porCodigo.keys()]
  if (!codigos.length) return new Map()
  const faltaModelo = codigos.filter((c) => !porCodigo.get(c).modelo)
  const [fuentes, pedidos, manuales, catalogo] = await Promise.all([
    cargarFuentesPacks(),
    textosDePedidoDeOts([...porCodigo.values()].flatMap((g) => [...g.ots])),
    manualesDeCodigos(codigos, esPrueba),
    faltaModelo.length ? datosDeCodigos(faltaModelo) : Promise.resolve(new Map())
  ])
  const salida = new Map()
  for (const [c, g] of porCodigo) {
    const modelo = g.modelo || catalogo.get(c)?.modelo || ''
    const evidencias = evidenciasDeCodigo({
      codigo: c,
      modeloCatalogo: modelo,
      pedidosDeSusOts: [...g.ots].map((ot) => ({ ot, textos: pedidos.get(ot) || [] })),
      fuentes
    })
    salida.set(c, { ...resolverPack({ manual: manuales.get(c) || null, evidencias }), modelo, codigo: c })
  }
  return salida
}

/**
 * Guarda (o corrige) los pares por pack de un codigo, a mano. Deja anotado el
 * valor anterior: se corrige, no se borra.
 */
export async function guardarPackManual({ codigo, modelo, pares, nota, usuario, esPrueba }) {
  const cod = String(codigo || '').trim().toUpperCase()
  const id = idPackManual(cod, esPrueba)
  if (!id) throw new ErrorPackManual(`El codigo "${codigo}" trae caracteres que no se pueden guardar.`)
  const n = Number(pares)
  if (!Number.isInteger(n) || n < PARES_MIN || n > PARES_MAX) {
    throw new ErrorPackManual(`Los pares por pack van de ${PARES_MIN} a ${PARES_MAX}.`)
  }
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorPackManual('Tu cuenta no tiene nombre configurado.')
  const ref = doc(db, 'packsManuales', id)
  await runTransaction(db, async (tx) => {
    const previo = await tx.get(ref)
    const antes = previo.exists() ? previo.data() : null
    tx.set(ref, {
      codigo: cod,
      modelo: String(modelo || '').slice(0, 80),
      pares: n,
      nota: String(nota || '').trim().slice(0, 200),
      porUid: usuario.uid,
      porNombre: usuario.nombre,
      en: serverTimestamp(),
      esPrueba: esPrueba === true,
      anterior: antes ? { pares: antes.pares, porNombre: antes.porNombre, en: antes.en } : null
    })
  })
}
