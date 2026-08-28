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

export class ErrorRecepcion extends Error {}

/** Cuantas salidas se ofrecen para elegir. */
const SALIDAS_RECIENTES = 60

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
        ot: texto(p.ot, 40),
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

/** Las ultimas salidas del mundo que corresponde, para elegir cual llego. */
export async function salidasParaRecibir(esPrueba) {
  const snap = await getDocs(
    query(collection(db, 'pdfsGenerados'), orderBy('creadoEn', 'desc'), limit(200))
  )
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    // El corral: cada mundo ve sus salidas. Se filtra en memoria y no con un
    // where porque los documentos viejos (anteriores a las cuentas de prueba)
    // no traen el campo, y un where los dejaria fuera a todos.
    .filter((s) => (s.esPrueba === true) === (esPrueba === true))
    .filter((s) => s.maquila?.id)
    .slice(0, SALIDAS_RECIENTES)
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
