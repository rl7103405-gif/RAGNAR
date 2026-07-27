// Escritura (upsert acumulativo) de los folios ya validados por
// parsearFoliosRuteo hacia foliosRuteo/{folio}. Replica la politica defensiva
// de escribir_folios_ruteo del servidor original:
//  - una fila mas VIEJA (Fecha Actualizacion menor) no pisa lo ya importado
//  - una fila SIN fecha no pisa un registro que si tiene fecha conocida
//  - contenido identico no consume otra escritura
// Cada folio va en SU PROPIA transaccion (leer-comparar-escribir atomico):
// dos cargas concurrentes no pueden hacer que una fila vieja gane la carrera.
// La carga es idempotente: si se corta a la mitad, re-subir el mismo archivo
// la completa sin danar nada.
import { doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const CONCURRENCIA = 8

function aTimestamp(fecha) {
  return fecha instanceof Date ? Timestamp.fromDate(fecha) : null
}

function mismoContenido(existente, entrante) {
  const millis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null)
  return (
    (existente.codigo ?? null) === (entrante.codigo ?? null) &&
    (existente.docenas ?? null) === (entrante.docenas ?? null) &&
    (existente.pares ?? null) === (entrante.pares ?? null) &&
    (existente.total ?? null) === (entrante.total ?? null) &&
    (existente.pedido ?? null) === (entrante.pedido ?? null) &&
    (existente.nombreGuia ?? null) === (entrante.nombreGuia ?? null) &&
    millis(existente.fecha) === millis(entrante.fecha) &&
    millis(existente.fechaActualizacion) === millis(entrante.fechaActualizacion)
  )
}

/** Sube los registros a Firestore. onProgreso(procesados, total) es opcional.
 *  Devuelve { nuevos, actualizados, sinCambios, omitidosViejos,
 *  omitidosSinFecha, errores: [{folio, mensaje}] }. */
export async function cargarFoliosRuteo({ registros, archivo, uid, onProgreso }) {
  const resumen = {
    nuevos: 0,
    actualizados: 0,
    sinCambios: 0,
    omitidosViejos: 0,
    omitidosSinFecha: 0,
    errores: []
  }
  const entradas = Array.from(registros.values())
  let procesados = 0
  let siguiente = 0

  async function subirUno(datos) {
    const ref = doc(db, 'foliosRuteo', datos.folio)
    const docNuevo = {
      folio: datos.folio,
      codigo: datos.codigo,
      docenas: datos.docenas,
      pares: datos.pares,
      total: datos.total,
      pedido: datos.pedido,
      nombreGuia: datos.nombreGuia,
      fecha: aTimestamp(datos.fecha),
      fechaActualizacion: aTimestamp(datos.fechaActualizacion),
      archivoOrigen: archivo,
      cargadoEn: serverTimestamp(),
      cargadoPorUid: uid
    }
    const resultado = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) {
        tx.set(ref, docNuevo)
        return 'nuevos'
      }
      const existente = snap.data()
      if (
        docNuevo.fechaActualizacion !== null &&
        existente.fechaActualizacion != null &&
        docNuevo.fechaActualizacion.toMillis() < existente.fechaActualizacion.toMillis()
      ) {
        return 'omitidosViejos'
      }
      if (docNuevo.fechaActualizacion === null && existente.fechaActualizacion != null) {
        return 'omitidosSinFecha'
      }
      if (mismoContenido(existente, docNuevo)) {
        return 'sinCambios'
      }
      tx.set(ref, docNuevo)
      return 'actualizados'
    })
    resumen[resultado]++
  }

  async function trabajador() {
    while (siguiente < entradas.length) {
      const datos = entradas[siguiente++]
      try {
        await subirUno(datos)
      } catch (err) {
        resumen.errores.push({ folio: datos.folio, mensaje: err.message || String(err) })
      }
      procesados++
      if (onProgreso) onProgreso(procesados, entradas.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA, entradas.length) }, () => trabajador())
  )
  return resumen
}
