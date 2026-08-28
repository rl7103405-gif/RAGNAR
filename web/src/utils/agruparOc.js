// Agrupacion en ARBOL: orden de compra -> orden de trabajo -> folios.
//
// Roberto lo pidio el 2026-08-28: "agrupa las OC como un arbol que va teniendo
// varias ramas: primero las OC con sus OT, despues los folios, despues los que
// no tienen OC pero si tienen OT, y ya despues los que no tienen nada".
//
// El orden de las ramas NO es alfabetico, es el de la utilidad: primero lo que
// esta bien amarrado, y al final lo que hay que arreglar. Asi el problema se
// queda abajo, junto pero visible, en vez de repartido entre lo sano.
import { SIN_ORDEN } from './agruparOt'
import { compararAscendente } from './texto'

/** Ramas especiales. Se distinguen entre si a proposito: "tiene OT pero no
 *  esta en el plan" y "ni siquiera tiene OT" son dos problemas distintos y se
 *  arreglan en lugares distintos (el plan maestro vs. el Excel de folios). */
export const SIN_OC = '__SIN_OC__'
export const SIN_OT = '__SIN_OT__'

export const ETIQUETA_RAMA = {
  [SIN_OC]: 'Sin orden de compra',
  [SIN_OT]: 'Sin orden de trabajo'
}

export const DETALLE_RAMA = {
  [SIN_OC]:
    'Tienen orden de trabajo, pero esa OT no esta en el plan maestro vigente. Se arregla subiendo el plan actualizado.',
  [SIN_OT]:
    'Ni siquiera se les pudo sacar la orden de trabajo. Casi siempre es que el folio todavia no esta en el Excel del dia.'
}

/**
 * Recibe los grupos que ya devolvio agruparPorOt y los cuelga de su OC.
 *
 * grupos: [{ ot, filas, folios, kg }]
 * ocDeOt: (ot) => string  — el mapa del plan vigente; '' si no la conoce.
 *
 * Devuelve [{ oc, esRamaEspecial, grupos, folios, docenas, kg }].
 */
export function agruparPorOc(grupos, ocDeOt, docenasDe = () => 0) {
  const ramas = new Map()
  grupos.forEach((g) => {
    const oc = g.ot === SIN_ORDEN ? SIN_OT : ocDeOt(g.ot) || SIN_OC
    if (!ramas.has(oc)) ramas.set(oc, [])
    ramas.get(oc).push(g)
  })

  const peso = (oc) => (oc === SIN_OT ? 2 : oc === SIN_OC ? 1 : 0)

  return [...ramas.entries()]
    .sort(([a], [b]) => peso(a) - peso(b) || compararAscendente(a, b))
    .map(([oc, susGrupos]) => ({
      oc,
      esRamaEspecial: oc === SIN_OC || oc === SIN_OT,
      grupos: susGrupos,
      folios: susGrupos.reduce((acc, g) => acc + g.folios, 0),
      kg: susGrupos.reduce((acc, g) => acc + g.kg, 0),
      docenas: susGrupos.reduce(
        (acc, g) => acc + g.filas.reduce((a, f) => a + docenasDe(f), 0),
        0
      )
    }))
}

/** Texto del encabezado de una rama. */
export function etiquetaOc(oc) {
  return ETIQUETA_RAMA[oc] || `OC ${oc}`
}
