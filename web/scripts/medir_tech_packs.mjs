/**
 * QUE TAN COMPLETO ESTA CADA TECH PACK DE LA BIBLIOTECA.
 *
 * Roberto (2026-09-10): "no veo el avance de los tech packs... hay que armar
 * una tabla. En base al tech pack estandar que nos mando Lety, vamos a sacar
 * una calificacion; ese va a ser un diez de diez".
 *
 * El estandar NO esta inventado: son las siete hojas del
 * "TECH PACK 4504298831 QUI-CSHA20X.xlsx" que Lety mando el 8-sep como su
 * ejemplo al 100% (ver web/src/utils/completadoTechPack.js, que es el MISMO
 * criterio que usa la pantalla; aqui no se duplica la regla, se importa).
 *
 * Se mide en el SERVIDOR y el resultado se guarda en el documento, en
 * `medicion`. Asi la tabla se pinta sin que nadie tenga que bajar 120 Excel.
 *
 * Uso (en web/):  node scripts/medir_tech_packs.mjs              <- ensayo
 *                 EJECUTAR=1 node scripts/medir_tech_packs.mjs
 *                 SOLO=1561-I,BARBIE  (opcional, para uno o varios)
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import ExcelJS from 'exceljs'
import { RUBROS_TECH_PACK } from '../src/utils/completadoTechPack.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
const SOLO = new Set(String(process.env.SOLO || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

const normaliza = (s) =>
  String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Junta los pedazos del archivo tal como los guarda la app. */
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

/** Las hojas del Excel, con si traen imagenes: lo que necesita medirCompletado. */
async function hojasDelExcel(buffer) {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(buffer)
  const imagenesPorHoja = new Map()
  libro.eachSheet((hoja) => {
    let n = 0
    try { n = (hoja.getImages?.() || []).length } catch { n = 0 }
    imagenesPorHoja.set(hoja.name, n)
  })
  const hojas = []
  libro.eachSheet((hoja) => hojas.push({ nombre: hoja.name, imagenes: new Array(imagenesPorHoja.get(hoja.name) || 0).fill(0) }))
  return hojas
}

/** El mismo criterio de la pantalla, aplicado aqui. */
function medir(hojas) {
  const nombres = hojas.map((h) => normaliza(h.nombre))
  const hayImagenes = hojas.some((h) => (h.imagenes?.length || 0) > 0)
  const rubros = RUBROS_TECH_PACK.map((r) => ({
    id: r.id,
    titulo: r.titulo,
    tiene: r.porImagenes ? hayImagenes : nombres.some((n) => r.prefijos.some((p) => n.startsWith(normaliza(p))))
  }))
  const cumplidos = rubros.filter((r) => r.tiene).length
  return {
    porcentaje: Math.round((cumplidos / rubros.length) * 100),
    calificacion: Math.round((cumplidos / rubros.length) * 100) / 10,
    tiene: rubros.filter((r) => r.tiene).map((r) => r.id),
    faltan: rubros.filter((r) => !r.tiene).map((r) => r.id)
  }
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
const conArchivo = snap.docs.filter((d) => d.data().techPack && !d.data().apuntaA)
console.log(`tech packs con archivo: ${conArchivo.length}\n`)

let medidos = 0, saltados = 0, fallidos = 0
const reparto = {}
for (const d of conArchivo) {
  const codigo = d.id
  if (SOLO.size && !SOLO.has(codigo.toUpperCase())) continue
  const dato = d.data()
  if (dato.techPack.formato !== 'xlsx') {
    console.log(`  ${codigo.padEnd(24)} PDF: no se puede medir por hojas, se deja sin calificar`)
    saltados++
    continue
  }
  try {
    const buf = await armarArchivo(codigo, dato.techPack)
    if (!buf) { console.log(`  ${codigo.padEnd(24)} le faltan pedazos, no se mide`); fallidos++; continue }
    const hojas = await hojasDelExcel(buf)
    const m = medir(hojas)
    reparto[m.porcentaje] = (reparto[m.porcentaje] || 0) + 1
    console.log(`  ${codigo.padEnd(24)} ${String(m.porcentaje).padStart(3)}%  (${m.calificacion}/10)  ${m.faltan.length ? 'falta: ' + m.faltan.join(', ') : 'completo'}`)
    if (EJECUTAR) {
      await d.ref.update({
        medicion: { ...m, hojas: hojas.length, medidoEn: new Date(), version: '2026-09-v1' }
      })
    }
    medidos++
  } catch (e) {
    console.log(`  ${codigo.padEnd(24)} no se pudo leer: ${e.message?.slice(0, 60)}`)
    fallidos++
  }
}

console.log(`\nmedidos: ${medidos} | PDF sin medir: ${saltados} | fallidos: ${fallidos}`)
console.log('\nREPARTO DE CALIFICACIONES:')
Object.keys(reparto).map(Number).sort((a, b) => b - a).forEach((p) => {
  console.log(`  ${String(p).padStart(3)}% (${p / 10}/10): ${'#'.repeat(Math.min(60, reparto[p]))} ${reparto[p]}`)
})
if (!EJECUTAR) console.log('\nEnsayo. Para guardarlo:  EJECUTAR=1 node scripts/medir_tech_packs.mjs')
