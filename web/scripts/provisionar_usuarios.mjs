/**
 * Alta (o actualizacion) de usuarios individuales de la estacion, con el
 * Admin SDK (firestore.rules no permite escribir usuarios/{uid} desde
 * cliente; las altas son siempre por script, nunca auto-registro).
 *
 * Los usuarios entran a la app con su nombre simple (america, diana...);
 * internamente Firebase Auth usa <usuario>@quini-ragnar.local (misma
 * convencion que web/src/constants/estacion.js).
 *
 * Uso (las contrasenas van por variable de entorno, NUNCA en el codigo ni en
 * argumentos de linea de comandos que quedan en el historial de la terminal):
 *
 *   USUARIOS_JSON='[{"usuario":"america","nombre":"America","password":"..."}]' \
 *     node scripts/provisionar_usuarios.mjs
 *
 * Cada entrada: { usuario, nombre, password }. Si la cuenta ya existe se
 * actualiza su contrasena y se reactiva; el perfil usuarios/{uid} se
 * (re)escribe con activo: true.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const DOMINIO_INTERNO = 'quini-ragnar.local'

// Preferible USUARIOS_JSON_FILE (ruta a un archivo temporal FUERA del repo,
// que se borra al terminar): un JSON inline en la linea de comandos puede
// quedar grabado con las contrasenas en el historial de la terminal.
let crudo = process.env.USUARIOS_JSON
if (process.env.USUARIOS_JSON_FILE) {
  crudo = readFileSync(process.env.USUARIOS_JSON_FILE, 'utf8')
}
if (!crudo) {
  throw new Error(
    'Falta USUARIOS_JSON_FILE (ruta a un archivo temporal, recomendado) o ' +
      'USUARIOS_JSON con la lista: [{"usuario":"america","nombre":"America","password":"..."}]'
  )
}
let usuarios
try {
  usuarios = JSON.parse(crudo)
} catch (err) {
  throw new Error('USUARIOS_JSON no es JSON valido: ' + err.message)
}
if (!Array.isArray(usuarios) || usuarios.length === 0) {
  throw new Error('USUARIOS_JSON debe ser un arreglo con al menos un usuario.')
}
for (const u of usuarios) {
  if (!u.usuario || !/^[a-z0-9._-]+$/.test(u.usuario)) {
    throw new Error(`Usuario invalido: "${u.usuario}" (solo minusculas, numeros, punto, guion).`)
  }
  if (!u.nombre) throw new Error(`Falta el nombre completo de "${u.usuario}".`)
  if (!u.password || u.password.length < 6) {
    throw new Error(`La contrasena de "${u.usuario}" debe tener al menos 6 caracteres.`)
  }
}

const serviceAccount = JSON.parse(
  readFileSync(new URL('../serviceAccountKey.json', import.meta.url))
)
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

for (const u of usuarios) {
  const email = `${u.usuario}@${DOMINIO_INTERNO}`
  let cuenta
  try {
    cuenta = await auth.getUserByEmail(email)
    await auth.updateUser(cuenta.uid, { password: u.password, disabled: false })
    console.log(`Cuenta ${u.usuario} ya existia (uid ${cuenta.uid}); contrasena actualizada.`)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    cuenta = await auth.createUser({ email, password: u.password, emailVerified: true })
    console.log(`Cuenta creada: ${u.usuario} (uid ${cuenta.uid})`)
  }
  await db.collection('usuarios').doc(cuenta.uid).set({
    empleadoId: u.usuario,
    nombreCompleto: u.nombre,
    activo: true
  },
      // merge: NUNCA reemplazar el documento completo. Sin esto, volver a
      // correr este script (p.ej. para resetear una contrasena) borraba
      // 'rol' y 'puedeCrearTareas', y desde el 2026-08-12 un perfil sin rol
      // no tiene acceso a NADA: bloqueo total y silencioso.
      { merge: true }
    )
  console.log(`Perfil de ${u.nombre} listo.`)
}
console.log('Listo: ' + usuarios.length + ' usuarios provisionados.')
process.exit(0)
