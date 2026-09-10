/**
 * Cuenta de acceso que FALTABA: Eduardo Rodriguez.
 *
 * 2026-09-10: al auditar quien habia entrado al portal salio que
 * eduardo_rodriguez esta en el catalogo de maquilas, ACTIVA y con envios,
 * pero sin cuenta de usuario: no es que no entrara, es que no podia.
 *
 * Hace lo mismo que crear_usuarios_maquila.mjs (misma forma de perfil y los
 * mismos guardias) y ademas anota la contrasena en RAGNAR-CUENTAS.xlsx,
 * hoja "Maquilas", que es donde Roberto las busca.
 *
 * Uso (en web/):   node scripts/crear_cuenta_eduardo.mjs          <- ensayo
 *                  EJECUTAR=1 node scripts/crear_cuenta_eduardo.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { DOMINIO, QUE_VE, abrirLibro, generarPassword, guardarLibro, ponerEnExcel } from './lib/excelCuentas.mjs'

const MAQUILA_ID = 'eduardo_rodriguez'
const USUARIO = 'eduardo_rodriguez'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const auth = getAuth()
const db = getFirestore()
const ejecutar = process.env.EJECUTAR === '1'
console.log(ejecutar ? 'APLICANDO' : 'ENSAYO')

const snap = await db.collection('maquilas').doc(MAQUILA_ID).get()
if (!snap.exists) { console.error(`No existe la maquila ${MAQUILA_ID} en el catalogo.`); process.exit(1) }
const maquila = snap.data()
if (maquila.activo !== true) { console.error(`La maquila ${maquila.nombre} esta INACTIVA: su portal esta cerrado.`); process.exit(1) }
console.log(`  maquila: ${maquila.nombre} (${MAQUILA_ID}), activa`)

// Ya tiene cuenta? (no crear una segunda por error)
const yaTiene = await db.collection('usuarios').where('maquilaId', '==', MAQUILA_ID).get()
if (!yaTiene.empty) {
  console.error(`  Ya tiene cuenta: ${yaTiene.docs.map((d) => d.data().empleadoId || d.id).join(', ')}. No se toca nada.`)
  process.exit(1)
}

// GUARDIA: el correo no puede ser de alguien de Quini (aqui las maquilas se
// llaman como personas). Si ya existe y no es de esta maquila, se aborta.
const email = `${USUARIO}@${DOMINIO}`
let cuenta = null
try { cuenta = await auth.getUserByEmail(email) } catch (e) { if (e.code !== 'auth/user-not-found') throw e }
if (cuenta) {
  const p = await db.collection('usuarios').doc(cuenta.uid).get()
  const d = p.exists ? p.data() : {}
  if (d.rol !== 'maquila' || (d.maquilaId && d.maquilaId !== MAQUILA_ID)) {
    console.error(`  El usuario ${USUARIO} YA EXISTE y NO es de esta maquila (rol=${d.rol || '-'}, maquilaId=${d.maquilaId || '-'}). No se toco nada.`)
    process.exit(1)
  }
}

console.log(`  se crea el usuario "${USUARIO}" (${email}) con rol maquila`)
if (!ejecutar) {
  console.log('\nPara aplicarlo:  EJECUTAR=1 node scripts/crear_cuenta_eduardo.mjs')
  process.exit(0)
}

const password = generarPassword()
const nueva = await auth.createUser({ email, password, emailVerified: true })
await db.collection('usuarios').doc(nueva.uid).set({
  empleadoId: USUARIO,
  nombreCompleto: maquila.nombre,
  rol: 'maquila',
  maquilaId: MAQUILA_ID,
  activo: true,
  esPrueba: false,
  creadoEn: new Date()
})
console.log(`  perfil creado (uid ${nueva.uid})`)

const libro = await abrirLibro()
ponerEnExcel(libro, USUARIO, {
  Maquila: maquila.nombre,
  Contrasena: password,
  'ID interno': MAQUILA_ID,
  Estado: 'activo',
  'Que ve': QUE_VE.maquila
}, 'Maquilas')
await guardarLibro(libro)
console.log('  contrasena anotada en RAGNAR-CUENTAS.xlsx (hoja Maquilas)')
