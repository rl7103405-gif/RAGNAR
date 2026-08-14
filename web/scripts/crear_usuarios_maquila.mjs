/**
 * Crea una cuenta de acceso para una MAQUILA (usuario EXTERNO).
 *
 * La maquila entra a la misma app pero solo ve SU portal
 * (portalMaquila/{maquilaId}/...): no tiene permiso de leer bultos, ruteo,
 * catalogo, ni las remisiones de otras maquilas. El aislamiento lo garantizan
 * las reglas de Firestore, no la pantalla.
 *
 * El perfil que se crea lleva:
 *   rol: 'maquila'      -> queda FUERA de esInterno(): no ve nada interno
 *   maquilaId: '<id>'   -> a que maquila del catalogo pertenece
 *
 * Uso (en web/, PowerShell):
 *   $env:MAQUILA_ID = "munguia"          # el ID del doc en la coleccion maquilas
 *   $env:MAQUILA_USUARIO = "munguia"     # con que nombre entra
 *   $env:MAQUILA_PASSWORD = Read-Host "Contrasena"
 *   node scripts/crear_usuarios_maquila.mjs
 *
 * Para LISTAR las maquilas disponibles y sus IDs, correrlo sin variables.
 * Requiere serviceAccountKey.json en web/.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const DOMINIO = 'quini-ragnar.local'

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const maquilaId = (process.env.MAQUILA_ID || '').trim()
const usuario = (process.env.MAQUILA_USUARIO || maquilaId).trim()
const password = process.env.MAQUILA_PASSWORD

// Sin datos: solo listar las maquilas y quien ya tiene cuenta.
if (!maquilaId) {
  const [maquilas, usuarios] = await Promise.all([
    db.collection('maquilas').orderBy('nombre').get(),
    db.collection('usuarios').where('rol', '==', 'maquila').get()
  ])
  const conCuenta = new Map()
  usuarios.docs.forEach((d) => {
    const u = d.data()
    if (u.maquilaId) conCuenta.set(u.maquilaId, u.empleadoId || d.id)
  })
  console.log('MAQUILAS DEL CATALOGO:\n')
  console.log('  ID'.padEnd(28), 'NOMBRE'.padEnd(34), 'ACTIVA  CUENTA')
  maquilas.docs.forEach((d) => {
    const m = d.data()
    console.log(
      '  ' + d.id.padEnd(26),
      String(m.nombre).padEnd(34),
      String(m.activo).padEnd(7),
      conCuenta.get(d.id) || '(sin cuenta)'
    )
  })
  console.log('\nPara crear una cuenta:')
  console.log('  $env:MAQUILA_ID = "<el ID de arriba>"')
  console.log('  $env:MAQUILA_PASSWORD = Read-Host "Contrasena"')
  console.log('  node scripts/crear_usuarios_maquila.mjs')
  process.exit(0)
}

// --- Validaciones antes de crear nada ---
const snapMaquila = await db.collection('maquilas').doc(maquilaId).get()
if (!snapMaquila.exists) {
  console.error(`ERROR: no existe la maquila "${maquilaId}" en el catalogo.`)
  console.error('Corre el script sin variables para ver los IDs disponibles.')
  process.exit(1)
}
const maquila = snapMaquila.data()
if (maquila.activo !== true) {
  console.error(`ERROR: la maquila "${maquila.nombre}" esta INACTIVA. Reactivala primero:`)
  console.error('su portal queda cerrado mientras activo sea false.')
  process.exit(1)
}
if (!password) {
  console.error('ERROR: falta la contrasena. En PowerShell:')
  console.error('  $env:MAQUILA_PASSWORD = Read-Host "Contrasena"')
  process.exit(1)
}
if (String(password).length < 8) {
  console.error('ERROR: la contrasena debe tener al menos 8 caracteres.')
  process.exit(1)
}

const email = `${usuario}@${DOMINIO}`

// Si ya hay una cuenta para ESTA maquila, avisar en vez de crear otra.
const yaExiste = await db.collection('usuarios').where('maquilaId', '==', maquilaId).get()
if (!yaExiste.empty) {
  const otros = yaExiste.docs
    .map((d) => d.data().empleadoId || d.id)
    .filter((x) => x !== usuario)
  if (otros.length > 0) {
    console.warn(`AVISO: la maquila "${maquila.nombre}" ya tiene cuenta(s): ${otros.join(', ')}.`)
    console.warn('Se va a continuar (puede haber mas de un usuario por maquila).')
  }
}

// GUARDIA CRITICO: aqui las maquilas se llaman como personas (Hugo Martinez,
// Munguia), asi que el usuario elegido puede colisionar con un empleado
// interno. Si ese correo ya pertenece a alguien de Quini, este script le
// resetearia la contrasena y le pondria maquilaId: la credencial de un interno
// terminaria en manos de una empresa externa. Se aborta antes de tocar nada.
let cuentaExistente = null
try {
  cuentaExistente = await auth.getUserByEmail(email)
} catch (err) {
  if (err.code !== 'auth/user-not-found') throw err
}
if (cuentaExistente) {
  const perfilPrevio = await db.collection('usuarios').doc(cuentaExistente.uid).get()
  if (perfilPrevio.exists) {
    const p = perfilPrevio.data()
    if (p.rol !== 'maquila' || (p.maquilaId && p.maquilaId !== maquilaId)) {
      console.error(`ERROR: el usuario "${usuario}" (${email}) YA EXISTE y no es de esta maquila.`)
      console.error(`  Su perfil dice: rol="${p.rol || '(sin rol)'}", maquilaId="${p.maquilaId || '(ninguno)'}", nombre="${p.nombreCompleto || ''}".`)
      console.error('  NO se toco nada. Si es una persona de Quini, elige otro nombre de usuario:')
      console.error(`     $env:MAQUILA_USUARIO = "${maquilaId}"`)
      process.exit(1)
    }
  }
}

let cuenta
try {
  cuenta = await auth.getUserByEmail(email)
  await auth.updateUser(cuenta.uid, { password, disabled: false })
  console.log(`${email} ya existia; contrasena actualizada.`)
} catch (err) {
  if (err.code !== 'auth/user-not-found') throw err
  cuenta = await auth.createUser({ email, password, emailVerified: true })
  console.log(`Cuenta creada: ${email}`)
}

// merge: NUNCA reemplazar el documento (borraria rol/maquilaId si el script
// se vuelve a correr para cambiar la contrasena).
await db.collection('usuarios').doc(cuenta.uid).set(
  {
    empleadoId: usuario,
    nombreCompleto: maquila.nombre,
    activo: true,
    rol: 'maquila',
    maquilaId
  },
  { merge: true }
)

console.log(`  perfil listo: ${maquila.nombre} (rol maquila, maquilaId ${maquilaId})`)
console.log(`\nEntra en https://quini-ragnar.web.app con el usuario "${usuario}".`)
console.log('Solo va a ver SU portal: las remisiones que se le manden y el boton de confirmar.')
process.exit(0)
