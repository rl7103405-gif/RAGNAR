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
import { destinoDeOt, normalizarCodigo, normalizarModelo, normalizarOt } from './planMaestro'
import { datosDeCodigos } from './datosDelCatalogo'
import { ordenarPorFechaDesc } from './solicitudesAvios'
import {
  apartadoDeLaOt,
  apuntarApartadoEnElLote,
  maquilasDelApartado,
  otAceptable,
  revisarApartado,
  soltarApartadoEnElLote,
  sujetoDelPermiso,
  TIPO_PERMISO_OT
} from './otsAsignadas'
import { autorizacionVigente } from './auditoria'

export class ErrorTareaEnsamble extends Error {}

/** El choque de "esta orden ya es de otra maquila". Lleva los datos del
 *  conflicto para que la pantalla pueda ofrecer pedir la autorizacion en vez
 *  de solo decir que no. */
export class ErrorOtOcupada extends ErrorTareaEnsamble {
  constructor(mensaje, datos = {}) {
    super(mensaje)
    Object.assign(this, datos)
  }
}

// 950 KB: margen bajo el tope de 1 MiB por documento de Firestore.
export const CHUNK_BYTES = 950000
// 17 chunks * 950 KB > 15 MB: el tope de archivo. Mismos numeros que las
// reglas (tareaEnsambleValida y el regex de IDs 00..16): cambiar uno sin el
// otro rompe la subida.
export const MAX_TECHPACK_BYTES = 15728640
export const MAX_CHUNKS = 17

// El ciclo completo, desde que Quini la encarga hasta que la cierra:
//
//   preparando ─► abierta ─► iniciada ─► declarada ─► terminada
//                    │           │           │  ▲
//                    └───────────┴───────────┘  └── Quini confirma
//                         cancelada (Quini)         (aqui se borra el
//                                                    tech pack)
//
// 'iniciada' y 'declarada' las mueve LA MAQUILA; el cierre es de Quini. Esa
// separacion no es burocracia: cerrar borra el tech pack, y un dedazo de la
// maquila le quitaria el documento con el que esta armando. Ademas nadie
// deberia poder darse por recibido a si mismo -- es el mismo criterio del
// acuse de bultos y de la revalidacion de calidad en captura-mecanicos.
export const ESTADOS_TAREA_ENSAMBLE = {
  preparando: 'Subiendo el tech pack',
  abierta: 'Sin empezar',
  iniciada: 'En proceso',
  declarada: 'Terminada por la maquila — por confirmar',
  terminada: 'Terminada',
  cancelada: 'Cancelada'
}

/** Estados en que la tarea sigue viva (no se ha cerrado). */
export const ESTADOS_VIVOS = ['preparando', 'abierta', 'iniciada', 'declarada']

/** Estados en que la maquila la tiene en sus manos: la ve, la trabaja y
 *  puede consultar el tech pack. Mismo conjunto que exigen las reglas. */
export const ESTADOS_EN_LA_MAQUILA = ['abierta', 'iniciada', 'declarada']

export const estaViva = (tarea) => ESTADOS_VIVOS.includes(tarea?.estado)

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
      // La MISMA normalizacion que usa el plan y el arbol: sin esto un codigo
      // con espacio interno ('AB 123') se guardaria distinto de como se busca.
      codigo: normalizarCodigo(r.codigo),
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
/**
 * ¿Esta orden de trabajo ya esta asignada a alguna maquila?
 *
 * Regla del papa de Roberto (2026-09-02): *"ordenes de trabajo... que solo
 * vayan a UNA maquila, y deberiamos ya de bloquear"*. Lo que se reparte entre
 * varias maquilas es la ORDEN DE COMPRA, no la OT. Y ademas: *"que no le
 * permita repetido"*.
 *
 * Devuelve { maquilaId, titulo, estado } de la tarea que ya la tiene, o null.
 * Solo cuentan las tareas VIVAS: una cancelada no bloquea nada, y una
 * terminada tampoco — si hay que rehacerla, se rehace.
 *
 * Se busca maquila por maquila y NO con un collectionGroup: las reglas de
 * ruta no aplican a un collectionGroup (necesitaria su propio
 * `match /{path=**}/tareasEnsamble/{id}`), y abrir esa puerta para ahorrar
 * cinco consultas no vale la pena. Mismo criterio que en PanelAcusesMaquilas.
 *
 * ⚠️ ESTO YA NO ES EL CANDADO. Desde el 2026-09-02 el candado de verdad vive
 * en el SERVIDOR (utils/otsAsignadas.js + las reglas de 'otsAsignadas'): la
 * orden se aparta en el mismo lote que la tarea y apartar no funciona dos
 * veces. Esta funcion se queda como PRE-AVISO: sirve para decirlo antes y para
 * saltarse ordenes ocupadas en una tanda, pero quien decide es el servidor.
 *
 * Lo que sigue describe por que hacia falta ese candado:
 *
 * ⚠️ LIMITE (ya resuelto): esto es un candado de CLIENTE. Entre esta comprobacion y
 * la escritura hay una ventana en la que otra persona podria crear la misma
 * OT en otra maquila, y las reglas de Firestore no lo verifican. Hoy se
 * asume porque solo Lindbergh y direccion crean tareas —es un error honesto,
 * no un abuso—, pero si esto tiene que ser una REGLA y no una sugerencia,
 * hace falta un centinela transaccional (`otsAsignadas/{ot}` escrito en el
 * mismo lote que la tarea, y liberado al cancelarla). Anotado en IDEAS.md.
 */
export async function tareaQueYaTieneLaOt(ot, maquilaIds) {
  const otLimpia = normalizarOt(ot)
  if (!otLimpia) return null
  const ids = (maquilaIds || []).filter(Boolean)
  if (!ids.length) return null
  // ⚠️ SIN try/catch por maquila, a proposito. Aqui hubo uno que atrapaba el
  // error, escribia un warn y devolvia null — es decir, si fallaba la lectura
  // JUSTO en la maquila donde la OT si estaba, esta funcion contestaba "libre"
  // y la tarea se creaba duplicada sin que nadie se enterara. Un candado que
  // se abre solo cuando no puede comprobar no es un candado. Si algo falla, el
  // error sube y quien llama lo enseña en pantalla en vez de seguir a ciegas.
  const encontradas = await Promise.all(
    ids.map(async (mid) => {
      const snap = await getDocs(
        query(collection(db, 'portalMaquila', mid, 'tareasEnsamble'), where('ot', '==', otLimpia))
      )
      const viva = snap.docs.find((d) => ESTADOS_VIVOS.includes(d.data().estado))
      return viva ? { maquilaId: mid, titulo: viva.data().titulo || '', estado: viva.data().estado } : null
    })
  )
  return encontradas.find(Boolean) || null
}

export async function crearTareaEnsamble({
  maquilaId,
  titulo,
  ot,
  fechaRequerida,
  esPrueba = false,
  renglones,
  notas,
  archivo,
  // deBiblioteca: { contenido, nombre, formato } ya bajado y validado de la
  // biblioteca de tech packs (pegado automatico al encargar). Se trata igual
  // que un archivo elegido a mano: la tarea nace 'preparando' y se publica
  // cuando termina de subir.
  deBiblioteca = null,
  usuario,
  onProgreso = () => {}
}) {
  if (!maquilaId) throw new ErrorTareaEnsamble('Elige la maquila.')
  const tituloLimpio = String(titulo || '').trim().slice(0, 120)
  // Una fecha con formato raro NO se descarta callando: la tarea se crearia
  // sin prioridad y nadie sabria por que la maquila no la ve marcada. Pasa si
  // el navegador degrada el input de fecha a texto libre.
  const fechaTexto = String(fechaRequerida || '').trim()
  // El mismo rango que exige la regla del servidor (mes 01-12, dia 01-31): si
  // el cliente fuera mas laxo, un '2026-13-40' moriria alla con un
  // 'permission-denied' pelado en vez de este mensaje.
  if (fechaTexto && !fechaDeCalendario(fechaTexto)) {
    throw new ErrorTareaEnsamble('Esa fecha no existe en el calendario: vuelve a elegirla.')
  }
  // El amarre con el plan maestro: si Lindbergh dice de que ORDEN DE TRABAJO
  // es la tarea, se congela normalizada y se le jala del plan A QUIEN VA
  // ('Modular Walmart Jun-Sep'). Todo opcional y nada bloquea: una tarea de
  // una OT que Adrian no ha subido se crea igual, solo que sin destino.
  const otLimpia = normalizarOt(ot)
  const destino = otLimpia ? await destinoDeOt(otLimpia) : ''
  if (!tituloLimpio) throw new ErrorTareaEnsamble('Ponle titulo a la tarea (ej. el pedido o el cliente).')
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado: avisale a Roberto.')
  const limpios = limpiarRenglones(renglones)

  // ⚠️ MODELO Y TALLA SE CONGELAN AQUI, al crear la tarea.
  //
  // La remision que la maquila entrega pide esas columnas, y el catalogo de
  // productos las tiene. Pero la maquila es un usuario EXTERNO y no puede leer
  // el catalogo (comprobado: 'Missing or insufficient permissions', y esta
  // bien que sea asi — son 38 mil productos de la fabrica). Quien SI puede es
  // Lindbergh, que es quien crea la tarea: se resuelven ahora y viajan dentro
  // de ella. Mismo patron que la OT congelada del bulto.
  //
  // Si el catalogo no responde, la tarea se crea igual sin esos datos: un
  // adorno del papel no puede impedir que se encargue trabajo.
  let conCatalogo = limpios
  try {
    const datos = await datosDeCodigos(limpios.map((r) => r.codigo))
    conCatalogo = limpios.map((r) => {
      const c = datos.get(r.codigo)
      if (!c) return r
      return {
        ...r,
        descripcion: r.descripcion || String(c.descripcion || '').slice(0, 200),
        // Normalizado al congelarlo: es la llave con la que se le va a pagar
        // a la maquila, y tiene que ser LA MISMA que guarda la pantalla de
        // precios y que busca la remision.
        ...(c.modelo ? { modelo: normalizarModelo(c.modelo).slice(0, 60) } : {}),
        ...(c.talla ? { talla: String(c.talla).slice(0, 60) } : {})
      }
    })
  } catch (err) {
    console.warn('[TareasEnsamble] No se pudo completar con el catalogo:', err?.message)
  }

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
  if (!contenido && deBiblioteca) {
    // Si viene deBiblioteca pero sin contenido utilizable, no se ignora en
    // silencio (eso creaba la tarea 'abierta' sin archivo como si nunca se
    // hubiera pedido pegar uno): se avisa.
    if (!(deBiblioteca.contenido instanceof ArrayBuffer) || deBiblioteca.contenido.byteLength === 0) {
      throw new ErrorTareaEnsamble('El tech pack de la biblioteca no trajo contenido: vuelve a intentarlo.')
    }
    if (!['pdf', 'xlsx'].includes(deBiblioteca.formato)) {
      throw new ErrorTareaEnsamble('El tech pack de la biblioteca tiene un formato que no se puede pegar.')
    }
    if (deBiblioteca.contenido.byteLength > MAX_TECHPACK_BYTES) {
      throw new ErrorTareaEnsamble('El tech pack de la biblioteca esta vacio o pasa de 15 MB.')
    }
    contenido = deBiblioteca.contenido
    formato = deBiblioteca.formato
  }

  // Como esta la orden AHORA MISMO (no como estaba cuando se pinto la
  // pantalla), y si hay un permiso vigente para repartirla.
  // La orden tiene que ser de la forma que aceptan las reglas ANTES de armar
  // nada: si no, el lote entero muere en el servidor y el usuario ve un
  // 'permission-denied' pelado por haber escrito un punto.
  if (otLimpia && !otAceptable(otLimpia)) {
    throw new ErrorTareaEnsamble(
      `La orden "${otLimpia}" tiene caracteres que no se admiten. Solo numeros, letras, ` +
        'diagonal (/) y guion (-), y no puede empezar con cero.'
    )
  }
  const apartado = otLimpia ? await apartadoDeLaOt(otLimpia, esPrueba) : null
  const permiso =
    otLimpia && apartado && maquilasDelApartado(apartado).length
      ? await autorizacionVigente(sujetoDelPermiso(otLimpia, maquilaId), TIPO_PERMISO_OT)
      : null

  const ref = doc(collection(db, 'portalMaquila', maquilaId, 'tareasEnsamble'))
  const base = {
    maquilaId,
    titulo: tituloLimpio,
    // Solo se escriben si vienen: las reglas los validan con get(...,null) y
    // 'destino' exige que haya 'ot' (el destino sale del plan VIA la OT).
    ...(otLimpia ? { ot: otLimpia } : {}),
    ...(otLimpia && destino ? { destino } : {}),
    // Para cuando se necesita. Texto AAAA-MM-DD y no timestamp: es lo que
    // ordena el trabajo de la maquila y comparar textos evita el corrimiento
    // de un dia que da convertir una fecha sin hora a Date en Mexico.
    ...(fechaTexto ? { fechaRequerida: fechaTexto } : {}),
    // La firma de quien MUEVE la prioridad nace vacia: al crear, la fecha no
    // se "cambio", se puso. Explicita y no ausente, para que el documento diga
    // lo mismo que valida la regla.
    fechaRequeridaCambiadaEn: null,
    fechaRequeridaCambiadaPorUid: null,
    fechaRequeridaCambiadaPorNombre: null,
    renglones: conCatalogo,
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
    techPackBorradoEn: null,
    // Las firmas del reporte de la maquila nacen vacias. Las tareas creadas
    // ANTES de esto no las traen y no pasa nada: las reglas las leen con
    // get(campo, null), justamente para no tener que migrar nada.
    iniciadaEn: null,
    iniciadaPorUid: null,
    iniciadaPorNombre: null,
    declaradaEn: null,
    declaradaPorUid: null,
    declaradaPorNombre: null,
    notaMaquila: null,
    devueltaEn: null,
    devueltaPorUid: null,
    devueltaPorNombre: null,
    motivoDevolucion: null
  }
  onProgreso('Creando la tarea...')

  // ⚠️ LA TAREA Y EL APARTADO DE LA OT, EN EL MISMO LOTE.
  //
  // El apartado es lo que impide que la misma orden de trabajo acabe en dos
  // maquilas (lo pidio el papa de Roberto: "que solo vayan a una maquila, y
  // deberiamos ya de bloquear"). Va aqui dentro y no en una escritura aparte
  // porque si fueran dos, una tarea podria existir SIN apartar su orden --
  // y entonces el candado seria una sugerencia.
  //
  // Si la orden ya esta apartada por otra maquila, esto NO se resuelve aqui:
  // se le avisa a quien encarga y, si de verdad hace falta repartirla, se pide
  // permiso al admin. Ese permiso es de un solo uso y para esta orden con esta
  // maquila.
  if (otLimpia) {
    const revision = revisarApartado(apartado, maquilaId)
    // Repetirla en la MISMA maquila tampoco: el papa lo pidio junto con lo
    // otro ("que no le permita repetido"). El servidor tambien lo rechaza,
    // pero ahi saldria como un 'permission-denied' que no explica nada.
    if (revision.yaEsMia) {
      throw new ErrorOtOcupada(
        `Esa maquila YA tiene una tarea viva con la orden ${otLimpia}. No la dupliques: ` +
          'edita la que existe, o cierrala primero.',
        { ot: otLimpia, ocupadaPor: maquilaId, tareaId: revision.tareaId, esMia: true }
      )
    }
    if (revision.ocupadaPor && !permiso) {
      throw new ErrorOtOcupada(
        `La orden de trabajo ${otLimpia} ya esta asignada a ${revision.ocupadaPor}. ` +
          'Una orden de trabajo va a UNA sola maquila. Si de verdad hay que repartirla, ' +
          'pide autorizacion.',
        { ot: otLimpia, ocupadaPor: revision.ocupadaPor, tareaId: revision.tareaId }
      )
    }
    const lote = writeBatch(db)
    lote.set(ref, base)
    apuntarApartadoEnElLote(lote, {
      ot: otLimpia,
      maquilaId,
      tareaId: ref.id,
      existente: apartado,
      permiso,
      esPrueba
    })
    // El permiso se CONSUME en este mismo lote: las reglas exigen que ya no
    // exista al terminar, o seria una llave reutilizable.
    if (permiso && apartado) {
      lote.delete(doc(db, 'autorizaciones', `${sujetoDelPermiso(otLimpia, maquilaId)}_${TIPO_PERMISO_OT}`))
      if (permiso.solicitudId) {
        lote.update(doc(db, 'solicitudesCorreccion', permiso.solicitudId), {
          usadaEn: serverTimestamp()
        })
      }
    }
    await lote.commit()
  } else {
    // Sin orden de trabajo no hay nada que apartar.
    await setDoc(ref, base)
  }

  // sinTechPack: si subirTechPack truena DESPUES de que el lote de arriba ya
  // se cometio (tarea creada, OT apartada), la promesa que rechaza dejaba la
  // tarea invisible en 'preparando' -- la maquila no la ve, el aviso no la
  // menciona, y al reintentar el candado dice "ocupada" porque la OT ya es
  // suya. Por eso aqui NO se deja que el error de la subida tumbe la funcion
  // entera: se intenta publicar la tarea SIN tech pack (mismo patron de
  // 'publicadaEn' que usa subirTechPack al cerrar) para que al menos la
  // maquila la vea y alguien la complete desde el panel.
  let sinTechPack = false
  if (contenido) {
    try {
      await subirTechPack({
        maquilaId,
        tareaId: ref.id,
        contenido,
        nombre: archivo ? archivo.name : deBiblioteca.nombre,
        formato,
        onProgreso
      })
    } catch (err) {
      console.error('[TareasEnsamble] Fallo la subida del tech pack; se intenta publicar la tarea sin el:', err)
      sinTechPack = true
      try {
        // Chunks parciales de ESTE intento: sin manifiesto nadie los puede
        // leer (las reglas exigen techPack != null), pero se quedarian como
        // basura para siempre si no se barren.
        const parciales = await getDocs(colChunks(maquilaId, ref.id))
        for (let i = 0; i < parciales.docs.length; i += 10) {
          const lote = writeBatch(db)
          parciales.docs.slice(i, i + 10).forEach((d) => lote.delete(d.ref))
          await lote.commit()
        }
        const actual = await getDoc(ref)
        const yaPublicada = actual.exists() && actual.data().publicadaEn != null
        await updateDoc(ref, {
          estado: 'abierta',
          techPack: null,
          ...(yaPublicada ? {} : { publicadaEn: serverTimestamp() })
        })
      } catch (errRecuperacion) {
        console.error('[TareasEnsamble] Tambien fallo la recuperacion sin tech pack:', errRecuperacion)
        const errorTipado = new ErrorTareaEnsamble(
          `La tarea de "${tituloLimpio}" quedo creada pero sin tech pack (no se pudo subir ni ` +
            'publicarla sin el): completala desde el panel.'
        )
        errorTipado.tareaId = ref.id
        errorTipado.tareaCreada = true
        throw errorTipado
      }
    }
  }
  return { id: ref.id, sinTechPack }
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

// ---------------------------------------------------------------------------
// Lo que reporta LA MAQUILA
// ---------------------------------------------------------------------------
// Las tres funciones escriben exactamente los campos que su rama de las reglas
// admite. Si aqui se manda uno de mas, el servidor rechaza la escritura
// entera: el diff de las reglas es `hasOnly`, no una sugerencia.

/** "Ya empece a armar esto." Solo desde 'abierta'. */
export async function iniciarTareaEnsamble({ maquilaId, tareaId, usuario }) {
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado.')
  await updateDoc(refTarea(maquilaId, tareaId), {
    estado: 'iniciada',
    iniciadaEn: serverTimestamp(),
    iniciadaPorUid: usuario.uid,
    iniciadaPorNombre: usuario.nombre
  })
}

/**
 * "Ya termine." NO cierra la tarea: la deja esperando la confirmacion de
 * Quini, y el tech pack sigue disponible mientras tanto.
 *
 * Si la tarea nunca se marco como iniciada, se sella el inicio AHORA junto con
 * la declaracion (queda tiempo de armado cero, que es la verdad que se sabe).
 * La alternativa seria obligar a picar "empece" antes, y eso deja atorada a
 * quien se le olvido.
 */
export async function declararTareaEnsambleTerminada({ maquilaId, tarea, usuario, nota }) {
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado.')
  const notaLimpia = String(nota || '').trim().slice(0, 300)
  const sinIniciar = tarea.estado === 'abierta'
  await updateDoc(refTarea(maquilaId, tarea.id), {
    estado: 'declarada',
    ...(sinIniciar
      ? {
          iniciadaEn: serverTimestamp(),
          iniciadaPorUid: usuario.uid,
          iniciadaPorNombre: usuario.nombre
        }
      : {}),
    declaradaEn: serverTimestamp(),
    declaradaPorUid: usuario.uid,
    declaradaPorNombre: usuario.nombre,
    notaMaquila: notaLimpia || null,
    // Declarar de nuevo SALDA la devolucion anterior: el motivo ya fue
    // atendido y deja de estar pendiente. Quien la devolvio y cuando se
    // conservan (eso es historia, no un pendiente).
    motivoDevolucion: null
  })
}

/** "Me equivoque, todavia no termino." Solo mientras Quini no la haya
 *  confirmado ni devuelto. El inicio NO se toca. */
export async function retirarDeclaracionTareaEnsamble({ maquilaId, tareaId }) {
  await updateDoc(refTarea(maquilaId, tareaId), {
    estado: 'iniciada',
    declaradaEn: null,
    declaradaPorUid: null,
    declaradaPorNombre: null,
    notaMaquila: null
  })
}

// ---------------------------------------------------------------------------
// Lo que resuelve QUINI
// ---------------------------------------------------------------------------

/**
 * DEVOLVER una tarea declarada: no cuadro lo que entrego. Vuelve a manos de la
 * maquila con el motivo escrito, para que sepa que corregir -- y para que se
 * distinga de que ella misma haya retirado su declaracion.
 *
 * El 'iniciadaEn' original se conserva a proposito: el tiempo de armado tiene
 * que incluir el retrabajo.
 */
/**
 * Que la fecha EXISTA en el calendario, no solo que tenga la forma. El
 * '<input type="date">' no deja escribir un 31 de febrero, pero la funcion
 * tambien se llama desde otros lados y el formato por si solo lo aceptaria.
 */
export function fechaDeCalendario(texto) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(texto)) return false
  const [a, m, d] = texto.split('-').map(Number)
  const bisiesto = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
  const diasDelMes = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return d <= diasDelMes[m - 1]
}

/**
 * Mueve la PRIORIDAD de una tarea ya encargada, sin tocar nada mas.
 *
 * Roberto, 2026-09-02. El caso es "esto ahora corre prisa" y casi siempre cae
 * cuando la maquila ya empezo. Se escribe UN solo campo mas su firma: las
 * reglas no dejan colar nada mas en este write.
 *
 * Fecha vacia = quitarle la prioridad (se va al final de su lista).
 */
export async function cambiarFechaRequerida({ maquilaId, tareaId, fecha, usuario }) {
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado.')
  const fechaTexto = String(fecha || '').trim()
  // El mismo rango que exige la regla del servidor.
  if (fechaTexto && !fechaDeCalendario(fechaTexto)) {
    throw new ErrorTareaEnsamble('Esa fecha no existe en el calendario: vuelve a elegirla.')
  }
  await updateDoc(refTarea(maquilaId, tareaId), {
    // null, no borrar el campo: asi el diff de las reglas lo ve cambiar.
    fechaRequerida: fechaTexto || null,
    fechaRequeridaCambiadaEn: serverTimestamp(),
    fechaRequeridaCambiadaPorUid: usuario.uid,
    fechaRequeridaCambiadaPorNombre: usuario.nombre
  })
}

export async function devolverTareaEnsamble({ maquilaId, tareaId, usuario, motivo }) {
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado.')
  const motivoLimpio = String(motivo || '').trim().slice(0, 300)
  if (!motivoLimpio) throw new ErrorTareaEnsamble('Escribe por que se la regresas: es lo que va a leer la maquila.')
  await updateDoc(refTarea(maquilaId, tareaId), {
    estado: 'iniciada',
    declaradaEn: null,
    declaradaPorUid: null,
    declaradaPorNombre: null,
    devueltaEn: serverTimestamp(),
    devueltaPorUid: usuario.uid,
    devueltaPorNombre: usuario.nombre,
    motivoDevolucion: motivoLimpio
  })
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
export async function terminarTareaEnsamble({
  maquilaId,
  tarea,
  estado,
  usuario,
  esPrueba = false,
  onProgreso = () => {}
}) {
  if (!['terminada', 'cancelada'].includes(estado)) throw new ErrorTareaEnsamble('Estado invalido.')
  if (!usuario?.nombre) throw new ErrorTareaEnsamble('Tu cuenta no tiene nombre configurado.')
  onProgreso(estado === 'terminada' ? 'Cerrando la tarea...' : 'Cancelando la tarea...')
  // El manifiesto se va EN ESTE MISMO write. La maquila sigue pudiendo leer
  // el documento de la tarea (su permiso depende de publicadaEn, no del
  // estado), asi que dejar el manifiesto un momento mas le seguiria mostrando
  // el NOMBRE del archivo -- y ese nombre suele traer el cliente y el pedido.
  // El cierre Y la liberacion de la orden, en el MISMO lote.
  //
  // Esta es la parte delicada del candado, no la de apartar: si la tarea se
  // cancelara y la orden no se soltara, esa OT quedaria muerta para siempre y
  // nadie entenderia por que ya no se puede encargar. Juntas, o ninguna.
  //
  // ⚠️ Y SOLO SI HAY APARTADO QUE SOLTAR. Un update sobre un documento que no
  // existe tumba el lote ENTERO, asi que dar por hecho el apartado dejaria sin
  // poder cerrarse a toda tarea que no lo tenga: las de antes de este cambio, y
  // las que alguien cree con la pestana ya abierta el dia del despliegue. El
  // cierre de una tarea no puede depender de eso.
  // Y se compara contra ESTA tarea, no solo contra la maquila: si el mapa
  // estuviera desincronizado, soltar por el nombre de la maquila liberaria el
  // turno de OTRA tarea viva.
  const apartado = tarea.ot ? await apartadoDeLaOt(tarea.ot, esPrueba) : null
  const hayQueSoltar = apartado?.asignaciones?.[maquilaId] === tarea.id

  const lote = writeBatch(db)
  lote.update(refTarea(maquilaId, tarea.id), {
    estado,
    terminadaEn: serverTimestamp(),
    terminadaPorUid: usuario.uid,
    terminadaPorNombre: usuario.nombre,
    techPack: null
  })
  if (hayQueSoltar) soltarApartadoEnElLote(lote, { ot: tarea.ot, maquilaId, esPrueba })
  await lote.commit()
  // Y los chunks se barren SIEMPRE, sin preguntar si habia manifiesto: una
  // subida que se corto a la mitad deja chunks con el manifiesto todavia en
  // null, y condicionar el barrido a que exista los dejaba ahi para siempre,
  // sin ninguna ruta para limpiarlos.
  await limpiarTechPack({ maquilaId, tareaId: tarea.id, onProgreso })
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
