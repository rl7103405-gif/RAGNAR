/**
 * Crea el JUEGO DE CUENTAS DE PRUEBA: una por cada perfil que existe en
 * RAGNAR, para poder recorrer los flujos completos sin usar la cuenta de
 * nadie del personal.
 *
 * ⚠️ ESTO NO ES UN AMBIENTE DE PRUEBAS. RAGNAR no tiene uno: no hay
 * proyecto de staging ni prefijo de coleccion (captura-mecanicos si, con
 * ambientes/prueba/*). Estas cuentas entran a la MISMA base de produccion,
 * y lo que capturen o emitan queda mezclado con lo real. Lo que si se puede
 * es dejarlo IDENTIFICADO y borrable: todo perfil que crea este script lleva
 * esPrueba:true, y limpiar_datos_prueba.mjs sabe deshacer lo que generaron.
 *
 * Lo que NO se puede deshacer, y por eso conviene no hacerlo con estas
 * cuentas (ver el aviso que imprime el script):
 *   - emitir una remision -> quema un folio interno del consecutivo oficial
 *   - cargar el Excel de ruteo -> pisa el ruteo del dia de toda la planta
 *
 * Uso (en web/):
 *   node scripts/crear_usuarios_prueba.mjs              <- ensayo, no crea nada
 *   EJECUTAR=1 node scripts/crear_usuarios_prueba.mjs
 *   EJECUTAR=1 RESET=1 node scripts/crear_usuarios_prueba.mjs   <- ademas
 *       rota la contrasena de las de prueba que ya existan (util si se
 *       perdieron; nunca toca una cuenta que no sea de prueba)
 *
 * Requiere serviceAccountKey.json en web/.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
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

// La maquila de pruebas tiene que existir en el catalogo y estar ACTIVA: la
// regla esMaquilaDe() exige maquilas/{mid}.activo == true, asi que una maquila
// "apagada" dejaria el portal de prueba cerrado y no se podria probar nada.
// Como el selector de destino de remision lista todas las activas ordenadas
// por nombre, el nombre empieza con ZZZ (queda hasta el final) y dice lo que
// es: es lo unico que evita que alguien le mande una remision de verdad.
const MAQUILA_PRUEBA = {
  id: 'demo_maquila',
  nombre: 'ZZZ PRUEBAS - NO USAR (maquila ficticia)',
  direccion: 'Cuenta de pruebas de RAGNAR. No mandar bultos reales aqui.'
}

// Una cuenta por perfil real, nombrada por el puesto y no por la persona: si
// manana Angel se va, la cuenta de prueba del pesador sigue teniendo sentido.
const CUENTAS = [
  {
    usuario: 'demo_admin',
    nombre: 'PRUEBA - admin (como Roberto)',
    rol: 'admin',
    ve: 'Todas las pestanas + autoriza correcciones'
  },
  {
    usuario: 'demo_embarques',
    nombre: 'PRUEBA - embarques (como America o Diana)',
    rol: 'completo',
    extra: { puedeCrearTareas: false },
    ve: 'Captura, Tareas (solo recibe), Folios del dia, Historial, Reportes, Indicadores, Maquilas, Registros'
  },
  {
    usuario: 'demo_tareas',
    nombre: 'PRUEBA - embarques + encarga tareas (como Lindbergh)',
    rol: 'completo',
    extra: { puedeCrearTareas: true },
    ve: 'Lo de embarques + Tareas a maquilas (con Tech Pack)'
  },
  {
    usuario: 'demo_consulta',
    nombre: 'PRUEBA - consulta + catalogo de avios (como Cielo)',
    rol: 'consulta',
    extra: { administraCatalogoAvios: true },
    ve: 'Solo lectura: Historial, Reportes, Indicadores, Registros + administra el catalogo de Avios'
  },
  {
    usuario: 'demo_almacen',
    nombre: 'PRUEBA - almacen de avios (como Alvaro)',
    rol: 'almacen',
    ve: 'Piden material, Mandar material, Inventario maquilas, Avios (consulta), Tareas'
  },
  {
    usuario: 'demo_pesador',
    nombre: 'PRUEBA - pesador (como Angel o Juan)',
    rol: 'captura',
    ve: 'Solo la pestana Captura'
  },
  {
    usuario: 'demo_maquila',
    nombre: 'PRUEBA - maquila externa',
    rol: 'maquila',
    maquilaId: MAQUILA_PRUEBA.id,
    ve: 'Solo su portal: lo que recibe, tareas de ensamble, su material y su inventario'
  }
]

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'
const reset = process.env.RESET === '1'

console.log(ejecutar ? '== MODO REAL: se crean cuentas ==\n' : '== ENSAYO: no se crea nada ==\n')

// ---------------------------------------------------------------------------
// 1. Revisar TODO antes de tocar nada
// ---------------------------------------------------------------------------
// Se comprueban las 7 cuentas primero y solo despues se escribe la primera:
// abortar a la mitad dejaria un juego incompleto (p. ej. la maquila creada en
// el catalogo pero sin su cuenta) y habria que limpiarlo a mano.
const plan = []
const bloqueos = []

for (const cuenta of CUENTAS) {
  // El usuario viaja al correo y a las reglas: mismo criterio que
  // crear_usuario_interno.mjs. Un acento o un espacio rompe el login sin
  // decir por que.
  if (!/^[a-z0-9_]+$/.test(cuenta.usuario)) {
    bloqueos.push(`"${cuenta.usuario}": solo minusculas, numeros y guion bajo.`)
    continue
  }

  const email = `${cuenta.usuario}@${DOMINIO}`

  // ¿Ya hay un perfil con ese usuario? Si lo hay y NO es de prueba, es de una
  // persona de verdad y NO se toca: pisarlo le entregaria su cuenta a quien
  // corra este script (misma leccion que dejaron las maquilas, que se llaman
  // como personas).
  const perfilPrevio = await db.collection('usuarios').where('empleadoId', '==', cuenta.usuario).limit(1).get()
  const perfilExistente = perfilPrevio.empty ? null : perfilPrevio.docs[0]
  if (perfilExistente && perfilExistente.data().esPrueba !== true) {
    const p = perfilExistente.data()
    bloqueos.push(
      `"${cuenta.usuario}" ya existe y NO es cuenta de prueba: ${p.nombreCompleto || '(sin nombre)'} ` +
        `(rol ${p.rol}). No se toca.`
    )
    continue
  }

  // Y la cuenta de acceso: puede existir en Auth sin perfil (un alta que se
  // quedo a medias). Si el uid tampoco es el del perfil de prueba, hay algo
  // raro y se prefiere parar a adivinar.
  let cuentaAuth = null
  try {
    cuentaAuth = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
  }
  if (cuentaAuth && !perfilExistente) {
    bloqueos.push(`"${email}" ya existe en Auth pero sin perfil de prueba. Revisala a mano antes de seguir.`)
    continue
  }
  if (cuentaAuth && perfilExistente && cuentaAuth.uid !== perfilExistente.id) {
    bloqueos.push(
      `"${cuenta.usuario}" tiene perfil (uid ${perfilExistente.id}) y cuenta de acceso con OTRO uid ` +
        `(${cuentaAuth.uid}). Eso hay que resolverlo a mano.`
    )
    continue
  }

  // Perfil sin cuenta de acceso: pasa si alguien borro la cuenta en la consola
  // de Firebase y dejo el perfil. Hay que rehacer el acceso (con contrasena
  // nueva, no hay otra), pero REUSANDO EL UID DEL PERFIL: si se dejara que
  // Auth invente uno, el perfil viejo quedaria huerfano y todo lo que esa
  // cuenta escribio antes quedaria firmado por un uid que ya no es de nadie.
  const soloFaltaElAcceso = perfilExistente && !cuentaAuth

  plan.push({
    ...cuenta,
    email,
    uidExistente: perfilExistente ? perfilExistente.id : null,
    tieneAcceso: !!cuentaAuth,
    // Se rota la contrasena solo si la cuenta es nueva o si se pidio RESET:
    // si no, volver a correr el script dejaria fuera a quien ya estaba usando
    // la cuenta de prueba con la contrasena anotada en el Excel.
    accion: !perfilExistente ? 'crear' : soloFaltaElAcceso ? 'rehacer acceso' : reset ? 'resetear' : 'sin cambios'
  })
}

if (bloqueos.length) {
  console.error('NO SE HIZO NADA. Hay que resolver esto primero:\n')
  bloqueos.forEach((b) => console.error(`  - ${b}`))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. La maquila de pruebas en el catalogo
// ---------------------------------------------------------------------------
const refMaquila = db.collection('maquilas').doc(MAQUILA_PRUEBA.id)
const maquilaSnap = await refMaquila.get()
if (maquilaSnap.exists && maquilaSnap.data().esPrueba !== true) {
  console.error(
    `NO SE HIZO NADA. Ya existe la maquila "${MAQUILA_PRUEBA.id}" en el catalogo ` +
      `("${maquilaSnap.data().nombre}") y no esta marcada como de prueba. No se pisa.`
  )
  process.exit(1)
}
const maquilaEsNueva = !maquilaSnap.exists
// limpiar_datos_prueba.mjs con APAGAR=1 deja activo:false en el catalogo. Si
// no se distingue este caso, el mensaje diria "ya existe" aunque el portal
// siga cerrado y nadie se enteraria de que hace falta reactivarla.
const maquilaEstabaApagada = maquilaSnap.exists && maquilaSnap.data().activo !== true

// ---------------------------------------------------------------------------
// 3. Enseñar el plan
// ---------------------------------------------------------------------------
const estadoMaquila = maquilaEsNueva ? 'SE CREA' : maquilaEstabaApagada ? 'se reactiva' : 'ya existe'
console.log(`Maquila de pruebas: ${estadoMaquila}  ->  ${MAQUILA_PRUEBA.nombre}\n`)
console.log('Cuentas:')
for (const p of plan) {
  console.log(`  ${p.accion.padEnd(15)} ${p.usuario.padEnd(16)} rol=${String(p.rol).padEnd(9)} ${p.nombre}`)
}

if (!ejecutar) {
  const yaEstaban = plan.filter((p) => p.accion !== 'crear').length
  console.log('\n== ENSAYO: no se creo nada ==')
  if (yaEstaban && !reset) {
    console.log(`(${yaEstaban} ya existian; para darles contrasena nueva agrega RESET=1)`)
  }
  console.log('Para aplicarlo:  EJECUTAR=1 node scripts/crear_usuarios_prueba.mjs')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 4. Aplicar
// ---------------------------------------------------------------------------
// Se escribe SIEMPRE (merge), no solo cuando es nueva: si no, volver a correr
// el script tras un APAGAR=1 reactiva los perfiles y Auth pero la maquila se
// queda con activo:false, y esMaquilaDe() deja el portal cerrado sin decir
// por que. creadoEn/creadoPorUid solo se ponen la primera vez, para no pisar
// la fecha original con cada corrida.
await refMaquila.set(
  {
    nombre: MAQUILA_PRUEBA.nombre,
    direccion: MAQUILA_PRUEBA.direccion,
    activo: true,
    esPrueba: true,
    ...(maquilaEsNueva ? { creadoEn: FieldValue.serverTimestamp(), creadoPorUid: 'script-crear_usuarios_prueba' } : {})
  },
  { merge: true }
)
console.log(
  `\nMaquila de pruebas ${maquilaEsNueva ? 'creada' : maquilaEstabaApagada ? 'reactivada' : 'actualizada'} en el catalogo: ${MAQUILA_PRUEBA.id}`
)

const hechas = []

for (const p of plan) {
  // Toda cuenta (incluida 'sin cambios') pasa por el MISMO try/catch: si una
  // fallara a media corrida, las que ya se aplicaron antes no deben perderse
  // (ver el catch de abajo, que ya no corta la salida antes del Excel).
  try {
    if (p.accion === 'sin cambios') {
      // El perfil se escribe PRIMERO y el acceso se prende despues: si algo
      // truena entre las dos, mejor un perfil correcto con Auth deshabilitada
      // (login rechazado, error claro) que un Auth ya prendida apuntando a un
      // perfil que se quedo con datos de una corrida anterior.
      await escribirPerfil(p.uidExistente, p)
      // Si limpiar_datos_prueba.mjs con APAGAR=1 la dejo disabled:true en
      // Auth, reencenderla es justo lo que este script promete hacer: si no,
      // el perfil queda activo:true pero el login sigue tronando con
      // auth/user-disabled, un error que no se relaciona con nada de esto.
      await auth.updateUser(p.uidExistente, { disabled: false })
      hechas.push({ ...p, password: '(ya existia, no se cambio)' })
      console.log(`(sin cambios) ${p.usuario}`)
      continue
    }

    // La contrasena solo existe en memoria desde aqui hasta que se anota en el
    // Excel. Si algo truena en el medio hay que escupir en pantalla las que ya
    // se aplicaron, o quedan cuentas con contrasena que nadie conoce.
    const password = generarPassword()
    let uid = p.uidExistente
    // Distingue "el acceso de Auth se acaba de crear EN ESTA CORRIDA" de
    // "ya habia un uid de perfil de antes" (p.uidExistente): en 'rehacer
    // acceso' las dos cosas son ciertas a la vez, y si se usara solo
    // !p.uidExistente para decidir si se deshace el acceso al fallar el
    // perfil, esa cuenta nueva de Auth se quedaria huerfana.
    let accesoCreadoAhora = false
    if (uid && p.tieneAcceso) {
      await auth.updateUser(uid, { password, disabled: false })
    } else {
      // Con uid explicito cuando ya habia perfil: asi el acceso rehecho sigue
      // siendo el mismo usuario y no se pierde la atribucion de lo anterior.
      const creada = await auth.createUser({
        ...(uid ? { uid } : {}),
        email: p.email,
        password,
        emailVerified: true
      })
      uid = creada.uid
      accesoCreadoAhora = true
    }
    // escribirPerfil va en su propio try/catch: si Auth ya quedo aplicado y
    // esto truena, la contrasena no se puede perder (nadie mas la sabe) y,
    // si el acceso era nuevo, tampoco puede quedar huerfano con una
    // contrasena que nadie anoto.
    try {
      await escribirPerfil(uid, p)
    } catch (errPerfil) {
      console.error(`\nSe aplico la cuenta de Auth de "${p.usuario}" pero fallo el perfil: ${errPerfil.message}`)
      console.error(`Contrasena de "${p.usuario}" (${p.email}): ${password}`)
      if (accesoCreadoAhora) {
        console.error('Era acceso nuevo: deshaciendolo...')
        await auth.deleteUser(uid).catch((errBorrado) => {
          console.error(`Y TAMPOCO se pudo borrar la cuenta huerfana ${p.email} (uid ${uid}).`)
          console.error(`Borrala a mano en la consola de Firebase Auth. (${errBorrado.message})`)
        })
      }
      throw errPerfil
    }
    hechas.push({ ...p, uid, password })
    const etiqueta = { crear: 'CREADA        ', resetear: 'RESETEADA     ', 'rehacer acceso': 'ACCESO REHECHO' }
    console.log(`${etiqueta[p.accion] || p.accion} ${p.usuario.padEnd(16)} ${password}`)
  } catch (err) {
    console.error(`\nFallo en "${p.usuario}": ${err.message}`)
    volcarContrasenas(hechas)
    // Sin exit aqui: se deja caer al bloque 5 (mas abajo) para que las
    // cuentas que SI se aplicaron antes de esta se anoten en el Excel -- si
    // no, quedarian solo en la terminal y se perderian en cuanto se cierre.
    // exitCode (no exit) para que el proceso SIGA hasta terminar esa anotacion.
    process.exitCode = 1
    break
  }
}

/**
 * El perfil se escribe SIEMPRE con merge: un .set() plano borraria campos que
 * este script no conoce (regla dura: sin rol, la persona se queda sin acceso
 * a nada y en silencio).
 *
 * Pero merge tiene su propia trampa: conserva lo que hubiera quedado de una
 * corrida anterior. Por eso los permisos NO se escriben "solo si aplican" —
 * los flags van SIEMPRE, en false cuando no le tocan, y a las cuentas
 * internas se les BORRA el maquilaId. Un perfil interno que arrastre
 * maquilaId es justo el hibrido que las reglas se cansan de bloquear, y aqui
 * naceria por descuido en vez de por ataque.
 */
async function escribirPerfil(uid, p) {
  const extra = p.extra || {}
  await db
    .collection('usuarios')
    .doc(uid)
    .set(
      {
        empleadoId: p.usuario,
        nombreCompleto: p.nombre,
        activo: true,
        rol: p.rol,
        esPrueba: true,
        puedeCrearTareas: extra.puedeCrearTareas === true,
        administraCatalogoAvios: extra.administraCatalogoAvios === true,
        maquilaId: p.maquilaId ? p.maquilaId : FieldValue.delete()
      },
      { merge: true }
    )
}

function volcarContrasenas(lista) {
  const nuevas = lista.filter((r) => r.password && !r.password.startsWith('('))
  if (!nuevas.length) return
  console.error('\n' + '='.repeat(64))
  console.error('ESTAS CUENTAS YA QUEDARON CON CONTRASENA NUEVA. ANOTALAS AHORA:')
  nuevas.forEach((r) => console.error(`  ${r.usuario.padEnd(18)} ${r.password}`))
  console.error('='.repeat(64))
}

// ---------------------------------------------------------------------------
// 5. Anotarlas en el Excel de cuentas
// ---------------------------------------------------------------------------
// Van en las MISMAS hojas que el resto ("Personal de Quini" y "Maquilas"),
// no en una hoja aparte: actualizar_excel_cuentas.mjs reconstruye el libro
// con esas tres hojas fijas y se llevaria por delante cualquier otra. Se
// distinguen por el nombre, que empieza con "PRUEBA -".
const nuevas = hechas.filter((r) => r.password && !r.password.startsWith('('))

if (nuevas.length > 0) {
  try {
    const libro = await abrirLibro()
    if (!libro) throw new Error('SIN_EXCEL')

    const sinFila = []
    for (const r of nuevas) {
      const donde =
        r.rol === 'maquila'
          ? ponerEnExcel(
              libro,
              r.usuario,
              {
                Maquila: MAQUILA_PRUEBA.nombre,
                Contrasena: r.password,
                'ID interno': r.maquilaId,
                Estado: 'activo (CUENTA DE PRUEBA)',
                'Que ve': r.ve || QUE_VE.maquila
              },
              'Maquilas'
            )
          : ponerEnExcel(
              libro,
              r.usuario,
              {
                'Quien es': r.nombre,
                Rol: r.rol,
                Contrasena: r.password,
                Estado: 'activo (CUENTA DE PRUEBA)',
                'Que ve': r.ve || QUE_VE[r.rol] || ''
              },
              'Personal de Quini'
            )
      if (!donde) sinFila.push(r)
    }

    await guardarLibro(libro)
    console.log(`\nContrasenas anotadas en ${RUTA_EXCEL}`)
    if (sinFila.length) {
      console.log('\nEstas no encontraron donde anotarse (falta la hoja):')
      sinFila.forEach((r) => console.log(`  - ${r.usuario}: ${r.password}`))
    }
  } catch (err) {
    console.log('\n' + '='.repeat(64))
    console.log('LAS CUENTAS SI SE CREARON, pero NO se pudieron anotar en el Excel.')
    console.log('ANOTALAS TU AHORA, son la unica copia:')
    nuevas.forEach((r) => console.log(`  ${r.usuario.padEnd(18)} ${r.password}`))
    console.log('='.repeat(64))
    if (err.message === 'SIN_EXCEL') {
      console.log('(no existe el Excel: corre actualizar_excel_cuentas.mjs y pega ahi las de arriba)')
    } else {
      console.log(`(${explicarFalloDeEscritura(err)})`)
    }
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------
// 6. El aviso que importa
// ---------------------------------------------------------------------------
console.log(`\n${nuevas.length} cuenta(s) con contrasena nueva. Entra en https://quini-ragnar.web.app`)
console.log(`
${'='.repeat(72)}
ESTAS CUENTAS ESTAN ENCERRADAS EN SU PROPIO CORRAL.

RAGNAR no tiene ambiente de pruebas (ni staging ni emulador), asi que el
aislamiento lo hacen las REGLAS DE FIRESTORE: un perfil con esPrueba:true solo
alcanza lo suyo. No es disciplina de quien prueba, es el servidor el que dice
que no.

⚠️ Ese corral vive en firestore.rules. Mientras esas reglas no esten
DESPLEGADAS, estas cuentas tienen poder real: hosting primero, reglas despues.

LO QUE SI PUEDEN:
  - Capturar bultos cuyo folio EMPIECE CON "ZZTEST" (la pantalla te lo
    recuerda si escribes otro). Es lo que permite barrerlos despues sin tocar
    nada real.
  - Todo lo que pase en el portal de "${MAQUILA_PRUEBA.id}": mandarle una
    remision, que la reciba con el lector, material, tareas de ensamble con
    Tech Pack.
  - Emitir remisiones a esa maquila. Usan un consecutivo APARTE
    (config/folioInternoPrueba): el folio interno oficial del papa de Roberto
    NO se mueve, y el papel sale con la marca PRUEBA en todas las hojas.
  - Tareas entre cuentas de prueba.
  - Leer TODO: el aislamiento es de ESCRITURA. Estas cuentas ven la operacion
    real igual que la persona a la que imitan.

LO QUE EL SERVIDOR LES RECHAZA (aunque se intente desde la consola del
navegador, saltandose la pantalla):
  - Capturar, editar o borrar un bulto que no sea ZZTEST.
  - Cargar el Excel de "Folios del dia" y tocar el ruteo.
  - Quemar el folio interno OFICIAL.
  - Emitir, anular o corregir una remision de una maquila real.
  - Mandar material, mover inventario o encargar tareas de ensamble a una
    maquila real.
  - Dar de alta o de baja maquilas reales, y tocar el catalogo de avios.
  - Encargarle una tarea a una persona real, o cerrar/reabrir una tarea real.
  - Pedir, aprobar o consumir una correccion sobre un folio o una remision de
    verdad.

EL LIMITE QUE QUEDA (las reglas no pueden recorrer una lista):
  Una remision de prueba podria incluir folios REALES en su lista. Si pasa, el
  papel de prueba los menciona, pero esos bultos NO quedan tocados: el marcado
  "ya salio en PDF" se rechaza folio por folio. Emitiendo con folios ZZTEST no
  ocurre ni eso.

Cuando termines de probar:
    node scripts/limpiar_datos_prueba.mjs                <- ve que quedo
    EJECUTAR=1 node scripts/limpiar_datos_prueba.mjs     <- lo borra
    EJECUTAR=1 APAGAR=1 node scripts/limpiar_datos_prueba.mjs  <- ademas deja
        las 7 cuentas apagadas hasta la proxima prueba (no las borra)
${'='.repeat(72)}`)

// process.exitCode ya quedo en 1 si alguna cuenta fallo a media corrida (ver
// el catch de arriba): no forzar 0 aqui lo taparia.
process.exit(process.exitCode || 0)
