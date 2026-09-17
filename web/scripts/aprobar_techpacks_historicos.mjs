/**
 * MARCA COMO APROBADOS los tech packs que YA ESTABAN en la biblioteca, para
 * que el flujo de aprobación no vacíe la pantalla el día que se enciende.
 *
 * Roberto, 2026-09-16: lo que sube el equipo de Lety queda PENDIENTE hasta que
 * ella lo aprueba. Sin esta migración, "sin sello = pendiente" dejaría
 * pendientes también los 133 que llevan semanas en uso — y al revés, tratar la
 * ausencia como "aprobado" dejaría pasar justo los que hay que revisar (lo
 * levantó Codex el 16-sep).
 *
 * EL CRITERIO, explícito:
 *   - lo subió alguien del EQUIPO de diseño (tiene supervisorDisenoUid)  -> PENDIENTE
 *   - cualquier otro (Lety, el admin, las cargas por script)             -> APROBADO
 *
 * El sello dice la verdad: lo aprobó la carga histórica, no Lety. No se
 * inventa un visto bueno de una persona que nunca lo dio.
 *
 * Uso (en web/):
 *   node scripts/aprobar_techpacks_historicos.mjs           <- ensayo
 *   EJECUTAR=1 node scripts/aprobar_techpacks_historicos.mjs
 *
 * Seguro de correr varias veces: no toca lo que ya tiene sello.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

const FIRMA_UID = 'aprobacion-historica'
const FIRMA_NOMBRE = 'Aprobado en la carga historica (16-sep-2026)'

// Quién es del equipo de diseño: lo suyo espera el visto bueno de su jefa.
const equipo = new Set(
  (await db.collection('usuarios').where('supervisorDisenoUid', '!=', null).get()).docs
    .filter((d) => d.data().supervisorDisenoUid)
    .map((d) => d.id)
)
console.log(`del equipo de diseno: ${equipo.size} persona(s)`)

const snap = await db.collection('techPacks').get()
let aprobados = 0, pendientes = 0, yaTenian = 0, sinArchivo = 0
const porRevisar = []
for (const d of snap.docs) {
  const x = d.data()
  if (x.apuntaA) continue
  if (!x.techPack?.sha256) { sinArchivo++; continue }
  if (x.aprobacion) { yaTenian++; continue }
  const subioAlguienDelEquipo = equipo.has(x.techPack.subidoPorUid)
  if (subioAlguienDelEquipo) {
    pendientes++
    porRevisar.push(`${d.id} (${x.techPack.subidoPorNombre || '?'}${x.cliente ? ' · ' + x.cliente : ''})`)
    continue
  }
  aprobados++
  if (EJECUTAR) {
    await db.runTransaction(async (tx) => {
      const vivo = await tx.get(d.ref)
      // Si alguien subió otra versión mientras corría esto, NO se aprueba a
      // ciegas: la aprobación es de una versión concreta.
      if (vivo.data()?.techPack?.sha256 !== x.techPack.sha256) {
        console.log(`  ${d.id}: cambió el archivo mientras tanto, se deja pendiente`)
        return
      }
      tx.update(d.ref, {
        aprobacion: {
          version: x.techPack.version || 1,
          sha256: x.techPack.sha256,
          porUid: FIRMA_UID,
          porNombre: FIRMA_NOMBRE,
          en: Timestamp.now()
        }
      })
    })
  }
}

console.log(`\n${aprobados} se marcan APROBADOS · ${pendientes} quedan PENDIENTES de Lety · ${yaTenian} ya tenían sello · ${sinArchivo} sin archivo`)
if (porRevisar.length) {
  console.log('\nLos que le van a aparecer a Lety en "Por aprobar":')
  porRevisar.forEach((t) => console.log('  - ' + t))
}
if (!EJECUTAR) console.log('\nEnsayo. Para aplicarlo:  EJECUTAR=1 node scripts/aprobar_techpacks_historicos.mjs')
