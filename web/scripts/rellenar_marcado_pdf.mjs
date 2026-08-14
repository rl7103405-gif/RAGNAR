/**
 * Relleno HACIA ATRAS del marcado "ya enviado a PDF" en los bultos.
 *
 * Los PDFs generados ANTES del 2026-08-07 (cuando se estreno el marcado
 * pdfGeneradoEn/pdfFolioInterno) nunca marcaron sus folios: la bitacora
 * pdfsGenerados dice que el folio salio en un PDF, pero el bulto sigue
 * como "Sin mandar" en Historial y Captura.
 *
 * Este script recorre TODA la bitacora (la fuente de verdad), arma el mapa
 * folio -> ultimo PDF en que salio, y marca los bultos que no tengan
 * marcado. NUNCA pisa un marcado existente (los del flujo nuevo ya traen
 * la verdad y pudieron ser posteriores).
 *
 * Uso:
 *   node scripts/rellenar_marcado_pdf.mjs            <- ensayo (no escribe)
 *   EJECUTAR=1 node scripts/rellenar_marcado_pdf.mjs <- escribe de verdad
 *
 * Requiere serviceAccountKey.json en web/ (igual que asignar_roles.mjs).
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'
console.log(ejecutar ? '== MODO REAL: se van a escribir marcados ==' : '== ENSAYO: no se escribe nada ==')

// 1) Toda la bitacora, en orden cronologico: si un folio salio en dos PDFs
// (regenerado), gana el MAS RECIENTE, que es el papel vigente.
const snapPdfs = await db.collection('pdfsGenerados').orderBy('creadoEn', 'asc').get()
console.log(`PDFs en bitacora: ${snapPdfs.size}`)

const porFolio = new Map() // folio -> { creadoEn, folioInterno }
for (const docPdf of snapPdfs.docs) {
  const d = docPdf.data()
  const bruto = d.encabezado?.folioInterno
  const numero = Number(bruto)
  const folioInterno = Number.isFinite(numero) && String(bruto).trim() !== '' ? numero : null
  for (const folio of d.folios || []) {
    porFolio.set(String(folio), { creadoEn: d.creadoEn, folioInterno })
  }
}
console.log(`Folios distintos mencionados en PDFs: ${porFolio.size}`)

// 2) Marcar los bultos que existan y NO tengan marcado.
let marcados = 0
let yaMarcados = 0
let inexistentes = 0
const escritor = db.bulkWriter()
const folios = [...porFolio.keys()]
const LOTE = 300
for (let i = 0; i < folios.length; i += LOTE) {
  const lote = folios.slice(i, i + LOTE)
  const refs = lote.map((f) => db.collection('bultos').doc(f))
  const snaps = await db.getAll(...refs)
  for (const snap of snaps) {
    if (!snap.exists) {
      inexistentes += 1
      continue
    }
    if (snap.data().pdfGeneradoEn) {
      yaMarcados += 1
      continue
    }
    const info = porFolio.get(snap.id)
    marcados += 1
    if (ejecutar) {
      escritor.update(snap.ref, {
        pdfGeneradoEn: info.creadoEn,
        pdfFolioInterno: info.folioInterno
      })
    } else if (marcados <= 10) {
      console.log(`  [ensayo] marcaria ${snap.id} -> folio interno ${info.folioInterno}`)
    }
  }
}
await escritor.close()

console.log(`\nResultado${ejecutar ? '' : ' (ensayo)'}:`)
console.log(`  Marcados${ejecutar ? '' : ' (se marcarian)'}: ${marcados}`)
console.log(`  Ya tenian marcado (no se tocaron): ${yaMarcados}`)
console.log(`  En PDFs pero ya no existen como bulto (eliminados): ${inexistentes}`)
