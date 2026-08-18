/**
 * Sube el plan maestro a produccion COMO LO HARIA ADRIAN: con el SDK de
 * cliente, iniciando sesion con su cuenta y pasando por las reglas de
 * Firestore. Nada de Admin SDK aqui — que la subida pase por las reglas ES la
 * verificacion de que Adrian va a poder hacerlo el solo desde la app.
 *
 *   node scripts/subir_plan_maestro.mjs "../datos/plan-maestro/archivo.xlsx" usuario
 *
 * (usuario es el nombre de cuenta tal como esta en RAGNAR-CUENTAS.xlsx,
 *  p. ej. "adrian". La contraseña se lee de ese Excel, no se teclea.)
 *
 * Antes de escribir NADA corre el canario: intenta, con una cuenta de PRUEBA,
 * crear un documento del plan — si las reglas desplegadas lo permiten, se
 * aborta todo y hay que revisar el deploy. Solo si el corral aguanta se sube.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { leerPlanMaestro } from '../src/utils/importarPlanMaestro.js'
import { idDeLinea, idDePedido, resumirOcs } from '../src/utils/planMaestroNucleo.js'
import { DOMINIO, abrirLibro, encabezadosDe } from './lib/excelCuentas.mjs'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const LOTE = 400
const TOPE_RESUMEN = 500

// --- configuracion del cliente, del mismo .env que usa Vite ---
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(AQUI, '../.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
})
const auth = getAuth(app)
const db = getFirestore(app)

// --- contraseñas: del Excel de cuentas, nunca de la terminal ---
async function passwordDe(usuario) {
  const libro = await abrirLibro()
  for (const hoja of libro.worksheets) {
    const enc = encabezadosDe(hoja)
    const colU = enc.findIndex((e) => /usuario/i.test(String(e ?? '')))
    const colP = enc.findIndex((e) => /contrase/i.test(String(e ?? '')))
    if (colU < 0 || colP < 0) continue
    for (let n = 2; n <= hoja.rowCount; n++) {
      const fila = hoja.getRow(n)
      if (String(fila.getCell(colU).value ?? '').trim().toLowerCase() === usuario) {
        return String(fila.getCell(colP).value ?? '').trim()
      }
    }
  }
  return null
}

const [rutaExcel, usuario] = process.argv.slice(2)
if (!rutaExcel || !usuario) {
  console.error('Uso: node scripts/subir_plan_maestro.mjs <archivo.xlsx> <usuario>')
  process.exit(1)
}
const absoluta = path.resolve(AQUI, '..', rutaExcel)

// ---------------------------------------------------------------------------
// 1. CANARIO: una cuenta de prueba NO debe poder escribir el plan.
// ---------------------------------------------------------------------------
console.log('\n[1/4] Canario: probando que el corral aguanta...')
{
  const passPrueba = await passwordDe('demo_admin')
  if (!passPrueba) {
    console.error('No encontre demo_admin en RAGNAR-CUENTAS.xlsx; sin canario no se sube.')
    process.exit(1)
  }
  await signInWithEmailAndPassword(auth, `demo_admin@${DOMINIO}`, passPrueba)
  let seColo = false
  try {
    await setDoc(doc(db, 'planMaestroPedidos', 'CANARIO__NO_DEBE_EXISTIR'), {
      versionId: 'canario',
      pedidoClave: 'CANARIO',
      ot: '0000',
      creadoEn: serverTimestamp(),
      subidoPorUid: auth.currentUser.uid
    })
    seColo = true
  } catch (err) {
    if (err?.code === 'permission-denied') {
      console.log('   OK: la cuenta de prueba fue RECHAZADA (permission-denied).')
    } else {
      throw err
    }
  }
  await signOut(auth)
  if (seColo) {
    console.error('   ⚠️ LA CUENTA DE PRUEBA PUDO ESCRIBIR EL PLAN. Borra el documento')
    console.error('   planMaestroPedidos/CANARIO__NO_DEBE_EXISTIR y revisa el deploy de reglas.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 2. Leer el Excel con EL MISMO lector de la app.
// ---------------------------------------------------------------------------
console.log('[2/4] Leyendo el Excel...')
const buffer = fs.readFileSync(absoluta)
const { lineas, pedidos, diagnostico } = await leerPlanMaestro({
  name: path.basename(absoluta),
  arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
})
console.log(`   ${lineas.length} lineas, ${pedidos.length} pedidos, ${diagnostico.totalOcs} ordenes de compra.`)
if (!lineas.length) {
  console.error('El archivo no trajo lineas; no hay nada que subir.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Entrar como el usuario real y subir (misma logica que guardarPlanMaestro;
//    duplicada aqui solo porque src/utils/planMaestro.js arrastra
//    ../firebase/config, que exige Vite).
// ---------------------------------------------------------------------------
console.log(`[3/4] Entrando como ${usuario} y subiendo...`)
const pass = await passwordDe(usuario)
if (!pass) {
  console.error(`No encontre la contraseña de "${usuario}" en RAGNAR-CUENTAS.xlsx.`)
  process.exit(1)
}
const cred = await signInWithEmailAndPassword(auth, `${usuario}@${DOMINIO}`, pass)
const uid = cred.user.uid
// El nombre tiene que ser EXACTO al del perfil: las reglas lo comparan.
const perfilSnap = await getDoc(doc(db, 'usuarios', uid))
const nombre = String(perfilSnap.data()?.nombreCompleto || '').slice(0, 120)
if (!nombre) {
  console.error('El perfil no tiene nombreCompleto; las reglas van a rechazar la subida.')
  process.exit(1)
}

const refVersion = doc(collection(db, 'planMaestroVersiones'))
const versionId = refVersion.id

const porId = new Map()
for (const l of lineas) {
  const id = idDeLinea({ versionId, oc: l.oc, ot: l.ot, codigo: l.codigo })
  const previa = porId.get(id)
  if (previa) {
    if (typeof previa.cantidadPlaneada === 'number' && typeof l.cantidadPlaneada === 'number') {
      previa.cantidadPlaneada += l.cantidadPlaneada
    } else {
      previa.cantidadPlaneada = null
    }
    continue
  }
  porId.set(id, { ...l, versionId })
}
const entradas = [...porId.entries()]

const porPedido = new Map()
for (const p of pedidos) {
  if (!p?.pedidoClave || !p?.ot) continue
  porPedido.set(idDePedido(versionId, p.pedidoClave), {
    versionId,
    pedidoClave: p.pedidoClave,
    pedidoTexto: String(p.pedidoTexto ?? p.pedidoClave).slice(0, 200),
    ot: p.ot,
    ...(p.destino ? { destino: String(p.destino).slice(0, 120) } : {})
  })
}
// --- ACUMULATIVO: se conserva lo que el plan anterior sabia y este archivo no
// menciona. La unidad de reemplazo es la ORDEN DE TRABAJO. Sin esto, subir el
// mes que falta BORRA el que ya estaba.
const activoPrevio = await getDoc(doc(db, 'config', 'planMaestroActivo'))
const versionAnterior = activoPrevio.exists() ? activoPrevio.data().versionId : null
let heredadasLineas = 0
let heredadosPedidos = 0
if (versionAnterior) {
  console.log('   Recuperando lo que ya sabia el plan anterior...')
  const otsNuevas = new Set(entradas.map(([, l]) => l.ot))
  const pedidosNuevos = new Set([...porPedido.values()].map((p) => p.pedidoClave))
  const [snapL, snapP] = await Promise.all([
    getDocs(query(collection(db, 'planMaestroLineas'), where('versionId', '==', versionAnterior))),
    getDocs(query(collection(db, 'planMaestroPedidos'), where('versionId', '==', versionAnterior)))
  ])
  snapL.docs.forEach((d) => {
    const { versionId: _v, creadoEn: _c, subidoPorUid: _s, ...l } = d.data()
    if (!l.ot || otsNuevas.has(l.ot)) return
    const id = idDeLinea({ versionId, oc: l.oc, ot: l.ot, codigo: l.codigo })
    if (!porId.has(id)) {
      porId.set(id, { ...l, versionId })
      heredadasLineas++
    }
  })
  snapP.docs.forEach((d) => {
    const { versionId: _v, creadoEn: _c, subidoPorUid: _s, ...pd } = d.data()
    if (!pd.pedidoClave || pedidosNuevos.has(pd.pedidoClave)) return
    const id = idDePedido(versionId, pd.pedidoClave)
    if (!porPedido.has(id)) {
      porPedido.set(id, { ...pd, versionId })
      heredadosPedidos++
    }
  })
  console.log(`   Se conservan ${heredadasLineas} lineas y ${heredadosPedidos} pedidos del plan anterior.`)
}

// QUE CAMBIO: lo mismo que ensena la pantalla, para poder verificarlo desde
// aqui sin abrir el navegador.
const ocsAntes = new Set()
const ocAntesDeOt = new Map()
if (versionAnterior) {
  const snapPrev = await getDocs(
    query(collection(db, 'planMaestroLineas'), where('versionId', '==', versionAnterior))
  )
  snapPrev.docs.forEach((d) => {
    const l = d.data()
    if (l.oc) ocsAntes.add(l.oc)
    if (l.ot && l.oc && !ocAntesDeOt.has(l.ot)) ocAntesDeOt.set(l.ot, l.oc)
  })
}
const ocsDelArchivo = new Set(entradas.map(([, l]) => l.oc).filter(Boolean))
const nuevasOc = [...ocsDelArchivo].filter((o) => !ocsAntes.has(o))
const mudadas = []
const vistas = new Set()
entradas.forEach(([, l]) => {
  if (vistas.has(l.ot)) return
  vistas.add(l.ot)
  const antes = ocAntesDeOt.get(l.ot)
  if (antes && antes !== l.oc) mudadas.push(`OT ${l.ot}: ${antes} -> ${l.oc}`)
})
console.log(`   Ordenes de compra NUEVAS: ${nuevasOc.length}${nuevasOc.length ? ' (' + nuevasOc.slice(0, 8).join(', ') + ')' : ''}`)
console.log(`   Ordenes de trabajo que cambiaron de OC: ${mudadas.length}`)
mudadas.slice(0, 8).forEach((m) => console.log('     ' + m))

const entradas2 = [...porId.entries()]
const entradasPedidos = [...porPedido.entries()]

await setDoc(refVersion, {
  archivo: path.basename(absoluta).slice(0, 120),
  totalLineas: entradas2.length,
  totalPedidos: entradasPedidos.length,
  estado: 'borrador',
  subidoPorUid: uid,
  subidoPorNombre: nombre,
  creadoEn: serverTimestamp(),
  activadaEn: null
})

let escritas = 0
// entradas2, no entradas: si no, el contador muestra '450 de 80' en cuanto
// hay lineas heredadas y parece que algo trona.
const total = entradas2.length + entradasPedidos.length
for (const [coleccion, items] of [
  ['planMaestroLineas', entradas2],
  ['planMaestroPedidos', entradasPedidos]
]) {
  for (let i = 0; i < items.length; i += LOTE) {
    const lote = writeBatch(db)
    items.slice(i, i + LOTE).forEach(([id, datos]) => {
      lote.set(doc(db, coleccion, id), { ...datos, creadoEn: serverTimestamp(), subidoPorUid: uid })
    })
    await lote.commit()
    escritas += Math.min(LOTE, items.length - i)
    console.log(`   ${escritas} de ${total}...`)
  }
}

const resumen = resumirOcs(entradas2.map(([, l]) => l))
const ocs = resumen.length <= TOPE_RESUMEN ? resumen : null
const cierre = writeBatch(db)
cierre.set(
  refVersion,
  {
    estado: 'activa',
    activadaEn: serverTimestamp(),
    resumen: {
      ocsNuevas: nuevasOc.slice(0, 60),
      totalOcsNuevas: nuevasOc.length,
      totalOcsActualizadas: [...ocsDelArchivo].filter((o) => ocsAntes.has(o)).length,
      otsNuevas: [...vistas].filter((o) => !ocAntesDeOt.has(o)).length,
      otsActualizadas: [...vistas].filter((o) => ocAntesDeOt.has(o)).length,
      conservadas: heredadasLineas,
      pedidosConservados: heredadosPedidos,
      mudadas: mudadas.slice(0, 40),
      totalMudadas: mudadas.length
    }
  },
  { merge: true }
)
cierre.set(doc(db, 'config', 'planMaestroActivo'), {
  versionId,
  archivo: path.basename(absoluta).slice(0, 120),
  totalLineas: entradas2.length,
  totalPedidos: entradasPedidos.length,
  ...(ocs ? { ocs } : {}),
  activadaEn: serverTimestamp(),
  activadaPorUid: uid,
  activadaPorNombre: nombre
})
await cierre.commit()

console.log(`[4/4] LISTO. Version ${versionId} activa:`)
console.log(`   ${entradas2.length} lineas del arbol, ${entradasPedidos.length} pedidos en el diccionario,`)
console.log(`   ${resumen.length} ordenes de compra para Lindbergh.`)
await signOut(auth)
process.exit(0)
