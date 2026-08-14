// Copia MINIMA de una remision para el portal de la maquila.
//
// La maquila es un usuario EXTERNO: nunca lee 'pdfsGenerados', 'bultos',
// 'foliosRuteo' ni el catalogo. Todo lo que necesita ver se le escribe aqui,
// en SU ruta (portalMaquila/{maquilaId}/salidas/{registroId}), al momento de
// emitir el papel y en el MISMO lote que la bitacora.
//
// Que NO viaja, a proposito: el pedido completo (trae claves de cliente y
// campana), el nombreGuia, la direccion, y por supuesto nada de otras
// maquilas. Solo lo que hace falta para que ella verifique lo que recibio.
import { docenasDeCaptura } from './reimprimir'
import { otDePedido } from './pdf'
import { compararAscendente } from './texto'

/** Arma el documento de la copia. No escribe: quien llama lo mete en su lote
 *  para que la bitacora y la copia sean todo-o-nada. */
export function armarSalidaPortal({ registroId, maquila, capturas, folioInterno, fechaTexto, emitidaPorNombre }) {
  const renglones = [...capturas]
    .sort((a, b) => compararAscendente(a.folio, b.folio))
    .map((c) => ({
      folio: String(c.folio),
      codigo: c.producto?.codigo ?? null,
      descripcion: c.producto?.descripcion ?? null,
      docenas: docenasDeCaptura(c) || 0,
      // La OT se saca con el MISMO criterio que el resto de la app.
      ot: otDePedido(c.producto?.pedido) ?? null,
      // El peso SI va: es lo que dice el papel que ella recibe y con lo que
      // puede cotejar el bulto en su bascula.
      pesoGramos: c.pesoGramos ?? 0
    }))

  const ots = [...new Set(renglones.map((r) => r.ot).filter(Boolean))].sort(compararAscendente)

  return {
    registroId,
    maquilaId: maquila.id,
    folioInterno: Number(folioInterno),
    fechaTexto,
    ots,
    // Array PLANO de folios: la regla del acuse lo usa para verificar que la
    // maquila no reclame como faltante un folio que nunca se le mando.
    folios: renglones.map((r) => r.folio),
    renglones,
    totalFolios: renglones.length,
    totalDocenas: Math.round(renglones.reduce((a, r) => a + (r.docenas || 0), 0) * 100) / 100,
    pesoTotalGramos: renglones.reduce((a, r) => a + (r.pesoGramos || 0), 0),
    emitidaPorNombre: String(emitidaPorNombre || 'Embarques').slice(0, 80)
  }
}
