// Folio interno consecutivo de las salidas.
// La PRIMERA vez lo teclea quien genera el PDF (para arrancar donde va la
// numeracion en papel); de ahi en adelante la app propone el siguiente y lo
// reserva de forma atomica, para que dos personas generando al mismo tiempo
// nunca usen el mismo numero.
//
// Hay DOS consecutivos, y no se mezclan nunca:
//   'real'   -> config/folioInternoEstado   el oficial, el que lleva en papel
//                                           el papa de Roberto
//   'prueba' -> config/folioInternoPrueba   el de las cuentas de prueba
//
// Por eso el `modo` es OBLIGATORIO y sin valor por defecto: si un dia alguien
// llama a esto sin decir en que mundo esta, tiene que tronar aqui -- en el
// unico lugar donde el error todavia no cuesta nada -- y no acabar quemandole
// un numero al papel de la fabrica. Las reglas de Firestore exigen lo mismo
// desde el servidor (una cuenta de prueba no puede tocar el oficial ni al
// reves), asi que esto es para que la app haga lo correcto, no la garantia.
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const DOCUMENTO = {
  real: 'folioInternoEstado',
  prueba: 'folioInternoPrueba'
}

function REF(modo) {
  const nombre = DOCUMENTO[modo]
  if (!nombre) {
    throw new Error(
      `Modo de folio interno invalido: ${JSON.stringify(modo)}. ` +
        'Tiene que ser "real" o "prueba" (viene de modoDatos del perfil). ' +
        'Si es null, el perfil todavia no ha cargado: no se puede emitir.'
    )
  }
  return doc(db, 'config', nombre)
}

/** Ultimo folio interno usado en ese consecutivo, o null si nunca se ha
 *  generado uno. */
export async function leerUltimoFolioInterno(modo) {
  const snap = await getDoc(REF(modo))
  const v = snap.exists() ? snap.data().ultimo : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Reserva el siguiente folio interno de forma atomica y lo devuelve.
 *  Si se pasa `forzado` (numero que tecleo el usuario), se usa ESE y el
 *  contador avanza al mayor de los dos, para que la numeracion nunca
 *  retroceda ni repita. */
export async function reservarFolioInterno(modo, forzado = null) {
  // Se resuelve ANTES de abrir la transaccion: un modo invalido debe tronar
  // sin haber tocado Firestore.
  const ref = REF(modo)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const actual =
      snap.exists() && typeof snap.data().ultimo === 'number' && Number.isFinite(snap.data().ultimo)
        ? snap.data().ultimo
        : null

    let asignado
    if (forzado !== null) {
      // Candado DEFINITIVO contra folios repetidos: se valida contra el
      // contador REAL dentro de la transaccion, no contra lo que el modal
      // leyo al abrirse (que puede ser viejo si otra pestana/persona genero
      // en el inter). Sin esto salieron papeles distintos con el mismo
      // numero (2026-08-08).
      if (actual !== null && forzado <= actual) {
        const err = new Error(
          `El folio interno ${forzado} ya se uso (el ultimo es ${actual}). ` +
            `El siguiente disponible es ${actual + 1}.`
        )
        err.codigo = 'folio-repetido'
        err.ultimo = actual
        throw err
      }
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

    tx.set(ref, {
      ultimo: actual === null ? asignado : Math.max(actual, asignado),
      actualizadoEn: serverTimestamp()
    })
    return asignado
  })
}
