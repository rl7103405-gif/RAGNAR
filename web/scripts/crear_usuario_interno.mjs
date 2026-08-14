/**
 * Da de alta a alguien de Quini: crea su cuenta de acceso, su perfil con el
 * rol que le toca, y deja la contrasena anotada en RAGNAR-CUENTAS.xlsx.
 *
 * Es solo para gente de Quini. Las maquilas se dan de alta con
 * crear_todas_las_maquilas.mjs, que ademas las amarra a su maquilaId.
 *
 * Uso (en web/):
 *   node scripts/crear_usuario_interno.mjs alvaro "Alvaro" almacen   <- ensayo
 *   EJECUTAR=1 node scripts/crear_usuario_interno.mjs alvaro "Alvaro" almacen
 *
 * Roles: admin | completo | consulta | almacen | captura
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import {
  DOMINIO,
  QUE_VE,
  ROLES_INTERNOS,
  RUTA_EXCEL,
  abrirLibro,
  explicarFalloDeEscritura,
  generarPassword,
  guardarLibro,
  ponerEnExcel
} from './lib/excelCuentas.mjs'

const [usuarioCrudo, nombreCrudo, rolCrudo] = process.argv.slice(2)
const usuario = String(usuarioCrudo || '').trim()
const nombre = String(nombreCrudo || '').trim()
const rol = String(rolCrudo || '').trim()

if (!usuario || !nombre || !rol) {
  console.error('Uso: node scripts/crear_usuario_interno.mjs <usuario> "<Nombre>" <rol>')
  console.error(`Roles: ${ROLES_INTERNOS.join(' | ')}`)
  process.exit(1)
}
if (!ROLES_INTERNOS.includes(rol)) {
  console.error(`Rol "${rol}" no existe. Roles validos: ${ROLES_INTERNOS.join(', ')}`)
  process.exit(1)
}
// El usuario va al correo y a las reglas: solo minusculas, numeros y guion
// bajo. Un acento o un espacio rompe el login sin decir por que.
if (!/^[a-z0-9_]+$/.test(usuario)) {
  console.error(`El usuario "${usuario}" solo puede llevar minusculas, numeros y guion bajo (sin acentos ni espacios).`)
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'
const email = `${usuario}@${DOMINIO}`

// ---- Guardas: nunca pisar una cuenta que ya existe ----
// Dar de alta no debe poder convertirse en "cambiarle el acceso a alguien":
// para eso esta resetear_password.mjs, que avisa a quien le esta cambiando.
const perfilPrevio = await db.collection('usuarios').where('empleadoId', '==', usuario).limit(1).get()
if (!perfilPrevio.empty) {
  const p = perfilPrevio.docs[0].data()
  console.error(`Ya existe un perfil con usuario "${usuario}": ${p.nombreCompleto || '(sin nombre)'} (rol ${p.rol}).`)
  console.error('Si lo que quieres es cambiarle la contrasena:  node scripts/resetear_password.mjs ' + usuario)
  process.exit(1)
}
try {
  await auth.getUserByEmail(email)
  console.error(`Ya existe una cuenta de acceso "${email}" (sin perfil). Revisala antes de seguir.`)
  process.exit(1)
} catch (err) {
  if (err.code !== 'auth/user-not-found') throw err
}

console.log(`\nUsuario:  ${usuario}`)
console.log(`Quien es: ${nombre}`)
console.log(`Rol:      ${rol}  ->  ${QUE_VE[rol]}`)

if (!ejecutar) {
  console.log('\n== ENSAYO: no se creo nada ==')
  console.log(`Para aplicarlo:  EJECUTAR=1 node scripts/crear_usuario_interno.mjs ${usuario} "${nombre}" ${rol}`)
  process.exit(0)
}

// La contrasena se genera solo cuando de verdad se va a aplicar: si el ensayo
// mostrara una, seria distinta de la que acabe quedando.
const password = generarPassword()
const cuenta = await auth.createUser({ email, password, emailVerified: true })

try {
  await db.collection('usuarios').doc(cuenta.uid).set({
    empleadoId: usuario,
    nombreCompleto: nombre,
    activo: true,
    rol
  })
} catch (err) {
  // Sin perfil no puede entrar y la cuenta suelta solo estorba: se deshace.
  // Si NI ESO se puede, hay que decirlo: si no, la proxima alta con ese mismo
  // usuario choca contra la cuenta huerfana sin pista de como llego ahi.
  console.error('\nSe creo la cuenta pero fallo el perfil. Deshaciendo la cuenta...')
  await auth.deleteUser(cuenta.uid).catch((errBorrado) => {
    console.error(`\nY TAMPOCO se pudo borrar la cuenta huerfana ${email} (uid ${cuenta.uid}).`)
    console.error(`Borrala a mano en la consola de Firebase Auth. (${errBorrado.message})`)
  })
  throw err
}

console.log(`\nCuenta creada.  Contrasena: ${password}`)

// ---- Dejarla anotada en el Excel ----
try {
  const libro = await abrirLibro()
  if (!libro) throw new Error('SIN_EXCEL')

  // Si por lo que sea ya habia una fila con ese usuario (alguien de baja que
  // se borro de Firestore sin regenerar el Excel), se refresca completa: no
  // debe quedar diciendo el nombre y el rol del anterior.
  const donde = ponerEnExcel(
    libro,
    usuario,
    {
      'Quien es': nombre,
      Rol: rol,
      Contrasena: password,
      Estado: 'activo',
      'Que ve': QUE_VE[rol] || ''
    },
    'Personal de Quini'
  )
  if (!donde) throw new Error('SIN_HOJA')

  await guardarLibro(libro)
  console.log(`Anotada en ${RUTA_EXCEL}`)
} catch (err) {
  console.log('\n' + '='.repeat(64))
  console.log('LA CUENTA SI SE CREO, pero NO se pudo anotar en el Excel.')
  console.log(`ANOTALA TU AHORA, es la unica copia:   ${password}`)
  console.log('='.repeat(64))
  if (err.message === 'SIN_EXCEL' || err.message === 'SIN_HOJA') {
    console.log('(corre actualizar_excel_cuentas.mjs y pega ahi la contrasena de arriba)')
  } else {
    console.log(`(${explicarFalloDeEscritura(err)})`)
  }
  // Se sale con codigo distinto: la cuenta quedo bien pero el Excel no, y eso
  // no debe verse como exito si algun dia esto se llama desde otro script.
  console.log(`\nDile a ${nombre} que entre en quini-ragnar.web.app con el usuario "${usuario}".`)
  process.exit(2)
}

console.log(`\nDile a ${nombre} que entre en quini-ragnar.web.app con el usuario "${usuario}".`)
process.exit(0)
