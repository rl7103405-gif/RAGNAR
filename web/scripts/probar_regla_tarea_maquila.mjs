/**
 * ¿PUEDE LINDBERGH DE VERDAD ENCARGARLE UNA TAREA A UNA MAQUILA?
 *
 * 2026-09-10: Lindbergh reporto que "no tiene permisos para subir tareas a
 * las maquilas", y en produccion hay CERO tareas de ensamble en las seis
 * maquilas. Su perfil SI trae rol 'completo', activo y puedeCrearTareas:true,
 * asi que leerlo no basta: hay que EJECUTAR la regla.
 *
 * Esto la corre contra el motor real de Firebase (API firebaserules :test),
 * sin emulador y SIN escribir nada, con el perfil REAL de Lindbergh y una
 * maquila REAL. Mide ademas el margen contra el tope de 1,000 expresiones
 * por peticion, que es lo que tumbo la primera asignacion de diseno el 9-sep
 * y se ve identico a un permiso negado.
 *
 * Uso (en web/):  node scripts/probar_regla_tarea_maquila.mjs
 *                 MARGEN=1 node scripts/probar_regla_tarea_maquila.mjs
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
const T = '2026-09-10T18:00:00Z'
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
const LINEAS = RULES.split('\n')

const cfg = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'))
if (!cfg.tokens?.access_token || cfg.tokens.expires_at < Date.now()) {
  console.error('token del CLI vencido: corre `firebase projects:list` y reintenta'); process.exit(1)
}

const plano = (v) => {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(plano)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plano(x)]))
  return v
}
const doc = (d) => ({ data: d })
const mGet = (p, d) => ({ function: 'get', args: [{ exactValue: p }], result: { value: doc(d) } })
const mAfter = (p, d) => ({ function: 'getAfter', args: [{ exactValue: p }], result: { value: doc(d) } })
const mExists = (p, si = true) => ({ function: 'exists', args: [{ exactValue: p }], result: { value: si } })

// ---------- datos REALES (solo lectura)
const lin = (await db.collection('usuarios').where('empleadoId', '==', 'lindbergh').limit(1).get()).docs[0]
if (!lin) { console.error('no esta el perfil de lindbergh'); process.exit(1) }
const LIN = { uid: lin.id, ...plano(lin.data()) }
const maq = (await db.collection('maquilas').doc('hugo_martinez').get())
const MAQ = plano(maq.data())
console.log('Lindbergh:', LIN.uid, '| rol:', LIN.rol, '| activo:', LIN.activo, '| puedeCrearTareas:', LIN.puedeCrearTareas, '| maquilaId:', LIN.maquilaId ?? '(ninguno)')
console.log('Maquila  : hugo_martinez |', MAQ.nombre, '| activo:', MAQ.activo, '| esPrueba:', MAQ.esPrueba ?? false, '\n')

const P_PERFIL = DBPATH + '/usuarios/' + LIN.uid
const P_MAQ = DBPATH + '/maquilas/hugo_martinez'
const TAREA_ID = 'TAREAPRUEBA01'
const P_TAREA = DBPATH + '/portalMaquila/hugo_martinez/tareasEnsamble/' + TAREA_ID
// hex de la OT, como lo arma la regla: ot.toUtf8().toHexString().lower()
const hexOt = (ot) => Buffer.from(ot, 'utf8').toString('hex').toLowerCase()

const base = {
  maquilaId: 'hugo_martinez',
  titulo: 'PRUEBA - 3 PACK CALCETIN CABALLERO',
  renglones: [{ codigo: '6813-K', descripcion: 'CALCETIN CABALLERO', cantidad: 30, unidad: 'docenas' }],
  notas: '',
  estado: 'preparando',
  techPack: null,
  publicadaEn: null,
  creadoPorUid: LIN.uid,
  creadoPorNombre: LIN.nombreCompleto,
  creadoEn: T,
  terminadaEn: null,
  terminadaPorUid: null,
  terminadaPorNombre: null,
  techPackBorradoEn: null
}
const conOt = { ...base, ot: '7922', destino: 'Optima RA Enero', fechaRequerida: '2026-09-20' }
const APARTADO = { asignaciones: { hugo_martinez: TAREA_ID } }

const perfilMocks = [mExists(P_PERFIL), mGet(P_PERFIL, (({ uid, ...r }) => r)(LIN))]
// El perfil REAL de la maquila y el de quien sube chunks, para medir las dos
// reglas que hoy fallan: "Ya empece" (Hugo) y pegar el tech pack (Lindbergh).
const hugoSnap = (await db.collection('usuarios').where('empleadoId', '==', 'hugo_martinez').limit(1).get()).docs[0]
const HUGO_UID = hugoSnap.id
const HUGO = plano(hugoSnap.data())
const P_HUGO = DBPATH + '/usuarios/' + HUGO_UID
const hugoMocks = [mExists(P_HUGO), mGet(P_HUGO, HUGO), mExists(P_MAQ), mGet(P_MAQ, MAQ)]
console.log('Hugo     :', HUGO_UID, '| rol:', HUGO.rol, '| maquilaId:', HUGO.maquilaId, '| activo:', HUGO.activo)

const ESCENARIOS = {
  'sin-ot': {
    que: 'Lindbergh crea un BORRADOR de tarea, sin orden de trabajo',
    request: { auth: { uid: LIN.uid }, method: 'create', path: P_TAREA, time: T, resource: doc(base) },
    functionMocks: [...perfilMocks, mGet(P_MAQ, MAQ)]
  },
  'con-ot': {
    que: 'Lindbergh crea la tarea TRAYENDO la OT 7922 del plan (aparta la OT en el mismo lote)',
    request: { auth: { uid: LIN.uid }, method: 'create', path: P_TAREA, time: T, resource: doc(conOt) },
    functionMocks: [...perfilMocks, mGet(P_MAQ, MAQ), mAfter(DBPATH + '/otsAsignadas/' + hexOt('7922'), APARTADO)]
  },
  'fecha-con-ot': {
    que: 'Lindbergh le pone la fecha "para cuando" a una tarea que SI trae OT',
    request: { auth: { uid: LIN.uid }, method: 'update', path: P_TAREA, time: T,
      resource: doc({ ...conOt, estado: 'abierta', publicadaEn: T, fechaRequerida: '2026-09-25',
        fechaRequeridaCambiadaEn: T, fechaRequeridaCambiadaPorUid: LIN.uid, fechaRequeridaCambiadaPorNombre: LIN.nombreCompleto }) },
    resource: doc({ ...conOt, estado: 'abierta', publicadaEn: T }),
    functionMocks: [...perfilMocks, mGet(P_MAQ, MAQ)]
  },
  'cancelar-con-ot': {
    que: 'Lindbergh CANCELA una tarea que trae OT (hoy se queda atorada para siempre)',
    request: { auth: { uid: LIN.uid }, method: 'update', path: P_TAREA, time: T,
      resource: doc({ ...conOt, estado: 'cancelada', publicadaEn: T, terminadaEn: T, terminadaPorUid: LIN.uid, terminadaPorNombre: LIN.nombreCompleto }) },
    resource: doc({ ...conOt, estado: 'abierta', publicadaEn: T }),
    functionMocks: [...perfilMocks, mGet(P_MAQ, MAQ)]
  },
  'cerrar-iniciada-con-ot': {
    que: 'Lindbergh CIERRA una tarea que la maquila ya empezo y que trae OT (libera el apartado)',
    request: { auth: { uid: LIN.uid }, method: 'update', path: P_TAREA, time: T,
      resource: doc({ ...conOt, estado: 'terminada', publicadaEn: T,
        iniciadaEn: T, iniciadaPorUid: 'MAQUILAUID', iniciadaPorNombre: 'Hugo Martinez',
        terminadaEn: T, terminadaPorUid: LIN.uid, terminadaPorNombre: LIN.nombreCompleto }) },
    resource: doc({ ...conOt, estado: 'iniciada', publicadaEn: T,
      iniciadaEn: T, iniciadaPorUid: 'MAQUILAUID', iniciadaPorNombre: 'Hugo Martinez' }),
    functionMocks: [...perfilMocks, mGet(P_MAQ, MAQ),
      { function: 'existsAfter', args: [{ exactValue: DBPATH + '/otsAsignadas/' + hexOt('7922') }], result: { value: false } }]
  },
  'maquila-empieza': {
    que: 'HUGO pica "Ya empece" en una tarea con OT',
    request: { auth: { uid: HUGO_UID }, method: 'update', path: P_TAREA, time: T,
      resource: doc({ ...conOt, estado: 'iniciada', publicadaEn: T, iniciadaEn: T, iniciadaPorUid: HUGO_UID, iniciadaPorNombre: HUGO.nombreCompleto }) },
    resource: doc({ ...conOt, estado: 'abierta', publicadaEn: T }),
    functionMocks: hugoMocks
  },
  'maquila-termina': {
    que: 'HUGO declara terminada la tarea',
    request: { auth: { uid: HUGO_UID }, method: 'update', path: P_TAREA, time: T,
      resource: doc({ ...conOt, estado: 'declarada', publicadaEn: T, iniciadaEn: T, iniciadaPorUid: HUGO_UID, iniciadaPorNombre: HUGO.nombreCompleto, declaradaEn: T, declaradaPorUid: HUGO_UID, declaradaPorNombre: HUGO.nombreCompleto }) },
    resource: doc({ ...conOt, estado: 'iniciada', publicadaEn: T, iniciadaEn: T, iniciadaPorUid: HUGO_UID, iniciadaPorNombre: HUGO.nombreCompleto }),
    functionMocks: hugoMocks
  },
  'pegar-techpack': {
    que: 'LINDBERGH sube un pedazo del tech pack a la tarea (en preparando)',
    request: { auth: { uid: LIN.uid }, method: 'create', path: P_TAREA + '/techPackChunks/00', time: T,
      resource: doc({ maquilaId: 'hugo_martinez', datos: 'AAECAwQ=' }) },
    functionMocks: [...perfilMocks, mGet(P_MAQ, MAQ), mGet(P_TAREA, { ...conOt, estado: 'preparando' })]
  },
  'publicar': {
    que: 'Lindbergh PUBLICA la tarea (de borrador a abierta, que es cuando la maquila la ve)',
    request: { auth: { uid: LIN.uid }, method: 'update', path: P_TAREA, time: T, resource: doc({ ...base, estado: 'abierta', publicadaEn: T }) },
    resource: doc(base),
    functionMocks: [...perfilMocks, mGet(P_MAQ, MAQ)]
  }
}

async function correr(nombre, pad = 0) {
  const esc = ESCENARIOS[nombre]
  let rules = RULES
  if (pad) {
    const ancla = 'return yo.creaTareas\n        && mismoMundoMaquilaSegun(maquilaId, yo.esPrueba)'
    if (!rules.includes(ancla)) throw new Error('no encontre el ancla')
    const arbol = (n) => (n <= 1 ? 'true' : '(' + arbol(Math.floor(n / 2)) + ' && ' + arbol(Math.ceil(n / 2)) + ')')
    rules = rules.replace(ancla, ancla + ' && ' + arbol(pad))
  }
  const caso = { expectation: 'ALLOW', expressionReportLevel: 'FULL', request: esc.request, functionMocks: esc.functionMocks }
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
  ;(function walk(list) {
    for (const e of list || []) {
      const vals = (e.values || []).map((v) => JSON.stringify(v.value))
      if (vals.some((v) => v === 'false' || v.includes('Empty') || v.includes('error'))) malas.push({ ln: e.sourcePosition?.line, vals })
      walk(e.children)
    }
  })(res.expressionReports)
  const porLinea = new Map()
  ;(function cuenta(list) {
    for (const e of list || []) {
      const n = (e.values || []).reduce((t, v) => t + (v.count || 0), 0)
      const ln = e.sourcePosition?.line
      porLinea.set(ln, (porLinea.get(ln) || 0) + n)
      cuenta(e.children)
    }
  })(res.expressionReports)
  return { state: res.state, tope, debug, malas, porLinea }
}

let fallas = 0
for (const nombre of Object.keys(ESCENARIOS)) {
  const r = await correr(nombre)
  const ok = r.state === 'SUCCESS'
  if (!ok) fallas++
  console.log((ok ? 'SI PUEDE  ' : 'NO PUEDE  ') + nombre.padEnd(10) + ' ' + ESCENARIOS[nombre].que + (r.tope ? '   <-- SE PASO DEL TOPE DE 1000 EXPRESIONES' : ''))
  for (const m of r.debug) console.log('        debug: ' + m.slice(0, 160))
  if (!ok) {
    const top = [...r.porLinea.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
    console.log('        DONDE SE GASTA (evaluaciones por linea):')
    for (const [ln, n] of top) console.log('        ' + String(n).padStart(4) + ' x L' + ln + ': ' + (LINEAS[ln - 1] || '').trim().slice(0, 92))
    for (const m of r.malas.sort((a, b) => (a.ln || 0) - (b.ln || 0)).slice(0, 12)) {
      console.log('        L' + m.ln + ': ' + (LINEAS[m.ln - 1] || '').trim().slice(0, 100) + '  => ' + m.vals.join(','))
    }
  }
  if (process.env.MARGEN === '1' && ok && nombre.startsWith('sin') === false && nombre !== 'publicar') {
    let lo = 0, hi = 600
    while (hi - lo > 8) {
      const mid = Math.floor((lo + hi) / 2)
      let p
      try { p = await correr(nombre, mid) } catch { p = { tope: true } }
      if (p.tope || p.state !== 'SUCCESS') hi = mid; else lo = mid
    }
    console.log('        margen: aguanta ~' + lo + ' expresiones de relleno antes del tope' + (lo < 60 ? '   <-- POCO' : ''))
  }
}
console.log('\n' + (fallas ? fallas + ' escenario(s) NO PASAN' : 'los ' + Object.keys(ESCENARIOS).length + ' escenarios pasan: el permiso SI le alcanza'))
