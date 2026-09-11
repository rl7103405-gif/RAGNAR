// GENERA UN TECH PACK NUEVO EN LA PLANTILLA TP-QUINI v1, PRELLENADO.
//
// Fase F2 del plan (docs/plan-plantilla-tech-pack-v1.md). Arma un Excel NUEVO
// con ExcelJS a partir de lo que el plan ya sabe de una OT (cliente, OC, OT,
// codigos, docenas, pares por pack). Lety lo completa en Excel y lo sube;
// ese archivo terminado NUNCA se reescribe aqui (ExcelJS pierde formas y
// flechas). La forma sale toda de plantillaTechPack.js.
//
// Funciona en el navegador (PanelTechPacks) y en Node (scripts de prueba):
// recibe la clase Workbook ya cargada para no amarrarse a un import.
import {
  BANDA,
  CAMPOS,
  CLAVES_RAGNAR,
  HOJAS,
  LISTAS,
  ORDEN_HOJAS,
  PLANTILLA,
  TABLAS,
  TITULOS,
  ZONAS_FOTO,
  manifiesto,
  rangoAIndices,
  referencia
} from './plantillaTechPack.js'

const AZUL = 'FF13263D'
const AZUL_TEXTO = 'FFF2F6FA'
const AZUL_ETQ = 'FFAFC0D2'
const GRIS_ETQ = 'FF56616E'
const FONDO_ETQ = 'FFEEF2F6'
const CAB_TABLA = 'FFE6EDFD'
const CAB_TABLA_TEXTO = 'FF1F4FD1'
const ZONA_FOTO = 'FFE4F0E7'
const ZONA_FOTO_BORDE = 'FF6E9E7B'
const ZONA_LOGO = 'FFF1ECE2'

const relleno = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const borde = (argb = 'FFD3DBE3') => ({ top: { style: 'thin', color: { argb } }, left: { style: 'thin', color: { argb } }, bottom: { style: 'thin', color: { argb } }, right: { style: 'thin', color: { argb } } })
const letra = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }
const colNum = (s) => [...s].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0)

/** Ancho y alto en pixeles de un PNG/JPEG/GIF (null si no se reconoce). */
export function medidasDeImagen(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] }
  if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
  }
  return null
}

const PX_COL = (w) => Math.round((w || 8.43) * 7 + 5)
const PX_FILA = (h) => Math.round((h || 15) * 96 / 72)

const imagenesValidas = (imagenes) => (imagenes || []).filter((im) => im && im.bytes && ['png', 'jpeg', 'jpg', 'gif'].includes(String(im.extension).toLowerCase()))

/** Cuando TODAS traen su caja de la hoja original, se respeta el acomodo:
 *  cada hoja de origen es un grupo; se escala a lo ancho y se apilan. */
function planDeComposicion(imagenes, anchoZona) {
  const lista = imagenesValidas(imagenes)
  if (!lista.length || !lista.every((im) => im.caja)) return null
  const grupos = []
  for (const im of lista) {
    let g = grupos.find((x) => x.nombre === im.grupo)
    if (!g) { g = { nombre: im.grupo, items: [] }; grupos.push(g) }
    g.items.push(im)
  }
  const colocadas = []
  let y = 12
  for (const g of grupos) {
    const minX = Math.min(...g.items.map((i) => i.caja.x))
    const minY = Math.min(...g.items.map((i) => i.caja.y))
    const maxX = Math.max(...g.items.map((i) => i.caja.x + i.caja.w))
    const maxY = Math.max(...g.items.map((i) => i.caja.y + i.caja.h))
    const esc = Math.min((anchoZona - 24) / (maxX - minX), 1)
    const offX = (anchoZona - (maxX - minX) * esc) / 2
    for (const im of g.items) {
      colocadas.push({ im, x: offX + (im.caja.x - minX) * esc, y: y + (im.caja.y - minY) * esc, w: im.caja.w * esc, h: im.caja.h * esc })
    }
    y += (maxY - minY) * esc + 28
  }
  return { colocadas, alto: y }
}

/** Coloca imagenes DENTRO de un rango, sin deformarlas: respetando el
 *  acomodo original si lo traen, o en cuadricula si no.
 *  imagenes: [{ bytes, extension, caja?, grupo? }]. Devuelve cuantas coloco. */
function colocarImagenes(libro, hoja, r, imagenes) {
  const lista = imagenesValidas(imagenes)
  if (!lista.length) return 0
  const cols = lista.length === 1 ? 1 : 2
  const filasGrid = Math.ceil(lista.length / cols)
  const anchosCol = []
  for (let c = r.c1; c <= r.c2; c++) anchosCol.push(PX_COL(hoja.getColumn(c).width))
  const altosFila = []
  for (let f = r.f1; f <= r.f2; f++) altosFila.push(PX_FILA(hoja.getRow(f).height))
  const anchoTotal = anchosCol.reduce((a, x) => a + x, 0)
  const altoTotal = altosFila.reduce((a, x) => a + x, 0)
  // pixel -> coordenada fraccionaria de celda (base 0) dentro del rango
  const aCol = (px) => { let acc = 0; for (let i = 0; i < anchosCol.length; i++) { if (acc + anchosCol[i] >= px) return r.c1 - 1 + i + (px - acc) / anchosCol[i]; acc += anchosCol[i] } return r.c2 }
  const aFila = (px) => { let acc = 0; for (let i = 0; i < altosFila.length; i++) { if (acc + altosFila[i] >= px) return r.f1 - 1 + i + (px - acc) / altosFila[i]; acc += altosFila[i] } return r.f2 }
  const plan = planDeComposicion(lista, anchoTotal)
  if (plan) {
    for (const c of plan.colocadas) {
      const ext = String(c.im.extension).toLowerCase() === 'jpg' ? 'jpeg' : String(c.im.extension).toLowerCase()
      const id = libro.addImage({ buffer: c.im.bytes, extension: ext })
      hoja.addImage(id, { tl: { col: aCol(c.x), row: aFila(c.y) }, br: { col: aCol(c.x + c.w), row: aFila(Math.min(c.y + c.h, altoTotal)) }, editAs: 'oneCell' })
    }
    return plan.colocadas.length
  }
  const pad = 8
  const celdaW = anchoTotal / cols
  const celdaH = altoTotal / filasGrid
  lista.forEach((im, i) => {
    const ext = String(im.extension).toLowerCase() === 'jpg' ? 'jpeg' : String(im.extension).toLowerCase()
    const id = libro.addImage({ buffer: im.bytes, extension: ext })
    const med = im.caja ? { w: im.caja.w, h: im.caja.h } : medidasDeImagen(im.bytes) || { w: 4, h: 3 }
    const maxW = celdaW - pad * 2
    const maxH = celdaH - pad * 2
    const escala = Math.min(maxW / med.w, maxH / med.h)
    const w = med.w * escala
    const h = med.h * escala
    const x0 = (i % cols) * celdaW + (celdaW - w) / 2
    const y0 = Math.floor(i / cols) * celdaH + (celdaH - h) / 2
    hoja.addImage(id, { tl: { col: aCol(x0), row: aFila(y0) }, br: { col: aCol(x0 + w), row: aFila(y0 + h) }, editAs: 'oneCell' })
  })
  return lista.length
}

/** Pinta una celda de etiqueta (gris chico, mayusculas). */
function etiqueta(hoja, celda, texto, oscura = false) {
  const c = hoja.getCell(celda)
  c.value = texto
  c.font = { name: 'Arial', size: 8, bold: true, color: { argb: oscura ? AZUL_ETQ : GRIS_ETQ } }
  c.alignment = { vertical: 'middle', horizontal: 'left' }
  if (!oscura) c.fill = relleno(FONDO_ETQ)
  return c
}

/** La banda de las filas 1-3, igual en todas las hojas. En la hoja 1 los
 *  datos son celdas de captura; en las demas, formulas hacia la hoja 1. */
function banda(hoja, clave, libro, logoId) {
  const esPedido = clave === 'pedido'
  for (let f = 1; f <= BANDA.filas; f++) {
    hoja.getRow(f).height = 22
    for (let c = 1; c <= BANDA.columnas; c++) {
      const celda = hoja.getCell(f, c)
      celda.fill = relleno(AZUL)
      celda.font = { name: 'Arial', size: 10, bold: true, color: { argb: AZUL_TEXTO } }
      celda.alignment = { vertical: 'middle' }
    }
  }
  // Logo: A1:B3, zona reservada. No cuenta como foto.
  hoja.mergeCells(BANDA.logo)
  const zl = hoja.getCell('A1')
  zl.fill = relleno(ZONA_LOGO)
  zl.value = logoId == null ? 'LOGO' : ''
  zl.font = { name: 'Arial', size: 8, color: { argb: GRIS_ETQ } }
  zl.alignment = { vertical: 'middle', horizontal: 'center' }
  // Ancla de DOS celdas (tl/br): asi el validador puede medir donde queda.
  if (logoId != null) hoja.addImage(logoId, { tl: { col: 0.12, row: 0.12 }, br: { col: 1.9, row: 2.9 }, editAs: 'oneCell' })

  hoja.mergeCells('C1:I1')
  hoja.getCell('C1').value = TITULOS[clave]
  hoja.getCell('C1').font = { name: 'Arial', size: 12, bold: true, color: { argb: AZUL_TEXTO } }
  // La marca de plantilla vive en J1 (nombre TP_PLANTILLA en la hoja 1).
  const marca = hoja.getCell('J1')
  marca.value = esPedido ? PLANTILLA.marca : { formula: referencia('pedido', 'J1'), result: PLANTILLA.marca }
  marca.font = { name: 'Arial', size: 8, color: { argb: AZUL_ETQ } }
  marca.alignment = { horizontal: 'right', vertical: 'middle' }

  const filas = [
    // A la derecha del logo (A1:B3): etiqueta en C/F/I, dato en D:E, G:H, J.
    [2, [['C', 'MODELO', 'TP_MODELO', 'D:E'], ['F', 'OC', 'TP_OC', 'G:H'], ['I', 'FECHA', 'TP_FECHA', 'J:J']]],
    [3, [['C', 'CLIENTE', 'TP_CLIENTE', 'D:E'], ['F', 'MARCA', 'TP_MARCA', 'G:H'], ['I', 'ELABORO', 'TP_ELABORO', 'J:J']]]
  ]
  for (const [f, grupos] of filas) {
    for (const [colEtq, texto, nombre, span] of grupos) {
      etiqueta(hoja, `${colEtq}${f}`, texto, true)
      const [c1, c2] = span.split(':')
      if (c1 !== c2) hoja.mergeCells(`${c1}${f}:${c2}${f}`)
      const celda = hoja.getCell(`${c1}${f}`)
      celda.font = { name: 'Arial', size: 10, bold: true, color: { argb: AZUL_TEXTO } }
      if (!esPedido) celda.value = { formula: referencia('pedido', CAMPOS[nombre].celda), result: '' }
      if (nombre === 'TP_FECHA') celda.numFmt = 'dd/mm/yyyy'
    }
  }
}

/** Encabezado y cuerpo vacio de una tabla; devuelve la primera fila de datos. */
function tabla(hoja, nombre, libro, renglonesNecesarios = 0, desplazar = 0) {
  // desplazar: filas que la tabla baja porque otra de arriba crecio.
  const t = { ...TABLAS[nombre], filaTitulo: TABLAS[nombre].filaTitulo + desplazar, filaCab: TABLAS[nombre].filaCab + desplazar }
  const ancho = t.columnas.reduce((a, c) => Math.max(a, colNum(c.col) + (c.span || 1) - 1), 1)
  hoja.mergeCells(`A${t.filaTitulo}:${letra(ancho)}${t.filaTitulo}`)
  const tit = hoja.getCell(`A${t.filaTitulo}`)
  tit.value = t.titulo
  tit.font = { name: 'Arial', size: 9, bold: true, color: { argb: AZUL } }
  hoja.getRow(t.filaCab).height = 20
  for (const c of t.columnas) {
    const n = colNum(c.col)
    if ((c.span || 1) > 1) hoja.mergeCells(t.filaCab, n, t.filaCab, n + c.span - 1)
    const celda = hoja.getCell(t.filaCab, n)
    celda.value = c.etiqueta
    celda.fill = relleno(CAB_TABLA)
    celda.font = { name: 'Arial', size: 8, bold: true, color: { argb: CAB_TABLA_TEXTO } }
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    celda.border = borde()
    if (!t.horizontal) hoja.getColumn(n).width = Math.max(hoja.getColumn(n).width || 0, c.ancho)
  }
  // La tabla crece si la OT trae mas codigos que las filas reservadas: nunca
  // se recorta un pedido en silencio.
  const filas = t.horizontal ? 1 : Math.max(t.filasReservadas, renglonesNecesarios)
  for (let f = t.filaCab + 1; f <= t.filaCab + filas; f++) {
    for (const c of t.columnas) {
      const n = colNum(c.col)
      if ((c.span || 1) > 1) hoja.mergeCells(f, n, f, n + c.span - 1)
      const celda = hoja.getCell(f, n)
      celda.border = borde()
      celda.font = { name: 'Arial', size: 9 }
      if (c.tipo === 'lista') {
        celda.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${LISTAS[c.lista].join(',')}"`], showErrorMessage: true, errorTitle: 'Elige de la lista', error: 'Elige un valor de la lista (Lety la mantiene).' }
      } else if (c.tipo === 'decimal') {
        celda.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [c.min ?? 0], allowBlank: true, showErrorMessage: true, errorTitle: 'Solo numeros', error: 'Escribe un numero (0.1667 para "1 bolsa cada 6 packs").' }
      }
      if (c.tipo === 'imagen') hoja.getRow(f).height = 60
    }
  }
  libro.definedNames.add(`'${HOJAS[t.hoja]}'!$A$${t.filaCab}:$${letra(ancho)}$${t.filaCab + filas}`, nombre)
  return t.filaCab + 1
}

function zonaFoto(hoja, nombre, libro, desplazar = 0, fotos = null) {
  const z = ZONAS_FOTO[nombre]
  const r = rangoAIndices(z.rango)
  // Si la tabla de arriba crecio, la zona baja lo mismo (nunca se enciman).
  r.f1 += desplazar
  r.f2 += desplazar
  // Y si las fotos (con su acomodo original) no caben, la zona crece: las
  // zonas son lo ultimo de su hoja, abajo no hay nada que empujar.
  if (fotos && fotos.length) {
    let ancho = 0
    for (let col = r.c1; col <= r.c2; col++) ancho += PX_COL(hoja.getColumn(col).width)
    const plan = planDeComposicion(fotos, ancho)
    if (plan) {
      const filas = Math.ceil(plan.alto / PX_FILA(15)) + 1
      if (r.f1 + filas - 1 > r.f2) r.f2 = r.f1 + filas - 1
    }
  }
  hoja.mergeCells(r.f1, r.c1, r.f2, r.c2)
  const c = hoja.getCell(r.f1, r.c1)
  const puestas = fotos && fotos.length ? colocarImagenes(libro, hoja, r, fotos) : 0
  c.value = puestas ? '' : `${z.etiqueta}\nPega aqui la foto (y las flechas que hagan falta). Zona ${nombre}.`
  c.fill = relleno(ZONA_FOTO)
  c.font = { name: 'Arial', size: 9, color: { argb: GRIS_ETQ } }
  c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  if (puestas) c.fill = relleno('FFFFFFFF')
  c.border = { top: { style: 'dashed', color: { argb: ZONA_FOTO_BORDE } }, left: { style: 'dashed', color: { argb: ZONA_FOTO_BORDE } }, bottom: { style: 'dashed', color: { argb: ZONA_FOTO_BORDE } }, right: { style: 'dashed', color: { argb: ZONA_FOTO_BORDE } } }
  libro.definedNames.add(`'${HOJAS[z.hoja]}'!$${letra(r.c1)}$${r.f1}:$${letra(r.c2)}$${r.f2}`, nombre)
}

/** Un campo suelto con su etiqueta a la izquierda y su nombre definido. */
function campo(hoja, nombre, libro, valor) {
  const c = CAMPOS[nombre]
  const m = /^([A-Z]+)(\d+)$/.exec(c.celda)
  const col = colNum(m[1])
  const fila = Number(m[2])
  if (col > 1 && fila > BANDA.filas) etiqueta(hoja, `${letra(col - 1)}${fila}`, (c.etiquetaCorta || c.etiqueta).toUpperCase())
  const celda = hoja.getCell(c.celda)
  celda.font = { name: 'Arial', size: 10, bold: true }
  celda.border = borde()
  if (c.tipo === 'lista') {
    celda.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${LISTAS[c.lista].join(',')}"`], showErrorMessage: true, errorTitle: 'Elige de la lista', error: 'Elige un valor de la lista (Lety la mantiene).' }
  } else if (c.tipo === 'entero') {
    celda.dataValidation = { type: 'whole', operator: c.max ? 'between' : 'greaterThanOrEqual', formulae: c.max ? [c.min, c.max] : [c.min ?? 0], allowBlank: true, showErrorMessage: true, errorTitle: 'Solo numeros enteros', error: c.max ? `Entre ${c.min} y ${c.max}.` : `Un numero entero, ${c.min ?? 0} o mas.` }
  } else if (c.tipo === 'fecha') {
    celda.numFmt = 'dd/mm/yyyy'
  }
  if (valor !== undefined && valor !== null && valor !== '') celda.value = valor
  libro.definedNames.add(referencia(c.hoja, c.celda), nombre)
  return celda
}

/**
 * @param {object} p
 * @param {Function} p.Workbook   clase Workbook de ExcelJS ya cargada
 * @param {string}   [p.logoBase64]  PNG en base64 (sin prefijo data:)
 * @param {object}   p.datos      { ot, oc, cliente, marca, modelo, prenda, elaboro, paresPorPack,
 *                                  renglones: [{ talla, ot, codigo, claveMicrosip, descripcion, upc, docenas }],
 *                                  generadoPorUid, generadoPorNombre, ahora }
 */
export function generarPlantillaTechPack({ Workbook, logoBase64 = null, datos = {} }) {
  const libro = new Workbook()
  libro.creator = 'RAGNAR'
  libro.created = datos.ahora ? new Date(datos.ahora) : new Date()
  const logoId = logoBase64 ? libro.addImage({ base64: logoBase64, extension: 'png' }) : null

  const hojas = {}
  for (const clave of ORDEN_HOJAS) {
    const h = libro.addWorksheet(HOJAS[clave], {
      properties: { tabColor: { argb: clave === 'ragnar' ? 'FF999999' : AZUL } },
      // VERTICAL y a todo lo ancho (Roberto, 11-sep: "que se vea mas vertical,
      // que tome toda la pantalla"). Carta, ajustado a 1 pagina de ancho.
      pageSetup: {
        orientation: 'portrait', paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 }
      },
      views: [{ showGridLines: false, zoomScale: 100 }]
    })
    hojas[clave] = h
    if (clave === 'ragnar') continue
    for (let c = 1; c <= BANDA.columnas; c++) h.getColumn(c).width = 15.5
    h.getColumn(1).width = 17
    banda(h, clave, libro, logoId)
  }

  // ---------------------------------------------------------------- 1 PEDIDO
  const pedido = hojas.pedido
  libro.definedNames.add(referencia('pedido', CAMPOS.TP_PLANTILLA.celda), 'TP_PLANTILLA')
  const fecha = datos.fecha instanceof Date && !isNaN(datos.fecha) ? datos.fecha : datos.ahora ? new Date(datos.ahora) : new Date()
  for (const [nombre, valor] of [
    ['TP_MODELO', datos.modelo], ['TP_OC', datos.oc], ['TP_FECHA', fecha],
    ['TP_CLIENTE', datos.cliente], ['TP_MARCA', datos.marca], ['TP_ELABORO', datos.elaboro]
  ]) {
    const c = pedido.getCell(CAMPOS[nombre].celda)
    if (valor !== undefined && valor !== null && valor !== '') c.value = valor
    if (nombre === 'TP_FECHA') c.numFmt = 'dd/mm/yyyy'
    libro.definedNames.add(referencia('pedido', CAMPOS[nombre].celda), nombre)
  }
  pedido.getRow(5).height = 20
  campo(pedido, 'TP_PRENDA', libro, datos.prenda)
  campo(pedido, 'TP_TEJIDO', libro, datos.tejido)
  campo(pedido, 'TP_SISTEMA_TALLA', libro, datos.sistemaTalla)
  campo(pedido, 'TP_VARIANTE', libro, datos.variante)
  pedido.getRow(7).height = 20
  campo(pedido, 'TP_PACK', libro, datos.paresPorPack)
  const totalDocenas = (datos.renglones || []).reduce((a, r) => a + (Number(r.docenas) || 0), 0)
  // Solo se prellena si la cuenta es exacta: redondear inventaria pares.
  const paresTotales = totalDocenas * 12
  const packsPrellenados = Number.isFinite(Number(datos.packs)) && Number(datos.packs) > 0
    ? Number(datos.packs)
    : datos.paresPorPack && paresTotales && paresTotales % datos.paresPorPack === 0 ? paresTotales / datos.paresPorPack : undefined
  campo(pedido, 'TP_PACKS', libro, packsPrellenados)
  const pares = campo(pedido, 'TP_PARES', libro)
  pares.value = { formula: `IF(AND(ISNUMBER(${CAMPOS.TP_PACK.celda}),ISNUMBER(${CAMPOS.TP_PACKS.celda})),${CAMPOS.TP_PACK.celda}*${CAMPOS.TP_PACKS.celda},"")`, result: packsPrellenados && datos.paresPorPack ? packsPrellenados * datos.paresPorPack : '' }
  pares.fill = relleno(FONDO_ETQ)
  const docenas = campo(pedido, 'TP_DOCENAS', libro)
  docenas.value = { formula: `IF(ISNUMBER(${CAMPOS.TP_PARES.celda}),${CAMPOS.TP_PARES.celda}/12,"")`, result: packsPrellenados && datos.paresPorPack ? (packsPrellenados * datos.paresPorPack) / 12 : '' }
  docenas.fill = relleno(FONDO_ETQ)
  docenas.numFmt = 'General'

  const nRenglones = (datos.renglones || []).length
  const primera = tabla(pedido, 'TP_TABLA_PEDIDO', libro, nRenglones)
  const t = TABLAS.TP_TABLA_PEDIDO
  ;(datos.renglones || []).forEach((r, i) => {
    const f = primera + i
    for (const c of t.columnas) {
      const v = r[c.clave]
      if (v === undefined || v === null || v === '') continue
      pedido.getCell(`${c.col}${f}`).value = c.tipo === 'decimal' ? Number(v) : String(v)
    }
  })
  zonaFoto(pedido, 'FOTO_REFERENCIA', libro, Math.max(0, nRenglones - t.filasReservadas), datos.fotos?.FOTO_REFERENCIA)

  // --------------------------------------------------------- 2 CODIGOS Y RUTA
  const codigos = hojas.codigos
  const primeraCod = tabla(codigos, 'TP_TABLA_CODIGOS', libro, nRenglones)
  // Codigo y talla NO se capturan aqui: vienen por formula de la hoja 1 (una
  // sola fuente por dato). Lety llena colores, bordado e hilo.
  for (let i = 0; i < Math.max(TABLAS.TP_TABLA_CODIGOS.filasReservadas, nRenglones); i++) {
    const fp = primera + i
    const ref = (col) => `'${HOJAS.pedido}'!${col}${fp}`
    codigos.getCell(`A${primeraCod + i}`).value = { formula: `IF(${ref('C')}="","",${ref('C')})`, result: datos.renglones?.[i]?.codigo || '' }
    codigos.getCell(`B${primeraCod + i}`).value = { formula: `IF(${ref('A')}="","",${ref('A')})`, result: datos.renglones?.[i]?.talla || '' }
    codigos.getCell(`A${primeraCod + i}`).fill = relleno(FONDO_ETQ)
    codigos.getCell(`B${primeraCod + i}`).fill = relleno(FONDO_ETQ)
    const cr = datos.codigosRuta?.[i]
    if (cr) {
      if (cr.colorCuerpo) codigos.getCell(`C${primeraCod + i}`).value = String(cr.colorCuerpo)
      if (cr.bordado) codigos.getCell(`E${primeraCod + i}`).value = String(cr.bordado)
      if (cr.hilo) codigos.getCell(`G${primeraCod + i}`).value = String(cr.hilo)
    }
  }
  const extraCod = Math.max(0, nRenglones - TABLAS.TP_TABLA_CODIGOS.filasReservadas)
  const primeraRuta = tabla(codigos, 'TP_RUTA', libro, 0, extraCod)
  const rutaBase = Array.isArray(datos.ruta) && datos.ruta.length ? datos.ruta.slice(0, 7) : ['TEJIDO', 'CERRADO', 'VOLTEADO', 'HORMADO', 'PAREADO', 'HABILITADO', 'EMBALAJE']
  rutaBase.forEach((p, i) => { codigos.getCell(primeraRuta, i + 1).value = p })

  // ------------------------------------------------------------------ 3 AVIOS
  const avios = hojas.avios
  const listaAvios = Array.isArray(datos.avios) ? datos.avios : []
  const primeraAv = tabla(avios, 'TP_TABLA_AVIOS', libro, listaAvios.length)
  const ta = TABLAS.TP_TABLA_AVIOS
  const filasAv = Math.max(ta.filasReservadas, listaAvios.length)
  for (let i = 0; i < filasAv; i++) {
    const f = primeraAv + i
    avios.getCell(`F${f}`).value = { formula: `IF(AND(ISNUMBER(E${f}),ISNUMBER(${referencia('pedido', CAMPOS.TP_PACKS.celda)})),E${f}*${referencia('pedido', CAMPOS.TP_PACKS.celda)},"")`, result: '' }
    avios.getCell(`F${f}`).fill = relleno(FONDO_ETQ)
    avios.getCell(`F${f}`).numFmt = 'General'
    const a = listaAvios[i]
    if (a) {
      if (a.clave) avios.getCell(`A${f}`).value = String(a.clave)
      if (a.descripcion) avios.getCell(`B${f}`).value = String(a.descripcion)
      if (Number.isFinite(Number(a.usa)) && a.usa !== null && a.usa !== '') avios.getCell(`E${f}`).value = Number(a.usa)
      if (a.comoSeUsa) avios.getCell(`G${f}`).value = String(a.comoSeUsa)
      avios.getCell(`I${f}`).value = a.talla ? String(a.talla) : 'TODAS'
      if (a.imagen) colocarImagenes(libro, avios, { c1: 10, c2: 10, f1: f, f2: f }, [a.imagen])
    } else if (i === 0 && !listaAvios.length) {
      avios.getCell(`I${f}`).value = 'TODAS'
    }
  }
  const filaNota = TABLAS.TP_TABLA_AVIOS.filaCab + filasAv + 2
  avios.mergeCells(`A${filaNota}:J${filaNota + 2}`)
  avios.getCell(`A${filaNota}`).value = 'USA POR PACK es un numero: 1 = uno por pack; 3 = tres por pack; 0.1667 = una bolsa cada 6 packs (1/6). La clave tiene que existir en el catalogo de avios de RAGNAR.'
  avios.getCell(`A${filaNota}`).font = { name: 'Arial', size: 9, italic: true, color: { argb: GRIS_ETQ } }
  avios.getCell(`A${filaNota}`).alignment = { wrapText: true, vertical: 'top' }

  // --------------------------------------------- 4 INDIVIDUAL · 5 BOLSA · 6 CAJA
  const individual = hojas.individual
  individual.mergeCells('A5:J7')
  const ci = campo(individual, 'TP_INDIVIDUAL_TEXTO', libro)
  ci.value = datos.textos?.individual || ''
  ci.alignment = { wrapText: true, vertical: 'top' }
  ci.font = { name: 'Arial', size: 10 }
  individual.getCell('A4').value = 'COMO SE ARMA EL PAR (donde va cada plastiflecha, caballete, etiqueta):'
  individual.getCell('A4').font = { name: 'Arial', size: 9, bold: true, color: { argb: AZUL } }
  zonaFoto(individual, 'FOTO_INDIVIDUAL', libro, 0, datos.fotos?.FOTO_INDIVIDUAL)

  const bolsa = hojas.bolsa
  campo(bolsa, 'TP_PACKS_POR_BOLSA', libro, datos.packsPorBolsa)
  bolsa.mergeCells('A7:J9')
  const cb = campo(bolsa, 'TP_BOLSA_TEXTO', libro)
  cb.value = datos.textos?.bolsa || ''
  cb.alignment = { wrapText: true, vertical: 'top' }
  bolsa.getCell('A6').value = 'COMO SE ACOMODAN LOS PACKS EN LA BOLSA:'
  bolsa.getCell('A6').font = { name: 'Arial', size: 9, bold: true, color: { argb: AZUL } }
  zonaFoto(bolsa, 'FOTO_BOLSA', libro, 0, datos.fotos?.FOTO_BOLSA)

  const caja = hojas.caja
  campo(caja, 'TP_DOCENAS_POR_CAJA', libro, datos.docenasPorCaja)
  caja.mergeCells('A7:J9')
  const cc = campo(caja, 'TP_CAJA_TEXTO', libro)
  cc.value = datos.textos?.caja || ''
  cc.alignment = { wrapText: true, vertical: 'top' }
  caja.getCell('A6').value = 'COMO SE ACOMODA EN LA CAJA O BULTO:'
  caja.getCell('A6').font = { name: 'Arial', size: 9, bold: true, color: { argb: AZUL } }
  zonaFoto(caja, 'FOTO_CAJA', libro, 0, datos.fotos?.FOTO_CAJA)

  // ----------------------------------------------------------------- _RAGNAR
  const ragnar = hojas.ragnar
  ragnar.state = 'hidden'
  ragnar.getColumn(1).width = 22
  ragnar.getColumn(2).width = 90
  const valores = {
    plantilla: PLANTILLA.id,
    version: PLANTILLA.version,
    generadoEn: fecha.toISOString(),
    generadoDesdeOt: datos.ot || '',
    generadoPorUid: datos.generadoPorUid || '',
    generadoPorNombre: datos.generadoPorNombre || '',
    migradoDe: datos.migradoDe ? JSON.stringify(datos.migradoDe) : '',
    reporteMigracion: datos.reporteMigracion ? JSON.stringify(datos.reporteMigracion).slice(0, 32000) : '',
    // Textos del original que el convertidor no supo acomodar: se guardan
    // para que el visor los ensene y Lety los ponga donde van.
    noMigrado: Array.isArray(datos.sobrantes) && datos.sobrantes.length ? JSON.stringify(datos.sobrantes).slice(0, 32000) : '',
    // Los rangos REALES de este libro (las tablas pueden haber crecido).
    manifiesto: JSON.stringify({ ...manifiesto(), nombres: Object.fromEntries((libro.definedNames.model || []).map((d) => [d.name, d.ranges[0]])) })
  }
  CLAVES_RAGNAR.forEach((k, i) => {
    ragnar.getCell(`A${i + 1}`).value = k
    ragnar.getCell(`B${i + 1}`).value = valores[k]
  })
  libro.definedNames.add(`'${HOJAS.ragnar}'!$A$1:$B$${CLAVES_RAGNAR.length}`, 'TP_RAGNAR')

  return libro
}

/** Descarga un libro de ExcelJS en el navegador. */
export async function descargarLibro(libro, nombre) {
  const buf = await libro.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
