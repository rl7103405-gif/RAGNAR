// PLAN MAESTRO DE PRODUCCION (Adrian, jefe de produccion).
//
// Es el dato que le falta a RAGNAR para armar el arbol que pidio Lindbergh en
// la junta del 17-08: hoy la app sabe que un folio pertenece a una ORDEN DE
// TRABAJO, pero no sabe de que ORDEN DE COMPRA del cliente cuelga esa OT. El
// cliente compra la OC '2449' y la fabrica la desmenuza en 27 OT (medido en el
// archivo real: la 2449 trae exactamente 27, igual que dijo Lindbergh de
// memoria); sin ese amarre "estan todas las ordenes descargadas pero no estan
// agrupadas, no tengo ese agrupador".
//
//   OC (cliente)  ->  OT (fabrica)  ->  codigo  ->  folio (bulto)
//
// EL ARCHIVO REAL (visto el 2026-08-18) trae DOS cosas de valor, no una:
//
//   1. El amarre OT -> OC. Incompleto a proposito: de 1214 OT solo 87 traen
//      OC, porque Adrian empezo a llenar esa columna en abril. En agosto ya
//      van 145 renglones con OC contra 76 sin ella. El arbol nace cubriendo
//      lo vigente y se llena solo conforme el la siga usando.
//
//   2. El DICCIONARIO pedido -> OT. Esto no lo esperabamos y vale igual o
//      mas: la columna 'NoPedido' del plan es EL MISMO texto que RAGNAR
//      recibe de America en el ruteo. Hoy la OT se adivina de ese texto con
//      otDePedido() (primeros 4 digitos) y eso falla en 863 de 3419 casos:
//      838 empiezan con 'C_' y no dan nada, y 25 del tipo
//      '7512_REPOSICION_7551' dan 7512 cuando la verdadera es 7551 — o sea
//      una OT que SI existe, que es una mentira que nadie va a notar. El plan
//      sabe cual es la buena.
//
// TRES COLECCIONES (Firestore no valida lo que va dentro de un array, y con
// arrays no se podria consultar por OT):
//
//   planMaestroVersiones/{versionId}   la subida: archivo, quien, cuando
//   planMaestroLineas/{id}             detalle: oc + ot + codigo + cantidad
//   planMaestroPedidos/{id}            diccionario: pedidoClave -> ot
//
// El diccionario va aparte del detalle A PROPOSITO. Al capturar un bulto hay
// que resolver su OT, y eso tiene que costar UNA lectura puntual por id
// determinista — no una consulta que traiga los veinte renglones del mismo
// pedido y dependa de un indice. La captura es lo que corre en la bascula con
// el operador esperando.
//
// VERSIONADO (mismo patron que catalogoVersiones): cada subida nace como
// borrador y solo al terminar se mueve el puntero de version activa. Asi nadie
// ve el plan a medio cargar, y si algo sale mal la version anterior sigue
// siendo la buena.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase/config'

export class ErrorPlanMaestro extends Error {}

/** Tope por lote de escritura: el maximo de Firestore es 500 operaciones. */
const LOTE = 400

/** Cuantas ordenes de compra caben en el resumen del puntero (lo mismo que
 *  exigen las reglas). Pasado eso, la pestana lo reconstruye leyendo. */
const TOPE_RESUMEN = 500

export const REF_ACTIVA = () => doc(db, 'config', 'planMaestroActivo')

// ---------------------------------------------------------------------------
// Normalizacion, estados de OC e identificadores
// ---------------------------------------------------------------------------
// Viven en planMaestroNucleo.js, que no importa Firebase: asi se pueden correr
// en Node contra el Excel real de Adrian sin levantar la app. Se re-exportan
// aqui para que quien ya los importaba de este archivo siga igual.
// Lo que este archivo usa por dentro se importa...
import {
  idDeLinea,
  idDePedido,
  normalizarOc,
  normalizarOt,
  normalizarPedido,
  resumirOcs
} from './planMaestroNucleo.js'

// ...y todo el nucleo se re-exporta, para que quien ya lo importaba desde aqui
// siga igual. (Un `export ... from` re-exporta pero NO define los nombres en
// este modulo: por eso hacen falta las dos lineas.)
export {
  MAX_IN,
  OC_INVALIDA,
  OC_SIN,
  OC_VALIDA,
  clasificarOc,
  idDeLinea,
  idDePedido,
  normalizarCodigo,
  normalizarOc,
  normalizarOt,
  normalizarPedido,
  resumirOcs
} from './planMaestroNucleo.js'

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** El documento del plan vigente (trae ya el resumen por OC). */
export async function planVigente() {
  const snap = await getDoc(REF_ACTIVA())
  return snap.exists() ? snap.data() : null
}

/** El versionId del plan vigente, o null si todavia no hay ninguno. */
export async function versionActiva() {
  const vigente = await planVigente()
  return vigente?.versionId || null
}

/**
 * Todas las lineas de una OC en el plan vigente.
 *
 * Se consulta por igualdad (versionId + oc), que es lo que Firestore resuelve
 * sin indice compuesto manual; el orden se hace en memoria porque son decenas
 * de lineas, no miles.
 */
export async function lineasDeOc(versionId, oc) {
  if (!versionId || !oc) return []
  const snap = await getDocs(
    query(
      collection(db, 'planMaestroLineas'),
      where('versionId', '==', versionId),
      where('oc', '==', normalizarOc(oc))
    )
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Las OC del plan vigente con sus totales.
 *
 * Sale del RESUMEN que se guardo al subir, no de recorrer las lineas: el
 * archivo real trae 3419 renglones y recalcularlo aqui costaria esas 3419
 * lecturas cada vez que alguien abre la pestana. El resumen es una sola.
 */
export async function resumenDeOcs(versionId) {
  if (!versionId) return []
  const vigente = await planVigente()
  if (vigente?.versionId === versionId && Array.isArray(vigente.ocs)) return vigente.ocs
  // La version que se pide no es la vigente (o es anterior al resumen): se
  // reconstruye leyendo, que es lento pero correcto.
  const snap = await getDocs(
    query(collection(db, 'planMaestroLineas'), where('versionId', '==', versionId))
  )
  return resumirOcs(snap.docs.map((d) => d.data()))
}

/**
 * El destino de una OT segun el plan vigente ('Modular Walmart Jun-Sep'), o ''
 * si el plan no la conoce o no hay plan. NUNCA lanza: quien crea una tarea no
 * se puede quedar bloqueado porque el plan no este subido.
 */
export async function destinoDeOt(ot) {
  const otLimpia = normalizarOt(ot)
  if (!otLimpia) return ''
  try {
    const versionId = await versionActiva()
    if (!versionId) return ''
    // ⚠️ Se piden VARIAS lineas, no una. Una OT tiene un renglon por codigo y
    // la celda 'Nom ped' puede venir llena en unas y vacia en otras. Con
    // limit(1) el resultado dependia de cual documento devolviera el indice
    // primero: si caia en la vacia, la tarea se congelaba SIN destino aunque
    // el plan si lo supiera. Un hueco de dato por casualidad de indice es
    // justo lo que este proyecto no se permite.
    const snap = await getDocs(
      query(
        collection(db, 'planMaestroLineas'),
        where('versionId', '==', versionId),
        where('ot', '==', otLimpia),
        limit(5)
      )
    )
    const conDestino = snap.docs.find((d) => d.data().destino)
    return conDestino ? String(conDestino.data().destino).slice(0, 120) : ''
  } catch (err) {
    console.warn('[PlanMaestro] No se pudo buscar el destino de la OT', otLimpia, '-', err?.message)
    return ''
  }
}

// ---------------------------------------------------------------------------
// Escritura (la sube Adrian)
// ---------------------------------------------------------------------------

/**
 * Guarda una version NUEVA del plan y la deja activa.
 *
 * Orden pensado para que nadie vea un plan a medias: (1) se crea la version en
 * 'borrador'; (2) se escriben sus lineas y su diccionario; (3) solo entonces
 * la version pasa a 'activa' y el puntero apunta a ella. Si algo se corta en
 * el camino, el puntero sigue en la version anterior y lo unico que queda es
 * un borrador huerfano, que no lo lee nadie.
 */
export async function guardarPlanMaestro({
  lineas,
  pedidos = [],
  archivo,
  usuario,
  onProgreso = () => {}
}) {
  if (!usuario?.uid) throw new ErrorPlanMaestro('Tu cuenta no tiene sesion valida.')
  if (!usuario?.nombre) throw new ErrorPlanMaestro('Tu cuenta no tiene nombre configurado.')
  if (!lineas?.length) throw new ErrorPlanMaestro('El archivo no trajo ninguna linea que se pueda usar.')

  const refVersion = doc(collection(db, 'planMaestroVersiones'))
  const versionId = refVersion.id

  // Las lineas se agrupan por id: si el Excel trae el mismo renglon repetido,
  // se suma en vez de pisarse en silencio (dos entregas del mismo codigo en la
  // misma OT son dos renglones legitimos, y perder uno cambiaria la meta).
  const porId = new Map()
  for (const l of lineas) {
    const id = idDeLinea({ versionId, oc: l.oc, ot: l.ot, codigo: l.codigo })
    const previa = porId.get(id)
    if (previa) {
      // Se suma solo si AMBAS traen meta. Si a una le falta, el total ya no es
      // confiable: se marca la linea como sin meta en vez de inventar el
      // faltante y pintar un avance que nadie puede verificar.
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

  // El diccionario pedido -> OT. Se deduplica por id: el mismo pedido aparece
  // en decenas de renglones (uno por codigo) y todos dicen la misma OT.
  const porPedido = new Map()
  for (const p of pedidos) {
    if (!p?.pedidoClave || !p?.ot) continue
    porPedido.set(idDePedido(versionId, p.pedidoClave), {
      versionId,
      pedidoClave: normalizarPedido(p.pedidoClave),
      pedidoTexto: String(p.pedidoTexto ?? p.pedidoClave).slice(0, 200),
      ot: p.ot,
      // A quien va, si el plan lo dice: es lo que la tarea de ensamble jala
      // al crearse para quedar alineada con el arbol.
      ...(p.destino ? { destino: String(p.destino).slice(0, 120) } : {})
    })
  }
  const entradasPedidos = [...porPedido.entries()]
  const totalEscrituras = entradas.length + entradasPedidos.length

  onProgreso('Registrando la subida...')
  await setDoc(refVersion, {
    archivo: String(archivo || '').slice(0, 120),
    totalLineas: entradas.length,
    totalPedidos: entradasPedidos.length,
    estado: 'borrador',
    subidoPorUid: usuario.uid,
    // Topado igual que 'archivo': la regla exige size() <= 120, y sin este
    // tope un nombre de perfil mas largo tumbaria el commit despues de
    // escribir todas las lineas y pedidos en lotes.
    subidoPorNombre: String(usuario.nombre || '').slice(0, 120),
    creadoEn: serverTimestamp(),
    activadaEn: null
  })

  let escritas = 0
  const escribirLotes = async (items, coleccion) => {
    for (let i = 0; i < items.length; i += LOTE) {
      const lote = writeBatch(db)
      items.slice(i, i + LOTE).forEach(([id, datos]) => {
        lote.set(doc(db, coleccion, id), {
          ...datos,
          creadoEn: serverTimestamp(),
          subidoPorUid: usuario.uid
        })
      })
      await lote.commit()
      escritas += Math.min(LOTE, items.length - i)
      onProgreso(`Subiendo el plan... ${escritas} de ${totalEscrituras}`)
    }
  }

  await escribirLotes(entradas, 'planMaestroLineas')
  await escribirLotes(entradasPedidos, 'planMaestroPedidos')

  onProgreso('Activando el plan...')
  // El resumen viaja dentro del puntero para que abrir la pestana cueste UNA
  // lectura. Si un dia hubiera cientos de ordenes de compra dejaria de caber
  // (un documento de Firestore topa en 1 MB) y la subida entera fallaria: por
  // eso, pasado el tope, se omite y la pestana lo reconstruye leyendo.
  const resumen = resumirOcs(entradas.map(([, l]) => l))
  const ocs = resumen.length <= TOPE_RESUMEN ? resumen : null
  if (!ocs) {
    console.warn(
      `[PlanMaestro] ${resumen.length} ordenes de compra: no cabe el resumen en el puntero, ` +
        'la pestana lo va a reconstruir leyendo las lineas.'
    )
  }
  const cierre = writeBatch(db)
  cierre.set(refVersion, { estado: 'activa', activadaEn: serverTimestamp() }, { merge: true })
  cierre.set(REF_ACTIVA(), {
    versionId,
    archivo: String(archivo || '').slice(0, 120),
    totalLineas: entradas.length,
    totalPedidos: entradasPedidos.length,
    // El resumen por OC viaja aqui para que abrir la pestana cueste UNA
    // lectura en vez de las 3419 lineas del plan.
    ...(ocs ? { ocs } : {}),
    activadaEn: serverTimestamp(),
    activadaPorUid: usuario.uid,
    // Mismo tope que subidoPorNombre arriba: la regla exige size() <= 120.
    // Peor caso real: el cierre falla con permission-denied despues de
    // escribir 1500 documentos en los lotes anteriores.
    activadaPorNombre: String(usuario.nombre || '').slice(0, 120)
  })
  await cierre.commit()

  return {
    versionId,
    lineas: entradas.length,
    pedidos: entradasPedidos.length,
    leidasDelExcel: lineas.length
  }
}
