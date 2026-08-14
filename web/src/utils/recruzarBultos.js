// Re-cruce de bultos capturados SIN RUTEO.
//
// Cuando America carga el Excel de ruteo TARDE (o le faltaron folios), los
// bultos que ya se pesaron quedaron guardados con cruce 'sin_ruteo': sin
// codigo, sin docenas, sin pedido. Este modulo se corre al terminar cada carga
// y vuelve a intentar el cruce de ESOS bultos contra el ruteo recien subido.
//
// Reglas de la casa:
//  - SOLO se tocan los bultos que no cruzaron ('sin_ruteo' / 'sin_catalogo').
//    Un bulto que ya tiene su producto NO se vuelve a resolver: el snapshot se
//    congela al capturar y no debe moverse porque el Excel cambie despues.
//  - NO se tocan los que ya salieron en un PDF: el papel entregado dice
//    "SIN RUTEO" y cambiar el bulto no cambia el papel. Se cuentan y se
//    reportan para que Roberto decida.
//  - Cada re-cruce que SI encuentra datos queda en la bitacora cambiosCaptura
//    con accion 'recruce', para que se pueda explicar despues por que un folio
//    dejo de estar "sin ruteo".
import { collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { resolverProductoEnTx, CRUCE_COMPLETO, CRUCE_SIN_RUTEO, CRUCE_SIN_CATALOGO } from './cruceProducto'
import { registrarCambio } from './auditoria'

// Tope de bultos sin cruzar que se revisan por carga. En operacion normal son
// unas decenas; el tope evita que una base con mucha historia sin cruzar
// convierta cada carga de Excel en miles de lecturas.
const MAX_A_REVISAR = 500
// Solo se re-cruzan capturas recientes: un bulto de hace meses que nunca
// cruzo ya no se va a resolver con el Excel de hoy.
const DIAS_VENTANA = 45

/**
 * Reintenta el cruce de los bultos que quedaron sin ruteo/sin catalogo.
 * usuario: { uid, nombre } para la bitacora.
 * Devuelve { revisados, resueltos, siguenSinRuteo, siguenSinCatalogo,
 *            omitidosPorPdf, folios: [{ folio, codigo }], errores: [...] }
 */
export async function recruzarBultosSinRuteo({ usuario }) {
  const resumen = {
    revisados: 0,
    resueltos: 0,
    siguenSinRuteo: 0,
    siguenSinCatalogo: 0,
    omitidosPorPdf: 0,
    folios: [],
    errores: []
  }

  // Un solo where (sin orderBy): no hace falta indice compuesto. El filtro por
  // fecha y el tope se aplican en memoria sobre lo traido.
  const snap = await getDocs(
    query(
      collection(db, 'bultos'),
      where('cruce', 'in', [CRUCE_SIN_RUTEO, CRUCE_SIN_CATALOGO]),
      // Tope en el SERVIDOR: sin esto, cada carga de Excel leeria todo el
      // historico de bultos sin cruzar, que solo crece.
      limit(MAX_A_REVISAR * 4)
    )
  )
  const desde = new Date()
  desde.setDate(desde.getDate() - DIAS_VENTANA)

  const candidatos = snap.docs
    .map((d) => ({ folio: d.id, ...d.data() }))
    .filter((b) => {
      const fecha = b.creadoEn?.toDate ? b.creadoEn.toDate() : null
      return fecha === null || fecha >= desde
    })
    .slice(0, MAX_A_REVISAR)

  for (const candidato of candidatos) {
    resumen.revisados += 1
    try {
      const resultado = await runTransaction(db, async (tx) => {
        const ref = doc(db, 'bultos', candidato.folio)
        const snapBulto = await tx.get(ref)
        if (!snapBulto.exists()) return { estado: 'desaparecio' }
        const bulto = snapBulto.data()

        // Se revalida DENTRO de la transaccion: entre la consulta y ahora, el
        // bulto pudo cruzarse por otra via, salir en un PDF o ser editado.
        if (bulto.cruce === CRUCE_COMPLETO) return { estado: 'ya_cruzado' }
        if (bulto.pdfGeneradoEn) return { estado: 'omitido_pdf' }

        const { producto, cruce, catalogoVersion } = await resolverProductoEnTx(tx, candidato.folio)
        if (cruce === CRUCE_SIN_RUTEO) return { estado: 'sigue_sin_ruteo' }
        // Sin catalogo pero CON ruteo ya es una mejora (trae codigo, docenas y
        // pedido del Excel): se guarda igual, como al capturar.
        if (cruce === bulto.cruce && (bulto.producto?.codigo ?? null) === (producto?.codigo ?? null)) {
          return { estado: cruce === CRUCE_SIN_CATALOGO ? 'sigue_sin_catalogo' : 'sin_novedad' }
        }

        // Se reenvian TODAS las llaves con su valor actual y solo cambian las
        // del cruce: asi affectedKeys() queda en
        // ['producto','cruce','catalogoVersion','actualizadoEn'] y el update
        // pasa por recruceValido() de las reglas -- que NO exige
        // operadorUid == auth.uid, porque quien carga el Excel (America) no es
        // quien peso el bulto (Angel/Juan) y falsear el operador seria peor.
        // pdfGeneradoEn/pdfFolioInterno no se reenvian porque este camino solo
        // corre cuando NO hay marcador (se valido arriba).
        tx.set(ref, {
          folio: bulto.folio,
          pesoGramos: bulto.pesoGramos,
          operadorUid: bulto.operadorUid,
          operadorNombre: bulto.operadorNombre ?? null,
          creadoEn: bulto.creadoEn,
          actualizadoEn: serverTimestamp(),
          producto,
          cruce,
          catalogoVersion: catalogoVersion ?? null
        })
        return {
          estado: 'resuelto',
          cruce,
          codigo: producto?.codigo ?? null,
          docenas: producto?.docenas ?? null,
          antes: bulto
        }
      })

      if (resultado.estado === 'resuelto') {
        resumen.resueltos += 1
        resumen.folios.push({ folio: candidato.folio, codigo: resultado.codigo })
        // La bitacora va FUERA de la transaccion: si falla, el re-cruce ya
        // quedo hecho (es la mejora que importa) y solo se pierde el rastro.
        try {
          await registrarCambio({
            folio: candidato.folio,
            accion: 'recruce',
            antes: {
              pesoGramos: resultado.antes.pesoGramos ?? null,
              docenas: resultado.antes.producto?.docenas ?? null,
              codigo: resultado.antes.producto?.codigo ?? null,
              pdfFolioInterno: null
            },
            despues: {
              pesoGramos: resultado.antes.pesoGramos ?? null,
              // Las docenas NUEVAS (antes venian nulas por no tener ruteo):
              // poner aqui las viejas haria parecer que no cambio nada.
              docenas: resultado.docenas,
              codigo: resultado.codigo
            },
            motivo: 'Cruce resuelto al cargar el Excel de ruteo',
            usuario
          })
        } catch (err) {
          console.warn('[recruzarBultos] No se pudo registrar el re-cruce de', candidato.folio, err)
        }
      } else if (resultado.estado === 'omitido_pdf') {
        resumen.omitidosPorPdf += 1
      } else if (resultado.estado === 'sigue_sin_ruteo') {
        resumen.siguenSinRuteo += 1
      } else if (resultado.estado === 'sigue_sin_catalogo') {
        resumen.siguenSinCatalogo += 1
      }
    } catch (err) {
      console.error('[recruzarBultos] Error re-cruzando', candidato.folio, err)
      resumen.errores.push({ folio: candidato.folio, mensaje: err.message || String(err) })
    }
  }

  return resumen
}
