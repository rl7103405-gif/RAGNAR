/**
 * Carga inicial del catalogo de avios desde la hoja CATALOGO de
 * "FORMATO SOLICITUD DE AVIOS.xlsx" (raiz del repo): las claves reales de
 * Microsip que las maquilas piden (158 al 2026-08-13).
 *
 * - NO pisa nada: usa create(); una clave que ya existe se reporta y se salta.
 * - El ID del doc es el codigo NORMALIZADO (espacios -> guion, igual que la
 *   app); cuando la clave original difiere (los SRFID llevan espacio) se
 *   guarda en claveMicrosip, que es la que se usaria al exportar a Microsip.
 * - La unidad sale de la PRESENTACION del Excel (PIEZA/MILLAR/KG) y el tipo
 *   se deriva del prefijo de la clave y la descripcion.
 *
 * Uso (en web/):
 *   node scripts/importar_catalogo_avios.mjs             <- ensayo, no escribe
 *   EJECUTAR=1 node scripts/importar_catalogo_avios.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const RUTA_EXCEL = fileURLToPath(new URL('../../FORMATO SOLICITUD DE AVIOS.xlsx', import.meta.url))

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'
console.log(ejecutar ? '== MODO REAL: se escribe el catalogo ==\n' : '== ENSAYO: no se escribe nada ==\n')

// Misma normalizacion que la app (web/src/components/Avios.jsx): si divergen,
// la UI y el script crearian IDs distintos para la misma clave.
function normalizarCodigoAvio(texto) {
  return String(texto || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9._-]/g, '')
    .slice(0, 60)
}

const UNIDAD_POR_PRESENTACION = { PIEZA: 'piezas', MILLAR: 'millares', KG: 'kg', ROLLO: 'rollos', CAJA: 'cajas' }

function tipoDe(clave, descripcion) {
  const d = descripcion.toUpperCase()
  if (clave.startsWith('ETIQ') || clave.startsWith('SRFID')) return 'etiqueta'
  if (clave.startsWith('CAJ') || d.includes('CAJA')) return 'caja'
  if (d.includes('BOLSA')) return 'bolsa'
  if (d.includes('CINTA')) return 'cinta'
  if (d.includes('PLASTIFLECHA')) return 'plastiflecha'
  // CDF (displays/fajillas), GCH (ganchos), PLANT (plantillas), agujas...
  return 'otro'
}

const mod = await import('exceljs')
const Workbook = mod.Workbook || mod.default?.Workbook
const libro = new Workbook()
await libro.xlsx.readFile(RUTA_EXCEL)
const hoja = libro.getWorksheet('CATALOGO')
if (!hoja) {
  console.error('El Excel no trae la hoja CATALOGO.')
  process.exit(1)
}

const filas = []
hoja.eachRow((f, n) => {
  if (n === 1) return
  const clave = String(f.getCell(1).value ?? '').trim()
  const descripcion = String(f.getCell(2).value ?? '').trim().slice(0, 200)
  const presentacion = String(f.getCell(3).value ?? '').trim().toUpperCase()
  if (!clave || !descripcion) return
  const unidad = UNIDAD_POR_PRESENTACION[presentacion]
  filas.push({ n, clave, descripcion, presentacion, unidad })
})

const sinUnidad = filas.filter((f) => !f.unidad)
if (sinUnidad.length) {
  console.error('Presentaciones que no se como mapear (corrigelas o dime que unidad son):')
  sinUnidad.forEach((f) => console.error(`  fila ${f.n}: ${f.clave} -> "${f.presentacion}"`))
  process.exit(1)
}

// Colisiones DENTRO del Excel tras normalizar (dos claves que acaban en el
// mismo ID serian una perdida silenciosa).
const porId = new Map()
for (const f of filas) {
  const id = normalizarCodigoAvio(f.clave)
  if (porId.has(id)) {
    console.error(`COLISION de ID "${id}": "${porId.get(id).clave}" y "${f.clave}". Resuelvela antes de importar.`)
    process.exit(1)
  }
  porId.set(id, f)
}

console.log(`${filas.length} clave(s) en la hoja CATALOGO.\n`)

let creadas = 0
let existentes = 0
let fallidas = 0
for (const [id, f] of porId) {
  const datos = {
    codigo: id,
    descripcion: f.descripcion,
    tipo: tipoDe(f.clave, f.descripcion),
    unidad: f.unidad,
    activo: true,
    creadoEn: FieldValue.serverTimestamp(),
    creadoPorUid: 'importacion-catalogo-2026-08-13',
    ...(f.clave.toUpperCase() !== id ? { claveMicrosip: f.clave.toUpperCase() } : {})
  }
  if (!ejecutar) {
    console.log(`[ensayo] ${id.padEnd(22)} ${datos.tipo.padEnd(13)} ${datos.unidad.padEnd(9)} ${f.descripcion.slice(0, 50)}`)
    continue
  }
  try {
    // create(): si ya existe truena con ALREADY_EXISTS y NO se pisa.
    await db.collection('avios').doc(id).create(datos)
    creadas += 1
  } catch (err) {
    if (err.code === 6 /* ALREADY_EXISTS */) {
      existentes += 1
      console.log(`(ya existia) ${id}`)
    } else {
      fallidas += 1
      console.error(`FALLO ${id}: ${err.message}`)
    }
  }
}

if (ejecutar) {
  console.log(`\n${creadas} creada(s), ${existentes} ya existian, ${fallidas} fallida(s).`)
} else {
  console.log(`\nPara escribirlas de verdad: EJECUTAR=1 node scripts/importar_catalogo_avios.mjs`)
}
process.exit(fallidas > 0 ? 2 : 0)
