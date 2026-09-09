/**
 * Prueba las reglas de TAREAS DE DISENO y TECH PACKS contra el MOTOR REAL de
 * reglas de Firebase (API firebaserules.googleapis.com :test), sin emulador y
 * SIN escribir nada en Firestore. Lo que el modelo en Node no puede ver:
 *   - el tope de 1,000 expresiones por peticion (asi cayo la primera
 *     asignacion de diseno el 2026-09-09: "Missing or insufficient permissions"),
 *   - que clausula exacta da false o error, con su linea.
 *
 * Uso (en web/):
 *   node scripts/probar_reglas_diseno.mjs                 <- corre los 6 escenarios
 *   node scripts/probar_reglas_diseno.mjs asig-create     <- uno solo, con detalle
 *   MARGEN=1 node scripts/probar_reglas_diseno.mjs        <- ademas mide cuantas
 *        expresiones de relleno aguanta cada regla antes de reventar el tope
 *
 * Credencial: la service account NO tiene firebaserules.rulesets.test, asi que
 * se usa el token del Firebase CLI (cuenta duena del proyecto), que se refresca
 * con cualquier `firebase ...`. Nunca se imprime.
 *
 * Datos: los perfiles demo del corral (demo_diseno / demo_disenadora), el
 * encargo de prueba que exista, y la FORMA de un tech pack real (solo lectura).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sa = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(sa) })
const db = getFirestore()
const PROJECT = sa.project_id
const DBPATH = '/databases/(default)/documents'
const T = '2026-09-09T23:00:00Z'
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
const LINEAS = RULES.split('\n')

const cfg = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'))
if (!cfg.tokens?.access_token || cfg.tokens.expires_at < Date.now()) {
  console.error('token del CLI vencido: corre `firebase projects:list` y reintenta'); process.exit(1)
}

// Timestamps de Firestore -> ISO (la API los toma como timestamp)
const plano = (v) => {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(plano)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plano(x)]))
  return v
}
const doc = (d) => ({ data: d })
const mGet = (path, d) => ({ function: 'get', args: [{ exactValue: path }], result: { value: doc(d) } })
const mAfter = (path, d) => ({ function: 'getAfter', args: [{ exactValue: path }], result: { value: doc(d) } })
const mExists = (path, si = true) => ({ function: 'exists', args: [{ exactValue: path }], result: { value: si } })

// ---------- datos reales del corral (solo lectura)
const jefaSnap = (await db.collection('usuarios').where('empleadoId', '==', 'demo_diseno').limit(1).get()).docs[0]
const equipoSnap = (await db.collection('usuarios').where('empleadoId', '==', 'demo_disenadora').limit(1).get()).docs[0]
if (!jefaSnap || !equipoSnap) { console.error('faltan las cuentas demo de diseno (crear_demo_diseno.mjs)'); process.exit(1) }
const JEFA = { uid: jefaSnap.id, ...plano(jefaSnap.data()) }
const EQUIPO = { uid: equipoSnap.id, ...plano(equipoSnap.data()) }
const encSnap = (await db.collection('encargosDiseno').where('esPrueba', '==', true).limit(1).get()).docs[0]
const ENCARGO = encSnap
  ? { ...plano(encSnap.data()), id: encSnap.id }
  : { id: 'ENCARGOPRUEBA', oc: 'PIER RESURTIDO SEP', planVersionId: 'manual', ots: ['7601', '7602'], totalOts: 2, responsableUid: JEFA.uid, responsableNombre: JEFA.nombreCompleto, estado: 'abierto', creadoPorUid: JEFA.uid, creadoPorNombre: JEFA.nombreCompleto, creadoEn: T, esPrueba: true, origen: 'manual', notas: null, fechaObjetivo: null }
const tpSnap = (await db.collection('techPacks').where('esPrueba', '==', false).limit(1).get()).docs[0]
if (!tpSnap) { console.error('no hay tech packs para tomar la forma'); process.exit(1) }
const TP_BASE = plano(tpSnap.data())

const perfilMocks = (uids) => uids.flatMap((u) => [mExists(DBPATH + '/usuarios/' + u.uid), mGet(DBPATH + '/usuarios/' + u.uid, u)])
const sellos = (u) => ({ actualizadoEn: T, actualizadoPorUid: u.uid, actualizadoPorNombre: u.nombreCompleto })
const foto = (d) => ({ asignadoAUid: d.asignadoAUid, asignadoANombre: d.asignadoANombre, estado: d.estado, codigos: d.codigos })

// ---------- la asignacion que Lety intento repartir
const OT = ENCARGO.ots[0]
const ASIG_ID = ENCARGO.id + '__' + OT
const ASIG = {
  encargoId: ENCARGO.id, oc: ENCARGO.oc, ot: OT, planVersionId: ENCARGO.planVersionId, codigos: ['1273-I', '1274-I'],
  jefeUid: ENCARGO.responsableUid, asignadoAUid: EQUIPO.uid, asignadoANombre: EQUIPO.nombreCompleto,
  asignadoPorUid: JEFA.uid, asignadoPorNombre: JEFA.nombreCompleto,
  estado: 'abierta', revision: 1, notas: null, fechaObjetivo: null, creadoEn: T, esPrueba: true
}
const ASIG2 = { ...ASIG, codigos: ['1273-I', '1274-I', '1275-I'], revision: 2, ultimaEdicionId: 'HIST0001', ...sellos(JEFA) }
const HIST_ASIG = { revision: 2, antes: foto(ASIG), despues: foto(ASIG2), motivo: null, cuando: T, quienUid: JEFA.uid, quienNombre: JEFA.nombreCompleto }

// ---------- el tech pack que Lety edita (forma real, corral de prueba)
const TP = { ...TP_BASE, codigo: 'ZZTEST-QA1', esPrueba: true, creadoPorUid: JEFA.uid, actualizadoPorUid: JEFA.uid }
delete TP.apuntaA; delete TP.datosEditables; delete TP.revision; delete TP.ultimaEdicionId
const DATOS = { modelo: 'COMBO BEIGE', talla: '20X', checklist: { pedido: 'completo', ruta: 'pendiente', etiquetas: 'no_aplica', individual: 'pendiente', bolsa: 'pendiente', caja: 'no_aplica', fotos: 'pendiente' }, checklistVersion: '2026-09-v1' }
const TP2 = { ...TP, datosEditables: DATOS, revision: 1, ultimaEdicionId: 'HIST0002', ...sellos(JEFA) }
const HIST_TP = { revision: 1, antes: {}, despues: DATOS, cuando: T, quienUid: JEFA.uid, quienNombre: JEFA.nombreCompleto }

const encargoManual = { oc: 'PRUEBA OC MANUAL', planVersionId: 'manual', ots: ['7601', '7887-A'], totalOts: 2, responsableUid: JEFA.uid, responsableNombre: JEFA.nombreCompleto, estado: 'abierto', creadoPorUid: JEFA.uid, creadoPorNombre: JEFA.nombreCompleto, creadoEn: T, esPrueba: true, origen: 'manual', notas: null, fechaObjetivo: null }

const { id: _idEnc, ...ENCARGO_DOC } = ENCARGO
const P_ENC = DBPATH + '/encargosDiseno/' + ENCARGO.id
const P_ASIG = DBPATH + '/asignacionesDiseno/' + ASIG_ID
const P_TP = DBPATH + '/techPacks/' + TP.codigo

const ESCENARIOS = {
  'asig-create': {
    que: 'la jefa reparte una OT a alguien de su equipo',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_ASIG, time: T, resource: doc(ASIG) },
    functionMocks: [...perfilMocks([JEFA, EQUIPO]), mAfter(P_ENC, ENCARGO_DOC), mGet(P_ENC, ENCARGO_DOC)],
    ancla: 'return (yo.admin || yo.jefaDiseno)\n        && asignacionDisenoValida(d)'
  },
  'asig-update': {
    que: 'la jefa corrige los codigos de una asignacion (batch con historial)',
    request: { auth: { uid: JEFA.uid }, method: 'update', path: P_ASIG, time: T, resource: doc(ASIG2) },
    resource: doc(ASIG),
    functionMocks: [...perfilMocks([JEFA, EQUIPO]), mAfter(P_ASIG + '/historial/HIST0001', HIST_ASIG), mAfter(P_ASIG, ASIG2), mGet(P_ASIG, ASIG)],
    ancla: 'return (yo.admin || (yo.jefaDiseno && antes.jefeUid == request.auth.uid))'
  },
  'asig-historial': {
    que: 'el renglon de historial de esa misma correccion',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_ASIG + '/historial/HIST0001', time: T, resource: doc(HIST_ASIG) },
    functionMocks: [...perfilMocks([JEFA, EQUIPO]), mAfter(P_ASIG, ASIG2), mGet(P_ASIG, ASIG)],
    ancla: "return (yo.admin || yo.jefaDiseno)\n        && h.keys().hasAll(['revision', 'antes', 'despues', 'cuando', 'quienUid', 'quienNombre'])"
  },
  'encargo-manual': {
    que: 'la jefa carga ordenes de trabajo a mano',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: DBPATH + '/encargosDiseno/NUEVO01', time: T, resource: doc(encargoManual) },
    functionMocks: [...perfilMocks([JEFA])],
    ancla: '&& responsableDeDisenoOk(d, yo.esPrueba);'
  },
  'techpack-datos': {
    que: 'Lety edita los datos de un tech pack (batch con historial)',
    request: { auth: { uid: JEFA.uid }, method: 'update', path: P_TP, time: T, resource: doc(TP2) },
    resource: doc(TP),
    functionMocks: [...perfilMocks([JEFA]), mAfter(P_TP + '/historial/HIST0002', HIST_TP), mAfter(P_TP, TP2), mGet(P_TP, TP)],
    ancla: 'return yo.subeTechPacks\n        && antes.esPrueba == yo.esPrueba'
  },
  'techpack-historial': {
    que: 'el renglon de historial de esa edicion',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_TP + '/historial/HIST0002', time: T, resource: doc(HIST_TP) },
    functionMocks: [...perfilMocks([JEFA]), mAfter(P_TP, TP2), mGet(P_TP, TP)],
    ancla: "return yo.subeTechPacks\n        && h.keys().hasOnly(['revision', 'antes', 'despues', 'cuando', 'quienUid', 'quienNombre'])"
  }
}

async function correr(nombre, pad = 0, detalle = false) {
  const esc = ESCENARIOS[nombre]
  let rules = RULES
  if (pad) {
    if (!rules.includes(esc.ancla)) throw new Error('no encontre el ancla de ' + nombre)
    // Arbol balanceado, no cadena plana: una cadena de 60 '&&' ya choca con el
    // limite de anidamiento del parser y eso NO es el tope de 1000.
    const arbol = (n) => n <= 1 ? 'true' : '(' + arbol(Math.floor(n / 2)) + ' && ' + arbol(Math.ceil(n / 2)) + ')'
    const relleno = ' && ' + arbol(pad)
    rules = esc.ancla.endsWith(';')
      ? rules.replace(esc.ancla, esc.ancla.slice(0, -1) + relleno + ';')
      : rules.replace(esc.ancla, esc.ancla + relleno)
  }
  const caso = { expectation: esc.expectation || 'ALLOW', expressionReportLevel: 'FULL', request: esc.request, functionMocks: esc.functionMocks }
  if (esc.resource) caso.resource = esc.resource
  const body = { source: { files: [{ name: 'firestore.rules', content: rules }] }, testSuite: { testCases: [caso] } }
  const resp = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + cfg.tokens.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error('API ' + resp.status + ': ' + JSON.stringify(data.error?.message || data).slice(0, 300))
  const res = data.testResults?.[0] || {}
  const debug = res.debugMessages || []
  const tope = debug.some((m) => /maximum of 1000/.test(m))
  const malas = []
  const porLinea = new Map()
  ;(function walk(list) {
    for (const e of list || []) {
      const vals = (e.values || []).map((v) => JSON.stringify(v.value))
      const n = (e.values || []).reduce((s, v) => s + (v.count || 0), 0)
      const ln = e.sourcePosition?.line
      porLinea.set(ln, (porLinea.get(ln) || 0) + n)
      if (vals.some((v) => v === 'false' || v.includes('Empty') || v.includes('error'))) malas.push({ ln, vals })
      walk(e.children)
    }
  })(res.expressionReports)
  return { state: res.state, tope, debug, errorPosition: res.errorPosition, malas, porLinea }
}

// ---------- mas escenarios: subir archivo, tech pack con los dos manifiestos, y los NEGATIVOS
const manifiesto = (v) => ({ nombre: 'TECH PACK ZZTEST.xlsx', formato: 'xlsx', tamano: 123456, totalChunks: 1, sha256: 'a'.repeat(64), version: v, subidoEn: T, subidoPorUid: JEFA.uid, subidoPorNombre: JEFA.nombreCompleto })
const TP_SIN = { ...TP, techPack: null, ftt: null }
const TP_SUBIDO = { ...TP_SIN, techPack: manifiesto(1), ...sellos(JEFA) }
const TP_2M = { ...TP, techPack: manifiesto(1), ftt: manifiesto(1) }
const TP_2M2 = { ...TP_2M, datosEditables: DATOS, revision: 1, ultimaEdicionId: 'HIST0002', ...sellos(JEFA) }
const JEFA_BAJA = { ...JEFA, activo: false }
const REAL_JEFA = { ...JEFA, uid: 'REALJEFA000000000000000000000', esPrueba: false, nombreCompleto: 'JEFA REAL' }
const sinResultado = (fn, path) => ({ function: fn, args: [{ exactValue: path }], result: { undefined: {} } })
Object.assign(ESCENARIOS, {
  'techpack-archivo': {
    que: 'Lety sube el archivo de un tech pack (manifiesto nuevo, version 1)',
    request: { auth: { uid: JEFA.uid }, method: 'update', path: P_TP, time: T, resource: doc(TP_SUBIDO) },
    resource: doc(TP_SIN), functionMocks: [...perfilMocks([JEFA])], ancla: ESCENARIOS['techpack-datos'].ancla
  },
  'techpack-datos-2m': {
    que: 'Lety edita datos de un tech pack que YA tiene archivo y FTT (el caso mas pesado)',
    request: { auth: { uid: JEFA.uid }, method: 'update', path: P_TP, time: T, resource: doc(TP_2M2) },
    resource: doc(TP_2M),
    functionMocks: [...perfilMocks([JEFA]), mAfter(P_TP + '/historial/HIST0002', HIST_TP), mAfter(P_TP, TP_2M2), mGet(P_TP, TP_2M)],
    ancla: ESCENARIOS['techpack-datos'].ancla
  },
  'neg-equipo-reparte': {
    expectation: 'DENY', que: 'NEG: alguien del equipo (sin puedeAsignarDiseno) intenta repartir',
    request: { auth: { uid: EQUIPO.uid }, method: 'create', path: P_ASIG, time: T, resource: doc({ ...ASIG, asignadoPorUid: EQUIPO.uid, asignadoPorNombre: EQUIPO.nombreCompleto }) },
    functionMocks: ESCENARIOS['asig-create'].functionMocks
  },
  'neg-destinataria-ajena': {
    expectation: 'DENY', que: 'NEG: la jefa se asigna la OT a si misma (no es de su equipo)',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_ASIG, time: T, resource: doc({ ...ASIG, asignadoAUid: JEFA.uid, asignadoANombre: JEFA.nombreCompleto }) },
    functionMocks: ESCENARIOS['asig-create'].functionMocks
  },
  'neg-encargo-cerrado': {
    expectation: 'DENY', que: 'NEG: repartir una OT de un encargo que queda cerrado en este batch',
    request: ESCENARIOS['asig-create'].request,
    functionMocks: [...perfilMocks([JEFA, EQUIPO]), mAfter(P_ENC, { ...ENCARGO_DOC, estado: 'cerrado' }), mGet(P_ENC, ENCARGO_DOC)]
  },
  'neg-cruce-corral': {
    expectation: 'DENY', que: 'NEG: una jefa REAL reparte sobre un encargo/equipo de PRUEBA',
    request: { auth: { uid: REAL_JEFA.uid }, method: 'create', path: P_ASIG, time: T, resource: doc({ ...ASIG, jefeUid: REAL_JEFA.uid, asignadoPorUid: REAL_JEFA.uid, asignadoPorNombre: REAL_JEFA.nombreCompleto }) },
    functionMocks: [...perfilMocks([REAL_JEFA, EQUIPO]), mAfter(P_ENC, { ...ENCARGO_DOC, responsableUid: REAL_JEFA.uid }), mGet(P_ENC, ENCARGO_DOC)]
  },
  'neg-nombre-suplantado': {
    expectation: 'DENY', que: 'NEG: la jefa firma la asignacion con otro nombre',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_ASIG, time: T, resource: doc({ ...ASIG, asignadoPorNombre: 'Roberto Linares' }) },
    functionMocks: ESCENARIOS['asig-create'].functionMocks
  },
  'neg-jefa-baja-corrige': {
    expectation: 'DENY', que: 'NEG: una jefa dada de baja (activo:false) corrige una asignacion suya',
    request: ESCENARIOS['asig-update'].request, resource: doc(ASIG),
    functionMocks: [...perfilMocks([JEFA_BAJA, EQUIPO]), mAfter(P_ASIG + '/historial/HIST0001', HIST_ASIG), mAfter(P_ASIG, ASIG2), mGet(P_ASIG, ASIG)]
  },
  'neg-corrige-sin-historial': {
    expectation: 'DENY', que: 'NEG: corregir codigos sin el renglon de historial en el batch',
    request: ESCENARIOS['asig-update'].request, resource: doc(ASIG),
    functionMocks: [...perfilMocks([JEFA, EQUIPO]), sinResultado('getAfter', P_ASIG + '/historial/HIST0001'), mAfter(P_ASIG, ASIG2), mGet(P_ASIG, ASIG)]
  },
  'neg-techpack-mixto': {
    expectation: 'DENY', que: 'NEG: un update que sube archivo Y edita datos a la vez',
    request: { auth: { uid: JEFA.uid }, method: 'update', path: P_TP, time: T, resource: doc({ ...TP2, techPack: manifiesto(1) }) },
    resource: doc(TP_SIN), functionMocks: ESCENARIOS['techpack-datos'].functionMocks
  }
})

const TP_ALIAS = { ...TP_SIN, apuntaA: 'ZZTEST-REAL' }
const TP_NUEVO = { ...TP_SIN, creadoEn: T, creadoPorNombre: JEFA.nombreCompleto, ...sellos(JEFA) }
delete TP_NUEVO.modelo; delete TP_NUEVO.talla; delete TP_NUEVO.color; delete TP_NUEVO.faltantes
Object.assign(ESCENARIOS, {
  'techpack-create': {
    que: 'Lety da de alta un codigo nuevo en la biblioteca (sin archivo aun)',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_TP, time: T, resource: doc(TP_NUEVO) },
    functionMocks: [...perfilMocks([JEFA])], ancla: 'return yo.subeTechPacks\n        && d.codigo == codigo'
  },
  'neg-alias-recibe-archivo': {
    expectation: 'DENY', que: 'NEG: subirle un archivo a un ALIAS (apuntaA)',
    request: { auth: { uid: JEFA.uid }, method: 'update', path: P_TP, time: T, resource: doc({ ...TP_ALIAS, techPack: manifiesto(1), ...sellos(JEFA) }) },
    resource: doc(TP_ALIAS), functionMocks: [...perfilMocks([JEFA])]
  },
  'neg-create-con-alias': {
    expectation: 'DENY', que: 'NEG: crear desde el cliente un documento con apuntaA',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_TP, time: T, resource: doc({ ...TP_NUEVO, apuntaA: 'ZZTEST-REAL' }) },
    functionMocks: [...perfilMocks([JEFA])]
  },
  'neg-create-nombre-falso': {
    expectation: 'DENY', que: 'NEG: dar de alta un codigo firmando el creador con otro nombre',
    request: { auth: { uid: JEFA.uid }, method: 'create', path: P_TP, time: T, resource: doc({ ...TP_NUEVO, creadoPorNombre: 'Roberto Linares' }) },
    functionMocks: [...perfilMocks([JEFA])]
  }
})

const arg = process.argv[2]
const lista = arg ? [arg] : Object.keys(ESCENARIOS)
if (arg && !ESCENARIOS[arg]) { console.error('escenarios:', Object.keys(ESCENARIOS).join(', ')); process.exit(1) }
console.log('jefa:', JEFA.uid, JEFA.nombreCompleto, '| equipo:', EQUIPO.uid, EQUIPO.nombreCompleto, '| encargo:', ENCARGO.id, ENCARGO.oc, '| tech pack forma:', tpSnap.id, '\n')
let fallas = 0
for (const nombre of lista) {
  const esc = ESCENARIOS[nombre]
  const r = await correr(nombre, 0, !!arg)
  const ok = r.state === 'SUCCESS'
  if (!ok) fallas++
  console.log((ok ? 'OK    ' : 'FALLA ') + nombre.padEnd(24) + ' ' + esc.que + (r.tope ? '  <-- TOPE DE 1000 EXPRESIONES' : ''))
  for (const m of r.debug) if (!/maximum of 1000/.test(m)) console.log('        debug: ' + m)
  if (!ok && r.errorPosition && !r.tope) console.log('        error en L' + r.errorPosition.line + ': ' + (LINEAS[r.errorPosition.line - 1] || '').trim().slice(0, 110))
  if ((!ok || arg) && !esc.expectation) {
    for (const m of r.malas.sort((a, b) => (a.ln || 0) - (b.ln || 0)).slice(0, 30)) console.log('        L' + m.ln + ': ' + (LINEAS[m.ln - 1] || '').trim().slice(0, 100) + '  => ' + m.vals.join(','))
  }
  if (arg) {
    const top = [...r.porLinea.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    console.log('        lineas mas evaluadas:')
    for (const [ln, n] of top) console.log('        ' + String(n).padStart(4) + ' x L' + ln + ': ' + (LINEAS[ln - 1] || '').trim().slice(0, 90))
  }
  if (process.env.MARGEN === '1' && ok && esc.ancla) {
    // busqueda binaria del relleno que revienta el tope: mas alto = mas margen
    let lo = 0, hi = 1024
    while (hi - lo > 4) {
      const mid = Math.floor((lo + hi) / 2)
      let p
      try { p = await correr(nombre, mid) } catch (e) { console.log('        (relleno ' + mid + ': ' + e.message.slice(0, 120) + ')'); p = { tope: true } }
      if (p.tope) hi = mid
      else if (p.state === 'SUCCESS') lo = mid
      else { console.log('        (relleno ' + mid + ' falla sin ser el tope: ' + (p.debug[0] || '').slice(0, 120) + ')'); hi = mid }
    }
    console.log('        margen: aguanta ~' + lo + ' expresiones de relleno antes del tope' + (lo < 60 ? '   <-- POCO' : ''))
  }
}
console.log('\n' + (fallas ? fallas + ' escenario(s) FALLAN' : 'los ' + lista.length + ' escenarios pasan'))
process.exit(fallas ? 1 : 0)
