// Excel de migracion que acompaña a cada PDF de salida. Es la carga masiva
// que se sube al sistema para que todo quede resguardado en el mismo lugar:
// SOLO cuatro columnas (Folio, Codigo, Docenas, Pares), sin encabezados
// decorativos ni totales, para que entre limpio.
import { cargarWorkbook } from './excelJs.js'
import { compararAscendente } from './texto'

const ENCABEZADOS = ['Folio', 'Codigo', 'Docenas', 'Pares']

/** Arma el .xlsx y lo devuelve como Blob (quien llama decide cuando
 *  descargarlo, igual que con el PDF). */
export async function generarExcelSalida({ capturas, fecha }) {
  const Workbook = await cargarWorkbook()
  const libro = new Workbook()
  libro.creator = 'RAGNAR - Deportivos Quini'
  libro.created = new Date()
  const hoja = libro.addWorksheet('Salida')

  hoja.addRow(ENCABEZADOS)
  hoja.getRow(1).font = { bold: true }

  // Folios en orden ascendente: el sistema destino y quien coteja el papel
  // esperan la misma secuencia que el PDF.
  const ordenadas = [...capturas].sort((a, b) => compararAscendente(a.folio, b.folio))
  ordenadas.forEach((c) => {
    const p = c.producto || {}
    const docenas = typeof p.docenas === 'number' ? p.docenas : p.total
    hoja.addRow([
      // Folio como TEXTO: son consecutivos largos y, como numero, Excel les
      // quitaria ceros a la izquierda o los pasaria a notacion cientifica.
      String(c.folio),
      p.codigo ?? '',
      typeof docenas === 'number' ? docenas : '',
      // Pares SIEMPRE en 0 (pedido por Roberto el 2026-08-04; antes era
      // docenas x 12): la migracion solo toma las docenas y el sistema
      // destino calcula lo demas.
      0
    ])
  })

  hoja.columns = [
    { width: 14 },
    { width: 14 },
    { width: 10 },
    { width: 10 }
  ]
  // La columna de folio se fuerza a texto para que el sistema destino la lea
  // tal cual se capturo.
  hoja.getColumn(1).numFmt = '@'

  const buffer = await libro.xlsx.writeBuffer()
  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    nombreArchivo: `salida_${String(fecha).replace(/[^0-9]/g, '')}.xlsx`
  }
}

/** Dispara la descarga de un Blob en el navegador. */
export function descargarArchivo(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreArchivo
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}
