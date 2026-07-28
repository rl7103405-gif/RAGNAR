// Estado global del ruteo en config/ruteoEstado:
//   maxFolioNumero   -- folio numerico mas alto visto en cualquier carga
//   actualizadoEn    -- serverTimestamp de la ultima escritura (tambien sirve
//                       como referencia de hora del SERVIDOR para la limpieza,
//                       sin confiar en el reloj de la PC)
//   ultimaLimpieza   -- cuando corrio la ultima purga de 15 dias
//
// Los folios son consecutivos globales: si el dia 1 se cargan 1-10 y el dia 2
// llega 12-20, falta el 11. El analisis avisa (sin bloquear la carga) y solo
// mira el rango NUEVO (maxAnterior, maxArchivo]: los huecos historicos ya se
// avisaron el dia que eran nuevos, repetirlos cada dia seria puro ruido con
// un archivo acumulativo.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore'
import { db } from '../firebase/config'

const REF_ESTADO = () => doc(db, 'config', 'ruteoEstado')
const MAX_FALTANTES_LISTADOS = 30
// Un salto asi de grande no es un hueco real sino un cambio de serie o un
// archivo equivocado: se avisa como salto anormal en vez de listar millones.
const SALTO_ANORMAL = 100000
export const RETENCION_DIAS = 15

function folioANumero(folio) {
  return /^\d+$/.test(folio) && folio.length <= 15 ? Number(folio) : null
}

/** Lee el maximo folio numerico registrado (o null si nunca se ha cargado). */
export async function leerMaxFolio() {
  const snap = await getDoc(REF_ESTADO())
  const v = snap.exists() ? snap.data().maxFolioNumero : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Analiza huecos de folios consecutivos en el rango nuevo.
 *  foliosPresentes: Set de folios (texto canonizado) que trae el archivo.
 *  maxAnterior: maximo numerico ya registrado (null en la primera carga).
 *  Devuelve { faltantes, totalFaltantes, saltoAnormal, maxArchivo }. */
export function analizarHuecos(foliosPresentes, maxAnterior) {
  const numeros = new Set()
  let maxArchivo = null
  for (const folio of foliosPresentes) {
    const n = folioANumero(folio)
    if (n === null) continue // folios alfanumericos quedan fuera del analisis
    numeros.add(n)
    if (maxArchivo === null || n > maxArchivo) maxArchivo = n
  }
  if (maxArchivo === null) {
    return { faltantes: [], totalFaltantes: 0, saltoAnormal: null, maxArchivo: null }
  }

  // Rango a revisar: desde el folio siguiente al maximo ya conocido (o desde
  // el minimo del archivo, la primera vez) hasta el maximo del archivo.
  let desde
  if (maxAnterior !== null && maxAnterior < maxArchivo) {
    desde = maxAnterior + 1
  } else if (maxAnterior === null) {
    desde = Math.min(...numeros)
  } else {
    // El archivo no rebasa lo ya conocido: no hay rango nuevo que revisar.
    return { faltantes: [], totalFaltantes: 0, saltoAnormal: null, maxArchivo }
  }

  if (maxArchivo - desde > SALTO_ANORMAL) {
    return {
      faltantes: [],
      totalFaltantes: maxArchivo - desde + 1 - numeros.size,
      saltoAnormal: { desde, hasta: maxArchivo },
      maxArchivo
    }
  }

  const faltantes = []
  let totalFaltantes = 0
  for (let n = desde; n <= maxArchivo; n++) {
    if (!numeros.has(n)) {
      totalFaltantes++
      if (faltantes.length < MAX_FALTANTES_LISTADOS) faltantes.push(n)
    }
  }
  return { faltantes, totalFaltantes, saltoAnormal: null, maxArchivo }
}

/** Registra el maximo del archivo de forma monotona (nunca lo reduce).
 *  Aunque maxArchivo sea null (el archivo no trajo folios numericos), SI se
 *  escribe el doc para refrescar actualizadoEn: es la referencia de "ahora"
 *  del SERVIDOR que usa la retencion de 15 dias, y no debe quedarse
 *  congelada solo porque un archivo en particular no traiga folios
 *  numericos. */
export async function actualizarMaxFolio(maxArchivo) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(REF_ESTADO())
    const actual = snap.exists() ? snap.data().maxFolioNumero : null
    const actualValido = typeof actual === 'number' && Number.isFinite(actual)
    const nuevoMax =
      maxArchivo === null
        ? (actualValido ? actual : null)
        : (actualValido ? Math.max(actual, maxArchivo) : maxArchivo)
    tx.set(REF_ESTADO(), {
      maxFolioNumero: nuevoMax,
      actualizadoEn: serverTimestamp(),
      ultimaLimpieza: snap.exists() ? (snap.data().ultimaLimpieza ?? null) : null
    })
  })
}

/** Purga foliosRuteo no vistos en ningun Excel en los ultimos 15 dias.
 *  Usa la hora del SERVIDOR (actualizadoEn recien escrito por
 *  actualizarMaxFolio) como referencia, no el reloj de la PC. Cada borrado
 *  se confirma en transaccion (releyendo cargadoEn) para no borrar un folio
 *  que otra carga acaba de refrescar. Corre a lo mucho una vez cada 20 horas.
 *  Devuelve cuantos folios se desecharon (0 si no toco correr). */
export async function limpiarRuteoViejo() {
  const estadoSnap = await getDoc(REF_ESTADO())
  if (!estadoSnap.exists() || !estadoSnap.data().actualizadoEn) return 0
  const ahoraServidor = estadoSnap.data().actualizadoEn // serverTimestamp reciente
  const ultima = estadoSnap.data().ultimaLimpieza
  const VEINTE_HORAS_MS = 20 * 60 * 60 * 1000
  if (ultima && ahoraServidor.toMillis() - ultima.toMillis() < VEINTE_HORAS_MS) return 0

  const corte = Timestamp.fromMillis(ahoraServidor.toMillis() - RETENCION_DIAS * 24 * 60 * 60 * 1000)
  let borrados = 0
  // Lotes paginados; nunca se cargan todos los vencidos en memoria.
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const lote = await getDocs(
      query(
        collection(db, 'foliosRuteo'),
        where('cargadoEn', '<', corte),
        orderBy('cargadoEn', 'asc'),
        limit(200)
      )
    )
    if (lote.empty) break
    for (const docViejo of lote.docs) {
      try {
        const seBorro = await runTransaction(db, async (tx) => {
          const fresco = await tx.get(docViejo.ref)
          if (!fresco.exists()) return false
          const cargadoEn = fresco.data().cargadoEn
          // Solo se borra si SIGUE vencido: una carga simultanea pudo
          // refrescarlo entre la consulta y este momento.
          if (cargadoEn && cargadoEn.toMillis() < corte.toMillis()) {
            tx.delete(docViejo.ref)
            return true
          }
          return false
        })
        if (seBorro) borrados++
      } catch (err) {
        console.error('[limpiezaRuteo] No se pudo borrar', docViejo.id, err)
      }
    }
    if (lote.size < 200) break
  }

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(REF_ESTADO())
    if (!snap.exists()) return
    tx.set(REF_ESTADO(), {
      maxFolioNumero: snap.data().maxFolioNumero ?? null,
      actualizadoEn: serverTimestamp(),
      ultimaLimpieza: serverTimestamp()
    })
  })
  return borrados
}
