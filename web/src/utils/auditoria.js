// Bitacora de cambios sobre capturas y flujo de autorizacion para corregir
// folios que YA salieron en un PDF.
//
// Reglas del negocio (ver firestore.rules):
//   - Un folio SIN pdfGeneradoEn se puede editar/eliminar libremente, pero
//     TODO cambio queda registrado en cambiosCaptura.
//   - Un folio YA enviado a PDF solo lo toca un admin (Roberto) o quien tenga
//     una autorizacion aprobada por el (documento autorizaciones/{folio}_{tipo},
//     de un solo uso).
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase/config'

/** Registra un cambio en la bitacora. Nunca lanza: un fallo aqui no debe
 *  impedir la correccion que el operador ya hizo (se avisa en consola). */
export async function registrarCambio({
  folio,
  accion, // 'editar_peso' | 'eliminar' | 'recaptura' | 'recruce'
  antes = {},
  despues = {},
  motivo = null,
  autorizacionId = null,
  usuario // { uid, nombre }
}) {
  try {
    await addDoc(collection(db, 'cambiosCaptura'), {
      folio,
      accion,
      antes,
      despues,
      motivo: motivo || null,
      autorizacionId: autorizacionId || null,
      hechoPorUid: usuario.uid,
      hechoPorNombre: usuario.nombre || 'Estacion',
      creadoEn: serverTimestamp()
    })
    return true
  } catch (err) {
    console.error('[auditoria] No se pudo registrar el cambio:', err)
    return false
  }
}

const idAutorizacion = (folio, tipo) => `${folio}_${tipo}`

/** ¿Existe una autorizacion vigente (de un solo uso) para este folio/tipo? */
export async function autorizacionVigente(folio, tipo) {
  const snap = await getDoc(doc(db, 'autorizaciones', idAutorizacion(folio, tipo)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Consume la autorizacion tras aplicar la correccion: borra el permiso y
 *  marca la solicitud como usada en UNA sola operacion atomica. Si se hicieran
 *  como dos escrituras sueltas y fallara la segunda, la solicitud quedaria
 *  aparentando estar vigente en el historial. No lanza: la correccion al bulto
 *  ya se aplico y no debe deshacerse por esto (se avisa en consola). */
export async function consumirAutorizacion(folio, tipo, solicitudId = null) {
  try {
    const lote = writeBatch(db)
    lote.delete(doc(db, 'autorizaciones', idAutorizacion(folio, tipo)))
    if (solicitudId) {
      lote.update(doc(db, 'solicitudesCorreccion', solicitudId), { usadaEn: serverTimestamp() })
    }
    await lote.commit()
    return true
  } catch (err) {
    console.error('[auditoria] No se pudo consumir la autorizacion:', err)
    return false
  }
}

/** El operador pide permiso para corregir un folio ya enviado a PDF.
 *  propuesta (solo tipo 'editar_pdf'): { maquilaId, maquilaNombre, folios,
 *  folioInternoOriginal } -- el cambio CONCRETO que Roberto va a aprobar. Sin
 *  esto la autorizacion seria un permiso abierto para reemitir lo que sea. */
export async function pedirCorreccion({ folio, tipo, motivo, usuario, propuesta = null }) {
  const ref = await addDoc(collection(db, 'solicitudesCorreccion'), {
    folio,
    tipo,
    motivo,
    estado: 'pendiente',
    pedidoPorUid: usuario.uid,
    pedidoPorNombre: usuario.nombre || 'Estacion',
    creadoEn: serverTimestamp(),
    resueltoPorUid: null,
    resueltoPorNombre: null,
    resueltoEn: null,
    usadaEn: null,
    ...(propuesta ? { propuesta } : {})
  })
  return ref.id
}

/** El admin aprueba: se marca la solicitud y se crea la autorizacion que las
 *  reglas exigen para poder editar/eliminar ese folio. */
export async function aprobarCorreccion({ solicitud, usuario }) {
  // Las DOS escrituras en un lote atomico: si fueran sueltas y fallara la
  // segunda, quedaria una autorizacion vigente con la solicitud todavia
  // 'pendiente' -- la app diria "ya autorizado" y al aplicar el servidor la
  // rechazaria con un permission-denied sin explicacion.
  const lote = writeBatch(db)
  lote.set(doc(db, 'autorizaciones', idAutorizacion(solicitud.folio, solicitud.tipo)), {
    folio: solicitud.folio,
    tipo: solicitud.tipo,
    solicitudId: solicitud.id,
    otorgadaPorUid: usuario.uid,
    otorgadaPorNombre: usuario.nombre || 'Admin',
    creadoEn: serverTimestamp()
  })
  lote.update(doc(db, 'solicitudesCorreccion', solicitud.id), {
    estado: 'aprobada',
    resueltoPorUid: usuario.uid,
    resueltoPorNombre: usuario.nombre || 'Admin',
    resueltoEn: serverTimestamp()
  })
  await lote.commit()
}

/** El admin corrige DIRECTO: se crea la solicitud ya aprobada y su
 *  autorizacion, en ese orden, para que el flujo (y las reglas, que exigen
 *  ambas cosas) sea identico al de una correccion pedida por alguien mas y
 *  quede el mismo rastro. Devuelve la solicitud lista para usarse. */
export async function autoAprobarCorreccion({ folio, tipo, motivo, usuario, propuesta = null }) {
  const solicitudId = await pedirCorreccion({ folio, tipo, motivo, usuario, propuesta })
  const solicitud = { id: solicitudId, folio, tipo, motivo, propuesta }
  await aprobarCorreccion({ solicitud, usuario })
  return solicitud
}

/** El admin rechaza la solicitud (no se crea autorizacion). */
export async function rechazarCorreccion({ solicitud, usuario }) {
  await updateDoc(doc(db, 'solicitudesCorreccion', solicitud.id), {
    estado: 'rechazada',
    resueltoPorUid: usuario.uid,
    resueltoPorNombre: usuario.nombre || 'Admin',
    resueltoEn: serverTimestamp()
  })
}

// Nota: marcar la solicitud como usada ya va DENTRO de consumirAutorizacion
// (lote atomico); no hace falta una funcion aparte.
