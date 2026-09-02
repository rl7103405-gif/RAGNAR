// EL APARTADO DE UNA ORDEN DE TRABAJO (2026-09-02).
//
// Una orden de compra se reparte entre varias maquilas; una ORDEN DE TRABAJO
// no. Lo pidio el papa de Roberto: *"ordenes de trabajo... que solo vayan a una
// maquila, y deberiamos ya de bloquear"*, y esa misma tarde confirmo como debe
// bloquear: *"para desbloquearlo o poder hacer lo que pida permiso para mi papa
// y quede en el registro"*.
//
// Antes esto se comprobaba SOLO en la pantalla (leer las tareas vivas y
// preguntar si alguien ya tenia la OT). Eso deja una rendija: entre la lectura
// y la escritura, dos personas pueden crear la misma OT en dos maquilas y las
// dos pasan. Aqui el candado lo pone el SERVIDOR.
//
// Como funciona: por cada OT hay UN documento
//
//   otsAsignadas/{otKey}  ->  { ot, asignaciones: { <maquilaId>: <tareaId> } }
//
// que se escribe EN EL MISMO LOTE que la tarea. Crear ese documento solo
// funciona si no existe; el segundo intento es un 'update' y las reglas lo
// niegan, asi que la carrera la resuelve Firestore y no la suerte.
//
// ⚠️ EL ID VA EN HEXADECIMAL, no la OT tal cual. Una OT puede traer sufijo
// cuando se repite ('7887/A' NO es la '7887' -- Roberto, 2026-09-02: *"nos
// quedamos con los cuatro numeros, pero si hay una repetida y tiene el slash,
// pues ocupa eso"*), y una barra PARTE la ruta de un documento en Firestore:
// 'otsAsignadas/7887/A' seria otra coleccion, no un documento. Con el
// hexadecimal el ID nunca trae caracteres de ruta, sigue siendo unico por OT, y
// -- lo importante -- las reglas pueden recalcularlo y comprobar que el ID
// corresponde a la OT que dice el contenido.
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { normalizarOt } from './planMaestro'

export class ErrorOtAsignada extends Error {
  constructor(mensaje, datos = {}) {
    super(mensaje)
    Object.assign(this, datos)
  }
}

/** El tipo de permiso que autoriza el papa para saltarse el candado. Mismo
 *  mecanismo que ya se usa para corregir un PDF ya enviado. */
export const TIPO_PERMISO_OT = 'ot_segunda_maquila'

/**
 * El ID del apartado: la OT en hexadecimal.
 *
 * No es criptografia ni pretende esconder nada -- es solo una forma de escribir
 * la OT que no puede contener '/', '.' ni nada que rompa una ruta, y que las
 * reglas saben rehacer con toUtf8().toHexString().
 */
export function claveDeOt(ot, esPrueba = false) {
  const canonica = normalizarOt(ot)
  if (!canonica) return ''
  const bytes = new TextEncoder().encode(canonica)
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  // ⚠️ EL MUNDO VA EN EL ID. La orden 7887 es la MISMA cadena para la cuenta
  // demo y para la real, asi que sin este prefijo las dos escribirian el mismo
  // documento: ensayar con la maquila ficticia dejaria apartada una orden de
  // verdad, y al soltarla la demo tocaria el apartado real. Separar los mundos
  // aqui tambien deja al limpiador barrer lo de prueba por prefijo.
  return esPrueba ? `zz_${hex}` : hex
}

export const refApartado = (ot, esPrueba = false) =>
  doc(db, 'otsAsignadas', claveDeOt(ot, esPrueba))

/** El formato que aceptan las reglas. Se valida IGUAL en los dos lados a
 *  proposito: si el cliente fuera mas laxo, una orden con punto ('7887.A')
 *  moriria en el servidor con un 'permission-denied' que no explica nada. */
export const OT_VALIDA = /^[1-9A-Z][0-9A-Z/-]*$/

export function otAceptable(ot) {
  const canonica = normalizarOt(ot)
  return Boolean(canonica) && OT_VALIDA.test(canonica) && !canonica.startsWith('OT')
}

/**
 * El sujeto del permiso: la OT **y** la maquila, nunca la OT sola.
 *
 * ⚠️ Esto importa. Si el permiso fuera "para la OT 7887" a secas, serviria para
 * mandarla a CUALQUIER maquila, y el papa estaria firmando una llave mas ancha
 * de la que cree estar firmando. Autoriza una excepcion concreta: esta orden,
 * con esta maquila.
 */
export function sujetoDelPermiso(ot, maquilaId) {
  return `${normalizarOt(ot)}__${maquilaId}`
}

/** Lee el apartado de una OT. null si nadie la tiene. */
export async function apartadoDeLaOt(ot, esPrueba = false) {
  if (!normalizarOt(ot)) return null
  const snap = await getDoc(refApartado(ot, esPrueba))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Las maquilas que hoy tienen esa OT. Vacio si esta libre. */
export function maquilasDelApartado(apartado) {
  return Object.keys(apartado?.asignaciones || {})
}

/**
 * ¿Puede esta maquila tomar la OT? Devuelve el conflicto para que la pantalla
 * lo explique -- no lanza: quien decide que hacer es la pantalla.
 *
 * { libre } | { yaEsMia } | { ocupadaPor: maquilaId, tareaId }
 */
export function revisarApartado(apartado, maquilaId) {
  const maquilas = maquilasDelApartado(apartado)
  if (!maquilas.length) return { libre: true }
  if (maquilas.includes(maquilaId)) {
    return { yaEsMia: true, tareaId: apartado.asignaciones[maquilaId] }
  }
  return { ocupadaPor: maquilas[0], tareaId: apartado.asignaciones[maquilas[0]] }
}

/**
 * Apunta en el LOTE el apartado de la OT. No commitea: quien llama mete esto
 * junto con la tarea, para que o queden las dos cosas o ninguna.
 *
 * @param existente  el apartado que se leyo antes (null si no habia)
 * @param permiso    autorizacion del papa, si esta es una segunda maquila
 */
export function apuntarApartadoEnElLote(
  lote,
  { ot, maquilaId, tareaId, existente, permiso = null, esPrueba = false }
) {
  const canonica = normalizarOt(ot)
  if (!canonica) return
  const ref = refApartado(canonica, esPrueba)
  if (!existente) {
    // Primera vez. Es un CREATE: si alguien se adelanto por milisegundos, este
    // write se convierte en update y las reglas lo rechazan. Ese rechazo es el
    // candado de verdad.
    lote.set(ref, {
      ot: canonica,
      asignaciones: { [maquilaId]: tareaId },
      // A QUE maquila se refiere este movimiento. Las reglas no pueden recorrer
      // el conjunto de llaves que cambio -- solo contarlo --, asi que sin este
      // campo no podrian comprobar CUAL maquila entro o salio.
      ultimaMaquila: maquilaId,
      ...(esPrueba ? { esPrueba: true } : {}),
      creadoEn: serverTimestamp()
    })
    return
  }
  // Ya existia: se AGREGA esta maquila. Las reglas solo lo permiten si viene un
  // permiso vigente para esta OT y esta maquila, y ese permiso se consume en
  // este mismo lote (lo hace quien llama).
  lote.update(ref, {
    [`asignaciones.${maquilaId}`]: tareaId,
    ultimaMaquila: maquilaId,
    ...(permiso ? { ultimoPermisoId: permiso.solicitudId || permiso.id || '' } : {})
  })
}

/**
 * Suelta el apartado al cerrar o cancelar la tarea, EN EL MISMO write que la
 * cierra.
 *
 * ⚠️ Esta es la parte delicada de todo el candado, no la de apartar: si una
 * tarea se cancela y el apartado no se suelta, esa OT queda muerta para
 * siempre y nadie va a entender por que. Por eso va en el mismo lote que el
 * cierre: o se cierra y se suelta, o no pasa ninguna de las dos.
 *
 * Se quita SOLO la llave de esta maquila. Si era la ultima, el documento se
 * queda con el mapa vacio en vez de borrarse: borrarlo obligaria a distinguir
 * "no existe" de "existe vacio" en cada lectura, y un mapa vacio ya significa
 * exactamente 'libre'.
 */
export function soltarApartadoEnElLote(lote, { ot, maquilaId, esPrueba = false }) {
  const canonica = normalizarOt(ot)
  if (!canonica) return
  lote.update(refApartado(canonica, esPrueba), {
    [`asignaciones.${maquilaId}`]: deleteField(),
    ultimaMaquila: maquilaId
  })
}
