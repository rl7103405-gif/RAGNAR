// RECEPCION EN PRODUCTO TERMINADO: lo que Valeria cuenta cuando la mercancia
// llega de la maquila.
//
// Roberto, 2026-08-28: "la principal funcion de Valeria es recibir esto... que
// si ahorita le llega algo, que lo registre".
//
// ⚠️ POR QUE ESTO SE PUEDE CONSTRUIR HOY, aunque lo que la maquila declara
// todavia no se guarde. La recepcion NO necesita el dato de la maquila: es el
// acta de PT, y su valor esta justo en ser INDEPENDIENTE. PT declara lo que
// SUS OJOS contaron; lo encargado sale de la tarea (que si esta guardada) y la
// diferencia entre ambos es el hallazgo. El dia que se persista lo que la
// maquila declaro, seran TRES columnas —encargado, declarado, recibido— sin
// que haya que rehacer nada de aqui.
//
// Por eso PT no edita la tarea ni corrige a la maquila: escribe su propio
// documento. Si un dia hay pleito, existen las dos versiones, cada una con su
// nombre y su hora.
//
// La recepcion es INMUTABLE una vez guardada, como la bitacora de PDFs: es el
// acta de lo que se conto ese dia. Si algo salio mal se registra otra vez y se
// explica en la nota; lo que no se hace es reescribir el pasado.
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../firebase/config'

export class ErrorRecepcion extends Error {}

/** Los tres desenlaces de un renglon. El estado se DERIVA de las cantidades:
 *  no se le pide a nadie que lo teclee y que ademas cuadre con el numero. */
export function estadoDelRenglon(esperada, recibida) {
  const e = Number(esperada)
  const r = Number(recibida)
  if (!Number.isFinite(r)) return 'sin_contar'
  if (!Number.isFinite(e) || e <= 0) return 'sin_referencia'
  if (r === e) return 'completo'
  return r < e ? 'faltante' : 'sobrante'
}

export const ETIQUETA_ESTADO = {
  completo: 'Llegó completo',
  faltante: 'Faltó',
  sobrante: 'Llegó de más',
  sin_contar: 'Sin contar',
  sin_referencia: 'Sin cantidad encargada'
}

const texto = (v, max) => String(v ?? '').trim().slice(0, max)

/**
 * Guarda el acta de recepcion de una tarea.
 *
 * tarea:     la tarea de ensamble tal como la ve PT (trae maquilaId, titulo,
 *            ot y renglones con lo ENCARGADO).
 * contado:   { [codigo]: { cantidad, nota } } — lo que PT conto de verdad.
 */
export async function registrarRecepcionPT({ tarea, contado, nota, usuario, esPrueba }) {
  if (!usuario?.uid || !usuario?.nombre) {
    throw new ErrorRecepcion('Tu cuenta no tiene nombre configurado.')
  }
  if (!tarea?.id || !tarea?.maquilaId) throw new ErrorRecepcion('Falta la tarea.')

  const renglones = (tarea.renglones || []).map((r) => {
    const c = contado?.[r.codigo] || {}
    const recibida = c.cantidad === '' || c.cantidad == null ? null : Number(c.cantidad)
    const esperada = Number(r.cantidad)
    return {
      codigo: texto(r.codigo, 60),
      descripcion: texto(r.descripcion, 200),
      unidad: texto(r.unidad || 'packs', 30),
      cantidadEncargada: Number.isFinite(esperada) ? esperada : null,
      cantidadRecibida: Number.isFinite(recibida) && recibida >= 0 ? recibida : null,
      estado: estadoDelRenglon(esperada, recibida),
      nota: texto(c.nota, 200)
    }
  })

  if (renglones.length === 0) throw new ErrorRecepcion('La tarea no trae renglones.')
  // Se exige contar AL MENOS uno. Guardar un acta con todo vacio no dice
  // "llego cero": dice que nadie conto, y despues nadie sabe distinguirlo.
  if (!renglones.some((r) => r.cantidadRecibida !== null)) {
    throw new ErrorRecepcion('Escribe cuánto llegó de al menos un código.')
  }

  const conProblema = renglones.filter((r) => r.estado === 'faltante' || r.estado === 'sobrante')

  await addDoc(collection(db, 'recepcionesPT'), {
    maquilaId: texto(tarea.maquilaId, 60),
    tareaId: texto(tarea.id, 60),
    tareaTitulo: texto(tarea.titulo, 200),
    ot: texto(tarea.ot, 40),
    renglones,
    // Se guarda ya resuelto para no recalcularlo en cada pantalla que lo lea,
    // y para poder filtrar "las que no cuadraron" sin abrir cada documento.
    cuadro: conProblema.length === 0,
    renglonesConProblema: conProblema.length,
    nota: texto(nota, 300),
    recibidoEn: serverTimestamp(),
    recibidoPorUid: usuario.uid,
    recibidoPorNombre: texto(usuario.nombre, 120),
    esPrueba: esPrueba === true
  })
}

/** Las recepciones del mundo que corresponde, de la mas nueva a la mas vieja. */
export function escucharRecepcionesPT(esPrueba, alRecibir, alFallar) {
  const q = query(
    collection(db, 'recepcionesPT'),
    where('esPrueba', '==', esPrueba === true),
    orderBy('recibidoEn', 'desc')
  )
  return onSnapshot(
    q,
    (snap) => alRecibir(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    alFallar
  )
}
