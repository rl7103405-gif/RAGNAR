// TAREAS DE ENSAMBLE para las maquilas (Roberto, 2026-08-13): Lindbergh
// encarga que una maquila ensamble modelos ("300 packs de este modelo") y
// adjunta el TECH PACK del pedido. El tech pack trae informacion sensible del
// cliente, asi que:
//   - La maquila SOLO LO VE en pantalla mientras la tarea esta abierta; la
//     app no le ofrece descarga (candado de friccion: quien ve una pantalla
//     puede fotografiarla, Roberto esta avisado).
//   - Al terminar la tarea (regresa el producto terminado) el archivo SE
//     BORRA.
//
// El archivo vive TROCEADO EN FIRESTORE, no en Storage (el proyecto no tiene
// bucket y habilitarlo cuesta plan de pago): chunks de 950 KB en
// portalMaquila/{mid}/tareasEnsamble/{id}/techPackChunks/00..16, con
// manifiesto (nombre, formato, tamano, totalChunks, sha256) en la tarea. El
// visor rearma el archivo y verifica el sha256: un chunk perdido o cambiado
// se detecta, no se muestra un documento a medias como si estuviera completo.
//
// La subida deja la tarea en 'preparando' (la maquila NO la ve) y solo al
// terminar los chunks pasa a 'abierta'. El borrado al cierre va en lotes
// chicos DESPUES de cerrar la tarea: cerrar ya le corta la lectura a la
// maquila (las reglas exigen tarea abierta para leer chunks), y borrar los
// 17 chunks en un solo batch reventaria el tope de 10 MiB por request.
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
import { ordenarPorFechaDesc } from './solicitudesAvios'

export class ErrorTareaEnsamble extends Error {}

// 950 KB: margen bajo el tope de 1 MiB por documento de Firestore.
export const CHUNK_BYTES = 950000
// 17 chunks * 950 KB > 15 MB: el tope de archivo. Mismos numeros que las
// reglas (tareaEnsambleValida y el regex de IDs 00..16): cambiar uno sin el
// otro rompe la subida.
export const MAX_TECHPACK_BYTES = 15728640
export const MAX_CHUNKS = 17

export const ESTADOS_TAREA_ENSAMBLE = {
  preparando: 'Subiendo el tech pack',
  abierta: 'Abierta',
  terminada: 'Terminada',
  cancelada: 'Cancelada'
}

const pad2 = (n) => String(n).padStart(2, '0')

const refTarea = (maquilaId, tareaId) =>
  doc(db, 'portalMaquila', maquilaId, 'tareasEnsamble', tareaId)
const colChunks = (maquilaId, tareaId) =>
  collection(db, 'portalMaquila', maquilaId, 'tareasEnsamble', tareaId, 'techPackChunks')

/** sha256 en hex del contenido. Es lo que ata el manifiesto a los chunks. */
export async function sha256Hex(arrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function formatoDeArchivo(nombre) {
  const ext = String(nombre || '').toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'xlsx') return 'xlsx'
  return null
}

function limpiarRenglones(renglones) {
  const limpios = (renglones || [])
    .map((r) => ({
      codigo: String(r.codigo || '').trim().toUpperCase(),
      descripcion: String(r.descripcion || '').trim().slice(0, 200),
      cantidad: Number(r.cantidad),
      unidad: String(r.unidad || 'packs').trim().slice(0, 30)
    }))
    .filter((r) => r.codigo && Number.isFinite(r.cantidad) && r.cantidad > 0)
  if (limpios.length === 0) {
    throw new ErrorTareaEnsamble('Agrega al menos un modelo con su cantidad.')
  }
  if (limpios.length > 60) {
    throw new ErrorTareaEnsamble(`Maximo 60 modelos por tarea (pusiste ${limpios.length}).`)
  }
  const conDecimales = limpios.find((r) => !Number.isInteger(r.cantidad))
  if (conDecimales) {
    throw new ErrorTareaEnsamble(
      `La cantidad de ${conDecimales.codigo} trae decimales (${conDecimales.cantidad}): pide unidades completas.`
    )
  }
  return limpios
}

/**
 * Crea la tarea de ensamble. Si trae archivo, la tarea nace en 'preparando'
 * (invisible para la maquila), se suben los chunks y al final se publica como
 * 'abierta' con el manifiesto. Si algo se corta a la mitad, la tarea queda en
 * 'preparando' y el panel interno ofrece reintentar o cancelarla.
 *
 * onProgreso: (texto) => void, para que la pantalla diga que esta pasando.
 */
export async function crearTareaEnsamble({
  maquilaId,
  titulo,
  renglones,
  notas,
  archivo,
  usuario,
  onProgreso = () => {}
}) {
  if (!maquilaId) throw new ErrorTareaEnsamble('Elige la maquila.')
  const tituloLimpio = String(titulo || '').trim().slice(0, 120)
  if (!tituloLimpio) throw new ErrorTareaEnsamble('Ponle titulo a la tarea (ej. el pedido o el cliente).')
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado: avisale a Roberto.')
  const limpios = limpiarRenglones(renglones)

  let contenido = null
  let formato = null
  if (archivo) {
    formato = formatoDeArchivo(archivo.name)
    if (!formato) {
      throw new ErrorTareaEnsamble('El tech pack tiene que ser .pdf o .xlsx. Mejor PDF: se ve tal cual.')
    }
    if (archivo.size > MAX_TECHPACK_BYTES) {
      throw new ErrorTareaEnsamble(
        `El archivo pesa ${(archivo.size / 1048576).toFixed(1)} MB y el tope son 15 MB. ` +
          'Exportalo a PDF o quitale hojas que no necesite la maquila.'
      )
    }
    if (archivo.size === 0) throw new ErrorTareaEnsamble('El archivo esta vacio.')
    contenido = await archivo.arrayBuffer()
  }

  const ref = doc(collection(db, 'portalMaquila', maquilaId, 'tareasEnsamble'))
  const base = {
    maquilaId,
    titulo: tituloLimpio,
    renglones: limpios,
    notas: String(notas || '').trim().slice(0, 300),
    estado: contenido ? 'preparando' : 'abierta',
    techPack: null,
    // Sin archivo la tarea nace publicada; con archivo se publica hasta que
    // termina de subir. La maquila solo ve las que tienen publicadaEn.
    publicadaEn: contenido ? null : serverTimestamp(),
    creadoPorUid: usuario.uid,
    creadoPorNombre: usuario.nombre,
    creadoEn: serverTimestamp(),
    terminadaEn: null,
    terminadaPorUid: null,
    terminadaPorNombre: null,
    techPackBorradoEn: null
  }
  onProgreso('Creando la tarea...')
  await setDoc(ref, base)

  if (contenido) {
    await subirTechPack({
      maquilaId,
      tareaId: ref.id,
      contenido,
      nombre: archivo.name,
      formato,
      onProgreso
    })
  }
  return ref.id
}

/**
 * Sube el archivo troceado y publica la tarea como 'abierta'. Sirve tanto
 * para el alta como para REINTENTAR una subida cortada o CAMBIAR el archivo
 * de una tarea (la tarea debe estar en 'preparando'; para cambiar el de una
 * abierta, primero regresarla a 'preparando' con prepararCambioDeTechPack).
 */
export async function subirTechPack({ maquilaId, tareaId, contenido, nombre, formato, onProgreso = () => {} }) {
  const bytes = new Uint8Array(contenido)
  const totalChunks = Math.ceil(bytes.length / CHUNK_BYTES)
  if (totalChunks > MAX_CHUNKS) throw new ErrorTareaEnsamble('El archivo rebasa los 15 MB.')

  onProgreso('Calculando la huella del archivo...')
  const sha256 = await sha256Hex(contenido)

  for (let i = 0; i < totalChunks; i++) {
    onProgreso(`Subiendo el tech pack... (${i + 1}/${totalChunks})`)
    const pedazo = bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
    await setDoc(doc(colChunks(maquilaId, tareaId), pad2(i)), {
      maquilaId,
      datos: Bytes.fromUint8Array(pedazo)
    })
  }

  // Si antes hubo un archivo mas grande, sus chunks sobrantes se barren: el
  // manifiesto nuevo no los cubre y quedarian como basura ilegible.
  const existentes = await getDocs(colChunks(maquilaId, tareaId))
  const sobrantes = existentes.docs.filter((d) => Number(d.id) >= totalChunks)
  for (const s of sobrantes) await deleteDoc(s.ref)

  onProgreso('Publicando la tarea...')
  // 'publicadaEn' se fija solo la PRIMERA vez: si esta tarea ya se habia
  // publicado antes (se le esta cambiando el archivo), la regla exige
  // conservar el valor que tenia.
  const actual = await getDoc(refTarea(maquilaId, tareaId))
  const yaPublicada = actual.exists() && actual.data().publicadaEn != null
  await updateDoc(refTarea(maquilaId, tareaId), {
    estado: 'abierta',
    ...(yaPublicada ? {} : { publicadaEn: serverTimestamp() }),
    techPack: {
      nombre: String(nombre || 'tech-pack').slice(0, 200),
      formato,
      tamano: bytes.length,
      totalChunks,
      sha256,
      subidoEn: serverTimestamp()
    }
  })
}

/** Regresa una tarea abierta a 'preparando' para cambiarle el archivo: la
 *  maquila deja de verla (y de leer chunks) mientras se sube el nuevo. */
export async function prepararCambioDeTechPack(maquilaId, tareaId) {
  await updateDoc(refTarea(maquilaId, tareaId), { estado: 'preparando' })
}

/**
 * Termina (o cancela) la tarea y BORRA el tech pack.
 *
 * Orden pensado para que el archivo quede inaccesible desde el PRIMER write:
 * (1) la tarea pasa a terminada/cancelada -- las reglas ya no dejan a la
 * maquila leer chunks; (2) los chunks se barren en lotes chicos; (3) se
 * limpia el manifiesto. Si (2) o (3) fallan (red), la tarea queda cerrada
 * con manifiesto: el panel interno muestra "borrar el archivo pendiente"
 * para reintentar con limpiarTechPack.
 */
export async function terminarTareaEnsamble({ maquilaId, tarea, estado, usuario, onProgreso = () => {} }) {
  if (!['terminada', 'cancelada'].includes(estado)) throw new ErrorTareaEnsamble('Estado invalido.')
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado.')
  onProgreso(estado === 'terminada' ? 'Cerrando la tarea...' : 'Cancelando la tarea...')
  await updateDoc(refTarea(maquilaId, tarea.id), {
    estado,
    terminadaEn: serverTimestamp(),
    terminadaPorUid: usuario.uid,
    terminadaPorNombre: usuario.nombre
  })
  if (tarea.techPack) {
    await limpiarTechPack({ maquilaId, tareaId: tarea.id, onProgreso })
  }
}

/** Barre los chunks en lotes chicos y limpia el manifiesto. Reintentable. */
export async function limpiarTechPack({ maquilaId, tareaId, onProgreso = () => {} }) {
  onProgreso('Borrando el tech pack...')
  const existentes = await getDocs(colChunks(maquilaId, tareaId))
  const refs = existentes.docs.map((d) => d.ref)
  // Lotes de 10: un delete no manda el contenido, pero el tope de 10 MiB por
  // request cuenta indices y entidades; con 10 por lote sobra margen.
  for (let i = 0; i < refs.length; i += 10) {
    const lote = writeBatch(db)
    refs.slice(i, i + 10).forEach((r) => lote.delete(r))
    await lote.commit()
  }
  await updateDoc(refTarea(maquilaId, tareaId), {
    techPack: null,
    techPackBorradoEn: serverTimestamp()
  })
}

/**
 * Baja los chunks, valida continuidad y sha256, y devuelve el ArrayBuffer.
 * Tira ErrorTareaEnsamble con mensaje claro si el archivo no esta integro:
 * NUNCA se muestra un documento a medias como si estuviera completo.
 */
export async function descargarTechPack({ maquilaId, tareaId, techPack }) {
  if (!techPack?.totalChunks) throw new ErrorTareaEnsamble('Esta tarea no tiene tech pack.')
  const snap = await getDocs(colChunks(maquilaId, tareaId))
  const porId = new Map(snap.docs.map((d) => [d.id, d.data()]))
  const pedazos = []
  for (let i = 0; i < techPack.totalChunks; i++) {
    const chunk = porId.get(pad2(i))
    if (!chunk?.datos) {
      throw new ErrorTareaEnsamble(
        `Falta el pedazo ${i + 1} de ${techPack.totalChunks} del archivo. ` +
          'Pide que vuelvan a subir el tech pack.'
      )
    }
    pedazos.push(chunk.datos.toUint8Array())
  }
  const total = pedazos.reduce((acc, p) => acc + p.length, 0)
  if (total !== techPack.tamano) {
    throw new ErrorTareaEnsamble('El archivo no coincide con lo que se subio (tamano distinto).')
  }
  const unido = new Uint8Array(total)
  let offset = 0
  for (const p of pedazos) {
    unido.set(p, offset)
    offset += p.length
  }
  const huella = await sha256Hex(unido.buffer)
  if (huella !== techPack.sha256) {
    throw new ErrorTareaEnsamble(
      'El archivo esta corrupto (la huella no coincide). Pide que lo vuelvan a subir.'
    )
  }
  return unido.buffer
}

/**
 * Panel interno: tareas de ensamble de las maquilas que se le pasen.
 *
 * A proposito NO usa collectionGroup: sin orderBy (los indices de grupo no se
 * pueden aplicar por CLI en este proyecto) el limite recorta documentos
 * ARBITRARIOS -- por ruta, no por fecha -- y una tarea abierta podria no
 * aparecerle a quien la tiene que cerrar, dejando su tech pack expuesto. Con
 * una consulta por maquila (son un punado) el orden es real y el tope por
 * maquila es predecible.
 */
export function escucharTareasEnsambleDeVarias(maquilaIds, alRecibir, alFallar) {
  const ids = [...new Set((maquilaIds || []).filter(Boolean))]
  if (ids.length === 0) {
    alRecibir([])
    return () => {}
  }
  const porMaquila = new Map()
  const emitir = () => alRecibir(ordenarPorFechaDesc([...porMaquila.values()].flat()))
  const unsubs = ids.map((mid) =>
    onSnapshot(
      query(
        collection(db, 'portalMaquila', mid, 'tareasEnsamble'),
        orderBy('creadoEn', 'desc')
      ),
      (snap) => {
        porMaquila.set(mid, snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        emitir()
      },
      alFallar
    )
  )
  return () => unsubs.forEach((u) => u())
}

/** Portal de la maquila: SOLO las tareas que de verdad se le publicaron. El
 *  where no es cosmetico: la regla exige publicadaEn != null, y una consulta
 *  sin ese filtro seria rechazada completa. */
export function escucharTareasEnsambleDeMaquila(maquilaId, alRecibir, alFallar) {
  return onSnapshot(
    query(
      collection(db, 'portalMaquila', maquilaId, 'tareasEnsamble'),
      where('publicadaEn', '!=', null)
    ),
    (snap) => alRecibir(ordenarPorFechaDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    alFallar
  )
}
