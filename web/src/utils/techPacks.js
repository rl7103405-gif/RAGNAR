// BIBLIOTECA DE TECH PACKS: los documentos de Lety, guardados POR CODIGO.
//
// Roberto, 2026-09-03: "quiero tener un control de los tech packs que suba
// Lety para que cuando Lindbergh asigne una tarea con la OT se pegue directo
// el tech pack". Y la sede: "que vivan en RAGNAR, que no vivan en Google
// Drive, para tenerlo todo ahi".
//
// ⚠️ DOS DOCUMENTOS DISTINTOS, NUNCA EL MISMO. El proyecto de julio de 2026
// (RESUMEN_PROYECTO_QUINI_FICHAS_BOM) lo dejo como regla critica: tener la
// FICHA TECNICA DE TEJIDO (FTT, B2) NO equivale a tener el TECH PACK DE
// EMPAQUE (B6). El B6 es el unico que trae las habilitaciones y es EL QUE SE
// LE MANDA A LA MAQUILA. Aqui se guardan los dos, pero a la tarea de ensamble
// SOLO se pega el tech pack; la FTT es para el tablero de avance.
//
// LA LLAVE ES EL CODIGO, no la OT. Lety trabaja por diseno/codigo; Lindbergh
// encarga por orden de trabajo. El puente es el plan maestro de Adrian
// (OT -> codigos): "pegar por OT" es resolver esos codigos y buscar aqui.
//
// ORIGINAL PERMANENTE, COPIA EFIMERA. La tarea de ensamble BORRA su tech pack
// al cerrarse (la maquila no debe conservarlo). Eso no cambia: al pegar se
// COPIAN los chunks a la tarea, y lo que se borra al cerrar es esa copia. El
// original de aqui no lo toca nadie mas que quien sube.
//
// Los archivos van troceados en Firestore, con el mismo mecanismo que ya
// probo produccion en las tareas (950 KB por chunk, tope 15 MB, sha256 en el
// manifiesto). Storage sigue como mejora pendiente (#32 del vault).
import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { normalizarCodigo } from './planMaestroNucleo'
import { renglonesDeLaOt } from './planMaestro'
import { datosDeCodigos } from './datosDelCatalogo'
import {
  CHUNK_BYTES,
  MAX_CHUNKS,
  MAX_TECHPACK_BYTES,
  sha256Hex,
  subirTechPack
} from './tareasEnsamble'

export class ErrorBiblioteca extends Error {}

/** Los dos documentos que se guardan por codigo. La clave es la que viaja en
 *  el id del chunk ('tp-00', 'ftt-03') y en las reglas: cambiar una sin la
 *  otra rompe la subida. */
export const TIPOS = {
  tp: { clave: 'tp', campo: 'techPack', titulo: 'Tech pack de empaque', capa: 'B6' },
  ftt: { clave: 'ftt', campo: 'ftt', titulo: 'Ficha tecnica de tejido (FTT)', capa: 'B2' }
}

const pad2 = (n) => String(n).padStart(2, '0')
const refDoc = (codigo) => doc(db, 'techPacks', codigo)
const colChunks = (codigo) => collection(db, 'techPacks', codigo, 'chunks')
const idChunk = (tipo, i) => `${tipo}-${pad2(i)}`

/** El codigo como id de documento: normalizado y sin caracteres que Firestore
 *  no admite en un id ('/' y los que empiezan con '__'). */
export function codigoComoId(codigo) {
  const limpio = normalizarCodigo(codigo)
  if (!limpio) return ''
  if (limpio.includes('/') || limpio.startsWith('__') || limpio.length > 60) return ''
  if (limpio === '.' || limpio === '..') return ''
  return limpio
}

function validarTipo(tipo) {
  if (!TIPOS[tipo]) throw new ErrorBiblioteca('Tipo de documento desconocido.')
  return TIPOS[tipo]
}

/**
 * Sube (o reemplaza) un documento de la biblioteca para un codigo.
 *
 * Se escribe primero el archivo y al final el manifiesto: si la subida se
 * corta a la mitad, el manifiesto viejo sigue apuntando a chunks completos
 * (los nuevos pisan los viejos por id, y el sha256 del manifiesto anterior
 * dejaria de coincidir -- por eso descargar valida SIEMPRE la huella).
 */
export async function guardarEnBiblioteca({
  codigo,
  tipo,
  contenido,
  nombre,
  formato,
  usuario,
  esPrueba,
  onProgreso = () => {}
}) {
  const def = validarTipo(tipo)
  let id = codigoComoId(codigo)
  if (!id) throw new ErrorBiblioteca('Escribe el codigo del diseno (ej. WKD225T401).')
  // El corral vive en el ID, igual que los folios internos (ZZTEST): asi una
  // cuenta de prueba nunca puede crear/tocar el documento de un codigo real
  // (y viceversa) aunque el campo esPrueba se escriba bien. Sin esto, una
  // demo con rol admin podia crear techPacks/WKD225T401 con esPrueba:true y
  // dejar ese codigo inutilizable para Lety (las reglas se lo bloquean por
  // mundo distinto, y el documento no se puede borrar desde el cliente).
  const esDePrueba = esPrueba === true
  if (esDePrueba && !id.startsWith('ZZTEST')) id = 'ZZTEST' + id
  if (!esDePrueba && id.startsWith('ZZTEST')) {
    throw new ErrorBiblioteca('Ese codigo empieza con ZZTEST: es un codigo reservado para pruebas.')
  }
  if (id.length > 60) throw new ErrorBiblioteca('El codigo es demasiado largo.')
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorBiblioteca('Tu cuenta no tiene nombre configurado.')
  if (formato !== 'pdf' && formato !== 'xlsx') throw new ErrorBiblioteca('El archivo tiene que ser .pdf o .xlsx. Mejor PDF.')

  const bytes = new Uint8Array(contenido)
  if (bytes.length === 0) throw new ErrorBiblioteca('El archivo esta vacio.')
  if (bytes.length > MAX_TECHPACK_BYTES) throw new ErrorBiblioteca('El archivo rebasa los 15 MB.')
  const totalChunks = Math.ceil(bytes.length / CHUNK_BYTES)
  if (totalChunks > MAX_CHUNKS) throw new ErrorBiblioteca('El archivo rebasa los 15 MB.')

  onProgreso('Calculando la huella del archivo...')
  const sha256 = await sha256Hex(contenido)

  // El documento padre tiene que existir ANTES que los chunks: las reglas de
  // los chunks leen su esPrueba para el corral. Si es nuevo, nace aqui con la
  // descripcion del catalogo (si la tiene) para que el tablero se lea solo.
  const actual = await getDoc(refDoc(id))
  if (!actual.exists()) {
    let descripcion = ''
    try {
      const datos = await datosDeCodigos([id])
      descripcion = String(datos.get(id)?.descripcion || '').slice(0, 200)
    } catch {
      /* un adorno del tablero no puede impedir subir */
    }
    await setDoc(refDoc(id), {
      codigo: id,
      descripcion,
      techPack: null,
      ftt: null,
      creadoEn: serverTimestamp(),
      creadoPorUid: usuario.uid,
      creadoPorNombre: String(usuario.nombre).slice(0, 120),
      actualizadoEn: serverTimestamp(),
      actualizadoPorUid: usuario.uid,
      actualizadoPorNombre: String(usuario.nombre).slice(0, 120),
      // Booleano SIEMPRE (nunca opcional): las reglas lo exigen en hasAll
      // para poder comparar esPrueba contra esCuentaDePrueba() sin depender
      // de get(..., false), que es lo que dejaba pasar la consulta con
      // where() rechazada por Firestore (rules are not filters).
      esPrueba: esDePrueba
    })
  }

  for (let i = 0; i < totalChunks; i++) {
    onProgreso(`Subiendo ${def.titulo.toLowerCase()}... (${i + 1}/${totalChunks})`)
    const pedazo = bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
    await setDoc(doc(colChunks(id), idChunk(def.clave, i)), {
      codigo: id,
      tipo: def.clave,
      datos: Bytes.fromUint8Array(pedazo)
    })
  }

  // Chunks sobrantes de una version anterior mas grande: fuera, o quedan
  // como basura que el manifiesto nuevo no cubre.
  const existentes = await getDocs(colChunks(id))
  const sobrantes = existentes.docs.filter((d) => {
    const [t, n] = d.id.split('-')
    return t === def.clave && Number(n) >= totalChunks
  })
  for (const s of sobrantes) await deleteDoc(s.ref)

  onProgreso('Guardando...')
  const previo = actual.exists() ? actual.data()[def.campo] : null
  await updateDoc(refDoc(id), {
    [def.campo]: {
      nombre: String(nombre || def.clave).slice(0, 200),
      formato,
      tamano: bytes.length,
      totalChunks,
      sha256,
      version: (previo?.version || 0) + 1,
      subidoEn: serverTimestamp(),
      subidoPorUid: usuario.uid,
      subidoPorNombre: String(usuario.nombre).slice(0, 120)
    },
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario.uid,
    actualizadoPorNombre: String(usuario.nombre).slice(0, 120)
  })
  // El id con el que QUEDO guardado (con ZZTEST si es de prueba), para que el
  // aviso en pantalla diga lo mismo que la tabla.
  return id
}

/** Quita un documento del codigo (el otro tipo se conserva). */
export async function quitarDeBiblioteca({ codigo, tipo, usuario, onProgreso = () => {} }) {
  const def = validarTipo(tipo)
  const id = codigoComoId(codigo)
  if (!id) throw new ErrorBiblioteca('Codigo invalido.')
  onProgreso('Borrando...')
  // Primero el manifiesto: en cuanto se va, nadie intenta leer los chunks.
  await updateDoc(refDoc(id), {
    [def.campo]: null,
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario?.uid || '',
    actualizadoPorNombre: String(usuario?.nombre || '').slice(0, 120)
  })
  const existentes = await getDocs(colChunks(id))
  const refs = existentes.docs.filter((d) => d.id.startsWith(def.clave + '-')).map((d) => d.ref)
  for (let i = 0; i < refs.length; i += 10) {
    const lote = writeBatch(db)
    refs.slice(i, i + 10).forEach((r) => lote.delete(r))
    await lote.commit()
  }
}

/**
 * Baja un documento de la biblioteca, valida continuidad y sha256 y devuelve
 * el ArrayBuffer. NUNCA entrega un archivo a medias como si estuviera entero.
 */
export async function descargarDeBiblioteca({ codigo, tipo, manifiesto }) {
  const def = validarTipo(tipo)
  const id = codigoComoId(codigo)
  if (!id || !manifiesto?.totalChunks) throw new ErrorBiblioteca('Ese codigo no tiene ese documento.')
  const snap = await getDocs(colChunks(id))
  const porId = new Map(snap.docs.map((d) => [d.id, d.data()]))
  const pedazos = []
  for (let i = 0; i < manifiesto.totalChunks; i++) {
    const chunk = porId.get(idChunk(def.clave, i))
    if (!chunk?.datos) {
      throw new ErrorBiblioteca(
        `Falta el pedazo ${i + 1} de ${manifiesto.totalChunks} del archivo. Pide que lo vuelvan a subir.`
      )
    }
    pedazos.push(chunk.datos.toUint8Array())
  }
  const total = pedazos.reduce((acc, p) => acc + p.length, 0)
  if (total !== manifiesto.tamano) throw new ErrorBiblioteca('El archivo no coincide con lo que se subio (tamano distinto).')
  const unido = new Uint8Array(total)
  let offset = 0
  for (const p of pedazos) {
    unido.set(p, offset)
    offset += p.length
  }
  const huella = await sha256Hex(unido.buffer)
  if (huella !== manifiesto.sha256) throw new ErrorBiblioteca('El archivo esta corrupto (la huella no coincide). Pide que lo vuelvan a subir.')
  return unido.buffer
}

/** Toda la biblioteca del mundo que corresponde, en vivo. */
export function escucharBiblioteca(esPrueba, alRecibir, alFallar) {
  // El where() filtra en el servidor, no en memoria: la regla de lectura
  // depende de resource.data.esPrueba, y Firestore rechaza una consulta que
  // pueda devolver documentos que la regla negaria a alguno de los dos
  // mundos (rules are not filters). Ahora que esPrueba se escribe SIEMPRE
  // como booleano (guardarEnBiblioteca), este where esta bien formado.
  const q = query(
    collection(db, 'techPacks'),
    where('esPrueba', '==', esPrueba === true),
    orderBy('codigo')
  )
  return onSnapshot(
    q,
    (snap) => alRecibir(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    alFallar
  )
}

/**
 * Los tech packs de empaque que la biblioteca tiene para una ORDEN DE
 * TRABAJO, resolviendo OT -> codigos con el plan maestro vigente.
 *
 * Devuelve { codigos, conTechPack, sinTechPack }: los codigos que el plan
 * dice que lleva la OT, cuales de ellos tienen tech pack aqui (con su
 * manifiesto, listos para pegar) y cuales no. Si el plan no conoce la OT,
 * codigos sale vacio y quien llama lo dice en pantalla en vez de adivinar.
 */
export async function techPacksDeLaOt(ot, esPrueba) {
  const renglones = await renglonesDeLaOt(ot)
  const codigos = renglones.map((r) => codigoComoId(r.codigo)).filter(Boolean)
  if (!codigos.length) return { codigos: [], conTechPack: [], sinTechPack: [] }
  const lecturas = await Promise.all(codigos.map((c) => getDoc(refDoc(c))))
  const conTechPack = []
  const sinTechPack = []
  lecturas.forEach((snap, i) => {
    const codigo = codigos[i]
    const d = snap.exists() ? snap.data() : null
    const delMundo = d && (d.esPrueba === true) === (esPrueba === true)
    if (delMundo && d.techPack?.totalChunks) {
      conTechPack.push({ codigo, descripcion: d.descripcion || renglones[i]?.descripcion || '', techPack: d.techPack })
    } else {
      sinTechPack.push({ codigo, descripcion: renglones[i]?.descripcion || '' })
    }
  })
  return { codigos, conTechPack, sinTechPack }
}

/**
 * Pega el tech pack de la biblioteca a una tarea de ensamble: baja el
 * original (validando la huella) y lo sube a la tarea con el MISMO camino que
 * usa Lindbergh a mano (subirTechPack), para que las reglas, el visor y el
 * borrado al cerrar lo traten igual que a cualquier otro.
 */
export async function pegarTechPackATarea({ codigo, techPack, maquilaId, tareaId, soloValidar = false, contenido = null, onProgreso = () => {} }) {
  if (!contenido) {
    onProgreso('Bajando el tech pack de la biblioteca...')
    contenido = await descargarDeBiblioteca({ codigo, tipo: 'tp', manifiesto: techPack })
  }
  // soloValidar: quien llama quiere saber que el original esta integro ANTES
  // de tocar la tarea. Se baja completo, se valida la huella y se DEVUELVE el
  // buffer para que la subida real no lo baje otra vez.
  if (soloValidar) return contenido
  await subirTechPack({
    maquilaId,
    tareaId,
    contenido,
    nombre: techPack.nombre,
    formato: techPack.formato,
    onProgreso
  })
}

/**
 * A que ORDENES DE TRABAJO (y de compra) pertenece cada codigo segun el plan
 * vigente. Es el ligue que pidio Roberto (2026-09-03): "que esten ligados
 * siempre a una orden de trabajo o una orden de compra". El vinculo no se
 * teclea: lo dicta el plan de Adrian, asi que un codigo que no esta en
 * ninguna OT se ve como tal y nadie inventa la relacion.
 *
 * Devuelve Map codigo -> [{ ot, oc }], ordenado por OT.
 */
export async function otsPorCodigo(versionId) {
  const salida = new Map()
  if (!versionId) return salida
  const snap = await getDocs(query(collection(db, 'planMaestroLineas'), where('versionId', '==', versionId)))
  snap.docs.forEach((d) => {
    const l = d.data()
    const codigo = codigoComoId(l.codigo)
    const ot = String(l.ot || '').trim()
    if (!codigo || !ot) return
    if (!salida.has(codigo)) salida.set(codigo, new Map())
    const porOt = salida.get(codigo)
    if (!porOt.has(ot)) porOt.set(ot, String(l.oc || ''))
  })
  return new Map(
    [...salida.entries()].map(([codigo, porOt]) => [
      codigo,
      [...porOt.entries()]
        .map(([ot, oc]) => ({ ot, oc }))
        .sort((a, b) => a.ot.localeCompare(b.ot, 'es', { numeric: true }))
    ])
  )
}

/**
 * Cruce del tablero: para cada OT del plan vigente, que codigos le faltan de
 * tech pack. Es lo que el papa quiere ver para saber que le falta a Lety. Se
 * calcula bajo demanda (un boton), no al abrir la pestana: son todas las
 * lineas del plan.
 */
export async function otsSinTechPack(biblioteca, versionId) {
  if (!versionId) return []
  const snap = await getDocs(query(collection(db, 'planMaestroLineas'), where('versionId', '==', versionId)))
  const tienen = new Set(biblioteca.filter((b) => b.techPack?.totalChunks).map((b) => b.codigo))
  const porOt = new Map()
  snap.docs.forEach((d) => {
    const l = d.data()
    const ot = String(l.ot || '').trim()
    const codigo = codigoComoId(l.codigo)
    if (!ot || !codigo) return
    if (!porOt.has(ot)) porOt.set(ot, { ot, oc: l.oc || '', destino: l.destino || '', codigos: new Map() })
    porOt.get(ot).codigos.set(codigo, tienen.has(codigo))
  })
  return [...porOt.values()]
    .map((o) => {
      const lista = [...o.codigos.entries()]
      const faltan = lista.filter(([, ok]) => !ok).map(([c]) => c)
      return { ot: o.ot, oc: o.oc, destino: o.destino, total: lista.length, faltan }
    })
    .sort((a, b) => b.faltan.length - a.faltan.length || a.ot.localeCompare(b.ot, 'es', { numeric: true }))
}
