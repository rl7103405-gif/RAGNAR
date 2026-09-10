/**
 * Cuentas DEMO de diseno, en el corral de prueba (esPrueba: true).
 *
 * Roberto (9-sep): que el agente usuario-real pruebe el tablero de tareas de
 * diseno "como Lety", pero SIN tocar la cuenta de Lety ni datos reales. Las
 * siete demo_* que existian no tienen rol 'desarrollo', asi que faltaban dos:
 *   demo_diseno       -> la jefa (como Lety): puedeAsignarDiseno
 *   demo_disenadora   -> su equipo (como Monica): supervisorDisenoUid = demo_diseno
 * Todo lo que escriban vive en esPrueba:true y lo barre limpiar_datos_prueba.mjs.
 *
 * Uso (en web/):   node scripts/crear_demo_diseno.mjs          <- ensayo
 *                  EJECUTAR=1 node scripts/crear_demo_diseno.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { DOMINIO, abrirLibro, generarPassword, guardarLibro, ponerEnExcel } from './lib/excelCuentas.mjs'

const CUENTAS = [
  { usuario: 'demo_diseno', nombre: 'PRUEBA - jefa de diseno (como Lety)', flags: { puedeAsignarDiseno: true } },
  { usuario: 'demo_disenadora', nombre: 'PRUEBA - disenadora (como Monica)', flags: { supervisorDe: 'demo_diseno' } },
  // La segunda del equipo (como Maria Fernanda). Sin ella no se puede ver en
  // pantalla el caso "nada asignado" de la tabla por persona: el corral tenia
  // una sola disenadora y siempre traia trabajo (usuario-real, 10-sep).
  { usuario: 'demo_disenadora2', nombre: 'PRUEBA - disenadora 2 (como Maria Fernanda)', flags: { supervisorDe: 'demo_diseno' } }
]

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const auth = getAuth()
const db = getFirestore()
const ejecutar = process.env.EJECUTAR === '1'
console.log(ejecutar ? 'APLICANDO' : 'ENSAYO')

const uids = {}
const filasExcel = []
for (const c of CUENTAS) {
  const email = `${c.usuario}@${DOMINIO}`
  let cuenta = null
  try { cuenta = await auth.getUserByEmail(email) } catch (e) { if (e.code !== 'auth/user-not-found') throw e }
  if (cuenta) {
    const p = await db.collection('usuarios').doc(cuenta.uid).get()
    if (p.exists && p.data().esPrueba !== true) { console.error(`  ${c.usuario} existe y NO es de prueba: me detengo.`); process.exit(1) }
    console.log(`  ${c.usuario}: ya existe (se actualiza el perfil, la contrasena no se toca)`)
    uids[c.usuario] = cuenta.uid
    continue
  }
  console.log(`  ${c.usuario}: se crea -> ${c.nombre}`)
  if (!ejecutar) continue
  const password = generarPassword()
  const nueva = await auth.createUser({ email, password, emailVerified: true })
  uids[c.usuario] = nueva.uid
  filasExcel.push({ Usuario: c.usuario, 'Quien es': c.nombre, Rol: 'desarrollo', Contrasena: password, Estado: 'activo (PRUEBA)', 'Que ve': 'Tareas de diseno y Tech packs, en el corral de prueba' })
}

if (ejecutar) {
  for (const c of CUENTAS) {
    const uid = uids[c.usuario]
    if (!uid) continue
    const perfil = {
      empleadoId: c.usuario, nombreCompleto: c.nombre, activo: true, rol: 'desarrollo', esPrueba: true,
      puedeCrearTareas: false, administraCatalogoAvios: false, maquilaId: FieldValue.delete(),
      puedeAsignarDiseno: c.flags.puedeAsignarDiseno === true,
      supervisorDisenoUid: c.flags.supervisorDe ? uids[c.flags.supervisorDe] : FieldValue.delete(),
      actualizadoEn: FieldValue.serverTimestamp()
    }
    await db.collection('usuarios').doc(uid).set(perfil, { merge: true })
    console.log(`  perfil ${c.usuario}: rol desarrollo, esPrueba, ${c.flags.puedeAsignarDiseno ? 'puedeAsignarDiseno' : 'supervisorDisenoUid=' + uids[c.flags.supervisorDe]}`)
  }
  if (filasExcel.length) {
    const libro = await abrirLibro()
    for (const f of filasExcel) {
      const { Usuario, ...valores } = f
      ponerEnExcel(libro, Usuario, valores, 'Personal de Quini')
    }
    await guardarLibro(libro)
    console.log(`  ${filasExcel.length} contrasena(s) anotadas en RAGNAR-CUENTAS.xlsx (hoja Personal de Quini)`)
  }
} else {
  console.log('\nPara aplicarlo:  EJECUTAR=1 node scripts/crear_demo_diseno.mjs')
}
