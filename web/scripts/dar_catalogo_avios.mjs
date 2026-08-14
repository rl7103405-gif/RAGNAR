/**
 * Le da (o le quita) a un usuario interno el flag administraCatalogoAvios:
 * quien lo tiene puede dar de alta y de baja claves en el catalogo de avios.
 * Decision de Roberto (2026-08-13): lo administra CIELO; Alvaro solo consulta.
 *
 * Uso (en web/):
 *   node scripts/dar_catalogo_avios.mjs cielo            <- ensayo
 *   EJECUTAR=1 node scripts/dar_catalogo_avios.mjs cielo
 *   EJECUTAR=1 QUITAR=1 node scripts/dar_catalogo_avios.mjs cielo
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const usuario = String(process.argv[2] || '').trim()
if (!usuario) {
  console.error('Falta el usuario.  Ejemplo: node scripts/dar_catalogo_avios.mjs cielo')
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'
const quitar = process.env.QUITAR === '1'

const snap = await db.collection('usuarios').where('empleadoId', '==', usuario).limit(1).get()
if (snap.empty) {
  console.error(`No existe ningun perfil con usuario "${usuario}".`)
  process.exit(1)
}
const ref = snap.docs[0].ref
const p = snap.docs[0].data()

if (p.rol === 'maquila' || p.maquilaId) {
  console.error(`"${usuario}" es una cuenta de maquila: el catalogo es interno, no se le da.`)
  process.exit(1)
}

console.log(`\nUsuario:  ${usuario}`)
console.log(`Quien es: ${p.nombreCompleto || '(sin nombre)'}  (rol ${p.rol})`)
console.log(`Flag hoy: administraCatalogoAvios = ${p.administraCatalogoAvios === true}`)
console.log(`Cambio:   -> ${!quitar}`)

if (!ejecutar) {
  console.log('\n== ENSAYO: no se cambio nada ==')
  console.log(`Para aplicarlo:  EJECUTAR=1 node scripts/dar_catalogo_avios.mjs ${usuario}`)
  process.exit(0)
}

// merge implicito de update(): SOLO toca el flag. Un set() sin merge aqui
// borraria el rol y dejaria a la persona sin acceso (ya paso una vez).
await ref.update({ administraCatalogoAvios: !quitar })
console.log(`\nListo: ${usuario} ${quitar ? 'ya NO' : 'ya'} administra el catalogo de avios.`)
console.log('El cambio se ve cuando esa persona recargue la app (el perfil se lee al entrar).')
process.exit(0)
