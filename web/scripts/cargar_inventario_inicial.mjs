/**
 * SALDO INICIAL DE AVIOS por maquila, desde los conteos fisicos de Cielo.
 *
 *   node scripts/cargar_inventario_inicial.mjs "../datos/maquilas/INVENTARIOS MAQUILAS.zip" "17 DE AGOSTO"
 *   EJECUTAR=1 node scripts/cargar_inventario_inicial.mjs ...   <- escribe de verdad
 *
 * POR DEFECTO NO ESCRIBE NADA. Ensena que cargaria y que no cuadra, y hay que
 * pasar EJECUTAR=1 a proposito. Mismo patron que importar_catalogo_avios.mjs.
 *
 * ⚠️ POR QUE TANTO CUIDADO. Lo dice la propia regla de firestore.rules:
 * "el saldo inicial es el arranque del inventario y el punto mas fragil de
 * todo: un saldo a ojo contamina todo lo que se construya encima". Es material
 * que cuesta dinero, y a partir de este numero se mide todo lo que la maquila
 * consuma despues.
 *
 * SOLO CARGA AVIOS (cajas, etiquetas, ganchos, plastiflecha). La otra hoja de
 * esos archivos, la de PRODUCTO en docenas, NO tiene destino en este sistema:
 * el inventario de RAGNAR es de material, no de calcetin. Eso necesita una
 * decision aparte.
 *
 * CADA MAQUILA MANDA SU PROPIO FORMATO, asi que hay tres lectores:
 *   simple  CODIGO | CANTIDAD | PRESENTACION      (encabezado en la fila 2)
 *   edgar   ARTICULO | ... | INVENTARIO MAQUILA   (encabezado en la fila 3)
 *   roda    Codigo | Cantidad | Presentacion      (encabezado en la fila 2)
 * Se detecta por los encabezados, no por el nombre del archivo: si manana
 * alguien renombra su archivo, esto sigue funcionando.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import ExcelJS from 'exceljs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const ejecutar = process.env.EJECUTAR === '1'

// Quien queda firmando estos movimientos. Se distingue de una persona a
// proposito: dentro de un año hay que poder ver que esto lo puso el arranque
// del sistema y no alguien a mano.
const FIRMA_UID = 'carga-inventario-inicial'
const FIRMA_NOMBRE = 'Carga inicial (conteo fisico de maquilas)'

const [rutaZip, carpetaCorte] = process.argv.slice(2)
if (!rutaZip || !carpetaCorte) {
  console.error('Uso: node scripts/cargar_inventario_inicial.mjs <zip> "<CARPETA DEL CORTE>"')
  console.error('Ej:  node scripts/cargar_inventario_inicial.mjs "../datos/maquilas/INVENTARIOS MAQUILAS.zip" "17 DE AGOSTO"')
  process.exit(1)
}

// --- normalizacion, la misma que usa la app para el id de maquila ---
const sinAcentos = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const normalizarCodigo = (v) => sinAcentos(v).trim().toUpperCase().replace(/\s+/g, '')

/** Numero de una celda, incluidas las de formula. null si no hay numero. */
function numeroDe(v) {
  if (v == null) return null
  if (typeof v === 'object') {
    if (v instanceof Date) return null
    // ⚠️ Formula SIN resultado guardado: el valor NO esta en el archivo aunque
    // Excel se lo ensene a quien lo abre. No se puede inventar.
    if (!('result' in v)) return null
    if (v.result && typeof v.result === 'object') return null // #N/A y demas
    const n = Number(v.result)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : null
}

const texto = (v) => {
  if (v == null) return ''
  if (typeof v === 'object') {
    if ('result' in v && typeof v.result !== 'object') return String(v.result)
    if ('text' in v && typeof v.text === 'string') return v.text
    return ''
  }
  return String(v)
}

/**
 * Encuentra en una hoja la fila de encabezados y las columnas de codigo y
 * cantidad. Devuelve null si la hoja no es de avios.
 */
function detectar(hoja) {
  for (let n = 1; n <= Math.min(6, hoja.rowCount); n++) {
    const fila = hoja.getRow(n)
    let colCodigo = null
    let colCantidad = null
    let colUnidad = null
    for (let c = 1; c <= 12; c++) {
      const t = sinAcentos(texto(fila.getCell(c).value)).trim().toUpperCase()
      if (!t) continue
      if (!colCodigo && /^(CODIGO|CODIGOS|ARTICULO)$/.test(t)) colCodigo = c
      if (!colCantidad && /^(CANTIDAD|INVENTARIO( EN)? MAQUILA)$/.test(t)) colCantidad = c
      if (!colUnidad && /^PRESENTACION$/.test(t)) colUnidad = c
    }
    if (colCodigo && colCantidad) return { fila: n, colCodigo, colCantidad, colUnidad }
  }
  return null
}

// --- 1. abrir el zip en un temporal ---
const zip = path.resolve(AQUI, '..', rutaZip)
if (!fs.existsSync(zip)) {
  console.error('No existe el zip:', zip)
  process.exit(1)
}
let base = zip
if (!fs.statSync(zip).isDirectory()) {
  // Se descomprime con PowerShell: el `tar` de Git Bash no entiende rutas de
  // Windows ("C:" lo lee como si fuera un host remoto). PowerShell siempre
  // esta en esta maquina, asi que es la opcion que no falla.
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'invmaq-'))
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${base.replace(/'/g, "''")}' -Force`
    ])
  } catch (err) {
    console.error('No se pudo descomprimir el zip:', err?.message)
    console.error('Alternativa: descomprimelo tu y pasame la CARPETA en vez del .zip.')
    process.exit(1)
  }
}

const raiz = path.join(base, 'INVENTARIOS MAQUILAS', carpetaCorte)
if (!fs.existsSync(raiz)) {
  console.error('No existe el corte:', carpetaCorte)
  console.error('Cortes disponibles:', fs.readdirSync(path.join(base, 'INVENTARIOS MAQUILAS')).join(' · '))
  process.exit(1)
}

// --- 2. Firestore: catalogo de avios y maquilas ---
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()

const catalogo = new Map()
;(await db.collection('avios').get()).docs.forEach((d) =>
  catalogo.set(normalizarCodigo(d.id), { unidad: d.data().unidad || 'piezas', descripcion: d.data().descripcion || '' })
)
const maquilas = (await db.collection('maquilas').get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((m) => !m.esPrueba)

/** Del nombre del archivo a la maquila. Se compara contra el NOMBRE real. */
function maquilaDe(archivo) {
  const pista = sinAcentos(archivo).toUpperCase().replace(/MAQUILA|\.XLSX|-\d+/g, '').trim()
  return maquilas.find((m) => {
    const partes = sinAcentos(m.nombre).toUpperCase().split(/\s+/)
    return partes.some((p) => p.length > 3 && pista.includes(p))
  })
}

// --- 3. leer cada archivo ---
console.log(`\n${'='.repeat(64)}`)
console.log(`CORTE: ${carpetaCorte}   ${ejecutar ? '*** MODO REAL: VA A ESCRIBIR ***' : '(ensayo: no escribe nada)'}`)
console.log('='.repeat(64))

const archivos = fs.readdirSync(raiz).filter((f) => /\.xlsx$/i.test(f) && !/RESUMEN/i.test(f))
const porMaquila = []
const problemas = []

for (const f of archivos) {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(fs.readFileSync(path.join(raiz, f)))
  const maquila = maquilaDe(f)

  // Se busca la hoja de AVIOS: la que tiene columna de presentacion o la
  // segunda. La de producto (codigo + docenas) no va a este sistema.
  let mejor = null
  for (const hoja of libro.worksheets) {
    const d = detectar(hoja)
    if (!d) continue
    const esAvios = d.colUnidad != null || /avio|insumo|hoja3/i.test(hoja.name)
    if (esAvios && !mejor) mejor = { hoja, ...d }
  }

  if (!maquila) {
    problemas.push(`${f}: NO cuadra con ninguna maquila registrada en la app`)
    continue
  }
  if (!mejor) {
    problemas.push(`${f}: no se encontro hoja de avios legible`)
    continue
  }

  const lineas = []
  const rechazos = []
  for (let n = mejor.fila + 1; n <= mejor.hoja.rowCount; n++) {
    const fila = mejor.hoja.getRow(n)
    const codigo = normalizarCodigo(texto(fila.getCell(mejor.colCodigo).value))
    if (!codigo) continue
    const cantidad = numeroDe(fila.getCell(mejor.colCantidad).value)
    if (cantidad === null) {
      rechazos.push(`${codigo}: la celda de cantidad es una formula que Excel no guardo calculada`)
      continue
    }
    // El saldo inicial exige cantidad > 0 (regla de Firestore). Un cero no es
    // un saldo: es "no tiene", y no hace falta registrarlo.
    if (cantidad <= 0) continue
    if (!Number.isInteger(cantidad)) {
      rechazos.push(`${codigo}: cantidad ${cantidad} no es entera (el libro solo admite enteros)`)
      continue
    }
    const enCatalogo = catalogo.get(codigo)
    if (!enCatalogo) {
      rechazos.push(`${codigo}: no existe en el catalogo de avios`)
      continue
    }
    lineas.push({ codigo, cantidad, unidad: enCatalogo.unidad, descripcion: enCatalogo.descripcion })
  }
  porMaquila.push({ maquila, archivo: f, hoja: mejor.hoja.name.trim(), lineas, rechazos })
}

// --- 4. reporte ---
for (const m of porMaquila) {
  const suma = m.lineas.reduce((a, l) => a + l.cantidad, 0)
  console.log(`\n${m.maquila.nombre}  (${m.maquila.id})`)
  console.log(`  archivo: ${m.archivo} · hoja "${m.hoja}"`)
  console.log(`  ${m.lineas.length} codigos con saldo · total ${suma}`)
  if (m.rechazos.length) {
    console.log(`  ${m.rechazos.length} renglones NO se pueden cargar:`)
    m.rechazos.slice(0, 8).forEach((r) => console.log(`     - ${r}`))
    if (m.rechazos.length > 8) console.log(`     ... y ${m.rechazos.length - 8} mas`)
  }
}
if (problemas.length) {
  console.log('\nARCHIVOS QUE NO SE PUDIERON USAR:')
  problemas.forEach((p) => console.log('  - ' + p))
}

const totalLineas = porMaquila.reduce((a, m) => a + m.lineas.length, 0)
console.log(`\n${'-'.repeat(64)}`)
console.log(`TOTAL: ${totalLineas} saldos iniciales en ${porMaquila.length} maquilas`)

// --- 5. escribir, solo si se pidio de verdad ---
if (!ejecutar) {
  console.log('\nEnsayo: no se escribio nada. Para hacerlo de verdad:')
  console.log(`  EJECUTAR=1 node scripts/cargar_inventario_inicial.mjs "${rutaZip}" "${carpetaCorte}"`)
  process.exit(0)
}

console.log('\nEscribiendo...')
let escritos = 0
for (const m of porMaquila) {
  const base = db.collection('portalMaquila').doc(m.maquila.id)
  // ⚠️ Se comprueba que NO haya saldo previo. El saldo inicial exige arrancar
  // de cero; si esta maquila ya tuvo movimientos, pisarlos desde un script
  // (que se salta las reglas por usar Admin SDK) romperia la cadena del libro.
  const yaTiene = await base.collection('movimientosAvios').limit(1).get()
  if (!yaTiene.empty) {
    console.log(`  ${m.maquila.nombre}: YA tiene movimientos, se salta (el saldo inicial es solo para arrancar)`)
    continue
  }
  for (let i = 0; i < m.lineas.length; i += 200) {
    const lote = db.batch()
    for (const l of m.lineas.slice(i, i + 200)) {
      const movId = `ini_${l.codigo}`
      lote.set(base.collection('movimientosAvios').doc(movId), {
        maquilaId: m.maquila.id,
        codigo: l.codigo,
        descripcion: l.descripcion,
        unidad: l.unidad,
        tipo: 'saldo_inicial',
        cantidad: l.cantidad,
        saldoAntes: 0,
        saldoDespues: l.cantidad,
        origenTipo: 'arranque',
        origenId: `conteo_${carpetaCorte.replace(/\s+/g, '_')}`,
        motivo: `Conteo fisico de ${carpetaCorte} (${m.archivo})`,
        hechoPorUid: FIRMA_UID,
        hechoPorNombre: FIRMA_NOMBRE,
        creadoEn: Timestamp.now()
      })
      lote.set(base.collection('saldosAvios').doc(l.codigo), {
        codigo: l.codigo,
        maquilaId: m.maquila.id,
        unidad: l.unidad,
        cantidad: l.cantidad,
        ultimoMovimientoId: movId,
        creadoEn: Timestamp.now(),
        actualizadoEn: Timestamp.now()
      })
    }
    await lote.commit()
    escritos += Math.min(200, m.lineas.length - i)
    console.log(`  ${m.maquila.nombre}: ${Math.min(i + 200, m.lineas.length)} de ${m.lineas.length}`)
  }
}
console.log(`\nLISTO: ${escritos} saldos iniciales cargados.`)
process.exit(0)
