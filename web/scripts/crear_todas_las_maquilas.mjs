/**
 * Crea de una vez la cuenta de TODAS las maquilas activas del catalogo,
 * generando una contrasena fuerte para cada una, y las anota en
 * RAGNAR-CUENTAS.xlsx (raiz del proyecto, cubierto por .gitignore con *.xlsx).
 *
 * Solo toca las filas de las maquilas que crea. Si el Excel todavia no existe,
 * o hace falta rearmarlo con todas las cuentas, eso lo hace
 * actualizar_excel_cuentas.mjs.
 *
 * Uso (en web/):
 *   node scripts/crear_todas_las_maquilas.mjs           <- ensayo, no crea nada
 *   EJECUTAR=1 node scripts/crear_todas_las_maquilas.mjs
 *
 * Requiere serviceAccountKey.json en web/.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import {
  DOMINIO,
  QUE_VE,
  RUTA_EXCEL,
  abrirLibro,
  explicarFalloDeEscritura,
  generarPassword,
  guardarLibro,
  ponerEnExcel
} from './lib/excelCuentas.mjs'

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'
console.log(ejecutar ? '== MODO REAL: se crean cuentas ==\n' : '== ENSAYO: no se crea nada ==\n')

const snap = await db.collection('maquilas').orderBy('nombre').get()
const maquilas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.activo === true)

if (maquilas.length === 0) {
  console.error('No hay maquilas activas en el catalogo.')
  process.exit(1)
}

const resultados = []

for (const maquila of maquilas) {
  // El usuario ES el id de la maquila: no colisiona con los nombres cortos
  // del personal (angel, juan, cielo...), que es justo el riesgo de secuestro
  // de cuenta que cerramos.
  const usuario = maquila.id
  const email = `${usuario}@${DOMINIO}`

  // ¿Ya tiene cuenta? Por defecto se respeta y no se le cambia la contrasena.
  // Con RESET=1 se le genera una nueva: sirve cuando las contrasenas se
  // perdieron (p.ej. si el Excel no llego a escribirse).
  const yaTiene = await db.collection('usuarios').where('maquilaId', '==', maquila.id).get()
  if (!yaTiene.empty && process.env.RESET !== '1') {
    const quien = yaTiene.docs[0].data()
    console.log(`(ya tenia) ${maquila.nombre}: usuario "${quien.empleadoId || usuario}"`)
    resultados.push({
      maquila: maquila.nombre,
      maquilaId: maquila.id,
      usuario: quien.empleadoId || usuario,
      password: '(ya existia, no se cambio)',
      estado: 'ya existia'
    })
    continue
  }

  // Guardia: si el correo ya es de alguien de Quini, no se toca.
  let existente = null
  try {
    existente = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
  }
  if (existente) {
    const perfil = await db.collection('usuarios').doc(existente.uid).get()
    const p = perfil.exists ? perfil.data() : {}
    if (p.rol && p.rol !== 'maquila') {
      console.error(`SALTADA ${maquila.nombre}: el usuario "${usuario}" ya es de Quini (rol ${p.rol}).`)
      resultados.push({
        maquila: maquila.nombre,
        maquilaId: maquila.id,
        usuario,
        password: '',
        estado: 'SALTADA: el usuario ya existe y es de Quini'
      })
      continue
    }
  }

  const password = generarPassword()

  if (!ejecutar) {
    console.log(`[ensayo] ${maquila.nombre.padEnd(20)} usuario="${usuario}"  password=${password}`)
    resultados.push({ maquila: maquila.nombre, maquilaId: maquila.id, usuario, password, estado: 'ensayo' })
    continue
  }

  // Desde que se genera la contrasena hasta que se anota en el Excel, la
  // unica copia vive en memoria. Si algo truena aqui, hay que escupir en
  // pantalla TODAS las de esta corrida antes de morir: si no, quedan cuentas
  // con contrasena nueva que nadie conoce y solo se arreglan con RESET=1.
  try {
    let cuenta
    try {
      cuenta = await auth.getUserByEmail(email)
      await auth.updateUser(cuenta.uid, { password, disabled: false })
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err
      cuenta = await auth.createUser({ email, password, emailVerified: true })
    }

    await db.collection('usuarios').doc(cuenta.uid).set(
      {
        empleadoId: usuario,
        nombreCompleto: maquila.nombre,
        activo: true,
        rol: 'maquila',
        maquilaId: maquila.id
      },
      { merge: true }
    )
  } catch (err) {
    const yaGeneradas = resultados.filter((r) => r.password && !r.password.startsWith('('))
    console.error(`\nFallo a media alta de ${maquila.nombre}: ${err.message}`)
    if (yaGeneradas.length) {
      console.error('\n' + '='.repeat(64))
      console.error('ESTAS CUENTAS YA QUEDARON CON CONTRASENA NUEVA. ANOTALAS AHORA:')
      yaGeneradas.forEach((r) => console.error(`  ${r.usuario.padEnd(20)} ${r.password}`))
      console.error('='.repeat(64))
    }
    console.error(`\n(${usuario} pudo quedar a medias: revisalo y, si hace falta,`)
    console.error(` vuelve a correr con RESET=1 solo para esa maquila)`)
    process.exit(1)
  }

  const eraNueva = yaTiene.empty
  console.log(`${eraNueva ? 'CREADA  ' : 'RESETEADA'} ${maquila.nombre.padEnd(20)} usuario="${usuario}"`)
  resultados.push({
    maquila: maquila.nombre,
    maquilaId: maquila.id,
    usuario,
    password,
    estado: eraNueva ? 'creada' : 'contrasena nueva'
  })
}

// ---- Anotar las contrasenas nuevas en el Excel ----
// Solo se TOCAN las filas de las maquilas que se acaban de crear. Antes este
// script reconstruia el libro entero, y al rearmar la hoja del personal
// escribia su contrasena en blanco: cada corrida borraba las contrasenas que
// Roberto hubiera anotado a mano. Reconstruir el libro es tarea de
// actualizar_excel_cuentas.mjs y de nadie mas.
const nuevas = resultados.filter((r) => r.password && !r.password.startsWith('('))

if (ejecutar && nuevas.length > 0) {
  try {
    const libro = await abrirLibro()
    if (!libro) throw new Error('SIN_EXCEL')

    const sinFila = []
    for (const r of nuevas) {
      const donde = ponerEnExcel(
        libro,
        r.usuario,
        {
          Maquila: r.maquila,
          Contrasena: r.password,
          'ID interno': r.maquilaId,
          Estado: 'activo',
          'Que ve': QUE_VE.maquila
        },
        'Maquilas'
      )
      if (!donde) sinFila.push(r)
    }

    await guardarLibro(libro)
    console.log(`\nContrasenas anotadas en ${RUTA_EXCEL}`)
    if (sinFila.length) {
      console.log('\nEstas no encontraron donde anotarse (falta la hoja "Maquilas"):')
      sinFila.forEach((r) => console.log(`  - ${r.usuario}: ${r.password}`))
    }
  } catch (err) {
    console.log('\n' + '='.repeat(64))
    console.log('LAS CUENTAS SI SE CREARON, pero NO se pudieron anotar en el Excel.')
    console.log('ANOTALAS TU AHORA, son la unica copia:')
    nuevas.forEach((r) => console.log(`  ${r.usuario.padEnd(20)} ${r.password}`))
    console.log('='.repeat(64))
    if (err.message === 'SIN_EXCEL') {
      console.log('(no existe el Excel: corre actualizar_excel_cuentas.mjs y pega ahi las de arriba)')
    } else {
      console.log(`(${explicarFalloDeEscritura(err)})`)
    }
    process.exit(2)
  }
}

console.log(`\n${nuevas.length} cuenta(s) con contrasena nueva.`)
if (!ejecutar) console.log('Para crearlas de verdad: EJECUTAR=1 node scripts/crear_todas_las_maquilas.mjs')
process.exit(0)
