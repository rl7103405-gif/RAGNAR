/**
 * Borra lo que generaron las CUENTAS DE PRUEBA (las que crea
 * crear_usuarios_prueba.mjs, marcadas con esPrueba:true en su perfil).
 *
 * Existe porque RAGNAR no tiene ambiente aislado: las pruebas caen en las
 * mismas colecciones que la operacion real y, si no se limpian, ensucian
 * Historial, Reportes e Indicadores para siempre.
 *
 * ⚠️ ESTO NO ES UN ROLLBACK. Es una escoba. Borra lo que puede identificar
 * como de prueba SIN riesgo de llevarse algo real; lo demas lo LISTA para
 * que un humano decida. Si una cuenta de prueba toco datos reales, eso se
 * arregla a mano o no se arregla.
 *
 * Uso (en web/):
 *   node scripts/limpiar_datos_prueba.mjs                <- ensayo: solo cuenta
 *   EJECUTAR=1 node scripts/limpiar_datos_prueba.mjs     <- borra los datos
 *   EJECUTAR=1 APAGAR=1 ...           <- ademas deja las cuentas apagadas
 *   EJECUTAR=1 BORRAR_PDFS=1 ...      <- ademas borra las remisiones de prueba
 *                                        (solo las que llevan puros folios de
 *                                         prueba; si no, se niega)
 *   EJECUTAR=1 BORRAR_CUENTAS=1 ...   <- borra cuentas, perfiles y la maquila
 *
 * Requiere serviceAccountKey.json en web/.
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

// Prefijo reservado para los folios que se capturan en pruebas.
//
// Es el unico discriminador confiable de un bulto de prueba: 'operadorUid'
// NO sirve, porque al EDITAR un bulto la app lo reescribe con el uid de quien
// edita (PanelCaptura: "operadorUid pasa a ser el de QUIEN EDITA"). O sea que
// un bulto REAL que una cuenta de prueba abrio y guardo quedaria firmado por
// ella, y borrar por uid se lo llevaria. Por eso se exigen las DOS cosas:
// firmado por una cuenta de prueba Y folio con este prefijo.
const PREFIJO_PRUEBA = 'ZZTEST'

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const ejecutar = process.env.EJECUTAR === '1'
const apagar = process.env.APAGAR === '1'
const borrarPdfs = process.env.BORRAR_PDFS === '1'
const borrarCuentas = process.env.BORRAR_CUENTAS === '1'

console.log(ejecutar ? '== MODO REAL: se borra ==\n' : '== ENSAYO: no se borra nada ==\n')

// ---------------------------------------------------------------------------
// 1. Quienes son las cuentas de prueba
// ---------------------------------------------------------------------------
// Los DOS conjuntos se consultan ANTES de decidir si hay algo que limpiar: si
// solo se mirara perfilesPrueba, una corrida de crear_usuarios_prueba.mjs que
// se corto justo despues de crear la maquila (sin llegar a las cuentas)
// dejaria demo_maquila en el catalogo sin forma de quitarla, porque el script
// diria "nada que limpiar" antes de mirar maquilas.
const perfilesPrueba = await db.collection('usuarios').where('esPrueba', '==', true).get()
const maquilasPrueba = await db.collection('maquilas').where('esPrueba', '==', true).get()
if (perfilesPrueba.empty && maquilasPrueba.empty) {
  console.log('No hay ninguna cuenta ni maquila marcada como de prueba (esPrueba:true). Nada que limpiar.')
  process.exit(0)
}

const uids = perfilesPrueba.docs.map((d) => d.id)
const porUid = new Map(perfilesPrueba.docs.map((d) => [d.id, d.data()]))
console.log(`Cuentas de prueba (${uids.length}):`)
perfilesPrueba.docs.forEach((d) => console.log(`  ${String(d.data().empleadoId).padEnd(16)} rol=${d.data().rol}`))

const idsMaquilaPrueba = maquilasPrueba.docs.map((d) => d.id)
if (idsMaquilaPrueba.length) console.log(`Maquilas de prueba: ${idsMaquilaPrueba.join(', ')}`)

// ---------------------------------------------------------------------------
// 2. Buscar lo que escribieron
// ---------------------------------------------------------------------------
/**
 * Documentos de `coleccion` cuyo `campo` sea de alguna cuenta de prueba.
 *
 * El `in` de Firestore acepta 30 valores; se trocea de 10 en 10 para no
 * depender de esa cota si algun dia hay mas cuentas de prueba.
 */
async function buscarPorUid(coleccion, campo) {
  const encontrados = new Map()
  for (let i = 0; i < uids.length; i += 10) {
    const lote = uids.slice(i, i + 10)
    const snap = await db.collection(coleccion).where(campo, 'in', lote).get()
    snap.docs.forEach((d) => encontrados.set(d.id, d))
  }
  return [...encontrados.values()]
}

// cargasRuteo y avios YA NO estan en un arreglo de "se borra por uid": los
// dos se listan pero nunca se borran (ver el porque junto a cada uno abajo).
// cambiosCaptura, solicitudesCorreccion, autorizaciones y tareas tampoco
// entran aqui: traen un campo que puede apuntar a algo REAL (el folio, o la
// persona asignada) y se filtran aparte, mas abajo.

// cargasRuteo: NUNCA se borra. Es la evidencia de que Excel de ruteo piso el
// ruteo real; borrar el registro no revierte el ruteo, solo tapa el rastro
// que hace falta para repararlo a mano.
const cargasRuteoDudosas = await buscarPorUid('cargasRuteo', 'subioUid')

// avios: NUNCA se borra automaticamente. Una cuenta de prueba pudo dar de
// alta un avio que alguien ya empezo a usar (borrar la clave del catalogo
// deja movimientos e inventario apuntando a un codigo inexistente), o pudo
// EDITAR un avio real (Avios.jsx reescribe actualizadoPorUid al cambiar
// activo/descripcion): por eso se busca por LOS DOS campos.
const aviosCreados = await buscarPorUid('avios', 'creadoPorUid')
const aviosActualizados = await buscarPorUid('avios', 'actualizadoPorUid')
const aviosDudososPorId = new Map()
aviosCreados.forEach((d) => aviosDudososPorId.set(d.id, { doc: d, alta: true, edicion: false }))
aviosActualizados.forEach((d) => {
  const previo = aviosDudososPorId.get(d.id)
  aviosDudososPorId.set(d.id, { doc: d, alta: previo?.alta || false, edicion: true })
})
const aviosDudosos = [...aviosDudososPorId.values()]

// El prefijo de folio es el discriminador desde aqui en adelante, no solo
// para bultos: el campo puede venir vacio o no ser string, de ahi el guard.
const esFolioDePrueba = (folio) => typeof folio === 'string' && folio.toUpperCase().startsWith(PREFIJO_PRUEBA)

// Los bultos, con la doble condicion explicada arriba (PREFIJO_PRUEBA).
const bultosFirmados = await buscarPorUid('bultos', 'operadorUid')
const bultosBorrables = bultosFirmados.filter((d) => esFolioDePrueba(d.id))
const bultosDudosos = bultosFirmados.filter((d) => !esFolioDePrueba(d.id))

// cambiosCaptura, solicitudesCorreccion y autorizaciones traen un campo
// `folio` que puede ser de un bulto REAL: cambiosCaptura porque al EDITAR un
// bulto la app lo reescribe con el uid de quien edita (PanelCaptura:
// "operadorUid pasa a ser el de QUIEN EDITA"), y ademas es una bitacora que
// las propias reglas describen como inmutable; solicitudesCorreccion y
// autorizaciones porque una cuenta de prueba pudo pedir o aprobar una
// correccion sobre un folio real (demo_admin autorizando algo de verdad, por
// ejemplo). Por eso se exigen las DOS cosas: firmado por una cuenta de
// prueba Y folio con el prefijo.
function separarPorFolio(docs) {
  return {
    borrables: docs.filter((d) => esFolioDePrueba(d.data().folio)),
    dudosos: docs.filter((d) => !esFolioDePrueba(d.data().folio))
  }
}

const cambiosCaptura = separarPorFolio(await buscarPorUid('cambiosCaptura', 'hechoPorUid'))

// solicitudesCorreccion/autorizaciones de tipo 'editar_pdf' NO traen un folio
// de bulto en `folio`: ahi el campo es el ID del documento de pdfsGenerados
// (ver CorregirPdfModal.jsx y firestore.rules, comentario junto a
// autorizacionId: "el 'folio' es el ID del registro de pdfsGenerados"). Con
// el prefijo aplicado directo a ese ID, SIEMPRE caeria en dudosas aunque la
// remision fuera pura ZZTEST. Hay que resolver el registro y mirar adentro.
async function esDePrueba(dato) {
  if (dato.tipo === 'editar_pdf') {
    const snap = await db.collection('pdfsGenerados').doc(dato.folio).get()
    if (!snap.exists) return false
    const reg = snap.data()
    // La MARCA del registro manda: desde que las reglas la exigen, un
    // pdfsGenerados con esPrueba:true solo lo pudo escribir una cuenta de
    // prueba, y uno real no puede llevarla. El criterio por folios queda como
    // respaldo para las remisiones emitidas ANTES de ese cambio.
    if (reg.esPrueba === true) return true
    const folios = reg.folios || []
    return folios.length > 0 && folios.every(esFolioDePrueba)
  }
  return esFolioDePrueba(dato.folio)
}

// Las dos colecciones se EMPAREJAN por el ID deterministico de la
// autorizacion (`${folio}_${tipo}`, ver idAutorizacion() en
// src/utils/auditoria.js) y por `solicitudId` (que la autorizacion guarda de
// vuelta): si una cuenta de prueba pide una correccion y la aprueba un admin
// REAL (o al reves), el par NO es clasificable entero como de prueba, y se
// deja completo -- borrar solo la mitad dejaria la otra colgada (una
// autorizacion sin su solicitud, o una solicitud "aprobada" sin autorizacion
// vigente).
const solicitudesPorUid = await buscarPorUid('solicitudesCorreccion', 'pedidoPorUid')
const autorizacionesPorUid = await buscarPorUid('autorizaciones', 'otorgadaPorUid')

const solicitudesCorreccion = { borrables: [], dudosos: [] }
for (const d of solicitudesPorUid) {
  const sol = d.data()
  if (!(await esDePrueba(sol))) {
    solicitudesCorreccion.dudosos.push(d)
    continue
  }
  const autSnap = await db.collection('autorizaciones').doc(`${sol.folio}_${sol.tipo}`).get()
  if (!autSnap.exists) {
    // Sin autorizacion vigente (pendiente, rechazada, o ya consumida): no
    // hay nada con que emparejarla, se borra sola.
    solicitudesCorreccion.borrables.push(d)
    continue
  }
  const aut = autSnap.data()
  const autEsDePrueba = uids.includes(aut.otorgadaPorUid) && (await esDePrueba(aut))
  if (autEsDePrueba) {
    solicitudesCorreccion.borrables.push(d)
  } else {
    // La otorgo un admin REAL (o su folio no es de prueba): borrar la
    // solicitud dejaria esa autorizacion apuntando a un solicitudId muerto.
    solicitudesCorreccion.dudosos.push(d)
  }
}

const autorizaciones = { borrables: [], dudosos: [] }
for (const d of autorizacionesPorUid) {
  const aut = d.data()
  if (!(await esDePrueba(aut))) {
    autorizaciones.dudosos.push(d)
    continue
  }
  const solSnap = aut.solicitudId ? await db.collection('solicitudesCorreccion').doc(aut.solicitudId).get() : null
  if (!solSnap || !solSnap.exists) {
    // La solicitud que la origino ya no existe (limpieza anterior, o dato
    // incompleto): la autorizacion se borra sola.
    autorizaciones.borrables.push(d)
    continue
  }
  const sol = solSnap.data()
  const solEsDePrueba = uids.includes(sol.pedidoPorUid) && (await esDePrueba(sol))
  autorizaciones[solEsDePrueba ? 'borrables' : 'dudosos'].push(d)
}

// tareas: desde que las reglas exigen la marca, una tarea con esPrueba:true
// SOLO la pudo crear una cuenta de prueba (y una real no puede ponersela), asi
// que la marca sola ya alcanza. Se conserva el criterio por destinatario para
// las tareas creadas ANTES de ese cambio: si quedo asignada a una persona
// REAL, borrarla le quitaria su plan de trabajo sin avisarle.
const tareasEncontradas = await buscarPorUid('tareas', 'creadoPorUid')
const tareasBorrables = tareasEncontradas.filter((d) => {
  const t = d.data()
  if (t.esPrueba === true) return true
  return !t.asignadoAUid || uids.includes(t.asignadoAUid)
})
const tareasDudosas = tareasEncontradas.filter((d) => {
  const t = d.data()
  if (t.esPrueba === true) return false
  const a = t.asignadoAUid
  return a && !uids.includes(a)
})

// Las remisiones van aparte: son la fuente de verdad del folio interno.
//
// Una remision MARCADA (esPrueba:true) nacio en el consecutivo de pruebas
// (config/folioInternoPrueba), asi que borrarla no le abre ningun hueco a la
// numeracion oficial en papel: esas se pueden barrer sin pensarlo. Las que
// NO traen la marca son de antes del cambio de reglas y salieron del
// consecutivo OFICIAL: esas siguen conservandose salvo que se pida
// explicitamente, porque borrarlas deja un salto que el papa de Roberto ya
// tiene anotado en papel.
const remisiones = await buscarPorUid('pdfsGenerados', 'operadorUid')
const remisionesPurasDePrueba = remisiones.filter((d) => {
  const r = d.data()
  if (r.esPrueba === true) return true
  return (r.folios || []).length > 0 && (r.folios || []).every(esFolioDePrueba)
})
const remisionesDelConsecutivoOficial = remisiones.filter((d) => d.data().esPrueba !== true)

// El portal de la maquila de prueba se borra por RUTA, que es como esta
// aislado, en vez de rastrear campo por campo. recursiveDelete baja tambien
// las subcolecciones (acuses, avios, tareasEnsamble y sus techPackChunks).
const rutasPortal = idsMaquilaPrueba.map((id) => db.collection('portalMaquila').doc(id))

// foliosRuteo SI guarda quien lo subio (cargadoPorUid, lo escribe
// src/utils/cargarRuteo.js y lo exige firestore.rules) -- pero JAMAS se
// borra: es el ruteo vigente de TODA la planta, no el rastro de una carga ya
// aplicada. Si aparece algo aqui, hay que volver a cargar el Excel bueno; el
// registro se pisa solo con la carga siguiente.
const foliosRuteoDudosos = await buscarPorUid('foliosRuteo', 'cargadoPorUid')

// Los APARTADOS de ordenes de trabajo del mundo de prueba. Su ID lleva el
// prefijo 'zz_' justamente para poder barrerlos sin tocar los reales: la orden
// 7887 es la misma cadena en los dos mundos, y sin ese prefijo el ensayo de la
// demo y la orden de verdad compartirian documento. Las reglas prohiben
// borrarlos desde el cliente (una orden liberada tiene que dejar rastro), asi
// que este script con llave de servicio es la unica via para limpiarlos.
const apartadosPrueba = (await db.collection('otsAsignadas').get()).docs.filter(
  (d) => d.id.startsWith('zz_') || d.data().esPrueba === true
)

// ---------------------------------------------------------------------------
// 2.5 Maquilas REALES: demo_almacen puede mandar material o mover inventario
// de CUALQUIER maquila, y demo_tareas/demo_admin pueden encargarle una tarea
// de ensamble (con Tech Pack) a cualquiera -- esas reglas no exigen que el
// destino sea la maquila de prueba. Se recorre maquila por maquila (son
// pocas, ver conteo real: 6 al momento de escribir esto) y NUNCA con
// collectionGroup: un where sobre estos campos exigiria indices de grupo que
// no estan creados y tronaria en tiempo de ejecucion.
// ---------------------------------------------------------------------------
const maquilasSnap = await db.collection('maquilas').get()
const maquilasReales = maquilasSnap.docs.filter((d) => !idsMaquilaPrueba.includes(d.id))

/** Documentos de portalMaquila/{maquilaId}/{coleccion} cuyo `campo` sea de
 *  alguna cuenta de prueba, para TODAS las maquilas reales. Solo se LISTAN:
 *  los saldos de avios son una cadena encadenada y un Tech Pack de un pedido
 *  real no se puede tocar a la ligera, asi que esto se corrige a mano. */
async function buscarEnPortalesReales(coleccion, campo) {
  const encontrados = []
  for (const m of maquilasReales) {
    for (let i = 0; i < uids.length; i += 10) {
      const lote = uids.slice(i, i + 10)
      const snap = await db
        .collection('portalMaquila')
        .doc(m.id)
        .collection(coleccion)
        .where(campo, 'in', lote)
        .get()
      snap.docs.forEach((d) => encontrados.push({ maquilaId: m.id, doc: d }))
    }
  }
  return encontrados
}

// enviosAvios/movimientosAvios: los crea quien puede manejar avios
// (demo_almacen), sin restriccion de que la maquila destino sea de prueba.
const enviosAviosReales = await buscarEnPortalesReales('enviosAvios', 'enviadoPorUid')
const movimientosAviosReales = await buscarEnPortalesReales('movimientosAvios', 'hechoPorUid')
// solicitudesAvios/discrepanciasAvios: SOLO la maquila (esMaquilaDe) las
// crea, asi que pedidoPorUid/comentarioMaquila siempre son de la maquila
// real -- pero almacen las RESUELVE (resueltoPorUid) y ahi si puede
// colarse una cuenta de prueba en el portal de una maquila real.
const solicitudesAviosResueltas = await buscarEnPortalesReales('solicitudesAvios', 'resueltoPorUid')
const discrepanciasAviosResueltas = await buscarEnPortalesReales('discrepanciasAvios', 'resueltoPorUid')
// tareasEnsamble: solo quien puede crear tareas (demo_tareas, demo_admin),
// tampoco restringido a la maquila de prueba.
const tareasEnsambleReales = await buscarEnPortalesReales('tareasEnsamble', 'creadoPorUid')
// salidas no tiene un campo de uid propio (solo `emitidaPorNombre`, texto
// libre): se cruza por ID, porque el ID del doc en salidas es el MISMO ID
// que su remision en pdfsGenerados (firestore.rules, salidaPortalValida:
// "request.resource.data.registroId == registroId"), y esas remisiones ya
// se identificaron arriba (`remisiones`).
const idsRemisionesDePrueba = new Set(remisiones.map((d) => d.id))
const salidasReales = []
// Sin remisiones de prueba no hay nada que cruzar: se evita leer TODO
// 'salidas' de cada maquila real (esa subcoleccion crece sin limite con la
// operacion normal, y no tiene un where util para acotarla).
if (idsRemisionesDePrueba.size > 0) {
  for (const m of maquilasReales) {
    const snap = await db.collection('portalMaquila').doc(m.id).collection('salidas').get()
    snap.docs.forEach((d) => {
      if (idsRemisionesDePrueba.has(d.id)) salidasReales.push({ maquilaId: m.id, doc: d })
    })
  }
}

// acusesAvios y acuses NO se revisan aqui a proposito: las reglas solo dejan
// crearlos a esMaquilaDe(maquilaId) (la maquila firma con SU PROPIO uid), y
// una cuenta de prueba nunca tiene el maquilaId de una maquila real -- no
// hay forma de que esos dos aparezcan firmados por una cuenta de prueba en
// el portal de una maquila real.

// ---------------------------------------------------------------------------
// 3. Enseñar el inventario
// ---------------------------------------------------------------------------
console.log('\nSE BORRA:')
// El total del ensayo SOLO cuenta lo que EJECUTAR=1 con estas banderas de
// verdad borraria: si BORRAR_PDFS/BORRAR_CUENTAS no estan puestas, sumarlas
// aqui es mentirle al usuario sobre cuanto va a pasar.
let total =
  bultosBorrables.length +
  cambiosCaptura.borrables.length +
  solicitudesCorreccion.borrables.length +
  autorizaciones.borrables.length +
  tareasBorrables.length
console.log(`  ${String(bultosBorrables.length).padStart(5)}  bultos con folio ${PREFIJO_PRUEBA}* (bultos)`)
console.log(`  ${String(cambiosCaptura.borrables.length).padStart(5)}  renglones de bitacora con folio ${PREFIJO_PRUEBA}* (cambiosCaptura)`)
console.log(`  ${String(solicitudesCorreccion.borrables.length).padStart(5)}  solicitudes de correccion de prueba (solicitudesCorreccion)`)
console.log(`  ${String(autorizaciones.borrables.length).padStart(5)}  autorizaciones de prueba (autorizaciones)`)
console.log(`  ${String(tareasBorrables.length).padStart(5)}  tareas sin asignar o asignadas a cuentas de prueba (tareas)`)
if (borrarPdfs) {
  total += remisionesPurasDePrueba.length
  console.log(`  ${String(remisionesPurasDePrueba.length).padStart(5)}  remisiones de puros folios de prueba (pdfsGenerados)`)
}
if (borrarCuentas) {
  total += uids.length + idsMaquilaPrueba.length
  console.log(`  ${String(uids.length).padStart(5)}  cuentas de prueba (usuarios + Auth)`)
  console.log(`  ${String(idsMaquilaPrueba.length).padStart(5)}  maquila(s) de prueba en el catalogo (maquilas)`)
}
if (rutasPortal.length) {
  console.log(`      1+  portal completo de: ${idsMaquilaPrueba.join(', ')}  (cantidad no contada en el total)`)
}
if (apartadosPrueba.length) {
  total += apartadosPrueba.length
  console.log(`  ${String(apartadosPrueba.length).padStart(5)}  apartados de ordenes de trabajo del mundo de prueba (otsAsignadas)`)
}

console.log('\nSE LISTA PERO NO SE BORRA (decide tu):')
console.log(`  ${String(cargasRuteoDudosas.length).padStart(5)}  registros de carga de Excel firmados por una cuenta de prueba (cargasRuteo)`)
if (cargasRuteoDudosas.length) {
  console.log('         (no revierte el ruteo: solo borra el rastro para repararlo a mano)')
}

console.log(`\n  ${String(aviosDudosos.length).padStart(5)}  avios tocados por una cuenta de prueba (avios)`)
aviosDudosos.slice(0, 30).forEach(({ doc: d, alta, edicion }) => {
  const etiqueta = alta && edicion ? 'alta + edicion' : alta ? 'alta' : 'edicion'
  console.log(`         ${d.id.padEnd(18)} ${etiqueta}`)
})
if (aviosDudosos.length > 30) console.log(`         ...y ${aviosDudosos.length - 30} mas`)
if (aviosDudosos.length) {
  console.log('         (borrar la clave del catalogo puede dejar movimientos e inventario')
  console.log('          apuntando a un codigo inexistente: se corrige a mano)')
}

console.log(`\n  ${String(foliosRuteoDudosos.length).padStart(5)}  folios de ruteo cargados por una cuenta de prueba (foliosRuteo)`)
if (foliosRuteoDudosos.length) {
  console.log('         Es el ruteo VIGENTE de toda la planta: NO se borra. Vuelve a cargar el Excel bueno.')
}

if (enviosAviosReales.length || movimientosAviosReales.length || solicitudesAviosResueltas.length ||
    discrepanciasAviosResueltas.length || tareasEnsambleReales.length || salidasReales.length) {
  console.log('\n  Escrituras de cuentas de prueba en el portal de MAQUILAS REALES (se corrige a mano):')
  const listarPortal = (docs, etiqueta) => {
    if (!docs.length) return
    console.log(`    ${String(docs.length).padStart(5)}  ${etiqueta}`)
    docs.slice(0, 20).forEach(({ maquilaId, doc: d }) => console.log(`           ${maquilaId.padEnd(18)} ${d.id}`))
    if (docs.length > 20) console.log(`           ...y ${docs.length - 20} mas`)
  }
  listarPortal(enviosAviosReales, 'envios de material (enviosAvios) -- ajustar con un movimiento de ajuste')
  listarPortal(movimientosAviosReales, 'movimientos de inventario (movimientosAvios) -- ajustar con un movimiento de ajuste')
  listarPortal(solicitudesAviosResueltas, 'solicitudes de avios resueltas (solicitudesAvios)')
  listarPortal(discrepanciasAviosResueltas, 'discrepancias resueltas (discrepanciasAvios)')
  listarPortal(tareasEnsambleReales, 'tareas de ensamble (tareasEnsamble) -- cerrar/cancelar la tarea, no borrar')
  listarPortal(salidasReales, 'remisiones de prueba mandadas a una maquila real (salidas)')
}

console.log(`\n  ${String(bultosDudosos.length).padStart(5)}  bultos firmados por una cuenta de prueba pero SIN el prefijo`)
bultosDudosos.slice(0, 30).forEach((d) => {
  const b = d.data()
  console.log(`         ${d.id.padEnd(18)} ${b.codigo || '(sin codigo)'}  ${b.pesoGramos ?? '?'} g`)
})
if (bultosDudosos.length > 30) console.log(`         ...y ${bultosDudosos.length - 30} mas`)
if (bultosDudosos.length) {
  console.log('         (o son capturas de prueba sin el prefijo, o son bultos REALES que')
  console.log('          una cuenta de prueba edito y quedaron firmados por ella)')
}

/** Misma idea que arriba, para las colecciones que se filtran por `folio`. */
function listarDudososPorFolio(docs, etiqueta) {
  console.log(`\n  ${String(docs.length).padStart(5)}  ${etiqueta} con folio que NO es de prueba (o sin folio)`)
  docs.slice(0, 30).forEach((d) => {
    console.log(`         ${d.id.padEnd(18)} folio: ${d.data().folio || '(sin folio)'}`)
  })
  if (docs.length > 30) console.log(`         ...y ${docs.length - 30} mas`)
}

listarDudososPorFolio(cambiosCaptura.dudosos, 'renglones de bitacora (cambiosCaptura)')

/** Para solicitudesCorreccion/autorizaciones: dudosa porque el folio/registro
 *  no es puro de prueba, O porque el PAR solicitud+autorizacion no es
 *  clasificable entero (lo otorgo/pidio alguien real) -- ver el porque junto
 *  a esDePrueba() y el emparejamiento, arriba. */
function listarDudosasCorreccion(docs, etiqueta) {
  console.log(`\n  ${String(docs.length).padStart(5)}  ${etiqueta}`)
  docs.slice(0, 30).forEach((d) => {
    const dato = d.data()
    console.log(`         ${d.id.padEnd(18)} tipo: ${String(dato.tipo).padEnd(12)} folio: ${dato.folio || '(sin folio)'}`)
  })
  if (docs.length > 30) console.log(`         ...y ${docs.length - 30} mas`)
}

listarDudosasCorreccion(solicitudesCorreccion.dudosos, 'solicitudes de correccion dudosas (solicitudesCorreccion)')
listarDudosasCorreccion(autorizaciones.dudosos, 'autorizaciones dudosas (autorizaciones)')

console.log(`\n  ${String(tareasDudosas.length).padStart(5)}  tareas creadas por una cuenta de prueba pero asignadas a alguien real`)
tareasDudosas.slice(0, 30).forEach((d) => {
  const t = d.data()
  console.log(`         ${d.id.padEnd(18)} asignada a: ${t.asignadoANombre || t.asignadoAUid || '(?)'}`)
})
if (tareasDudosas.length > 30) console.log(`         ...y ${tareasDudosas.length - 30} mas`)

console.log(`\n  ${String(remisiones.length).padStart(5)}  remisiones emitidas (pdfsGenerados)`)
if (remisiones.length) {
  const info = remisiones
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Number(a.folioInterno || 0) - Number(b.folioInterno || 0))
  info.forEach((r) => {
    const puras = (r.folios || []).length > 0 && (r.folios || []).every(esFolioDePrueba)
    const consecutivo = r.esPrueba === true ? 'consecutivo de PRUEBAS' : '⚠ consecutivo OFICIAL'
    console.log(
      `         folio interno ${String(r.folioInterno ?? '?').padStart(5)}  ` +
        `${String(r.maquila?.nombre || r.maquila?.id || '?').padEnd(28)} ` +
        `${String((r.folios || []).length).padStart(3)} folio(s)  ` +
        `${puras ? 'todos de prueba' : '⚠ TRAE FOLIOS REALES'}  ${consecutivo}`
    )
  })
  if (remisionesDelConsecutivoOficial.length) {
    console.log(
      `\n         ⚠ ${remisionesDelConsecutivoOficial.length} de ellas salieron del consecutivo OFICIAL ` +
        '(son anteriores a la separacion de contadores).'
    )
    console.log('         Esos numeros ya se quemaron: el contador solo sube y no se rebobina.')
    console.log('         Anotalos como saltos y avisale a quien lleva la numeracion en papel.')
  }
  const marcadas = remisiones.length - remisionesDelConsecutivoOficial.length
  if (marcadas) {
    console.log(
      `\n         ${marcadas} salieron del consecutivo de PRUEBAS: esas no le abrieron ningun ` +
        'hueco a la numeracion oficial.'
    )
  }
}

if (!ejecutar) {
  const banderas = `EJECUTAR=1${borrarPdfs ? ' BORRAR_PDFS=1' : ''}${borrarCuentas ? ' BORRAR_CUENTAS=1' : ''}`
  console.log(`\n== ENSAYO: no se borro nada (${total} documento(s) con ${banderas}) ==`)
  if (rutasPortal.length) {
    console.log(`   (+ el portal completo de ${idsMaquilaPrueba.join(', ')}: cantidad no contada arriba)`)
  }
  console.log('Para aplicarlo:  EJECUTAR=1 node scripts/limpiar_datos_prueba.mjs')
  if (remisionesPurasDePrueba.length) {
    console.log(`Para borrar tambien las ${remisionesPurasDePrueba.length} remision(es) de puros folios de prueba: agrega BORRAR_PDFS=1`)
  }
  console.log('Para dejar las cuentas apagadas hasta la proxima prueba: agrega APAGAR=1')
  console.log('Para borrarlas del todo (cuentas + maquila ficticia): agrega BORRAR_CUENTAS=1')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 4. Borrar
// ---------------------------------------------------------------------------
/** Borra en lotes de 400: el tope por request es de 500 operaciones. */
async function borrar(docs, que) {
  if (!docs.length) return
  for (let i = 0; i < docs.length; i += 400) {
    const lote = db.batch()
    docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref))
    await lote.commit()
  }
  console.log(`  borrados ${docs.length} ${que}`)
}

await borrar(bultosBorrables, `bultos ${PREFIJO_PRUEBA}*`)
await borrar(cambiosCaptura.borrables, `renglones de bitacora con folio ${PREFIJO_PRUEBA}* (cambiosCaptura)`)
// La autorizacion se borra ANTES que su solicitud: si el proceso se cortara
// entre las dos, es preferible una solicitud "aprobada" con la autorizacion
// ya consumida (estado normal despues de aplicarla) que una autorizacion
// viva apuntando a un solicitudId que ya no existe.
await borrar(autorizaciones.borrables, 'autorizaciones de prueba (autorizaciones)')
await borrar(solicitudesCorreccion.borrables, 'solicitudes de correccion de prueba (solicitudesCorreccion)')
await borrar(tareasBorrables, 'tareas sin asignar o asignadas a cuentas de prueba (tareas)')

if (borrarPdfs) {
  const conFoliosReales = remisiones.length - remisionesPurasDePrueba.length
  if (conFoliosReales > 0) {
    console.log(
      `  ${conFoliosReales} remision(es) NO se borran: llevan folios reales dentro. ` +
        'Borrarlas dejaria esos bultos marcados como "ya enviados" apuntando a un PDF que ya no existe.'
    )
  }
  await borrar(remisionesPurasDePrueba, 'remisiones de prueba (pdfsGenerados)')
} else if (remisiones.length) {
  console.log(`  ${remisiones.length} remision(es) conservadas (usa BORRAR_PDFS=1 si de verdad las quieres fuera)`)
}

for (const ref of rutasPortal) {
  await db.recursiveDelete(ref)
  console.log(`  vaciado el portal de ${ref.id}`)
}

// Los apartados de prueba. Van DESPUES del portal: si se borraran antes, las
// tareas de prueba todavia vivas quedarian un instante sin su apartado.
if (apartadosPrueba.length) {
  for (const d of apartadosPrueba) {
    await d.ref.delete()
  }
  console.log(`  ${apartadosPrueba.length} apartado(s) de orden de trabajo liberados (otsAsignadas)`)
}

// ---------------------------------------------------------------------------
// 5. Las cuentas
// ---------------------------------------------------------------------------
// Apagar es lo normal entre prueba y prueba: mantiene el uid, y con el la
// atribucion historica de lo que quedo sin borrar. Borrarlas y recrearlas
// cambia el uid y deja documentos firmados por una cuenta que ya no existe.
if (borrarCuentas) {
  for (const uid of uids) {
    const p = porUid.get(uid) || {}
    await auth.deleteUser(uid).catch((err) => {
      if (err.code !== 'auth/user-not-found') throw err
    })
    await db.collection('usuarios').doc(uid).delete()
    console.log(`  cuenta borrada: ${p.empleadoId || uid}`)
  }
  for (const id of idsMaquilaPrueba) {
    await db.collection('maquilas').doc(id).delete()
    console.log(`  maquila de prueba borrada del catalogo: ${id}`)
  }
  console.log('\n(el Excel de cuentas conserva sus filas: corre actualizar_excel_cuentas.mjs para regenerarlo)')
} else if (apagar) {
  for (const uid of uids) {
    const p = porUid.get(uid) || {}
    await auth.updateUser(uid, { disabled: true })
    await db.collection('usuarios').doc(uid).set({ activo: false }, { merge: true })
    console.log(`  apagada: ${p.empleadoId || uid}`)
  }
  // La maquila ficticia se apaga tambien: asi sale del selector de destinos
  // y nadie le manda una remision de verdad entre prueba y prueba.
  for (const id of idsMaquilaPrueba) {
    await db.collection('maquilas').doc(id).set({ activo: false }, { merge: true })
    console.log(`  maquila de prueba fuera del selector: ${id}`)
  }
  console.log('\nPara volver a encenderlas:  EJECUTAR=1 node scripts/crear_usuarios_prueba.mjs')
} else {
  console.log('\nLas cuentas siguen encendidas. Para apagarlas hasta la proxima prueba: APAGAR=1')
}

console.log(`
${'='.repeat(70)}
Lo que este script NO limpio, porque no puede:
  - El folio interno consumido por cada remision de prueba. Solo sube.
  - El ruteo del dia (foliosRuteo, config/ruteoEstado): foliosRuteo SI guarda
    quien lo subio (cargadoPorUid), pero es el ruteo VIGENTE de toda la
    planta -- no es un rastro, es el dato real. Si una cuenta de prueba lo
    cargo (se listo arriba si aparecio algo), vuelve a cargar el Excel bueno;
    la carga siguiente lo pisa sola.
  - Movimientos e inventario de avios en maquilas REALES: los saldos son una
    cadena encadenada (saldo antes/despues) y quitar un eslabon la rompe.
    Eso se corrige con un movimiento de ajuste, no borrando (se listo arriba
    si una cuenta de prueba toco el portal de una maquila real).
  - Tareas de ensamble y Tech Pack en el portal de una maquila REAL: se
    cierran o cancelan a mano, no se borran (se listo arriba si aplica).
  - Cualquier PDF que ya se haya impreso o mandado.
${'='.repeat(70)}`)

process.exit(0)
