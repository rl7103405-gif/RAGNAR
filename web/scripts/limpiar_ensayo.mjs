/**
 * Deja el mundo del ENSAYO como estaba, para poder repetirlo desde cero.
 *
 * Borra SOLO lo que empieza con `ZZTEST` (folios de ruteo y bultos) y las
 * capturas de prueba que cuelgan de ellos. No toca nada real: el prefijo
 * ZZTEST es justamente el corral que las reglas le imponen a las cuentas de
 * prueba (`folioDePrueba()`, firestore.rules:143), asi que por construccion
 * ningun folio de la planta empieza asi.
 *
 * NO borra las tareas de `demo_maquila` ni sus precios: esos se reusan entre
 * ensayos. Para quitar una tarea, se cancela desde la app.
 *
 * Uso (dry-run por defecto):
 *   node scripts/limpiar_ensayo.mjs
 *   EJECUTAR=1 node scripts/limpiar_ensayo.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const EJECUTAR = process.env.EJECUTAR === '1'
initializeApp({ credential: cert(JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'))) })
const db = getFirestore()

/** Los documentos cuyo ID empieza con ZZTEST, por rango sobre el nombre. */
const deLaPrueba = (col) =>
  db.collection(col).where('__name__', '>=', 'ZZTEST').where('__name__', '<', 'ZZTESU').get()

async function main() {
  console.log(EJECUTAR ? '=== MODO REAL: se va a borrar ===\n' : '=== SIMULACION (nada se borra) ===\n')

  let total = 0
  for (const col of ['foliosRuteo', 'bultos']) {
    const snap = await deLaPrueba(col)
    console.log(`${col}: ${snap.size}`)
    snap.docs.slice(0, 15).forEach((d) => console.log(`   ${d.id}`))
    if (snap.size > 15) console.log(`   ... y ${snap.size - 15} mas`)
    if (EJECUTAR) {
      for (const d of snap.docs) await d.ref.delete()
    }
    total += snap.size
  }

  if (!EJECUTAR) {
    console.log(`\n${total} documentos se borrarian. Para aplicar:`)
    console.log('   EJECUTAR=1 node scripts/limpiar_ensayo.mjs')
    return
  }
  console.log(`\nborrados: ${total}. El ensayo se puede repetir desde cero.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
