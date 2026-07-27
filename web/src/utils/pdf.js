// Genera el PDF de salida con el MISMO formato que la hoja fisica de
// Deportivos Quini (folio/peso/codigo/descripcion/modelo/talla/color/
// referencia/linea/docenas/unidad/UPC + encabezado + resumen + firmas).
// RAGNAR-web hoy solo captura folio y peso: todo lo demas que el formato
// pide y todavia no se rastrea se deja como "N/A" a proposito, para que el
// documento ya tenga la forma correcta y solo falte llenar esos datos
// cuando se conecten Validacion/Ruteo/Atalanta mas adelante.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const NA = 'N/A'

export function generarPdfSalida({ capturas, operador, fecha }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const margen = 30
  const anchoUtil = pdf.internal.pageSize.getWidth() - margen * 2
  let y = margen

  // ---- Encabezado ----
  pdf.setFontSize(18)
  pdf.setFont(undefined, 'bold')
  pdf.text('DEPORTIVOS QUINI', margen, y + 14)
  pdf.setFont(undefined, 'normal')

  const cajaX = margen + anchoUtil - 220
  pdf.setFontSize(9)
  const datosCaja = [
    ['Folio Interno:', NA],
    ['Orden de Trabajo:', NA],
    ['Fecha Solicitud:', NA],
    ['Fecha Entrega:', NA]
  ]
  datosCaja.forEach((fila, i) => {
    pdf.text(fila[0], cajaX, y + i * 13)
    pdf.text(fila[1], cajaX + 100, y + i * 13)
  })

  y += 40
  pdf.setFontSize(10)
  const filaEtiquetas = [
    ['Area que Entrega:', 'DEPORTIVOS QUINI', 'Direccion Envio:', NA],
    ['Area que Recibe:', NA, 'Concepto Salida:', NA]
  ]
  filaEtiquetas.forEach((fila) => {
    pdf.setFont(undefined, 'bold')
    pdf.text(fila[0], margen, y)
    pdf.setFont(undefined, 'normal')
    pdf.text(fila[1], margen + 95, y)
    pdf.setFont(undefined, 'bold')
    pdf.text(fila[2], margen + anchoUtil - 220, y)
    pdf.setFont(undefined, 'normal')
    pdf.text(fila[3], margen + anchoUtil - 110, y)
    y += 16
  })
  y += 6

  // ---- Tabla principal: mismas columnas que la hoja fisica ----
  const columnas = [
    'FOLIO', 'PESO', 'Codigo', 'Descripcion', 'Modelo', 'Talla', 'Color',
    'Referencia', 'Linea', 'Cant. Docenas', 'Unidad', 'UPC'
  ]
  const filas = capturas.map((c) => [
    String(c.folio),
    (c.pesoGramos / 1000).toFixed(2),
    NA, NA, NA, NA, NA, NA, NA, NA, NA, NA
  ])

  autoTable(pdf, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [columnas],
    body: filas,
    foot: [[
      { content: `${capturas.length}`, styles: { fontStyle: 'bold' } },
      { content: 'BULTOS', colSpan: 7, styles: { fontStyle: 'bold' } },
      { content: 'TOTAL GENERAL', styles: { fontStyle: 'bold' } },
      { content: NA, colSpan: 3 }
    ]],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 245, 245], textColor: 20 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 45 },
      2: { cellWidth: 50 },
      3: { cellWidth: 147 },
      4: { cellWidth: 55 },
      5: { cellWidth: 45 },
      6: { cellWidth: 50 },
      7: { cellWidth: 60 },
      8: { cellWidth: 55 },
      9: { cellWidth: 60 },
      10: { cellWidth: 50 },
      11: { cellWidth: 55 }
    }
  })

  y = pdf.lastAutoTable.finalY + 20

  // El resto (resumen + observaciones + firmas) necesita unos 220pt. Si no
  // alcanza el espacio en la pagina donde termino la tabla principal (que
  // con muchas capturas puede paginarse sola), se agrega una pagina nueva
  // en vez de encimar o dejar contenido fuera de la hoja.
  const paginaAlto = pdf.internal.pageSize.getHeight()
  const ESPACIO_RESTANTE_NECESARIO = 220
  if (y + ESPACIO_RESTANTE_NECESARIO > paginaAlto - margen) {
    pdf.addPage()
    y = margen
  }

  // ---- Resumen por codigo (todo N/A: el codigo de producto todavia no se captura) ----
  autoTable(pdf, {
    startY: y,
    margin: { left: margen },
    tableWidth: 260,
    head: [['Codigo', 'Total por Codigo', 'Piezas']],
    body: [[NA, NA, NA]],
    foot: [['TOTAL GRAL.', String(capturas.length), NA]],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' }
  })

  const yResumen = pdf.lastAutoTable.finalY

  // ---- Observaciones + firma de quien entrega, a la par del resumen ----
  const xFirma = margen + 300
  pdf.setFontSize(9)
  pdf.setFont(undefined, 'bold')
  pdf.text('OBSERVACIONES:', xFirma, y)
  pdf.setFont(undefined, 'normal')
  pdf.line(xFirma + 85, y, xFirma + 400, y)

  pdf.setFont(undefined, 'bold')
  pdf.text('NOMBRE:', xFirma, y + 28)
  pdf.setFont(undefined, 'normal')
  pdf.text(operador || '-', xFirma + 55, y + 28)

  pdf.setFont(undefined, 'bold')
  pdf.text('FECHA:', xFirma, y + 46)
  pdf.setFont(undefined, 'normal')
  pdf.text(fecha, xFirma + 55, y + 46)

  pdf.setFont(undefined, 'bold')
  pdf.text('FIRMA:', xFirma, y + 64)
  pdf.line(xFirma + 55, y + 64, xFirma + 300, y + 64)

  // ---- Firmas de entrega / transporte / recibe ----
  let yFirmas = Math.max(yResumen, y + 90) + 30
  if (yFirmas > paginaAlto - 60) {
    pdf.addPage()
    yFirmas = margen + 40
  }

  const anchoFirma = anchoUtil / 3
  const bloques = [
    ['ENTREGA', margen],
    ['TRANSPORTE', margen + anchoFirma],
    ['RECIBE', margen + anchoFirma * 2]
  ]
  bloques.forEach(([titulo, x]) => {
    pdf.line(x, yFirmas, x + anchoFirma - 20, yFirmas)
    pdf.setFontSize(8)
    pdf.text('Nombre, Firma, Fecha y Hora', x, yFirmas + 12)
    pdf.setFont(undefined, 'bold')
    pdf.text(titulo, x, yFirmas - 4)
    pdf.setFont(undefined, 'normal')
  })

  pdf.save(`salida_${fecha.replace(/[^0-9]/g, '')}.pdf`)
}
