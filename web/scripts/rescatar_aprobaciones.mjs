/**
 * RESCATA AL HISTORIAL LAS APROBACIONES QUE YA EXISTEN.
 *
 * Desde el 18-sep cada aprobar/retirar deja un evento en
 * techPacks/{codigo}/aprobaciones. Las aprobaciones de ANTES viven solo en el
 * campo 'aprobacion' del documento: al primer reemplazo de archivo se pondrian
 * en null y no quedaria rastro de que alguna vez se aprobaron (Codex, 18-sep:
 * "rescata primero las aprobaciones actuales").
 *
 * Por cada tech pack con 'aprobacion' y SIN 'ultimoEventoAprobacionId': crea un
 * evento { accion: 'aprobar', version, sha256, porUid, porNombre, en } con los
 * datos TAL CUAL del sello (misma persona, misma fecha), marcado 'rescatado',
 * y apunta el documento a el. No cambia el visto bueno de nadie.
 *
 * Uso (en web/):  node scripts/rescatar_aprobaciones.mjs          <- ensayo
 *                 EJECUTAR=1 node scripts/rescatar_aprobaciones.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

const snap = await db.collection('techPacks').get()
let rescatados = 0, yaTenian = 0
const porQuien = {}
for (const d of snap.docs) {
  const x = d.data()
  if (!x.aprobacion) continue
  if (x.ultimoEventoAprobacionId) { yaTenian++; continue }
  const a = x.aprobacion
  porQuien[a.porNombre] = (porQuien[a.porNombre] || 0) + 1
  rescatados++
  if (!EJECUTAR) continue
  const ref = d.ref.collection('aprobaciones').doc()
  const lote = db.batch()
  lote.set(ref, {
    accion: 'aprobar', version: a.version, sha256: a.sha256, porUid: a.porUid, porNombre: a.porNombre, en: a.en,
    rescatado: true, rescatadoEn: FieldValue.serverTimestamp()
  })
  // Solo el puntero: el sello, los datos y las marcas de quien edito no se tocan.
  // Precondicion: si Lety aprobo o retiro mientras corria, no se pisa su puntero.
  lote.update(d.ref, { ultimoEventoAprobacionId: ref.id }, { lastUpdateTime: d.updateTime })
  await lote.commit()
}
console.log(`aprobaciones rescatadas al historial: ${rescatados} | ya tenian su evento: ${yaTenian}`)
console.log('por quien:', JSON.stringify(porQuien))
if (!EJECUTAR) console.log('Ensayo. Para aplicarlo: EJECUTAR=1 node scripts/rescatar_aprobaciones.mjs')
process.exit(0)
