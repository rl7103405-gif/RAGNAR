/**
 * Pega un tech pack de la BIBLIOTECA a una TAREA DE ENSAMBLE ya encargada.
 *
 * 2026-09-10: Lindbergh encargo cuatro tareas a Hugo y ninguna quedo con tech
 * pack, porque al subirlo "se cortaba la subida" (la regla se pasaba del tope
 * de 1,000 expresiones; ya se arreglo). Los tres tech packs que hacen falta YA
 * estan en la biblioteca, cargados desde el Drive, asi que no hay que volver a
 * subir nada: se copian de la biblioteca a la tarea.
 *
 * Hace EXACTAMENTE lo que hace la app (web/src/utils/tareasEnsamble.js:503):
 * baja los pedazos de la biblioteca, verifica la huella sha256, los reescribe
 * como techPackChunks de la tarea y publica el manifiesto. Corre con Admin SDK,
 * asi que no pasa por las reglas: por eso valida la huella el mismo.
 *
 * Uso (en web/):
 *   node scripts/pegar_techpacks_a_tareas.mjs                 <- ensayo
 *   EJECUTAR=1 node scripts/pegar_techpacks_a_tareas.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const sa = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(sa) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
const CHUNK_BYTES = 950000
const MAX_CHUNKS = 17

// Que tech pack va con que orden de trabajo. Sale del Drive: los codigos del
// plan (7928-J...) aparecen en las FICHAS que viven junto a cada tech pack, y
// esa carpeta es la que da el codigo real.
//   OT 7942 -> 7928-J, 7929-J, 7930-J  ->  02 FICHAS TECNICAS/OPTIMA/CIG90-406-P1178
//   OT 7943 -> 7931-J, 7932-J, 7933-J  ->  02 FICHAS TECNICAS/OPTIMA/CIG90-810-P1178
//   OT 7944 -> 6837-K, 6838-K, 6839-K  ->  02 FICHAS TECNICAS/OPTIMA/CAC64-UN
//   OT 7945 -> 1490-I, 1491-I, 1492-I  ->  su tech pack (CPD32-UN-01711) NO bajo del
//                                          Drive: pesa 6.6 MB y el conector corta ahi.
const PLAN = [
  { maquila: 'hugo_martinez', ot: '7942', codigo: 'CIG90-406-P1178' },
  { maquila: 'hugo_martinez', ot: '7943', codigo: 'CIG90-810-P1178' },
  { maquila: 'hugo_martinez', ot: '7944', codigo: 'CAC64-UN-04502' }
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const pad2 = (n) => String(n).padStart(2, '0')

async function bajarDeLaBiblioteca(codigo) {
  const doc = await db.collection('techPacks').doc(codigo).get()
  if (!doc.exists) throw new Error(`${codigo} no esta en la biblioteca`)
  const m = doc.data().techPack
  if (!m?.totalChunks) throw new Error(`${codigo} no tiene archivo`)
  const chunks = await doc.ref.collection('chunks').get()
  const porId = new Map(chunks.docs.map((d) => [d.id, d.data()]))
  const pedazos = []
  for (let i = 0; i < m.totalChunks; i++) {
    const c = porId.get('tp-' + pad2(i))
    if (!c?.datos) throw new Error(`${codigo}: falta el pedazo ${i + 1} de ${m.totalChunks}`)
    pedazos.push(Buffer.isBuffer(c.datos) ? c.datos : Buffer.from(c.datos.toUint8Array ? c.datos.toUint8Array() : c.datos))
  }
  const unido = Buffer.concat(pedazos)
  if (unido.length !== m.tamano) throw new Error(`${codigo}: el tamano no cuadra`)
  if (sha256(unido) !== m.sha256) throw new Error(`${codigo}: la huella no cuadra (archivo corrupto)`)
  return { contenido: unido, manifiesto: m }
}

console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO')
for (const item of PLAN) {
  const tareas = await db
    .collection('portalMaquila').doc(item.maquila)
    .collection('tareasEnsamble').where('ot', '==', item.ot).get()
  if (tareas.empty) { console.log(`  OT ${item.ot}: no hay tarea`); continue }
  const tarea = tareas.docs[0]
  if (tarea.data().techPack) { console.log(`  OT ${item.ot}: ya tiene tech pack, se deja`); continue }

  let bajado
  try { bajado = await bajarDeLaBiblioteca(item.codigo) } catch (e) { console.log(`  OT ${item.ot}: ${e.message}`); continue }
  const { contenido, manifiesto } = bajado
  const totalChunks = Math.ceil(contenido.length / CHUNK_BYTES)
  if (totalChunks > MAX_CHUNKS) { console.log(`  OT ${item.ot}: el archivo rebasa los 15 MB`); continue }
  console.log(`  OT ${item.ot} <- ${item.codigo} (${(contenido.length / 1048576).toFixed(1)} MB, ${totalChunks} pedazo(s))`)
  if (!EJECUTAR) continue

  const chunks = tarea.ref.collection('techPackChunks')
  for (let i = 0; i < totalChunks; i++) {
    await chunks.doc(pad2(i)).set({
      maquilaId: item.maquila,
      datos: Buffer.from(contenido.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES))
    })
  }
  const viejos = await chunks.get()
  for (const d of viejos.docs) if (Number(d.id) >= totalChunks) await d.ref.delete()

  const yaPublicada = tarea.data().publicadaEn != null
  await tarea.ref.update({
    estado: 'abierta',
    ...(yaPublicada ? {} : { publicadaEn: FieldValue.serverTimestamp() }),
    techPack: {
      nombre: manifiesto.nombre,
      formato: manifiesto.formato,
      tamano: contenido.length,
      totalChunks,
      sha256: sha256(contenido),
      subidoEn: FieldValue.serverTimestamp()
    }
  })
  console.log(`     pegado`)
}
if (!EJECUTAR) console.log('\nPara aplicarlo:  EJECUTAR=1 node scripts/pegar_techpacks_a_tareas.mjs')
