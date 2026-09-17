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
    // v2 (15-sep): el tech pack es del modelo, sin pedido ni OT. El id sigue
    // siendo 'pedido' para no perder lo que Lety ya marco en su checklist.
    titulo: 'Datos del modelo',
    ayuda: 'Cliente, marca, modelo, prenda, tipo de tejido, pares por pack y los codigos de Microsip del modelo.',
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
    titulo: 'Empaque de caja o bulto',
    // El titulo era 'Empaque de caja' antes de que Lety pidiera reconocer
    // tambien el bulto: un faltante viejo guardado con ese titulo no debe
    // "curarse solo" nada mas por el renombre (ver faltaElRubro).
    titulosAnteriores: ['Empaque de caja'],
    ayuda: 'Como se acomoda en la caja de embarque.',
    prefijos: ['EMPAQUE CAJA', 'EMPAQUE DE CAJA', 'EMPAQUE BULTO', 'EMPAQUE DE BULTO', 'EMPAQUE EN BULTO', 'EMPAQUE POR BULTO']
  },
  {
    id: 'fotos',
    // No tiene pestaña propia: Lety preguntaba "¿cual Fotos?" (usuario-real, 15-sep).
    titulo: 'Fotos (en 1, 4, 5 y 6)',
    ayuda: 'Sin fotos la maquila no sabe como se ve. Faltan si alguna de estas no trae foto: la del modelo (1), como se arma el par (4), la bolsa (5) y la caja (6).',
    // No es una hoja: se cumple si el archivo trae imagenes.
    porImagenes: true
  }
]

/**
 * ¿La lista de faltantes trae este rubro? Compara por ID, por el TITULO
 * vigente o por alguno de sus `titulosAnteriores`. Un solo lugar para los
 * tres consumidores que antes repetian esta comparacion cada uno por su
 * lado (asi nacio el bug: al renombrarse 'Empaque de caja' a '... o bulto'
 * el faltante historico dejo de reconocerse en las tres copias a la vez).
 */
export function faltaElRubro(faltan, rubro) {
  const lista = faltan || []
  return lista.includes(rubro.id) || lista.includes(rubro.titulo) || (rubro.titulosAnteriores || []).some((t) => lista.includes(t))
}

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

/**
 * El avance que se ENSEÑA junto a cada tech pack ("73% hecho", Roberto 11-sep).
 *
 * Rubro por rubro manda lo que Lety marco a mano en Editar ('completo',
 * 'pendiente', 'no_aplica'); donde ella no marco nada, cuenta lo que midio el
 * servidor (`medicion`, ver web/scripts/medir_tech_packs.mjs). Es el mismo
 * criterio de la tabla "Que tan completos estan".
 *
 * @returns {{porcentaje: number, faltan: string[], deLety: boolean} | null}
 *          null si no hay con que medirlo (PDF sin checklist, o sin medir aun).
 */
export function avanceDelTechPack(item) {
  const suyo = item?.datosEditables?.checklist || {}
  const medido = item?.medicion?.porcentaje != null ? item.medicion : null
  const deLety = RUBROS_TECH_PACK.some((r) => suyo[r.id])
  if (!deLety && !medido) return null
  let cuentan = 0
  let completos = 0
  const faltan = []
  for (const r of RUBROS_TECH_PACK) {
    const marca = suyo[r.id]
    if (marca === 'no_aplica') continue
    let tiene
    if (marca === 'completo') tiene = true
    else if (marca === 'pendiente') tiene = false
    // Por ID, por TITULO o por titulo anterior: medirCompletado (formato
    // viejo) guarda los faltantes con su TITULO ("Empaque de packs en
    // bolsa") y medirPlantilla con su ID ("bolsa"); y un rubro que cambio de
    // titulo (ver 'caja') sigue reconociendo el faltante guardado con el
    // titulo viejo. Comparando solo contra el id, lo medido con el formato
    // viejo nunca cuadraba y TODO salia completo: el mismo tech pack decia
    // 71% en la bandeja y 100% aqui (usuario-real como Lety, 17-sep).
    else if (medido) tiene = !faltaElRubro(medido.faltan, r)
    else continue
    cuentan++
    if (tiene) completos++
    else faltan.push(r.titulo)
  }
  if (!cuentan) return null
  return { porcentaje: Math.round((completos / cuentan) * 100), faltan, deLety }
}
