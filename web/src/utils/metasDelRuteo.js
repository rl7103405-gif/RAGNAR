// Deriva la META en docenas de una tarea a partir del RUTEO ya cargado.
//
// El Excel de tareas puede no traer la cantidad (el de Lindbergh solo trae
// codigo + OT). En ese caso se suman las docenas de los folios de ese codigo
// que estan en foliosRuteo -- acotados a las OTs de la tarea si las trae.
//
// ⚠️ LIMITE QUE HAY QUE COMUNICAR: esto vale lo que valga el ruteo cargado en
// ESE momento. Si el Excel de ruteo de esa OT esta incompleto, la meta sale
// corta y la tarea se veria cumplida antes de tiempo. Por eso el resultado
// SIEMPRE dice de donde salio y con cuantos folios, y la app la marca como
// ESTIMADA para que quien importa decida si la acepta o la corrige a mano.
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { otDePedido } from './pdf'

// Tope del operador 'in' de Firestore.
const LOTE_IN = 30

// La OT se saca con la MISMA funcion que usa el avance (otDePedido de pdf.js):
// si los dos lados no coinciden, la meta contaria folios que el avance nunca va
// a sumar y la tarea seria imposible de cumplir.

/** Docenas de un folio del ruteo, con el criterio canonico de la app
 *  (docenasDeCaptura): 'docenas' y, si no es numero, 'total'. */
function docenasDeFolio(f) {
  const d = typeof f.docenas === 'number' ? f.docenas : f.total
  return typeof d === 'number' ? d : 0
}

// Folios que ya no aparecen en ningun Excel se retienen 15 dias, asi que la
// suma podria INFLARSE con folios viejos. Solo cuentan los vistos hace poco.
const DIAS_RUTEO_VIGENTE = 10

/**
 * Rellena la meta de las tareas que no la traen.
 * tareas: [{ codigo, metaDocenas, origenMeta, ots, ... }]
 * Devuelve una copia con metaDocenas/origenMeta resueltos y, cuando se derivo,
 * { foliosRespaldo, otsSinRuteo }.
 *   origenMeta: 'excel' | 'ruteo' | 'falta'
 */
export async function rellenarMetasDesdeRuteo(tareas) {
  const faltantes = tareas.filter((t) => t.origenMeta !== 'excel' && t.metaDocenas == null)
  if (faltantes.length === 0) return { tareas, derivadas: 0, sinRuteo: 0 }

  // Un solo viaje por lote de 30 codigos. Se pide TODO el ruteo de esos
  // codigos y el filtro por OT se hace en memoria: el pedido es un texto
  // compuesto y Firestore no puede filtrar por prefijo junto con el 'in'.
  const porCodigo = new Map()
  const codigos = [...new Set(faltantes.map((t) => t.codigo))]
  for (let i = 0; i < codigos.length; i += LOTE_IN) {
    const lote = codigos.slice(i, i + LOTE_IN)
    const snap = await getDocs(query(collection(db, 'foliosRuteo'), where('codigo', 'in', lote)))
    snap.docs.forEach((d) => {
      const f = { folio: d.id, ...d.data() }
      const clave = String(f.codigo || '').toUpperCase()
      if (!porCodigo.has(clave)) porCodigo.set(clave, [])
      porCodigo.get(clave).push(f)
    })
  }

  const limite = new Date()
  limite.setDate(limite.getDate() - DIAS_RUTEO_VIGENTE)

  let derivadas = 0
  let sinRuteo = 0
  const resultado = tareas.map((t) => {
    if (t.origenMeta === 'excel' || t.metaDocenas != null) return t
    const delCodigo = porCodigo.get(t.codigo) || []
    // SOLO se usa t.ots: es el alcance que la tarea va a GUARDAR y con el que
    // se va a medir el avance. Usar otsInfo (las OTs vistas) derivaria la meta
    // con un alcance mas chico del que luego cuenta el avance, y la tarea se
    // cumpliria con capturas de otras OTs (lo cazaron los dos revisores).
    const ots = Array.isArray(t.ots) ? t.ots : []

    // SIN OT acotada no se deriva: sumar TODAS las OTs de ese codigo inflaria
    // la meta sin control (el codigo puede venir en pedidos de meses
    // distintos). Queda para teclearse a mano.
    if (ots.length === 0) {
      sinRuteo += 1
      return { ...t, metaDocenas: null, origenMeta: 'falta', foliosRespaldo: 0, motivoSinMeta: 'la tarea no trae OT' }
    }

    const relevantes = delCodigo.filter((f) => {
      if (!ots.includes(otDePedido(f.pedido))) return false
      const visto = f.cargadoEn?.toDate ? f.cargadoEn.toDate() : null
      // Si no se sabe cuando se vio, se cuenta (dato viejo pero legitimo).
      return visto === null || visto >= limite
    })

    if (relevantes.length === 0) {
      sinRuteo += 1
      return {
        ...t,
        metaDocenas: null,
        origenMeta: 'falta',
        foliosRespaldo: 0,
        motivoSinMeta: 'no hay folios de ese codigo/OT en el ruteo cargado'
      }
    }
    const suma = relevantes.reduce((acc, f) => acc + docenasDeFolio(f), 0)
    if (suma <= 0) {
      sinRuteo += 1
      return {
        ...t,
        metaDocenas: null,
        origenMeta: 'falta',
        foliosRespaldo: relevantes.length,
        motivoSinMeta: 'los folios del ruteo no traen docenas'
      }
    }
    derivadas += 1
    return {
      ...t,
      metaDocenas: Math.round(suma * 100) / 100,
      origenMeta: 'ruteo',
      foliosRespaldo: relevantes.length,
      // Si la tarea pedia OTs y algunas no tienen ni un folio cargado, la meta
      // esta incompleta con seguridad: se avisa por tarea.
      // Se comparan contra los folios que SI contaron (relevantes): si una OT
      // solo tiene folios viejos, su meta no entro en la suma y hay que
      // avisarlo igual que si no tuviera ninguno.
      otsSinRuteo: ots.filter((ot) => !relevantes.some((f) => otDePedido(f.pedido) === ot))
    }
  })

  return { tareas: resultado, derivadas, sinRuteo }
}
