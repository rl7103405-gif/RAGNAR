// CONVIERTE UN TECH PACK DE LA PLANTILLA TP-QUINI v1 A v2, EN SU LUGAR.
//
// Roberto, 2026-09-15: la v2 es "el tech pack puro, sin OT": sin orden de
// compra, sin OT y sin cantidades del pedido; en avios, sin la columna ENVIAR.
// Lo que el v1 traia (OC, packs, OT y docenas por codigo) NO se tira: queda
// oculto en la hoja _RAGNAR, clave 'pedidoAnterior' ("que no se vea, chance
// nos sirve").
//
// Se convierte sobre el MISMO libro (limpiar celdas y nombres), no se
// regenera desde datos: regenerar perderia el acomodo de las fotos que se
// conservo en la migracion del 11-sep. Los 120 de la biblioteca salieron del
// generador de RAGNAR, asi que ExcelJS los reescribe sin perdida.
//
// Funcion pura sobre un Workbook de ExcelJS ya abierto (sirve en Node y en el
// navegador). Quien la llame guarda el libro con writeBuffer.
import { CLAVES_RAGNAR, HOJAS, ORDEN_HOJAS, PEDIDO_V1, PLANTILLA, TABLAS, manifiesto, rangoAIndices, textoPedidoAnterior } from './plantillaTechPack.js'
import { leerPedidoV1, leerPlantilla } from './leerPlantillaTechPack.js'
import { valorPlano } from './aviosTechPack.js'

const MAX_TEXTO = 32000
const NOTA_AVIOS = 'USA POR PACK es un numero'
const NOTA_ENVIAR = ' La cantidad a enviar la calcula RAGNAR con los packs de cada tarea.'

const colLetra = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

/** "'3 AVIOS'!$A$6:$J$26" -> { hoja, c1, f1, c2, f2 } (base 1) */
function parsearRango(ref) {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref || '').trim())
  if (!m) return null
  const r = rangoAIndices(`${m[3]}${m[4]}:${m[5] || m[3]}${m[6] || m[4]}`)
  return r ? { hoja: (m[1] ?? m[2]).replace(/''/g, "'"), ...r } : null
}

const nombresDelLibro = (libro) => Object.fromEntries((libro.definedNames.model || []).filter((d) => d?.ranges?.[0]).map((d) => [d.name, d.ranges[0]]))

/** Quita un nombre definido completo (todas sus celdas, en todos sus rangos). */
function quitarNombre(libro, nombre) {
  const def = (libro.definedNames.model || []).find((d) => d.name === nombre)
  if (!def) return false
  for (const ref of def.ranges || []) {
    const r = parsearRango(ref)
    if (!r) continue
    const hoja = `'${r.hoja.replace(/'/g, "''")}'`
    for (let f = r.f1; f <= r.f2; f++) {
      for (let c = r.c1; c <= r.c2; c++) libro.definedNames.remove(`${hoja}!$${colLetra(c)}$${f}`, nombre)
    }
  }
  return true
}

/** Sin validacion de datos en esa celda (ExcelJS la guarda por direccion). */
function quitarValidacion(hoja, direccion) {
  const modelo = hoja.dataValidations?.model
  if (modelo && direccion in modelo) delete modelo[direccion]
}

const vaciar = (hoja, direccion) => { hoja.getCell(direccion).value = null }

/**
 * @param {import('exceljs').Workbook} libro  libro v1 ya abierto (se modifica)
 * @returns {{ yaEraV2: boolean, pedidoAnterior: object|null, cambios: string[] }}
 */
export function convertirLibroAV2(libro) {
  const antes = leerPlantilla(libro)
  if (antes.version >= 2) return { yaEraV2: true, pedidoAnterior: antes.pedidoAnterior ?? null, cambios: [] }

  const cambios = []
  const nombres = nombresDelLibro(libro)
  const h1 = libro.getWorksheet(HOJAS.pedido)
  const h3 = libro.getWorksheet(HOJAS.avios)
  const hr = libro.getWorksheet(HOJAS.ragnar)
  if (!h1 || !h3 || !hr) throw new Error('el libro no trae las hojas 1 PEDIDO, 3 AVIOS y _RAGNAR: no se convierte')

  // a. Lo del pedido se lee ANTES de limpiar.
  const pedidoAnterior = leerPedidoV1(libro)
  cambios.push(pedidoAnterior
    ? `pedido v1 guardado: OC "${pedidoAnterior.oc}", packs ${pedidoAnterior.packs ?? '-'}, ${pedidoAnterior.renglones.filter((r) => r.ot || r.docenas != null).length} renglon(es) con OT o docenas`
    : 'el v1 no traia datos del pedido')

  // b. Hoja 1: orden de compra y cantidades del pedido fuera.
  for (const d of [...PEDIDO_V1.etiquetas.slice(0, 1), PEDIDO_V1.campos.TP_OC]) vaciar(h1, d)
  cambios.push('hoja 1: sin OC (F2 y G2)')
  for (const d of ['C7', 'D7', 'E7', 'F7', 'G7', 'H7']) {
    const celda = h1.getCell(d)
    celda.value = null
    quitarValidacion(h1, d)
    celda.style = {}
  }
  cambios.push('hoja 1: sin packs, pares ni docenas del pedido (C7:H7, con su formato y validacion)')

  const rPed = parsearRango(nombres.TP_TABLA_PEDIDO)
  if (rPed && rPed.f1 > 1) {
    h1.getCell(`A${rPed.f1 - 1}`).value = TABLAS.TP_TABLA_PEDIDO.titulo
    const { ot, docenas } = PEDIDO_V1.columnasPedido
    for (let f = rPed.f1; f <= rPed.f2; f++) {
      for (const col of [ot, docenas]) {
        vaciar(h1, `${col}${f}`)
        quitarValidacion(h1, `${col}${f}`)
      }
    }
    cambios.push(`hoja 1: titulo de la tabla v2 y columnas OT (${ot}) y DOCENAS (${docenas}) vacias en filas ${rPed.f1}-${rPed.f2}`)
  } else {
    cambios.push('hoja 1: no se encontro el rango TP_TABLA_PEDIDO (tabla sin tocar)')
  }

  // c. Banda de las hojas 2 a 6: la OC (F2 etiqueta, G2 formula a la hoja 1).
  for (const k of ORDEN_HOJAS.slice(1, 6)) {
    const h = libro.getWorksheet(HOJAS[k])
    if (!h) continue
    vaciar(h, 'F2')
    vaciar(h, 'G2')
  }
  cambios.push('hojas 2 a 6: sin OC en la banda (F2 y G2)')

  // d. Hoja 3: sin la columna ENVIAR.
  const rAv = parsearRango(nombres.TP_TABLA_AVIOS)
  if (rAv && rAv.f1 > 1) {
    h3.getCell(`A${rAv.f1 - 1}`).value = TABLAS.TP_TABLA_AVIOS.titulo
    const col = PEDIDO_V1.columnaEnviar
    for (let f = rAv.f1; f <= rAv.f2; f++) {
      vaciar(h3, `${col}${f}`)
      quitarValidacion(h3, `${col}${f}`)
    }
    cambios.push(`hoja 3: titulo v2 y columna ENVIAR (${col}) vacia en filas ${rAv.f1}-${rAv.f2}`)
  } else {
    cambios.push('hoja 3: no se encontro el rango TP_TABLA_AVIOS (tabla sin tocar)')
  }
  let notaHecha = false
  h3.eachRow({ includeEmpty: false }, (fila) => {
    if (notaHecha) return
    fila.eachCell({ includeEmpty: false }, (celda) => {
      if (notaHecha) return
      // En una celda combinada solo se escribe la principal.
      if (celda.isMerged && celda.master && celda.master.address !== celda.address) return
      const texto = valorPlano(celda.value)
      if (typeof texto !== 'string' || !texto.trim().startsWith(NOTA_AVIOS)) return
      notaHecha = true
      if (texto.includes(NOTA_ENVIAR.trim())) { cambios.push('hoja 3: la nota ya decia que RAGNAR calcula lo que se envia'); return }
      celda.value = texto.replace(/\s+$/, '') + NOTA_ENVIAR
      cambios.push(`hoja 3: nota ${celda.address} con "la cantidad a enviar la calcula RAGNAR"`)
    })
  })
  if (!notaHecha) cambios.push('hoja 3: no se encontro la nota de USA POR PACK')

  // e. La marca de la plantilla.
  h1.getCell('J1').value = PLANTILLA.marca
  for (const k of ORDEN_HOJAS.slice(1, 6)) {
    const h = libro.getWorksheet(HOJAS[k])
    if (!h) continue
    const celda = h.getCell('J1')
    const v = celda.value
    if (v && typeof v === 'object' && 'formula' in v) celda.value = { formula: v.formula, result: PLANTILLA.marca }
    else if (v && typeof v === 'object' && 'sharedFormula' in v) celda.value = { sharedFormula: v.sharedFormula, result: PLANTILLA.marca }
  }
  cambios.push(`marca ${PLANTILLA.marca} en J1 (hoja 1 y resultado de las formulas de las hojas 2 a 6)`)

  // f. Nombres del pedido que la v2 ya no tiene.
  const quitados = Object.keys(PEDIDO_V1.campos).filter((n) => quitarNombre(libro, n))
  cambios.push(`nombres quitados: ${quitados.join(', ') || 'ninguno'}`)

  // g. _RAGNAR: version, pedidoAnterior, manifiesto y rango TP_RAGNAR.
  const filaDe = (clave) => {
    for (let f = 1; f <= Math.max(hr.rowCount, CLAVES_RAGNAR.length); f++) {
      if (String(valorPlano(hr.getCell(`A${f}`).value) ?? '') === clave) return f
    }
    return null
  }
  const filaVersion = filaDe('version') || 2
  hr.getCell(`A${filaVersion}`).value = 'version'
  hr.getCell(`B${filaVersion}`).value = PLANTILLA.version

  const filaPedido = CLAVES_RAGNAR.indexOf('pedidoAnterior') + 1
  const claveOcupada = String(valorPlano(hr.getCell(`A${filaPedido}`).value) ?? '')
  if (claveOcupada && claveOcupada !== 'pedidoAnterior') {
    throw new Error(`_RAGNAR fila ${filaPedido} ya trae la clave "${claveOcupada}": no se pisa`)
  }
  // Un JSON cortado a la mitad no se puede leer: se quitan renglones enteros
  // (la misma funcion que usa el generador).
  const { texto: textoPedido, recortadoA } = textoPedidoAnterior(pedidoAnterior, MAX_TEXTO)
  if (recortadoA != null) cambios.push(`_RAGNAR: pedidoAnterior recortado a ${recortadoA} renglones (pasaba de ${MAX_TEXTO} caracteres)`)
  hr.getCell(`A${filaPedido}`).value = 'pedidoAnterior'
  hr.getCell(`B${filaPedido}`).value = textoPedido

  // TP_RAGNAR se quita antes de sacar los nombres del manifiesto (asi lo arma
  // el generador) y se vuelve a poner con el alto de CLAVES_RAGNAR.
  quitarNombre(libro, 'TP_RAGNAR')
  const filaManifiesto = filaDe('manifiesto')
  if (filaManifiesto) {
    hr.getCell(`B${filaManifiesto}`).value = JSON.stringify({ ...manifiesto(), nombres: nombresDelLibro(libro) })
  }
  libro.definedNames.add(`'${HOJAS.ragnar}'!$A$1:$B$${CLAVES_RAGNAR.length}`, 'TP_RAGNAR')
  cambios.push(`_RAGNAR: version ${PLANTILLA.version}, pedidoAnterior en fila ${filaPedido}, manifiesto v2${filaManifiesto ? '' : ' (no habia clave manifiesto: no se escribio)'}, TP_RAGNAR = A1:B${CLAVES_RAGNAR.length}`)

  return { yaEraV2: false, pedidoAnterior, cambios }
}
