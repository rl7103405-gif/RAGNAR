// AVANCE DE LO ENCARGADO A LAS MAQUILAS.
//
// Roberto, 2026-09-10: "me gustaria tener un apartado en las maquilas de
// tareas encargadas, e ir viendo el avance como lo tenemos en las tareas de
// America". Funcion PURA: recibe tareas y recepciones, no toca Firestore, para
// poder probarla sin la app.
//
// Dos lecturas del mismo avance, porque responden preguntas distintas:
//
//   1. POR ETAPA: en que va cada tarea (por publicar, sin empezar, en proceso,
//      terminada por la maquila, confirmada) y si ya se paso de la fecha.
//
//   2. EN DOCENAS: lo que Producto Terminado (Valeria) RECIBIO de vuelta.
//
// COMO SE LIGA LO RECIBIDO CON LA TAREA. El acta de PT guarda UN RENGLON POR
// ORDEN DE TRABAJO (recepcionPT.js, desde el 2026-09-03: "a Valeria solo le
// sirve el consolidado"). Los codigos van dentro como lista descriptiva: no
// dicen cuantas docenas de cada codigo llegaron. Por eso:
//
//   - La llave es MAQUILA + OT. No por codigo: repartir por codigo inventaria
//     una distribucion que nadie conto.
//   - El tope es por TAREA completa (lo recibido de la OT, hasta la suma de lo
//     pedido), no por renglon.
//   - Una tarea que no esta TODA en docenas no se mide: si pide packs y
//     docenas, no hay forma de saber que parte del total de la OT es cual.
//     Se dice "no se mide", nunca un cero.
//   - Una tarea sin OT no se puede ligar: igual, "no se mide".
//
// El servidor aparta cada OT para UNA sola tarea viva por maquila, asi que el
// caso comun es una tarea por llave. Si hay varias (una vieja terminada y otra
// nueva con la misma OT), se llena primero la mas vieja y solo cuenta lo
// recibido desde que cada una se publico.
//
// ACTAS REPETIDAS. Valeria puede volver a recibir la misma salida (la pantalla
// avisa pero deja). Dos actas de la MISMA salida son una correccion, no dos
// entregas: de cada OT de esa salida cuenta el conteo mas reciente que SI traiga
// numero. Por renglon y no por acta: la segunda acta se abre vacia y Valeria
// puede recontar solo una OT; si se tomara el acta entera, se borrarian las
// demas. Actas de salidas distintas si suman (entregas parciales).
//
// Las actas viejas (antes del 2026-09-03) traen renglones por codigo, sin OT:
// no se pueden ligar y se ignoran.

// Copia de ESTADOS_VIVOS de tareasEnsamble.js. No se importa: ese archivo trae
// el cliente de Firebase y esta funcion tiene que poder probarse sola en Node.
const ESTADOS_VIVOS = ['preparando', 'abierta', 'iniciada', 'declarada']

const ETAPAS = {
  preparando: 'Por publicar',
  abierta: 'Sin empezar',
  iniciada: 'En proceso',
  declarada: 'Por confirmar',
  terminada: 'Terminada',
  cancelada: 'Cancelada'
}

/** Milisegundos de un Timestamp de Firestore, un Date o un numero. */
export function aMs(ts) {
  if (ts == null) return null
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === 'number') return ts
  return null
}

/** Hoy como 'AAAA-MM-DD' en hora de Mexico (fechaRequerida se guarda asi). */
export function hoyEnMexico(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
}

/** Dias entre dos fechas 'AAAA-MM-DD' (nunca negativo). */
function diasEntre(desde, hasta) {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86400000)) : 0
}

const normalizaOt = (ot) => String(ot ?? '').trim().toUpperCase()
const clave = (maquilaId, ot) => `${maquilaId}|${normalizaOt(ot)}`
// La unidad tiene que decir docenas: la app crea tareas con 'packs' por
// defecto, asi que una unidad vacia NO se asume docenas.
const esDocenas = (r) => String(r?.unidad || '').trim().toLowerCase() === 'docenas'

/**
 * @param {object[]} tareas       tareas de ensamble de todas las maquilas (con maquilaId)
 * @param {object[]} recepciones  documentos de recepcionesPT (ya filtrados por mundo)
 * @param {{hoy?: string, ahora?: number}} opciones
 */
export function avanceDeTareasEnsamble(tareas, recepciones, opciones = {}) {
  const hoy = opciones.hoy || hoyEnMexico()
  const ahora = opciones.ahora ?? Date.now()

  // 1) De cada salida + OT, el conteo mas reciente que traiga numero.
  const conteo = new Map()
  for (const rec of recepciones || []) {
    const cuando = aMs(rec?.recibidoEn)
    if (cuando == null) continue
    const salida = rec.documentoId || rec.id || String(cuando)
    for (const r of rec.renglones || []) {
      if (!r || r.docenasRecibidas == null || r.docenasRecibidas === '' || !normalizaOt(r.ot)) continue
      const docenas = Number(r.docenasRecibidas)
      if (!Number.isFinite(docenas) || docenas < 0) continue
      const k = `${rec.maquilaId}|${salida}|${normalizaOt(r.ot)}`
      const previo = conteo.get(k)
      if (!previo || cuando > previo.cuando) {
        conteo.set(k, { maquilaId: rec.maquilaId, ot: r.ot, cuando, docenas })
      }
    }
  }

  // 2) Lo recibido por maquila + OT, en orden de llegada.
  const bolsa = new Map()
  for (const c of conteo.values()) {
    if (c.docenas <= 0) continue
    const k = clave(c.maquilaId, c.ot)
    if (!bolsa.has(k)) bolsa.set(k, [])
    bolsa.get(k).push({ cuando: c.cuando, restante: c.docenas })
  }
  for (const lista of bolsa.values()) lista.sort((a, b) => a.cuando - b.cuando)

  // 3) Las tareas, de la mas vieja a la mas nueva: la vieja come primero.
  const inicio = (t) => aMs(t.publicadaEn) ?? aMs(t.creadoEn)
  const ordenadas = [...(tareas || [])]
    .filter((t) => t && t.estado !== 'cancelada')
    .sort((a, b) => (inicio(a) ?? 0) - (inicio(b) ?? 0))

  const filas = ordenadas.map((t) => {
    const desde = inicio(t)
    const renglones = t.renglones || []
    const cantidadTotal = renglones.reduce((a, r) => a + (Number(r?.cantidad) || 0), 0)
    const cantidadesSanas = renglones.every((r) => Number.isFinite(Number(r?.cantidad)) && Number(r?.cantidad) > 0)

    let motivo = ''
    if (!normalizaOt(t.ot)) motivo = 'sin OT'
    else if (!renglones.length || !cantidadesSanas || cantidadTotal <= 0) motivo = 'sin cantidades'
    else if (!renglones.every(esDocenas)) motivo = 'no esta en docenas'
    // Sin ninguna fecha no se sabe desde cuando contar: no se le atribuye nada
    // (si no, una recepcion de hace un anio le sumaria).
    else if (desde == null) motivo = 'sin fecha de encargo'

    const meta = motivo ? 0 : cantidadTotal
    let recibidas = 0
    if (!motivo) {
      let falta = meta
      for (const pieza of bolsa.get(clave(t.maquilaId, t.ot)) || []) {
        if (falta <= 0) break
        if (pieza.cuando < desde || pieza.restante <= 0) continue
        const toma = Math.min(pieza.restante, falta)
        pieza.restante -= toma
        falta -= toma
      }
      recibidas = meta - falta
    }

    const viva = ESTADOS_VIVOS.includes(t.estado)
    return {
      id: t.id,
      maquilaId: t.maquilaId,
      ot: t.ot || '',
      destino: t.destino || '',
      titulo: t.titulo || '',
      estado: t.estado,
      etapa: ETAPAS[t.estado] || t.estado || '',
      viva,
      publicada: aMs(t.publicadaEn) != null,
      fechaRequerida: t.fechaRequerida || '',
      atrasada: viva && Boolean(t.fechaRequerida) && String(t.fechaRequerida) < hoy,
      // Dias de CALENDARIO en hora de Mexico, desde que la maquila la ve
      // (publicadaEn); si aun no se publica, desde que se creo.
      dias: desde != null ? diasEntre(hoyEnMexico(new Date(desde)), hoyEnMexico(new Date(ahora))) : 0,
      medible: !motivo,
      motivo,
      meta,
      recibidas,
      porcentaje: motivo ? null : Math.min(100, (recibidas / meta) * 100)
    }
  })

  const resumir = (lista) => {
    const vivas = lista.filter((f) => f.viva)
    const medibles = vivas.filter((f) => f.medible)
    const meta = medibles.reduce((a, f) => a + f.meta, 0)
    const recibidas = medibles.reduce((a, f) => a + f.recibidas, 0)
    return {
      vivas: vivas.length,
      atrasadas: vivas.filter((f) => f.atrasada).length,
      meta,
      recibidas,
      porcentaje: meta > 0 ? Math.min(100, (recibidas / meta) * 100) : null,
      fueraDelCalculo: vivas.length - medibles.length
    }
  }

  const porMaquila = new Map()
  for (const f of filas) {
    if (!porMaquila.has(f.maquilaId)) porMaquila.set(f.maquilaId, [])
    porMaquila.get(f.maquilaId).push(f)
  }
  const maquilas = [...porMaquila.entries()]
    .map(([maquilaId, lista]) => ({
      maquilaId,
      tareas: lista.sort((a, b) => String(a.ot).localeCompare(String(b.ot), 'es', { numeric: true })),
      ...resumir(lista)
    }))
    .sort((a, b) => b.vivas - a.vivas || String(a.maquilaId).localeCompare(String(b.maquilaId)))

  const cuenta = (e) => filas.filter((f) => f.estado === e).length
  return {
    resumen: {
      ...resumir(filas),
      porPublicar: cuenta('preparando'),
      sinEmpezar: cuenta('abierta'),
      enProceso: cuenta('iniciada'),
      porConfirmar: cuenta('declarada')
    },
    maquilas
  }
}
