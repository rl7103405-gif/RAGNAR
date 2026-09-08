// QUE TAN COMPLETO ESTA UN TECH PACK.
//
// Lo pidio Lety en la junta del 5-sep, con estas palabras: "de este tech pack
// te va el 80% completado y el 20% te falta... el chiste no es solo tenerlo
// ahi, es saber que te falta". El Drive no se lo dice; la app si.
//
// EL ESTANDAR NO ESTA INVENTADO. Roberto pidio a Lety el mejor ejemplo que
// tuviera para fijarlo, y ella mando el 8-sep el
// "TECH PACK 4504298831 QUI-CSHA20X.xlsx": un tech pack al 100%. De ESE archivo
// salen los rubros de abajo, uno por hoja. No se agrega ni se quita un rubro
// sin que Lety lo pida.
//
// Se mide por HOJA porque es lo unico honesto que se puede leer del archivo sin
// adivinar: si la hoja no esta, el dato no esta. Que la hoja este llena y bien
// llena ya es criterio de Lety, no de la app.

// Los nombres de hoja NO son estables entre archivos: la misma hoja aparece
// como 'ETIQUETAS', 'ETIQUETAS RB10T100' o 'EMPAQUE INDIVIDUAL PLASTIFLECHA'.
// Por eso cada rubro trae PREFIJOS y se compara por prefijo, no por igualdad.
// Medido sobre los 114 archivos del Drive el 8-sep.
export const RUBROS_TECH_PACK = [
  {
    id: 'pedido',
    titulo: 'Informacion del pedido',
    ayuda: 'Cliente, marca, modelo, prenda, tipo de tejido, el pack y los codigos de Microsip con su OT.',
    prefijos: ['INFORMACION DE PEDIDO']
  },
  {
    id: 'ruta',
    titulo: 'Codigos y ruta de proceso',
    ayuda: 'Los codigos internos con su color de cuerpo, bordado e hilo, y por que procesos pasa.',
    prefijos: ['CODIGOS-RUTA DE PROCESOS', 'CODIGOS RUTA DE PROCESOS', 'RUTA DE PROCESO']
  },
  {
    id: 'etiquetas',
    titulo: 'Etiquetas y avios',
    ayuda: 'Caballete, plastiflechas, gancho, transfer, caja y bolsa, cada uno con su clave y cuantos lleva.',
    prefijos: ['ETIQUETAS', 'ETIQUETA']
  },
  {
    id: 'individual',
    titulo: 'Empaque individual',
    ayuda: 'Como se arma el par: donde va cada plastiflecha.',
    prefijos: ['EMPAQUE INDIVIDUAL']
  },
  {
    id: 'bolsa',
    titulo: 'Empaque de packs en bolsa',
    ayuda: 'Cuantos packs por bolsa y como se acomodan.',
    prefijos: ['EMPAQUE DE PACKS EN BOLSA', 'EMPAQUE EN BOLSA', 'EMPAQUE FINAL']
  },
  {
    id: 'caja',
    titulo: 'Empaque de caja',
    ayuda: 'Como se acomoda en la caja de embarque.',
    prefijos: ['EMPAQUE CAJA', 'EMPAQUE DE CAJA']
  },
  {
    id: 'fotos',
    titulo: 'Fotos',
    ayuda: 'Sin fotos la maquila no sabe como se ve. El estandar trae fotos en todas sus hojas.',
    // No es una hoja: se cumple si el archivo trae imagenes.
    porImagenes: true
  }
]

const normaliza = (s) =>
  String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Mide un tech pack contra el estandar de Lety.
 *
 * @param {{hojas?: {nombre: string, imagenes?: unknown[]}[]}} contenido  lo que
 *        devuelve el lector de Excel del visor. Un PDF no se puede medir: no
 *        tiene hojas, y ahi se devuelve `medible: false` en vez de un 0% que
 *        haria ver incompletos tech packs que estan bien.
 * @returns {{medible: boolean, porcentaje: number, rubros: {id, titulo, ayuda, tiene}[], faltan: string[]}}
 */
export function medirCompletado(contenido) {
  const hojas = contenido?.hojas
  if (!Array.isArray(hojas) || hojas.length === 0) {
    return { medible: false, porcentaje: 0, rubros: [], faltan: [] }
  }
  const nombres = hojas.map((h) => normaliza(h?.nombre))
  const hayImagenes = hojas.some((h) => (h?.imagenes?.length || 0) > 0)

  const rubros = RUBROS_TECH_PACK.map((r) => ({
    id: r.id,
    titulo: r.titulo,
    ayuda: r.ayuda,
    tiene: r.porImagenes
      ? hayImagenes
      : nombres.some((n) => r.prefijos.some((p) => n.startsWith(normaliza(p))))
  }))
  const cumplidos = rubros.filter((r) => r.tiene).length
  return {
    medible: true,
    porcentaje: Math.round((cumplidos / rubros.length) * 100),
    rubros,
    faltan: rubros.filter((r) => !r.tiene).map((r) => r.titulo)
  }
}
