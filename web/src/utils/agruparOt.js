// Agrupacion de capturas por ORDEN DE TRABAJO, con la misma regla que usa el
// PDF de salida (ordenDeCaptura en pdf.js: los primeros 4 digitos del pedido).
// Compartido por Captura, Historial y cualquier otra vista que liste bultos,
// para que la agrupacion en pantalla siempre coincida con las hojas del papel.
import { ordenDeCaptura, SIN_ORDEN } from './pdf'
import { compararAscendente } from './texto'

export { SIN_ORDEN }

/** Devuelve [{ ot, filas, folios, kg }] con las OT en orden ASCENDENTE
 *  (SIN ORDEN al final) y los folios de cada OT tambien ascendentes — el
 *  mismo criterio con el que pdf.js imprime las hojas. */
export function agruparPorOt(lista) {
  const grupos = new Map()
  lista.forEach((c) => {
    const ot = ordenDeCaptura(c)
    if (!grupos.has(ot)) grupos.set(ot, [])
    grupos.get(ot).push(c)
  })
  return [...grupos.entries()]
    .sort(([a], [b]) => {
      if (a === SIN_ORDEN) return 1
      if (b === SIN_ORDEN) return -1
      return compararAscendente(a, b)
    })
    .map(([ot, filas]) => ({
      ot,
      filas: [...filas].sort((a, b) => compararAscendente(a.folio, b.folio)),
      folios: filas.length,
      kg: filas.reduce((acc, f) => acc + (f.pesoGramos || 0), 0) / 1000
    }))
}

/** Texto del encabezado de un grupo ('OT 7887' / 'SIN ORDEN DE TRABAJO'). */
export function etiquetaOt(ot) {
  return ot === SIN_ORDEN ? 'SIN ORDEN DE TRABAJO' : `OT ${ot}`
}
