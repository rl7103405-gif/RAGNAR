/**
 * Cambia la contrasena de UNA cuenta y la deja escrita en RAGNAR-CUENTAS.xlsx.
 *
 * Es la unica salida cuando alguien pierde su contrasena: Firebase las guarda
 * cifradas y no hay forma de leer la que tenia.
 *
 * A proposito NO acepta "todos": resetear a todo el mundo a media jornada deja
 * a la planta fuera de la app.
 *
 * Uso (en web/):
 *   node scripts/resetear_password.mjs cielo            <- ensayo, no cambia nada
 *   EJECUTAR=1 node scripts/resetear_password.mjs cielo
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import {
  DOMINIO,
  RUTA_EXCEL,
  abrirLibro,
  explicarFalloDeEscritura,
  generarPassword,
  guardarLibro,
  ponerEnExcel
} from './lib/excelCuentas.mjs'

const usuario = String(process.argv[2] || '').trim()
if (!usuario) {
  console.error('Falta el usuario.  Ejemplo: node scripts/resetear_password.mjs cielo')
  process.exit(1)
}
if (usuario.includes(',') || usuario.toLowerCase() === 'todos') {
  console.error('Una cuenta a la vez. Resetear a todos deja a la planta fuera de la app.')
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'

const perfilSnap = await db.collection('usuarios').where('empleadoId', '==', usuario).limit(1).get()
if (perfilSnap.empty) {
  console.error(`No existe ningun perfil con usuario "${usuario}".`)
  process.exit(1)
}
const perfil = perfilSnap.docs[0].data()

let cuenta
try {
  cuenta = await auth.getUserByEmail(`${usuario}@${DOMINIO}`)
} catch (err) {
  if (err.code !== 'auth/user-not-found') throw err
  console.error(`"${usuario}" tiene perfil pero no tiene cuenta de acceso.`)
  console.error(`Para darlo de alta:  node scripts/crear_usuario_interno.mjs ${usuario} "<Nombre>" <rol>`)
  process.exit(1)
}

console.log(`\nUsuario:  ${usuario}`)
console.log(`Quien es: ${perfil.nombreCompleto || '(sin nombre)'}  (rol ${perfil.rol})`)

// La contrasena se genera SOLO si de verdad se va a aplicar. Si el ensayo
// mostrara una, seria distinta de la que acabe quedando -- y quien la anote
// del ensayo va a estar dandole a la persona una que no funciona.
if (!ejecutar) {
  console.log(`\n== ENSAYO: no se cambio nada todavia ==`)
  console.log(`Para aplicarlo:  EJECUTAR=1 node scripts/resetear_password.mjs ${usuario}`)
  process.exit(0)
}

const password = generarPassword()
await auth.updateUser(cuenta.uid, { password })
console.log(`\nContrasena cambiada.  Nueva: ${password}`)

// Dejarla escrita en el Excel, en la hoja donde ya vive ese usuario.
// Todo este bloque va protegido: la contrasena YA cambio en Firebase, asi que
// si falla el Excel lo importante es decirlo claro, no tronar con un stack.
try {
  const libro = await abrirLibro()
  if (!libro) throw new Error('SIN_EXCEL')

  // Que no haya fila NO es un aviso suave: la contrasena ya cambio y esta
  // sola en pantalla. Correr actualizar_excel_cuentas.mjs despues NO la
  // recupera, porque ese script solo relee lo que ya estaba escrito.
  // Sin hoja destino a proposito: aqui no se dan de alta filas nuevas, solo
  // se actualiza a quien ya existe.
  if (!ponerEnExcel(libro, usuario, { Contrasena: password })) throw new Error('SIN_FILA')

  await guardarLibro(libro)
  console.log(`Anotada en ${RUTA_EXCEL}`)
} catch (err) {
  console.log('\n' + '='.repeat(64))
  console.log('LA CONTRASENA SI SE CAMBIO, pero NO se pudo anotar en el Excel.')
  console.log(`ANOTALA TU AHORA, es la unica copia:   ${password}`)
  console.log('='.repeat(64))
  if (err.message === 'SIN_EXCEL') {
    console.log('(no existe el Excel de cuentas: corre actualizar_excel_cuentas.mjs)')
  } else if (err.message === 'SIN_FILA') {
    console.log(`("${usuario}" todavia no tiene fila en el Excel: corre`)
    console.log(' actualizar_excel_cuentas.mjs y pega ahi la contrasena de arriba)')
  } else {
    console.log(`(${explicarFalloDeEscritura(err)})`)
  }
  // Codigo distinto: la contrasena cambio pero el Excel no quedo al dia.
  console.log(`\nDile a ${perfil.nombreCompleto || usuario} que entre con esta contrasena en quini-ragnar.web.app`)
  process.exit(2)
}

console.log(`\nDile a ${perfil.nombreCompleto || usuario} que entre con esta contrasena en quini-ragnar.web.app`)
process.exit(0)
