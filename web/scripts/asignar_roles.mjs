/**
 * Asigna el campo `rol` a los perfiles de usuarios/{uid} y crea/actualiza la
 * cuenta de Roberto (rol admin, el unico que autoriza correcciones de folios
 * ya enviados a PDF).
 *
 * Roles:
 *   captura  -> solo la pestana Captura (pesadores)
 *   completo -> todo menos autorizar correcciones
 *   admin    -> todo + autoriza correcciones
 *
 * Requiere serviceAccountKey.json en web/ (ver provisionar_usuario.mjs).
 * La contrasena de una cuenta nueva se pasa por variable de entorno para no
 * dejarla en el repo:
 *   ROBERTO_PASSWORD=... node scripts/asignar_roles.mjs
 * Si la cuenta ya existe y no se pasa la variable, solo se actualiza su rol.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const DOMINIO = 'quini-ragnar.local'

// empleadoId -> rol. Los que no aparezcan aqui conservan lo que tengan.
const ROLES = {
  roberto: 'admin',
  angel: 'captura',
  juan: 'captura',
  america: 'completo',
  lindbergh: 'completo',
  diana: 'completo',
  estacion: 'completo',
  // Cielo pasa las remisiones a Microsip: ve todo, no opera nada.
  cielo: 'consulta',
  // Alvaro maneja los avios (plastiflechas, etiquetas, cajas, cinta) que las
  // maquilas necesitan para ensamblar.
  alvaro: 'almacen'
}

// Quien puede CREAR/asignar tareas (ademas del admin, que siempre puede).
// Lindbergh encarga las tareas; America solo las recibe.
const PUEDE_CREAR_TAREAS = {
  lindbergh: true,
  america: false,
  diana: false,
  estacion: false
}

// Cuentas que deben existir (se crean si no estan).
const CUENTAS_NUEVAS = [
  { usuario: 'roberto', nombreCompleto: 'Roberto Linares', password: process.env.ROBERTO_PASSWORD },
  { usuario: 'cielo', nombreCompleto: 'Cielo', password: process.env.CIELO_PASSWORD },
  { usuario: 'alvaro', nombreCompleto: 'Alvaro', password: process.env.ALVARO_PASSWORD }
]

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

// 1) Crear las cuentas que falten
for (const cuenta of CUENTAS_NUEVAS) {
  const email = `${cuenta.usuario}@${DOMINIO}`
  // Si no se paso su contrasena Y la cuenta no existe, se salta: asi el script
  // sirve para actualizar roles sin obligar a dar de alta a todo el mundo.
  if (!cuenta.password) {
    try {
      await auth.getUserByEmail(email)
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log(`(saltado) ${email}: no existe y no se paso ${cuenta.usuario.toUpperCase()}_PASSWORD`)
        continue
      }
      throw err
    }
  }
  let usuario
  try {
    usuario = await auth.getUserByEmail(email)
    if (cuenta.password) {
      await auth.updateUser(usuario.uid, { password: cuenta.password, disabled: false })
      console.log(`${email} ya existia; contrasena actualizada.`)
    } else {
      console.log(`${email} ya existia; contrasena sin cambios.`)
    }
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    if (!cuenta.password) {
      throw new Error(
        `Falta la contrasena para crear ${email}. Corre el script con ` +
          `${cuenta.usuario.toUpperCase()}_PASSWORD=... node scripts/asignar_roles.mjs`
      )
    }
    usuario = await auth.createUser({ email, password: cuenta.password, emailVerified: true })
    console.log(`Cuenta creada: ${email} (uid ${usuario.uid})`)
  }
  await db.collection('usuarios').doc(usuario.uid).set(
    {
      empleadoId: cuenta.usuario,
      nombreCompleto: cuenta.nombreCompleto,
      activo: true,
      rol: ROLES[cuenta.usuario] || 'completo',
      ...(PUEDE_CREAR_TAREAS[cuenta.usuario] !== undefined
        ? { puedeCrearTareas: PUEDE_CREAR_TAREAS[cuenta.usuario] }
        : {})
    },
    { merge: true }
  )
  console.log(`  perfil listo: ${cuenta.nombreCompleto} (rol ${ROLES[cuenta.usuario]})`)
}

// 2) Asignar rol a todos los perfiles existentes
const snap = await db.collection('usuarios').get()
for (const doc of snap.docs) {
  const datos = doc.data()
  // Un perfil de MAQUILA (externo) no se toca nunca desde aqui: si su
  // empleadoId coincidiera con alguien del mapa ROLES, este script le daria
  // un rol interno y quedaria una cuenta hibrida con acceso a la operacion.
  if (datos.rol === 'maquila' || datos.maquilaId) {
    console.log(`  (SALTADO, es maquila) ${datos.empleadoId || doc.id}`)
    continue
  }
  const rol = ROLES[datos.empleadoId]
  const flagTareas = PUEDE_CREAR_TAREAS[datos.empleadoId]
  const cambios = {}
  if (rol && datos.rol !== rol) cambios.rol = rol
  if (flagTareas !== undefined && datos.puedeCrearTareas !== flagTareas) {
    cambios.puedeCrearTareas = flagTareas
  }
  if (Object.keys(cambios).length === 0) {
    console.log(`  (sin cambio) ${datos.empleadoId || doc.id}`)
    continue
  }
  await doc.ref.set(cambios, { merge: true })
  console.log(`  actualizado ${datos.empleadoId}: ${JSON.stringify(cambios)}`)
}

console.log('Listo.')
process.exit(0)
