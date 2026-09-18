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
  limit,
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
import { normalizarCodigo, normalizarOt, normalizarOc } from './planMaestroNucleo'
import { renglonesDeLaOt, otsDeLaOc } from './planMaestro'
import { datosDeCodigos } from './datosDelCatalogo'
import { cargarWorkbook } from './excelJs'
import { ErrorConversion, pasarAlFormatoTPQuini } from './convertirTechPackAlSubir'
import { IDENTIDAD_VACIA, coincideTechPack, identidadDePlantilla, modelosDelTechPack, textoDe } from './clienteModeloTechPack'
import { idPedazo, idPedazoViejo } from './pedazosTechPack'
import { CHECKLIST_VERSION, codigoComoId, datosDelTechPack } from './techPackNucleo'
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

const refDoc = (codigo) => doc(db, 'techPacks', codigo)
const colChunks = (codigo) => collection(db, 'techPacks', codigo, 'chunks')

// codigoComoId, CHECKLIST_VERSION y datosDelTechPack viven en techPackNucleo.js
// (sin Firebase, para poder probar el avance en Node) y se re-exportan aqui
// para no tocar los 22 archivos que ya los importaban de este.
// Se IMPORTAN y se reexportan (no `export ... from`): este archivo tambien las
// usa, y un reexport a secas no deja la funcion disponible aqui dentro.
export { codigoComoId, CHECKLIST_VERSION, datosDelTechPack }

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
  onProgreso = () => {},
  onConvertido = () => {},
  aprobarAlSubir = false,
  onAprobado = () => {}
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

  let bytes = new Uint8Array(contenido)
  let nombreFinal = nombre
  if (bytes.length === 0) throw new ErrorBiblioteca('El archivo esta vacio.')
  if (bytes.length > MAX_TECHPACK_BYTES) throw new ErrorBiblioteca('El archivo rebasa los 15 MB.')

  // TODO TECH PACK DE EMPAQUE EN EXCEL ENTRA EN LA PLANTILLA TP-QUINI v2
  // (Roberto, 17-sep: "el sistema se debe encargar de pasarlo al formato; no
  // deberiamos tener nada de OT ni OC en los tech packs"). Un formato viejo se
  // convierte aqui, antes de calcular huella y pedazos: lo que se sube ES el
  // convertido. Si no se puede convertir, NO se sube nada y el archivo
  // vigente no se toca (ver convertirTechPackAlSubir.js). De la plantilla
  // salen tambien cliente, marca, modelo, codigos y la calificacion. Un PDF
  // no se puede convertir ni leer: queda sin cliente y sin calificar.
  let identidad = null
  let conversion = null
  if (def.campo === 'techPack') {
    identidad = { ...IDENTIDAD_VACIA }
    if (formato === 'xlsx') {
      onProgreso('Pasando el archivo al formato TP-Quini...')
      try {
        const Workbook = await cargarWorkbook()
        const { LOGO_QUINI_PNG_BASE64 } = await import('../assets/logoQuini.js')
        conversion = await pasarAlFormatoTPQuini({
          contenido,
          codigo: id,
          nombre,
          sha256Original: await sha256Hex(contenido),
          usuarioNombre: usuario.nombre,
          Workbook,
          logoBase64: LOGO_QUINI_PNG_BASE64
        })
      } catch (err) {
        // Solo la conversion vive en este catch: lo que falle al publicar
        // (permisos, concurrencia) sale con su propio error mas abajo.
        if (err instanceof ErrorConversion) throw new ErrorBiblioteca(err.message)
        throw new ErrorBiblioteca('No se pudo pasar el archivo al formato TP-Quini: ' + (err?.message || err))
      }
      bytes = conversion.contenido
      nombreFinal = conversion.nombre
      if (bytes.length > MAX_TECHPACK_BYTES) throw new ErrorBiblioteca('Al pasarlo a la plantilla el archivo rebasa los 15 MB: reduce las fotos e intenta de nuevo.')
      identidad = identidadDePlantilla(conversion.lectura)
      identidad.medicion = { ...conversion.medicion, hojas: conversion.hojas, medidoEn: new Date(), version: '2026-09-v2-plantilla' }
    } else {
      // Un PDF no se puede calificar: sin este null, update() solo toca las
      // llaves que manda y la medicion del Excel anterior seguia viva --un
      // PDF nuevo salia con el 100% de otro archivo (Codex, 17-sep).
      identidad.medicion = null
    }
  }
  const totalChunks = Math.ceil(bytes.length / CHUNK_BYTES)
  if (totalChunks > MAX_CHUNKS) throw new ErrorBiblioteca('El archivo rebasa los 15 MB.')

  onProgreso('Preparando el archivo...')
  // La huella del manifiesto es la del archivo que de verdad se guarda (el
  // convertido); la del original queda en _RAGNAR.migradoDe.
  const sha256 = await sha256Hex(bytes)

  // El documento padre tiene que existir ANTES que los chunks: las reglas de
  // los chunks leen su esPrueba para el corral. Si es nuevo, nace aqui con la
  // descripcion del catalogo (si la tiene) para que el tablero se lea solo.
  const actual = await getDoc(refDoc(id))
  if (!actual.exists()) {
    let descripcion = ''
    let modelo = ''
    let talla = ''
    let color = ''
    try {
      const datos = await datosDeCodigos([id])
      const d = datos.get(id)
      descripcion = String(d?.descripcion || '').slice(0, 200)
      // MODELO, TALLA y COLOR se copian del catalogo, no los teclea nadie: son
      // lo que permite BUSCAR POR MODELO (Lety, 2026-09-08). Si el codigo no
      // esta en el catalogo quedan vacios y no pasa nada.
      modelo = String(d?.modelo || '').slice(0, 200)
      talla = String(d?.talla || '').slice(0, 200)
      color = String(d?.color || '').slice(0, 200)
    } catch {
      /* un adorno del tablero no puede impedir subir */
    }
    await setDoc(refDoc(id), {
      codigo: id,
      descripcion,
      modelo,
      talla,
      color,
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
    // Con la huella en el id: los pedazos de esta subida no pisan los del
    // archivo vigente ni los de otra subida simultanea (ver pedazosTechPack).
    await setDoc(doc(colChunks(id), idPedazo(def.clave, sha256, i)), {
      codigo: id,
      tipo: def.clave,
      datos: Bytes.fromUint8Array(pedazo)
    })
  }
  // Los pedazos viejos se limpian DESPUES de publicar el manifiesto, y solo si
  // este archivo sigue siendo el vigente (limpiarPedazosSobrantes).

  onProgreso('Guardando...')
  // Se relee justo antes de escribir: la version sale del manifiesto VIGENTE
  // (alguien pudo subir otra mientras se subian los pedazos).
  const vigente = await getDoc(refDoc(id))
  const previo = vigente.exists() ? vigente.data()[def.campo] : null
  const manifiestoNuevo = {
    nombre: String(nombreFinal || def.clave).slice(0, 200),
    formato,
    tamano: bytes.length,
    totalChunks,
    sha256,
    version: (previo?.version || 0) + 1,
    subidoEn: serverTimestamp(),
    subidoPorUid: usuario.uid,
    subidoPorNombre: String(usuario.nombre).slice(0, 120)
  }
  // El manifiesto y el renglon de "quien lo modifico" van en UN batch: las
  // reglas exigen los dos juntos (Roberto, 15-sep: que se vea quien subio
  // cada version, tambien las del editor del contenido).
  const lote = writeBatch(db)
  lote.update(refDoc(id), {
    [def.campo]: manifiestoNuevo,
    ...(identidad || {}),
    // UN ARCHIVO NUEVO VUELVE A LA BANDEJA DE LETY: nadie hereda el visto
    // bueno del archivo anterior (Roberto, 16-sep). Subir la FTT no toca la
    // aprobacion del tech pack, y las reglas exigen las dos cosas.
    ...(def.campo === 'techPack' ? { aprobacion: null } : {}),
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario.uid,
    actualizadoPorNombre: String(usuario.nombre).slice(0, 120)
  })
  // El id lleva la huella: tras "Quitar" la version vuelve a 1. Si ese mismo
  // archivo ya se habia subido como esa version, el renglon ya existe y no se
  // reescribe (las reglas no dejan tocar un renglon, y el padre ya lo ve).
  const refVersion = doc(db, 'techPacks', id, 'versiones', `${def.clave}-${manifiestoNuevo.version}-${sha256}`)
  const yaRegistrada = await getDoc(refVersion).then((s) => s.exists()).catch(() => false)
  if (!yaRegistrada) {
    lote.set(refVersion, {
      tipo: def.clave,
      version: manifiestoNuevo.version,
      nombre: manifiestoNuevo.nombre,
      tamano: manifiestoNuevo.tamano,
      sha256,
      subidoEn: serverTimestamp(),
      subidoPorUid: usuario.uid,
      subidoPorNombre: manifiestoNuevo.subidoPorNombre
    })
  }
  try {
    await lote.commit()
  } catch (e) {
    // Lo normal: otra persona guardo una version de este mismo archivo entre
    // la relectura y el commit (la regla exige version = la vigente + 1).
    // Los pedazos de esta subida perdida NO se borran aqui: con el mismo
    // archivo subido a la vez, serian los del ganador. Quedan como basura
    // inofensiva (nadie los lee: la descarga va por la huella del manifiesto).
    if (e?.code === 'permission-denied') {
      throw new ErrorBiblioteca('No se guardo: alguien mas guardo una version de este archivo casi al mismo tiempo. Vuelve a abrirlo e intenta otra vez.')
    }
    throw e
  }
  // Una subida simultanea pudo haber limpiado pedazos justo antes de este
  // commit (los creyo sobrantes): se reponen para que el archivo publicado
  // siempre este completo. Despues se limpian los de versiones anteriores.
  await reponerPedazos(id, def, sha256, bytes, totalChunks)
  await limpiarPedazosSobrantes(id, def, sha256, manifiestoNuevo.version)
  // LO QUE SUBE LETY NO ESPERA A NADIE (Roberto, 17-sep: "cuando Lety lo sube,
  // nadie le tiene que aprobar; cuando su equipo reemplaza un archivo, si").
  // El manifiesto SIEMPRE nace sin aprobacion (las reglas lo exigen) y el visto
  // bueno es una segunda escritura, la misma del boton Aprobar: si quien sube
  // no es la jefa de diseno ni el admin, las reglas la rechazan y el archivo se
  // queda en la bandeja, que es justo lo que debe pasar. Por eso el candado no
  // es esta bandera: es el servidor.
  if (aprobarAlSubir && def.campo === 'techPack') {
    try {
      await aprobarTechPack({ codigo: id, techPack: { version: manifiestoNuevo.version, sha256 }, usuario })
      // El aviso en pantalla se arma con lo que PASO, no con la intencion: si
      // esta escritura falla, decir "quedo aprobado" seria mentirle a Lety
      // (code-reviewer, 17-sep).
      onAprobado(true)
    } catch (e) {
      console.warn('[TechPacks] Se subio pero no se pudo aprobar en automatico; queda en la bandeja:', e?.message || e)
    }
  }
  // Lo que paso al convertir (que falta, que revisar), para el aviso en pantalla.
  if (conversion) onConvertido(conversion)
  // El id con el que QUEDO guardado (con ZZTEST si es de prueba), para que el
  // aviso en pantalla diga lo mismo que la tabla.
  return id
}

async function reponerPedazos(id, def, sha256, bytes, totalChunks) {
  for (let i = 0; i < totalChunks; i++) {
    const idP = idPedazo(def.clave, sha256, i)
    if ((await getDoc(doc(colChunks(id), idP))).exists()) continue
    await setDoc(doc(colChunks(id), idP), {
      codigo: id,
      tipo: def.clave,
      datos: Bytes.fromUint8Array(bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES))
    })
  }
}

// Borra SOLO pedazos de archivos que ya se publicaron y quedaron atras: los de
// id viejo ('tp-NN') y los de las versiones ANTERIORES a esta (numero menor,
// sacadas de versiones/). Nunca los de una subida en curso ni los de una
// version mas nueva: una subida en curso aun no esta en versiones/, y una mas
// nueva tiene numero mayor (pentester, 15-sep: la limpieza por "lo que no es
// mio" borraba los pedazos recien publicados de otra subida simultanea).
// Si falla no pasa nada grave: queda basura, el archivo vigente esta entero.
async function limpiarPedazosSobrantes(id, def, sha256, version) {
  try {
    const vivo = await getDoc(refDoc(id))
    if (vivo.data()?.[def.campo]?.sha256 !== sha256) return
    const ids = Array.from({ length: MAX_CHUNKS }, (_, i) => idPedazoViejo(def.clave, i))
    const anteriores = (await versionesDelTechPack(id, 20))
      .filter((v) => v.tipo === def.clave && Number(v.version) < version && v.sha256 !== sha256)
      .slice(0, 5)
    for (const v of anteriores) {
      const cuantos = Math.min(MAX_CHUNKS, Math.ceil((Number(v.tamano) || 0) / CHUNK_BYTES))
      for (let i = 0; i < cuantos; i++) ids.push(idPedazo(def.clave, v.sha256, i))
    }
    for (const x of ids) await deleteDoc(doc(colChunks(id), x))
  } catch (err) {
    console.warn('[TechPacks] No se limpiaron pedazos viejos:', err?.code || err)
  }
}

/** Quita un documento del codigo (el otro tipo se conserva). */
export async function quitarDeBiblioteca({ codigo, tipo, usuario, onProgreso = () => {} }) {
  const def = validarTipo(tipo)
  const id = codigoComoId(codigo)
  if (!id) throw new ErrorBiblioteca('Codigo invalido.')
  onProgreso('Borrando...')
  // Se anota QUE archivo se quita antes de soltarlo: despues solo se borran
  // SUS pedazos, por id. Borrar todo lo que empezara con 'tp-' se llevaba los
  // de alguien que guardara un archivo nuevo en ese mismo momento
  // (code-reviewer, 15-sep).
  const antes = await getDoc(refDoc(id))
  const previo = antes.exists() ? antes.data()[def.campo] : null
  // Primero el manifiesto: en cuanto se va, nadie intenta leer los chunks.
  await updateDoc(refDoc(id), {
    [def.campo]: null,
    // Quitar el archivo quita el visto bueno: no queda un sello colgando de un
    // tech pack que ya no existe (pentester, 16-sep).
    ...(def.campo === 'techPack' ? { aprobacion: null } : {}),
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario?.uid || '',
    actualizadoPorNombre: String(usuario?.nombre || '').slice(0, 120)
  })
  const ids = Array.from({ length: MAX_CHUNKS }, (_, i) => idPedazoViejo(def.clave, i))
  if (previo?.sha256 && previo?.totalChunks) {
    for (let i = 0; i < Math.min(MAX_CHUNKS, previo.totalChunks); i++) ids.push(idPedazo(def.clave, previo.sha256, i))
  }
  for (let i = 0; i < ids.length; i += 10) {
    const lote = writeBatch(db)
    ids.slice(i, i + 10).forEach((x) => lote.delete(doc(colChunks(id), x)))
    await lote.commit()
  }
}

// LOS DATOS QUE SE EDITAN A MANO, y su version de checklist.
// 'datosEditables' es lo que Lety teclea; los campos sueltos modelo/talla/color
// que traen los documentos viejos son lo que dijo el CATALOGO y quedan
// congelados. Cuando los dos existen, MANDA el de Lety: ella ve el Drive.
// (CHECKLIST_VERSION se re-exporta arriba, desde techPackNucleo.js)

// Compara dos mapas por CONTENIDO, sin importar el ORDEN de llaves. La regla
// de Firestore ('datosEditables != resource.data...') compara mapas por
// contenido (asi es Firestore); JSON.stringify normal compara por el orden en
// que las llaves se insertaron, y eso desincroniza al cliente: si Lety quita
// una respuesta del checklist y la vuelve a poner igual, la llave se
// reinserta al final, JSON.stringify ya no coincide, el cliente cree que
// cambio y manda el batch, pero la regla ve el mismo contenido y lo rechaza.
function serializarOrdenado(v) {
  if (Array.isArray(v)) return '[' + v.map(serializarOrdenado).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + serializarOrdenado(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}
export function mismosDatos(a, b) {
  return serializarOrdenado(a ?? {}) === serializarOrdenado(b ?? {})
}

// (datosDelTechPack se re-exporta arriba, desde techPackNucleo.js)

/**
 * Guarda los datos que Lety escribio Y su renglon de historial, en un solo
 * batch. La regla de Firestore exige las dos escrituras amarradas: no se puede
 * editar sin dejar rastro, ni sembrar un rastro de una edicion que no ocurrio.
 *
 * @param {object} p
 * @param {string} p.codigo
 * @param {object} p.actual        el documento como esta HOY (trae revision)
 * @param {object} p.datos         {modelo, talla, color, notas, checklist}
 * @param {{uid: string, nombre: string}} p.usuario
 */
export async function editarDatosTechPack({ codigo, actual, datos, usuario }) {
  const id = codigoComoId(codigo)
  if (!id) throw new ErrorBiblioteca('Codigo invalido.')
  if (actual?.apuntaA) {
    // Un alias no tiene datos propios: hereda los del codigo real. Editarlo
    // haria que las dos copias divergieran. La regla tambien lo rechaza.
    throw new ErrorBiblioteca(
      `${codigo} es un atajo hacia ${actual.apuntaA}. Edita ${actual.apuntaA}, que es el que tiene el archivo.`
    )
  }
  if (!usuario?.uid) throw new ErrorBiblioteca('No se pudo saber quien esta editando.')
  if (!usuario?.nombre) {
    // El nombre va anclado al perfil en la regla: sin el, la escritura se
    // rechaza. Mas vale decirlo aqui que dejar un permission-denied a secas.
    throw new ErrorBiblioteca('Tu perfil no tiene nombre completo. Pideselo a Roberto antes de editar.')
  }

  // Se manda SOLO lo que trae contenido: un campo vacio no se guarda como ''
  // para que el snapshot de antes y despues no se llene de basura.
  const limpio = {}
  const texto = (v, max) => String(v ?? '').trim().slice(0, max)
  if (texto(datos.modelo, 160)) limpio.modelo = texto(datos.modelo, 160)
  if (texto(datos.talla, 60)) limpio.talla = texto(datos.talla, 60)
  if (texto(datos.color, 200)) limpio.color = texto(datos.color, 200)
  if (texto(datos.notas, 2000)) limpio.notas = texto(datos.notas, 2000)
  if (datos.checklist && Object.keys(datos.checklist).length) {
    limpio.checklist = datos.checklist
    limpio.checklistVersion = CHECKLIST_VERSION
  }
  // Los codigos u ordenes a los que pertenece este tech pack, tecleados por
  // Lety. Se normalizan igual que en el buscador (mayusculas, sin espacios) y
  // sin repetidos, que es lo que exige la regla.
  if (Array.isArray(datos.codigos)) {
    const cods = [...new Set(datos.codigos.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))].slice(0, 60)
    if (cods.length) limpio.codigos = cods
  }

  const antes = actual?.datosEditables || {}
  // Nada que guardar: se sale sin quemar una revision ni un renglon de
  // historial que diga que no cambio nada.
  if (mismosDatos(antes, limpio)) return { sinCambios: true }

  const revision = Number(actual?.revision || 0) + 1
  const refHistorial = doc(collection(db, 'techPacks', id, 'historial'))
  const lote = writeBatch(db)
  lote.update(refDoc(id), {
    datosEditables: limpio,
    revision,
    ultimaEdicionId: refHistorial.id,
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario.uid,
    actualizadoPorNombre: usuario.nombre
  })
  lote.set(refHistorial, {
    revision,
    antes,
    despues: limpio,
    cuando: serverTimestamp(),
    quienUid: usuario.uid,
    quienNombre: usuario.nombre
  })
  try {
    await lote.commit()
  } catch (e) {
    if (e?.code === 'permission-denied') {
      // La causa mas probable no es un permiso: es que alguien mas edito
      // mientras el modal estaba abierto y la revision ya no cuadra. Decirlo
      // asi evita que Lety crea que perdio el acceso.
      throw new ErrorBiblioteca(
        'No se guardo. Es probable que alguien mas haya editado este tech pack mientras lo tenias abierto: cierra y vuelve a abrirlo para ver como quedo.'
      )
    }
    throw e
  }
  return { revision }
}

/** El historial de ediciones, lo mas nuevo primero. */
export async function historialDelTechPack(codigo, cuantos = 30) {
  const id = codigoComoId(codigo)
  if (!id) return []
  const snap = await getDocs(
    query(collection(db, 'techPacks', id, 'historial'), orderBy('cuando', 'desc'), limit(cuantos))
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * APROBAR un tech pack (o retirarle la aprobación). Roberto, 16-sep: lo que
 * sube el equipo de Lety no entra a la biblioteca —ni se le puede mandar a una
 * maquila— hasta que ella lo revisa y lo aprueba.
 *
 * La aprobación es DE ESTA VERSIÓN: guarda la huella y el número del archivo
 * que se está aprobando. Si alguien subió otro mientras tanto, el servidor lo
 * rechaza en vez de aprobar a ciegas lo que no se vio (Codex, 16-sep).
 */
export async function aprobarTechPack({ codigo, techPack, usuario, aprobar = true, aprobacionVigente = null }) {
  const id = codigoComoId(codigo)
  if (!id) throw new ErrorBiblioteca('Codigo invalido.')
  if (!usuario?.uid || !usuario?.nombre) throw new ErrorBiblioteca('Tu cuenta no tiene nombre configurado.')
  if (aprobar && !techPack?.sha256) throw new ErrorBiblioteca('Ese codigo no tiene archivo que aprobar.')
  // HISTORIAL DE APROBACIONES (Roberto, 18-sep: "que quede guardado"). Cada
  // aprobar o retirar deja un EVENTO inmutable en techPacks/{id}/aprobaciones,
  // en la MISMA escritura, y el documento apunta a el. Las reglas exigen las
  // dos cosas juntas: sin evento no hay visto bueno.
  const nombre = String(usuario.nombre).slice(0, 120)
  const refEvento = doc(collection(db, 'techPacks', id, 'aprobaciones'))
  const lote = writeBatch(db)
  lote.update(refDoc(id), {
    aprobacion: aprobar
      ? { version: techPack.version || 1, sha256: techPack.sha256, porUid: usuario.uid, porNombre: nombre, en: serverTimestamp() }
      : null,
    ultimoEventoAprobacionId: refEvento.id,
    actualizadoEn: serverTimestamp(),
    actualizadoPorUid: usuario.uid,
    actualizadoPorNombre: nombre
  })
  // Al retirar, el evento dice QUE version se retiro (la del sello vigente).
  const deQue = aprobar ? techPack : aprobacionVigente || techPack
  lote.set(refEvento, {
    accion: aprobar ? 'aprobar' : 'retirar',
    version: deQue?.version || 1,
    sha256: deQue?.sha256 || '',
    porUid: usuario.uid,
    porNombre: nombre,
    en: serverTimestamp()
  })
  try {
    await lote.commit()
  } catch (e) {
    if (e?.code === 'permission-denied') {
      throw new ErrorBiblioteca(
        aprobar
          ? 'No se aprobo: es probable que alguien haya subido otra version mientras lo revisabas. Recarga y vuelve a verlo antes de aprobar.'
          : 'No se pudo retirar la aprobacion. Recarga la pagina e intenta otra vez.'
      )
    }
    throw e
  }
}

/** ¿Este tech pack ya lo aprobó Lety, y para el archivo que tiene hoy? */
export function estaAprobado(b) {
  const a = b?.aprobacion
  return Boolean(a && b?.techPack?.sha256 && a.sha256 === b.techPack.sha256)
}

/** El historial de aprobaciones (aprobar, retirar, y los traslados que hizo
 *  RAGNAR al rellenar datos del original), el mas nuevo primero. [] si falla. */
export async function aprobacionesDelTechPack(codigo, cuantos = 30) {
  const id = codigoComoId(codigo)
  if (!id) return []
  try {
    const snap = await getDocs(query(collection(db, 'techPacks', id, 'aprobaciones'), orderBy('en', 'desc'), limit(cuantos)))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn('[TechPacks] No se pudo leer el historial de aprobaciones:', err?.code || err)
    return []
  }
}

/** Las versiones subidas (tech pack y FTT), la mas nueva primero. [] si falla. */
export async function versionesDelTechPack(codigo, cuantos = 20) {
  const id = codigoComoId(codigo)
  if (!id) return []
  try {
    const snap = await getDocs(query(collection(db, 'techPacks', id, 'versiones'), orderBy('subidoEn', 'desc'), limit(cuantos)))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn('[TechPacks] No se pudieron leer las versiones:', err?.code || err)
    return []
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
  // Por id y SIN listar la subcoleccion (pentester, 15-sep): pedazos basura
  // sembrados con otros prefijos no le cuestan nada a quien descarga, y las
  // reglas ya no dejan listar a quien solo ve tech packs.
  const n = manifiesto.totalChunks
  const leer = (ids) => Promise.all(ids.map((x) => getDoc(doc(colChunks(id), x))))
  let snaps = await leer(Array.from({ length: n }, (_, i) => idPedazo(def.clave, manifiesto.sha256, i)))
  if (!snaps[0].exists()) snaps = await leer(Array.from({ length: n }, (_, i) => idPedazoViejo(def.clave, i)))
  const pedazos = []
  for (let i = 0; i < n; i++) {
    const chunk = snaps[i].exists() ? snaps[i].data() : null
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
/**
 * Buscar un tech pack COMO SEA (Roberto, 2026-09-10): "que busques por OC, por
 * OT y por codigo, de todas las maneras posibles para encontrar el que tu
 * quieres". Antes solo se podia por OT, y si el plan no conocia esa OT no
 * habia nada que hacer.
 *
 * Se intenta en este orden y se devuelve TODO lo que encuentre:
 *   1. como ORDEN DE TRABAJO  -> sus codigos del plan y los tech packs de esos
 *   2. como ORDEN DE COMPRA   -> todas sus OT, y de ahi igual
 *   3. como CODIGO o FOLIO    -> el documento directo (siguiendo el alias)
 *   4. como TEXTO            -> lo que traiga ese modelo o esa descripcion
 */
export async function buscarTechPacksComoSea(texto, esPrueba, { modo = 'orden' } = {}) {
  const q = String(texto || '').trim()
  if (!q) return { por: '', conTechPack: [], sinTechPack: [], codigos: [] }
  if (modo === 'modelo') return buscarTechPacksPorModeloOCliente(q, esPrueba)
  const juntar = (a, b) => [...new Map([...a, ...b].map((x) => [x.codigo, x])).values()]
  let conTechPack = []
  let sinTechPack = []
  let codigos = []
  let por = ''

  // 1. como orden de trabajo
  try {
    const r = await techPacksDeLaOt(normalizarOt(q) || q, esPrueba)
    if (r.codigos.length) {
      por = 'orden de trabajo'
      conTechPack = juntar(conTechPack, r.conTechPack)
      sinTechPack = juntar(sinTechPack, r.sinTechPack)
      codigos = [...new Set([...codigos, ...r.codigos])]
    }
  } catch (e) { console.warn('[TechPacks] busqueda por OT:', e) }

  // 2. como orden de compra
  if (!conTechPack.length) {
    try {
      const ots = await otsDeLaOc(normalizarOc(q) || q)
      if (ots?.length) {
        por = 'orden de compra'
        for (const ot of ots.slice(0, 25)) {
          const r = await techPacksDeLaOt(ot, esPrueba)
          conTechPack = juntar(conTechPack, r.conTechPack)
          sinTechPack = juntar(sinTechPack, r.sinTechPack)
          codigos = [...new Set([...codigos, ...r.codigos])]
        }
      }
    } catch (e) { console.warn('[TechPacks] busqueda por OC:', e) }
  }

  // 3. como codigo o folio de ficha, directo
  if (!conTechPack.length) {
    const id = codigoComoId(q)
    if (id) {
      try {
        const d = await getDoc(refDoc(id))
        if (d.exists()) {
          const dato = { id: d.id, ...d.data() }
          const real = dato.apuntaA ? await getDoc(refDoc(codigoComoId(dato.apuntaA))) : null
          const fuente = real?.exists() ? { id: real.id, ...real.data() } : dato
          por = dato.apuntaA ? 'folio de ficha' : 'codigo'
          codigos = [id]
          if (fuente.techPack) {
            conTechPack = [{ codigo: fuente.id, descripcion: fuente.descripcion || '', folio: dato.apuntaA ? id : '', techPack: fuente.techPack }]
          } else {
            sinTechPack = [{ codigo: fuente.id, descripcion: fuente.descripcion || '' }]
          }
        }
      } catch (e) { console.warn('[TechPacks] busqueda por codigo:', e) }
    }
  }

  return { por, conTechPack, sinTechPack, codigos }
}

// La biblioteca para buscar, una lectura por minuto por mundo: Lindbergh busca,
// cambia de pestaña y vuelve a buscar, y cada vez releia la coleccion entera
// (code-reviewer, 15-sep). Un tech pack recien subido tarda a lo mas un minuto
// en aparecer aqui; en la pestana Tech packs aparece al instante.
const cacheBiblioteca = new Map() // esPrueba -> { en, promesa }
function bibliotecaParaBuscar(esPrueba) {
  const c = cacheBiblioteca.get(esPrueba)
  if (c && Date.now() - c.en < 60000) return c.promesa
  const promesa = getDocs(query(collection(db, 'techPacks'), where('esPrueba', '==', esPrueba)))
    .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    .catch((err) => {
      cacheBiblioteca.delete(esPrueba)
      throw err
    })
  cacheBiblioteca.set(esPrueba, { en: Date.now(), promesa })
  return promesa
}

/**
 * LA BUSQUEDA ESTANDAR (Roberto, 15-sep): por MODELO, CLIENTE o CODIGO.
 * Todas las palabras tienen que aparecer (coincideTechPack), sin acentos. Se
 * leen los tech packs del mundo de quien busca (son ~120: una consulta), y un
 * codigo o folio de ficha exacto va primero. Nunca se pega solo: siempre
 * devuelve la lista para que se elija (Codex: una busqueda por texto puede
 * traer varias tallas del mismo modelo).
 */
export async function buscarTechPacksPorModeloOCliente(texto, esPrueba) {
  const q = String(texto || '').trim()
  const vacio = { por: 'modelo, cliente o codigo', conTechPack: [], sinTechPack: [], codigos: [] }
  if (!q) return vacio
  const todos = await bibliotecaParaBuscar(esPrueba === true)
  const porId = new Map(todos.map((b) => [b.id, b]))
  const exacto = codigoComoId(q)
  const vistos = new Set()
  const conTechPack = []
  const sinTechPack = []
  const agrega = (b, folio = '') => {
    const real = b.apuntaA ? porId.get(codigoComoId(b.apuntaA)) : b
    if (!real || vistos.has(real.id)) return
    vistos.add(real.id)
    const renglon = {
      codigo: real.id,
      descripcion: real.descripcion || '',
      folio,
      cliente: textoDe(real.cliente),
      modelo: modelosDelTechPack(real).join(', '),
      talla: textoDe(real.tallaPlantilla) || real.datosEditables?.talla || real.talla || ''
    }
    // SIN APROBAR NO SE MANDA A UNA MAQUILA (Roberto, 16-sep): lo que sube el
    // equipo de Lety espera su visto bueno. Aqui se trata como "todavia no hay
    // tech pack", que es lo que es para quien encarga.
    if (real.techPack && estaAprobado(real)) conTechPack.push({ ...renglon, techPack: real.techPack })
    else sinTechPack.push({ ...renglon, porAprobar: Boolean(real.techPack) })
  }
  const directo = exacto ? porId.get(exacto) : null
  if (directo) agrega(directo, directo.apuntaA ? exacto : '')
  todos.filter((b) => !b.apuntaA && coincideTechPack(b, q)).forEach((b) => agrega(b))
  const orden = (a, b) => (a.cliente || '~').localeCompare(b.cliente || '~', 'es') || a.modelo.localeCompare(b.modelo, 'es') || a.codigo.localeCompare(b.codigo, 'es', { numeric: true })
  return { ...vacio, conTechPack: conTechPack.sort(orden), sinTechPack: sinTechPack.sort(orden), codigos: [...vistos] }
}

export async function techPacksDeLaOt(ot, esPrueba, renglonesYaLeidos = null) {
  const todosLosRenglones = renglonesYaLeidos || (await renglonesDeLaOt(ot))
  // Deduplicado por codigo (Set), conservando el PRIMER renglon como
  // descripcion representativa: un mismo codigo en dos tallas del plan no
  // debe buscarse ni contarse dos veces en la biblioteca.
  const vistos = new Set()
  const renglones = []
  const codigos = []
  todosLosRenglones.forEach((r) => {
    const id = codigoComoId(r.codigo)
    if (!id || vistos.has(id)) return
    vistos.add(id)
    codigos.push(id)
    renglones.push(r)
  })
  if (!codigos.length) return { codigos: [], conTechPack: [], sinTechPack: [] }
  const lecturas = await Promise.all(codigos.map((c) => getDoc(refDoc(c))))
  // ALIAS: el plan maestro conoce muchos disenos por su FOLIO DE FICHA (1561-I,
  // 2711), no por el nombre del tech pack. Un documento techPacks/{folio} con
  // `apuntaA` dice a que codigo real pertenece; aqui se sigue el puntero UNA
  // vez (no en cadena) y el archivo se lee del documento real.
  const conTechPack = []
  const sinTechPack = []
  const resueltos = await Promise.all(
    lecturas.map(async (snap) => {
      const d = snap.exists() ? snap.data() : null
      if (!d?.apuntaA) return { d, real: null }
      const idReal = codigoComoId(d.apuntaA)
      if (!idReal) return { d, real: null }
      const r = await getDoc(refDoc(idReal))
      return { d, real: r.exists() ? { id: idReal, ...r.data() } : null }
    })
  )
  const pendientesDeTalla = []
  resueltos.forEach(({ d, real }, i) => {
    const codigo = codigos[i]
    const fuente = real || d
    const delMundo = fuente && (fuente.esPrueba === true) === (esPrueba === true)
    if (delMundo && fuente.techPack?.totalChunks && estaAprobado(fuente)) {
      conTechPack.push({
        // El codigo que se usa para BAJAR el archivo es el real; el folio se
        // conserva para decir por que se encontro.
        codigo: real ? real.id : codigo,
        folio: real ? codigo : null,
        descripcion: fuente.descripcion || renglones[i]?.descripcion || '',
        techPack: fuente.techPack
      })
    } else {
      pendientesDeTalla.push(i)
    }
  })
  // TALLAS: el plan dice "WKD225T401" y la biblioteca guarda una entrada por
  // talla ("WKD225T401-4-6", "-7-9", "-10-13"), porque cada talla tiene su
  // propia ficha y su propio tech pack. Si no hubo documento exacto, se buscan
  // los que empiecen con "CODIGO-" y se ofrecen todos: Lindbergh elige cual.
  for (const i of pendientesDeTalla) {
    const codigo = codigos[i]
    let tallas = []
    try {
      const snap = await getDocs(
        query(
          collection(db, 'techPacks'),
          where('esPrueba', '==', esPrueba === true),
          where('codigo', '>=', codigo + '-'),
          where('codigo', '<', codigo + '.'),
          limit(12)
        )
      )
      tallas = snap.docs.map((x) => x.data()).filter((x) => !x.apuntaA && x.techPack?.totalChunks)
    } catch (err) {
      // NO se traga: un fallo de red/permisos/indice aqui NO es lo mismo que
      // "Lety no lo ha subido" (sinTechPack), y tratarlo igual podria llevar
      // a pegar automaticamente el UNICO tech pack restante con una premisa
      // falsa. Se relanza con el codigo para que quien llama lo clasifique
      // como fallo, no como "falta subirlo".
      throw new ErrorBiblioteca(`No se pudo consultar la biblioteca de tallas de ${codigo}: ${err?.message || err}`)
    }
    const aprobadas = tallas.filter((t) => estaAprobado(t))
    if (aprobadas.length) {
      aprobadas.forEach((t) =>
        conTechPack.push({
          codigo: t.codigo,
          folio: null,
          talla: t.codigo.slice(codigo.length + 1),
          descripcion: t.descripcion || renglones[i]?.descripcion || '',
          techPack: t.techPack
        })
      )
    } else {
      sinTechPack.push({ codigo, descripcion: renglones[i]?.descripcion || '' })
    }
  }
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
  // Igual que el resto de esta pantalla (resumen.conTp, evaluarDocumento,
  // estadoDelCodigo): un tech pack sin aprobar por Lety no cuenta como
  // cubierto, o el mismo codigo sale "listo" aqui y "por aprobar" al lado
  // (Codex, 17-sep).
  const tienen = new Set(biblioteca.filter((b) => b.techPack?.totalChunks && estaAprobado(b)).map((b) => b.codigo))
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
