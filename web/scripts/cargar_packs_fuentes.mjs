/**
 * Carga config/packsFuentes: los pares por pack que dicen MICROSIP (por modelo)
 * y los TECH PACKS de Lety (por codigo). Lo usa packsFuentes.js para pasar de
 * docenas a packs en el PL y en el Inventario de PT.
 *
 * Por que un script y no el navegador: Valeria y Cielo no pueden leer los tech
 * packs (reglas), y el Excel de Articulos de Microsip vive en esta maquina. Asi
 * ellas solo ven el dato derivado (modelo -> pares), nunca el archivo.
 *
 * Uso (en web/):
 *   node scripts/cargar_packs_fuentes.mjs                    <- ensayo, no escribe
 *   EJECUTAR=1 node scripts/cargar_packs_fuentes.mjs
 *   ARTICULOS="ruta\\Articulos.xlsx" node scripts/cargar_packs_fuentes.mjs
 *
 * Correrlo otra vez cuando llegue un Excel de Articulos nuevo o Lety cambie el
 * "pares por pack" de un tech pack. El pedido de Adrian NO pasa por aqui: se
 * lee al momento del plan vigente.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import ExcelJS from 'exceljs'
import { esPlantilla, leerPlantilla } from '../src/utils/leerPlantillaTechPack.js'
import { PARES_MAX, PARES_MIN, paresEnTexto, tokensDeModelo } from '../src/utils/packsPorCodigo.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
const ARTICULOS = process.env.ARTICULOS || fileURLToPath(new URL('../../datos/catalogos/Artículos 130826.xlsx', import.meta.url))
const TOPE_BYTES = 800 * 1024
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

// ---------- Microsip
const bufArticulos = readFileSync(ARTICULOS)
const libro = new ExcelJS.Workbook()
await libro.xlsx.load(bufArticulos)
const hoja = libro.getWorksheet('Artículos') || libro.worksheets[0]
const cab = (hoja.getRow(1).values || []).map((v) => String(v || '').trim().toUpperCase())
const colNombre = cab.indexOf('NOMBRE')
if (colNombre < 1) {
  console.error(`La hoja "${hoja.name}" no trae la columna Nombre. Encabezados: ${cab.filter(Boolean).join(', ')}`)
  process.exit(1)
}
const microsipSets = new Map() // TOKEN -> Set pares
let nombresConPack = 0
hoja.eachRow((fila, i) => {
  if (i === 1) return
  const nombre = String(fila.getCell(colNombre).value || '')
  const pares = paresEnTexto(nombre)
  if (pares == null) return
  const tokens = tokensDeModelo(nombre)
  if (!tokens.size) return
  nombresConPack++
  for (const k of tokens) {
    if (!microsipSets.has(k)) microsipSets.set(k, new Set())
    microsipSets.get(k).add(pares)
  }
})
const microsip = Object.fromEntries([...microsipSets].sort().map(([k, s]) => [k, [...s].sort((a, b) => a - b)]))
const choquesMicrosip = Object.entries(microsip).filter(([, v]) => v.length > 1)
console.log(`Microsip: ${nombresConPack} articulos con pack, ${Object.keys(microsip).length} modelos, ${choquesMicrosip.length} con dos packs distintos`)
for (const [k, v] of choquesMicrosip) console.log(`   choque interno ${k}: ${v.join(' y ')}`)

// ---------- Tech packs
/** Junta los pedazos del archivo tal como los guarda la app (igual que medir_tech_packs.mjs). */
async function armarArchivo(codigo, manifiesto) {
  const chunks = await db.collection('techPacks').doc(codigo).collection('chunks').get()
  const pedazos = chunks.docs
    .filter((d) => d.id.startsWith('tp-'))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => {
      const v = d.data().datos
      return Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v)
    })
  if (pedazos.length !== manifiesto.totalChunks) return null
  return Buffer.concat(pedazos)
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
const paresDeTp = new Map() // id del tech pack -> { pares, codigos }
const apuntan = []
let leidos = 0, sinPack = 0, noPlantilla = 0, fallidos = 0
for (const d of snap.docs) {
  const x = d.data()
  if (x.apuntaA) { apuntan.push([d.id, String(x.apuntaA)]); continue }
  if (!x.techPack || x.techPack.formato !== 'xlsx') continue
  try {
    const buf = await armarArchivo(d.id, x.techPack)
    if (!buf) { fallidos++; continue }
    const l = new ExcelJS.Workbook()
    await l.xlsx.load(buf)
    if (!esPlantilla(l)) { noPlantilla++; continue }
    const lectura = leerPlantilla(l)
    leidos++
    const pares = Number(lectura.campos?.TP_PACK)
    if (!Number.isInteger(pares) || pares < PARES_MIN || pares > PARES_MAX) { sinPack++; continue }
    const codigos = new Set([d.id.toUpperCase()])
    for (const r of lectura.tablas?.TP_TABLA_PEDIDO || []) {
      const c = String(r.codigo || '').trim().toUpperCase()
      if (c) codigos.add(c)
    }
    paresDeTp.set(d.id, { pares, codigos })
  } catch (err) {
    fallidos++
    console.log(`   ${d.id}: no se pudo leer (${err.message})`)
  }
}
const techpackSets = new Map() // CODIGO -> Map techPack -> pares
const agregar = (codigo, techPack, pares) => {
  if (!techpackSets.has(codigo)) techpackSets.set(codigo, new Map())
  techpackSets.get(codigo).set(techPack, pares)
}
for (const [id, { pares, codigos }] of paresDeTp) for (const c of codigos) agregar(c, id, pares)
for (const [id, destino] of apuntan) {
  const t = paresDeTp.get(destino)
  if (t) agregar(id.toUpperCase(), destino, t.pares)
}
const techpack = Object.fromEntries(
  [...techpackSets].sort().map(([c, m]) => [c, [...m].map(([tp, pares]) => ({ techPack: tp, pares }))])
)
const choquesTp = Object.entries(techpack).filter(([, v]) => new Set(v.map((e) => e.pares)).size > 1)
console.log(`Tech packs: ${leidos} plantillas leidas, ${paresDeTp.size} con pares por pack, ${sinPack} sin el dato, ${noPlantilla} no son plantilla, ${fallidos} fallidos`)
console.log(`   ${Object.keys(techpack).length} codigos cubiertos, ${choquesTp.length} con dos tech packs que dicen distinto`)

// ---------- Documento
const datos = {
  version: 1,
  microsip,
  techpack,
  microsipArchivo: basename(ARTICULOS),
  microsipSha256: createHash('sha256').update(bufArticulos).digest('hex'),
  microsipArticulosConPack: nombresConPack,
  techPacksConPares: paresDeTp.size
}
const bytes = Buffer.byteLength(JSON.stringify(datos))
console.log(`Tamano del documento: ${(bytes / 1024).toFixed(1)} KiB (tope ${TOPE_BYTES / 1024} KiB)`)
if (bytes > TOPE_BYTES) {
  console.error('Demasiado grande para un solo documento: hay que partirlo. No se escribe nada.')
  process.exit(1)
}
if (process.env.SALIDA) {
  // Copia local para medir la cobertura antes de escribir en produccion.
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.SALIDA, JSON.stringify(datos))
  console.log(`Copia local en ${process.env.SALIDA}`)
}
if (EJECUTAR) {
  await db.doc('config/packsFuentes').set({ ...datos, cargadoEn: FieldValue.serverTimestamp() })
  console.log('Guardado en config/packsFuentes.')
} else {
  console.log('\nEnsayo. Para guardarlo:  EJECUTAR=1 node scripts/cargar_packs_fuentes.mjs')
}
