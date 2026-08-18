/**
 * Lo comun a los scripts que tocan RAGNAR-CUENTAS.xlsx.
 *
 * Vive aparte porque son tres los que escriben ese archivo (crear usuario,
 * resetear contrasena, regenerar el inventario) y si cada uno lleva su copia
 * de la escritura atomica, tarde o temprano uno se queda sin ella y se lleva
 * las contrasenas de toda la fabrica.
 */
import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'

export const DOMINIO = 'quini-ragnar.local'
export const RUTA_EXCEL = fileURLToPath(new URL('../../../RAGNAR-CUENTAS.xlsx', import.meta.url))

/**
 * Temporal propio de esta corrida.
 *
 * Lleva el pid en el nombre porque si dos scripts compartieran el mismo
 * temporal se pisarian: uno borraria el del otro a medio vuelo y la
 * contrasena del que pierda el rename se perderia en silencio. Termina en
 * .xlsx a proposito, para que el .gitignore (*.xlsx) tambien lo cubra si un
 * corte lo deja tirado con contrasenas dentro.
 */
function rutaTemporal() {
  return fileURLToPath(new URL(`../../../RAGNAR-CUENTAS.${process.pid}.tmp.xlsx`, import.meta.url))
}

/** Lo que se escribe donde no hay contrasena conocida. */
export const PENDIENTE = 'PENDIENTE: escribela aqui'

/** Que alcanza a ver cada rol. Es lo que hace util al Excel para quien lo lea. */
export const QUE_VE = {
  admin: 'Todo + autoriza correcciones de folios y remisiones',
  completo: 'Embarques: Excel del dia, remisiones, tareas, reportes, historial',
  consulta: 'Solo lectura: Historial, Reportes, Indicadores, Registros',
  almacen: 'Avios: pedidos de material, envios, inventario y catalogo',
  captura: 'Solo Captura: leer folio y pesar',
  produccion: 'Sube el plan maestro (que OT cuelgan de cada orden de compra)',
  maquila: 'Solo su portal: lo que recibe, su material y su inventario'
}

/** Los roles internos que puede tener alguien de Quini. */
export const ROLES_INTERNOS = ['admin', 'completo', 'consulta', 'almacen', 'captura', 'produccion']

// Alfabeto sin caracteres que se confunden al dictar por telefono o teclear
// a mano: nada de l/I/1, O/0, 5/S.
const LETRAS = 'abcdefghijkmnpqrstuvwxyz'
const MAYUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const NUMS = '23456789'

/** Contrasena de 14 caracteres, aleatoria de verdad (crypto), legible. */
export function generarPassword() {
  const todo = LETRAS + MAYUS + NUMS
  // Al menos una de cada tipo, para que cumpla cualquier politica.
  const base = [MAYUS[randomInt(MAYUS.length)], NUMS[randomInt(NUMS.length)], LETRAS[randomInt(LETRAS.length)]]
  while (base.length < 14) base.push(todo[randomInt(todo.length)])
  // Fisher-Yates con crypto: que no quede el patron fijo al inicio.
  for (let i = base.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[base[i], base[j]] = [base[j], base[i]]
  }
  return base.join('')
}

/** exceljs exporta Workbook como nombrado en Vite y bajo default en Node. */
export async function cargarExcelJs() {
  const mod = await import('exceljs')
  return mod.Workbook || mod.default?.Workbook
}

/** Abre el Excel de cuentas. Devuelve null si todavia no existe. */
export async function abrirLibro() {
  if (!existsSync(RUTA_EXCEL)) return null
  const Workbook = await cargarExcelJs()
  const libro = new Workbook()
  await libro.xlsx.readFile(RUTA_EXCEL)
  return libro
}

/**
 * Donde estan las columnas de usuario y contrasena en una hoja.
 *
 * Se buscan por encabezado y no por indice fijo: no coinciden entre la hoja
 * del personal y la de maquilas. Devuelve null si la hoja no es de cuentas.
 */
export function encabezadosDe(hoja) {
  // Array.from y no .map: values trae un hueco en el indice 0 y map lo
  // respeta como hueco, no como undefined. El trim es por si alguien tecleo
  // un espacio de mas en el encabezado: sin el, dejaria de escribir esa
  // columna en silencio.
  return Array.from(hoja.getRow(1).values || [], (v) => String(v ?? '').trim().toLowerCase())
}

export function columnasDe(hoja) {
  const encabezados = encabezadosDe(hoja)
  const usuario = encabezados.findIndex((h) => h === 'usuario')
  const pass = encabezados.findIndex((h) => h.startsWith('contrase'))
  return usuario < 0 || pass < 0 ? null : { usuario, pass }
}

/**
 * Escribe valores en una fila mapeando por ENCABEZADO, no por posicion, para
 * que siga funcionando si algun dia se reordenan o se agregan columnas.
 * Las llaves de `valores` se comparan en minusculas contra los encabezados.
 */
/** Devuelve cuantos valores encontraron su columna y se escribieron. */
function escribirEnFila(hoja, fila, valores) {
  const encabezados = encabezadosDe(hoja)
  let escritos = 0
  for (const [llave, valor] of Object.entries(valores)) {
    const col = encabezados.findIndex((h) => h === llave.trim().toLowerCase())
    if (col <= 0) continue
    const celda = fila.getCell(col)
    celda.value = valor
    celda.font = { color: { argb: 'FF000000' }, bold: false }
    escritos += 1
  }
  return escritos
}

/**
 * Deja a ese usuario en el Excel con los valores dados.
 *
 * Si ya tiene fila la actualiza, y si no la agrega en `hojaDestino`. Refresca
 * TODOS los valores que se le pasen, no solo la contrasena: una fila puede
 * haber quedado de alguien que se dio de baja, y si solo se pisara la
 * contrasena el Excel seguiria diciendo que ese acceso es de la persona
 * anterior. Devuelve 'actualizada', 'agregada' o null si no pudo.
 *
 * Cuando se pasa `hojaDestino`, la busqueda se limita a esa hoja: los ids de
 * maquila y los usuarios del personal viven en hojas distintas y podrian
 * coincidir en texto, y buscar en todas dejaria escribir la contrasena de una
 * maquila encima de la fila de un empleado.
 */
export function ponerEnExcel(libro, usuario, valores, hojaDestino) {
  const hojas = hojaDestino
    ? [libro.getWorksheet(hojaDestino)].filter(Boolean)
    : libro.worksheets

  for (const hoja of hojas) {
    const col = columnasDe(hoja)
    if (!col) continue
    let fila = null
    hoja.eachRow((f, n) => {
      if (n === 1 || fila) return
      if (String(f.getCell(col.usuario).value || '').trim() === usuario) fila = f
    })
    if (fila) {
      escribirEnFila(hoja, fila, valores)
      return 'actualizada'
    }
  }

  if (!hojaDestino) return null
  const hoja = libro.getWorksheet(hojaDestino)
  if (!hoja) return null

  // Si la hoja existe pero sus encabezados no son los esperados, la fila
  // quedaria vacia: eso NO es haberla anotado, y decir que si dejaria la
  // contrasena perdida creyendo que quedo guardada.
  const fila = hoja.addRow([])
  const escritos = escribirEnFila(hoja, fila, { Usuario: usuario, ...valores })
  if (escritos === 0) {
    hoja.spliceRows(fila.number, 1)
    return null
  }
  return 'agregada'
}

/**
 * Guarda el libro sin poner en riesgo el archivo bueno.
 *
 * exceljs.writeFile trunca el destino a 0 bytes en cuanto abre el stream,
 * ANTES de escribir nada: si el proceso se corta a media escritura, el Excel
 * de contrasenas de toda la fabrica se pierde. Por eso se escribe a un
 * temporal y solo al terminar se sustituye, que es atomico en el mismo disco.
 */
export async function guardarLibro(libro) {
  const tmp = rutaTemporal()
  try {
    await libro.xlsx.writeFile(tmp)
    renameSync(tmp, RUTA_EXCEL)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      // No habia temporal que limpiar: da igual.
    }
    throw err
  }
}

/** Traduce a algo que un operador entienda por que no se pudo escribir. */
export function explicarFalloDeEscritura(err) {
  if (err.code === 'EBUSY' || err.code === 'EPERM') {
    return 'lo tienes abierto en Excel: cierralo y vuelve a correr esto (el archivo anterior quedo intacto)'
  }
  return err.message
}
