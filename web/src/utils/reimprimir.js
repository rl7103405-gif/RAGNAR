// Reimpresion fiel de un PDF de salida ya emitido: usa EXCLUSIVAMENTE el
// contenido congelado del registro de pdfsGenerados, nunca las capturas
// "vivas", para que el papel reproducido sea identico al original aunque los
// pesos hayan cambiado despues. Compartido por Historial y Reportes.
import { generarPdfSalida, descargarPdf } from './pdf'
import { generarExcelSalida, descargarArchivo } from './excelSalida'

export class ErrorReimpresion extends Error {}

/** Reimprime el PDF + Excel de un registro. Devuelve el texto de aviso para
 *  mostrar en pantalla; lanza ErrorReimpresion si el registro no tiene
 *  contenido congelado usable. */
export async function reimprimirRegistro(registro) {
  if (
    !registro.capturas ||
    registro.capturas.length === 0 ||
    registro.capturas.some((c) => typeof c.pesoGramos !== 'number')
  ) {
    throw new ErrorReimpresion('Este registro no tiene contenido congelado; no se puede reimprimir.')
  }
  // fechaTexto (congelado al generar) reproduce la fecha EXACTA que ya salio
  // impresa; solo los registros anteriores a ese campo caen al respaldo.
  const fechaOriginal =
    registro.fechaTexto ||
    (registro.creadoEn?.toDate
      ? registro.creadoEn.toDate().toLocaleDateString('es-MX')
      : new Date().toLocaleDateString('es-MX'))

  const { blob, nombreArchivo } = generarPdfSalida({
    capturas: registro.capturas,
    operador: registro.generadoPor,
    fecha: fechaOriginal,
    encabezado: registro.encabezado || {},
    // La marca sale del REGISTRO, no de quien reimprime: una remision de
    // prueba reimpresa por Roberto sigue siendo de prueba, y una real
    // reimpresa desde una cuenta de prueba no debe salir marcada.
    esPrueba: registro.esPrueba === true
  })
  descargarPdf(blob, nombreArchivo.replace('.pdf', '_copia.pdf'))

  // El Excel de migracion se rehace con el MISMO contenido congelado: si la
  // carga al sistema fallo o se perdio el archivo, se recupera igual al original.
  const excel = await generarExcelSalida({ capturas: registro.capturas, fecha: fechaOriginal })
  descargarArchivo(excel.blob, excel.nombreArchivo.replace('.xlsx', '_copia.xlsx'))

  return `Copia del PDF y del Excel de ${registro.generadoPor} (${registro.totalFolios} folios) descargada.`
}

/** Docenas de una captura congelada: el snapshot guarda 'docenas' y, para
 *  algunos esquemas de Excel, solo 'total'. Compartido para que Reportes e
 *  Indicadores cuenten igual. */
export function docenasDeCaptura(captura) {
  const d = typeof captura.producto?.docenas === 'number' ? captura.producto.docenas : captura.producto?.total
  return typeof d === 'number' ? d : 0
}
