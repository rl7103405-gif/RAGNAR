// EL PDF DEL PL: el papel que viaja con la mercancía y que el cliente FIRMA.
//
// Son dos salidas distintas y no compiten (Roberto, 2026-09-02):
//   - El EXCEL (`excelPL.js`) es para subir a Microsip: una sola hoja, con
//     todas las entregas de la orden en bloques, y los totales por fórmula.
//   - Este PDF es el papel de UNA entrega: el que se imprime, viaja con el
//     embarque y donde firman la salida y el recibido.
//
// Por eso este documento NO lleva las seis columnas de entregas: quien firma
// está recibiendo LO DE HOY, y meterle en la misma hoja lo que ya se entregó
// hace semanas solo invita a que firme por mercancía que no está viendo.
//
// El formato copia el papel de Valeria Montesinos (Logística), tomado de sus
// dos PL reales: encabezado con SUBCLIENTE / PO# / OC# / PL, el bloque de la
// entrega (FACTURA, FECHA, ENTREGA #, BITÁCORA), la tabla por clave y, al
// cierre, las cuatro firmas que trae su hoja — ELABORÓ, SURTIÓ, TRANSPORTE y
// el sello de recibido del cliente.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { LOGO_QUINI_PNG_BASE64 } from '../assets/logoQuini'

const texto = (v) => (v === null || v === undefined ? '' : String(v))
const pesos = (n) =>
  '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

/**
 * Genera el PDF de UNA entrega del PL.
 *
 * `entrega` es el acta tal como se guardó (`entregasPL`), con su encabezado y
 * sus renglones. `elaboro` es quien lo está generando.
 */
export function generarPdfPL({ entrega, elaboro, esPrueba = false }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const paginaAncho = pdf.internal.pageSize.getWidth()
  const paginaAlto = pdf.internal.pageSize.getHeight()
  const margen = 32
  const anchoUtil = paginaAncho - margen * 2

  const renglones = entrega?.renglones || []
  const totalBultos = renglones.reduce((a, r) => a + (Number(r.bultos) || 0), 0)
  const totalPacks = renglones.reduce((a, r) => a + (Number(r.packs) || 0), 0)
  const totalPiezas = renglones.reduce((a, r) => a + (Number(r.piezas) || 0), 0)
  const totalImporte = renglones.reduce((a, r) => a + (Number(r.importe) || 0), 0)

  const dibujarEncabezado = () => {
    let y = margen

    if (esPrueba) {
      // Igual que en los demás papeles: una prueba tiene que gritar que lo es,
      // o alguien la manda con la mercancía.
      pdf.setFillColor(255, 243, 205)
      pdf.rect(margen, y, anchoUtil, 16, 'F')
      pdf.setFontSize(9)
      pdf.setFont(undefined, 'bold')
      pdf.setTextColor(146, 64, 14)
      pdf.text('DOCUMENTO DE PRUEBA - NO ES UN EMBARQUE REAL', margen + 6, y + 11)
      pdf.setTextColor(0, 0, 0)
      y += 22
    }

    try {
      pdf.addImage(LOGO_QUINI_PNG_BASE64, 'PNG', margen, y, 36, 36)
    } catch {
      // Sin logo el papel sigue sirviendo: no se cae por una imagen.
    }

    pdf.setFontSize(15)
    pdf.setFont(undefined, 'bold')
    pdf.text('PACKING LIST', margen + 46, y + 15)
    pdf.setFontSize(10)
    pdf.setFont(undefined, 'normal')
    pdf.text('DEPORTIVOS QUINI', margen + 46, y + 30)

    // Datos del pedido, a la derecha.
    const derecha = margen + anchoUtil
    pdf.setFontSize(9)
    const par = (etiqueta, valor, fila) => {
      const yy = y + 10 + fila * 12
      pdf.setFont(undefined, 'bold')
      pdf.text(etiqueta, derecha - 190, yy)
      pdf.setFont(undefined, 'normal')
      pdf.text(texto(valor) || '', derecha - 120, yy)
    }
    par('SUBCLIENTE:', entrega?.subcliente, 0)
    par('PL:', entrega?.pl, 1)
    par('PO#:', entrega?.po, 2)
    par('OC#:', entrega?.ocCliente || entrega?.oc, 3)

    // 58, no 44: los cuatro renglones del pedido ocupan hasta y+46 (10 + 3
    // saltos de 12) y con 44 el ultimo, OC#, quedaba ENCIMADO con la caja de
    // la entrega. Se ve feo y ademas tapa un dato del papel.
    y += 58

    // El bloque de ESTA entrega. Lo que no se capturó va en blanco, con su
    // línea para escribirlo a mano: es un papel, y la factura muchas veces se
    // pone después de imprimirlo.
    pdf.setDrawColor(150)
    pdf.rect(margen, y, anchoUtil, 30)
    const campos = [
      ['ENTREGA #', texto(entrega?.numeroEntrega)],
      ['FECHA DE ENTREGA', texto(entrega?.fechaEntregaTexto)],
      ['FACTURA', texto(entrega?.factura)],
      ['BITACORA', texto(entrega?.bitacora)],
      ['PED. MICRO', texto(entrega?.pedidoMicrosip)],
      ['REM. MICRO', texto(entrega?.remisionMicrosip)]
    ]
    const ancho = anchoUtil / campos.length
    campos.forEach(([etq, val], i) => {
      const x = margen + ancho * i
      if (i > 0) pdf.line(x, y, x, y + 30)
      pdf.setFontSize(7)
      pdf.setFont(undefined, 'bold')
      pdf.text(etq, x + 6, y + 11)
      pdf.setFont(undefined, 'normal')
      pdf.setFontSize(10)
      if (val) {
        pdf.text(val, x + 6, y + 24)
      } else {
        // Línea para escribirlo a mano, en vez de un hueco mudo.
        pdf.setDrawColor(190)
        pdf.line(x + 6, y + 24, x + ancho - 12, y + 24)
        pdf.setDrawColor(150)
      }
    })
    return y + 30
  }

  const yTabla = dibujarEncabezado() + 10

  autoTable(pdf, {
    startY: yTabla,
    margin: { left: margen, right: margen, bottom: 92 },
    head: [['OT', 'CLAVE', 'ARTICULO', 'U.M.', 'PRECIO', 'EMPAQUE', 'BULTOS', 'PAQS', 'PZAS', 'IMPORTE']],
    body: renglones.map((r) => [
      texto(r.ot) || '-',
      texto(r.clave),
      texto(r.articulo),
      texto(r.unidad) || 'PZA',
      r.precio ? pesos(r.precio) : '',
      texto(r.empaque),
      texto(r.bultos),
      texto(r.packs),
      texto(r.piezas),
      r.importe ? pesos(r.importe) : ''
    ]),
    foot: [[
      '', '', 'TOTALES', '', '', '',
      String(totalBultos), String(totalPacks), String(totalPiezas),
      totalImporte ? pesos(totalImporte) : ''
    ]],
    styles: { fontSize: 8, cellPadding: 3, lineColor: [170, 170, 170], lineWidth: 0.4 },
    headStyles: { fillColor: [31, 75, 122], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
    footStyles: { fillColor: [238, 242, 247], textColor: 20, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 44 },
      1: { cellWidth: 82 },
      3: { cellWidth: 32, halign: 'center' },
      4: { cellWidth: 52, halign: 'right' },
      5: { cellWidth: 72 },
      6: { cellWidth: 42, halign: 'right' },
      7: { cellWidth: 48, halign: 'right' },
      8: { cellWidth: 48, halign: 'right' },
      9: { cellWidth: 64, halign: 'right' }
    },
    didDrawPage: (datos) => {
      // En las hojas siguientes se repite el encabezado: una hoja suelta sin
      // saber de qué embarque es no sirve para firmar nada.
      if (datos.pageNumber > 1) dibujarEncabezado()
      const pagina = `Hoja ${datos.pageNumber}`
      pdf.setFontSize(7.5)
      pdf.setFont(undefined, 'normal')
      pdf.text(pagina, paginaAncho - margen, paginaAlto - 12, { align: 'right' })
    }
  })

  // ---- Firmas. Las cuatro que trae el papel de Valeria. -------------------
  let y = pdf.lastAutoTable.finalY + 40
  const altoBloque = 26
  if (y + altoBloque > paginaAlto - margen) {
    pdf.addPage()
    y = dibujarEncabezado() + 50
  }

  const bloques = [
    ['ELABORO', `${String(elaboro || '').slice(0, 26)}`],
    ['SURTIO', ''],
    ['TRANSPORTE', ''],
    ['FIRMA / SELLO DE RECIBIDO', '']
  ]
  const anchoFirma = anchoUtil / bloques.length
  bloques.forEach(([titulo, valor], i) => {
    const x = margen + anchoFirma * i
    const anchoLinea = anchoFirma - 24
    pdf.setFontSize(8.5)
    pdf.setFont(undefined, 'bold')
    pdf.text(titulo, x, y - 16)
    pdf.setFont(undefined, 'normal')
    if (valor) {
      pdf.setFontSize(8)
      pdf.text(valor, x, y - 4, { maxWidth: anchoLinea })
    }
    pdf.setDrawColor(120)
    pdf.line(x, y, x + anchoLinea, y)
    pdf.setFontSize(7)
    pdf.text('Nombre, firma y fecha', x, y + 10)
  })

  return pdf.output('blob')
}
