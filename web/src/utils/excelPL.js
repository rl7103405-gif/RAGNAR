// EL EXCEL DEL PL (packing list): el papel con el que Valeria embarca.
//
// Reproduce los encabezados EXACTOS de su archivo
// (`PL STYLOS02 OC16058 PO2449.xlsx`, hoja PEDIDO) para que quien lleva años
// leyéndolo no tenga que aprenderse otro. Misma decisión que se tomó con el
// Excel de la orden de compra: se copia el papel que ya existe, no se diseña
// uno nuevo "mejor".
//
// La forma real del papel, medida sobre el archivo:
//   - Encabezado con SUBCLIENTE, PL, PO#, OC#, Ped. Micro y Rem. Micro.
//   - Un renglón por clave: OT · Clave · Artículo · Unidad · PRECIO.
//   - Después BLOQUES REPETIDOS por entrega, hasta seis. Cada bloque trae su
//     FACTURA, FECHA ENTREGA, ENTREGA # y BITÁCORA arriba, y por renglón
//     EMPAQUE · BULTO · PAQS · PZAS · IMPORTE.
//   - Al cierre: solicitadas, entregadas, pendientes, excedidas y el %.
//
// ⚠️ LO QUE NO SE INVENTA. FACTURA, BITÁCORA, Ped. Micro y Rem. Micro salen de
// Microsip y del portal del cliente, no de RAGNAR. Si la entrega no los trae,
// la celda va VACÍA, no en cero: un cero ahí sería una factura que no existe.
// Van explicados en la portada para que nadie los lea como dato de la app.
import { cargarWorkbook } from './excelJs.js'
import { armarPlDeLaOc, cierreDelRenglon } from './entregasPL'

const MAX_ENTREGAS = 6

/** Encabezados fijos del renglón, con la ortografía del papel de Valeria. */
const COLS_BASE = ['OT', 'Clave', 'Artículo', 'Unidad medida', 'PRECIO']

/** Los de cada bloque de entrega. El papel escribe "PAQS 1A ENTREGA" y
 *  "PZAS 1A ENTREGA"; se respeta esa forma. */
function colsDeEntrega(n) {
  const orden = ['1A', '2A', '3A', '4A', '5A', '6A'][n - 1] || `${n}A`
  return ['EMPAQUE', 'BULTO', `PAQS ${orden} ENTREGA`, `PZAS ${orden} ENTREGA`, 'IMPORTE']
}

/**
 * Arma el libro del PL de una orden de compra.
 *
 * `entregas`  las actas de esa OC (de `entregasPL`).
 * `plan`      renglones del plan maestro: { codigo, cantidadPlan } — para el
 *             cierre. Puede venir vacío: entonces el cierre va en blanco, que
 *             es la verdad, en vez de un 0% que diría que no se ha entregado
 *             nada.
 */
export async function generarExcelPL({ oc, entregas, plan }) {
  if (!entregas || entregas.length === 0) {
    throw new Error('Esa orden de compra todavía no tiene entregas registradas.')
  }
  const Workbook = await cargarWorkbook()
  const libro = new Workbook()

  const { numeros, renglones } = armarPlDeLaOc(entregas)
  const usadas = numeros.slice(0, MAX_ENTREGAS)
  const porCodigoPlan = new Map((plan || []).map((p) => [p.codigo, Number(p.cantidadPlan) || 0]))
  const enc = entregas[0] || {}

  // ---- Portada: qué es esto y qué NO trae -------------------------------
  const portada = libro.addWorksheet('Léeme')
  portada.getColumn(1).width = 100
  portada.addRow([`Packing list de la orden de compra ${oc}`])
  portada.getRow(1).font = { bold: true, size: 14 }
  portada.addRow([])
  portada.addRow([`Generado por RAGNAR con las ${entregas.length} entrega(s) registradas de esta orden.`])
  portada.addRow([])
  portada.addRow(['Columnas que RAGNAR NO llena, porque no son suyas:'])
  portada.getRow(portada.rowCount).font = { bold: true, color: { argb: 'FFB45309' } }
  portada.addRow(['  FACTURA y BITÁCORA — salen de Microsip y del portal del cliente.'])
  portada.addRow(['  Ped. Micro y Rem. Micro — son de Microsip.'])
  portada.addRow(['Si están vacías es porque no se capturaron, no porque valgan cero.'])
  portada.addRow([])
  portada.addRow(['La columna OT sí la pone RAGNAR, desde el plan maestro de Adrián.'])
  portada.getRow(portada.rowCount).font = { bold: true, color: { argb: 'FF1A7A3A' } }
  portada.addRow(['Los BULTOS y los PAQS salen del texto del EMPAQUE ("2/200 1/58" = 3 bultos, 458 packs).'])

  // ---- Hoja PEDIDO: el papel ---------------------------------------------
  const h = libro.addWorksheet('PEDIDO')

  h.addRow(['SUBCLIENTE:', enc.subcliente || '', '', 'PL:', enc.pl || ''])
  h.addRow(['PO#:', enc.po || '', '', 'Ped. Micro', enc.pedidoMicrosip || ''])
  h.addRow(['OC#:', oc, '', 'Rem. Micro', enc.remisionMicrosip || ''])
  h.addRow([])
  h.getRow(1).font = { bold: true }
  h.getRow(2).font = { bold: true }
  h.getRow(3).font = { bold: true }

  // Encabezado de cada bloque de entrega, arriba de sus columnas.
  const filaFactura = h.rowCount + 1
  const datosPorEntrega = new Map(entregas.map((e) => [e.numeroEntrega, e]))
  const anchoBloque = 5
  const inicioBloques = COLS_BASE.length + 1

  const filaF = h.getRow(filaFactura)
  const filaFecha = h.getRow(filaFactura + 1)
  const filaNum = h.getRow(filaFactura + 2)
  const filaBit = h.getRow(filaFactura + 3)
  usadas.forEach((n, i) => {
    const c = inicioBloques + i * anchoBloque
    const e = datosPorEntrega.get(n) || {}
    filaF.getCell(c).value = 'FACTURA:'
    filaF.getCell(c + 1).value = e.factura || ''
    filaFecha.getCell(c).value = 'FECHA ENTREGA:'
    filaFecha.getCell(c + 1).value = e.fechaEntregaTexto || ''
    filaNum.getCell(c).value = 'ENTREGA #'
    filaNum.getCell(c + 1).value = n
    filaBit.getCell(c).value = 'BITACORA'
    filaBit.getCell(c + 1).value = e.bitacora || ''
  })
  ;[filaF, filaFecha, filaNum, filaBit].forEach((f) => {
    f.font = { bold: true }
    f.commit()
  })
  h.addRow([])

  // Fila de encabezados de columna.
  const cab = [...COLS_BASE]
  usadas.forEach((n) => cab.push(...colsDeEntrega(n)))
  cab.push('SOLICITADAS', 'ENTREGADAS', 'EXCEDIDAS', 'PENDIENTES', '%')
  const filaCab = h.addRow(cab)
  filaCab.font = { bold: true }
  const numFilaCab = filaCab.number

  h.getColumn(1).width = 14
  h.getColumn(2).width = 18
  h.getColumn(3).width = 46
  h.getColumn(4).width = 8
  h.getColumn(5).width = 10

  // ---- Los renglones ------------------------------------------------------
  const primeraFila = numFilaCab + 1
  for (const r of renglones) {
    // Se imprime la CLAVE DEL CLIENTE (es su papel), pero el cierre se cruza
    // por el codigo de Quini, que es como habla el plan maestro.
    const fila = [r.ot || '', r.clave, r.articulo, r.unidad || 'PZA', r.precio || null]
    let entregadas = 0
    usadas.forEach((n) => {
      const d = r.porEntrega[n]
      if (d) {
        entregadas += d.packs || 0
        fila.push(d.empaque || '', d.bultos ?? null, d.packs ?? null, d.piezas ?? null, d.importe || null)
      } else {
        // Sin entrega en ese bloque: vacío, no cero. El cero diría que se
        // entregó nada; el vacío dice que ese bloque no existe para este
        // código, que es lo cierto.
        fila.push('', null, null, null, null)
      }
    })
    const pedidas = porCodigoPlan.get(r.codigoQuini || r.clave)
    const c = cierreDelRenglon(pedidas ?? 0, entregadas)
    fila.push(
      pedidas == null ? '' : c.pedidas,
      entregadas,
      pedidas == null ? '' : c.excedidas,
      pedidas == null ? '' : c.pendientes,
      c.porcentaje == null ? '' : c.porcentaje
    )
    h.addRow(fila)
  }
  const ultimaFila = h.rowCount

  // ---- TOTALES por fórmula, con su resultado guardado ---------------------
  //
  // ⚠️ Va `{ formula, result }`, no solo la fórmula: sin el resultado, la
  // VISTA PROTEGIDA de Excel no recalcula y las celdas se ven VACÍAS — es lo
  // que Roberto reportó el 25-ago con el Excel de la orden de compra. Con el
  // resultado, la vista protegida ya muestra el número y al habilitar edición
  // la fórmula sigue viva.
  const letra = (n) => {
    let s = ''
    while (n > 0) {
      const m = (n - 1) % 26
      s = String.fromCharCode(65 + m) + s
      n = Math.floor((n - 1) / 26)
    }
    return s
  }
  const filaTot = h.addRow(['', '', 'TOTALES', '', ''])
  filaTot.font = { bold: true }
  const sumar = (col, valor) => {
    const L = letra(col)
    filaTot.getCell(col).value = {
      formula: `SUM(${L}${primeraFila}:${L}${ultimaFila})`,
      result: valor
    }
  }
  usadas.forEach((n, i) => {
    const base = inicioBloques + i * anchoBloque
    const dela = (campo) =>
      renglones.reduce((a, r) => a + ((r.porEntrega[n] && r.porEntrega[n][campo]) || 0), 0)
    sumar(base + 1, dela('bultos'))
    sumar(base + 2, dela('packs'))
    sumar(base + 3, dela('piezas'))
    sumar(base + 4, Math.round(dela('importe') * 100) / 100)
  })
  filaTot.commit()

  const buffer = await libro.xlsx.writeBuffer()
  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }),
    nombreArchivo: `PL ${enc.pl || ''} OC${oc}${enc.po ? ' PO' + enc.po : ''}.xlsx`.replace(/\s+/g, ' ').trim()
  }
}
