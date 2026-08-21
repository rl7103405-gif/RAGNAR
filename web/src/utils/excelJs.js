// CARGA DE EXCELJS, con un error que dice la verdad.
//
// ExcelJS pesa ~1 MB, asi que viaja en su propio archivo y se descarga la
// primera vez que alguien lee o genera un Excel. Ese trozo lleva un codigo en
// el nombre que CAMBIA con cada despliegue de la app.
//
// ⚠️ EL PROBLEMA QUE ESTO ARREGLA (2026-08-21). Lindbergh dejo la pestaña
// abierta desde antes de un despliegue. Al subir su Excel, el navegador pidio
// el trozo con el nombre viejo, que ya no existe — y Firebase Hosting NO
// contesta "no existe": contesta la pagina de inicio con un OK (verificado:
// el nombre viejo devuelve text/html en vez de text/javascript). El navegador
// recibe una pagina web donde esperaba la libreria, no la puede ejecutar, y el
// import falla.
//
// Como ese fallo caia en el mismo catch que "el archivo esta corrupto", la app
// le dijo "debe ser un .xlsx sin contraseña" — y se puso a revisar su archivo,
// que estaba PERFECTO (comprobado despues: sus 18 tareas se leen sin un
// problema). Una hora perdida por un mensaje que culpaba al dato equivocado.
//
// La regla: un error de INFRAESTRUCTURA no se puede reportar como un error del
// DATO del usuario. Son cosas distintas y llevan a acciones distintas —
// recargar la pagina contra arreglar el archivo.

/** Se lanza cuando no se pudo traer la libreria (no cuando el archivo esta mal). */
export class ErrorLibreriaExcel extends Error {
  constructor() {
    super(
      'La app se actualizo mientras tenias esta pagina abierta, y no se pudo cargar el ' +
        'lector de Excel. TU ARCHIVO ESTA BIEN: solo recarga la pagina (Ctrl + F5) y vuelve ' +
        'a subirlo.'
    )
    this.name = 'ErrorLibreriaExcel'
    this.esFalloDeCarga = true
  }
}

/**
 * Devuelve el constructor Workbook de ExcelJS.
 *
 * En Vite llega como export con nombre; en Node (los scripts de prueba) viene
 * dentro de default. Se aceptan los dos.
 */
export async function cargarWorkbook() {
  let mod
  try {
    mod = await import('exceljs')
  } catch (err) {
    console.error('[ExcelJS] No se pudo descargar la libreria:', err)
    throw new ErrorLibreriaExcel()
  }
  const Workbook = mod.Workbook || mod.default?.Workbook
  if (typeof Workbook !== 'function') {
    // El import "funciono" pero no trajo lo que debia: es exactamente lo que
    // pasa cuando el servidor devuelve la pagina de inicio en vez del archivo.
    console.error('[ExcelJS] El modulo llego sin Workbook:', mod)
    throw new ErrorLibreriaExcel()
  }
  return Workbook
}

/** Un libro de ExcelJS ya abierto a partir de un ArrayBuffer. */
export async function abrirLibro(buffer) {
  const Workbook = await cargarWorkbook()
  const libro = new Workbook()
  await libro.xlsx.load(buffer)
  return libro
}
