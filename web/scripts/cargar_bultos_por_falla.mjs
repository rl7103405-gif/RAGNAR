// Carga de BULTOS desde un Excel cuando la estacion no pudo capturar.
//
// Nacio el 2026-09-05: la captura estuvo bloqueada un dia (id del catalogo de
// Atalanta mas largo que el tope de la regla) y Lindbergh mando a las maquilas
// con remisiones provisionales en papel. Su Excel trae folio, docenas y pedido
// por hoja (una hoja por maquila). Aqui se convierte cada folio en un bulto
// EXACTAMENTE como lo haria la estacion (mismo cruce: ruteo -> plan -> catalogo),
// para que despues Lindbergh emita la remision desde RAGNAR como cualquier dia
// -- el folio interno lo reserva la app, no este script.
//
// Lo que NO hace, a proposito:
//   - No inventa pesos. Sin la columna de peso, el folio se reporta y se salta:
//     el peso alimenta mermas y FTT, y un cero o un estimado ensuciaria eso.
//   - No emite remisiones ni toca el folio interno (config/folioInternoEstado).
//   - No pisa bultos que ya existen.
//
// Uso (desde web/):
//   node scripts/cargar_bultos_por_falla.mjs "<ruta del Excel>"          ensayo
//   EJECUTAR=1 node scripts/cargar_bultos_por_falla.mjs "<ruta>"         escribe
//   OPERADOR=lindbergh   (empleadoId del perfil que queda como operador; default lindbergh)
//   COLUMNA_PESO="Peso (kg)"  (nombre exacto de la columna de peso; default busca 'peso')
//   HOJA="Remision HUGO"  (solo esa hoja)
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ExcelJS from 'exceljs'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { NUM_SHARDS_CATALOGO, claveDeCodigo, shardDeCodigo } from '../src/utils/catalogoClaves.js'
import { idDePedido, normalizarOt, otDelTexto } from '../src/utils/planMaestroNucleo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ruta = process.argv[2]
if (!ruta) {
  console.error('Falta la ruta del Excel.')
  process.exit(1)
}
const EJECUTAR = process.env.EJECUTAR === '1'
const OPERADOR = process.env.OPERADOR || 'lindbergh'
const COLUMNA_PESO = (process.env.COLUMNA_PESO || 'peso').toLowerCase()
const SOLO_HOJA = process.env.HOJA || null
const MAX_GRAMOS = 100000

initializeApp({ credential: cert(JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccountKey.json'), 'utf8'))) })
const db = getFirestore()

// --- el operador que queda en el bulto -------------------------------------
const perfiles = await db.collection('usuarios').where('empleadoId', '==', OPERADOR).get()
if (perfiles.empty) {
  console.error(`No existe un perfil con empleadoId '${OPERADOR}'.`)
  process.exit(1)
}
const operador = { uid: perfiles.docs[0].id, nombre: perfiles.docs[0].data().nombreCompleto || OPERADOR }
if (perfiles.docs[0].data().esPrueba === true) {
  console.error(`El operador '${OPERADOR}' es una cuenta de PRUEBA: los bultos serian de prueba. Usa un perfil real.`)
  process.exit(1)
}

// --- catalogo y plan vigentes (una sola lectura) ----------------------------
const catCfg = (await db.doc('config/catalogoActual').get()).data() || {}
if (catCfg.numShards !== undefined && catCfg.numShards !== NUM_SHARDS_CATALOGO) {
  console.error(`El catalogo vigente usa ${catCfg.numShards} shards y este script espera ${NUM_SHARDS_CATALOGO}.`)
  process.exit(1)
}
const catalogoVersion = catCfg.versionId || null
const planCfg = (await db.doc('config/planMaestroActivo').get()).data() || {}
const planVersion = planCfg.versionId || null
const shards = new Map()
async function entradaDelCatalogo(codigo) {
  if (!catalogoVersion) return undefined
  const s = shardDeCodigo(codigo)
  if (!shards.has(s)) {
    const snap = await db.doc(`catalogoVersiones/${catalogoVersion}/shards/${s}`).get()
    shards.set(s, snap.exists ? snap.data().productos || {} : {})
  }
  return shards.get(s)[claveDeCodigo(codigo)]
}

// Mismo cruce que src/utils/cruceProducto.js (resolverProductoEnTx), sin tx.
async function resolverProducto(folio) {
  const ruteoSnap = await db.doc('foliosRuteo/' + folio).get()
  if (!ruteoSnap.exists) return { producto: null, cruce: 'sin_ruteo', catalogoVersion: null }
  const r = ruteoSnap.data()
  let ot = otDelTexto(r.pedido)
  let otOrigen = ot ? 'texto' : 'ninguna'
  if (r.pedido && planVersion) {
    const pedidoSnap = await db.doc('planMaestroPedidos/' + idDePedido(planVersion, r.pedido)).get()
    if (pedidoSnap.exists) {
      const delPlan = normalizarOt(pedidoSnap.data().ot)
      if (delPlan) {
        ot = delPlan
        otOrigen = 'plan'
      }
    }
  }
  const producto = {
    codigo: r.codigo ?? null,
    docenas: r.docenas ?? null,
    pares: r.pares ?? null,
    total: r.total ?? null,
    pedido: r.pedido ?? null,
    ot,
    otOrigen,
    nombreGuia: r.nombreGuia ?? null,
    descripcion: r.descripcion ?? null,
    modelo: r.modelo ?? null,
    talla: null,
    color: r.color ?? null,
    referencia: null,
    linea: null
  }
  if (!producto.codigo || !catalogoVersion) return { producto, cruce: 'sin_catalogo', catalogoVersion: null }
  const entrada = await entradaDelCatalogo(producto.codigo)
  if (!entrada) return { producto, cruce: 'sin_catalogo', catalogoVersion }
  return {
    producto: {
      ...producto,
      descripcion: entrada.descripcion ?? producto.descripcion,
      modelo: entrada.modelo ?? producto.modelo,
      talla: entrada.talla ?? null,
      color: entrada.color ?? producto.color,
      referencia: entrada.referencia ?? null,
      linea: entrada.linea ?? null
    },
    cruce: 'completo',
    catalogoVersion
  }
}

// --- leer el Excel ----------------------------------------------------------
const libro = new ExcelJS.Workbook()
await libro.xlsx.load(readFileSync(ruta))
const texto = (v) => {
  if (v == null) return ''
  if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : '')).trim()
  return String(v).trim()
}
const numero = (v) => {
  const t = texto(v).replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

const resumen = { hojas: 0, folios: 0, cargados: 0, sinPeso: 0, yaExistian: 0, sinRuteo: 0, pesoInvalido: 0, errores: 0 }
for (const hoja of libro.worksheets) {
  if (SOLO_HOJA && hoja.name !== SOLO_HOJA) continue
  // La fila de encabezados es la que trae 'Folio' en la primera celda.
  let encabezado = null
  let colFolio = -1
  let colPeso = -1
  let colDocenas = -1
  hoja.eachRow((fila, n) => {
    if (encabezado) return
    const celdas = []
    for (let c = 1; c <= hoja.columnCount; c++) celdas.push(texto(fila.getCell(c).value).toLowerCase())
    const iFolio = celdas.indexOf('folio')
    if (iFolio >= 0) {
      encabezado = n
      colFolio = iFolio + 1
      colDocenas = celdas.indexOf('docenas') + 1
      const iPeso = celdas.findIndex((x) => x === COLUMNA_PESO || (COLUMNA_PESO === 'peso' && x.startsWith('peso')))
      colPeso = iPeso >= 0 ? iPeso + 1 : -1
    }
  })
  if (!encabezado) {
    console.log(`\n== ${hoja.name}: sin fila de encabezados con 'Folio'; se salta.`)
    continue
  }
  resumen.hojas++
  console.log(`\n== ${hoja.name} (encabezados en fila ${encabezado}; columna de peso: ${colPeso > 0 ? hoja.getRow(encabezado).getCell(colPeso).value : 'NO HAY'})`)
  const filas = []
  hoja.eachRow((fila, n) => {
    if (n <= encabezado) return
    const folio = texto(fila.getCell(colFolio).value)
    if (!/^\d{5,7}$/.test(folio)) return // filas de resumen, pivotes, firmas
    filas.push({
      n,
      folio,
      docenas: colDocenas > 0 ? numero(fila.getCell(colDocenas).value) : null,
      pesoKg: colPeso > 0 ? numero(fila.getCell(colPeso).value) : null
    })
  })
  console.log(`   ${filas.length} folios en la hoja`)
  resumen.folios += filas.length

  let lote = db.batch()
  let enLote = 0
  const commit = async () => {
    if (!enLote) return
    if (EJECUTAR) await lote.commit()
    lote = db.batch()
    enLote = 0
  }
  for (const f of filas) {
    try {
      const existente = await db.doc('bultos/' + f.folio).get()
      if (existente.exists) {
        const b = existente.data()
        console.log(`   ${f.folio}: YA EXISTE (${b.operadorNombre}, ${b.creadoEn?.toDate?.().toISOString().slice(0, 16)}, ${b.pesoGramos} g${b.pdfGeneradoEn ? ', ya en una remision' : ''}) -> se deja como esta`)
        resumen.yaExistian++
        continue
      }
      if (f.pesoKg == null) {
        resumen.sinPeso++
        continue
      }
      const gramos = Math.round(f.pesoKg * 1000)
      if (!Number.isFinite(gramos) || gramos <= 0 || gramos > MAX_GRAMOS) {
        console.log(`   ${f.folio}: peso invalido (${f.pesoKg}) -> se salta`)
        resumen.pesoInvalido++
        continue
      }
      const { producto, cruce, catalogoVersion: cv } = await resolverProducto(f.folio)
      if (cruce === 'sin_ruteo') resumen.sinRuteo++
      const doc = {
        folio: f.folio,
        pesoGramos: gramos,
        operadorUid: operador.uid,
        operadorNombre: operador.nombre,
        producto,
        cruce,
        catalogoVersion: cv,
        creadoEn: FieldValue.serverTimestamp(),
        actualizadoEn: FieldValue.serverTimestamp()
      }
      if (EJECUTAR) {
        lote.set(db.doc('bultos/' + f.folio), doc)
        enLote++
        if (enLote >= 200) await commit()
      }
      resumen.cargados++
      const aviso = cruce === 'sin_ruteo' ? ' (SIN RUTEO)' : cruce === 'sin_catalogo' ? ' (sin catalogo)' : ''
      console.log(`   ${f.folio}: ${(gramos / 1000).toFixed(2)} kg, ${producto?.codigo || '-'} OT ${producto?.ot || '-'} [${producto?.otOrigen || '-'}]${aviso}${EJECUTAR ? ' -> cargado' : ''}`)
    } catch (err) {
      resumen.errores++
      console.log(`   ${f.folio}: ERROR ${err.message}`)
    }
  }
  await commit()
  if (resumen.sinPeso) console.log(`   ${filas.filter((x) => x.pesoKg == null).length} folios SIN PESO en esta hoja: no se cargan hasta que traigan su kilo.`)
}

console.log(`\n${EJECUTAR ? 'CARGADO' : 'ENSAYO (nada escrito; EJECUTAR=1 para cargar)'}: ${JSON.stringify(resumen)}`)
if (resumen.cargados && EJECUTAR) {
  console.log('Siguiente paso (humano): en RAGNAR, "Folios del dia" -> generar la remision de cada maquila con estos folios. El folio interno lo pone la app.')
}
