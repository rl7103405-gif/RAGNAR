// INVENTARIO DE AVIOS por maquila.
//
// Dos piezas que van SIEMPRE juntas:
//   - movimientosAvios: el LIBRO. Inmutable, firmado, y cada movimiento graba
//     el saldo antes y despues. La cadena se puede recorrer y verificar.
//   - saldosAvios: el SALDO de hoy. No se puede tocar solo: las reglas exigen
//     que se escriba en el mismo lote que el movimiento que lo explica y que
//     arranque exactamente del saldo anterior.
//
// Regla de negocio (Roberto, 2026-08-12): cuando la maquila declara que
// recibio menos (o mas) de lo que almacen mando, EL INVENTARIO SE QUEDA CON LO
// QUE DICE LA MAQUILA, y la diferencia queda registrada para que Alvaro se
// entere. No se descarta ninguna de las dos versiones: se guardan las dos.
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

export class ErrorInventario extends Error {}

/** Lee el saldo actual de un codigo. 0 si nunca ha tenido movimientos. */
export async function saldoActual(maquilaId, codigo) {
  const snap = await getDoc(doc(db, 'portalMaquila', maquilaId, 'saldosAvios', codigo))
  return snap.exists() ? Number(snap.data().cantidad) || 0 : 0
}

/**
 * Agrega al LOTE (no hace commit) los movimientos y saldos de una operacion.
 * Quien llama decide que mas va en el mismo lote (el acuse, la discrepancia),
 * y asi todo es todo-o-nada.
 *
 * renglones: [{ codigo, descripcion, unidad, cantidad }] — cantidad FIRMADA
 *            (positiva entra, negativa sale), entera.
 * saldosPrevios: { [codigo]: number } leidos ANTES de armar el lote.
 * movIdDe: (codigo) => string  — ID determinista del movimiento.
 */
export function agregarMovimientosAlLote({
  lote,
  maquilaId,
  renglones,
  saldosPrevios,
  tipo,
  origenTipo,
  origenId,
  motivo,
  movIdDe,
  usuario
}) {
  if (!usuario?.nombre) {
    throw new ErrorInventario('Tu cuenta no tiene nombre configurado: avisale a Roberto.')
  }
  const aplicados = []

  for (const r of renglones) {
    const cantidad = Math.trunc(Number(r.cantidad))
    // Un movimiento de cero no dice nada y las reglas lo rechazan.
    if (!Number.isFinite(cantidad) || cantidad === 0) continue

    const saldoAntes = Math.trunc(Number(saldosPrevios[r.codigo] ?? 0))
    const saldoDespues = saldoAntes + cantidad
    if (saldoDespues < 0) {
      throw new ErrorInventario(
        `No se puede sacar ${Math.abs(cantidad)} de ${r.codigo}: solo hay ${saldoAntes} ${r.unidad || ''}.`
      )
    }

    const movId = movIdDe(r.codigo)
    lote.set(doc(db, 'portalMaquila', maquilaId, 'movimientosAvios', movId), {
      maquilaId,
      codigo: r.codigo,
      descripcion: String(r.descripcion || '').slice(0, 200),
      unidad: String(r.unidad || 'piezas'),
      tipo,
      cantidad,
      saldoAntes,
      saldoDespues,
      origenTipo,
      ...(origenId ? { origenId: String(origenId) } : {}),
      motivo: String(motivo || '').slice(0, 300),
      hechoPorUid: usuario.uid,
      hechoPorNombre: usuario.nombre,
      creadoEn: serverTimestamp()
    })

    const refSaldo = doc(db, 'portalMaquila', maquilaId, 'saldosAvios', r.codigo)
    const datosSaldo = {
      codigo: r.codigo,
      maquilaId,
      unidad: String(r.unidad || 'piezas'),
      cantidad: saldoDespues,
      ultimoMovimientoId: movId,
      actualizadoEn: serverTimestamp()
    }
    // La primera vez el documento no existe: lleva creadoEn y las reglas
    // exigen que ese primer movimiento arranque de cero.
    if (saldoAntes === 0 && !(r.codigo in (saldosPrevios.__existentes || {}))) {
      lote.set(refSaldo, { ...datosSaldo, creadoEn: serverTimestamp() })
    } else {
      lote.update(refSaldo, {
        cantidad: saldoDespues,
        ultimoMovimientoId: movId,
        actualizadoEn: serverTimestamp()
      })
    }

    aplicados.push({ codigo: r.codigo, cantidad, saldoAntes, saldoDespues })
  }

  return aplicados
}

/** Lee de golpe los saldos de varios codigos, para armar el lote de una.
 *  Devuelve { [codigo]: cantidad, __existentes: { [codigo]: true } } */
export async function leerSaldos(maquilaId, codigos) {
  const saldos = { __existentes: {} }
  await Promise.all(
    [...new Set(codigos)].map(async (codigo) => {
      const snap = await getDoc(doc(db, 'portalMaquila', maquilaId, 'saldosAvios', codigo))
      saldos[codigo] = snap.exists() ? Number(snap.data().cantidad) || 0 : 0
      if (snap.exists()) saldos.__existentes[codigo] = true
    })
  )
  return saldos
}

/** ¿El error viene de que alguien mas movio el mismo codigo a la vez?
 *  Las reglas exigen que el movimiento arranque del saldo vigente, asi que la
 *  segunda escritura simultanea es rechazada: hay que reintentar, NO es un
 *  problema de permisos y no se le debe decir eso al usuario. */
export function esChoqueDeSaldo(err) {
  return String(err?.code || '') === 'permission-denied'
}
