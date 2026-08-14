// ENVIOS DE AVIOS: Alvaro (almacen) le manda material a una maquila, y la
// maquila declara cuanto llego DE VERDAD de cada codigo.
//
// Ese "cuanto llego" es la base del inventario y de las disputas: por eso el
// acuse es inmutable y se firma con el nombre del perfil, no con texto libre.
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { ordenarPorFechaDesc } from './solicitudesAvios'
import { agregarMovimientosAlLote, leerSaldos, esChoqueDeSaldo } from './inventarioAvios'

export class ErrorEnvioAvios extends Error {}

/** Alvaro manda material. renglones: [{codigo, descripcion, cantidad, unidad}]
 *  solicitudId (opcional): la solicitud de la maquila que este envio atiende. */
export async function enviarAvios({ maquilaId, maquilaNombre, renglones, nota, solicitudId, usuario }) {
  const limpios = (renglones || [])
    .map((r) => ({
      codigo: String(r.codigo || '').trim().toUpperCase(),
      descripcion: String(r.descripcion || '').slice(0, 200),
      cantidad: Number(r.cantidad),
      unidad: String(r.unidad || 'piezas')
    }))
    .filter((r) => r.codigo && Number.isFinite(r.cantidad) && r.cantidad > 0)

  // El inventario cuenta ENTEROS (los movimientos y saldos truncan y las
  // reglas exigen int): un 0.75 no se trunca en silencio, se rechaza. Aplica
  // tambien a los avios en kg — se mandan kilos completos.
  const conDecimales = limpios.find((r) => !Number.isInteger(r.cantidad))
  if (conDecimales) {
    throw new ErrorEnvioAvios(
      `La cantidad de ${conDecimales.codigo} trae decimales (${conDecimales.cantidad}): ` +
        'el inventario se cuenta en unidades enteras.'
    )
  }

  if (limpios.length === 0) throw new ErrorEnvioAvios('Agrega al menos un material con su cantidad.')
  if (limpios.length > 60) throw new ErrorEnvioAvios(`Maximo 60 materiales por envio (pusiste ${limpios.length}).`)

  const vistos = new Set()
  for (const r of limpios) {
    if (vistos.has(r.codigo)) {
      throw new ErrorEnvioAvios(`El material ${r.codigo} esta repetido: junta la cantidad en un renglon.`)
    }
    vistos.add(r.codigo)
  }
  if (!usuario?.nombre) {
    throw new ErrorEnvioAvios('Tu cuenta no tiene nombre configurado: avisale a Roberto.')
  }

  const ref = await addDoc(collection(db, 'portalMaquila', maquilaId, 'enviosAvios'), {
    maquilaId,
    maquilaNombre,
    renglones: limpios,
    nota: String(nota || '').trim().slice(0, 300),
    enviadoPorUid: usuario.uid,
    enviadoPorNombre: usuario.nombre,
    creadoEn: serverTimestamp(),
    ...(solicitudId ? { solicitudId: String(solicitudId) } : {})
  })
  return ref.id
}

/** La maquila declara cuanto llego. recibido: [{codigo, cantidad}] en el MISMO
 *  orden y tamano que los renglones del envio (la regla lo exige). */
export async function acusarAvios({ maquilaId, envio, recibido, comentario, usuario }) {
  const enviados = envio.renglones || []
  if (!Array.isArray(recibido) || recibido.length !== enviados.length) {
    throw new ErrorEnvioAvios('Hay que declarar cuanto llego de cada material del envio.')
  }
  const filas = recibido.map((r, i) => ({
    codigo: enviados[i].codigo,
    cantidad: Number(r.cantidad)
  }))
  for (const f of filas) {
    if (!Number.isFinite(f.cantidad) || f.cantidad < 0) {
      throw new ErrorEnvioAvios(`La cantidad de ${f.codigo} tiene que ser un numero (0 si no llego nada).`)
    }
    // Enteros: el inventario truncaria un 0.75 a 0 y el acuse diria otra
    // cosa que el saldo. Mejor rechazarlo aqui con mensaje claro.
    if (!Number.isInteger(f.cantidad)) {
      throw new ErrorEnvioAvios(
        `La cantidad de ${f.codigo} trae decimales (${f.cantidad}): cuenta unidades completas.`
      )
    }
  }
  const hayDiferencia = filas.some((f, i) => f.cantidad !== Number(enviados[i].cantidad))
  const nota = String(comentario || '').trim()
  if (hayDiferencia && !nota) {
    throw new ErrorEnvioAvios(
      'Las cantidades no coinciden con lo enviado: escribe una nota explicando que paso.'
    )
  }
  // 'completo' exige comentario vacio (la regla lo valida igual).
  const resultado = hayDiferencia ? 'con_diferencias' : 'completo'

  // El inventario sube por lo que la MAQUILA declara, no por lo que se
  // mando (decision de Roberto). Se leen los saldos ANTES de armar el lote:
  // cada movimiento tiene que arrancar del saldo vigente o las reglas lo
  // rechazan, y entonces se reintenta.
  const saldos = await leerSaldos(maquilaId, filas.map((f) => f.codigo))

  const lote = writeBatch(db)

  lote.set(doc(db, 'portalMaquila', maquilaId, 'acusesAvios', envio.id), {
    envioId: envio.id,
    maquilaId,
    resultado,
    recibido: filas,
    comentario: resultado === 'completo' ? '' : nota.slice(0, 300),
    recibidoPorUid: usuario.uid,
    recibidoPorNombre: usuario.nombre,
    creadoEn: serverTimestamp()
  })

  // Entradas al inventario: una por codigo, con la cantidad DECLARADA.
  agregarMovimientosAlLote({
    lote,
    maquilaId,
    renglones: filas.map((f, i) => ({
      codigo: f.codigo,
      descripcion: enviados[i].descripcion,
      unidad: enviados[i].unidad,
      cantidad: f.cantidad
    })),
    saldosPrevios: saldos,
    tipo: 'entrada_envio',
    origenTipo: 'envio',
    origenId: envio.id,
    motivo: hayDiferencia ? `Recibido con diferencias: ${nota}`.slice(0, 300) : 'Material recibido',
    movIdDe: (codigo) => `env_${envio.id}_${codigo}`,
    usuario
  })

  // Una DISCREPANCIA por cada codigo que no cuadro: es el aviso para Alvaro.
  // El inventario ya quedo con lo de la maquila; esto deja constancia de que
  // lo enviado y lo recibido no coinciden, y quien lo revisa.
  filas.forEach((f, i) => {
    const enviada = Math.trunc(Number(enviados[i].cantidad))
    const recibida = Math.trunc(Number(f.cantidad))
    if (enviada === recibida) return
    lote.set(
      doc(db, 'portalMaquila', maquilaId, 'discrepanciasAvios', `${envio.id}_${f.codigo}`),
      {
        maquilaId,
        envioId: envio.id,
        codigo: f.codigo,
        descripcion: String(enviados[i].descripcion || '').slice(0, 200),
        unidad: String(enviados[i].unidad || 'piezas'),
        cantidadEnviada: enviada,
        cantidadRecibida: recibida,
        diferencia: recibida - enviada,
        estado: 'abierta',
        comentarioMaquila: nota.slice(0, 300),
        abiertaEn: serverTimestamp()
      }
    )
  })

  try {
    await lote.commit()
  } catch (err) {
    if (esChoqueDeSaldo(err)) {
      throw new ErrorEnvioAvios(
        'Alguien mas movio este material al mismo tiempo. Vuelve a intentar: no se guardo nada.'
      )
    }
    throw err
  }

  return { resultado, hayDiferencia }
}

/** Envios de UNA maquila (su portal). */
export function escucharEnviosDeMaquila(maquilaId, onDatos, onError) {
  return onSnapshot(
    query(collection(db, 'portalMaquila', maquilaId, 'enviosAvios'), orderBy('creadoEn', 'desc')),
    (snap) => onDatos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  )
}

/** Acuses de UNA maquila, indexados por envio. */
export function escucharAcusesDeMaquila(maquilaId, onDatos, onError) {
  return onSnapshot(
    collection(db, 'portalMaquila', maquilaId, 'acusesAvios'),
    (snap) => {
      const mapa = {}
      snap.docs.forEach((d) => {
        mapa[d.id] = { id: d.id, ...d.data() }
      })
      onDatos(mapa)
    },
    onError
  )
}

/** TODOS los envios (para Alvaro). collectionGroup, solo internos.
 *  SIN orderBy: ver la nota en solicitudesAvios.js -- se ordena en el cliente
 *  para no depender de un indice de grupo que el CLI no aplica bien. */
export function escucharTodosLosEnvios(onDatos, onError) {
  return onSnapshot(
    collectionGroup(db, 'enviosAvios'),
    (snap) => onDatos(ordenarPorFechaDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    onError
  )
}

/** TODOS los acuses (para Alvaro): saber que confirmo cada maquila. */
export function escucharTodosLosAcuses(onDatos, onError) {
  return onSnapshot(
    collectionGroup(db, 'acusesAvios'),
    (snap) => {
      const mapa = {}
      snap.docs.forEach((d) => {
        const a = { id: d.id, ...d.data() }
        mapa[`${a.maquilaId}__${a.envioId}`] = a
      })
      onDatos(mapa)
    },
    onError
  )
}
