/**
 * PRUEBA EL CONVERTIDOR "AL SUBIR" CON ARCHIVOS REALES DE LA BIBLIOTECA.
 *
 * Solo lectura: baja los pedazos de cada tech pack, corre exactamente la misma
 * funcion que usa el navegador (pasarAlFormatoTPQuini) y reporta que salio.
 * No escribe nada en Firestore.
 *
 * Uso (en web/):  node scripts/probar_conversion_al_subir.mjs 6052-K,CIW10-513089001,CPD32-UN-01711
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { pasarAlFormatoTPQuini, ErrorConversion, resumenDeConversion } from '../src/utils/convertirTechPackAlSubir.js'
import { idsDePedazos } from '../src/utils/pedazosTechPack.js'
import { LOGO_QUINI_PNG_BASE64 } from '../src/assets/logoQuini.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const codigos = String(process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean)

async function bajar(codigo, manifiesto) {
  const chunks = await db.collection('techPacks').doc(codigo).collection('chunks').get()
  const porId = new Map(chunks.docs.map((d) => [d.id, d]))
  const { ids, completo } = idsDePedazos(new Set(porId.keys()), 'tp', manifiesto)
  if (!completo) throw new Error('faltan pedazos')
  return Buffer.concat(ids.map((id) => { const v = porId.get(id).data().datos; return Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v) }))
}

async function probar(nombre, buffer, codigo) {
  const t0 = Date.now()
  try {
    const r = await pasarAlFormatoTPQuini({
      contenido: buffer, codigo, nombre, sha256Original: createHash('sha256').update(buffer).digest('hex'),
      usuarioNombre: 'Prueba', Workbook: ExcelJS.Workbook, logoBase64: LOGO_QUINI_PNG_BASE64
    })
    console.log(`\n${codigo}  [${r.como}]  ${Math.round((Date.now() - t0) / 100) / 10}s  ${buffer.length} -> ${r.contenido.length} bytes  nombre: ${r.nombre}`)
    console.log(`   ${r.medicion.porcentaje}%  falta: ${r.medicion.faltan.join(', ') || '-'}`)
    if (r.reporte) console.log(`   USA por confirmar: ${r.reporte.usaPorConfirmar} · fotos saltadas: ${r.reporte.fotosSaltadas} · sobrantes: ${r.reporte.sobrantes}`)
    console.log('   aviso:' + (resumenDeConversion(r) || ' (sin conversion)'))
    // Lo que se guarda se puede volver a leer con el mismo convertidor (idempotente).
    const r2 = await pasarAlFormatoTPQuini({ contenido: r.contenido, codigo, nombre: r.nombre, sha256Original: 'x', usuarioNombre: 'Prueba', Workbook: ExcelJS.Workbook })
    console.log(`   reabierto: [${r2.como}] ${r2.medicion.porcentaje}%  migradoDe: ${JSON.stringify(r2.lectura.migradoDe)?.slice(0, 80) || '-'}`)
  } catch (e) {
    console.log(`\n${codigo}  ${e instanceof ErrorConversion ? 'RECHAZADO' : 'ERROR'}: ${e.message}`)
  }
}

for (const codigo of codigos) {
  const d = (await db.collection('techPacks').doc(codigo).get()).data()
  if (!d?.techPack) { console.log(`${codigo}: sin archivo`); continue }
  await probar(d.techPack.nombre, await bajar(codigo, d.techPack), codigo)
}

// Un Excel que NO es tech pack: tiene que rechazarse, no convertirse.
const ajeno = new ExcelJS.Workbook()
const h = ajeno.addWorksheet('Ventas')
h.addRow(['Producto', 'Cantidad', 'Precio']); h.addRow(['Calceta', 10, 25])
await probar('ventas.xlsx', Buffer.from(await ajeno.xlsx.writeBuffer()), 'PRUEBA-1')
