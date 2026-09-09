// TAREAS DE DISENO: el tablero del equipo de Lety.
//
// Roberto, 2026-09-09: "lo mas importante es trackear cuanto lleva el equipo
// de diseno, poder tener a Lety bajo lupa siempre". Y Lety en la junta del
// 5-sep: "le asignas una OC completa, tiene 5 OT, tu equipo ya lleva 3 OT de
// esa OC, entonces van en el 60%, y tener esa trazabilidad".
//
// DOS NIVELES, DOS COLECCIONES:
//   encargosDiseno/{id}      el admin le encarga una ORDEN DE COMPRA a Lety
//   asignacionesDiseno/{id}  Lety reparte cada ORDEN DE TRABAJO a su equipo
//
// EL AVANCE NO SE GUARDA: se deriva de la biblioteca de tech packs. Una OT
// esta lista cuando TODOS sus codigos tienen tech pack con el checklist
// completo. El % de la OC es OTs listas / OTs del encargo. No hay un numero
// guardado que pueda quedarse viejo o que alguien pueda inflar.
//
// EL ALCANCE SE CONGELA al crear: el encargo guarda la version del plan y su
// lista de OT; la asignacion guarda sus codigos. Si Adrian sube un plan
// nuevo, el porcentaje historico no se mueve solo (lo levanto Codex en el
// debate de diseno: el plan es acumulativo y hasta puede mover una OT de OC).
//
// LA JERARQUIA VIVE EN LOS PERFILES (web/scripts/equipo_diseno.mjs):
//   Lety            puedeAsignarDiseno: true
//   Monica, MaFer   supervisorDisenoUid: <uid de Lety>
// Las reglas la exigen: nadie se asigna trabajo solo.
//
// ATRIBUCION SEPARADA. La biblioteca es colaborativa (cualquiera del equipo
// puede editar cualquier tech pack), asi que el tablero muestra por un lado a
// QUIEN se le asigno la OT y por otro QUIEN toco de verdad cada tech pack,
// segun el sello de la biblioteca.
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { lineasDeOc, planVigente } from './planMaestro'
import { normalizarOc, normalizarOt } from './planMaestroNucleo'
import { CHECKLIST_VERSION, codigoComoId, datosDelTechPack } from './techPacks'
import { RUBROS_TECH_PACK } from './completadoTechPack'

export class ErrorDiseno extends Error {}

const COL_ENCARGOS = 'encargosDiseno'
const COL_ASIGNACIONES = 'asignacionesDiseno'

const porOt = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true })
const masNuevoPrimero = (a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0)
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))

// ---------------------------------------------------------------------------
// Lectura en vivo
// ---------------------------------------------------------------------------

/**
 * Los encargos que le tocan a quien mira: el admin ve todos; Lety, los suyos.
 * La consulta lleva el mismo filtro que exige la regla (responsableUid), para
 * que Firestore la acepte: una consulta que pudiera traer un documento ajeno
 * se rechaza completa.
 */
export function escucharEncargos({ esAdmin, uid, esPrueba }, alRecibir, alFallar) {
  const filtros = [where('esPrueba', '==', esPrueba === true)]
  if (!esAdmin) filtros.push(where('responsableUid', '==', uid))
  return onSnapshot(
    query(collection(db, COL_ENCARGOS), ...filtros),
    (snap) => alRecibir(docs(snap).sort(masNuevoPrimero)),
    alFallar
  )
}

/**
 * Las asignaciones, por alcance: 'todas' (admin), 'jefa' (las que reparte
 * Lety) o 'mias' (las de una persona del equipo).
 */
export function escucharAsignaciones({ alcance, uid, esPrueba }, alRecibir, alFallar) {
  const filtros = [where('esPrueba', '==', esPrueba === true)]
  if (alcance === 'jefa') filtros.push(where('jefeUid', '==', uid))
  if (alcance === 'mias') filtros.push(where('asignadoAUid', '==', uid))
  return onSnapshot(
    query(collection(db, COL_ASIGNACIONES), ...filtros),
    (snap) => alRecibir(docs(snap).sort((a, b) => porOt(a.ot, b.ot))),
    alFallar
  )
}

/** Quienes reportan a esta jefa (la regla deja leer solo a los suyos). */
export async function equipoDe(jefeUid) {
  const snap = await getDocs(query(collection(db, 'usuarios'), where('supervisorDisenoUid', '==', jefeUid)))
  return docs(snap)
    .filter((u) => u.activo !== false)
    .sort((a, b) => String(a.nombreCompleto || '').localeCompare(String(b.nombreCompleto || ''), 'es'))
}

/** Para el admin: quien puede recibir un encargo (las jefas de diseno). */
export async function responsablesDeDiseno() {
  const snap = await getDocs(query(collection(db, 'usuarios'), where('rol', '==', 'desarrollo')))
  return docs(snap).filter((u) => u.activo !== false && u.puedeAsignarDiseno === true)
}

// ---------------------------------------------------------------------------
// El plan, congelado por version
// ---------------------------------------------------------------------------

/**
 * Los codigos de una OT en UNA version del plan (la del encargo, no la
 * vigente): asi la asignacion queda amarrada a lo que se encargo, aunque el
 * plan cambie despues.
 */
export async function codigosDeLaOtEnVersion(versionId, ot) {
  if (!versionId || !ot) return []
  const snap = await getDocs(
    query(collection(db, 'planMaestroLineas'), where('versionId', '==', versionId), where('ot', '==', ot))
  )
  const vistos = new Set()
  snap.docs.forEach((d) => {
    const c = codigoComoId(d.data().codigo)
    if (c) vistos.add(c)
  })
  return [...vistos].sort(porOt)
}

/**
 * OT -> codigos de toda una version. Cuesta una lectura por linea del plan
 * (hoy ~380), asi que SOLO la usan las vistas de admin y de Lety, que
 * necesitan ver las OT todavia sin asignar. Una persona del equipo no la
 * carga: sus asignaciones ya traen sus codigos congelados.
 */
export async function lineasPorOtDeVersion(versionId) {
  const salida = new Map()
  if (!versionId) return salida
  const snap = await getDocs(query(collection(db, 'planMaestroLineas'), where('versionId', '==', versionId)))
  snap.docs.forEach((d) => {
    const l = d.data()
    const ot = normalizarOt(l.ot)
    const c = codigoComoId(l.codigo)
    if (!ot || !c) return
    if (!salida.has(ot)) salida.set(ot, new Set())
    salida.get(ot).add(c)
  })
  return new Map([...salida.entries()].map(([ot, s]) => [ot, [...s].sort(porOt)]))
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/**
 * El admin le encarga una orden de compra completa a una jefa de diseno.
 * Congela la version del plan y la lista de OT en ese momento.
 */
export async function crearEncargo({ oc, responsable, fechaObjetivo, notas, usuario, esPrueba, existentes = [] }) {
  const ocN = normalizarOc(oc)
  if (!ocN) throw new ErrorDiseno('Escribe la orden de compra.')
  if (!responsable?.uid) throw new ErrorDiseno('Elige a quien se le encarga.')
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorDiseno('Tu perfil no tiene nombre completo; no se puede firmar el encargo.')
  if (existentes.some((e) => e.oc === ocN && e.estado === 'abierto')) {
    throw new ErrorDiseno(`La orden de compra ${ocN} ya esta encargada y sigue abierta.`)
  }
  const vigente = await planVigente()
  if (!vigente?.versionId) throw new ErrorDiseno('Todavia no hay plan maestro activo: Adrian tiene que subirlo primero.')
  let ots = (vigente.ocs || []).find((x) => x.oc === ocN)?.ots
  if (!ots) {
    const lineas = await lineasDeOc(vigente.versionId, ocN)
    ots = [...new Set(lineas.map((l) => normalizarOt(l.ot)).filter(Boolean))]
  }
  ots = [...new Set(ots.map(normalizarOt).filter(Boolean))].sort(porOt)
  if (!ots.length) throw new ErrorDiseno(`La orden de compra ${ocN} no esta en el plan vigente, o no tiene ordenes de trabajo.`)
  if (ots.length > 200) throw new ErrorDiseno(`La orden de compra ${ocN} tiene ${ots.length} ordenes de trabajo; el tope es 200.`)
  let ref
  try {
    ref = await addDoc(collection(db, COL_ENCARGOS), {
    oc: ocN,
    planVersionId: vigente.versionId,
    ots,
    totalOts: ots.length,
    responsableUid: responsable.uid,
    responsableNombre: responsable.nombre,
    origen: 'plan',
    estado: 'abierto',
    notas: String(notas || '').trim().slice(0, 300) || null,
    fechaObjetivo: fechaObjetivo || null,
    creadoPorUid: usuario.uid,
    creadoPorNombre: usuario.nombre,
    creadoEn: serverTimestamp(),
      esPrueba: esPrueba === true
    })
  } catch (e) {
    if (e?.code === 'permission-denied') {
      throw new ErrorDiseno('No se pudo encargar. Revisa que la persona elegida tenga permiso de repartir tareas de diseno y que tu perfil tenga nombre completo.')
    }
    throw e
  }
  return { id: ref.id, ots }
}

/**
 * El admin cierra o cancela un encargo completo. La regla de update de
 * encargosDiseno solo admite tocar estado, notas y fechaObjetivo (mas los
 * tres sellos), y exige actualizadoPorNombre == nombreCompleto del perfil.
 */
// ---------------------------------------------------------------------------
// Carga A MANO (Roberto, 9-sep: "la planta todavia no esta lista" para
// encargar por orden de compra del plan). La jefa teclea las OT y, al
// repartir, los codigos. Un encargo manual nace y muere manual: si la OT
// aparece despues en el plan, no cambia solo.
// ---------------------------------------------------------------------------

// Formato aceptado de OT: el mismo que valida el resto de la app
// (normalizarOt en planMaestroNucleo.js conserva sufijos: '7887-A' es OTRA
// OT, no la '7887').
const OT_VALIDA = /^[1-9A-Z][0-9A-Z/-]*$/
// Una OT tiene digitos SIEMPRE ('7593', '7887-A'). Sin esto, 'XYZ' o 'COSA'
// pasaban como OT (lo cazo el QA); y 'OTRA' -> normalizarOt quita el 'OT' ->
// 'RA' tambien pasaba.
const tieneDigito = (x) => /[0-9]/.test(x)

/**
 * "7593, 7594-A 7595" -> { ots: ['7593','7594-A','7595'], rechazadas: [] }.
 * Se parte SOLO por coma, punto y coma, salto de linea o espacios: partir
 * por cualquier no-digito (como antes) truncaba un sufijo como '7887-A' en
 * '7887' sin avisar, y perdia OT reales. Lo que no cuadra con el formato de
 * OT se devuelve en 'rechazadas' para que la jefa lo vea y lo corrija, en
 * vez de que se pierda en silencio.
 */
export function parsearOtsDetallado(texto) {
  const vistas = new Set()
  const rechazadas = []
  String(texto || '').replace(/OT\s+(?=[0-9])/gi, '')
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((crudo) => {
      const n = normalizarOt(crudo)
      if (n && (tieneDigito(n) && OT_VALIDA.test(n))) vistas.add(n)
      else rechazadas.push(crudo)
    })
  return { ots: [...vistas].sort(porOt), rechazadas }
}

/** "7593, 7594 7595" -> ['7593','7594','7595'] (compatibilidad; ver parsearOtsDetallado). */
export function parsearOts(texto) {
  return parsearOtsDetallado(texto).ots
}

/** "1273-I, 1274-I" -> ['1273-I','1274-I'] con el mismo id que usa la biblioteca. */
export function parsearCodigos(texto) {
  const vistos = new Set()
  String(texto || '')
    .split(/[,;\s]+/)
    .map((x) => codigoComoId(x))
    .filter(Boolean)
    .forEach((x) => vistos.add(x))
  return [...vistos].sort(porOt)
}

/**
 * La jefa (o el admin) carga una lista de OT a mano, con una etiqueta en vez
 * de orden de compra. planVersionId es 'manual' y la regla lo exige asi.
 */
export async function crearEncargoManual({ etiqueta, ots, responsable, fechaObjetivo, notas, usuario, esPrueba, existentes = [] }) {
  const oc = String(etiqueta || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 40)
  if (!oc) throw new ErrorDiseno('Ponle una etiqueta al encargo (por ejemplo PIER RESURTIDO SEP).')
  const lista = Array.isArray(ots) ? ots : parsearOts(ots)
  if (!lista.length) throw new ErrorDiseno('Escribe al menos una orden de trabajo (por ejemplo 7593 o 7887-A).')
  if (lista.length > 200) throw new ErrorDiseno(`Son ${lista.length} ordenes de trabajo; el tope es 200.`)
  const resp = responsable?.uid ? responsable : { uid: usuario?.uid, nombre: usuario?.nombre }
  if (!resp.uid || !resp.nombre) throw new ErrorDiseno('Tu perfil no tiene nombre completo; no se puede firmar el encargo.')
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorDiseno('Tu perfil no tiene nombre completo; no se puede firmar el encargo.')
  if (existentes.some((e) => e.oc === oc && e.estado === 'abierto')) {
    throw new ErrorDiseno(`Ya hay un encargo abierto con la etiqueta ${oc}. Usa otra o cierra ese.`)
  }
  let ref
  try {
    ref = await addDoc(collection(db, COL_ENCARGOS), {
      oc,
      planVersionId: 'manual',
      origen: 'manual',
      ots: lista,
      totalOts: lista.length,
      responsableUid: resp.uid,
      responsableNombre: resp.nombre,
      estado: 'abierto',
      notas: String(notas || '').trim().slice(0, 300) || null,
      fechaObjetivo: fechaObjetivo || null,
      creadoPorUid: usuario.uid,
      creadoPorNombre: usuario.nombre,
      creadoEn: serverTimestamp(),
      esPrueba: esPrueba === true
    })
  } catch (e) {
    if (e?.code === 'permission-denied') {
      throw new ErrorDiseno('No se pudo cargar. Solo quien reparte tareas de diseno (o el admin) puede crear un encargo manual, y a nombre propio.')
    }
    throw e
  }
  return { id: ref.id, ots: lista }
}

export async function cambiarEncargo({ encargo, estado, usuario }) {
  if (!encargo?.id) throw new ErrorDiseno('Falta el encargo.')
  if (!['cerrado', 'cancelado'].includes(estado)) throw new ErrorDiseno('Estado invalido.')
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorDiseno('Tu perfil no tiene nombre completo; no se puede firmar el cambio.')
  try {
    await updateDoc(doc(db, COL_ENCARGOS, encargo.id), {
    estado,
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario.uid,
    actualizadoPorNombre: usuario.nombre
  })
  } catch (e) {
    if (e?.code === 'permission-denied') {
      throw new ErrorDiseno('No se pudo cambiar el encargo. Solo el admin puede cerrarlo o cancelarlo, y tu perfil necesita nombre completo.')
    }
    throw e
  }
}

/**
 * Cerrar o cancelar un encargo ARRASTRANDO sus asignaciones abiertas.
 *
 * usuario-real (10-sep): Lety cerro el encargo y Monica siguio viendo "Mis OT
 * abiertas: 2". Monica NO puede leer el encargo (la regla solo se lo deja al
 * admin y a la responsable), asi que el estado tiene que bajar a cada
 * asignacion. Cada cierre es su propio batch con historial (la regla lo
 * exige), en orden; si uno falla, se detiene y se dice cuantas quedaron. Las
 * asignaciones van PRIMERO y el encargo al final: un encargo cerrado con
 * asignaciones abiertas es el estado que confundio a Monica, y el reves
 * (asignaciones cerradas, encargo abierto) lo arregla la jefa con otro clic.
 */
export async function cerrarEncargoConAsignaciones({ encargo, estado, asignaciones, equipo, usuario }) {
  if (!['cerrado', 'cancelado'].includes(estado)) throw new ErrorDiseno('Estado invalido.')
  const abiertas = (asignaciones || []).filter((a) => a.encargoId === encargo?.id && a.estado === 'abierta')
  const estadoAsig = estado === 'cerrado' ? 'cerrada' : 'cancelada'
  let hechas = 0
  for (const a of abiertas) {
    // Codex (10-sep): la regla ancla asignadoANombre al perfil VIGENTE aunque
    // el uid no cambie; si renombraron a la persona desde que se le asigno,
    // mandar solo {estado} se rechaza. Se manda el nombre actual del equipo.
    const nombreActual = (equipo || []).find((u) => u.id === a.asignadoAUid)?.nombreCompleto
    const cambios = { estado: estadoAsig }
    if (nombreActual && nombreActual !== a.asignadoANombre) cambios.asignadoANombre = nombreActual
    try {
      await cambiarAsignacion({ asignacion: a, cambios, motivo: `encargo ${estado}`, usuario })
      hechas++
    } catch (e) {
      throw new ErrorDiseno(
        `Se ${estado === 'cerrado' ? 'cerraron' : 'cancelaron'} ${hechas} de ${abiertas.length} asignaciones y la de la OT ${a.ot} fallo: ${e?.message || e}. El encargo sigue abierto; vuelve a intentar.`
      )
    }
  }
  try {
    await cambiarEncargo({ encargo, estado, usuario })
  } catch (e) {
    // code-reviewer: si el encargo falla al final, que se sepa que las
    // asignaciones YA quedaron cerradas; reintentar es seguro (no las retoca).
    throw new ErrorDiseno(
      `${hechas ? `Las ${hechas} asignacion(es) ya quedaron ${estado === 'cerrado' ? 'cerradas' : 'canceladas'}, pero e` : 'E'}l encargo no se pudo ${estado === 'cerrado' ? 'cerrar' : 'cancelar'}: ${e?.message || e} Vuelve a intentar.`
    )
  }
  return { asignaciones: hechas }
}

/**
 * La jefa reparte una OT del encargo a alguien de su equipo.
 *
 * Id determinista `${encargo.id}__${ot}` (igual que exige la regla): una OT
 * de un encargo solo puede tener UN documento de asignacion en toda su vida.
 * Si ya hay uno y sigue abierta, es el error de siempre; si esta cerrada o
 * cancelada, se reabre por la ruta de cambiarAsignacion (deja historial) en
 * vez de intentar crear un documento que la regla va a rechazar.
 */
export async function asignarOt({ encargo, ot, destinataria, fechaObjetivo, notas, usuario, esPrueba, existentes = [], codigosManuales = '' }) {
  const otN = normalizarOt(ot)
  if (!encargo?.id) throw new ErrorDiseno('Falta el encargo.')
  if (encargo.estado !== 'abierto') throw new ErrorDiseno('Ese encargo ya no esta abierto.')
  if (!encargo.ots.includes(otN)) throw new ErrorDiseno(`La OT ${otN} no es parte de este encargo.`)
  if (!destinataria?.uid) throw new ErrorDiseno('Elige a quien se le asigna.')
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorDiseno('Tu perfil no tiene nombre completo; no se puede firmar la asignacion.')
  const id = `${encargo.id}__${otN}`
  const existente = existentes.find((a) => a.encargoId === encargo.id && a.ot === otN)
  if (existente?.estado === 'abierta') {
    throw new ErrorDiseno(`La OT ${otN} ya esta asignada. Reasignala desde su renglon.`)
  }
  // Encargo manual: los codigos los teclea la jefa. Encargo del plan: salen
  // de la version congelada; si el plan no los trae, tambien se aceptan a mano.
  const tecleados = parsearCodigos(codigosManuales)
  let codigos = encargo.planVersionId === 'manual' ? tecleados : await codigosDeLaOtEnVersion(encargo.planVersionId, otN)
  if (!codigos.length && tecleados.length) codigos = tecleados
  if (!codigos.length) {
    throw new ErrorDiseno(encargo.planVersionId === 'manual'
      ? `Escribe los codigos de la OT ${otN} (separados por coma).`
      : `La OT ${otN} no tiene codigos en el plan del encargo. Escribelos a mano.`)
  }
  if (codigos.length > 120) throw new ErrorDiseno(`La OT ${otN} trae ${codigos.length} codigos; el tope es 120.`)
  if (existente && ['cerrada', 'cancelada'].includes(existente.estado)) {
    await cambiarAsignacion({
      asignacion: existente,
      cambios: { asignadoAUid: destinataria.uid, asignadoANombre: destinataria.nombre, estado: 'abierta', codigos },
      motivo: 'reabierta y asignada',
      usuario
    })
    return id
  }
  await setDoc(doc(db, COL_ASIGNACIONES, id), {
    encargoId: encargo.id,
    oc: encargo.oc,
    ot: otN,
    planVersionId: encargo.planVersionId,
    codigos,
    jefeUid: encargo.responsableUid,
    asignadoAUid: destinataria.uid,
    asignadoANombre: destinataria.nombre,
    asignadoPorUid: usuario.uid,
    asignadoPorNombre: usuario.nombre,
    estado: 'abierta',
    revision: 1,
    notas: String(notas || '').trim().slice(0, 300) || null,
    fechaObjetivo: fechaObjetivo || null,
    creadoEn: serverTimestamp(),
    esPrueba: esPrueba === true
  })
  return id
}

/** Lo que se compara en el historial: a quien y en que estado.
 *
 * OJO: esta forma esta DUPLICADA en firestore.rules (fotoDeAsignacion). Si
 * agregas un campo aqui, agregalo alla, o todas las reasignaciones caen con
 * permission-denied. */
export const fotoDeAsignacion = (a) => ({
  asignadoAUid: a?.asignadoAUid || '',
  asignadoANombre: a?.asignadoANombre || '',
  estado: a?.estado || '',
  codigos: [...(a?.codigos || [])]
})

/**
 * Reasignar o cerrar una asignacion. Igual que la edicion de tech packs: el
 * cambio y su renglon de historial nacen en el MISMO batch y la regla los
 * amarra con getAfter(); no hay forma de reasignar sin dejar rastro.
 */
export async function cambiarAsignacion({ asignacion, cambios, motivo, usuario }) {
  if (!asignacion?.id) throw new ErrorDiseno('Falta la asignacion.')
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorDiseno('Tu perfil no tiene nombre completo; no se puede firmar el cambio.')
  const antes = fotoDeAsignacion(asignacion)
  const despues = fotoDeAsignacion({ ...asignacion, ...cambios })
  if (JSON.stringify(antes) === JSON.stringify(despues)) return { sinCambios: true }
  const revision = Number(asignacion.revision || 1) + 1
  const refHistorial = doc(collection(db, COL_ASIGNACIONES, asignacion.id, 'historial'))
  const lote = writeBatch(db)
  lote.update(doc(db, COL_ASIGNACIONES, asignacion.id), {
    ...cambios,
    revision,
    ultimaEdicionId: refHistorial.id,
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario.uid,
    actualizadoPorNombre: usuario.nombre
  })
  lote.set(refHistorial, {
    revision,
    antes,
    despues,
    motivo: String(motivo || '').trim().slice(0, 300) || null,
    cuando: serverTimestamp(),
    quienUid: usuario.uid,
    quienNombre: usuario.nombre
  })
  try {
    await lote.commit()
  } catch (e) {
    if (e?.code === 'permission-denied') {
      throw new ErrorDiseno('No se guardo. Es probable que alguien mas haya cambiado esta asignacion al mismo tiempo: recarga y vuelve a intentar.')
    }
    throw e
  }
  return { revision }
}

/**
 * El historial de una asignacion, mas nuevo primero. Ordena en memoria (no
 * orderBy en la consulta) para no exigir un indice compuesto solo por esto;
 * son a lo mas unas cuantas revisiones por asignacion.
 */
export async function historialDeAsignacion(asignacionId) {
  if (!asignacionId) return []
  const snap = await getDocs(collection(db, COL_ASIGNACIONES, asignacionId, 'historial'))
  return docs(snap)
    .map((h) => ({
      id: h.id,
      revision: h.revision,
      antes: h.antes,
      despues: h.despues,
      motivo: h.motivo || null,
      cuando: h.cuando,
      quienNombre: h.quienNombre || ''
    }))
    .sort((a, b) => (b.cuando?.toMillis?.() || 0) - (a.cuando?.toMillis?.() || 0))
}

// ---------------------------------------------------------------------------
// El avance, derivado de la biblioteca
// ---------------------------------------------------------------------------

/** codigo -> documento de la biblioteca (incluye los alias, que se siguen). */
export function indexarBiblioteca(biblioteca) {
  const m = new Map()
  ;(biblioteca || []).forEach((b) => m.set(b.codigo, b))
  return m
}

// Los documentos de la biblioteca que responden por un codigo del plan: el
// exacto (siguiendo un alias si lo es) o, si no existe, sus variantes por
// talla (WKD225T401 -> WKD225T401-4-6, -7-9, -10-13).
//
// OJO: el plan NO dice cuantas tallas debe tener un codigo, asi que aqui se
// evaluan las variantes que EXISTEN. Que existan todas las que deberian es
// criterio de Lety, no de la app (lo levanto Codex: "encontradas" no es lo
// mismo que "requeridas").
function documentosDe(codigo, indice) {
  const id = codigoComoId(codigo)
  let d = indice.get(id)
  if (d?.apuntaA) d = indice.get(d.apuntaA) || null
  if (d && !d.apuntaA) return [d]
  const pref = id + '-'
  return [...indice.values()].filter((b) => !b.apuntaA && String(b.codigo).startsWith(pref))
}

// "Listo" sin ambiguedad: hay archivo, los siete rubros estan marcados,
// ninguno en "falta", al menos uno "ya esta", y el checklist es de la version
// vigente. Un tech pack sin revisar NO esta listo aunque tenga archivo.
function evaluarDocumento(b) {
  const tiene = Boolean(b?.techPack?.totalChunks)
  const d = datosDelTechPack(b)
  const c = d.checklist || {}
  const ids = RUBROS_TECH_PACK.map((r) => r.id)
  const valores = ids.map((k) => c[k])
  const presentes = valores.every(Boolean)
  const completos = valores.filter((v) => v === 'completo').length
  const cuentan = valores.filter((v) => v !== 'no_aplica').length
  const porcentaje = cuentan ? Math.round((completos / cuentan) * 100) : 0
  const listo =
    tiene &&
    presentes &&
    valores.every((v) => v === 'completo' || v === 'no_aplica') &&
    completos >= 1 &&
    d.checklistVersion === CHECKLIST_VERSION
  return {
    tiene,
    listo,
    porcentaje,
    revisado: valores.some(Boolean),
    quien: b?.actualizadoPorNombre || '',
    cuando: b?.actualizadoEn || null
  }
}

/** El estado de UN codigo del plan frente a la biblioteca. */
export function estadoDelCodigo(codigo, indice) {
  const lista = documentosDe(codigo, indice)
  // pentester C2: coercion defensiva, por si algo cuela un codigo que no es
  // string (el panel lo pinta directo y React no acepta objetos como hijo).
  if (!lista.length) {
    return { codigo: String(codigo), tiene: false, listo: false, porcentaje: 0, revisado: false, quien: '', variantes: 0, etiqueta: 'sin tech pack' }
  }
  const evals = lista.map(evaluarDocumento)
  const tiene = evals.some((e) => e.tiene)
  const listo = evals.every((e) => e.listo)
  const porcentaje = Math.round(evals.reduce((t, e) => t + e.porcentaje, 0) / evals.length)
  const ultimo = evals.filter((e) => e.quien).sort((a, b) => (b.cuando?.toMillis?.() || 0) - (a.cuando?.toMillis?.() || 0))[0]
  return {
    codigo: String(codigo),
    tiene,
    listo,
    porcentaje,
    revisado: evals.some((e) => e.revisado),
    quien: ultimo?.quien || '',
    variantes: lista.length > 1 ? lista.length : 0,
    etiqueta: listo ? 'listo' : !tiene ? 'sin tech pack' : evals.some((e) => e.revisado) ? 'a medias' : 'sin revisar'
  }
}

/** El avance de una OT: todos sus codigos evaluados. */
export function avanceDeOt(codigos, indice) {
  // pentester C2: un 'codigos: [{}]' escrito desde la consola (la regla solo
  // valida que sea list, no el tipo de cada elemento) llegaba crudo hasta el
  // panel y React tronaba ("Objects are not valid as a React child"). Se
  // filtra a strings no vacios antes de evaluar.
  const validos = (codigos || []).filter((c) => typeof c === 'string' && c.trim())
  const estados = validos.map((c) => estadoDelCodigo(c, indice))
  const lista = estados.length > 0 && estados.every((e) => e.listo)
  const porcentaje = estados.length ? Math.round(estados.reduce((t, e) => t + e.porcentaje, 0) / estados.length) : 0
  const quienes = [...new Set(estados.map((e) => e.quien).filter(Boolean))]
  return { estados, lista, porcentaje, quienes, total: estados.length, listos: estados.filter((e) => e.listo).length, sinTechPack: estados.filter((e) => !e.tiene).length }
}

/**
 * El avance de un encargo: OTs listas / OTs del encargo (el "3 de 5 = 60%"
 * de Lety), mas el avance interno (promedio del checklist) para distinguir
 * "casi" de "ni empezado".
 */
export function avanceDeEncargo(encargo, asignaciones, lineasPorOt, indice) {
  const abiertas = (asignaciones || []).filter((a) => a.encargoId === encargo.id && a.estado !== 'cancelada')
  const filas = (encargo.ots || []).map((ot) => {
    const asignacion = abiertas.find((a) => a.ot === ot) || null
    const codigosDelPlan = lineasPorOt?.get(ot) || []
    const codigosAsignados = asignacion?.codigos || []
    // Cuando hay plan cargado para esta OT, el plan es la autoridad: la
    // asignacion NO puede fijar su propio denominador (pentester: la persona
    // vigilada no decide contra que se le mide). La union cubre a la
    // asignacion trayendo de menos o distinto que el plan; si no coincide
    // exacto se marca alcanceAlterado para que se vea en el tablero. Sin
    // plan cargado (vista de equipo, o el plan aun no llega) se usan los
    // codigos de la asignacion como siempre.
    let codigos
    let alcanceAlterado = false
    if (codigosDelPlan.length) {
      // pentester C2: la union tambien se filtra a strings no vacios, mismo
      // motivo que en avanceDeOt.
      codigos = [...new Set([...codigosDelPlan, ...codigosAsignados])].filter((c) => typeof c === 'string' && c.trim())
      if (asignacion) {
        const cuadra =
          codigosDelPlan.length === codigosAsignados.length &&
          codigosDelPlan.every((c) => codigosAsignados.includes(c))
        alcanceAlterado = !cuadra
      }
    } else {
      codigos = codigosAsignados
    }
    const av = avanceDeOt(codigos, indice)
    // pentester C3: la revision de la asignacion, para la pill de "alcance
    // corregido" en el panel.
    return { ot, asignacion, codigos, alcanceAlterado, codigosDelPlan, codigosAsignados, revision: asignacion?.revision || 0, ...av }
  })
  const listas = filas.filter((f) => f.lista).length
  const total = filas.length
  return {
    filas,
    listas,
    total,
    porcentaje: total ? Math.round((listas / total) * 100) : 0,
    interno: total ? Math.round(filas.reduce((t, f) => t + f.porcentaje, 0) / total) : 0,
    sinAsignar: filas.filter((f) => !f.asignacion).length
  }
}
