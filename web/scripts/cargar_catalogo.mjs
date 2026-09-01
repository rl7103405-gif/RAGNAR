/**
 * Carga el catalogo de productos (Codigos_Productos_Quini_DD_MM_YY.xlsx) a
 * Firestore como una VERSION nueva sharded + puntero:
 *
 *   catalogoVersiones/{versionId}            manifiesto (estado, conteos, hash)
 *   catalogoVersiones/{versionId}/shards/{n} mapa clave->producto (n = 0..63)
 *   config/catalogoActual                    puntero a la version vigente
 *
 * La version nueva se escribe COMPLETA y se verifica leyendola de vuelta;
 * solo entonces se mueve el puntero (un unico write). Asi una captura nunca
 * puede mezclar shards de dos versiones distintas, y una carga interrumpida
 * deja una version huerfana inofensiva (el puntero sigue apuntando a la
 * anterior). Se conserva la version apuntada + las 2 mas recientes en estado
 * 'listo'; las demas (incluidas 'cargando' huerfanas) se borran.
 *
 * Uso (la clave de servicio va en web/serviceAccountKey.json, ya gitignoreada):
 *   node scripts/cargar_catalogo.mjs "..\\Codigos_Productos_Quini_24_07_26.xlsx"
 */
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import ExcelJS from 'exceljs'
import { NUM_SHARDS_CATALOGO, shardDeCodigo, claveDeCodigo } from '../src/utils/catalogoClaves.js'
import { CELDA_INVALIDA, textoCelda as texto } from '../src/utils/celdasExcel.js'

const MAX_ERRORES_REPORTADOS = 20
const MAX_FILAS_CATALOGO = 1_000_000
// Columnas del archivo real que alimentan el PDF de salida. 'Articulo' es el
// nombre del producto (ej. TIN INFANTIL) y 'Descripcion' del catalogo trae el
// modelo (ej. GRDS-099) -- mapeo confirmado por Roberto el 2026-07-28.
const COLUMNAS_REQUERIDAS = [
  'codigoproducto', 'articulo', 'descripcion', 'talla', 'color', 'referencia', 'linea_producto'
]

// EL CODIGO DE BARRAS es OPCIONAL: los archivos que se han cargado hasta hoy
// (2026-08-24) no lo traen, y el catalogo tiene que seguir cargandose sin el.
//
// ⚠️ PARA QUE SIRVE. El resumen de pagos a maquilas identifica el producto por
// CODIGO DE BARRAS, y las tareas por CODIGO DE QUINI. Sin este puente la app
// no puede saber que precio le toca a cada codigo, y alguien tiene que
// amarrarlos a mano uno por uno (medido: de 286 modelos del archivo de pagos,
// solo 14 coinciden con un codigo del catalogo).
//
// Se aceptan varios nombres porque el reporte de Microsip puede traerlo
// escrito de distintas formas.
const NOMBRES_BARRAS = [
  'codigo_barras', 'codigobarras', 'codigo de barras', 'cod_barras',
  'codbarras', 'upc', 'ean', 'barras'
]

const rutaArchivo = process.argv[2]
if (!rutaArchivo) {
  console.error('Uso: node scripts/cargar_catalogo.mjs <ruta al Codigos_Productos_Quini_*.xlsx>')
  process.exit(1)
}

console.log(`Leyendo ${rutaArchivo} ...`)
const lector = new ExcelJS.stream.xlsx.WorkbookReader(rutaArchivo, {
  entries: 'emit', sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore', worksheets: 'emit'
})

const COLUMNAS_TEXTO = ['articulo', 'descripcion', 'talla', 'color', 'referencia', 'linea_producto']

const productos = new Map() // codigo -> {codigo, descripcion, modelo, talla, color, referencia, linea}
const contradicciones = []
const erroresCelda = []
let filasLeidas = 0
let indices = null
const hashContenido = createHash('sha256')

for await (const hoja of lector) {
  for await (const fila of hoja) {
    const valores = fila.values // array 1-based
    if (fila.number === 1) {
      const nombres = valores.map((v) => texto(v).toLowerCase())
      indices = {}
      for (const col of COLUMNAS_REQUERIDAS) {
        const i = nombres.indexOf(col)
        if (i === -1) {
          console.error(`El archivo no trae la columna '${col}'. Encabezados: ${nombres.filter(Boolean).join(', ')}`)
          process.exit(1)
        }
        indices[col] = i
      }
      // La de barras, si el archivo la trae.
      for (const nombre of NOMBRES_BARRAS) {
        const i = nombres.indexOf(nombre)
        if (i !== -1) {
          indices.codigo_barras = i
          console.log(`Este archivo SI trae codigo de barras (columna '${nombre}').`)
          break
        }
      }
      if (indices.codigo_barras === undefined) {
        console.log('AVISO: el archivo no trae columna de codigo de barras.')
        console.log('       El catalogo se carga igual, pero los precios de maquila no se van a')
        console.log('       poder amarrar solos. Ver el comentario de NOMBRES_BARRAS.')
      }
      continue
    }

    const codigoCelda = texto(valores[indices.codigoproducto])
    if (codigoCelda === CELDA_INVALIDA) {
      if (erroresCelda.length < MAX_ERRORES_REPORTADOS) {
        erroresCelda.push(`Fila ${fila.number}: la columna 'CodigoProducto' tiene una celda invalida (error de formula o valor no reconocido)`)
      }
      continue
    }
    const codigo = codigoCelda.toUpperCase()
    if (!codigo) continue
    filasLeidas++
    if (filasLeidas > MAX_FILAS_CATALOGO) {
      console.error(`El archivo excede el maximo de ${MAX_FILAS_CATALOGO} filas`)
      process.exit(1)
    }

    let filaConCeldaInvalida = false
    const valoresTexto = {}
    for (const col of COLUMNAS_TEXTO) {
      const v = texto(valores[indices[col]])
      if (v === CELDA_INVALIDA) {
        filaConCeldaInvalida = true
        if (erroresCelda.length < MAX_ERRORES_REPORTADOS) {
          erroresCelda.push(`Fila ${fila.number}: la columna '${col}' tiene una celda invalida (codigo ${codigo})`)
        }
      } else {
        valoresTexto[col] = v
      }
    }
    if (filaConCeldaInvalida) continue

    const entrada = {
      codigo,
      descripcion: valoresTexto.articulo || null,
      modelo: valoresTexto.descripcion || null,
      talla: valoresTexto.talla || null,
      color: valoresTexto.color || null,
      referencia: valoresTexto.referencia || null,
      linea: valoresTexto.linea_producto || null,
      // Solo se guarda si el archivo lo trajo y parece un codigo de barras:
      // un texto cualquiera en esa columna no sirve de puente y ensuciaria el
      // indice inverso.
      ...(indices.codigo_barras !== undefined
        ? (() => {
            const b = texto(valores[indices.codigo_barras])
            const limpio = b && b !== CELDA_INVALIDA ? b.replace(/\D/g, '') : ''
            return limpio.length >= 8 ? { codigoBarras: limpio } : {}
          })()
        : {})
    }
    const previa = productos.get(codigo)
    if (previa === undefined) {
      productos.set(codigo, entrada)
    } else {
      // El archivo trae una fila por MATERIAL: todas las filas de un mismo
      // codigo deben repetir los datos de producto. Si algun dia difieren, el
      // archivo esta mal y se rechaza en vez de quedarse callado con una.
      // El codigo de barras se trata aparte: si una fila lo trae y otra no,
      // eso NO es una contradiccion (Microsip lo deja vacio en las filas de
      // material). Se conserva el que exista; solo chocan dos barras distintos.
      if (entrada.codigoBarras && !previa.codigoBarras) previa.codigoBarras = entrada.codigoBarras
      const difiere = Object.keys(entrada).some(
        (k) => k !== 'codigoBarras' && entrada[k] !== previa[k]
      )
      if (
        entrada.codigoBarras &&
        previa.codigoBarras &&
        entrada.codigoBarras !== previa.codigoBarras &&
        contradicciones.length < MAX_ERRORES_REPORTADOS
      ) {
        contradicciones.push(
          `Codigo ${codigo}: dos codigos de barras distintos (${previa.codigoBarras} y ${entrada.codigoBarras})`
        )
      }
      if (difiere && contradicciones.length < MAX_ERRORES_REPORTADOS) {
        contradicciones.push(`Codigo ${codigo}: filas con datos de producto distintos entre si`)
      }
    }
  }
  break // solo la primera hoja
}

if (indices === null) {
  console.error('El archivo esta vacio o no tiene encabezados.')
  process.exit(1)
}
if (erroresCelda.length > 0) {
  console.error('ARCHIVO RECHAZADO: celdas invalidas (error de formula o valor no reconocido):')
  erroresCelda.forEach((e) => console.error(' - ' + e))
  process.exit(1)
}
if (contradicciones.length > 0) {
  console.error('ARCHIVO RECHAZADO: codigos con datos contradictorios entre sus filas:')
  contradicciones.forEach((c) => console.error(' - ' + c))
  process.exit(1)
}
if (productos.size === 0) {
  console.error('El archivo no contiene codigos de producto.')
  process.exit(1)
}
console.log(`Filas leidas: ${filasLeidas}; codigos unicos: ${productos.size}`)

// El hash se calcula aqui, con el Map ya completo (incluye el codigoBarras que
// pudo llegar en una fila posterior a la primera del codigo) y recorriendo las
// claves ORDENADAS para que el hash no dependa del orden de las filas.
for (const codigo of [...productos.keys()].sort()) {
  hashContenido.update(JSON.stringify(productos.get(codigo)))
}

// ---- Armar shards ----
//
// Ademas del catalogo por codigo, se arma un INDICE INVERSO barras -> codigo.
// Sin el, para saber que producto es el '7506097258537' del archivo de pagos
// habria que recorrer los 64 shards enteros. Con el, es UNA lectura puntual.
//
// Se reparte con la misma funcion de shard, pero sobre el codigo de barras, no
// sobre el codigo del producto.
const barrasPorShard = Array.from({ length: NUM_SHARDS_CATALOGO }, () => ({}))
let barrasVistos = 0

const shards = Array.from({ length: NUM_SHARDS_CATALOGO }, () => ({}))
for (const [codigo, entrada] of productos) {
  shards[Number(shardDeCodigo(codigo))][claveDeCodigo(codigo)] = entrada
  if (entrada.codigoBarras) {
    const sh = Number(shardDeCodigo(entrada.codigoBarras))
    const clave = claveDeCodigo(entrada.codigoBarras)
    // Un mismo codigo de barras en dos productos distintos: el archivo se
    // rechaza igual que otras contradicciones. Elegir en silencio cual gana
    // seria decidir a ciegas que precio se le paga a una maquila.
    if (barrasPorShard[sh][clave] && barrasPorShard[sh][clave] !== codigo) {
      if (contradicciones.length < MAX_ERRORES_REPORTADOS) {
        contradicciones.push(
          `Codigo de barras ${entrada.codigoBarras}: esta en ${barrasPorShard[sh][clave]} y en ${codigo}`
        )
      }
    } else {
      barrasPorShard[sh][clave] = codigo
      barrasVistos++
    }
  }
}

if (contradicciones.length > 0) {
  console.error('ARCHIVO RECHAZADO: codigos de barras repetidos en productos distintos:')
  contradicciones.forEach((c) => console.error(' - ' + c))
  process.exit(1)
}

// ---- Fecha del archivo (senal auxiliar para no reemplazar un catalogo mas
// nuevo por error), misma convencion que _fecha_desde_nombre_archivo del
// servidor Python original: DD.MM.AA / DD_MM_AA / DD-MM-AA en el nombre. ----
const PATRON_FECHA_ARCHIVO = /(\d{1,2})[._-](\d{1,2})[._-](\d{2,4})/
function fechaDesdeNombreArchivo(nombre) {
  if (!nombre) return null
  const m = PATRON_FECHA_ARCHIVO.exec(nombre)
  if (!m) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  let anio = Number(m[3])
  if (anio < 100) anio += 2000
  const fecha = new Date(anio, mes - 1, dia)
  // new Date() normaliza desbordes (p.ej. mes 13 o dia 32) en vez de fallar;
  // se detecta comparando los componentes de vuelta, igual que el ValueError
  // que lanzaria datetime(anio, mes, dia) en Python para una fecha invalida.
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null
  return fecha
}

// ---- Escribir version nueva ----
const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const ahora = new Date()
// Resolucion de 1s en el timestamp original permitia colision si se corre el
// script dos veces en el mismo segundo: se agrega milisegundos + sufijo
// aleatorio, y se usa create() (falla si el id ya existe) en vez de set().
const versionId = 'v' + ahora.getTime() + '_' + randomBytes(3).toString('hex')
const refVersion = db.collection('catalogoVersiones').doc(versionId)

const nombreArchivo = basename(rutaArchivo)
const fechaArchivo = fechaDesdeNombreArchivo(nombreArchivo)
const fechaArchivoTimestamp = fechaArchivo ? Timestamp.fromDate(fechaArchivo) : null

// ---- Guardia: no reemplazar por error un catalogo mas nuevo con uno viejo ----
const forzar = process.argv.includes('--forzar')
const configActualSnap = await db.collection('config').doc('catalogoActual').get()
if (configActualSnap.exists && configActualSnap.data().versionId) {
  const versionVigenteSnap = await db.collection('catalogoVersiones').doc(configActualSnap.data().versionId).get()
  const fechaVigente = versionVigenteSnap.exists ? versionVigenteSnap.data().fechaArchivo || null : null
  if (fechaVigente && fechaArchivoTimestamp) {
    if (fechaArchivoTimestamp.toMillis() < fechaVigente.toMillis()) {
      if (!forzar) {
        console.error(
          `El archivo '${nombreArchivo}' parece MAS VIEJO que el catalogo vigente ` +
            `(version ${configActualSnap.data().versionId}, fecha ${fechaVigente.toDate().toISOString().slice(0, 10)}). ` +
            'Si de verdad quieres reemplazarlo, vuelve a correr con --forzar.'
        )
        process.exit(1)
      }
      console.log('AVISO: --forzar activo; se reemplaza un catalogo cuyo archivo parece mas nuevo.')
    }
  } else if (!fechaVigente) {
    console.log(
      'AVISO: la version vigente no trae fechaArchivo (version cargada antes de este cambio); ' +
        'no se puede comparar fechas, se continua.'
    )
  }
}

console.log(`Escribiendo version ${versionId} (${NUM_SHARDS_CATALOGO} shards) ...`)
try {
  await refVersion.create({
    archivo: nombreArchivo,
    filasLeidas,
    codigosUnicos: productos.size,
    numShards: NUM_SHARDS_CATALOGO,
    hashContenido: hashContenido.digest('hex'),
    estado: 'cargando',
    creadoEn: Timestamp.fromDate(ahora),
    fechaArchivo: fechaArchivoTimestamp
  })
} catch (err) {
  console.error(`No se pudo crear la version ${versionId} (¿ya existe?): ${err.message}`)
  process.exit(1)
}
for (let i = 0; i < NUM_SHARDS_CATALOGO; i++) {
  await refVersion.collection('shards').doc(String(i)).set({ productos: shards[i] })
  // El indice inverso viaja en su propia coleccion, en la misma version: asi
  // una version vieja nunca mezcla su catalogo con las barras de otra.
  if (Object.keys(barrasPorShard[i]).length) {
    await refVersion.collection('barras').doc(String(i)).set({ codigos: barrasPorShard[i] })
  }
  if ((i + 1) % 16 === 0) console.log(`  shard ${i + 1}/${NUM_SHARDS_CATALOGO}`)
}

// ---- Verificar leyendo de vuelta antes de mover el puntero ----
if (barrasVistos) {
  console.log(`Indice de codigos de barras: ${barrasVistos} productos.`)
}

console.log('Verificando shards escritos ...')
let totalVerificado = 0
for (let i = 0; i < NUM_SHARDS_CATALOGO; i++) {
  const snap = await refVersion.collection('shards').doc(String(i)).get()
  if (!snap.exists) {
    console.error(`FALLO DE VERIFICACION: falta el shard ${i}. El puntero NO se movio.`)
    process.exit(1)
  }
  totalVerificado += Object.keys(snap.data().productos || {}).length
}
if (totalVerificado !== productos.size) {
  console.error(
    `FALLO DE VERIFICACION: se esperaban ${productos.size} codigos y se leyeron ${totalVerificado}. El puntero NO se movio.`
  )
  process.exit(1)
}

await refVersion.update({ estado: 'listo' })
await db.collection('config').doc('catalogoActual').set({
  versionId,
  codigosUnicos: productos.size,
  numShards: NUM_SHARDS_CATALOGO,
  actualizadoEn: Timestamp.fromDate(new Date())
})
console.log(`Puntero config/catalogoActual -> ${versionId} (${productos.size} codigos).`)

// ---- Conservar SIEMPRE la version apuntada + las 2 mas recientes en estado
// 'listo'; borrar el resto (incluidas 'cargando' huerfanas de cargas
// interrumpidas). Nunca se borra la version apuntada por catalogoActual. ----
//
// ⚠️ Desde que existe `functions/productos.js`, esta coleccion tiene DOS
// escritores: este script y el buzon de Atalanta. Una version en 'cargando' o
// 'publicando' ya no significa "carga interrumpida": puede ser un envio
// multi-lote a medias, ahora mismo. Borrarla le quita los shards ya escritos
// y, peor, su manifiesto: el siguiente lote vuelve a crearlo desde cero y ese
// sync queda atascado para siempre sin error visible. Solo se borra una
// 'cargando'/'publicando' si de verdad esta abandonada (mas de 24 h). El buzon
// aplica exactamente el mismo criterio; si se cambia aqui, cambiarlo alla.
const HORAS_ANTES_DE_BORRAR_HUERFANA = 24
const limiteHuerfana = Date.now() - HORAS_ANTES_DE_BORRAR_HUERFANA * 60 * 60 * 1000

const versiones = await db.collection('catalogoVersiones').orderBy('creadoEn', 'desc').get()
const idsAConservar = new Set([versionId])
let conservadosListo = 0
for (const docV of versiones.docs) {
  if (docV.id === versionId) continue
  const datos = docV.data()
  if (datos.estado === 'listo' && conservadosListo < 2) {
    idsAConservar.add(docV.id)
    conservadosListo++
    continue
  }
  if (datos.estado === 'cargando' || datos.estado === 'publicando') {
    const creado = datos.creadoEn && datos.creadoEn.toMillis ? datos.creadoEn.toMillis() : null
    // Sin fecha utilizable se conserva: mas vale dejar basura que romper un
    // envio en curso.
    if (creado === null || creado > limiteHuerfana) {
      console.log(`Conservando ${docV.id}: esta en '${datos.estado}' y podria ser un envio en curso.`)
      idsAConservar.add(docV.id)
    }
  }
}
const aBorrar = versiones.docs.filter((docV) => !idsAConservar.has(docV.id))
for (const docViejo of aBorrar) {
  console.log(`Borrando version vieja ${docViejo.id} ...`)
  const shardsViejos = await docViejo.ref.collection('shards').get()
  const barrasViejas = await docViejo.ref.collection('barras').get()
  const lote = db.batch()
  shardsViejos.docs.forEach((s) => lote.delete(s.ref))
  barrasViejas.docs.forEach((b) => lote.delete(b.ref))
  lote.delete(docViejo.ref)
  await lote.commit()
}
console.log('Listo.')
process.exit(0)
