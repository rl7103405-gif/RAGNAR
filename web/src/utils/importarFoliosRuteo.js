// Parseo EN EL NAVEGADOR del Excel diario que sube America con los folios
// esperados y sus datos. Replica la validacion de app/services/importar_excel.py
// (parsear_folios_ruteo) del servidor original: mismos encabezados, mismas
// reglas por fila y misma politica de "si hay filas invalidas NO se importa
// nada". Soporta dos esquemas REALES distintos (no son variantes del mismo):
//
//  A) 'Folios ruteo DD.MM.AA.xlsx' (12 columnas):
//     Folio, Fecha, Codigo, Docenas, Pares, Total, Fecha Captura,
//     Fecha Actualizacion, Descripcion, Pedido, Num. Ruta, Nombre_Guia
//  B) Plantilla .xlsm 'Archivo para cargas de Inventarios...', hoja
//     'DATOS PRODUCCION' (9 columnas, sin Pedido/Ruta/Guia):
//     LOTE, Fecha, Codigo, Docenas, Pares, Total, FechaCaptura,
//     FechaActualizacion, Descripcion
//
//  C) Reporte 'Seguimiento de Folios' (FOLIOS DDMM AAAA.xls, generado por el
//     sistema de la empresa): fila 1 es el titulo del reporte, fila 2 son
//     etiquetas de estatus, y los datos van de la fila 3 en adelante SIN
//     encabezados de columna: A=fecha (texto dd/mm/aaaa, casi siempre vacia),
//     B=folio, C=codigo, D=pedido, E=descripcion, F=modelo, G=color,
//     H=docenas pedidas, I=docenas surtidas (H/I vienen como TEXTO '24.00'),
//     J-M=banderas de proceso, y un pie 'Página -N de N' que se ignora.
//
// Nota .xlsm: el navegador solo lee los VALORES ya guardados, nunca ejecuta
// macros -- America debe correr su proceso en Excel y GUARDAR antes de subir.
import { normalizarFolio, canonizarFolio } from './validacion'
import { CELDA_INVALIDA, textoCelda, escalarCelda, numeroCeldaONull, fechaCeldaONull } from './celdasExcel'

const MAX_FILAS = 50000
const MAX_ERRORES_REPORTADOS = 20
const MAX_TAMANO_ARCHIVO_BYTES = 30 * 1024 * 1024
const PATRON_PEDIDO = /^[A-Za-z0-9._-]+$/

const ESQUEMAS = [
  {
    nombre: 'folios_ruteo',
    encabezados: [
      'folio', 'fecha', 'codigo', 'docenas', 'pares', 'total',
      'fecha captura', 'fecha actualizacion', 'descripcion', 'pedido',
      'num. ruta', 'nombre_guia'
    ],
    colPedido: 9,
    colNombreGuia: 11
  },
  {
    nombre: 'datos_produccion',
    encabezados: [
      'lote', 'fecha', 'codigo', 'docenas', 'pares', 'total',
      'fechacaptura', 'fechaactualizacion', 'descripcion'
    ],
    colPedido: null,
    colNombreGuia: null
  }
]

export class ErrorImportacion extends Error {
  constructor(mensaje, errores = []) {
    super(mensaje)
    this.errores = errores
  }
}

// Excel (formato de almacenamiento IEEE 754) solo conserva 15 digitos
// significativos: un folio numerico de 16+ digitos puede llegar como entero
// "seguro" para JS pero ya truncado/redondeado por Excel antes de que este
// codigo lo lea (termina en ceros). Se marca invalido aunque
// Number.isSafeInteger diga que si, contando solo los digitos del valor.
function esFolioDemasiadoLargo(valorEscalar) {
  if (typeof valorEscalar !== 'number') return false
  if (!Number.isSafeInteger(valorEscalar)) return true
  return String(Math.trunc(Math.abs(valorEscalar))).length > 15
}

// Recorta un texto a un maximo de BYTES utf-8 (firestore.rules mide size()
// en bytes, no en caracteres: una Ñ o una vocal acentuada ya son 2 bytes).
// Recorta codepoint por codepoint desde el final para nunca partir un
// caracter a la mitad.
function recortarBytesUtf8(texto, maxBytes) {
  if (!texto) return texto
  const encoder = new TextEncoder()
  if (encoder.encode(texto).length <= maxBytes) return texto
  const codepoints = Array.from(texto)
  while (codepoints.length > 0 && encoder.encode(codepoints.join('')).length > maxBytes) {
    codepoints.pop()
  }
  return codepoints.join('')
}

// Limpieza comun para texto libre proveniente del reporte Seguimiento de
// Folios (pedido, descripcion, modelo, color): reemplaza por espacio los
// caracteres de control C0 (<32) y DEL (127), los de control C1 (0x80-0x9F)
// y los de control de ancho cero/direccionalidad bidi (U+200B-U+200F,
// U+202A-U+202E, U+FEFF), y colapsa espacios repetidos.
function limpiarTextoLibre(t) {
  return t
    .split('')
    .map((ch) => {
      const cp = ch.codePointAt(0)
      const esControl =
        cp < 32 ||
        cp === 127 ||
        (cp >= 0x80 && cp <= 0x9f) ||
        (cp >= 0x200b && cp <= 0x200f) ||
        (cp >= 0x202a && cp <= 0x202e) ||
        cp === 0xfeff
      return esControl ? ' ' : ch
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

// Formatos que exceljs lee directo. Cualquier otro Excel (.xls de 97-2003,
// .ods de LibreOffice/Google) se lee con SheetJS, que entrega la matriz de
// celdas con fechas reales (Date) y errores de formula preservados; la
// VALIDACION posterior es exactamente la misma para todos los formatos.
// NOTA: no se convierte el archivo a .xlsx re-escribiendolo (SheetJS
// write + exceljs read corrompe las fechas: un 2026 termina leido como
// 1905); se extraen los valores directo del formato original.
const EXTENSIONES_DIRECTAS = ['.xlsx', '.xlsm']
const NOMBRE_HOJA_PLANTILLA = 'DATOS PRODUCCION'

// Devuelve la matriz de valores crudos [fila][columna] (indice 0 = fila de
// encabezados), eligiendo la hoja DATOS PRODUCCION si existe o la primera.
// Las celdas con error de formula llegan como { error } para que
// escalarCelda/textoCelda las marquen CELDA_INVALIDA en ambos motores.
// Ningun esquema soportado usa columnas mas alla de la M (indice 0-based
// 12): acotar el recorrido ahi evita que un rango de columnas inflado
// (!ref corrupto, o una hoja .xlsx con formato aplicado a de mas) dispare
// recorridos absurdamente largos y congele el navegador.
const MAX_COLUMNA_INDICE = 12 // columna M

async function leerMatriz(archivo) {
  const nombre = (archivo.name || '').toLowerCase()
  const buffer = await archivo.arrayBuffer()

  if (EXTENSIONES_DIRECTAS.some((ext) => nombre.endsWith(ext))) {
    const { Workbook } = await import('exceljs')
    const libro = new Workbook()
    try {
      await libro.xlsx.load(buffer)
    } catch (err) {
      throw new ErrorImportacion('No se pudo abrir el Excel: ' + (err.message || err))
    }
    if (libro.worksheets.length === 0) throw new ErrorImportacion('El Excel no tiene hojas')
    const hoja =
      libro.worksheets.find((h) => h.name.trim().toUpperCase() === NOMBRE_HOJA_PLANTILLA) ||
      libro.worksheets[0]
    // hoja.actualRowCount solo cuenta filas CON datos: una fila vacia
    // intermedia truncaria el recorrido y omitiria folios en silencio.
    // hoja.rowCount es el numero real de la ultima fila. Se valida ANTES de
    // recorrer para no iterar un archivo con metadata de filas inflada.
    if (hoja.rowCount > MAX_FILAS + 2) {
      throw new ErrorImportacion(`El archivo excede el maximo de ${MAX_FILAS} filas`)
    }
    const filas = []
    for (let n = 1; n <= hoja.rowCount; n++) {
      // row.values de exceljs es 1-based (indice 0 vacio): se descarta. Se
      // recorta a la columna M (13 elementos: indices 1..13, columnas A..M)
      // por la misma razon que MAX_COLUMNA_INDICE en la ruta SheetJS.
      filas.push(hoja.getRow(n).values.slice(1, 14))
    }
    return filas
  }

  const modXlsx = await import('xlsx')
  // SheetJS es CommonJS: segun el empaquetador, sus funciones quedan como
  // exports con nombre o colgadas de default.
  const XLSX = typeof modXlsx.read === 'function' ? modXlsx : modXlsx.default
  let libro
  try {
    libro = XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch (err) {
    throw new ErrorImportacion(
      'No se pudo abrir el archivo como Excel (.xls/.ods): ' + (err.message || err)
    )
  }
  if (!libro.SheetNames.length) throw new ErrorImportacion('El Excel no tiene hojas')
  const nombreHoja =
    libro.SheetNames.find((n) => n.trim().toUpperCase() === NOMBRE_HOJA_PLANTILLA) ||
    libro.SheetNames[0]
  const hoja = libro.Sheets[nombreHoja]
  if (!hoja || !hoja['!ref']) return []
  const rango = XLSX.utils.decode_range(hoja['!ref'])
  // Un !ref inflado (metadata corrupta del archivo) no debe hacer que el
  // navegador itere millones de celdas y se congele: se acota antes de
  // recorrer.
  if (rango.e.r > MAX_FILAS + 2) {
    throw new ErrorImportacion(`El archivo excede el maximo de ${MAX_FILAS} filas`)
  }
  const colFin = Math.min(rango.e.c, MAX_COLUMNA_INDICE)
  const filas = []
  for (let r = rango.s.r; r <= rango.e.r; r++) {
    const fila = []
    for (let c = rango.s.c; c <= colFin; c++) {
      const celda = hoja[XLSX.utils.encode_cell({ r, c })]
      if (celda === undefined) {
        fila.push(null)
      } else if (celda.t === 'e') {
        fila.push({ error: celda.w || '#ERROR' })
      } else {
        // NO se convierte el Date aqui. Con xlsx@0.20.3 (ver package.json),
        // SheetJS con cellDates:true ya entrega el mismo instante que
        // exceljs para la misma celda: ambos motores construyen el Date
        // directo con Date.UTC(anio, mes, dia, hora, min, seg) a partir de
        // los componentes del serial de Excel (verificado reproduciendo el
        // round-trip .xlsx y .xls/biff8 con un serial conocido: ambos casos
        // dan igual celda.v.toISOString(), sin importar la zona horaria del
        // sistema). La version vieja de la libreria (0.18.5) SI tenia este
        // bug (el Date resultante quedaba en medianoche LOCAL, no UTC) --
        // si algun dia se baja de version, hay que volver a probar esto
        // antes de asumir que sigue sin hacer falta conversion.
        fila.push(celda.v ?? null)
      }
    }
    filas.push(fila)
  }
  return filas
}

/** Lee y valida el archivo completo. Devuelve { esquema, archivo, registros }
 *  donde registros es un Map folio->datos, o lanza ErrorImportacion con el
 *  detalle por fila (y en ese caso NO debe importarse nada). */
export async function parsearFoliosRuteo(archivo) {
  if (archivo.size > MAX_TAMANO_ARCHIVO_BYTES) {
    throw new ErrorImportacion(
      'El archivo pesa mas de 30 MB; verifica que sea el Excel de folios correcto.'
    )
  }
  const matriz = await leerMatriz(archivo)
  if (matriz.length === 0) throw new ErrorImportacion('El Excel esta vacio')

  const filaEncabezados = matriz[0].map((v) => textoCelda(v).toLowerCase())

  // El reporte 'Seguimiento de Folios' no tiene fila de encabezados: se
  // reconoce por el titulo del reporte en la fila 1.
  if (filaEncabezados.some((t) => t.includes('seguimiento de folios'))) {
    return parsearSeguimientoFolios(matriz, archivo)
  }

  const esquema = ESQUEMAS.find((e) =>
    e.encabezados.every((nombre, i) => filaEncabezados[i] === nombre)
  )
  if (!esquema) {
    throw new ErrorImportacion(
      'Los encabezados no coinciden con ninguno de los formatos esperados ' +
        `('Folios ruteo', 'DATOS PRODUCCION' o 'Seguimiento de Folios'). Encontrado: ${filaEncabezados.filter(Boolean).join(', ')}`
    )
  }

  const registros = new Map()
  const errores = []
  let filasProcesadas = 0

  for (let numFila = 2; numFila <= matriz.length; numFila++) {
    const valores = matriz[numFila - 1]
    if (valores.every((c) => textoCelda(c) === '')) continue // colas vacias de Excel

    filasProcesadas++
    if (filasProcesadas > MAX_FILAS) {
      throw new ErrorImportacion(`El archivo excede el maximo de ${MAX_FILAS} filas`)
    }

    const celdaFolioEscalar = escalarCelda(valores[0])
    const folioDemasiadoLargo = esFolioDemasiadoLargo(celdaFolioEscalar)
    const folioCrudo = textoCelda(valores[0])

    let folio = null
    let errorFolio = null
    if (folioCrudo === CELDA_INVALIDA) {
      errorFolio = 'folio invalido (celda con error de formula o valor no reconocido)'
    } else if (folioCrudo) {
      try {
        folio = canonizarFolio(normalizarFolio(folioCrudo))
      } catch (err) {
        errorFolio = err.message
      }
    }

    const celdaCodigoTexto = textoCelda(valores[2])
    let errorCodigo = null
    let codigo = ''
    if (celdaCodigoTexto === CELDA_INVALIDA) {
      errorCodigo = 'codigo invalido (celda con error de formula o valor no reconocido)'
    } else {
      codigo = celdaCodigoTexto.toUpperCase()
      if (codigo.length > 60) {
        errorCodigo = 'codigo demasiado largo (maximo 60 caracteres)'
      }
    }

    const docenas = numeroCeldaONull(valores[3])
    const pares = numeroCeldaONull(valores[4])
    const total = numeroCeldaONull(valores[5])
    const celdaFechaAct = escalarCelda(valores[7])
    const fechaActualizacion = fechaCeldaONull(valores[7])
    const pedidoCrudo = esquema.colPedido !== null ? textoCelda(valores[esquema.colPedido]) : ''
    const nombreGuiaCrudo = esquema.colNombreGuia !== null ? textoCelda(valores[esquema.colNombreGuia]) : ''
    const pedido = pedidoCrudo === CELDA_INVALIDA ? '' : pedidoCrudo
    const nombreGuia = recortarBytesUtf8(nombreGuiaCrudo === CELDA_INVALIDA ? '' : nombreGuiaCrudo, 120)

    const fechaActInvalida =
      celdaFechaAct !== null && textoCelda(celdaFechaAct) !== '' && fechaActualizacion === null

    if (folioDemasiadoLargo) {
      errores.push(
        `Fila ${numFila}: folio numerico demasiado largo; formatea la columna Folio como Texto en Excel`
      )
    } else if (!folioCrudo) {
      errores.push(`Fila ${numFila}: folio vacio`)
    } else if (errorFolio) {
      errores.push(`Fila ${numFila}: ${errorFolio}`)
    } else if (errorCodigo) {
      errores.push(`Fila ${numFila}: ${errorCodigo}`)
    } else if (!codigo) {
      errores.push(`Fila ${numFila}: codigo vacio`)
    } else if (docenas === CELDA_INVALIDA || pares === CELDA_INVALIDA || total === CELDA_INVALIDA) {
      errores.push(`Fila ${numFila}: docenas/pares/total no numerico`)
    } else if (
      (total !== null && total < 0) ||
      (docenas !== null && docenas < 0) ||
      (pares !== null && pares < 0)
    ) {
      errores.push(`Fila ${numFila}: cantidades negativas`)
    } else if (fechaActInvalida) {
      errores.push(`Fila ${numFila}: 'Fecha Actualizacion' no es una fecha valida`)
    } else if (pedido && (pedido.length > 100 || !PATRON_PEDIDO.test(pedido))) {
      errores.push(
        `Fila ${numFila}: pedido invalido (usa solo letras, numeros, punto, guion o guion bajo, maximo 100 caracteres)`
      )
    } else if ((total || docenas || 0) <= 0) {
      errores.push(`Fila ${numFila}: el folio no tiene docenas ni total mayor a cero`)
    } else if (registros.has(folio)) {
      errores.push(`Fila ${numFila}: folio ${folio} duplicado dentro del archivo`)
    } else {
      let totalFinal = total
      if ((totalFinal === null || totalFinal === 0) && docenas !== null && docenas > 0) {
        // Igual que el parser legado: total 0/ausente con docenas capturadas
        // usa docenas como respaldo.
        totalFinal = docenas
      }
      registros.set(folio, {
        folio,
        codigo,
        docenas,
        pares,
        total: totalFinal,
        pedido: pedido || null,
        nombreGuia: nombreGuia || null,
        // La columna 'Descripcion' de estos formatos no es la del producto
        // (trae textos como 'Ruteo manual por seleccion'): los datos de
        // producto solo vienen en el formato Seguimiento de Folios.
        descripcion: null,
        modelo: null,
        color: null,
        fecha: fechaCeldaONull(valores[1]),
        fechaActualizacion
      })
    }
    if (errores.length >= MAX_ERRORES_REPORTADOS) break
  }

  if (errores.length > 0) {
    throw new ErrorImportacion('El archivo tiene filas invalidas y NO se importo nada', errores)
  }
  if (registros.size === 0) {
    throw new ErrorImportacion('El archivo no contiene folios')
  }

  return {
    esquema: esquema.nombre,
    archivo: sanearNombre(archivo.name),
    registros,
    omitidasSinDocenas: 0,
    // Para el analisis de huecos de folios consecutivos: aqui todos los
    // folios validos quedaron en registros.
    foliosPresentes: new Set(registros.keys())
  }
}

// Numero flexible para el reporte Seguimiento de Folios: sus cantidades
// vienen como TEXTO ('24.00'). Solo se acepta el patron estricto de numero
// decimal positivo -- cualquier otro texto sigue siendo invalido.
function numeroTextoONull(valor) {
  const v = escalarCelda(valor)
  if (v === null || v === '') return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const m = /^(\d+)(\.\d+)?$/.exec(v.trim())
    if (m) {
      // Mas de 12 digitos enteros: un texto numerico asi de largo ya perdio
      // precision util (o, si es larguisimo como '9'.repeat(400), Number()
      // lo colapsaria a +Infinity) -- se rechaza antes de convertir.
      if (m[1].length > 12) return CELDA_INVALIDA
      const n = Number(v.trim())
      return Number.isFinite(n) ? n : CELDA_INVALIDA
    }
  }
  return CELDA_INVALIDA
}

// Fecha en texto dd/mm/aaaa (asi viene la columna A del reporte); devuelve
// null si esta vacia o no cuadra el patron/el calendario.
function fechaTextoONull(valor) {
  const v = escalarCelda(valor)
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v !== 'string') return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim())
  if (!m) return null
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // Convencion de este parser: todas las fechas de Excel se guardan como
  // sus componentes en UTC (ver leerMatriz), para que coincidan con las
  // fechas que si llegan como Date desde SheetJS/exceljs.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null
  return fecha
}

// Reporte 'Seguimiento de Folios': datos desde la fila 3, sin encabezados.
// A diferencia de los otros formatos, las filas SIN folio se saltan en vez de
// marcar error: el reporte trae filas estructurales (etiquetas de estatus,
// pie 'Página -N de N') que no son datos.
// PENDIENTE (Roberto): se usa la columna I (docenas surtidas) como docenas
// del PDF; la H (docenas pedidas) se descarta. Confirmar cual va.
function parsearSeguimientoFolios(matriz, archivo) {
  const registros = new Map()
  const errores = []
  let filasProcesadas = 0
  let omitidosSinDocenas = 0
  // Todos los folios que el archivo TRAE (aunque se omitan por docenas 0):
  // el analisis de huecos no debe marcarlos como faltantes -- existen, solo
  // que aun no estan surtidos.
  const foliosPresentes = new Set()

  for (let numFila = 3; numFila <= matriz.length; numFila++) {
    const valores = matriz[numFila - 1]
    const folioCrudo = textoCelda(valores[1])
    // Solo la celda VACIA identifica filas estructurales (pie de pagina,
    // etiquetas de estatus). Una celda con error de formula SI es un folio
    // real que trueno: debe marcarse como error de fila, no saltarse.
    if (folioCrudo === '') continue

    filasProcesadas++
    if (filasProcesadas > MAX_FILAS) {
      throw new ErrorImportacion(`El archivo excede el maximo de ${MAX_FILAS} filas`)
    }

    if (folioCrudo === CELDA_INVALIDA) {
      errores.push(`Fila ${numFila}: folio invalido (celda con error de formula o valor no reconocido)`)
      continue
    }

    const celdaFolioEscalar = escalarCelda(valores[1])
    if (esFolioDemasiadoLargo(celdaFolioEscalar)) {
      errores.push(
        `Fila ${numFila}: folio numerico demasiado largo; formatea la columna de folio como Texto en Excel`
      )
      continue
    }

    let folio
    try {
      folio = canonizarFolio(normalizarFolio(folioCrudo))
    } catch (err) {
      errores.push(`Fila ${numFila}: ${err.message}`)
      continue
    }
    foliosPresentes.add(folio)

    const celdaCodigo = textoCelda(valores[2])
    const codigo = celdaCodigo === CELDA_INVALIDA ? '' : celdaCodigo.toUpperCase()
    const docenas = numeroTextoONull(valores[8]) // columna I: docenas surtidas
    // A diferencia del export 'Folios ruteo' (donde pedido es un ID con
    // patron fijo), aqui el pedido es texto libre del sistema: trae ':',
    // 'Ñ', espacios, '/' y hasta caracteres de control (saltos de linea,
    // tabuladores). Se limpia y se acepta tal cual, truncado a 100 bytes.
    const pedidoCrudo = textoCelda(valores[3])
    const pedido =
      pedidoCrudo === CELDA_INVALIDA ? '' : recortarBytesUtf8(limpiarTextoLibre(pedidoCrudo), 100)
    const textoONull = (v) => {
      const t = textoCelda(v)
      return t === '' || t === CELDA_INVALIDA ? null : recortarBytesUtf8(limpiarTextoLibre(t), 200)
    }

    const fecha = fechaTextoONull(valores[0])
    const celdaFechaTexto = textoCelda(valores[0])
    // Columna A no vacia que no cuadra dd/mm/aaaa o es invalida de calendario
    // (31/02/2026): es un error de fila, no un null silencioso.
    const fechaInvalida = celdaFechaTexto !== '' && fecha === null

    if (celdaCodigo === CELDA_INVALIDA) {
      errores.push(`Fila ${numFila}: codigo invalido (celda con error de formula o valor no reconocido)`)
    } else if (!codigo) {
      errores.push(`Fila ${numFila}: codigo vacio`)
    } else if (codigo.length > 60) {
      errores.push(`Fila ${numFila}: codigo demasiado largo (maximo 60 caracteres)`)
    } else if (fechaInvalida) {
      errores.push(`Fila ${numFila}: fecha invalida (usa dd/mm/aaaa)`)
    } else if (docenas === CELDA_INVALIDA) {
      errores.push(`Fila ${numFila}: docenas no numericas`)
    } else if (docenas !== null && docenas < 0) {
      errores.push(`Fila ${numFila}: cantidades negativas`)
    } else if (docenas === null || docenas <= 0) {
      // Docenas en 0/vacio es el estado NORMAL de un folio aun no surtido:
      // no es un error, se omite de este archivo (America lo recargara
      // cuando el sistema lo actualice con docenas surtidas).
      omitidosSinDocenas++
    } else if (registros.has(folio)) {
      errores.push(`Fila ${numFila}: folio ${folio} duplicado dentro del archivo`)
    } else {
      registros.set(folio, {
        folio,
        codigo,
        docenas,
        pares: null,
        total: docenas,
        pedido: pedido || null,
        nombreGuia: null,
        descripcion: textoONull(valores[4]),
        modelo: textoONull(valores[5]),
        color: textoONull(valores[6]),
        fecha,
        // El reporte no trae 'Fecha Actualizacion': la politica de no pisar
        // datos mas nuevos se reduce a la comparacion de contenido.
        fechaActualizacion: null
      })
    }
    if (errores.length >= MAX_ERRORES_REPORTADOS) break
  }

  if (errores.length > 0) {
    throw new ErrorImportacion('El archivo tiene filas invalidas y NO se importo nada', errores)
  }
  // Si TODAS las filas traian docenas 0 (folios aun no surtidos), registros
  // queda vacio pero foliosPresentes SI trae folios: no es un archivo vacio,
  // es un archivo sin nada cargable todavia. El analisis de huecos sigue
  // siendo util con foliosPresentes -- no se debe bloquear con un error.
  if (registros.size === 0 && foliosPresentes.size === 0) {
    throw new ErrorImportacion('El archivo no contiene folios')
  }
  return {
    esquema: 'seguimiento_folios',
    archivo: sanearNombre(archivo.name),
    registros,
    omitidasSinDocenas: omitidosSinDocenas,
    foliosPresentes
  }
}

function sanearNombre(nombre) {
  nombre = (nombre || '').trim()
  let limpio = ''
  for (const c of nombre) {
    const cp = c.codePointAt(0)
    if (cp >= 32 && cp !== 127) limpio += c
  }
  return recortarBytesUtf8(limpio, 120)
}
