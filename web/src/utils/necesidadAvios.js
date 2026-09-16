// LOS AVIOS QUE NECESITA UNA TAREA, calculados desde el archivo del tech
// pack que ya se tiene en memoria (al encargar) o recien bajado (el modal
// "Avios que necesita"). Roberto, 15-sep: "avisar de avios al encargar la
// tarea, no solo con el boton dentro de la tarea".
//
// Nada se escribe. El calculo puro vive en aviosTechPack.js; aqui solo se
// abre el Excel, se leen los saldos de la maquila y se cruza.
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { abrirLibro } from './excelJs'
import { leerSaldosConUnidad } from './inventarioAvios'
import { aviosDelTechPack, hojasDeLibro, necesidadDeAvios } from './aviosTechPack'
import { aviosDesdePlantilla, esPlantilla, leerPlantilla } from './leerPlantillaTechPack'

/**
 * @param {ArrayBuffer} contenido  el tech pack (xlsx). Un PDF no se puede leer.
 * @param {string} formato 'xlsx' | 'pdf'
 * @param {{cantidad, unidad}[]} renglones  lo que pide la tarea
 * @param {(m: string) => void} onProgreso
 * @returns lo que devuelve necesidadDeAvios, o null si el archivo no se puede leer (PDF)
 */
export async function necesidadDeAviosDelContenido({ contenido, formato, maquilaId, renglones, onProgreso = () => {} }) {
  if (formato && formato !== 'xlsx') return null
  onProgreso('Leyendo los avios del tech pack...')
  const libro = await abrirLibro(contenido)
  // Plantilla TP-Quini: se lee por nombres (hoja 3 AVIOS); formato viejo: por etiquetas.
  const lectura = esPlantilla(libro) ? aviosDesdePlantilla(leerPlantilla(libro)) : aviosDelTechPack(hojasDeLibro(libro))
  onProgreso('Leyendo lo que tiene la maquila...')
  const claves = [...new Set(lectura.avios.map((a) => a.clave))]
  const [saldos, enCatalogo] = await Promise.all([
    claves.length ? leerSaldosConUnidad(maquilaId, claves) : {},
    Promise.all(claves.map(async (c) => [c, (await getDoc(doc(db, 'avios', c))).exists()]))
  ])
  const catalogo = new Set(enCatalogo.filter(([, existe]) => existe).map(([c]) => c))
  return necesidadDeAvios(lectura, renglones || [], saldos, catalogo)
}

/** Una linea legible del resultado, para el aviso al encargar. */
export function resumenDeAvios(r) {
  if (!r) return 'avios sin calcular (el tech pack no es Excel)'
  if (r.veredicto === 'suficiente') return 'avios suficientes con lo que la maquila tiene hoy'
  if (r.veredicto === 'faltante') {
    const faltan = r.filas.filter((f) => f.alcanza === false)
    const lista = faltan.slice(0, 6).map((f) => `${f.clave} faltan ${Number(f.faltan).toLocaleString('es-MX')}`).join(', ')
    return `le FALTAN ${faltan.length} avio(s): ${lista}${faltan.length > 6 ? '...' : ''}`
  }
  return `avios sin poder dar por buenos (${r.porQueInconcluso || 'ver "Avios que necesita" en la tarea'})`
}
