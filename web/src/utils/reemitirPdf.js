// ANULAR Y REEMITIR una remision (PDF de salida) ya emitida.
//
// No es "editar el PDF": el registro original NUNCA se altera en su contenido
// (es la evidencia de lo que salio mal y lo que "Reimprimir original"
// reproduce). Lo que se hace es emitir una remision NUEVA que anula y
// sustituye a la anterior, con folio interno NUEVO -- reciclar el consecutivo
// dejaria dos papeles distintos con el mismo numero, que es exactamente el
// problema que Roberto reclamo el 2026-08-08.
//
// Requiere autorizacion 'editar_pdf' de Roberto SOBRE ESE REGISTRO, y la
// autorizacion se pide junto con la propuesta concreta (que maquila y que
// folios): Roberto aprueba el cambio exacto, no un permiso abierto.
//
// LIMITE IMPORTANTE (decision consciente): esto mueve DATOS, no bultos. Si el
// papel v1 ya salio de la planta, quitarle folios no los regresa fisicamente:
// eso se resuelve en piso. La app lo dice explicitamente al confirmar.
import {
  collection,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { reservarFolioInterno } from './folioInterno'
import { generarPdfSalida, descargarPdf } from './pdf'
import { generarExcelSalida, descargarArchivo } from './excelSalida'
import { consumirAutorizacion, registrarCambio } from './auditoria'
import { armarSalidaPortal } from './portalMaquila'
import { compararAscendente } from './texto'

export class ErrorReemision extends Error {}

const LOTE_TX = 100

/**
 * Ejecuta la reemision.
 *  registro: el doc de pdfsGenerados que se anula (con id)
 *  solicitud: la solicitud aprobada (con id y propuesta)
 *  maquila: { id, nombre, direccion } destino nuevo (o el mismo)
 *  folios: lista final de folios que van en la remision corregida
 *  usuario: { uid, nombre }
 * Devuelve { folioInternoNuevo, registroNuevoId, desmarcados, marcados, avisos }
 */
export async function reemitirPdf({ registro, solicitud, maquila, folios, usuario }) {
  if (!registro?.id) throw new ErrorReemision('Falta el registro original.')
  if (registro.anuladaPorRegistroId) {
    throw new ErrorReemision(
      `Esta remision ya fue anulada y sustituida por el folio interno ${registro.anuladaFolioInterno}. ` +
        'Corrige la version vigente, no esta.'
    )
  }
  if (!maquila?.id || !maquila?.nombre) throw new ErrorReemision('Elige la maquila destino.')
  if (!maquila.direccion) {
    throw new ErrorReemision(
      `La maquila "${maquila.nombre}" no tiene direccion registrada: agregasela en Maquilas.`
    )
  }
  const foliosFinales = [...new Set(folios.map((f) => String(f)))].sort(compararAscendente)
  if (foliosFinales.length === 0) throw new ErrorReemision('La remision corregida no puede quedar vacia.')

  // Se valida ANTES de reservar el folio interno: si no, se quemaria un
  // consecutivo para descubrir despues que las reglas rechazan el registro.
  if (foliosFinales.length > 200) {
    throw new ErrorReemision(
      `Maximo 200 folios por remision (la correccion quedaria con ${foliosFinales.length}).`
    )
  }

  // Igual que al emitir: una remision de prueba solo lleva folios de prueba.
  // Aqui es la unica defensa posible -- las reglas no pueden mirar dentro de
  // la lista de folios.
  if (registro.esPrueba === true) {
    const ajenos = foliosFinales.filter((f) => !/^ZZTEST/i.test(f))
    if (ajenos.length) {
      throw new ErrorReemision(
        `Esta remision es de PRUEBA: solo puede llevar folios ZZTEST. ` +
          `Sobran: ${ajenos.slice(0, 5).join(', ')}${ajenos.length > 5 ? ` y ${ajenos.length - 5} mas` : ''}.`
      )
    }
  }

  const folioInternoOriginal = Number(registro.encabezado?.folioInterno)
  if (!Number.isFinite(folioInternoOriginal)) {
    throw new ErrorReemision(
      'La remision original no tiene folio interno numerico (es de antes del consecutivo): no se puede reemitir automaticamente.'
    )
  }

  const avisos = []

  // ---- 1. Releer cada folio final para congelar su estado ACTUAL ----
  // Igual que al emitir: el papel debe reflejar el peso vigente, no el del
  // snapshot viejo.
  const frescos = []
  const inexistentes = []
  const conflictos = []
  for (const folio of foliosFinales) {
    const snap = await getDoc(doc(db, 'bultos', folio))
    if (!snap.exists()) {
      inexistentes.push(folio)
      continue
    }
    const b = snap.data()
    // Un folio que ya salio en OTRO PDF (distinto del que se anula) no se
    // puede meter aqui: quedaria en dos remisiones vigentes.
    const marcadoPor = b.pdfFolioInterno ?? null
    if (b.pdfGeneradoEn && marcadoPor !== null && marcadoPor !== folioInternoOriginal) {
      conflictos.push({ folio, folioInterno: marcadoPor })
      continue
    }
    frescos.push({
      folio: b.folio,
      pesoGramos: b.pesoGramos,
      producto: b.producto || null,
      cruce: b.cruce || null,
      capturadoEn: b.creadoEn ?? null
    })
  }
  if (inexistentes.length > 0) {
    throw new ErrorReemision(
      `Estos folios ya no existen (¿eliminados?): ${inexistentes.join(', ')}. Quitalos de la seleccion.`
    )
  }
  if (conflictos.length > 0) {
    throw new ErrorReemision(
      'Estos folios ya salieron en OTRA remision vigente y no pueden ir en esta: ' +
        conflictos.map((c) => `${c.folio} (folio interno ${c.folioInterno})`).join(', ') +
        '. Corrige esa remision primero.'
    )
  }
  frescos.sort((a, b) => compararAscendente(a.folio, b.folio))

  // ---- 2. Reservar folio interno NUEVO ----
  // El mundo lo manda el REGISTRO que se esta corrigiendo, no quien corrige:
  // la remision nueva sustituye a la vieja, asi que tiene que nacer en el
  // mismo consecutivo. Las reglas exigen lo mismo (mismoMundo), asi que si no
  // coinciden hay que decirlo ANTES de quemar un numero, no despues.
  const esPruebaRegistro = registro.esPrueba === true
  if (esPruebaRegistro !== (usuario.esPrueba === true)) {
    throw new ErrorReemision(
      esPruebaRegistro
        ? 'Esta remision es de PRUEBA: solo se puede corregir desde una cuenta de prueba.'
        : 'Esta es una remision REAL y estas en una cuenta de prueba: no se puede corregir desde aqui.'
    )
  }
  const folioInternoNuevo = await reservarFolioInterno(esPruebaRegistro ? 'prueba' : 'real', null)

  // ---- 3. Armar el papel, con la leyenda de que sustituye al anterior ----
  const fechaTexto = new Date().toLocaleDateString('es-MX')
  const revision = Number(registro.reemision?.revision || 1) + 1
  const encabezado = {
    folioInterno: String(folioInternoNuevo),
    fechaSolicitud: fechaTexto,
    areaRecibe: String(maquila.nombre).slice(0, 55),
    direccionEnvio: String(maquila.direccion || '').slice(0, 60),
    conceptoSalida: String(registro.encabezado?.conceptoSalida || '').slice(0, 60),
    // La leyenda va en observaciones: es el campo libre que ya imprime el
    // formato, y asi el papel declara a que remision sustituye.
    observaciones: `CORRIGE Y ANULA AL FOLIO INTERNO ${folioInternoOriginal} (rev. ${revision}). ${
      solicitud?.motivo || ''
    }`.slice(0, 120)
  }

  let blob
  let nombreArchivo
  try {
    ;({ blob, nombreArchivo } = generarPdfSalida({
      capturas: frescos,
      operador: usuario.nombre || 'Estacion',
      fecha: fechaTexto,
      encabezado,
      esPrueba: esPruebaRegistro
    }))
  } catch (err) {
    throw new ErrorReemision(
      `El folio interno ${folioInternoNuevo} quedo reservado y NO se usara (anotalo como salto). ` +
        `No se pudo armar el papel: ${err.message || err}`
    )
  }

  // ---- 4. Bitacora del nuevo registro + marcador de anulacion, en LOTE ----
  // Todo-o-nada: nunca queda una reemision sin anular su original, ni un
  // original anulado apuntando a un registro que no existe.
  const refNuevo = doc(collection(db, 'pdfsGenerados'))
  try {
    const lote = writeBatch(db)
    lote.set(refNuevo, {
      generadoPor: usuario.nombre || 'Estacion',
      maquila: { id: maquila.id, nombre: maquila.nombre },
      folios: frescos.map((c) => c.folio),
      totalFolios: frescos.length,
      pesoTotalGramos: frescos.reduce((acc, c) => acc + (c.pesoGramos || 0), 0),
      capturas: frescos,
      encabezado,
      fechaTexto,
      creadoEn: serverTimestamp(),
      operadorUid: usuario.uid,
      // Se hereda del original (ver arriba): la remision corregida vive en el
      // mismo mundo que la que anula.
      ...(esPruebaRegistro ? { esPrueba: true } : {}),
      reemision: {
        anulaRegistroId: registro.id,
        anulaFolioInterno: folioInternoOriginal,
        revision,
        motivo: String(solicitud?.motivo || 'correccion autorizada').slice(0, 300),
        solicitudId: String(solicitud?.id || '')
      }
    })
    lote.update(doc(db, 'pdfsGenerados', registro.id), {
      anuladaPorRegistroId: refNuevo.id,
      anuladaFolioInterno: folioInternoNuevo,
      anuladaEn: serverTimestamp()
    })

    // El PORTAL de la maquila va en el MISMO lote, o la maquila seguiria
    // viendo como vigente un papel ya anulado (y podria firmarlo), mientras la
    // remision que de verdad va en camino no existiria para ella.
    lote.set(doc(db, 'portalMaquila', maquila.id, 'salidas', refNuevo.id), {
      ...armarSalidaPortal({
        registroId: refNuevo.id,
        maquila,
        capturas: frescos,
        folioInterno: folioInternoNuevo,
        fechaTexto,
        emitidaPorNombre: usuario.nombre || 'Embarques'
      }),
      creadoEn: serverTimestamp()
    })
    // Se marca ANULADA la copia vieja. Si la correccion cambio de maquila, la
    // copia vieja esta en el portal de la maquila ANTERIOR: por eso se usa
    // registro.maquila.id y no maquila.id.
    const maquilaAnterior = registro.maquila?.id
    if (maquilaAnterior) {
      lote.update(doc(db, 'portalMaquila', maquilaAnterior, 'salidas', registro.id), {
        anuladaPorRegistroId: refNuevo.id,
        anuladaEn: serverTimestamp()
      })
    }

    await lote.commit()
  } catch (err) {
    throw new ErrorReemision(
      `No se pudo registrar la correccion (el folio interno ${folioInternoNuevo} quedo reservado sin usarse: ` +
        `anotalo como salto) y NO se descargo ningun papel: ${err.message || err}`
    )
  }

  // ---- 5. Reasignar marcadores de bultos ----
  // QUITADOS: solo si su marcador sigue apuntando a la remision anulada.
  // AGREGADOS/conservados: se marcan con el folio interno nuevo.
  const foliosAntes = new Set((registro.folios || []).map(String))
  const foliosDespues = new Set(frescos.map((c) => c.folio))
  const quitados = [...foliosAntes].filter((f) => !foliosDespues.has(f))
  let desmarcados = 0
  let marcados = 0

  const foliosNoLiberados = []
  for (let i = 0; i < quitados.length; i += LOTE_TX) {
    const lote = quitados.slice(i, i + LOTE_TX)
    // Cada lote en su PROPIO try: si uno truena, los demas siguen. Antes un
    // solo folio conflictivo dejaba sin liberar todo el resto.
    try {
      desmarcados += await runTransaction(db, async (tx) => {
        const lecturas = []
        for (const folio of lote) {
          const ref = doc(db, 'bultos', folio)
          lecturas.push({ folio, ref, snap: await tx.get(ref) })
        }
        let hechos = 0
        for (const { ref, snap } of lecturas) {
          if (!snap.exists()) continue
          const b = snap.data()
          // Solo se desmarca si sigue apuntando a la remision anulada: si ya
          // salio en otra posterior, no se toca.
          if ((b.pdfFolioInterno ?? null) !== folioInternoOriginal) continue
          // Update PARCIAL borrando los campos del marcador: reescribir el
          // documento completo exigiria operadorUid == quien corrige, o sea
          // falsearia quien peso el bulto (y las reglas lo rechazarian).
          tx.update(ref, {
            pdfGeneradoEn: deleteField(),
            pdfFolioInterno: deleteField(),
            pdfRegistroId: deleteField(),
            actualizadoEn: serverTimestamp()
          })
          hechos += 1
        }
        return hechos
      })
    } catch (err) {
      console.error('[reemitirPdf] No se pudo liberar un lote de folios quitados:', err)
      foliosNoLiberados.push(...lote)
    }
  }
  if (foliosNoLiberados.length > 0) {
    avisos.push(
      `Estos folios que quitaste SIGUEN marcados como enviados y no volveran solos a Pendientes: ` +
        `${foliosNoLiberados.join(', ')}. Avisale a Roberto para liberarlos.`
    )
  }

  try {
    const aMarcar = frescos.map((c) => c.folio)
    for (let i = 0; i < aMarcar.length; i += LOTE_TX) {
      const lote = aMarcar.slice(i, i + LOTE_TX)
      marcados += await runTransaction(db, async (tx) => {
        const lecturas = []
        for (const folio of lote) {
          const ref = doc(db, 'bultos', folio)
          lecturas.push({ folio, ref, snap: await tx.get(ref) })
        }
        let hechos = 0
        for (const { ref, snap } of lecturas) {
          if (!snap.exists()) continue
          const b = snap.data()
          const marcadoPor = b.pdfFolioInterno ?? null
          // No pisar un folio que quedo marcado por una remision AJENA.
          if (b.pdfGeneradoEn && marcadoPor !== null && marcadoPor !== folioInternoOriginal) continue
          tx.update(ref, {
            pdfGeneradoEn: serverTimestamp(),
            pdfFolioInterno: folioInternoNuevo,
            // Que registro exacto lo marco: permite liberar SOLO los folios de
            // esta remision si algun dia se corrige.
            pdfRegistroId: refNuevo.id
          })
          hechos += 1
        }
        return hechos
      })
    }
  } catch (err) {
    console.error('[reemitirPdf] No se pudieron marcar los folios de la reemision:', err)
    avisos.push(
      'Los folios de la remision corregida NO se marcaron como enviados y seguiran en Pendientes ' +
        `aunque el folio interno ${folioInternoNuevo} ya existe. NO los vuelvas a mandar.`
    )
  }

  // ---- 6. Consumir la autorizacion (de un solo uso) ----
  await consumirAutorizacion(registro.id, 'editar_pdf', solicitud?.id || null)

  // ---- 7. Entregar papel y Excel, con nombre que dice la revision ----
  descargarPdf(blob, nombreArchivo.replace(/\.pdf$/, `_folio${folioInternoNuevo}_rev${revision}.pdf`))
  try {
    const excel = await generarExcelSalida({ capturas: frescos, fecha: fechaTexto })
    descargarArchivo(
      excel.blob,
      excel.nombreArchivo.replace(/\.xlsx$/, `_folio${folioInternoNuevo}_rev${revision}.xlsx`)
    )
  } catch (err) {
    console.error('[reemitirPdf] No se pudo generar el Excel de la reemision:', err)
    avisos.push('El Excel de migracion NO se genero; sacalo con "Reimprimir original" en Historial.')
  }

  // ---- 8. Bitacora por folio afectado (queda el rastro del cambio) ----
  for (const folio of quitados) {
    await registrarCambio({
      folio,
      accion: 'editar_peso',
      antes: { pdfFolioInterno: folioInternoOriginal },
      despues: { pdfFolioInterno: null },
      motivo: `Quitado de la remision ${folioInternoOriginal} al corregirla (rev. ${revision}): ${
        solicitud?.motivo || ''
      }`.slice(0, 300),
      autorizacionId: solicitud?.id || null,
      usuario
    })
  }

  if (String(registro.maquila?.nombre || '') !== String(maquila.nombre)) {
    avisos.push(
      `El destino cambio de "${registro.maquila?.nombre || '-'}" a "${maquila.nombre}": ` +
        'si el papel anterior ya salio de la planta, avisa en piso.'
    )
  }

  return { folioInternoNuevo, registroNuevoId: refNuevo.id, revision, desmarcados, marcados, avisos }
}
