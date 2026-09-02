// EL EXCEL DEL PEDIDO: el BALANCE, no una copia del packing list.
//
// ⚠️ Reescrito el 2026-09-02, después de que el papá de Roberto lo revisara.
// La primera versión copiaba el papel de Valeria (empaque, precio, importes,
// seis bloques de entrega) y él fue tajante:
//
//   «No me interesa el empaque. No me interesa el precio. Me interesa solo el
//    comparativo de las unidades de venta: cuántas me solicitaron y cuántas
//    entregué... Lo que necesitamos en esto es el balance del pedido.»
//
// Son DOS documentos distintos, y por eso ya no se parecen:
//   - `pdfPL.js`  → el PAPEL de una entrega: viaja con la mercancía, lleva
//                   empaque, precios y las firmas. Ese sí copia su formato, y
//                   él lo dio por bueno.
//   - este Excel  → el CONTROL del pedido: qué se pidió, qué se ha entregado
//                   en cada entrega y qué falta.
//
// La forma que pidió, por código:
//
//   Total pedido | Entrega 1 | Entrega 2 | ... | Total entregado | Faltante
//
// Las columnas de entrega **van creciendo** conforme se entrega, y arriba va
// la referencia de cada una («que aparezcan con los folios»): sin saber de qué
// entrega es y de cuándo, una columna de números no dice nada.
import { cargarWorkbook } from './excelJs.js'
import { armarPlDeLaOc } from './entregasPL'

/**
 * Arma el Excel de balance de una orden de compra.
 *
 * `entregas`  las actas de esa OC (de `entregasPL`).
 * `plan`      [{ codigo, cantidadPlan }] YA en las unidades en que se entrega
 *             (packs). Puede venir vacío: entonces «Total pedido» y
 *             «Faltante» van en blanco — que es la verdad cuando no se puede
 *             convertir de docenas a packs, y mejor que un cero que diría que
 *             no se pidió nada.
 */
export async function generarExcelPL({ oc, entregas, plan }) {
  if (!entregas || entregas.length === 0) {
    throw new Error('Esa orden de compra todavía no tiene entregas registradas.')
  }
  const Workbook = await cargarWorkbook()
  const libro = new Workbook()

  const { numeros, renglones } = armarPlDeLaOc(entregas)
  const porCodigoPlan = new Map((plan || []).map((p) => [p.codigo, Number(p.cantidadPlan) || 0]))
  const porNumero = new Map(entregas.map((e) => [e.numeroEntrega, e]))
  const enc = entregas[0] || {}

  const h = libro.addWorksheet('BALANCE')

  // ---- Encabezado del pedido ---------------------------------------------
  h.addRow(['SUBCLIENTE:', enc.subcliente || '', '', 'PL:', enc.pl || ''])
  h.addRow(['PO#:', enc.po || '', '', 'Ped. Micro', enc.pedidoMicrosip || ''])
  h.addRow(['OC#:', enc.ocCliente || oc, '', 'Rem. Micro', enc.remisionMicrosip || ''])
  for (let i = 1; i <= 3; i++) h.getRow(i).font = { bold: true }
  h.addRow([])

  // ---- Referencia de cada entrega ----------------------------------------
  h.addRow(['REFERENCIA DE CADA ENTREGA'])
  h.getRow(h.rowCount).font = { bold: true }
  const cabRef = h.addRow(['Entrega', 'Fecha', 'Factura', 'Bitácora'])
  cabRef.font = { bold: true }
  numeros.forEach((n) => {
    const e = porNumero.get(n) || {}
    h.addRow([n, e.fechaEntregaTexto || '', e.factura || '', e.bitacora || ''])
  })
  h.addRow([])

  // ---- La tabla del balance ----------------------------------------------
  const cab = ['OT', 'CLAVE', 'ARTICULO', 'TOTAL PEDIDO']
  numeros.forEach((n) => cab.push('ENTREGA ' + n))
  cab.push('TOTAL ENTREGADO', 'FALTANTE', '%')
  const filaCab = h.addRow(cab)
  filaCab.font = { bold: true }
  const numFilaCab = filaCab.number

  h.getColumn(1).width = 12
  h.getColumn(2).width = 18
  h.getColumn(3).width = 44
  h.getColumn(4).width = 14
  for (let i = 0; i < numeros.length; i++) h.getColumn(5 + i).width = 12
  h.getColumn(5 + numeros.length).width = 17
  h.getColumn(6 + numeros.length).width = 12
  h.getColumn(7 + numeros.length).width = 9

  const primeraFila = numFilaCab + 1
  for (const r of renglones) {
    const pedido = porCodigoPlan.get(r.codigoQuini || r.clave)
    const fila = [r.ot || '', r.clave, r.articulo, pedido == null ? '' : pedido]
    let entregado = 0
    numeros.forEach((n) => {
      const d = r.porEntrega[n]
      if (d) {
        entregado += d.packs || 0
        fila.push(d.packs)
      } else {
        // Vacío, no cero: en esa entrega este código no viajó, que es distinto
        // de haber entregado nada de él.
        fila.push(null)
      }
    })
    fila.push(entregado)
    if (pedido == null) {
      // Sin saber lo pedido no hay faltante ni porcentaje que calcular.
      fila.push('', '')
    } else {
      fila.push(Math.max(0, pedido - entregado), pedido > 0 ? entregado / pedido : '')
    }
    h.addRow(fila)
  }
  const ultimaFila = h.rowCount

  // El porcentaje como porcentaje, no como 0.96875.
  const colPct = 7 + numeros.length
  for (let i = primeraFila; i <= ultimaFila; i++) h.getCell(i, colPct).numFmt = '0.0%'

  // ---- TOTALES por fórmula, con su resultado guardado ---------------------
  //
  // ⚠️ Va `{ formula, result }`: sin el resultado, la VISTA PROTEGIDA de Excel
  // no recalcula y las celdas se ven VACÍAS — es lo que Roberto reportó el
  // 25-ago con el Excel de la orden de compra.
  const letra = (n) => {
    let s = ''
    while (n > 0) {
      const m = (n - 1) % 26
      s = String.fromCharCode(65 + m) + s
      n = Math.floor((n - 1) / 26)
    }
    return s
  }
  const filaTot = h.addRow(['', '', 'TOTALES'])
  filaTot.font = { bold: true }
  const sumaCol = (col, valor) => {
    const L = letra(col)
    filaTot.getCell(col).value = {
      formula: 'SUM(' + L + primeraFila + ':' + L + ultimaFila + ')',
      result: valor
    }
  }
  const totalPedido = renglones.reduce((a, r) => {
    const p = porCodigoPlan.get(r.codigoQuini || r.clave)
    return a + (p == null ? 0 : p)
  }, 0)
  if (totalPedido > 0) sumaCol(4, totalPedido)
  numeros.forEach((n, i) => {
    sumaCol(
      5 + i,
      renglones.reduce((a, r) => a + ((r.porEntrega[n] && r.porEntrega[n].packs) || 0), 0)
    )
  })
  const totalEntregado = renglones.reduce((a, r) => a + r.packsTotal, 0)
  sumaCol(5 + numeros.length, totalEntregado)
  if (totalPedido > 0) {
    sumaCol(6 + numeros.length, Math.max(0, totalPedido - totalEntregado))
    filaTot.getCell(colPct).value = totalEntregado / totalPedido
    filaTot.getCell(colPct).numFmt = '0.0%'
  }
  filaTot.commit()

  const buffer = await libro.xlsx.writeBuffer()
  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    nombreArchivo: ('Balance OC' + oc + (enc.po ? ' PO' + enc.po : '') + '.xlsx')
      .replace(/\s+/g, ' ')
      .trim()
  }
}
