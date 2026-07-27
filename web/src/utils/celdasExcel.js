// Aplanado de valores de celda de exceljs a escalares primitivos. Compartido
// entre el parser del navegador (importarFoliosRuteo.js) y el script de Node
// que carga el catalogo (scripts/cargar_catalogo.mjs).
//
// exceljs entrega objetos en vez de un valor plano para formulas ({ formula,
// result }), texto enriquecido ({ richText }) y errores ({ error: '#REF!' },
// o un resultado de formula que no pudo convertirse a numero/texto). Todos
// esos casos se marcan con CELDA_INVALIDA -- NUNCA se devuelve
// "[object Object]" (por dejar pasar el objeto crudo a String()) ni null en
// silencio (que un lector confundiria con "celda vacia").
export const CELDA_INVALIDA = 'invalido'

/** Reduce el valor crudo de una celda de exceljs a: null (vacia), un Date,
 *  un string/number/boolean plano, o CELDA_INVALIDA (error de formula u
 *  objeto de forma no reconocida). */
export function escalarCelda(valor) {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) return valor
  if (typeof valor === 'object') {
    if ('error' in valor) return CELDA_INVALIDA
    if ('result' in valor) return escalarCelda(valor.result)
    if ('richText' in valor) return valor.richText.map((t) => t.text).join('')
    if ('text' in valor) return escalarCelda(valor.text)
    return CELDA_INVALIDA // objeto de forma desconocida: nunca "[object Object]"
  }
  // Un resultado de formula que no pudo evaluarse a numero (p.ej. una formula
  // de error leida via streaming) llega como NaN: tambien es invalido.
  if (typeof valor === 'number' && !Number.isFinite(valor)) return CELDA_INVALIDA
  return valor
}

/** Texto de la celda: '' si esta vacia, CELDA_INVALIDA si la celda tiene un
 *  error/forma no reconocida (el que llama debe revisar explicitamente ese
 *  caso antes de usar el resultado como dato real -- nunca tratarlo como
 *  texto valido). */
export function textoCelda(valor) {
  const v = escalarCelda(valor)
  if (v === null) return ''
  if (v === CELDA_INVALIDA) return CELDA_INVALIDA
  return String(v).trim()
}

/** Numero de la celda o null si esta vacia. SOLO acepta valores cuyo tipo ya
 *  es 'number' (incluye resultado de formula numerico): a diferencia del
 *  parser Python original (openpyxl con data_only), aqui NO se aceptan
 *  strings numericos ('5', '1e3', '0x10') como numero valido -- si el
 *  encabezado corresponde a un numero, la celda debe ser numerica de verdad.
 *  Booleanos y celdas invalidas devuelven CELDA_INVALIDA. */
export function numeroCeldaONull(valor) {
  const v = escalarCelda(valor)
  if (v === null || v === '') return null
  if (typeof v === 'number') return v // escalarCelda ya garantizo que es finito
  return CELDA_INVALIDA
}

/** Fecha de la celda o null si esta vacia/no es una fecha valida (incluye
 *  celdas invalidas: no se distingue "vacia" de "invalida" aqui porque quien
 *  llama ya revisa por separado si la celda origen era CELDA_INVALIDA). */
export function fechaCeldaONull(valor) {
  const v = escalarCelda(valor)
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v : null
}
