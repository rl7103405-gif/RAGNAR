/**
 * BUZON DEL CATALOGO DE PRODUCTOS — lo que Atalanta deja cada dia.
 *
 * Hermano de `ruteo.js`, pero NO es el mismo problema y por eso vive aparte:
 *
 *   - El ruteo son ~3,100 folios y entra en UN solo lote, documento por
 *     documento. El catalogo son ~40,700 productos: no cabe en un POST (tope
 *     de 5,000) y no se guarda documento por documento, sino repartido en
 *     NUM_SHARDS shards por VERSION, exactamente como lo deja
 *     `web/scripts/cargar_catalogo.mjs` desde el Excel de Microsip.
 *   - El ruteo actualiza lo que ya existe. El catalogo se REEMPLAZA entero:
 *     llega una copia completa, se arma una version nueva y, solo cuando esta
 *     completa, se mueve el puntero `config/catalogoActual`.
 *
 * De ahi las dos reglas duras de este archivo:
 *
 *   1. **Multi-lote CON estado.** Se lleva cuenta de que lotes llegaron. Un
 *      envio a medias NO publica nada: se queda en `cargando` y el catalogo
 *      vigente sigue siendo el anterior. Es justo lo que `ruteo.js` no quiso
 *      cargar y por lo que ahi el multi-lote esta prohibido.
 *   2. **Publicar es el ultimo paso y se verifica antes.** Igual que el
 *      script: se cuentan los codigos leyendo los shards de vuelta y solo
 *      entonces se mueve el puntero. Un catalogo a medias haciendose pasar por
 *      bueno deja a la captura sin descripcion, modelo y talla.
 *
 * Que Atalanta manda (confirmado por Juan, 31-ago-2026) y como se traduce:
 *
 *   CodigoProducto  -> codigo       (PK, texto: hay `#7081-G` y `.809`)
 *   Articulo        -> descripcion  (nombre comercial)
 *   Descripcion     -> modelo       ⚠️ NO es un error de tecleo: en SICAP la
 *                                   columna `Descripcion` trae el codigo
 *                                   compacto que aqui llamamos MODELO. Mapeo
 *                                   confirmado por Roberto el 2026-07-28 y ya
 *                                   en produccion en cargar_catalogo.mjs:136.
 *   Talla           -> talla
 *   Color           -> color
 *   Referencia      -> referencia
 *   Linea_Producto  -> linea
 *
 * ⚠️ Atalanta NO manda codigo de barras. El indice inverso barras -> codigo
 * (el puente UPC del archivo de pagos) se HEREDA de la version vigente al
 * publicar; ver copiarBarras() abajo.
 */
const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { createHash, timingSafeEqual } = require('crypto')

// La misma clave del buzon de ruteo: para Atalanta es el mismo integrador y
// rotarla en dos lugares distintos era una forma seguraosa de dejar uno viejo.
const RUTEO_API_KEY = defineSecret('RUTEO_API_KEY')

// Allowlist propia. Este buzon recibe catalogo y nada mas.
const TABLAS_PERMITIDAS = ['productos']

const MAX_REGISTROS = 5000
const MAX_LOTES = 40
// Tope de cordura: hoy son ~40,700 codigos. Si algun dia llega el triple, es
// mas probable que sea un error de consulta que un crecimiento real.
const MAX_CODIGOS = 200000

// ---------------------------------------------------------------------------
// Claves del catalogo. DUPLICADO A PROPOSITO de web/src/utils/catalogoClaves.js
// (que es un modulo ESM del front y `functions/` es CommonJS). Quien escribe y
// quien lee TIENEN que caer en el mismo shard y la misma clave: si estas tres
// funciones se tocan alla, hay que tocarlas aqui. Verificado con la prueba de
// paridad de scripts/verificar_claves_catalogo.mjs.
// ---------------------------------------------------------------------------
const NUM_SHARDS_CATALOGO = 64

function fnv1a(texto) {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function shardDeCodigo(codigo) {
  return String(fnv1a(codigo) % NUM_SHARDS_CATALOGO)
}

function claveDeCodigo(codigo) {
  let clave = ''
  for (const ch of String(codigo)) {
    if (/[A-Za-z0-9-]/.test(ch)) {
      clave += ch
    } else {
      clave += '%' + ch.codePointAt(0).toString(16).toUpperCase().padStart(6, '0')
    }
  }
  return clave
}

// ---------------------------------------------------------------------------

function claveValida(recibida, esperada) {
  if (typeof recibida !== 'string' || !esperada) return false
  const a = createHash('sha256').update(recibida).digest()
  const b = createHash('sha256').update(esperada).digest()
  return timingSafeEqual(a, b)
}

/** Texto limpio o null. Un '' en Firestore y un null se leen distinto en el
 *  front (`r.modelo ?? null`), asi que se normaliza aqui una sola vez.
 *  Acotado con un maximo (como `aTextoONull` de ruteo.js): sin tope, un valor
 *  gigante en una sola fila puede empujar el shard que lo contiene mas alla
 *  del limite de 1 MiB de Firestore y dejar esa escritura fallando siempre,
 *  con la version atascada en 'cargando' para siempre. */
function texto(valor, maximo) {
  if (valor === null || valor === undefined) return null
  const t = String(valor).trim()
  if (t === '') return null
  const tope = maximo || 250
  return t.length > tope ? t.slice(0, tope) : t
}

/** El catalogo se guarda con el codigo en MAYUSCULAS (cargar_catalogo.mjs:110)
 *  y la captura compara exacto: un codigo en minuscula desde SQL no aparece. */
function canonizarCodigo(valor) {
  const t = texto(valor)
  if (t === null) return null
  const c = t.toUpperCase()
  // Un codigo con '/' o barra invertida romperia la clave de campo aunque
  // claveDeCodigo lo escape; y uno larguisimo es basura, no un producto.
  return c.length > 60 ? null : c
}

/**
 * Una fila de SQL -> la entrada del catalogo, con el MISMO shape que escribe
 * cargar_catalogo.mjs. Devuelve { error } o { codigo, datos }.
 */
function traducir(fila) {
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) {
    return { error: 'fila que no es objeto' }
  }
  const codigo = canonizarCodigo(fila.CodigoProducto)
  if (codigo === null) {
    return { error: 'CodigoProducto vacio o invalido' }
  }
  return {
    codigo: codigo,
    datos: {
      codigo: codigo,
      // `texto()` acota cada campo (tope por defecto: ver su comentario). Un
      // valor gigante en una sola fila no debe poder reventar el limite de
      // 1 MiB del shard que le toque.
      descripcion: texto(fila.Articulo),
      // Ver la cabecera: `Descripcion` de SQL ES nuestro modelo.
      modelo: texto(fila.Descripcion),
      talla: texto(fila.Talla),
      color: texto(fila.Color),
      referencia: texto(fila.Referencia),
      linea: texto(fila.Linea_Producto),
    },
  }
}

/** El syncId de Atalanta viaja como id de documento: hay que acotarlo a algo
 *  que Firestore acepte (sin '/', sin '..', sin '__x__'). */
function versionDesdeSync(syncId) {
  const limpio = String(syncId).replace(/[^A-Za-z0-9_-]/g, '_')
  if (!limpio || limpio === '.' || limpio === '..') return null
  return ('atalanta_' + limpio).slice(0, 120)
}

/**
 * Copia el indice inverso barras -> codigo de la version vigente a la nueva.
 *
 * Atalanta no manda codigo de barras y sin esto cada copia diaria borraria el
 * puente UPC -> codigo que usa el archivo de pagos de las maquilas: el
 * catalogo se veria bien y el cruce de precios empezaria a fallar sin que
 * nadie tocara nada. Las barras vienen de otra fuente (Microsip / Walmart) y
 * no dependen de esta copia, asi que heredarlas es lo correcto.
 *
 * Devuelve el versionId del que se heredaron, o null.
 */
async function copiarBarras(db, refNueva, versionVigenteId) {
  if (!versionVigenteId) return null
  const origen = db.collection('catalogoVersiones').doc(versionVigenteId).collection('barras')
  const snap = await origen.get()
  if (snap.empty) return null
  const fallos = []
  const escritor = db.bulkWriter()
  // Sin esto, una escritura que agota reintentos se pierde en silencio: la
  // copia se da por buena y el puente UPC -> codigo queda incompleto sin que
  // nadie se entere hasta que un pago de maquila no cruce.
  escritor.onWriteError((err) => {
    fallos.push(err)
    return (err.failedAttempts || 0) < 5
  })
  for (const d of snap.docs) {
    escritor.set(refNueva.collection('barras').doc(d.id), d.data())
  }
  await escritor.close()
  if (fallos.length > 0) {
    throw new Error('copiarBarras: fallaron ' + fallos.length + ' escritura(s) tras reintentos: ' + fallos[0].message)
  }
  // A diferencia de los shards del catalogo (que se verifican leyendo de
  // vuelta antes de publicar), esto no se comprobaba: una copia parcial deja
  // el puente UPC -> codigo roto en silencio. Se compara el numero de
  // documentos de origen contra lo escrito.
  const destino = await refNueva.collection('barras').get()
  if (destino.size !== snap.size) {
    throw new Error(
      'copiarBarras: se esperaban ' + snap.size + ' documento(s) de barras y quedaron ' + destino.size
    )
  }
  return versionVigenteId
}

// Antiguedad minima antes de poder borrar una version que NO esta 'listo'.
// Sin esto, limpiarVersiones() purga versiones en 'cargando' o 'publicando'
// que otro sync esta escribiendo en ESE MISMO instante (p.ej. la copia
// automatica de las 02:00 mientras alguien dispara una manual): su create()
// vuelve a tener exito y reinicia lotesRecibidos, o su update() final falla
// con NOT_FOUND llevandose un catalogo que si cargo bien. 24h es tiempo de
// sobra para un envio real (multi-lote cabe en minutos) y corto para no
// acumular basura de cargas que de verdad se quedaron a medias.
const HORAS_ANTES_DE_BORRAR_HUERFANA = 24

/** Conserva la version apuntada + las 2 mas recientes en 'listo'. Misma
 *  politica que cargar_catalogo.mjs, para que las dos fuentes no dejen basura
 *  con criterios distintos — EXCEPTO que aqui, a diferencia del script (que
 *  corre solo, sin nadie mas escribiendo a la vez), puede haber otro sync en
 *  curso: nunca se borra una version 'cargando' o 'publicando' que no sea
 *  vieja de verdad. */
async function limpiarVersiones(db, versionId) {
  const versiones = await db.collection('catalogoVersiones').orderBy('creadoEn', 'desc').get()
  const conservar = new Set([versionId])
  let listos = 0
  for (const v of versiones.docs) {
    if (v.id === versionId) continue
    if (v.data().estado === 'listo' && listos < 2) {
      conservar.add(v.id)
      listos++
    }
  }
  const ahoraMs = Date.now()
  for (const v of versiones.docs) {
    if (conservar.has(v.id)) continue
    const d = v.data()
    if (d.estado === 'cargando' || d.estado === 'publicando') {
      const creadoMs = d.creadoEn && typeof d.creadoEn.toMillis === 'function' ? d.creadoEn.toMillis() : null
      const esHuerfanaVieja = creadoMs !== null && ahoraMs - creadoMs > HORAS_ANTES_DE_BORRAR_HUERFANA * 3600 * 1000
      if (!esHuerfanaVieja) continue // puede ser un sync en curso: no tocar
    }
    for (const sub of ['shards', 'barras']) {
      const hijos = await v.ref.collection(sub).get()
      const fallos = []
      const w = db.bulkWriter()
      w.onWriteError((err) => {
        fallos.push(err)
        return (err.failedAttempts || 0) < 5
      })
      hijos.docs.forEach((h) => w.delete(h.ref))
      await w.close()
      if (fallos.length > 0) {
        // No aborta la limpieza entera por un borrado fallido: es
        // mantenimiento, no parte del contrato de publicar (ver mas abajo
        // donde se llama, fuera del try principal).
        console.warn('[productosImport] limpiarVersiones: fallaron ' + fallos.length + ' borrado(s) en ' + v.id + '/' + sub)
      }
    }
    await v.ref.delete()
  }
}

exports.productosImport = onRequest(
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
      return res.status(401).json({ ok: false, error: 'No autorizado' })
    }

    const cuerpo = req.body
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
      return res.status(400).json({ ok: false, error: 'Cuerpo JSON invalido' })
    }

    const tabla = cuerpo.tabla
    if (typeof tabla !== 'string' || TABLAS_PERMITIDAS.indexOf(tabla) === -1) {
      const nombre = typeof tabla === 'string' ? tabla : '(no es texto)'
      return res.status(400).json({ ok: false, error: 'Tabla no permitida: ' + nombre })
    }

    const syncId = cuerpo.syncId
    if (typeof syncId !== 'string' || !syncId || syncId.length > 100) {
      return res.status(400).json({ ok: false, error: 'Falta syncId (o es demasiado largo)' })
    }
    const versionId = versionDesdeSync(syncId)
    if (!versionId) {
      return res.status(400).json({ ok: false, error: 'syncId invalido' })
    }

    // ---- Lote ------------------------------------------------------------
    // A diferencia del ruteo, aqui el multi-lote es el caso normal. Un envio
    // sin `lote` se trata como lote 1 de 1: sirve para probar con pocas filas.
    const lote = cuerpo.lote && typeof cuerpo.lote === 'object' ? cuerpo.lote : {}
    const loteN = lote.n != null ? Number(lote.n) : 1
    const loteTotal = lote.total != null ? Number(lote.total) : 1
    if (!Number.isInteger(loteTotal) || loteTotal < 1 || loteTotal > MAX_LOTES) {
      return res.status(400).json({ ok: false, error: 'lote.total invalido (1..' + MAX_LOTES + ')' })
    }
    if (!Number.isInteger(loteN) || loteN < 1 || loteN > loteTotal) {
      return res.status(400).json({ ok: false, error: 'lote.n invalido (1..' + loteTotal + ')' })
    }

    const registros = cuerpo.registros
    if (!Array.isArray(registros)) {
      return res.status(400).json({ ok: false, error: 'registros debe ser un arreglo' })
    }
    if (registros.length > MAX_REGISTROS) {
      return res.status(413).json({ ok: false, error: 'Maximo ' + MAX_REGISTROS + ' registros por envio' })
    }

    const db = getFirestore()
    const refVersion = db.collection('catalogoVersiones').doc(versionId)

    try {
      // ---- Traducir TODO antes de escribir nada -------------------------
      const porCodigo = new Map()
      const rechazados = []
      for (const fila of registros) {
        const r = traducir(fila)
        if (r.error) {
          if (rechazados.length < 50) rechazados.push(r.error)
          continue
        }
        porCodigo.set(r.codigo, r.datos)
      }
      if (porCodigo.size === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Ninguna fila utilizable',
          rechazados: rechazados.length,
          detalleRechazados: rechazados.slice(0, 20),
        })
      }

      // ---- Abrir la version (solo el primer lote la crea) ---------------
      // create() falla si ya existe: asi dos lotes que llegan a la vez no se
      // pisan la cabecera ni reinician el conteo de lotes recibidos.
      let yaPublicada = false
      try {
        await refVersion.create({
          origen: 'atalanta',
          tabla: tabla,
          syncId: syncId,
          numShards: NUM_SHARDS_CATALOGO,
          lotesEsperados: loteTotal,
          lotesRecibidos: [],
          codigosEnviados: 0,
          estado: 'cargando',
          creadoEn: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        const snap = await refVersion.get()
        if (!snap.exists) throw err
        const d = snap.data()
        // `versionDesdeSync` sanitiza el syncId a [A-Za-z0-9_-]: dos syncId
        // distintos ('2026-08-31/a' y '2026-08-31.a') pueden colapsar al MISMO
        // versionId. Sin este chequeo, el segundo se trataria como "otro lote
        // de la misma copia" y sus filas se mezclarian con las de una copia
        // ajena.
        if (d.syncId !== syncId) {
          return res.status(409).json({
            ok: false,
            error: 'Ese versionId ya esta en uso por otro syncId (' + d.syncId + '). Cambia el syncId.',
          })
        }
        if (d.estado === 'listo') yaPublicada = true
        if (d.lotesEsperados !== loteTotal) {
          return res.status(409).json({
            ok: false,
            error:
              'Ese syncId ya venia con ' + d.lotesEsperados + ' lotes y ahora dice ' +
              loteTotal + '. Usa un syncId nuevo para una copia nueva.',
          })
        }
      }

      // Reenviar un lote sobre una version ya publicada no debe reabrirla: el
      // catalogo vigente quedaria mezclado sin que nadie lo pidiera.
      if (yaPublicada) {
        return res.status(409).json({
          ok: false,
          error: 'Esa copia ya se publico. Para mandar otra, usa un syncId nuevo.',
        })
      }

      // ---- Escribir los shards de ESTE lote -----------------------------
      // merge: true acumula lo de los lotes anteriores. Reenviar un lote
      // reescribe los mismos campos con los mismos valores: es inofensivo, y
      // por eso el conteo final NO suma lotes, se cuenta leyendo de vuelta.
      const porShard = new Map()
      for (const [codigo, datos] of porCodigo) {
        const sh = shardDeCodigo(codigo)
        if (!porShard.has(sh)) porShard.set(sh, {})
        porShard.get(sh)[claveDeCodigo(codigo)] = datos
      }
      const fallosShards = []
      const escritor = db.bulkWriter()
      // Sin esto, una escritura de shard que agota reintentos se pierde en
      // silencio: el lote se marca recibido igual y la version se publicaria
      // creyendo que ese shard quedo escrito.
      escritor.onWriteError((err) => {
        fallosShards.push(err)
        return (err.failedAttempts || 0) < 5
      })
      for (const [sh, productos] of porShard) {
        escritor.set(refVersion.collection('shards').doc(sh), { productos: productos }, { merge: true })
      }
      await escritor.close()
      if (fallosShards.length > 0) {
        throw new Error(
          'Fallaron ' + fallosShards.length + ' escritura(s) de shard tras reintentos: ' + fallosShards[0].message
        )
      }

      // ---- Marcar el lote como recibido ----------------------------------
      // Transaccion (no un update suelto) porque hay que leer-y-decidir antes
      // de escribir: un REENVIO del mismo lote es idempotente para los shards
      // (merge sobre los mismos valores), pero NO debe volver a sumar su
      // tamano a `codigosEnviados` — si lo hiciera, dos envios del lote 3
      // inflarian el contador y la verificacion de abajo (B) nunca cuadraria
      // con lo leido de los shards. El propio `lotesRecibidos` hace de
      // candado: si `loteN` ya esta ahi, este envio es un reintento y solo se
      // refresca `actualizadoEn`.
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(refVersion)
        const d = snap.exists ? snap.data() : {}
        const recibidos = Array.isArray(d.lotesRecibidos) ? d.lotesRecibidos : []
        const actualizacion = {
          lotesRecibidos: FieldValue.arrayUnion(loteN),
          actualizadoEn: FieldValue.serverTimestamp(),
        }
        if (!recibidos.includes(loteN)) {
          actualizacion.codigosEnviados = FieldValue.increment(porCodigo.size)
        }
        tx.update(refVersion, actualizacion)
      })

      // ---- ¿Ya llegaron todos? ------------------------------------------
      // La transaccion es la que decide QUIEN publica: si los dos ultimos
      // lotes terminan a la vez, los dos verian la lista completa y
      // publicarian dos veces (y la limpieza de versiones correria en
      // paralelo consigo misma). Gana el primero que ponga 'publicando'.
      // De paso, captura `codigosEnviados` (el conteo acumulado por lote,
      // sin inflar por reenvios) para compararlo contra lo leido de los
      // shards mas abajo.
      let codigosEnviadosTotal = 0
      const meTocaPublicar = await db.runTransaction(async (tx) => {
        const snap = await tx.get(refVersion)
        if (!snap.exists) return false
        const d = snap.data()
        if (d.estado !== 'cargando') return false
        const recibidos = Array.isArray(d.lotesRecibidos) ? d.lotesRecibidos : []
        if (recibidos.length < d.lotesEsperados) return false
        codigosEnviadosTotal = d.codigosEnviados || 0
        tx.update(refVersion, { estado: 'publicando' })
        return true
      })

      if (!meTocaPublicar) {
        const snap = await refVersion.get()
        const d = snap.data() || {}
        const recibidos = (d.lotesRecibidos || []).length
        // "No me toca publicar" tiene dos causas MUY distintas y confundirlas
        // es mentirle al integrador: o faltan lotes (normal, que siga
        // mandando), o esta version ya murio y no va a publicar nunca. Sin
        // esta rama, reenviar el ultimo lote de una copia 'fallida' contesta
        // "ok, faltan 0 lotes para publicar" — y Atalanta puede quedarse
        // reintentando en un bucle silencioso contra algo que nunca avanza.
        if (d.estado && d.estado !== 'cargando') {
          return res.status(409).json({
            ok: false,
            versionId: versionId,
            estado: d.estado,
            motivo: d.motivo || null,
            error:
              'Esa copia esta en estado "' + d.estado + '" y ya no va a publicar. ' +
              'Manda la copia completa otra vez con un syncId NUEVO.',
          })
        }
        return res.status(200).json({
          ok: true,
          versionId: versionId,
          lote: loteN,
          recibidosEnEsteLote: porCodigo.size,
          rechazados: rechazados.length,
          detalleRechazados: rechazados.slice(0, 20),
          lotesRecibidos: recibidos,
          lotesEsperados: loteTotal,
          publicado: false,
          mensaje: 'Lote guardado. Faltan ' + (loteTotal - recibidos) + ' lote(s) para publicar.',
        })
      }

      // ---- VERIFICAR antes de mover el puntero --------------------------
      // Mismo candado que el script: se cuenta lo que de verdad quedo escrito.
      // Si un shard no se escribio, el catalogo vigente NO se toca.
      let codigosUnicos = 0
      for (let i = 0; i < NUM_SHARDS_CATALOGO; i++) {
        const snap = await refVersion.collection('shards').doc(String(i)).get()
        if (!snap.exists) continue // un shard vacio es posible: el hash no obliga a llenar los 64
        codigosUnicos += Object.keys(snap.data().productos || {}).length
      }
      // B1: coincidencia EXACTA contra lo que se PRETENDIA escribir (suma de
      // `porCodigo.size` de cada lote, sin inflar por reenvios — ver arriba).
      // Sin esto, un POST con un solo registro y `lote.total` sin especificar
      // (loteTotal=1 por defecto) pasaba el chequeo anterior (1 codigo, entre
      // 0 y MAX_CODIGOS) y publicaba una version de 1 codigo, moviendo el
      // puntero al instante.
      if (
        codigosUnicos === 0 ||
        codigosUnicos > MAX_CODIGOS ||
        codigosUnicos !== codigosEnviadosTotal
      ) {
        await refVersion.update({
          estado: 'fallida',
          motivo:
            'Conteo no cuadra: se enviaron ' + codigosEnviadosTotal + ' codigo(s) y se leyeron ' +
            codigosUnicos + ' de los shards.',
        })
        return res.status(500).json({
          ok: false,
          error: 'La copia quedo con ' + codigosUnicos + ' codigos. NO se publico; sigue vigente el catalogo anterior.',
        })
      }

      // B2: cota inferior contra el catalogo vigente. Un shard que fallo a
      // medias sin dispararse arriba (por ejemplo, si `codigosEnviadosTotal`
      // tambien quedo corto) o una consulta de Atalanta mal filtrada pueden
      // seguir siendo "consistentes consigo mismos" y aun asi ser basura. Una
      // copia diaria del mismo catalogo no encoge a la mitad: si pasa, es mas
      // probable un error de consulta (o un intento deliberado de vaciar el
      // catalogo) que un cambio real de inventario.
      const cfgSnap = await db.collection('config').doc('catalogoActual').get()
      const vigenteId = cfgSnap.exists ? cfgSnap.data().versionId || null : null
      // OJO con el `|| 0` facil: un catalogo vigente SIN `codigosUnicos` (un
      // documento tocado a mano, o cargado antes de que existiera el campo) no
      // es "no hay catalogo", es "no se cuantos tiene" — y tratarlo como cero
      // apagaria la cota de abajo justo cuando mas falta hace. Si hay version
      // vigente pero no se sabe su tamano, se cuenta leyendo sus shards.
      let vigenteCodigos = 0
      if (cfgSnap.exists) {
        const n = Number(cfgSnap.data().codigosUnicos)
        if (Number.isFinite(n) && n > 0) {
          vigenteCodigos = n
        } else if (vigenteId) {
          console.warn(
            '[productosImport] config/catalogoActual no trae codigosUnicos usable; se cuenta la version vigente ' +
              vigenteId
          )
          const refVig = db.collection('catalogoVersiones').doc(vigenteId)
          for (let i = 0; i < NUM_SHARDS_CATALOGO; i++) {
            const s = await refVig.collection('shards').doc(String(i)).get()
            if (s.exists) vigenteCodigos += Object.keys(s.data().productos || {}).length
          }
        }
      }
      // Salida explicita para el caso legitimo raro (p.ej. una limpieza real
      // de catalogo o una carga inicial deliberadamente chica): Atalanta la
      // manda a proposito, nunca por default.
      const permitirEncogimiento = cuerpo.permitirEncogimiento === true
      if (vigenteCodigos > 0 && !permitirEncogimiento && codigosUnicos < vigenteCodigos / 2) {
        await refVersion.update({
          estado: 'fallida',
          motivo:
            'La copia trae ' + codigosUnicos + ' codigos, menos de la mitad del catalogo vigente (' +
            vigenteCodigos + '). Si es real, reenvia con permitirEncogimiento:true.',
        })
        return res.status(500).json({
          ok: false,
          error:
            'La copia trae ' + codigosUnicos + ' codigos, menos de la mitad del catalogo vigente (' +
            vigenteCodigos + '). NO se publico; sigue vigente el catalogo anterior.',
        })
      }

      // ---- Heredar el indice de barras y publicar ------------------------
      //
      // Todo lo que va de aqui a que el puntero se mueva corre con la version
      // ya en 'publicando', y ese estado es un candado de un solo uso: la
      // transaccion de arriba solo se lo da a quien la encuentre en
      // 'cargando'. Si algo revienta en este tramo y el estado se queda en
      // 'publicando', esa copia queda MUERTA: ningun reintento con el mismo
      // syncId la vuelve a intentar y ningun otro lote la puede rescatar.
      // Por eso cualquier fallo aqui la marca 'fallida' antes de propagarse:
      // 'fallida' es un final honesto (se ve que paso, el catalogo vigente no
      // se toco, y limpiarVersiones la puede recoger), 'publicando' eterno no.
      let barrasDe = null
      try {
        barrasDe = await copiarBarras(db, refVersion, vigenteId)

        await refVersion.update({
          estado: 'listo',
          codigosUnicos: codigosUnicos,
          barrasHeredadasDe: barrasDe,
          publicadoEn: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        // El marcado va en su propio try: si TAMBIEN falla, lo que importa es
        // no perder el error original, que es el que dice que paso.
        try {
          await refVersion.update({
            estado: 'fallida',
            motivo: 'Fallo al publicar: ' + (err && err.message ? err.message : String(err)),
          })
        } catch (err2) {
          console.error('[productosImport] no se pudo marcar la version como fallida:', err2)
        }
        throw err
      }
      await db.collection('config').doc('catalogoActual').set({
        versionId: versionId,
        codigosUnicos: codigosUnicos,
        numShards: NUM_SHARDS_CATALOGO,
        origen: 'atalanta',
        actualizadoEn: Timestamp.fromDate(new Date()),
      })

      // La limpieza es mantenimiento, no parte del contrato de "publicar con
      // exito". El catalogo ya quedo vigente arriba: si esto falla, no hay
      // que responder 500 (Atalanta reintentaria de mas un envio que ya
      // funciono) ni dejar sin publicar algo que si se publico. Su propio
      // try/catch para que un fallo aqui no tumbe la respuesta de exito.
      try {
        await limpiarVersiones(db, versionId)
      } catch (err) {
        console.warn('[productosImport] limpiarVersiones fallo (el catalogo ya quedo publicado):', err)
      }

      return res.status(200).json({
        ok: true,
        versionId: versionId,
        lote: loteN,
        recibidosEnEsteLote: porCodigo.size,
        rechazados: rechazados.length,
        detalleRechazados: rechazados.slice(0, 20),
        lotesRecibidos: loteTotal,
        lotesEsperados: loteTotal,
        publicado: true,
        codigosUnicos: codigosUnicos,
        barrasHeredadasDe: barrasDe,
        mensaje: 'Catalogo publicado con ' + codigosUnicos + ' codigos.',
      })
    } catch (err) {
      console.error('[productosImport] Fallo:', err)
      // El detalle al log, no al integrador.
      return res.status(500).json({ ok: false, error: 'Error interno al procesar el envio' })
    }
  }
)

exports._internos = {
  traducir,
  canonizarCodigo,
  texto,
  versionDesdeSync,
  shardDeCodigo,
  claveDeCodigo,
  fnv1a,
  NUM_SHARDS_CATALOGO,
}
