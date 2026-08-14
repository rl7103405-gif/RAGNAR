// Genera el PDF de salida con el MISMO formato que la hoja fisica de
// Deportivos Quini (folio/peso/codigo/descripcion/modelo/talla/color/
// referencia/linea/docenas/unidad/UPC + encabezado + resumen + firmas).
// Los datos de producto salen del snapshot congelado en cada captura
// (bultos/{folio}.producto: Excel del dia + catalogo, resueltos al pesar);
// lo que no exista en esas fuentes (UPC, folio interno) se queda como "N/A".
//
// Cada ORDEN DE TRABAJO arranca en su propia hoja: una salida no mezcla
// ordenes distintas en el mismo papel. Si una orden no cabe en una hoja,
// sigue en la siguiente repitiendo su encabezado, y el pie lleva las dos
// numeraciones (hoja de la orden y hoja del paquete completo).
import { compararAscendente } from './texto'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { LOGO_QUINI_PNG_BASE64 } from '../assets/logoQuini'

const NA = 'N/A'

function celda(valor) {
  return valor === null || valor === undefined || valor === '' ? NA : String(valor)
}

// Campos del encabezado que captura quien genera el PDF (America). Si un
// campo viene vacio se deja EN BLANCO (espacio para escribirlo a mano),
// ya no "N/A".
function textoEncabezado(valor) {
  return valor === null || valor === undefined ? '' : String(valor)
}

export const SIN_ORDEN = 'SIN ORDEN'

/** OT a partir del texto del pedido: los primeros 4 digitos
 *  ('7887_REPOSICION_2408' -> '7887'). Exportada para que la meta derivada del
 *  ruteo y el avance de las tareas usen EXACTAMENTE el mismo criterio: si aqui
 *  un folio es de la OT 7887, alla tambien. */
export function otDePedido(pedido) {
  if (!pedido) return null
  const m = /^\d{4}/.exec(String(pedido).trim())
  return m ? m[0] : null
}

/** Orden de trabajo de una captura (SIN_ORDEN si su pedido no la trae). */
export function ordenDeCaptura(captura) {
  return otDePedido(captura.producto?.pedido) ?? SIN_ORDEN
}

/** Agrupa las capturas por orden de trabajo. Las OT salen en orden ASCENDENTE
 *  (SIN ORDEN al final) y dentro de cada OT los folios tambien ascendentes:
 *  asi el papel se coteja de corrido contra el fisico. */
function agruparPorOrden(capturas) {
  const grupos = new Map()
  capturas.forEach((c) => {
    const orden = ordenDeCaptura(c)
    if (!grupos.has(orden)) grupos.set(orden, [])
    grupos.get(orden).push(c)
  })
  return [...grupos.entries()]
    .sort(([a], [b]) => {
      if (a === SIN_ORDEN) return 1
      if (b === SIN_ORDEN) return -1
      return compararAscendente(a, b)
    })
    .map(([orden, lista]) => ({
      orden,
      capturas: [...lista].sort((a, b) => compararAscendente(a.folio, b.folio))
    }))
}

export function generarPdfSalida({ capturas, operador, fecha, encabezado = {}, esPrueba = false }) {
  const encBase = {
    folioInterno: textoEncabezado(encabezado.folioInterno),
    fechaSolicitud: textoEncabezado(encabezado.fechaSolicitud),
    areaRecibe: textoEncabezado(encabezado.areaRecibe),
    direccionEnvio: textoEncabezado(encabezado.direccionEnvio),
    conceptoSalida: textoEncabezado(encabezado.conceptoSalida),
    observaciones: textoEncabezado(encabezado.observaciones)
  }
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  // Margenes compactos: con muchos folios cada hoja cuenta, y el formato
  // impreso tenia ~2 cm desperdiciados arriba.
  const margen = 20
  const anchoUtil = pdf.internal.pageSize.getWidth() - margen * 2
  const anchoPagina = pdf.internal.pageSize.getWidth()
  const paginaAlto = pdf.internal.pageSize.getHeight()

  const grupos = agruparPorOrden(capturas)
  const rangos = []

  grupos.forEach((grupo, indiceGrupo) => {
    // Cada orden de trabajo empieza SIEMPRE en hoja nueva.
    if (indiceGrupo > 0) pdf.addPage()
    const paginaInicial = pdf.internal.getNumberOfPages()
    dibujarOrden(pdf, {
      capturas: grupo.capturas,
      enc: { ...encBase, ordenTrabajo: grupo.orden === SIN_ORDEN ? '' : grupo.orden },
      operador,
      fecha,
      margen,
      anchoUtil,
      paginaAlto
    })
    rangos.push({
      orden: grupo.orden,
      desde: paginaInicial,
      hasta: pdf.internal.getNumberOfPages()
    })
  })

  // ---- Pie con la doble numeracion ----
  const totalPaginas = pdf.internal.getNumberOfPages()
  rangos.forEach(({ orden, desde, hasta }) => {
    const hojasDeLaOrden = hasta - desde + 1
    for (let p = desde; p <= hasta; p++) {
      pdf.setPage(p)
      pdf.setFontSize(8)
      pdf.setFont(undefined, 'normal')
      const etiquetaOrden = orden === SIN_ORDEN ? 'Sin orden' : `Orden ${orden}`
      const texto =
        `${etiquetaOrden}: hoja ${p - desde + 1} de ${hojasDeLaOrden}` +
        `     |     hoja ${p} de ${totalPaginas} del paquete`
      pdf.text(texto, anchoPagina - margen, paginaAlto - 8, { align: 'right' })
    }
  })

  // ---- Marca de PRUEBA ----
  // Va en TODAS las hojas y atravesada: un papel de prueba tiene que
  // distinguirse de un vistazo aunque se imprima en blanco y negro, se
  // fotocopie o alguien lo encuentre suelto en una mesa. Se dibuja al final
  // para que quede ENCIMA del contenido, y en gris claro para que el papel
  // siga siendo legible (el objetivo es que nadie lo confunda con una
  // remision de verdad, no inutilizarlo).
  if (esPrueba) {
    const total = pdf.internal.getNumberOfPages()
    for (let p = 1; p <= total; p++) {
      pdf.setPage(p)
      pdf.setTextColor(210, 210, 210)
      pdf.setFontSize(70)
      pdf.setFont(undefined, 'bold')
      pdf.text('P R U E B A', anchoPagina / 2, paginaAlto / 2, {
        align: 'center',
        angle: 20
      })
      pdf.setFontSize(9)
      pdf.setTextColor(180, 60, 60)
      pdf.text('DOCUMENTO DE PRUEBA - SIN VALOR PARA EMBARQUE', margen, paginaAlto - 8)
      // Se devuelven los ajustes por si algo se dibujara despues.
      pdf.setTextColor(0, 0, 0)
      pdf.setFont(undefined, 'normal')
    }
  }

  // Se devuelve el PDF como Blob en vez de descargarlo aqui: quien llama
  // primero REGISTRA la generacion en la bitacora (pdfsGenerados) y solo
  // despues dispara la descarga -- asi no puede existir un PDF descargado
  // sin rastro en el historial (salvo que Firebase este caido, caso en el
  // que el que llama descarga igual pero avisa).
  return {
    blob: pdf.output('blob'),
    nombreArchivo: `salida_${String(fecha).replace(/[^0-9]/g, '')}.pdf`
  }
}

/** Dibuja el encabezado (logo, titulo, caja de folio/orden/fecha, areas y
 *  direccion) en la pagina activa y devuelve la 'y' donde termina. Se llama
 *  en CADA hoja de la orden: si una orden ocupa varias hojas, todas deben
 *  traer su orden de trabajo arriba, no solo la primera. */
function dibujarEncabezado(pdf, { enc, margen, anchoUtil }) {
  let y = margen

  // ---- Encabezado: logo + titulo (izquierda), caja de folio/fechas (derecha) ----
  const logoLado = 32
  try {
    pdf.addImage(LOGO_QUINI_PNG_BASE64, 'PNG', margen, y, logoLado, logoLado)
  } catch (e) {
    console.error('[pdf] No se pudo dibujar el logo:', e)
  }
  pdf.setFontSize(14)
  pdf.setFont(undefined, 'bold')
  pdf.text('DEPORTIVOS QUINI', margen + logoLado + 10, y + logoLado / 2 + 4)
  pdf.setFont(undefined, 'normal')

  const cajaX = margen + anchoUtil - 220
  pdf.setFontSize(9)
  // 'Fecha Entrega' se quito del formato a peticion de Roberto (2026-07-29):
  // no se conoce al generar la salida y se llenaba siempre en blanco.
  const datosCaja = [
    ['Folio Interno:', enc.folioInterno],
    ['Orden de Trabajo:', enc.ordenTrabajo],
    ['Fecha Solicitud:', enc.fechaSolicitud]
  ]
  datosCaja.forEach((fila, i) => {
    const yFila = y + 9 + i * 11
    pdf.text(fila[0], cajaX, yFila)
    if (fila[1]) {
      pdf.text(fila[1], cajaX + 100, yFila, { maxWidth: 100 })
    } else {
      // Vacio: linea para llenar a mano, altura estable.
      pdf.line(cajaX + 100, yFila + 1, cajaX + 205, yFila + 1)
    }
  })

  // Avanza lo suficiente para dejar atras AMBOS bloques del encabezado
  // (logo/titulo a la izquierda, caja de 4 filas a la derecha) antes de
  // seguir. Antes este avance era un numero fijo que no tomaba en cuenta
  // la altura real de la caja, y "Direccion Envio" quedaba encimado con
  // "Fecha Entrega".
  const altoCaja = 9 + (datosCaja.length - 1) * 11 + 10
  y += Math.max(logoLado, altoCaja) + 10
  pdf.setFontSize(9.5)
  const filaEtiquetas = [
    // Quien entrega es el area de PROCESOS INICIALES, no la empresa entera
    // (confirmado por Roberto el 2026-07-29).
    ['Area que Entrega:', 'PROCESOS INICIALES', 'Concepto Salida:', enc.conceptoSalida],
    ['Area que Recibe:', enc.areaRecibe, null, null]
  ]
  filaEtiquetas.forEach((fila) => {
    pdf.setFont(undefined, 'bold')
    pdf.text(fila[0], margen, y)
    pdf.setFont(undefined, 'normal')
    if (fila[1]) {
      pdf.text(fila[1], margen + 95, y, { maxWidth: 300 })
    } else {
      pdf.line(margen + 95, y + 1, margen + 300, y + 1)
    }
    if (fila[2] !== null) {
      pdf.setFont(undefined, 'bold')
      pdf.text(fila[2], margen + anchoUtil - 220, y)
      pdf.setFont(undefined, 'normal')
      if (fila[3]) {
        pdf.text(fila[3], margen + anchoUtil - 110, y, { maxWidth: 110 })
      } else {
        pdf.line(margen + anchoUtil - 110, y + 1, margen + anchoUtil, y + 1)
      }
    }
    y += 13
  })
  // Direccion Envio en su PROPIA linea a lo ancho del encabezado: las
  // direcciones reales de las maquilas (que se precargan al elegirla en el
  // modal) no caben en la media columna que ocupaba antes.
  pdf.setFont(undefined, 'bold')
  pdf.text('Direccion Envio:', margen, y)
  pdf.setFont(undefined, 'normal')
  if (enc.direccionEnvio) {
    pdf.text(enc.direccionEnvio, margen + 90, y, { maxWidth: anchoUtil - 90 })
  } else {
    pdf.line(margen + 90, y + 1, margen + anchoUtil, y + 1)
  }
  return y + 12
}

/** Dibuja UNA orden de trabajo completa (encabezado + tabla + resumen +
 *  firmas) a partir de la pagina activa. */
function dibujarOrden(pdf, { capturas, enc, operador, fecha, margen, anchoUtil, paginaAlto }) {
  let y = dibujarEncabezado(pdf, { enc, margen, anchoUtil })
  // Alto que hay que reservar arriba de las hojas siguientes de esta misma
  // orden, para que la tabla no se encime con el encabezado repetido.
  const altoEncabezado = y - margen
  let esPrimeraHojaDeLaOrden = true

  // ---- Tabla principal: mismas columnas que la hoja fisica ----
  const columnas = [
    'FOLIO', 'PESO', 'Codigo', 'Descripcion', 'Modelo', 'Talla', 'Color',
    'Referencia', 'Linea', 'Cant. Docenas', 'Unidad', 'UPC'
  ]
  const filas = capturas.map((c) => {
    const p = c.producto || {}
    const docenas = p.docenas ?? p.total ?? null
    return [
      String(c.folio),
      (c.pesoGramos / 1000).toFixed(2),
      celda(p.codigo),
      celda(p.descripcion),
      celda(p.modelo),
      celda(p.talla),
      celda(p.color),
      celda(p.referencia),
      celda(p.linea),
      celda(docenas),
      docenas === null ? NA : 'DOCENAS',
      NA // UPC: no existe en el Excel del dia ni en el catalogo
    ]
  })
  const totalDocenas = capturas.reduce((acc, c) => {
    const d = c.producto?.docenas ?? c.producto?.total
    return acc + (typeof d === 'number' ? d : 0)
  }, 0)

  autoTable(pdf, {
    startY: y,
    // top reserva el espacio del encabezado repetido en las hojas 2+ de esta
    // misma orden (lo dibuja didDrawPage).
    margin: { left: margen, right: margen, top: margen + altoEncabezado },
    didDrawPage: () => {
      // La primera hoja de la orden ya trae el encabezado dibujado arriba;
      // de la segunda en adelante hay que repetirlo (bandera propia en vez
      // de datos.pageNumber, que cuenta paginas del documento y no de esta
      // tabla).
      if (esPrimeraHojaDeLaOrden) {
        esPrimeraHojaDeLaOrden = false
        return
      }
      dibujarEncabezado(pdf, { enc, margen, anchoUtil })
    },
    head: [columnas],
    body: filas,
    foot: [[
      { content: `${capturas.length}`, styles: { fontStyle: 'bold' } },
      { content: 'BULTOS', colSpan: 7, styles: { fontStyle: 'bold' } },
      { content: 'TOTAL GENERAL', styles: { fontStyle: 'bold' } },
      { content: totalDocenas > 0 ? String(totalDocenas) : NA, colSpan: 3 }
    ]],
    showFoot: 'lastPage',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 245, 245], textColor: 20 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 45 },
      2: { cellWidth: 50 },
      3: { cellWidth: 147 },
      4: { cellWidth: 55 },
      5: { cellWidth: 45 },
      6: { cellWidth: 50 },
      7: { cellWidth: 60 },
      // 'Linea' necesita ~70pt: con menos, valores como "SIMPLY BASIC" se
      // parten en dos renglones y CADA fila de la tabla crece al doble, que
      // con 20+ folios es media hoja desperdiciada.
      8: { cellWidth: 75 },
      9: { cellWidth: 60 },
      10: { cellWidth: 50 },
      11: { cellWidth: 55 }
    }
  })

  y = pdf.lastAutoTable.finalY + 14

  // ---- Resumen por codigo: suma de docenas de las capturas de cada codigo.
  // "Piezas" = docenas x 12 (confirmado por Roberto el 2026-07-27).
  const porCodigo = new Map()
  capturas.forEach((c) => {
    const codigo = c.producto?.codigo || 'SIN CODIGO'
    const d = c.producto?.docenas ?? c.producto?.total
    const acumulado = porCodigo.get(codigo) || { docenas: 0, conDocenas: false }
    if (typeof d === 'number') {
      acumulado.docenas += d
      acumulado.conDocenas = true
    }
    porCodigo.set(codigo, acumulado)
  })
  const filasResumen = Array.from(porCodigo.entries()).map(([codigo, acc]) => [
    codigo,
    acc.conDocenas ? String(acc.docenas) : NA,
    acc.conDocenas ? String(acc.docenas * 12) : NA
  ])

  // El resto (resumen + observaciones + firmas) necesita unos 220pt mas lo
  // que crezca el resumen por codigo. Si no alcanza el espacio en la pagina
  // donde termino la tabla principal (que con muchas capturas puede
  // paginarse sola), se agrega una pagina nueva en vez de encimar o dejar
  // contenido fuera de la hoja. Si el propio resumen es mas alto que una
  // pagina, autoTable lo pagina solo.
  // Altura REAL de lo que falta, no un numero fijo generoso: la tabla del
  // resumen mide ~13pt por fila (encabezado + N codigos + total) y el bloque
  // de firmas 58pt. Sobreestimarlo mandaba el cierre a una hoja nueva aunque
  // cupiera de sobra en la que ya estaba abierta.
  const altoResumen = 13 * (filasResumen.length + 2)
  const altoFirmas = 58
  const espacioNecesario = Math.min(altoResumen + altoFirmas + 12, paginaAlto - margen * 2)
  if (y + espacioNecesario > paginaAlto - margen) {
    pdf.addPage()
    // La hoja nueva es OTRA hoja de la misma orden: tambien lleva su
    // encabezado con la orden de trabajo arriba.
    y = dibujarEncabezado(pdf, { enc, margen, anchoUtil })
  }

  const paginasAntesDelResumen = pdf.internal.getNumberOfPages()
  // Si el resumen tiene tantos codigos distintos que se pagina solo, sus
  // hojas de continuacion tambien llevan el encabezado de la orden (misma
  // garantia que la tabla principal).
  let esPrimeraHojaDelResumen = true
  autoTable(pdf, {
    startY: y,
    margin: { left: margen, top: margen + altoEncabezado },
    didDrawPage: () => {
      if (esPrimeraHojaDelResumen) {
        esPrimeraHojaDelResumen = false
        return
      }
      dibujarEncabezado(pdf, { enc, margen, anchoUtil })
    },
    tableWidth: 280,
    columnStyles: { 0: { cellWidth: 95 } },
    head: [['Codigo', 'Total por Codigo', 'Piezas']],
    body: filasResumen,
    foot: [['TOTAL GRAL.', totalDocenas > 0 ? String(totalDocenas) : NA, totalDocenas > 0 ? String(totalDocenas * 12) : NA]],
    showFoot: 'lastPage',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' }
  })

  const yResumen = pdf.lastAutoTable.finalY

  // ---- Observaciones, a la par del resumen por codigo ----
  const xObs = margen + 300
  pdf.setFontSize(9)
  pdf.setFont(undefined, 'bold')
  pdf.text('OBSERVACIONES:', xObs, y)
  pdf.setFont(undefined, 'normal')
  if (enc.observaciones) {
    pdf.text(enc.observaciones, xObs + 90, y, { maxWidth: 310 })
  } else {
    pdf.line(xObs + 85, y, xObs + 400, y)
  }

  // ---- Firmas: GENERO / ENTREGA / TRANSPORTE / RECIBE en UNA sola fila.
  // Antes el bloque de quien genera iba aparte (arriba, junto al resumen) y
  // las otras tres abajo: juntarlas ahorra ~60pt de alto por documento, que
  // con muchos folios es media hoja menos.
  // Si el resumen se paginó solo (muchos codigos distintos), 'y' quedo
  // apuntando a la pagina ANTERIOR y compararla con yResumen daria una
  // coordenada de otra hoja: en ese caso manda yResumen a secas.
  const resumenSePagino = pdf.internal.getNumberOfPages() > paginasAntesDelResumen
  let yFirmas = (resumenSePagino ? yResumen : Math.max(yResumen, y + 20)) + 34
  const altoBloqueFirmas = 24
  if (yFirmas + altoBloqueFirmas > paginaAlto - margen) {
    pdf.addPage()
    yFirmas = dibujarEncabezado(pdf, { enc, margen, anchoUtil }) + 30
  }

  const anchoFirma = anchoUtil / 4
  const bloques = [
    // Nombre acotado: uno muy largo envolveria a 2 lineas e invadiria la
    // propia linea de firma.
    ['GENERO', `${String(operador || '-').slice(0, 26)}  ${fecha}`],
    ['ENTREGA', ''],
    ['TRANSPORTE', ''],
    ['RECIBE', '']
  ]
  bloques.forEach(([titulo, valor], i) => {
    const x = margen + anchoFirma * i
    const anchoLinea = anchoFirma - 20
    pdf.setFontSize(9)
    pdf.setFont(undefined, 'bold')
    pdf.text(titulo, x, yFirmas - 16)
    pdf.setFont(undefined, 'normal')
    if (valor) {
      // Quien genera ya viene identificado por el sistema: se imprime encima
      // de la linea y esta solo queda para su firma.
      pdf.setFontSize(8)
      pdf.text(valor, x, yFirmas - 4, { maxWidth: anchoLinea })
    }
    pdf.line(x, yFirmas, x + anchoLinea, yFirmas)
    pdf.setFontSize(7.5)
    pdf.text('Nombre, Firma, Fecha y Hora', x, yFirmas + 10)
  })
}

/** Dispara la descarga de un Blob de PDF en el navegador. */
export function descargarPdf(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreArchivo
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}
