/**
 * REEMPLAZA EL TECH PACK OFICIAL DE LA BIBLIOTECA POR SU VERSION EN LA
 * PLANTILLA TP-QUINI v1 (la que armo migrar_tech_packs_plantilla.mjs).
 *
 * Decision de Roberto, 2026-09-11: "Reemplazar ya el oficial" (el original
 * queda como respaldo). Antes de escribir, por cada tech pack:
 *   1. se baja el original y se verifica su sha256 contra el manifiesto;
 *   2. se guarda una copia LOCAL en <carpeta>/_respaldo_originales/;
 *   3. se copian sus pedazos a techPacks/{codigo}/respaldoOriginal/ (la app
 *      no tiene regla para esa subcoleccion: solo se lee con Admin SDK) y el
 *      manifiesto viejo queda en `techPackAnterior`;
 *   4. se suben los pedazos nuevos, se vuelven a bajar y se verifica sha256;
 *   5. se actualiza el manifiesto y la medicion v2 (por datos de la plantilla).
 *
 * Si un tech pack ya fue reemplazado (trae `migracionTpQuini`), NO se vuelve
 * a respaldar: el respaldo es siempre el original de Lety.
 *
 * Uso (en web/):
 *   node scripts/reemplazar_tech_packs_por_plantilla.mjs "<carpeta de la migracion>"          <- ensayo
 *   EJECUTAR=1 node scripts/reemplazar_tech_packs_por_plantilla.mjs "<carpeta>"
 *   SOLO=CPD32-UN-01711   (opcional)
 */
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { nombreDeArchivo } from '../src/utils/plantillaTechPack.js'
import { esPlantilla, leerPlantilla, medirPlantilla } from '../src/utils/leerPlantillaTechPack.js'

const CARPETA = process.argv[2]
if (!CARPETA) { console.error('Uso: node scripts/reemplazar_tech_packs_por_plantilla.mjs "<carpeta de la migracion>"'); process.exit(1) }
const EJECUTAR = process.env.EJECUTAR === '1'
const SOLO = new Set(String(process.env.SOLO || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
const CHUNK_BYTES = 950000
const MAX_CHUNKS = 17
const QUIEN = { uid: 'migracion-tp-quini-2026-09', nombre: 'Migracion a plantilla TP-Quini (automatica)' }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const pad2 = (i) => String(i).padStart(2, '0')

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
console.log(EJECUTAR ? 'APLICANDO (escribe en la biblioteca real)' : 'ENSAYO (no escribe nada)')

const bajar = async (ref, sub, prefijo, total) => {
  const docs = (await ref.collection(sub).get()).docs.filter((d) => d.id.startsWith(prefijo + '-')).sort((a, b) => a.id.localeCompare(b.id))
  if (docs.length < total) return null
  return Buffer.concat(docs.slice(0, total).map((d) => Buffer.from(d.data().datos)))
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
const docs = snap.docs.filter((d) => d.data().techPack?.totalChunks && !d.data().apuntaA && d.data().techPack.formato === 'xlsx')
let listos = 0, saltados = 0, fallidos = 0
const respaldoLocal = join(CARPETA, '_respaldo_originales')
if (EJECUTAR) mkdirSync(respaldoLocal, { recursive: true })

for (const d of docs.sort((a, b) => a.id.localeCompare(b.id))) {
  const codigo = d.id
  if (SOLO.size && !SOLO.has(codigo.toUpperCase())) continue
  const data = d.data()
  const tp = data.techPack
  const ruta = join(CARPETA, nombreDeArchivo(codigo))
  const rutaRep = join(CARPETA, `${codigo}.reporte.json`)
  try {
    if (!existsSync(ruta)) { console.log(`  ${codigo.padEnd(26)} sin convertido en la carpeta, se salta`); saltados++; continue }
    const nuevo = readFileSync(ruta)
    const totalNuevo = Math.ceil(nuevo.length / CHUNK_BYTES)
    if (totalNuevo > MAX_CHUNKS) { console.log(`  ${codigo.padEnd(26)} el convertido pesa ${(nuevo.length / 1048576).toFixed(1)} MB (> 17 pedazos), se salta`); saltados++; continue }
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.load(nuevo)
    if (!esPlantilla(libro)) { console.log(`  ${codigo.padEnd(26)} el convertido no es plantilla TP-Quini, se salta`); saltados++; continue }
    const medida = medirPlantilla(leerPlantilla(libro))
    const reporte = existsSync(rutaRep) ? JSON.parse(readFileSync(rutaRep, 'utf8')) : { conflictos: [], faltantes: [] }
    const yaMigrado = Boolean(data.migracionTpQuini)

    // 1. el original, verificado
    let original = null
    if (!yaMigrado) {
      original = await bajar(d.ref, 'chunks', 'tp', tp.totalChunks)
      if (!original || original.length !== tp.tamano || sha(original) !== tp.sha256) {
        console.log(`  ${codigo.padEnd(26)} el ORIGINAL no pasa la verificacion (pedazos/tamano/sha256): NO se toca`)
        fallidos++
        continue
      }
    }
    console.log(`  ${codigo.padEnd(26)} ${yaMigrado ? 'ya migrado (se actualiza el convertido)' : 'original ok'} · nuevo ${(nuevo.length / 1048576).toFixed(1)} MB, ${totalNuevo} pedazos · ${medida.porcentaje}% (${medida.calificacion}/10) falta: ${medida.faltan.join(', ') || 'nada'}`)
    if (!EJECUTAR) { listos++; continue }

    // 2 y 3. respaldo local y en Firestore (solo la primera vez)
    if (!yaMigrado) {
      writeFileSync(join(respaldoLocal, `${codigo}__${String(tp.nombre || 'original.xlsx').replace(/[\\/:*?"<>|]+/g, '-')}`), original)
      for (let i = 0; i < tp.totalChunks; i++) {
        await d.ref.collection('respaldoOriginal').doc(`tp-${pad2(i)}`).set({ codigo, tipo: 'tp', datos: original.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
      }
      const vuelta = await bajar(d.ref, 'respaldoOriginal', 'tp', tp.totalChunks)
      if (!vuelta || sha(vuelta) !== tp.sha256) throw new Error('el respaldo en Firestore no coincide con el original; no se reemplaza')
    }

    // 4. pedazos nuevos, verificados
    for (let i = 0; i < totalNuevo; i++) {
      await d.ref.collection('chunks').doc(`tp-${pad2(i)}`).set({ codigo, tipo: 'tp', datos: nuevo.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
    }
    for (const c of (await d.ref.collection('chunks').get()).docs) {
      const [t, n] = c.id.split('-')
      if (t === 'tp' && Number(n) >= totalNuevo) await c.ref.delete()
    }
    const subido = await bajar(d.ref, 'chunks', 'tp', totalNuevo)
    const shaNuevo = sha(nuevo)
    if (!subido || sha(subido) !== shaNuevo) throw new Error('lo subido no coincide con el convertido (sha256)')

    // 5. manifiesto, respaldo y medicion
    const ahora = FieldValue.serverTimestamp()
    await d.ref.update({
      techPack: { nombre: nombreDeArchivo(codigo), formato: 'xlsx', tamano: nuevo.length, totalChunks: totalNuevo, sha256: shaNuevo, version: (tp.version || 1) + 1, subidoEn: ahora, subidoPorUid: QUIEN.uid, subidoPorNombre: QUIEN.nombre },
      ...(yaMigrado ? {} : { techPackAnterior: { ...tp, respaldadoEn: ahora, coleccion: 'respaldoOriginal' } }),
      migracionTpQuini: { en: ahora, plantilla: 'TP-QUINI v1', conflictos: (reporte.conflictos || []).slice(0, 40), faltantes: (reporte.faltantes || []).slice(0, 40) },
      medicion: { ...medida, hojas: libro.worksheets.length, medidoEn: new Date(), version: '2026-09-v2-plantilla' },
      actualizadoEn: ahora, actualizadoPorUid: QUIEN.uid, actualizadoPorNombre: QUIEN.nombre
    })
    listos++
  } catch (err) {
    console.log(`  ${codigo.padEnd(26)} ERROR ${(err?.message || String(err)).slice(0, 160)}`)
    fallidos++
  }
}
console.log(`\n${EJECUTAR ? 'reemplazados' : 'listos para reemplazar'}: ${listos} | saltados: ${saltados} | con error / sin tocar: ${fallidos}`)
if (!EJECUTAR) console.log('Ensayo. Para aplicarlo: EJECUTAR=1 node scripts/reemplazar_tech_packs_por_plantilla.mjs "<carpeta>"')
process.exit(0)
