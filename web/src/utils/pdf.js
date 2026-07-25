// Genera el PDF de salida - reemplaza el Excel que antes armaba una segunda
// persona a partir de lo que capturaba America. 100% cliente (jsPDF), igual
// patron que captura-mecanicos usa para el cierre de turno.
import { jsPDF } from 'jspdf'

export function generarPdfSalida({ capturas, operador, fecha }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const margen = 40
  let y = margen

  pdf.setFontSize(16)
  pdf.text('Deportivos Quini - Salida de bultos', margen, y)
  y += 24

  pdf.setFontSize(10)
  pdf.text(`Fecha: ${fecha}`, margen, y)
  pdf.text(`Operador: ${operador}`, margen + 280, y)
  y += 20

  const totalPesoGramos = capturas.reduce((acc, c) => acc + (c.pesoGramos || 0), 0)
  pdf.text(`Total de bultos: ${capturas.length}    Peso total: ${(totalPesoGramos / 1000).toFixed(2)} kg`, margen, y)
  y += 24

  pdf.setFontSize(11)
  pdf.text('Folio', margen, y)
  pdf.text('Peso (kg)', margen + 200, y)
  pdf.text('Hora', margen + 320, y)
  y += 6
  pdf.line(margen, y, 572, y)
  y += 16

  pdf.setFontSize(10)
  for (const captura of capturas) {
    if (y > 740) {
      pdf.addPage()
      y = margen
    }
    pdf.text(String(captura.folio), margen, y)
    pdf.text((captura.pesoGramos / 1000).toFixed(2), margen + 200, y)
    pdf.text(captura.horaTexto || '-', margen + 320, y)
    y += 18
  }

  pdf.save(`salida_${fecha.replace(/[^0-9]/g, '')}.pdf`)
}
