/**
 * REPARA los saldos de avios que se cargaron con el ID mal normalizado.
 *
 * El cargador inicial borraba los espacios del codigo ('SRFID 750...' ->
 * 'SRFID750...') mientras el catalogo los convierte en guion
 * ('SRFID-750...'). Resultado: 17 saldos quedaron como codigos "nuevos" sin
 * descripcion, cuando el material SI estaba en el catalogo.
 *
 * Reescribe cada movimiento y su saldo con el id correcto y borra el viejo,
 * todo en el mismo lote para que no exista un instante con los dos o con
 * ninguno.
 *
 *   node scripts/reparar_ids_avios.mjs            <- ensayo
 *   EJECUTAR=1 node scripts/reparar_ids_avios.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const ejecutar = process.env.EJECUTAR === '1'

const catalogo = new Map()
;(await db.collection('avios').get()).docs.forEach((d) =>
  catalogo.set(d.id, { unidad: d.data().unidad || 'piezas', descripcion: d.data().descripcion || '' })
)
const maquilas = (await db.collection('maquilas').get()).docs.filter((d) => !d.data().esPrueba)

console.log(ejecutar ? '*** MODO REAL ***\n' : '(ensayo: no escribe nada)\n')
let arreglados = 0

for (const m of maquilas) {
  const base = db.collection('portalMaquila').doc(m.id)
  const saldos = await base.collection('saldosAvios').get()
  for (const s of saldos.docs) {
    if (catalogo.has(s.id)) continue
    const correcto = s.id.replace(/^([A-Z]+)(\d)/, '$1-$2')
    if (!catalogo.has(correcto)) continue // de verdad no esta en el catalogo

    const dato = catalogo.get(correcto)
    const movViejo = `ini_${s.id}`
    const movNuevo = `ini_${correcto}`
    console.log(`  ${m.data().nombre.padEnd(16)} ${s.id} -> ${correcto}  (${dato.descripcion.slice(0, 30)})`)
    arreglados++
    if (!ejecutar) continue

    const mv = await base.collection('movimientosAvios').doc(movViejo).get()
    if (!mv.exists) {
      console.log('     ⚠ no existe su movimiento; se salta para no dejar un saldo huerfano')
      continue
    }
    const lote = db.batch()
    lote.set(base.collection('movimientosAvios').doc(movNuevo), {
      ...mv.data(),
      codigo: correcto,
      descripcion: dato.descripcion,
      unidad: dato.unidad
    })
    lote.delete(base.collection('movimientosAvios').doc(movViejo))
    lote.set(base.collection('saldosAvios').doc(correcto), {
      ...s.data(),
      codigo: correcto,
      unidad: dato.unidad,
      ultimoMovimientoId: movNuevo
    })
    lote.delete(base.collection('saldosAvios').doc(s.id))
    await lote.commit()
  }
}

console.log(`\n${arreglados} saldos ${ejecutar ? 'reparados' : 'por reparar'}.`)
if (!ejecutar) console.log('Para hacerlo: EJECUTAR=1 node scripts/reparar_ids_avios.mjs')
process.exit(0)
