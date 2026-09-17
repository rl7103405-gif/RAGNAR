/**
 * PASA AL FORMATO TP-QUINI LOS TECH PACKS QUE SE SUBIERON ANTES DE QUE LA APP
 * CONVIRTIERA SOLA AL SUBIR.
 *
 * Roberto, 2026-09-17: "todos los que ya se subieron, tú vuélvelos a subir.
 * Pero que tú no cambies el formato, que el sistema automáticamente cambie el
 * formato. Está bien aunque la calificación baje: deberíamos ser duros y reales."
 *
 * Por eso este script NO convierte por su cuenta: llama a la MISMA funcion que
 * usa el navegador al subir (pasarAlFormatoTPQuini) y guarda lo que ella
 * devuelve, igual que guardarEnBiblioteca: pedazos con la huella en el id,
 * manifiesto con version + 1, cliente/modelo/codigos y calificacion leidos de
 * la plantilla, y aprobacion en null (siguen esperando a Lety).
 *
 * SOLO toca los que NO estan aprobados: convertir cambia la huella del archivo
 * y eso le quitaria el visto bueno a uno aprobado. Esos se reportan y ya.
 *
 * El ORIGINAL se respalda antes de escribir (copia local + subcoleccion
 * respaldoOriginal, que solo se lee con Admin SDK), igual que en la migracion
 * de los 120. El que lo subio sigue siendo quien lo subio (Monica): el archivo
 * es suyo, RAGNAR solo le cambio el formato, y asi queda dicho en la version.
 *
 * DESDE_RESPALDO=1: vuelve a convertir, DESDE SU ORIGINAL RESPALDADO, los que
 * este mismo script ya habia convertido. Sirve cuando se corrige el lector
 * del formato viejo (17-sep: la ruta sin titulo y el COLOR a secas de los
 * BEZDEK) y hay que rehacer la conversion con el lector bueno.
 *
 * Uso (en web/):
 *   node scripts/convertir_pendientes_al_formato.mjs "<carpeta de respaldo>"            <- ensayo
 *   EJECUTAR=1 node scripts/convertir_pendientes_al_formato.mjs "<carpeta de respaldo>"
 */
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { pasarAlFormatoTPQuini } from '../src/utils/convertirTechPackAlSubir.js'
import { leerPlantilla } from '../src/utils/leerPlantillaTechPack.js'
import { identidadDePlantilla } from '../src/utils/clienteModeloTechPack.js'
import { idPedazo, idsDePedazos, idsSobrantes } from '../src/utils/pedazosTechPack.js'
import { LOGO_QUINI_PNG_BASE64 } from '../src/assets/logoQuini.js'

const CARPETA = process.argv[2]
if (!CARPETA) { console.error('Uso: node scripts/convertir_pendientes_al_formato.mjs "<carpeta de respaldo>"'); process.exit(1) }
mkdirSync(CARPETA, { recursive: true })
const EJECUTAR = process.env.EJECUTAR === '1'
const DESDE_RESPALDO = process.env.DESDE_RESPALDO === '1'
const MARCA = 'conversion-tp-quini-2026-09-17'
const CHUNK_BYTES = 950000
const MAX_CHUNKS = 17
const sha = (b) => createHash('sha256').update(b).digest('hex')
const pad2 = (i) => String(i).padStart(2, '0')

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

async function bajar(ref, manifiesto) {
  const chunks = await ref.collection('chunks').get()
  const porId = new Map(chunks.docs.map((d) => [d.id, d]))
  const { ids, completo } = idsDePedazos(new Set(porId.keys()), 'tp', manifiesto)
  if (!completo) return null
  return Buffer.concat(ids.map((id) => { const v = porId.get(id).data().datos; return Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v) }))
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
const candidatos = snap.docs.filter((d) => { const x = d.data(); return !x.apuntaA && x.techPack?.totalChunks && x.techPack.formato === 'xlsx' })
let listos = 0, yaEstaban = 0, aprobadosViejos = 0, fallidos = 0

for (const d of candidatos.sort((a, b) => a.id.localeCompare(b.id))) {
  const codigo = d.id
  const x = d.data()
  const tp = x.techPack
  try {
    const rehacer = DESDE_RESPALDO && x.actualizadoPorUid === MARCA
    if (DESDE_RESPALDO && !rehacer) { yaEstaban++; continue }
    // El original. Al REHACER no se usa respaldoOriginal: un documento que ya
    // traia un respaldo de una migracion anterior conserva AQUEL (CIW11 daba
    // otro resultado por eso, 17-sep). Se usa la copia local que este script
    // dejo al convertir, y se verifica contra la huella del original que quedo
    // escrita DENTRO del archivo convertido (_RAGNAR.migradoDe).
    let fuente = tp
    let original
    if (rehacer) {
      const vigente = await bajar(d.ref, tp)
      const libroV = new ExcelJS.Workbook()
      await libroV.xlsx.load(vigente)
      const de = leerPlantilla(libroV).migradoDe
      const archivo = readdirSync(CARPETA).find((f) => f.startsWith(codigo + '__'))
      if (!de?.sha256 || !archivo) { console.log(`  ${codigo.padEnd(24)} no hay copia local del original o el convertido no dice de donde salio: NO se toca`); fallidos++; continue }
      original = readFileSync(join(CARPETA, archivo))
      fuente = { nombre: de.archivo, sha256: de.sha256, tamano: de.tamano }
    } else original = await bajar(d.ref, tp)
    if (!original || original.length !== fuente.tamano || sha(original) !== fuente.sha256) { console.log(`  ${codigo.padEnd(24)} el archivo guardado no pasa la verificacion: NO se toca`); fallidos++; continue }
    let r
    try {
      r = await pasarAlFormatoTPQuini({ contenido: original, codigo, nombre: fuente.nombre, sha256Original: fuente.sha256, usuarioNombre: tp.subidoPorNombre || 'RAGNAR', Workbook: ExcelJS.Workbook, logoBase64: LOGO_QUINI_PNG_BASE64 })
    } catch (e) { console.log(`  ${codigo.padEnd(24)} el sistema NO lo pudo convertir: ${e.message.slice(0, 120)}`); fallidos++; continue }
    if (r.como === 'v2') { yaEstaban++; continue }
    if (rehacer && sha(Buffer.from(r.contenido)) === tp.sha256) { yaEstaban++; continue }
    const aprobado = x.aprobacion?.sha256 && x.aprobacion.sha256 === tp.sha256
    if (aprobado) { console.log(`  ${codigo.padEnd(24)} formato ${r.como} pero YA APROBADO: no se toca (convertirlo le quitaria el visto bueno)`); aprobadosViejos++; continue }

    const nuevo = Buffer.from(r.contenido)
    const total = Math.ceil(nuevo.length / CHUNK_BYTES)
    if (total > MAX_CHUNKS) { console.log(`  ${codigo.padEnd(24)} convertido rebasa los 15 MB: NO se toca`); fallidos++; continue }
    const shaNuevo = sha(nuevo)
    console.log(`  ${codigo.padEnd(24)} ${r.como} -> v2 · ${x.medicion?.porcentaje ?? '?'}% -> ${r.medicion.porcentaje}% · falta: ${r.medicion.faltan.join(', ') || 'nada'} · USA por capturar: ${r.reporte?.usaPorConfirmar || 0} · lo subio ${tp.subidoPorNombre}`)
    if (!EJECUTAR) { listos++; continue }

    // 1. Respaldo del original: local y en Firestore (solo la primera vez).
    if (!rehacer) writeFileSync(join(CARPETA, `${codigo}__${String(tp.nombre || 'original.xlsx').replace(/[\\/:*?"<>|]+/g, '-')}`), original)
    if (!x.techPackAnterior) {
      for (let i = 0; i < tp.totalChunks; i++) {
        await d.ref.collection('respaldoOriginal').doc(`tp-${pad2(i)}`).set({ codigo, tipo: 'tp', datos: original.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
      }
      const resp = await d.ref.collection('respaldoOriginal').get()
      const vuelta = Buffer.concat(Array.from({ length: tp.totalChunks }, (_, i) => { const v = resp.docs.find((c) => c.id === `tp-${pad2(i)}`)?.data().datos; return Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v) }))
      if (sha(vuelta) !== tp.sha256) throw new Error('el respaldo en Firestore no coincide con el original; no se reemplaza')
    }

    // 2. Pedazos nuevos con la huella en el id (no pisan los del vigente), verificados.
    for (let i = 0; i < total; i++) {
      await d.ref.collection('chunks').doc(idPedazo('tp', shaNuevo, i)).set({ codigo, tipo: 'tp', datos: nuevo.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
    }
    const manifiesto = { nombre: String(r.nombre).slice(0, 200), formato: 'xlsx', tamano: nuevo.length, totalChunks: total, sha256: shaNuevo, version: (tp.version || 1) + 1, subidoEn: FieldValue.serverTimestamp(), subidoPorUid: tp.subidoPorUid, subidoPorNombre: tp.subidoPorNombre }
    const subido = await bajar(d.ref, manifiesto)
    if (!subido || sha(subido) !== shaNuevo) throw new Error('lo subido no coincide con el convertido (sha256)')

    // 3. Manifiesto, identidad, calificacion y renglon de version, en un lote.
    const identidad = identidadDePlantilla(r.lectura)
    const lote = db.batch()
    lote.update(d.ref, {
      techPack: manifiesto,
      ...identidad,
      medicion: { ...r.medicion, hojas: r.hojas, medidoEn: new Date(), version: '2026-09-v2-plantilla' },
      aprobacion: null,
      ...(x.techPackAnterior ? {} : { techPackAnterior: { ...tp, respaldadoEn: FieldValue.serverTimestamp(), coleccion: 'respaldoOriginal' } }),
      actualizadoEn: FieldValue.serverTimestamp(),
      actualizadoPorUid: 'conversion-tp-quini-2026-09-17',
      actualizadoPorNombre: 'RAGNAR (paso el archivo al formato TP-Quini)'
    })
    lote.set(d.ref.collection('versiones').doc(`tp-${manifiesto.version}-${shaNuevo}`), {
      tipo: 'tp', version: manifiesto.version, nombre: manifiesto.nombre, tamano: manifiesto.tamano, sha256: shaNuevo,
      subidoEn: FieldValue.serverTimestamp(), subidoPorUid: tp.subidoPorUid,
      subidoPorNombre: `${tp.subidoPorNombre} (RAGNAR lo paso al formato TP-Quini)`.slice(0, 120)
    })
    await lote.commit()

    // 4. Fuera los pedazos del archivo viejo (ya respaldado).
    const existentes = new Set((await d.ref.collection('chunks').get()).docs.map((c) => c.id))
    for (const id of idsSobrantes(existentes, 'tp', manifiesto)) await d.ref.collection('chunks').doc(id).delete()
    listos++
  } catch (err) {
    console.log(`  ${codigo.padEnd(24)} ERROR ${(err?.message || String(err)).slice(0, 160)}`)
    fallidos++
  }
}
console.log(`\n${EJECUTAR ? 'convertidos' : 'listos para convertir'}: ${listos} | ya estaban en v2: ${yaEstaban} | aprobados en formato viejo (sin tocar): ${aprobadosViejos} | con error / sin tocar: ${fallidos}`)
if (!EJECUTAR) console.log('Ensayo. Para aplicarlo: EJECUTAR=1 node scripts/convertir_pendientes_al_formato.mjs "<carpeta>"')
process.exit(0)
