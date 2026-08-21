import { cargarWorkbook } from './excelJs.js'
// Excel del panel de Reportes: NO es el Excel de migracion (ese vive en
// excelSalida.js con sus 4 columnas exactas). Este es para consulta humana:
// una hoja con el resumen por maquila y otra con el detalle de cada folio,
// tal como quedaron tras aplicar los filtros en pantalla.

/** Arma el .xlsx del reporte y lo devuelve como Blob. */
export async function generarExcelReporte({ resumenMaquilas, detalle, etiquetaRango, filtros, desde, hasta }) {
  const Workbook = await cargarWorkbook()
  const libro = new Workbook()
  libro.creator = 'RAGNAR - Deportivos Quini'
  libro.created = new Date()

  const hojaResumen = libro.addWorksheet('Resumen')
  hojaResumen.addRow(['Reporte de salidas - Deportivos Quini'])
  hojaResumen.getRow(1).font = { bold: true, size: 14 }
  hojaResumen.addRow(['Periodo', etiquetaRango])
  if (filtros && filtros.length > 0) {
    hojaResumen.addRow(['Filtros', filtros.join(' | ')])
  }
  hojaResumen.addRow([])

  const encResumen = ['Maquila', 'Documentos (PDF)', 'Folios', 'Docenas', 'Peso (kg)']
  hojaResumen.addRow(encResumen)
  hojaResumen.getRow(hojaResumen.rowCount).font = { bold: true }
  resumenMaquilas.forEach((m) => {
    hojaResumen.addRow([
      m.maquila,
      m.documentos,
      m.folios,
      Number(m.docenas.toFixed(2)),
      Number((m.pesoGramos / 1000).toFixed(2))
    ])
  })
  const totalDocs = resumenMaquilas.reduce((a, m) => a + m.documentos, 0)
  const totalFolios = resumenMaquilas.reduce((a, m) => a + m.folios, 0)
  const totalDocenas = resumenMaquilas.reduce((a, m) => a + m.docenas, 0)
  const totalPeso = resumenMaquilas.reduce((a, m) => a + m.pesoGramos, 0)
  hojaResumen.addRow([])
  const filaTotal = hojaResumen.addRow([
    'TOTAL',
    totalDocs,
    totalFolios,
    Number(totalDocenas.toFixed(2)),
    Number((totalPeso / 1000).toFixed(2))
  ])
  filaTotal.font = { bold: true }
  hojaResumen.columns = [{ width: 34 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 14 }]

  const hojaDetalle = libro.addWorksheet('Detalle')
  const encDetalle = [
    'Fecha', 'Folio interno', 'Maquila', 'Genero', 'Folio', 'Codigo', 'Producto', 'Docenas', 'Peso (kg)'
  ]
  hojaDetalle.addRow(encDetalle)
  hojaDetalle.getRow(1).font = { bold: true }
  detalle.forEach((d) => {
    hojaDetalle.addRow([
      d.fecha,
      d.folioInterno ?? '',
      d.maquila ?? '',
      d.genero ?? '',
      // Folio como TEXTO: son consecutivos largos y, como numero, Excel les
      // quitaria ceros a la izquierda o los pasaria a notacion cientifica.
      String(d.folio),
      d.codigo ?? '',
      d.producto ?? '',
      typeof d.docenas === 'number' ? d.docenas : '',
      Number(((d.pesoGramos || 0) / 1000).toFixed(2))
    ])
  })
  hojaDetalle.columns = [
    { width: 12 }, { width: 13 }, { width: 28 }, { width: 20 },
    { width: 14 }, { width: 14 }, { width: 30 }, { width: 10 }, { width: 12 }
  ]
  hojaDetalle.getColumn(5).numFmt = '@'

  const buffer = await libro.xlsx.writeBuffer()
  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    nombreArchivo:
      desde && hasta
        ? desde === hasta
          ? `reporte_salidas_${desde}.xlsx`
          : `reporte_salidas_${desde}_al_${hasta}.xlsx`
        : 'reporte_salidas.xlsx'
  }
}
