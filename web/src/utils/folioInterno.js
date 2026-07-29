// Folio interno consecutivo de las salidas (config/folioInternoEstado).
// La PRIMERA vez lo teclea quien genera el PDF (para arrancar donde va la
// numeracion en papel); de ahi en adelante la app propone el siguiente y lo
// reserva de forma atomica, para que dos personas generando al mismo tiempo
// nunca usen el mismo numero.
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const REF = () => doc(db, 'config', 'folioInternoEstado')

/** Ultimo folio interno usado, o null si nunca se ha generado uno. */
export async function leerUltimoFolioInterno() {
  const snap = await getDoc(REF())
  const v = snap.exists() ? snap.data().ultimo : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Reserva el siguiente folio interno de forma atomica y lo devuelve.
 *  Si se pasa `forzado` (numero que tecleo el usuario), se usa ESE y el
 *  contador avanza al mayor de los dos, para que la numeracion nunca
 *  retroceda ni repita. */
export async function reservarFolioInterno(forzado = null) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(REF())
    const actual =
      snap.exists() && typeof snap.data().ultimo === 'number' && Number.isFinite(snap.data().ultimo)
        ? snap.data().ultimo
        : null

    let asignado
    if (forzado !== null) {
      asignado = forzado
    } else if (actual !== null) {
      asignado = actual + 1
    } else {
      // Nunca se ha generado uno y no se tecleo ninguno: quien llama debio
      // pedirlo antes (el modal lo exige).
      throw new Error(
        'Todavia no hay un folio interno de arranque: escribe el primero a mano en el modal.'
      )
    }

    tx.set(REF(), {
      ultimo: actual === null ? asignado : Math.max(actual, asignado),
      actualizadoEn: serverTimestamp()
    })
    return asignado
  })
}
