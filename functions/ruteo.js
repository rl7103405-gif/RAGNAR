/**
 * Buzon del ruteo: lo que Atalanta manda desde SQL Server entra aqui y cae en
 * `foliosRuteo/{folio}`, la MISMA coleccion que llena el Excel de America.
 *
 * Por que en la misma coleccion y no en una aparte: todo RAGNAR ya lee de ahi
 * (captura, cruce de bultos, metas de tareas, arbol de ordenes). Una coleccion
 * paralela obligaria a tocar todos esos consumidores y a decidir cual gana en
 * cada pantalla. Aqui las dos fuentes conviven en el mismo documento, con una
 * politica de quien pisa a quien que replica la de `cargarRuteo.js`.
 *
 * ADVERTENCIA: ESTA FUNCION USA EL ADMIN SDK, QUE SE SALTA firestore.rules.
 * Las defensas que protegen esta coleccion del cliente (ruteoValido,
 * fechaActualizacionMonotona) NO aplican aqui. Por eso:
 *   - se valida TODO el payload antes de escribir un solo documento;
 *   - se respeta el contrato de `ruteoValido` (las 15 claves exactas, tipos y
 *     longitudes), para no dejar documentos que el cliente ya no pueda actualizar;
 *   - se escribe con PRECONDICION DE VERSION (lastUpdateTime): si America
 *     guardo algo entre nuestra lectura y nuestra escritura, la escritura falla
 *     y ese folio se reintenta releyendo, en vez de revertirle su carga en
 *     silencio.
 *
 * La API key vive en Secret Manager (RUTEO_API_KEY), nunca en el repo.
 * Rotarla:  firebase functions:secrets:set RUTEO_API_KEY
 *           firebase deploy --only functions:ruteoImport
 * (avisar a Atalanta antes: su sync falla con 401 hasta que la cambien)
 */
const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { Timestamp } = require('firebase-admin/firestore')
const { createHash, timingSafeEqual } = require('crypto')

const RUTEO_API_KEY = defineSecret('RUTEO_API_KEY')

// Allowlist. Hoy solo entra el ruteo; cualquier otra tabla es una decision
// consciente que se toma agregandola aqui, no algo que Atalanta active solo
// cambiando su payload.
const TABLAS_PERMITIDAS = ['codigos_ruta']

const MAX_REGISTROS = 5000
const PATRON_FOLIO = /^[A-Za-z0-9._-]+$/
// Codigos de error de gRPC que significan "alguien mas escribio este documento":
// no son fallas nuestras, se reintentan releyendo.
const ALREADY_EXISTS = 6
const FAILED_PRECONDITION = 9
const ABORTED = 10

// Campos que SICAP no trae y que solo pueden venir del Excel de America
// (reporte "Seguimiento de Folios"). Nunca se pisan desde aqui.
// `descripcion` esta en la lista A PROPOSITO aunque CodigosDeRuta si traiga una
// columna con ese nombre: en el SQL solo tiene tres valores distintos en 3,104
// filas (el texto "Ruteo manual por seleccion de codigos", un asterisco y
// vacio), o sea que no describe el producto. Mandarla pisaria descripciones
// buenas con ruido.
const SOLO_DEL_EXCEL = ['descripcion', 'modelo', 'color', 'nombreGuia']

/** Comparacion en tiempo constante: un `===` filtra la clave caracter por
 *  caracter ante quien mida tiempos de respuesta. */
function claveValida(recibida, esperada) {
  if (typeof recibida !== 'string' || !esperada) return false
  const a = createHash('sha256').update(recibida).digest()
  const b = createHash('sha256').update(esperada).digest()
  return timingSafeEqual(a, b)
}

/** Misma canonizacion que `validacion.js` del cliente: trim, patron y, si el
 *  folio es todo numerico, se le quitan los ceros a la izquierda CON TEXTO
 *  (no con Number: un folio de 18+ digitos pierde precision en punto flotante).
 *  Si las dos fuentes no canonizan igual, 000123 y 123 acaban siendo dos
 *  documentos distintos para el mismo folio. */
function canonizarFolio(valor) {
  const folio = String(valor == null ? '' : valor).trim()
  if (!folio || folio.length > 50 || !PATRON_FOLIO.test(folio)) return null
  return /^\d+$/.test(folio) ? folio.replace(/^0+(?=\d)/, '') : folio
}

/** El Excel guarda el codigo en MAYUSCULAS (importarFoliosRuteo.js). Las
 *  consultas de tareas comparan exacto, asi que un codigo en minuscula desde
 *  SQL simplemente no apareceria. */
function canonizarCodigo(valor) {
  const codigo = String(valor == null ? '' : valor).trim().toUpperCase()
  if (!codigo || codigo.length > 60) return null
  return codigo
}

/**
 * Las fechas llegan como texto ISO SIN zona (2026-07-15T10:45:47, con o sin
 * fraccion de segundo). Se guardan como HORA DE PARED codificada en UTC, que
 * es exactamente lo que hace el Excel: SheetJS construye el Date con
 * Date.UTC(componentes), asi que la celda de las 10:45 queda como 10:45Z.
 *
 * OJO: NO es el instante real de Mexico, y esta bien que no lo sea. Si aqui se
 * convirtiera desde America/Mexico_City, el mismo momento quedaria 6 horas
 * adelante del que guardo el Excel, y `fechaActualizacion` —que se usa como
 * VERSION para decidir quien pisa a quien— declararia "mas nuevo" a lo que solo
 * viene de otra fuente: un Excel legitimamente posterior seria rechazado.
 *
 * Tampoco se usa `new Date(texto)`: un ISO sin zona se interpreta segun la zona
 * del proceso, y Cloud Run corre en UTC mientras una prueba local corre en
 * Mexico — el mismo codigo daria resultados distintos segun donde se ejecute.
 */
function aTimestampDePared(valor) {
  if (valor == null || valor === '' || typeof valor !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(valor.trim())
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  const hora = Number(m[4])
  const minuto = Number(m[5])
  const seg = Number(m[6])
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  if (hora > 23 || minuto > 59 || seg > 59) return null
  // Rango de cordura: una fecha corrupta que caiga en el futuro lejano
  // BLOQUEARIA las escrituras del cliente hasta esa fecha, porque
  // fechaActualizacionMonotona() exige que el valor nunca retroceda.
  if (anio < 2000 || anio > 2100) return null
  const milis = m[7] ? Number(m[7].padEnd(3, '0').slice(0, 3)) : 0
  const ms = Date.UTC(anio, mes - 1, dia, hora, minuto, seg, milis)
  if (!Number.isFinite(ms)) return null
  // Date.UTC normaliza los desbordes (31 de febrero pasa a 3 de marzo): se
  // rechaza en vez de guardar una fecha que nadie mando.
  const fecha = new Date(ms)
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null
  return Timestamp.fromDate(fecha)
}

/** Numeros que pueden venir como number o como texto (24.00 es comun al
 *  serializar decimales de SQL). Los consumidores comprueban `typeof number`,
 *  asi que un string se ignoraria en silencio al sumar docenas. */
function aNumeroONull(valor) {
  if (valor == null || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(String(valor).trim())
  if (!Number.isFinite(n) || n < 0 || n >= 100000000) return null
  return n
}

function aTextoONull(valor, maximo) {
  if (valor == null) return null
  const texto = String(valor).trim()
  if (!texto) return null
  return texto.length > maximo ? texto.slice(0, maximo) : texto
}

function milisDe(t) {
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

function primero(a, b, c) {
  if (a != null) return a
  if (b != null) return b
  return c
}

/** Traduce una fila de CodigosDeRuta al documento de foliosRuteo.
 *  Devuelve { folio, datos } o { error } — nunca escribe. */
function traducir(fila) {
  if (!fila || typeof fila !== 'object') return { error: 'fila que no es objeto' }
  const folio = canonizarFolio(primero(fila.Folio, fila.folio, null))
  if (!folio) return { error: 'folio invalido o vacio' }
  // `codigo` es obligatorio en ruteoValido() y sin el la fila no sirve de nada:
  // el cruce del bulto con su producto es por codigo.
  const codigo = canonizarCodigo(primero(fila.Codigo, fila.codigo, null))
  if (!codigo) return { error: 'folio ' + folio + ': sin codigo' }
  return {
    folio: folio,
    datos: {
      folio: folio,
      codigo: codigo,
      docenas: aNumeroONull(primero(fila.Docenas, fila.docenas, null)),
      pares: aNumeroONull(primero(fila.Pares, fila.pares, null)),
      total: aNumeroONull(primero(fila.Total, fila.total, null)),
      // De `pedido` sale la OT con otDePedido(), que exige que los primeros 4
      // caracteres sean digitos. Se conserva el texto tal cual (solo trim):
      // recortarlo o reformatearlo aqui dejaria las capturas en SIN ORDEN.
      pedido: aTextoONull(primero(fila.Nopedido, fila.NoPedido, fila.pedido), 100),
      fecha: aTimestampDePared(primero(fila.Fecha, fila.fecha, null)),
      fechaActualizacion: aTimestampDePared(
        primero(fila.FechaActualizacion, fila.fechaActualizacion, null)
      ),
    },
  }
}

/** El documento que se va a guardar, ya resuelta la politica de quien pisa a
 *  quien. `existente` es null si el folio es nuevo.
 *
 *  Devuelve { doc, clase }, donde clase alimenta el resumen:
 *    nuevos | actualizados | sinCambios | omitidosViejos | enriquecidos
 *
 *  La politica replica `cargarRuteo.js` CAMPO POR CAMPO — no es "nunca pisar un
 *  dato con null", que es mas amplio de lo que el cliente hace de verdad:
 *   - una fila con fechaActualizacion mas VIEJA no pisa contenido;
 *   - una fila SIN fecha no pisa un registro que si la tiene (solo rellena
 *     huecos);
 *   - los campos que SICAP no manda nunca se tocan (SOLO_DEL_EXCEL);
 *   - `cargadoEn` se refresca SIEMPRE: es la base de la retencion de 15 dias,
 *     y un folio que dejara de refrescarse se borraria estando vivo.
 */
function resolver(existente, datos, archivoOrigen, uidOrigen) {
  const marca = {
    archivoOrigen: archivoOrigen,
    cargadoEn: FieldValue.serverTimestamp(),
    cargadoPorUid: uidOrigen,
  }

  if (!existente) {
    const doc = Object.assign({}, datos, marca)
    for (const campo of SOLO_DEL_EXCEL) doc[campo] = null
    return { doc: doc, clase: 'nuevos' }
  }

  // Base: TODAS las llaves de contenido explicitas. Nunca un spread del
  // documento existente — uno viejo puede no traer alguna llave y ruteoValido()
  // exige hasAll: al cliente le rebotaria su siguiente actualizacion.
  const conservado = {
    folio: existente.folio == null ? datos.folio : existente.folio,
    codigo: existente.codigo == null ? null : existente.codigo,
    docenas: existente.docenas == null ? null : existente.docenas,
    pares: existente.pares == null ? null : existente.pares,
    total: existente.total == null ? null : existente.total,
    pedido: existente.pedido == null ? null : existente.pedido,
    nombreGuia: existente.nombreGuia == null ? null : existente.nombreGuia,
    descripcion: existente.descripcion == null ? null : existente.descripcion,
    modelo: existente.modelo == null ? null : existente.modelo,
    color: existente.color == null ? null : existente.color,
    fecha: existente.fecha == null ? null : existente.fecha,
    fechaActualizacion: existente.fechaActualizacion == null ? null : existente.fechaActualizacion,
  }

  const nuevaFecha = datos.fechaActualizacion
  const viejaFecha = conservado.fechaActualizacion

  // Mas vieja que lo guardado: no pisa nada, pero SI se reescribe para
  // refrescar cargadoEn (este folio sigue vivo en SQL).
  if (nuevaFecha && viejaFecha && nuevaFecha.toMillis() < viejaFecha.toMillis()) {
    return { doc: Object.assign({}, conservado, marca), clase: 'omitidosViejos' }
  }

  // Sin fecha frente a un registro que si la tiene: solo rellena huecos.
  if (!nuevaFecha && viejaFecha) {
    const relleno = {}
    if (conservado.pedido == null && datos.pedido != null) relleno.pedido = datos.pedido
    const doc = Object.assign({}, conservado, relleno, marca)
    return {
      doc: doc,
      clase: Object.keys(relleno).length ? 'enriquecidos' : 'omitidosViejos',
    }
  }

  // Caso normal: gana SQL en lo cuantitativo, el Excel conserva lo suyo.
  const doc = Object.assign({}, conservado, {
    folio: datos.folio,
    codigo: datos.codigo,
    docenas: datos.docenas,
    pares: datos.pares,
    total: datos.total,
    // El entrante manda solo si trae valor: nunca se pisa un pedido conocido
    // con null (de ahi sale la OT de toda la captura).
    pedido: datos.pedido == null ? conservado.pedido : datos.pedido,
    fecha: datos.fecha,
    fechaActualizacion: nuevaFecha,
  }, marca)

  const igual =
    conservado.codigo === doc.codigo &&
    conservado.docenas === doc.docenas &&
    conservado.pares === doc.pares &&
    conservado.total === doc.total &&
    conservado.pedido === doc.pedido &&
    milisDe(conservado.fecha) === milisDe(doc.fecha) &&
    milisDe(conservado.fechaActualizacion) === milisDe(doc.fechaActualizacion)

  return { doc: doc, clase: igual ? 'sinCambios' : 'actualizados' }
}

/**
 * Aplica las escrituras con precondicion de version y reintento por documento.
 *
 * `create` para los nuevos (falla si alguien lo creo en medio) y `update` con
 * `lastUpdateTime` para los existentes (falla si cambiaron desde la lectura).
 * Se usa `update` y no `set` porque set NO acepta precondicion: escribiria a
 * ciegas, que es justo el fallo que esto evita. Como el documento se arma con
 * las 15 llaves completas, update las pisa todas igual que un set.
 */
async function aplicar(db, coleccion, porFolio, archivoOrigen, uidOrigen) {
  const resumen = { nuevos: 0, actualizados: 0, sinCambios: 0, omitidosViejos: 0, enriquecidos: 0 }
  // El CONTEO va aparte del DETALLE. El detalle se corta a 50 para no inflar la
  // respuesta, pero si el contador se cortara igual, el folio 51 en adelante no
  // caeria en ningun lado: ni en el resumen (que solo suma exitos) ni en la
  // lista. La bitacora diria "50 errores" con 80 folios sin escribir, y nadie
  // se enteraria de los 30 que faltan.
  let totalErrores = 0
  const errores = []
  let pendientes = Array.from(porFolio.keys())

  for (let vuelta = 0; vuelta < 3 && pendientes.length > 0; vuelta++) {
    const conflictivos = []
    const BLOQUE = 200
    for (let i = 0; i < pendientes.length; i += BLOQUE) {
      const grupo = pendientes.slice(i, i + BLOQUE)
      const refs = grupo.map((f) => coleccion.doc(f))
      const snaps = await db.getAll.apply(db, refs)
      const escritor = db.bulkWriter()
      // Se desactiva el reintento SOLO para los conflictos de version: ahi
      // BulkWriter reintentaria con el MISMO dato viejo y volveria a fallar (el
      // reintento bueno es el de afuera, que vuelve a leer). Para lo demas
      // —red caida, contencion, cuota— su backoff es exactamente lo que se
      // quiere: son fallas transitorias que se recuperan solas, y apagarlas
      // mandaria a la lista de errores folios que se habrian escrito bien.
      escritor.onWriteError((err) => {
        const codigo = err && err.code
        if (codigo === ALREADY_EXISTS || codigo === FAILED_PRECONDITION || codigo === ABORTED) return false
        return err.failedAttempts < 3
      })

      const enVuelo = []
      snaps.forEach((snap, j) => {
        const folio = grupo[j]
        // `resolver` toca .toMillis() de la fecha del documento GUARDADO. Un
        // documento legado con `fechaActualizacion` de otro tipo (escrito antes
        // de que las reglas validaran, o desde la consola) lanzaria aqui — y
        // este forEach es sincrono y esta fuera de todo try, asi que tumbaria
        // la corrida entera y ni siquiera quedaria bitacora. Se aisla el folio
        // malo y los demas siguen.
        let r
        try {
          r = resolver(snap.exists ? snap.data() : null, porFolio.get(folio), archivoOrigen, uidOrigen)
        } catch (err) {
          totalErrores += 1
          if (errores.length < 50) {
            errores.push(folio + ': documento guardado invalido (' + ((err && err.message) || 'error') + ')')
          }
          return
        }
        const promesa = (snap.exists
          ? escritor.update(snap.ref, r.doc, { lastUpdateTime: snap.updateTime })
          : escritor.create(snap.ref, r.doc)
        ).then(
          () => { resumen[r.clase] += 1 },
          (err) => {
            const codigo = err && err.code
            if (codigo === ALREADY_EXISTS || codigo === FAILED_PRECONDITION || codigo === ABORTED) {
              conflictivos.push(folio)
            } else {
              totalErrores += 1
              if (errores.length < 50) {
                errores.push(folio + ': ' + ((err && err.message) || 'error desconocido'))
              }
            }
          }
        )
        enVuelo.push(promesa)
      })

      await escritor.close()
      await Promise.all(enVuelo)
    }
    pendientes = conflictivos
  }

  // Lo que sigue en conflicto tras 3 vueltas se reporta: es raro (implicaria
  // que alguien escribio ese folio tres veces mientras corriamos), pero
  // callarlo dejaria folios sin actualizar sin que nadie se entere.
  for (const folio of pendientes) {
    totalErrores += 1
    if (errores.length < 50) errores.push(folio + ': conflicto persistente, no se actualizo')
  }

  return { resumen: resumen, errores: errores, totalErrores: totalErrores }
}

exports.ruteoImport = onRequest(
  {
    secrets: [RUTEO_API_KEY],
    region: 'us-central1',
    cors: false,
    maxInstances: 10,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST')
      return res.status(405).json({ ok: false, error: 'Solo POST' })
    }
    if (!claveValida(req.get('X-API-Key'), RUTEO_API_KEY.value())) {
      // Sin detalle: un mensaje distinto por "falta clave" y por "clave mala"
      // le dice a quien sondea que va por buen camino.
      return res.status(401).json({ ok: false, error: 'No autorizado' })
    }

    const cuerpo = req.body
    if (!cuerpo || typeof cuerpo !== 'object') {
      return res.status(400).json({ ok: false, error: 'Cuerpo JSON invalido' })
    }

    const tabla = cuerpo.tabla
    const syncId = cuerpo.syncId
    const registros = cuerpo.registros
    // El typeof va ANTES de interpolar: un JSON valido como
    // {"tabla":{"toString":null,"valueOf":null}} lanza TypeError al convertirse
    // a texto, y aqui estamos fuera del try — seria un 500 con stack en vez del
    // 400 que corresponde.
    if (typeof tabla !== 'string' || TABLAS_PERMITIDAS.indexOf(tabla) === -1) {
      const nombre = typeof tabla === 'string' ? tabla : '(no es texto)'
      return res.status(400).json({ ok: false, error: 'Tabla no permitida: ' + nombre })
    }
    if (typeof syncId !== 'string' || !syncId || syncId.length > 100) {
      return res.status(400).json({ ok: false, error: 'Falta syncId (o es demasiado largo)' })
    }
    if (!Array.isArray(registros)) {
      return res.status(400).json({ ok: false, error: 'registros debe ser un arreglo' })
    }
    if (registros.length > MAX_REGISTROS) {
      return res.status(413).json({ ok: false, error: 'Maximo ' + MAX_REGISTROS + ' registros por envio' })
    }
    // Un solo lote, a proposito. La ventana de 30 dias son ~3,100 filas y cabe
    // de sobra; aceptar multi-lote obligaria a llevar el estado de que lotes ya
    // llegaron para saber cuando el envio esta completo, y un envio a medias
    // dejaria el resumen y la bitacora mintiendo. Si algun dia hace falta, se
    // agrega CON ese estado, no quitando esta validacion.
    const loteTotal = cuerpo.lote && cuerpo.lote.total != null ? Number(cuerpo.lote.total) : 1
    if (Number.isFinite(loteTotal) && loteTotal > 1) {
      return res.status(400).json({
        ok: false,
        error: 'Este buzon recibe el envio en UN solo lote: manda la ventana completa de una vez',
      })
    }

    // ---- Traduccion y validacion COMPLETAS antes de escribir nada ----------
    const porFolio = new Map()
    const rechazados = []
    const duplicados = []
    for (const fila of registros) {
      const r = traducir(fila)
      if (r.error) {
        if (rechazados.length < 50) rechazados.push(r.error)
        continue
      }
      if (porFolio.has(r.folio) && duplicados.length < 50) {
        // Atalanta declara Folio como PK y se verifico con 3,104 filas reales.
        // Si algun dia deja de serlo hay que saberlo: sin este aviso, la segunda
        // fila pisaria a la primera en silencio.
        duplicados.push(r.folio)
      }
      porFolio.set(r.folio, r.datos)
    }

    if (porFolio.size === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Ninguna fila utilizable',
        rechazados: rechazados.length,
        detalleRechazados: rechazados.slice(0, 20),
      })
    }

    const db = getFirestore()
    const coleccion = db.collection('foliosRuteo')
    const archivoOrigen = ('SICAP CodigosDeRuta ' + syncId).slice(0, 120)
    const uidOrigen = 'sincronizador-sicap'

    // Bitacora en DOS fases, igual que hace CargaRuteo.jsx con el Excel:
    // primero se abre el registro con `completa: false` y al final se cierra
    // con el resultado real. Si la corrida se cae a la mitad —o se agota el
    // timeout— queda un renglon SIN TERMINAR en Historial de cargas en vez de
    // no quedar nada. Este proceso corre solo y de madrugada: un fallo que solo
    // aparece en Cloud Logging es un fallo que nadie va a ver.
    const refCarga = db.collection('cargasRuteo').doc()
    const bitacoraBase = {
      archivo: archivoOrigen,
      esquema: 'sicap-codigosderuta',
      totalFolios: porFolio.size,
      subioNombre: 'Sincronizador SICAP (Atalanta)',
      subioUid: uidOrigen,
    }

    let salida
    try {
      await refCarga.set(Object.assign({}, bitacoraBase, {
        nuevos: 0,
        actualizados: 0,
        sinCambios: 0,
        enriquecidos: 0,
        omitidos: 0,
        errores: 0,
        completa: false,
        creadoEn: FieldValue.serverTimestamp(),
      }))

      salida = await aplicar(db, coleccion, porFolio, archivoOrigen, uidOrigen)

      // `config/ruteoEstado` guarda la hora del SERVIDOR que usa la limpieza de
      // 15 dias como referencia de "ahora". Si solo la refrescara la carga
      // manual, el dia que America deje de subir el Excel esa referencia se
      // congela y la purga deja de tener sentido.
      //
      // NO se toca `maxFolioNumero` a proposito: es el checkpoint del analisis
      // de huecos de folios, y ese analisis lo hace la carga de America sobre
      // el rango NUEVO. Si lo avanzaramos nosotros, un folio ausente quedaria
      // por debajo del maximo y su hueco no se le reportaria nunca.
      await db.runTransaction(async (tx) => {
        const ref = db.collection('config').doc('ruteoEstado')
        const snap = await tx.get(ref)
        const previo = snap.exists ? snap.data() : {}
        tx.set(ref, {
          maxFolioNumero: previo.maxFolioNumero == null ? null : previo.maxFolioNumero,
          ultimaLimpieza: previo.ultimaLimpieza == null ? null : previo.ultimaLimpieza,
          actualizadoEn: FieldValue.serverTimestamp(),
        })
      })

      // Cierre de la bitacora: es lo que lee la pantalla de Historial de
      // cargas. Sin esto la app diria "no hay carga reciente" aunque el ruteo
      // se este actualizando solo todos los dias.
      await refCarga.set({
        nuevos: salida.resumen.nuevos,
        actualizados: salida.resumen.actualizados,
        sinCambios: salida.resumen.sinCambios,
        enriquecidos: salida.resumen.enriquecidos,
        omitidos: salida.resumen.omitidosViejos + rechazados.length,
        errores: salida.totalErrores,
        completa: true,
      }, { merge: true })
    } catch (e) {
      console.error('ruteoImport:', e)
      // Se intenta dejar constancia del fallo en la bitacora ya abierta, pero
      // sin dejar que un segundo error tape al primero: si esto tambien falla,
      // se responde 500 igual.
      try {
        await refCarga.set({ completa: false, errores: (salida && salida.totalErrores) || 0 }, { merge: true })
      } catch (e2) {
        console.error('ruteoImport: tampoco se pudo cerrar la bitacora:', e2)
      }
      return res.status(500).json({ ok: false, error: 'Error guardando en Firestore' })
    }

    return res.status(200).json({
      ok: true,
      procesados: porFolio.size,
      resumen: salida.resumen,
      rechazados: rechazados.length,
      detalleRechazados: rechazados.slice(0, 20),
      duplicados: duplicados.length,
      detalleDuplicados: duplicados.slice(0, 20),
      errores: salida.totalErrores,
      detalleErrores: salida.errores.slice(0, 20),
    })
  }
)

// Expuesto SOLO para pruebas locales (scripts/probar_ruteo.mjs). No lo use la
// app: la unica entrada real es el endpoint de arriba.
exports._internos = { traducir, resolver, aTimestampDePared, canonizarFolio, canonizarCodigo, aNumeroONull }
