// Escritura (upsert acumulativo) de los folios ya validados por
// parsearFoliosRuteo hacia foliosRuteo/{folio}. Replica la politica defensiva
// de escribir_folios_ruteo del servidor original:
//  - una fila mas VIEJA (Fecha Actualizacion menor) no pisa lo ya importado
//  - una fila SIN fecha no pisa un registro que si tiene fecha conocida
//  - contenido identico se sigue contando como 'sinCambios' en el resumen,
//    pero SI se reescribe: cargadoEn se refresca como "ultima vez visto en
//    un Excel" (ver comentario junto a mismoContenido() mas abajo), base de
//    la futura limpieza de folios con 15 dias sin aparecer en ningun Excel
// Cada folio va en SU PROPIA transaccion (leer-comparar-escribir atomico):
// dos cargas concurrentes no pueden hacer que una fila vieja gane la carrera.
// La carga es idempotente: si se corta a la mitad, re-subir el mismo archivo
// la completa sin danar nada.
import { doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

// Cada folio va en su propia transaccion (un viaje al servidor). Con 8 en
// paralelo, un Excel de ~3,000 folios tardaba varios minutos y la gente
// terminaba cerrando la pestana a media carga. 24 lo acorta ~3x sin acercarse
// a los limites de Firestore.
const CONCURRENCIA = 24

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
    (existente.descripcion ?? null) === (entrante.descripcion ?? null) &&
    (existente.modelo ?? null) === (entrante.modelo ?? null) &&
    (existente.color ?? null) === (entrante.color ?? null) &&
    millis(existente.fecha) === millis(entrante.fecha) &&
    millis(existente.fechaActualizacion) === millis(entrante.fechaActualizacion)
  )
}

// Campos de texto donde el entrante solo pisa lo existente si trae valor: un
// folio ya cargado desde un esquema que no trae estos datos (p.ej. 'Folios
// ruteo') no debe perder los que ya tenia (p.ej. cargados despues desde
// 'Seguimiento de Folios', o viceversa).
const CAMPOS_CONSERVABLES = ['descripcion', 'modelo', 'color', 'pedido', 'nombreGuia']

// Construye, con TODAS las llaves de contenido explicitas (?? null), el doc
// que conserva lo ya guardado. NUNCA se usa `...existente` directo: un doc
// viejo (creado antes de que existieran p.ej. descripcion/modelo/color) no
// trae esas llaves, y firestore.rules exige hasAll -- un `...existente` a
// secas dejaria esas llaves ausentes y el update seria rechazado.
function conservarExistente(existente) {
  return {
    folio: existente.folio ?? null,
    codigo: existente.codigo ?? null,
    docenas: existente.docenas ?? null,
    pares: existente.pares ?? null,
    total: existente.total ?? null,
    pedido: existente.pedido ?? null,
    nombreGuia: existente.nombreGuia ?? null,
    descripcion: existente.descripcion ?? null,
    modelo: existente.modelo ?? null,
    color: existente.color ?? null,
    fecha: existente.fecha ?? null,
    fechaActualizacion: existente.fechaActualizacion ?? null
  }
}

/** Sube los registros a Firestore. onProgreso(procesados, total) es opcional.
 *  Devuelve { nuevos, actualizados, sinCambios, omitidosViejos,
 *  omitidosSinFecha, enriquecidos, vistosSinCambios,
 *  errores: [{folio, mensaje}] }.
 *  foliosSoloVistos (opcional): Set de folios que el archivo trae pero NO
 *  son cargables (p.ej. docenas 0 del reporte Seguimiento) -- si el folio ya
 *  existe en foliosRuteo se refresca su cargadoEn (sigue "vivo" en el
 *  Excel), y si no existe no se hace nada. */
export async function cargarFoliosRuteo({ registros, archivo, uid, foliosSoloVistos, onProgreso }) {
  const resumen = {
    nuevos: 0,
    actualizados: 0,
    sinCambios: 0,
    omitidosViejos: 0,
    omitidosSinFecha: 0,
    enriquecidos: 0,
    vistosSinCambios: 0,
    errores: []
  }
  const entradas = Array.from(registros.values())
  const soloVistos = foliosSoloVistos ? Array.from(foliosSoloVistos) : []
  const total = entradas.length + soloVistos.length
  let procesados = 0
  let siguienteRegistro = 0
  let siguienteVisto = 0

  async function subirUno(datos) {
    const ref = doc(db, 'foliosRuteo', datos.folio)
    const fechaActNueva = aTimestamp(datos.fechaActualizacion)

    const resultado = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)

      if (!snap.exists()) {
        tx.set(ref, {
          folio: datos.folio,
          codigo: datos.codigo,
          docenas: datos.docenas,
          pares: datos.pares,
          total: datos.total,
          pedido: datos.pedido ?? null,
          nombreGuia: datos.nombreGuia ?? null,
          descripcion: datos.descripcion ?? null,
          modelo: datos.modelo ?? null,
          color: datos.color ?? null,
          fecha: aTimestamp(datos.fecha),
          fechaActualizacion: fechaActNueva,
          archivoOrigen: archivo,
          cargadoEn: serverTimestamp(),
          cargadoPorUid: uid
        })
        return 'nuevos'
      }

      const existente = snap.data()

      if (
        fechaActNueva !== null &&
        existente.fechaActualizacion != null &&
        fechaActNueva.toMillis() < existente.fechaActualizacion.toMillis()
      ) {
        // Se sigue escribiendo (con el contenido conservado, sin pisar nada
        // con el dato viejo del entrante) para refrescar cargadoEn: este
        // folio SIGUE apareciendo en un Excel vigente, la limpieza de 15
        // dias no debe considerarlo abandonado.
        tx.set(ref, {
          ...conservarExistente(existente),
          archivoOrigen: archivo,
          cargadoEn: serverTimestamp(),
          cargadoPorUid: uid
        })
        return 'omitidosViejos'
      }

      if (fechaActNueva === null && existente.fechaActualizacion != null) {
        // El entrante no trae fecha: no puede pisar un registro con fecha
        // conocida. Pero SI puede rellenar huecos de datos (p.ej. un folio
        // cargado antes desde 'Folios ruteo' sin descripcion/modelo/color,
        // enriquecido ahora por 'Seguimiento de Folios', o al reves).
        const relleno = {}
        for (const campo of CAMPOS_CONSERVABLES) {
          if ((existente[campo] ?? null) === null && (datos[campo] ?? null) !== null) {
            relleno[campo] = datos[campo]
          }
        }
        if (Object.keys(relleno).length === 0) {
          // Misma razon que la rama anterior: se reescribe para refrescar
          // cargadoEn aunque no haya nada nuevo que rellenar.
          tx.set(ref, {
            ...conservarExistente(existente),
            archivoOrigen: archivo,
            cargadoEn: serverTimestamp(),
            cargadoPorUid: uid
          })
          return 'omitidosSinFecha'
        }
        // fechaActualizacion queda IGUAL que la existente (no se toca): pasa
        // fechaActualizacionMonotona() en firestore.rules.
        tx.set(ref, {
          ...conservarExistente(existente),
          ...relleno,
          archivoOrigen: archivo,
          cargadoEn: serverTimestamp(),
          cargadoPorUid: uid
        })
        return 'enriquecidos'
      }

      const docNuevo = {
        folio: datos.folio,
        codigo: datos.codigo,
        docenas: datos.docenas,
        pares: datos.pares,
        total: datos.total,
        // El entrante manda solo si trae valor; si no, se conserva lo ya
        // guardado (nunca se pisa un dato conocido con null).
        pedido: datos.pedido ?? existente.pedido ?? null,
        nombreGuia: datos.nombreGuia ?? existente.nombreGuia ?? null,
        descripcion: datos.descripcion ?? existente.descripcion ?? null,
        modelo: datos.modelo ?? existente.modelo ?? null,
        color: datos.color ?? existente.color ?? null,
        fecha: aTimestamp(datos.fecha),
        fechaActualizacion: fechaActNueva,
        archivoOrigen: archivo,
        cargadoEn: serverTimestamp(),
        cargadoPorUid: uid
      }

      // Se escribe SIEMPRE, incluso sin cambios de contenido, para refrescar
      // cargadoEn: a partir de esta correccion, cargadoEn ya NO significa
      // "cuando se cargo por primera/ultima vez con cambios" sino "la ULTIMA
      // VEZ que este folio se vio en un Excel subido" (aunque ese Excel no
      // trajera nada nuevo). La futura limpieza de folios con 15 dias sin
      // verse en ningun Excel se basara en este campo. El resumen que ve el
      // usuario si distingue 'sinCambios' de 'actualizados'.
      tx.set(ref, docNuevo)
      return mismoContenido(existente, docNuevo) ? 'sinCambios' : 'actualizados'
    })
    resumen[resultado]++
  }

  // Folio presente en el archivo pero SIN datos cargables (p.ej. docenas 0
  // del reporte Seguimiento): si ya existe en foliosRuteo se refresca su
  // cargadoEn (conservando su contenido tal cual, con las mismas llaves
  // explicitas) para que la retencion de 15 dias no lo desconozca; si no
  // existe, no hay nada que hacer.
  async function refrescarSoloVisto(folioVisto) {
    const ref = doc(db, 'foliosRuteo', folioVisto)
    const seRefresco = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return false
      const existente = snap.data()
      tx.set(ref, {
        ...conservarExistente(existente),
        archivoOrigen: archivo,
        cargadoEn: serverTimestamp(),
        cargadoPorUid: uid
      })
      return true
    })
    if (seRefresco) resumen.vistosSinCambios++
  }

  // Un solo pool de CONCURRENCIA trabajadores atiende ambas colas (primero
  // los registros cargables, luego los solo-vistos) para no abrir el doble
  // de conexiones concurrentes a Firestore.
  async function trabajador() {
    while (true) {
      if (siguienteRegistro < entradas.length) {
        const datos = entradas[siguienteRegistro++]
        try {
          await subirUno(datos)
        } catch (err) {
          resumen.errores.push({ folio: datos.folio, mensaje: err.message || String(err) })
        }
        procesados++
        if (onProgreso) onProgreso(procesados, total)
        continue
      }
      if (siguienteVisto < soloVistos.length) {
        const folioVisto = soloVistos[siguienteVisto++]
        try {
          await refrescarSoloVisto(folioVisto)
        } catch (err) {
          resumen.errores.push({ folio: folioVisto, mensaje: err.message || String(err) })
        }
        procesados++
        if (onProgreso) onProgreso(procesados, total)
        continue
      }
      break
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA, total) }, () => trabajador())
  )
  return resumen
}
