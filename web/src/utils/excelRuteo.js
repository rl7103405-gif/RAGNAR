// Excel del RUTEO que hay hoy en RAGNAR, para cotejarlo contra el archivo de
// America.
//
// Roberto lo pidio el 2026-08-31, cuando Atalanta empezo a mandar los folios
// solos a las 02:00: "mientras, que America siga subiendo para corroborar que
// nos este mandando los datos correctos... nada mas seria poder descargarlos".
//
// La gracia es poder comparar DOS FUENTES de la misma coleccion, asi que cada
// renglon dice DE DONDE vino (`archivoOrigen`) y CUANDO se escribio: sin esas
// dos columnas, un Excel de 5,500 folios no sirve para cotejar nada.
//
// Sale ordenado por folio ascendente, el mismo criterio que el resto de la app
// (`compararAscendente`), para que un WinMerge o un BUSCARV contra el archivo
// de America cuadre renglon con renglon.
import { cargarWorkbook } from './excelJs.js'
import { compararAscendente } from './texto'

const texto = (v) => String(v ?? '')
const fechaTexto = (t) => {
  const d = t?.toDate ? t.toDate() : null
  return d ? d.toLocaleString('es-MX') : ''
}

/** Arma el .xlsx del ruteo vigente y lo devuelve como Blob. */
export async function generarExcelRuteo(folios) {
  const Workbook = await cargarWorkbook()
  const libro = new Workbook()
  libro.creator = 'RAGNAR - Deportivos Quini'
  libro.created = new Date()

  const hoja = libro.addWorksheet('Ruteo en RAGNAR')
  hoja.addRow([
    'Folio',
    'Codigo',
    'Docenas',
    'Pares',
    'Total',
    'Pedido',
    'Descripcion',
    'Fecha del folio',
    'Fecha actualizacion',
    'De donde vino',
    'Cuando entro a RAGNAR'
  ])
  hoja.getRow(1).font = { bold: true }

  const ordenados = [...folios].sort((a, b) => compararAscendente(a.folio, b.folio))
  ordenados.forEach((f) => {
    hoja.addRow([
      // Folio como TEXTO: son consecutivos largos y, como numero, Excel les
      // quitaria ceros a la izquierda o los pasaria a notacion cientifica.
      texto(f.folio),
      texto(f.codigo),
      typeof f.docenas === 'number' ? f.docenas : '',
      typeof f.pares === 'number' ? f.pares : '',
      typeof f.total === 'number' ? f.total : '',
      texto(f.pedido),
      texto(f.descripcion),
      fechaTexto(f.fecha),
      fechaTexto(f.fechaActualizacion),
      texto(f.archivoOrigen),
      fechaTexto(f.cargadoEn)
    ])
  })

  hoja.columns = [
    { width: 12 }, { width: 12 }, { width: 10 }, { width: 8 }, { width: 9 },
    { width: 34 }, { width: 34 }, { width: 20 }, { width: 20 },
    { width: 44 }, { width: 20 }
  ]
  hoja.getColumn(1).numFmt = '@'
  hoja.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }]

  const buffer = await libro.xlsx.writeBuffer()
  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    nombre: `RUTEO-en-RAGNAR-${new Date().toISOString().slice(0, 10)}.xlsx`,
    filas: ordenados.length
  }
}
