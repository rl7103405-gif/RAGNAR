// LA REMISION DE LA MAQUILA: "ENTREGA DE PRODUCTO TERMINADO".
//
// Es el papel que la maquila entrega junto con la mercancia, y con el que
// COBRA. Reproduce el formato que hoy llenan a mano (foto del 24-08 de la
// remision de Munguia, folio E-658): mismas columnas, mismos totales, mismas
// tres firmas.
//
// ⚠️ POR QUE AGRUPA POR ORDEN DE TRABAJO. En la remision real conviven varias
// OT en un mismo viaje (la de Munguia traia la 7960, la 7737 y la 7736), y
// Roberto lo pidio explicito: "divide las OT nada mas para que se vea mas
// ordenado". Mismo criterio que el PDF de salida de Quini, que ya separa por
// orden.
//
// ⚠️ EL PRECIO ES POR DOCENA ENTREGADA, no por pack. Lo dice el resumen de
// pagos de la fabrica en sus 2,229 renglones y lo confirma la remision de
// papel de Munguia (131.5 docenas x $6.00 = $789.00, su total exacto).
//
// ⚠️ EL PRECIO VA EN BLANCO SI NO HAY TARIFA. Las columnas existen y suman, pero sin
// tarifa: cada maquila cobra distinto SEGUN EL MODELO, y esos precios los va a
// capturar Cielo en su propia pantalla. Hasta que existan, el papel sale con
// el espacio para escribirlos a mano — que es exactamente como se llena hoy.
// Un precio inventado aqui seria dinero mal pagado: en la junta del 17-08 se
// conto que un error de tarifa costo ~50,000 pesos en una semana.
import { jsPDF } from 'jspdf'
import { LOGO_QUINI_PNG_BASE64 } from '../assets/logoQuini'
import { compararAscendente } from './texto'

const SIN_ORDEN = 'SIN ORDEN'

const texto = (v) => String(v ?? '').trim()
const numero = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Cantidades: sin decimales si son enteras, con uno si no (131.5 docenas). */
const cant = (v) => {
  const n = numero(v)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

const dinero = (v) =>
  numero(v) > 0 ? '$ ' + numero(v).toLocaleString('es-MX', { minimumFractionDigits: 2 }) : ''

/** Los renglones agrupados por orden de trabajo, cada grupo ya ordenado. */
function agruparPorOt(renglones) {
  const grupos = new Map()
  renglones.forEach((r) => {
    const ot = texto(r.ot) || SIN_ORDEN
    if (!grupos.has(ot)) grupos.set(ot, [])
    grupos.get(ot).push(r)
  })
  return [...grupos.entries()]
    .sort(([a], [b]) => {
      if (a === SIN_ORDEN) return 1
      if (b === SIN_ORDEN) return -1
      return compararAscendente(a, b)
    })
    .map(([ot, lista]) => ({
      ot,
      renglones: [...lista].sort((a, b) => compararAscendente(a.codigo, b.codigo))
    }))
}

/**
 * Genera la remision y devuelve el Blob del PDF.
 *
 * renglones: [{ ot, subCliente, codigo, descripcion, modelo, talla,
 *               packs, docenas, precioUnitario, observaciones, caja }]
 * enc:       { maquila, recibe, direccion, folio, fechaEntrega, entrega, bultos }
 */
export function generarRemisionMaquila({ renglones, enc = {}, esPrueba = false }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const margen = 24
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - margen * 2

  // Las columnas, en el mismo orden que el formato de papel.
  const COLS = [
    { k: 'caja', t: 'CAJA /\nBULTO', w: 38, al: 'center' },
    { k: 'ot', t: 'PEDIDO /\nOT', w: 46, al: 'center' },
    { k: 'subCliente', t: 'SUB\nCLIENTE', w: 58 },
    { k: 'codigo', t: 'Codigo', w: 62 },
    { k: 'descripcion', t: 'Descripcion', w: 128 },
    { k: 'modelo', t: 'Modelo', w: 62 },
    { k: 'talla', t: 'Talla', w: 52 },
    { k: 'packs', t: 'PACKS\nARMADOS', w: 54, al: 'right' },
    { k: 'docenas', t: 'DOC\nENTREGADAS', w: 62, al: 'right' },
    { k: 'precio', t: 'PRECIO\nUNITARIO', w: 54, al: 'right' },
    { k: 'total', t: 'Total', w: 58, al: 'right' },
    { k: 'observaciones', t: 'OBSERVACIONES', w: 0 }
  ]
  const fijas = COLS.reduce((a, c) => a + c.w, 0)
  COLS[COLS.length - 1].w = Math.max(90, anchoUtil - fijas)

  const alinear = (c) => (c.al === 'right' ? 'right' : c.al === 'center' ? 'center' : 'left')
  const posX = (c, x) => (c.al === 'right' ? x + c.w - 3 : c.al === 'center' ? x + c.w / 2 : x + 3)

  let y = margen

  const encabezadoHoja = () => {
    y = margen
    if (esPrueba) {
      pdf.setFillColor(217, 119, 6)
      pdf.rect(margen, y, anchoUtil, 14, 'F')
      pdf.setTextColor(255)
      pdf.setFontSize(8)
      pdf.setFont(undefined, 'bold')
      pdf.text('DOCUMENTO DE PRUEBA - NO ES UNA ENTREGA REAL', margen + 6, y + 10)
      pdf.setTextColor(0)
      y += 20
    }
    try {
      pdf.addImage(LOGO_QUINI_PNG_BASE64, 'PNG', margen, y, 34, 34)
    } catch {
      // Sin logo el documento sirve igual: no se cae por un adorno.
    }
    pdf.setFontSize(13)
    pdf.setFont(undefined, 'bold')
    pdf.text('ENTREGA DE PRODUCTO TERMINADO', margen + 44, y + 14)

    pdf.setFontSize(8.5)
    pdf.setFont(undefined, 'normal')
    const col2 = margen + 300
    const col3 = ancho - margen - 200
    pdf.text('MAQUILA: ' + texto(enc.maquila), margen + 44, y + 27)
    pdf.text('Recibe: ' + (texto(enc.recibe) || 'DEPORTIVOS QUINI'), margen + 44, y + 37)
    pdf.text('Direccion para entrega: ' + texto(enc.direccion), col2, y + 27)
    pdf.setFont(undefined, 'bold')
    pdf.text('Folio interno: ' + texto(enc.folio), col3, y + 27)
    pdf.setFont(undefined, 'normal')
    pdf.text('Fecha entrega: ' + texto(enc.fechaEntrega), col3, y + 37)
    y += 48
  }

  const cabeceraTabla = () => {
    pdf.setFillColor(255, 217, 102)
    pdf.rect(margen, y, anchoUtil, 20, 'F')
    pdf.setFontSize(6.5)
    pdf.setFont(undefined, 'bold')
    let x = margen
    COLS.forEach((c) => {
      c.t.split('\n').forEach((l, i) => {
        pdf.text(l, posX(c, x), y + 8 + i * 7, { align: alinear(c) })
      })
      pdf.setDrawColor(150)
      pdf.line(x, y, x, y + 20)
      x += c.w
    })
    pdf.line(margen + anchoUtil, y, margen + anchoUtil, y + 20)
    pdf.rect(margen, y, anchoUtil, 20)
    y += 20
  }

  encabezadoHoja()
  cabeceraTabla()

  const grupos = agruparPorOt(renglones)
  let totalPacks = 0
  let totalDocenas = 0
  let totalPagar = 0

  grupos.forEach((grupo, gi) => {
    // Cada orden de trabajo se separa con su franja: es lo que se pidio para
    // que el papel se lea ordenado cuando trae varias.
    if (y + 44 > alto - 100) {
      pdf.addPage()
      encabezadoHoja()
      cabeceraTabla()
    }
    if (gi > 0) y += 3
    pdf.setFillColor(238, 242, 247)
    pdf.rect(margen, y, anchoUtil, 13, 'F')
    pdf.setFont(undefined, 'bold')
    pdf.setFontSize(8)
    pdf.text(
      grupo.ot === SIN_ORDEN ? 'SIN ORDEN DE TRABAJO' : 'ORDEN DE TRABAJO ' + grupo.ot,
      margen + 4,
      y + 9
    )
    pdf.rect(margen, y, anchoUtil, 13)
    y += 13

    pdf.setFont(undefined, 'normal')
    pdf.setFontSize(7.5)

    grupo.renglones.forEach((r) => {
      if (y + 16 > alto - 100) {
        pdf.addPage()
        encabezadoHoja()
        cabeceraTabla()
        pdf.setFont(undefined, 'normal')
        pdf.setFontSize(7.5)
      }
      const packs = numero(r.packs)
      const docenas = numero(r.docenas)
      const precio = numero(r.precioUnitario)
      // ⚠️ POR DOCENA, no por pack. Comprobado contra el resumen de pagos real
      // (2,229 de 2,229 renglones: MONTO = PRECIO x DOCENAS) y contra la
      // remision de Munguia: 131.5 doc x $6 = $789, que es su total. Multiplicar
      // por packs daba $1,416 por ese mismo renglon — casi el doble.
      const total = precio > 0 ? docenas * precio : 0
      totalPacks += packs
      totalDocenas += docenas
      totalPagar += total

      const valores = {
        caja: texto(r.caja),
        ot: grupo.ot === SIN_ORDEN ? '' : grupo.ot,
        subCliente: texto(r.subCliente),
        codigo: texto(r.codigo),
        descripcion: texto(r.descripcion),
        modelo: texto(r.modelo),
        talla: texto(r.talla),
        packs: packs > 0 ? cant(packs) : '',
        docenas: docenas > 0 ? cant(docenas) : '',
        // En blanco mientras no haya tarifas: se escribe a mano, igual que hoy.
        precio: dinero(precio),
        total: dinero(total),
        observaciones: texto(r.observaciones)
      }
      let x = margen
      COLS.forEach((c) => {
        const v = valores[c.k] || ''
        const recortado = v ? pdf.splitTextToSize(v, c.w - 6)[0] || '' : ''
        pdf.text(recortado, posX(c, x), y + 10, { align: alinear(c) })
        pdf.setDrawColor(190)
        pdf.line(x, y, x, y + 15)
        x += c.w
      })
      pdf.line(margen + anchoUtil, y, margen + anchoUtil, y + 15)
      pdf.rect(margen, y, anchoUtil, 15)
      y += 15
    })
  })

  // ---- Totales ----
  if (y + 34 > alto - 100) {
    pdf.addPage()
    encabezadoHoja()
  }
  y += 4
  pdf.setFillColor(255, 217, 102)
  pdf.rect(margen, y, anchoUtil, 18, 'F')
  pdf.setFont(undefined, 'bold')
  pdf.setFontSize(8)
  pdf.text('BULTOS / CAJAS: ' + (texto(enc.bultos) || '____'), margen + 6, y + 12)
  let xt = margen
  COLS.forEach((c) => {
    if (c.k === 'packs') pdf.text(cant(totalPacks), xt + c.w - 3, y + 12, { align: 'right' })
    if (c.k === 'docenas') pdf.text(cant(totalDocenas), xt + c.w - 3, y + 12, { align: 'right' })
    // La etiqueta va en la columna del PRECIO (vacia en la fila de totales) y
    // en dos lineas, como en el formato de papel. En una sola linea se montaba
    // encima del total de docenas: se veia "TO3TAL A PAGAR".
    if (c.k === 'precio') {
      pdf.setFontSize(6.5)
      pdf.text('TOTAL A', xt + c.w - 3, y + 8, { align: 'right' })
      pdf.text('PAGAR', xt + c.w - 3, y + 15, { align: 'right' })
      pdf.setFontSize(8)
    }
    if (c.k === 'total') {
      pdf.text(totalPagar > 0 ? dinero(totalPagar) : '', xt + c.w - 3, y + 12, { align: 'right' })
    }
    xt += c.w
  })
  pdf.rect(margen, y, anchoUtil, 18)
  y += 30

  // ---- Las tres firmas del formato de papel ----
  const anchoFirma = anchoUtil / 3
  const FIRMAS = ['ENTREGA', 'TRANSPORTA', 'ALMACEN PT']
  FIRMAS.forEach((titulo, i) => {
    const x = margen + anchoFirma * i
    pdf.setDrawColor(80)
    pdf.line(x + 20, y + 34, x + anchoFirma - 20, y + 34)
    pdf.setFontSize(8)
    pdf.setFont(undefined, 'bold')
    pdf.text(titulo, x + anchoFirma / 2, y + 46, { align: 'center' })
    if (i === 0 && texto(enc.entrega)) {
      pdf.setFont(undefined, 'normal')
      pdf.setFontSize(7.5)
      pdf.text(texto(enc.entrega), x + anchoFirma / 2, y + 55, { align: 'center' })
    }
  })

  return pdf.output('blob')
}
