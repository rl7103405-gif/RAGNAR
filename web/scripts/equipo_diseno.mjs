/**
 * El equipo de DISENO, con jerarquia explicita en los perfiles.
 *
 * Roberto (9-sep): "tener a Lety bajo lupa... ella tambien pueda dar tareas".
 * Hoy Lety, Monica y Maria Fernanda tienen el MISMO rol 'desarrollo' y nada las
 * distingue: cualquiera podria asignarse trabajo sola. Aqui se marca:
 *   - Lety:            puedeAsignarDiseno: true   (ella reparte)
 *   - Monica, MaFer:   supervisorDisenoUid: <uid de Lety>   (a quien reportan)
 * Las reglas de Firestore leen estos flags: son candado, no disciplina.
 *
 * Uso (en web/):   node scripts/equipo_diseno.mjs          <- ensayo
 *                  EJECUTAR=1 node scripts/equipo_diseno.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const LETY = 'Ut5Nq7foCvQPAyvf2NvCDFiSK4n1'
const EQUIPO = {
  '81Ef2iqds6ekaS4nrdG1Pc5w0qF2': 'Mónica Ramírez',
  'wKU8UxcE8jUuaqlHQdyULhhGOkw1': 'María Fernanda'
}

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const ejecutar = process.env.EJECUTAR === '1'

const jefa = await db.collection('usuarios').doc(LETY).get()
if (!jefa.exists || jefa.data().rol !== 'desarrollo') { console.error('Lety no es rol desarrollo, me detengo.'); process.exit(1) }
console.log(`${ejecutar ? 'APLICANDO' : 'ENSAYO'}:`)
console.log(`  ${jefa.data().nombreCompleto}  ->  puedeAsignarDiseno: true`)
if (ejecutar) await jefa.ref.update({ puedeAsignarDiseno: true, actualizadoEn: FieldValue.serverTimestamp() })
for (const [uid, nombre] of Object.entries(EQUIPO)) {
  const p = await db.collection('usuarios').doc(uid).get()
  if (!p.exists || p.data().rol !== 'desarrollo') { console.error(`  ${nombre}: no existe o no es desarrollo, se salta`); continue }
  console.log(`  ${p.data().nombreCompleto}  ->  supervisorDisenoUid: ${LETY} (Lety)`)
  if (ejecutar) await p.ref.update({ supervisorDisenoUid: LETY, actualizadoEn: FieldValue.serverTimestamp() })
}
if (!ejecutar) console.log('\nPara aplicarlo:  EJECUTAR=1 node scripts/equipo_diseno.mjs')
