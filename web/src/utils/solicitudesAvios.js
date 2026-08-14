// Solicitudes de AVIOS: la maquila pide el material que le falta para poder
// ensamblar y le llega DIRECTO a Alvaro (almacen) o a Lindbergh.
//
// Es la pieza que mata el "no me lo pediste / se me olvido": queda escrito
// quien pidio que, cuando, y quien lo atendio o lo rechazo y por que.
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase/config'

export const ESTADOS_SOLICITUD = {
  pendiente: 'Pendiente',
  atendida: 'Atendida',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada por la maquila'
}

export class ErrorSolicitudAvios extends Error {}

/** La maquila pide lo que le falta.
 *  renglones: [{ codigo, descripcion, cantidad, unidad }] */
export async function pedirAvios({ maquilaId, maquilaNombre, renglones, nota, usuario }) {
  const limpios = (renglones || [])
    .map((r) => ({
      codigo: String(r.codigo || '').trim().toUpperCase(),
      descripcion: String(r.descripcion || '').slice(0, 200),
      cantidad: Number(r.cantidad),
      unidad: String(r.unidad || 'piezas')
    }))
    .filter((r) => r.codigo && Number.isFinite(r.cantidad) && r.cantidad > 0)

  // El inventario cuenta ENTEROS: pedir 0.5 rollos acabaria truncado a 0 al
  // recibirse. Se rechaza aqui con mensaje claro.
  const conDecimales = limpios.find((r) => !Number.isInteger(r.cantidad))
  if (conDecimales) {
    throw new ErrorSolicitudAvios(
      `La cantidad de ${conDecimales.codigo} trae decimales (${conDecimales.cantidad}): pide unidades completas.`
    )
  }

  if (limpios.length === 0) {
    throw new ErrorSolicitudAvios('Agrega al menos un material con su cantidad.')
  }
  if (limpios.length > 40) {
    throw new ErrorSolicitudAvios(`Maximo 40 materiales por solicitud (pusiste ${limpios.length}).`)
  }
  // Un codigo repetido en la misma solicitud confunde a quien la atiende.
  const vistos = new Set()
  for (const r of limpios) {
    if (vistos.has(r.codigo)) {
      throw new ErrorSolicitudAvios(`El material ${r.codigo} esta repetido: junta la cantidad en un solo renglon.`)
    }
    vistos.add(r.codigo)
  }
  if (!usuario?.nombre) {
    throw new ErrorSolicitudAvios('Tu cuenta no tiene nombre configurado: avisale a Roberto.')
  }

  const ref = await addDoc(collection(db, 'portalMaquila', maquilaId, 'solicitudesAvios'), {
    maquilaId,
    maquilaNombre,
    renglones: limpios,
    nota: String(nota || '').trim().slice(0, 300),
    estado: 'pendiente',
    pedidoPorUid: usuario.uid,
    pedidoPorNombre: usuario.nombre,
    creadoEn: serverTimestamp()
  })
  return ref.id
}

/** Alvaro (almacen) o el admin resuelve: 'atendida' (ya se manda) o
 *  'rechazada'. Desde el 2026-08-13 Lindbergh ya no resuelve pedidos. */
export async function resolverSolicitudAvios({ solicitud, estado, respuesta, usuario }) {
  if (!['atendida', 'rechazada'].includes(estado)) {
    throw new ErrorSolicitudAvios('Estado invalido.')
  }
  if (estado === 'rechazada' && !String(respuesta || '').trim()) {
    throw new ErrorSolicitudAvios('Para rechazar hay que decir por que: la maquila lo va a leer.')
  }
  // La regla exige resueltoPorNombre == perfil.nombreCompleto EXACTO. Un
  // fallback tipo 'Almacen' nunca calzaria y el update se rechazaria con un
  // 'permission-denied' que no le dice nada al operador: mejor avisarlo aqui,
  // igual que hacen pedirAvios y enviarAvios.
  if (!usuario?.nombre) {
    throw new ErrorSolicitudAvios('Tu cuenta no tiene nombre configurado: avisale a Roberto.')
  }
  await updateDoc(
    doc(db, 'portalMaquila', solicitud.maquilaId, 'solicitudesAvios', solicitud.id),
    {
      estado,
      resueltoPorUid: usuario.uid,
      resueltoPorNombre: usuario.nombre,
      resueltoEn: serverTimestamp(),
      respuesta: String(respuesta || '').trim().slice(0, 300)
    }
  )
}

/** La maquila cancela su propia solicitud (se equivoco al pedir). */
export async function cancelarSolicitudAvios(solicitud) {
  await updateDoc(
    doc(db, 'portalMaquila', solicitud.maquilaId, 'solicitudesAvios', solicitud.id),
    { estado: 'cancelada' }
  )
}

/** Suscripcion a las solicitudes de UNA maquila (para su portal). */
export function escucharSolicitudesDeMaquila(maquilaId, onDatos, onError) {
  return onSnapshot(
    query(
      collection(db, 'portalMaquila', maquilaId, 'solicitudesAvios'),
      orderBy('creadoEn', 'desc')
    ),
    (snap) => onDatos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  )
}

/** TODAS las solicitudes, para Alvaro. Usa collectionGroup: la regla con
 *  comodin recursivo lo permite SOLO a internos.
 *
 *  SIN orderBy a proposito: un collectionGroup con orderBy exige un indice de
 *  campo unico con alcance de grupo que el CLI no aplica de forma fiable. Con
 *  decenas de solicitudes, ordenar aqui es equivalente y no depende de que un
 *  indice exista. */
export function escucharTodasLasSolicitudes(onDatos, onError) {
  return onSnapshot(
    collectionGroup(db, 'solicitudesAvios'),
    (snap) => onDatos(ordenarPorFechaDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    onError
  )
}

/** Mas reciente primero. Los que aun no tienen serverTimestamp resuelto
 *  (escritura recien hecha, cache local) van al principio: son los ultimos. */
export function ordenarPorFechaDesc(lista) {
  return [...lista].sort((a, b) => {
    const ta = a.creadoEn?.toMillis ? a.creadoEn.toMillis() : Number.MAX_SAFE_INTEGER
    const tb = b.creadoEn?.toMillis ? b.creadoEn.toMillis() : Number.MAX_SAFE_INTEGER
    return tb - ta
  })
}

/** Lectura puntual de las pendientes (para contadores y avisos). */
export async function contarSolicitudesPendientes() {
  const snap = await getDocs(
    query(collectionGroup(db, 'solicitudesAvios'), where('estado', '==', 'pendiente'))
  )
  return snap.size
}
