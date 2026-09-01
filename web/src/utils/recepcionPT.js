// RECEPCION EN PRODUCTO TERMINADO: lo que Valeria cuenta cuando la mercancia
// regresa de la maquila, comparado contra LO QUE SALIO.
//
// Roberto, 2026-08-28: "quiero que pueda decir 'acabo de recibir un pedido',
// pongo mis especificaciones, se compara con los folios, con lo que ha salido,
// y ya se saca lo que entro".
//
// ⚠️ CONTRA QUE SE COMPARA, Y POR QUE NO CONTRA LA TAREA. La primera version
// colgaba de las tareas de ensamble, y en produccion NO HAY NINGUNA viva: las
// maquilas todavia no tienen cuenta y nadie las esta creando. La pantalla
// quedaba correcta y vacia, que para quien la usa es lo mismo que rota.
//
// Lo que si existe son los DOCUMENTOS DE SALIDA (`pdfsGenerados`): 304 al
// 28-08, con folio interno, maquila y la lista congelada de bultos que se le
// mandaron, cada uno con su codigo y sus docenas. Eso es exactamente "lo que
// salio", y contra eso se compara lo que vuelve.
//
// El dia que las maquilas declaren su entrega habra una tercera columna
// (enviado / declarado / recibido) sin rehacer nada de aqui: por eso el acta
// guarda `origenTipo`.
//
// La recepcion es INMUTABLE: es el acta de lo que se conto ese dia, con nombre
// y hora. Si algo salio mal se levanta otra y se explica en la nota.
import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { normalizarOt } from './planMaestro'
import { ordenDeCaptura, SIN_ORDEN } from './pdf'
export { mapaOtAOc } from './planMaestro'

export class ErrorRecepcion extends Error {}

/**
 * La orden de trabajo de un bulto que ya SALIO, a partir de su producto.
 *
 * ⚠️ Esta funcion existia y se borro en el commit ce28ae2 dejando sus TRES
 * llamadas en pie. El resultado: `ReferenceError: otDelBultoDeSalida is not
 * defined` al armar la pantalla de Recibir — pantalla en blanco para Valeria,
 * en produccion, y `vite build` lo dejo pasar sin decir nada.
 *
 * Se restaura DELEGANDO en `ordenDeCaptura` (pdf.js), que es el punto unico
 * donde se decide la OT de un bulto, en vez de rehacer aqui la extraccion como
 * hacia la version original. Mismo criterio que `otDeBulto` del arbol: si cada
 * pantalla la sacara a su manera, la misma salida tendria una OT distinta
 * segun quien la mire.
 *
 * Devuelve '' (no SIN_ORDEN) porque los tres usos preguntan `if (ot)` o la
 * meten en un Set de OT reales.
 */
function otDelBultoDeSalida(producto) {
  const ot = ordenDeCaptura({ producto })
  return ot === SIN_ORDEN ? '' : normalizarOt(ot)
}

// Cuantas salidas se traen. Son 304 en total al 28-08 y hay que poder buscar
// entre ellas por folio de bulto, asi que se leen TODAS y se guardan por un
// rato: filtrar en memoria es gratis, releer 300 documentos en cada tecla no.
const VIGENCIA_CACHE_MS = 120000
let cacheSalidas = null // { esPrueba, en, promesa }

const texto = (v, max) => String(v ?? '').trim().slice(0, max)
const numero = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Los tres desenlaces de un renglon. El estado se DERIVA de las cantidades:
 *  no se le pide a nadie que lo teclee y que ademas cuadre con el numero. */
export function estadoDelRenglon(enviada, recibida) {
  const e = Number(enviada)
  const r = Number(recibida)
  if (!Number.isFinite(r)) return 'sin_contar'
  if (!Number.isFinite(e) || e <= 0) return 'sin_referencia'
  if (r === e) return 'completo'
  return r < e ? 'faltante' : 'sobrante'
}

export const ETIQUETA_ESTADO = {
  completo: 'Llegó completo',
  faltante: 'Faltó',
  sobrante: 'Llegó de más',
  sin_contar: 'Sin contar',
  sin_referencia: 'Sin referencia de salida'
}

/**
 * Convierte un documento de salida en la lista de lo que se mando, AGRUPADO
 * POR CODIGO.
 *
 * Se agrupa a proposito: el papel viaja por folios (un bulto es un folio),
 * pero la maquila devuelve producto armado en cajas, no los mismos bultos. A
 * Valeria le sirve "de este codigo salieron 24 docenas", no la lista de los
 * seis folios que las traian. Los folios se conservan aparte por si hace falta
 * rastrear uno.
 */
export function renglonesDeLaSalida(salida) {
  const porCodigo = new Map()
  ;(salida?.capturas || []).forEach((c) => {
    const p = c.producto || {}
    const codigo = texto(p.codigo, 60) || '(sin codigo)'
    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigo,
        descripcion: texto(p.descripcion, 200),
        ot: texto(otDelBultoDeSalida(p), 40),
        docenasEnviadas: 0,
        folios: []
      })
    }
    const r = porCodigo.get(codigo)
    r.docenasEnviadas += numero(p.docenas)
    r.folios.push(String(c.folio))
  })
  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/**
 * Las salidas a maquilas del mundo que corresponde.
 *
 * Se guarda la PROMESA, no el resultado: si la pantalla pide dos veces antes
 * de que llegue la primera, las dos esperan la misma lectura en vez de lanzar
 * dos. Es el mismo patron que el cache del ruteo y el del arbol.
 */
export async function salidasParaRecibir(esPrueba) {
  const ahora = Date.now()
  if (
    cacheSalidas &&
    cacheSalidas.esPrueba === (esPrueba === true) &&
    ahora - cacheSalidas.en < VIGENCIA_CACHE_MS
  ) {
    return cacheSalidas.promesa
  }
  const promesa = getDocs(
    query(collection(db, 'pdfsGenerados'), orderBy('creadoEn', 'desc'), limit(500))
  ).then((snap) =>
    snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // El corral: cada mundo ve sus salidas. Se filtra en memoria y no con un
      // where porque los documentos viejos (anteriores a las cuentas de
      // prueba) no traen el campo, y un where los dejaria fuera a todos.
      .filter((x) => (x.esPrueba === true) === (esPrueba === true))
      .filter((x) => x.maquila?.id)
  )
  cacheSalidas = { esPrueba: esPrueba === true, en: ahora, promesa }
  promesa.catch(() => {
    cacheSalidas = null
  })
  return promesa
}

/** Se olvida el cache: al guardar una recepcion conviene refrescar la lista. */
export function olvidarCacheDeSalidas() {
  cacheSalidas = null
}

/** Todo lo que se puede teclear para encontrar una salida. */
export function textoBuscableDeSalida(salida, otAOc) {
  const partes = [
    salida?.encabezado?.folioInterno,
    salida?.maquila?.nombre,
    salida?.maquila?.id,
    salida?.fechaTexto
  ]
  const ots = new Set()
  ;(salida?.capturas || []).forEach((c) => {
    const pr = c.producto || {}
    const ot = otDelBultoDeSalida(pr)
    partes.push(c.folio, pr.codigo, ot, pr.pedido, pr.descripcion, pr.modelo)
    if (ot) ots.add(ot)
  })
  // La OC no viaja en el documento: se resuelve por la OT con el plan vigente.
  ots.forEach((ot) => {
    const oc = otAOc?.get?.(ot)
    if (oc) partes.push(oc)
  })
  return partes.filter(Boolean).join(' ').toUpperCase()
}

/** Las OT y las OC que trae una salida, para enseñarlas en el resultado. */
export function otsYOcsDeSalida(salida, otAOc) {
  const ots = new Set()
  ;(salida?.capturas || []).forEach((c) => {
    const ot = otDelBultoDeSalida(c.producto)
    if (ot) ots.add(ot)
  })
  const ocs = new Set()
  ots.forEach((ot) => {
    const oc = otAOc?.get?.(ot)
    if (oc) ocs.add(oc)
  })
  return { ots: [...ots], ocs: [...ocs] }
}

/** Como se le presenta una salida a Valeria para que la reconozca. */
export function etiquetaDeSalida(s) {
  const folio = s?.encabezado?.folioInterno || String(s?.id || '').slice(0, 6) || '?'
  const maquila = s?.maquila?.nombre || s?.maquila?.id || 'sin maquila'
  const fecha = s?.fechaTexto || ''
  const bultos = s?.totalFolios ?? (s?.capturas || []).length
  return `Folio ${folio} · ${maquila} · ${fecha} · ${bultos} bultos`
}

/**
 * Guarda el acta de recepcion.
 *
 * salida:  el documento de salida contra el que se compara.
 * contado: { [codigo]: { docenas, nota } } — lo que PT conto de verdad.
 */
export async function registrarRecepcionPT({ salida, contado, nota, usuario, esPrueba }) {
  if (!usuario?.uid || !usuario?.nombre) {
    throw new ErrorRecepcion('Tu cuenta no tiene nombre configurado.')
  }
  if (!salida?.id || !salida?.maquila?.id) {
    throw new ErrorRecepcion('Elige de qué salida es lo que llegó.')
  }

  const renglones = renglonesDeLaSalida(salida).map((r) => {
    const c = contado?.[r.codigo] || {}
    const recibida = c.docenas === '' || c.docenas == null ? null : Number(c.docenas)
    return {
      codigo: r.codigo,
      descripcion: r.descripcion,
      docenasEnviadas: r.docenasEnviadas,
      docenasRecibidas: Number.isFinite(recibida) && recibida >= 0 ? recibida : null,
      estado: estadoDelRenglon(r.docenasEnviadas, recibida),
      nota: texto(c.nota, 200)
    }
  })

  if (renglones.length === 0) throw new ErrorRecepcion('Esa salida no trae bultos.')
  // Se exige contar AL MENOS uno. Un acta con todo vacio no dice "llego cero":
  // dice que nadie conto, y despues nadie sabe distinguirlo.
  if (!renglones.some((r) => r.docenasRecibidas !== null)) {
    throw new ErrorRecepcion('Escribe cuántas docenas llegaron de al menos un código.')
  }

  const conProblema = renglones.filter((r) => r.estado === 'faltante' || r.estado === 'sobrante')

  await addDoc(collection(db, 'recepcionesPT'), {
    // Deja lugar a un segundo origen (lo que la maquila declare) sin rehacer
    // la coleccion el dia que exista.
    origenTipo: 'salida',
    documentoId: texto(salida.id, 60),
    folioInterno: texto(salida.encabezado?.folioInterno, 40),
    maquilaId: texto(salida.maquila.id, 60),
    maquilaNombre: texto(salida.maquila.nombre, 120),
    fechaSalidaTexto: texto(salida.fechaTexto, 40),
    renglones,
    // Se guarda ya resuelto para no recalcularlo en cada pantalla que lo lea,
    // y para poder filtrar "las que no cuadraron" sin abrir cada documento.
    cuadro: conProblema.length === 0,
    renglonesConProblema: conProblema.length,
    nota: texto(nota, 300),
    recibidoEn: serverTimestamp(),
    recibidoPorUid: usuario.uid,
    recibidoPorNombre: texto(usuario.nombre, 120),
    esPrueba: esPrueba === true
  })
}

/** Las recepciones del mundo que corresponde, de la mas nueva a la mas vieja. */
export function escucharRecepcionesPT(esPrueba, alRecibir, alFallar) {
  const q = query(
    collection(db, 'recepcionesPT'),
    where('esPrueba', '==', esPrueba === true),
    orderBy('recibidoEn', 'desc')
  )
  return onSnapshot(
    q,
    (snap) => alRecibir(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    alFallar
  )
}
