// Genera el PDF de salida con el MISMO formato que la hoja fisica de
// Deportivos Quini (folio/peso/codigo/descripcion/modelo/talla/color/
// referencia/linea/docenas/unidad/UPC + encabezado + resumen + firmas).
// Los datos de producto salen del snapshot congelado en cada captura
// (bultos/{folio}.producto: Excel del dia + catalogo, resueltos al pesar);
// lo que no exista en esas fuentes (UPC, folio interno, fechas de la orden)
// se queda como "N/A" a proposito.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { LOGO_QUINI_PNG_BASE64 } from '../assets/logoQuini'

const NA = 'N/A'

function celda(valor) {
  return valor === null || valor === undefined || valor === '' ? NA : String(valor)
}

export function generarPdfSalida({ capturas, operador, fecha }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const margen = 30
  const anchoUtil = pdf.internal.pageSize.getWidth() - margen * 2
  let y = margen

  // ---- Encabezado: logo + titulo (izquierda), caja de folio/fechas (derecha) ----
  const logoLado = 40
  try {
    pdf.addImage(LOGO_QUINI_PNG_BASE64, 'PNG', margen, y, logoLado, logoLado)
  } catch (e) {
    console.error('[pdf] No se pudo dibujar el logo:', e)
  }
  pdf.setFontSize(16)
  pdf.setFont(undefined, 'bold')
  pdf.text('DEPORTIVOS QUINI', margen + logoLado + 12, y + logoLado / 2 + 5)
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
    pdf.text(fila[0], cajaX, y + 10 + i * 13)
    pdf.text(fila[1], cajaX + 100, y + 10 + i * 13)
  })

  // Avanza lo suficiente para dejar atras AMBOS bloques del encabezado
  // (logo/titulo a la izquierda, caja de 4 filas a la derecha) antes de
  // seguir. Antes este avance era un numero fijo que no tomaba en cuenta
  // la altura real de la caja, y "Direccion Envio" quedaba encimado con
  // "Fecha Entrega".
  const altoCaja = 10 + (datosCaja.length - 1) * 13 + 14
  y += Math.max(logoLado, altoCaja) + 14
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
  const filas = capturas.map((c) => {
    const p = c.producto || {}
    const docenas = p.docenas ?? p.total ?? null
    return [
      String(c.folio),
      (c.pesoGramos / 1000).toFixed(2),
      celda(p.codigo),
      celda(p.descripcion),
      celda(p.modelo),
      celda(p.talla),
      celda(p.color),
      celda(p.referencia),
      celda(p.linea),
      celda(docenas),
      docenas === null ? NA : 'DOCENAS',
      NA // UPC: no existe en el Excel del dia ni en el catalogo
    ]
  })
  const totalDocenas = capturas.reduce((acc, c) => {
    const d = c.producto?.docenas ?? c.producto?.total
    return acc + (typeof d === 'number' ? d : 0)
  }, 0)

  autoTable(pdf, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [columnas],
    body: filas,
    foot: [[
      { content: `${capturas.length}`, styles: { fontStyle: 'bold' } },
      { content: 'BULTOS', colSpan: 7, styles: { fontStyle: 'bold' } },
      { content: 'TOTAL GENERAL', styles: { fontStyle: 'bold' } },
      { content: totalDocenas > 0 ? String(totalDocenas) : NA, colSpan: 3 }
    ]],
    showFoot: 'lastPage',
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

  // ---- Resumen por codigo: suma de docenas de las capturas de cada codigo.
  // "Piezas" = docenas x 12 (confirmado por Roberto el 2026-07-27).
  const porCodigo = new Map()
  capturas.forEach((c) => {
    const codigo = c.producto?.codigo || 'SIN CODIGO'
    const d = c.producto?.docenas ?? c.producto?.total
    const acumulado = porCodigo.get(codigo) || { docenas: 0, conDocenas: false }
    if (typeof d === 'number') {
      acumulado.docenas += d
      acumulado.conDocenas = true
    }
    porCodigo.set(codigo, acumulado)
  })
  const filasResumen = Array.from(porCodigo.entries()).map(([codigo, acc]) => [
    codigo,
    acc.conDocenas ? String(acc.docenas) : NA,
    acc.conDocenas ? String(acc.docenas * 12) : NA
  ])

  // El resto (resumen + observaciones + firmas) necesita unos 220pt mas lo
  // que crezca el resumen por codigo. Si no alcanza el espacio en la pagina
  // donde termino la tabla principal (que con muchas capturas puede
  // paginarse sola), se agrega una pagina nueva en vez de encimar o dejar
  // contenido fuera de la hoja. Si el propio resumen es mas alto que una
  // pagina, autoTable lo pagina solo.
  const paginaAlto = pdf.internal.pageSize.getHeight()
  const espacioNecesario = Math.min(220 + filasResumen.length * 14, paginaAlto - margen * 2)
  if (y + espacioNecesario > paginaAlto - margen) {
    pdf.addPage()
    y = margen
  }

  autoTable(pdf, {
    startY: y,
    margin: { left: margen },
    tableWidth: 260,
    head: [['Codigo', 'Total por Codigo', 'Piezas']],
    body: filasResumen,
    foot: [['TOTAL GRAL.', totalDocenas > 0 ? String(totalDocenas) : NA, totalDocenas > 0 ? String(totalDocenas * 12) : NA]],
    showFoot: 'lastPage',
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
