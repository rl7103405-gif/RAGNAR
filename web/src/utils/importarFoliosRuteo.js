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

/** Lee y valida el archivo completo. Devuelve { esquema, archivo, registros }
 *  donde registros es un Map folio->datos, o lanza ErrorImportacion con el
 *  detalle por fila (y en ese caso NO debe importarse nada). */
export async function parsearFoliosRuteo(archivo) {
  if (archivo.size > MAX_TAMANO_ARCHIVO_BYTES) {
    throw new ErrorImportacion(
      'El archivo pesa mas de 30 MB; verifica que sea el Excel de folios correcto.'
    )
  }
  const { Workbook } = await import('exceljs')
  const libro = new Workbook()
  try {
    await libro.xlsx.load(await archivo.arrayBuffer())
  } catch (err) {
    throw new ErrorImportacion('No se pudo abrir el Excel: ' + (err.message || err))
  }
  if (libro.worksheets.length === 0) throw new ErrorImportacion('El Excel no tiene hojas')

  // La plantilla .xlsm trae la hoja util con nombre fijo; si no existe se usa
  // la primera (caso del archivo de folios ruteo, con hoja unica).
  const hoja =
    libro.worksheets.find((h) => h.name.trim().toUpperCase() === 'DATOS PRODUCCION') ||
    libro.worksheets[0]

  const filaEncabezados = hoja.getRow(1).values.map((v) => textoCelda(v).toLowerCase())
  // row.values de exceljs es 1-based (indice 0 vacio): se descarta.
  filaEncabezados.shift()

  const esquema = ESQUEMAS.find((e) =>
    e.encabezados.every((nombre, i) => filaEncabezados[i] === nombre)
  )
  if (!esquema) {
    throw new ErrorImportacion(
      'Los encabezados no coinciden con ninguno de los formatos esperados ' +
        `('Folios ruteo' o 'DATOS PRODUCCION'). Encontrado: ${filaEncabezados.filter(Boolean).join(', ')}`
    )
  }

  const registros = new Map()
  const errores = []
  // hoja.actualRowCount solo cuenta filas CON datos: una fila vacia intermedia
  // (comun en exports de Excel) trunca el recorrido y omite folios en
  // silencio. hoja.rowCount es el numero real de la ultima fila.
  let filasProcesadas = 0

  for (let numFila = 2; numFila <= hoja.rowCount; numFila++) {
    const valores = hoja.getRow(numFila).values.slice(1) // quitar hueco 0
    if (valores.every((c) => textoCelda(c) === '')) continue // colas vacias de Excel

    filasProcesadas++
    if (filasProcesadas > MAX_FILAS) {
      throw new ErrorImportacion(`El archivo excede el maximo de ${MAX_FILAS} filas`)
    }

    const celdaFolioEscalar = escalarCelda(valores[0])
    const folioNumericoDemasiadoLargo =
      typeof celdaFolioEscalar === 'number' && !Number.isSafeInteger(celdaFolioEscalar)
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
    const nombreGuia = (nombreGuiaCrudo === CELDA_INVALIDA ? '' : nombreGuiaCrudo).slice(0, 120)

    const fechaActInvalida =
      celdaFechaAct !== null && textoCelda(celdaFechaAct) !== '' && fechaActualizacion === null

    if (folioNumericoDemasiadoLargo) {
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

  return { esquema: esquema.nombre, archivo: sanearNombre(archivo.name), registros }
}

function sanearNombre(nombre) {
  nombre = (nombre || '').trim()
  let limpio = ''
  for (const c of nombre) {
    const cp = c.codePointAt(0)
    if (cp >= 32 && cp !== 127) limpio += c
  }
  return limpio.slice(0, 120)
}
