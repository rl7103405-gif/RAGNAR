/**
 * AMPLIA el catalogo de avios con el export de Microsip que manda Cielo
 * ("Articulos Avios microsip <fecha>.xlsx": Nombre | U.med. | Clave | Linea).
 *
 * El catalogo original salio de la hoja CATALOGO del formato de solicitud y
 * cubria 158 claves; el conteo fisico de las maquilas trajo material que no
 * estaba (Cielo lo confirmo el 2026-08-20: "te adjunto el catalogo de todos
 * los articulos en avios que incluyen los que mencionas").
 *
 * - NO PISA NADA: usa create(). Una clave que ya existe se salta y se cuenta.
 * - Misma normalizacion e id que importar_catalogo_avios.mjs: los espacios se
 *   vuelven GUION. Si esto divergiera, el mismo material tendria dos
 *   identidades y el inventario se partiria en dos.
 *
 *   node scripts/ampliar_catalogo_avios.mjs "../datos/avios/<archivo>.xlsx"
 *   EJECUTAR=1 node scripts/ampliar_catalogo_avios.mjs ...
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const ejecutar = process.env.EJECUTAR === '1'
const ruta = process.argv[2]
if (!ruta) {
  console.error('Uso: node scripts/ampliar_catalogo_avios.mjs "<archivo.xlsx>"')
  process.exit(1)
}

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()

const normalizarCodigoAvio = (t) =>
  String(t || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._-]/g, '').slice(0, 60)

// SERV (servicios) y BOLSA no estaban en el mapeo original. BOLSA es una
// presentacion real de material; SERV es un servicio, no un avio que se
// inventarie, asi que se deja fuera y se dice.
const UNIDAD = { PIEZA: 'piezas', MILLAR: 'millares', KG: 'kg', ROLLO: 'rollos', CAJA: 'cajas', BOLSA: 'bolsas' }

function tipoDe(clave, d) {
  const D = d.toUpperCase()
  if (clave.startsWith('ETIQ') || clave.startsWith('SRFID') || clave.startsWith('STICKER')) return 'etiqueta'
  if (clave.startsWith('CAJ') || D.includes('CAJA')) return 'caja'
  if (D.includes('BOLSA')) return 'bolsa'
  if (D.includes('CINTA')) return 'cinta'
  if (D.includes('PLASTIFLECHA')) return 'plastiflecha'
  return 'otro'
}

const libro = new ExcelJS.Workbook()
await libro.xlsx.load(fs.readFileSync(path.resolve(AQUI, '..', ruta)))
const hoja = libro.worksheets[0]

const porId = new Map()
const servicios = []
const sinUnidad = []
hoja.eachRow((f, n) => {
  if (n === 1) return
  const descripcion = String(f.getCell(1).value ?? '').trim().slice(0, 200)
  const presentacion = String(f.getCell(2).value ?? '').trim().toUpperCase()
  const clave = String(f.getCell(3).value ?? '').trim()
  if (!clave || !descripcion) return
  if (presentacion === 'SERV') { servicios.push(clave); return }
  const unidad = UNIDAD[presentacion]
  if (!unidad) { sinUnidad.push(`${clave} -> "${presentacion}"`); return }
  const id = normalizarCodigoAvio(clave)
  const previa = porId.get(id)
  if (previa && previa.descripcion !== descripcion) {
    console.error(`COLISION de id "${id}": "${previa.clave}" y "${clave}"`)
    process.exit(1)
  }
  porId.set(id, { clave, descripcion, unidad, presentacion })
})

console.log(`\n${ejecutar ? '*** MODO REAL ***' : '(ensayo: no escribe nada)'}`)
console.log(`${porId.size} claves utilizables en el archivo.`)
if (servicios.length) console.log(`${servicios.length} SERVICIOS ignorados (no son material que se inventarie): ${servicios.slice(0, 5).join(' ')}...`)
if (sinUnidad.length) {
  console.log(`\n⚠ ${sinUnidad.length} con presentacion desconocida, NO se cargan:`)
  sinUnidad.slice(0, 10).forEach((s) => console.log('   ' + s))
}

const existentes = new Set((await db.collection('avios').get()).docs.map((d) => d.id))
const nuevas = [...porId.entries()].filter(([id]) => !existentes.has(id))
console.log(`\nYa en el catalogo: ${existentes.size} · Se agregarian: ${nuevas.length}`)

if (!ejecutar) {
  nuevas.slice(0, 10).forEach(([id, f]) => console.log(`  [ensayo] ${id.padEnd(24)} ${f.unidad.padEnd(9)} ${f.descripcion.slice(0, 44)}`))
  if (nuevas.length > 10) console.log(`  ... y ${nuevas.length - 10} mas`)
  console.log(`\nPara hacerlo: EJECUTAR=1 node scripts/ampliar_catalogo_avios.mjs "${ruta}"`)
  process.exit(0)
}

let creadas = 0
for (const [id, f] of nuevas) {
  try {
    await db.collection('avios').doc(id).create({
      codigo: id,
      descripcion: f.descripcion,
      tipo: tipoDe(f.clave, f.descripcion),
      unidad: f.unidad,
      activo: true,
      creadoEn: FieldValue.serverTimestamp(),
      creadoPorUid: 'ampliacion-catalogo-microsip-2026-08-20',
      ...(f.clave.toUpperCase() !== id ? { claveMicrosip: f.clave.toUpperCase() } : {})
    })
    creadas += 1
    if (creadas % 100 === 0) console.log(`  ${creadas} de ${nuevas.length}...`)
  } catch (err) {
    if (err.code !== 6) console.error(`FALLO ${id}: ${err.message}`)
  }
}
console.log(`\nLISTO: ${creadas} claves nuevas en el catalogo.`)
process.exit(0)
