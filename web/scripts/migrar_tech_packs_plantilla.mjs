/**
 * MIGRA LOS TECH PACKS DE LA BIBLIOTECA A LA PLANTILLA TP-QUINI v1.
 *
 * Roberto, 2026-09-11: "quiero que los ciento veintiuno tengan este formato".
 * Fase F6 de docs/plan-plantilla-tech-pack-v1.md.
 *
 * Este script NO ESCRIBE en Firestore: baja cada tech pack real, arma el
 * borrador en la plantilla nueva y lo deja en una carpeta local junto con un
 * reporte (de que celda salio cada dato, que no cuadra, que falta). Subir los
 * borradores a la biblioteca es otro paso, despues de que Roberto y Lety vean
 * una muestra.
 *
 * Uso (en web/):
 *   node scripts/migrar_tech_packs_plantilla.mjs "<carpeta de salida>"
 *   SOLO=CPD32-UN-01711,QUI-CSHA20X   (opcional)
 */
import ExcelJS from 'exceljs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { extraerTechPackViejo } from '../src/utils/migrarTechPackViejo.js'
import { generarPlantillaTechPack } from '../src/utils/generarPlantillaTechPack.js'
import { nombreDeArchivo } from '../src/utils/plantillaTechPack.js'
import { LOGO_QUINI_PNG_BASE64 } from '../src/assets/logoQuini.js'

const SALIDA = process.argv[2]
if (!SALIDA) { console.error('Uso: node scripts/migrar_tech_packs_plantilla.mjs "<carpeta de salida>"'); process.exit(1) }
mkdirSync(SALIDA, { recursive: true })
const SOLO = new Set(String(process.env.SOLO || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()

// Lo que el plan vigente sabe de cada OT (OC y destino).
const cfg = (await db.doc('config/planMaestroActivo').get()).data() || {}
const planPorOt = new Map()
if (cfg.versionId) {
  const ls = await db.collection('planMaestroLineas').where('versionId', '==', cfg.versionId).get()
  for (const d of ls.docs) {
    const l = d.data()
    if (!planPorOt.has(l.ot)) planPorOt.set(l.ot, { ocs: new Set(), destino: '' })
    const p = planPorOt.get(l.ot)
    if (l.oc) p.ocs.add(l.oc)
    if (l.destino && !p.destino) p.destino = l.destino
  }
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
const docs = snap.docs.filter((d) => d.data().techPack?.totalChunks && !d.data().apuntaA)
console.log(`tech packs con archivo: ${docs.length} | plan vigente: ${cfg.versionId || 'ninguno'}\n`)

const resumen = []
for (const d of docs.sort((a, b) => a.id.localeCompare(b.id))) {
  const codigo = d.id
  if (SOLO.size && !SOLO.has(codigo.toUpperCase())) continue
  const tp = d.data().techPack
  const fila = { codigo, archivo: tp.nombre || '', formato: tp.formato }
  try {
    if (tp.formato !== 'xlsx') { fila.estado = 'PDF: no se migra solo (hay que rehacerlo en la plantilla)'; resumen.push(fila); console.log(`  ${codigo.padEnd(26)} PDF`); continue }
    // Si este tech pack ya se reemplazo por la plantilla, el original de Lety
    // vive en respaldoOriginal (reemplazar_tech_packs_por_plantilla.mjs).
    const sub = d.data().migracionTpQuini && d.data().techPackAnterior ? 'respaldoOriginal' : 'chunks'
    const chunks = (await d.ref.collection(sub).get()).docs.filter((x) => x.id.startsWith('tp-')).sort((a, b) => a.id.localeCompare(b.id))
    const buf = Buffer.concat(chunks.map((x) => Buffer.from(x.data().datos)))
    if (sub === 'respaldoOriginal') fila.origen = 'respaldo'
    const viejo = new ExcelJS.Workbook()
    await viejo.xlsx.load(buf)

    // Primera pasada sin plan para saber la OT; luego con lo que el plan diga.
    const previa = extraerTechPackViejo(viejo, { codigo })
    const ots = [...new Set(previa.datos.renglones.map((r) => r.ot).filter(Boolean))]
    const ocsPlan = [...new Set(ots.flatMap((ot) => [...(planPorOt.get(ot)?.ocs || [])]))]
    const destino = ots.map((ot) => planPorOt.get(ot)?.destino).find(Boolean) || ''
    const { datos, reporte } = extraerTechPackViejo(viejo, { codigo, ocDelPlan: ocsPlan.length === 1 ? ocsPlan[0] : '', destinoDelPlan: destino })
    if (ocsPlan.length > 1) reporte.conflictos.push(`el plan tiene ${ocsPlan.length} OC para sus OT (${ocsPlan.join(', ')}): la OC se dejo la del archivo`)

    const libro = generarPlantillaTechPack({
      Workbook: ExcelJS.Workbook,
      logoBase64: LOGO_QUINI_PNG_BASE64,
      datos: {
        ...datos,
        generadoPorNombre: 'Migracion automatica (borrador)',
        migradoDe: { codigo, archivo: tp.nombre, sha256: tp.sha256, version: tp.version || 1 },
        reporteMigracion: { campos: reporte.campos, conflictos: reporte.conflictos, faltantes: reporte.faltantes }
      }
    })
    const salidaXlsx = join(SALIDA, nombreDeArchivo(codigo))
    writeFileSync(salidaXlsx, Buffer.from(await libro.xlsx.writeBuffer()))
    writeFileSync(join(SALIDA, `${codigo}.reporte.json`), JSON.stringify(reporte, null, 1))

    Object.assign(fila, {
      estado: 'ok',
      renglones: reporte.conteo.renglones,
      avios: reporte.conteo.avios,
      usaArchivo: reporte.conteo.aviosConUsaDelArchivo,
      usaInferido: reporte.conteo.aviosUsaInferido,
      fotos: Object.values(reporte.conteo.fotos).reduce((a, x) => a + x, 0),
      conflictos: reporte.conflictos.length,
      faltantes: reporte.faltantes.length,
      detalle: [...reporte.conflictos, ...reporte.faltantes.map((f) => 'falta ' + f)].join(' | ')
    })
    console.log(`  ${codigo.padEnd(26)} ok  ${String(fila.renglones).padStart(2)} renglones · ${String(fila.avios).padStart(2)} avios · ${String(fila.fotos).padStart(2)} fotos · ${fila.conflictos} conflictos · ${fila.faltantes} faltantes`)
  } catch (err) {
    fila.estado = 'ERROR: ' + (err?.message || String(err)).slice(0, 160)
    console.log(`  ${codigo.padEnd(26)} ERROR ${fila.estado}`)
  }
  resumen.push(fila)
}

const csv = [['codigo', 'archivo', 'estado', 'renglones', 'avios', 'usa_del_archivo', 'usa_inferido', 'fotos', 'conflictos', 'faltantes', 'detalle']]
  .concat(resumen.map((r) => [r.codigo, r.archivo, r.estado, r.renglones ?? '', r.avios ?? '', r.usaArchivo ?? '', r.usaInferido ?? '', r.fotos ?? '', r.conflictos ?? '', r.faltantes ?? '', r.detalle ?? '']))
  .map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))
  .join('\n')
writeFileSync(join(SALIDA, '_RESUMEN_MIGRACION.csv'), '﻿' + csv)
const ok = resumen.filter((r) => r.estado === 'ok')
console.log(`\nmigrados: ${ok.length} | PDF: ${resumen.filter((r) => /^PDF/.test(r.estado)).length} | errores: ${resumen.filter((r) => /^ERROR/.test(r.estado)).length}`)
console.log(`sin conflictos ni faltantes: ${ok.filter((r) => !r.conflictos && !r.faltantes).length}`)
console.log(`carpeta: ${SALIDA}`)
