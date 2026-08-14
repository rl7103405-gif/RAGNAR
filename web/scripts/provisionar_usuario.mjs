/**
 * Crea (o confirma) la cuenta de la estacion de prueba en Firebase Auth +
 * su perfil en Firestore. Usa el Admin SDK (mismo patron que
 * captura-mecanicos/scripts/seed.mjs) porque firestore.rules NO permite que
 * ningun cliente escriba en usuarios/{uid} -- las altas son siempre por
 * este tipo de script, nunca por auto-registro.
 *
 * Requisitos:
 *   1) Descarga la clave privada de servicio desde:
 *      Firebase Console -> Configuracion del proyecto -> Cuentas de servicio
 *      -> Generar nueva clave privada. Guardala como serviceAccountKey.json
 *      en esta carpeta (web/), ya esta en .gitignore.
 *   2) Define la contrasena de la cuenta por variable de entorno (NO esta
 *      hardcodeada aqui a proposito, para no dejarla en el historial de
 *      git): ESTACION_PASSWORD=tu_contrasena npm run provisionar
 *      -- o crea un archivo .env local (con dotenv/dotenv-cli) que defina
 *      ESTACION_PASSWORD y lo cargue antes de correr el script.
 *   3) npm run provisionar
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const EMAIL = 'estacion@quini-ragnar.local'
const PASSWORD = process.env.ESTACION_PASSWORD
if (!PASSWORD) {
  throw new Error(
    'Falta la variable de entorno ESTACION_PASSWORD. Corre el script asi: ' +
      'ESTACION_PASSWORD=tu_contrasena npm run provisionar ' +
      '(o define ESTACION_PASSWORD en un .env local y cargalo con dotenv antes de ejecutar).'
  )
}
const NOMBRE_COMPLETO = 'Estacion de prueba'
const EMPLEADO_ID = 'estacion'

const serviceAccount = JSON.parse(
  readFileSync(new URL('../serviceAccountKey.json', import.meta.url))
)

initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

let usuario
try {
  usuario = await auth.getUserByEmail(EMAIL)
  await auth.updateUser(usuario.uid, { password: PASSWORD, disabled: false })
  console.log(`La cuenta ${EMAIL} ya existia (uid ${usuario.uid}); contrasena actualizada.`)
} catch (err) {
  if (err.code !== 'auth/user-not-found') throw err
  usuario = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true })
  console.log(`Cuenta creada: ${EMAIL} (uid ${usuario.uid})`)
}

await db.collection('usuarios').doc(usuario.uid).set({
  empleadoId: EMPLEADO_ID,
  nombreCompleto: NOMBRE_COMPLETO,
  activo: true
},
      // merge: NUNCA reemplazar el documento completo. Sin esto, volver a
      // correr este script (p.ej. para resetear una contrasena) borraba
      // 'rol' y 'puedeCrearTareas', y desde el 2026-08-12 un perfil sin rol
      // no tiene acceso a NADA: bloqueo total y silencioso.
      { merge: true }
    )
console.log('Perfil en Firestore listo.')
process.exit(0)
