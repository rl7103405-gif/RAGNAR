// Excel de migracion que acompaña a cada PDF de salida. Es la carga masiva
// que se sube al sistema para que todo quede resguardado en el mismo lugar:
// SOLO cuatro columnas (Folio, Codigo, Docenas, Pares), sin encabezados
// decorativos ni totales, para que entre limpio.
const ENCABEZADOS = ['Folio', 'Codigo', 'Docenas', 'Pares']

/** Arma el .xlsx y lo devuelve como Blob (quien llama decide cuando
 *  descargarlo, igual que con el PDF). */
export async function generarExcelSalida({ capturas, fecha }) {
  const { Workbook } = await import('exceljs')
  const libro = new Workbook()
  libro.creator = 'RAGNAR - Deportivos Quini'
  libro.created = new Date()
  const hoja = libro.addWorksheet('Salida')

  hoja.addRow(ENCABEZADOS)
  hoja.getRow(1).font = { bold: true }

  capturas.forEach((c) => {
    const p = c.producto || {}
    const docenas = typeof p.docenas === 'number' ? p.docenas : p.total
    hoja.addRow([
      // Folio como TEXTO: son consecutivos largos y, como numero, Excel les
      // quitaria ceros a la izquierda o los pasaria a notacion cientifica.
      String(c.folio),
      p.codigo ?? '',
      typeof docenas === 'number' ? docenas : '',
      // Pares = docenas x 12 (confirmado por Roberto el 2026-07-30). NO se
      // usa el campo 'pares' del Excel de ruteo: ese casi siempre viene en 0
      // y no es lo que necesita la migracion.
      typeof docenas === 'number' ? docenas * 12 : ''
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
