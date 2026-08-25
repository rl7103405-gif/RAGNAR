// EL EXCEL DE LA ORDEN DE COMPRA: el papel con el que trabaja direccion.
//
// Lo pidio el papa de Roberto el 2026-08-24: poder bajar del Historial una
// orden de compra -- o varias marcadas -- y que salga "identico" al que lleva
// Cielo a mano, `OC_2249 Chedraui 13AGO26.xlsx`. Ese archivo tiene dos hojas y
// aqui se reproducen sus encabezados EXACTOS, en el mismo orden, para que
// quien lleva anos leyendolo no tenga que aprenderse otro:
//
//   CONCENTRADO  un renglon por pedido+codigo: cuanto piden, cuanto se tejio,
//                cuanto se envio y cuanto falta.
//   ENVIOS       el detalle folio por folio de lo que ya se capturo.
//
// ⚠️ LO QUE NO SE INVENTA. El archivo de Cielo trae columnas que RAGNAR no
// tiene de donde sacar (el status que ella teclea, el reparto del primer
// parcial, la remision y el maquilero de cada folio). Se dejan VACIAS, no en
// cero: un cero dice "no hay", y aqui la verdad es "no lo se". Van explicadas
// en la hoja de portada para que nadie las lea como un dato de la app.
import { cargarWorkbook } from './excelJs.js'
import { esEnDocenas } from './arbolOrdenes'
import { datosDeCodigos } from './datosDelCatalogo'

/** Las columnas del CONCENTRADO de Cielo, en su orden y con su ortografia. */
const COLUMNAS_CONCENTRADO = [
  'NoPedido', 'Código', 'NumPedido', 'MAQUILA', 'ARTICULO', 'No.', 'COLOR2', 'TALLA2',
  'FALTA', 'SOLICITA', 'TEJIDS', 'SOBRAN', '% tejido', 'DOC. A ENVIAR 1ER PARCIL',
  'DOC. ENVIADAS', 'DOC. X ENVIO', 'STATUS', '% enviado a maquila', 'AVISO RAGNAR'
]

/**
 * Un porcentaje como FRACCION (0.31), no como numero (31).
 *
 * Excel formatea la fraccion con el estilo de porcentaje, y asi la celda se
 * puede sumar, promediar y graficar como porcentaje de verdad. Escribir 31
 * con formato '0%' pintaria "3100%".
 *
 * null (no 0) cuando no hay meta contra la cual medir: sin SOLICITA no se
 * sabe si 230 docenas son el 10% o el 100%.
 */
function fraccion(parte, total) {
  if (typeof total !== 'number' || total <= 0) return null
  return Math.min(1, (Number(parte) || 0) / total)
}

/** Las columnas de ENVIOS, igual. */
const COLUMNAS_ENVIOS = [
  'FOLIO', 'PESO', 'Código', 'Descripción', 'Modelo', 'Color', 'DOCENAS', 'UNIDAD',
  'UPC', 'OT', 'REMISION', 'MAQUILERO', 'FECHA'
]

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(2)) : null)

const fecha = (t) => {
  const d = t?.toDate ? t.toDate() : t instanceof Date ? t : null
  return d ? d.toLocaleDateString('es-MX') : ''
}

/**
 * Lo que ya salio a maquila de un renglon, en DOCENAS.
 *
 * Solo cuenta lo encargado en docenas, por lo mismo que el arbol: un pack no
 * se convierte a docenas sin saber cuantos pares trae, y esta columna se llama
 * "DOC. ENVIADAS". Meter packs aqui seria escribir packs en una casilla que
 * dice docenas.
 */
function docenasEnviadas(linea) {
  return (linea.enviado || [])
    .filter((e) => esEnDocenas(e.unidad))
    .reduce((a, e) => a + e.cantidad, 0)
}

/** Si algo del renglon salio en otra unidad, se dice cual y cuanto. */
function enviadoSinMedir(linea) {
  const otras = (linea.enviado || []).filter((e) => !esEnDocenas(e.unidad))
  return otras.length ? otras.map((e) => `${e.cantidad} ${e.unidad}`).join(' + ') : ''
}

/**
 * Arma el .xlsx de una o varias ordenes de compra y lo devuelve como Blob.
 *
 * ordenes: [{ oc, destino, arbol }] donde `arbol` es lo que devuelve
 * armarArbolDeOc (trae `ramas` con sus lineas ya cruzadas y `bultos` con su
 * OT resuelta).
 *
 * Con UNA orden salen las dos hojas tal cual. Con VARIAS se concatenan en las
 * mismas dos hojas con una columna 'OC' al frente, porque tener 14 pares de
 * hojas es peor que tener dos: nadie compara entre pestañas.
 */
export async function generarExcelOrdenCompra(ordenes, fallaron = []) {
  // El plan maestro NO trae modelo, color ni talla (solo oc, ot, codigo,
  // cantidad y destino): esas tres columnas salian SIEMPRE vacias y quien
  // abriera el archivo las leeria como "este codigo no tiene modelo". El
  // catalogo si las sabe, y es la misma fuente que ya usan las tareas de
  // ensamble y la pantalla de precios. Nunca lanza: si el catalogo no
  // responde, las columnas van vacias y la portada ya avisa.
  const codigos = ordenes.flatMap((o) =>
    o.arbol.ramas.flatMap((r) => r.lineas.map((l) => l.codigo).filter(Boolean))
  )
  const catalogo = await datosDeCodigos(codigos)

  const Workbook = await cargarWorkbook()
  const libro = new Workbook()
  libro.creator = 'RAGNAR - Deportivos Quini'
  libro.created = new Date()

  const varias = ordenes.length > 1

  // ---- Portada: que es esto y que columnas NO trae la app ----
  const portada = libro.addWorksheet('LEEME')
  portada.addRow(['Ordenes de compra exportadas de RAGNAR'])
  portada.getRow(1).font = { bold: true, size: 14 }
  portada.addRow(['Generado', new Date().toLocaleString('es-MX')])
  portada.addRow(['Ordenes', ordenes.map((o) => o.oc).join(', ')])
  // Las que no se pudieron armar van EN EL ARCHIVO, no solo en un aviso de
  // pantalla que se cierra: quien abra esto manana tiene que poder ver que
  // faltan y cuales.
  if (fallaron.length) {
    portada.addRow([])
    portada.addRow([`ATENCION: ${fallaron.length} orden(es) NO se pudieron armar y NO estan aqui:`])
    portada.getRow(portada.rowCount).font = { bold: true, color: { argb: 'FFB45309' } }
    fallaron.forEach((f) => portada.addRow(['', f]))
  }
  portada.addRow([])
  portada.addRow(['Columnas que RAGNAR todavia NO puede llenar (salen vacias, no en cero):'])
  portada.getRow(portada.rowCount).font = { bold: true }
  ;[
    ['DOC. A ENVIAR 1ER PARCIL', 'El reparto del primer parcial lo decide una persona; la app no lo sabe.'],
    ['STATUS', 'Lo teclea Cielo a mano ("OK MAQUILA"). No hay campo equivalente.'],
    ['MAQUILA (en CONCENTRADO)', 'Sale de la tarea de ensamble cuando el codigo ya se encargo; si no, va vacia.'],
    ['REMISION y MAQUILERO (en ENVIOS)', 'Se llenan cuando el folio ya salio en una remision.'],
    ['SOBRAN', 'Se calcula como lo tejido menos lo que pide el plan, solo si el plan trae cantidad.'],
    ['DOCENAS (en ENVIOS)', 'Si el folio se capturo sin docenas, la celda va vacia. Vacia NO es cero.']
  ].forEach((f) => portada.addRow(f))
  portada.addRow([])
  portada.addRow(['SOLICITA sale del plan maestro que sube Adrian. Si una orden no trae cantidades,'])
  portada.addRow(['esa columna va vacia y las que dependen de ella tambien.'])
  portada.getColumn(1).width = 34
  portada.getColumn(2).width = 78

  // ---- CONCENTRADO ----
  const conc = libro.addWorksheet('CONCENTRADO')
  const encConc = varias ? ['OC', ...COLUMNAS_CONCENTRADO] : COLUMNAS_CONCENTRADO
  conc.addRow(encConc)
  conc.getRow(1).font = { bold: true }
  conc.views = [{ state: 'frozen', ySplit: 1 }]

  for (const orden of ordenes) {
    for (const rama of orden.arbol.ramas) {
      for (const l of rama.lineas) {
        const cat = catalogo.get(String(l.codigo || '').trim()) || {}
        const modelo = l.modelo || cat.modelo || ''
        const color = l.color || cat.color || ''
        const talla = l.talla || cat.talla || ''
        const articulo = l.descripcion || cat.descripcion || ''
        const solicita = typeof l.cantidadPlaneada === 'number' ? l.cantidadPlaneada : null
        const tejido = num(l.producido || 0)
        const enviadas = num(docenasEnviadas(l))
        const fila = [
          // NoPedido: Cielo lo arma como OT_MODELO_TALLA_ARTICULO. Se replica
          // con lo que hay, saltando lo que falte en vez de dejar guiones
          // sueltos que ensucian el filtro.
          [rama.ot, modelo, talla, articulo].filter(Boolean).join('_'),
          l.codigo || '',
          rama.ot || '',
          (l.enviado || []).flatMap((e) => e.maquilas).join(', '),
          articulo,
          modelo,
          color,
          talla,
          solicita !== null ? Math.max(0, solicita - (l.producido || 0)) : null, // FALTA (por tejer)
          solicita,
          tejido,
          solicita !== null ? num(Math.max(0, (l.producido || 0) - solicita)) : null, // SOBRAN
          // % tejido: lo que se lleva capturado contra lo que pide el plan.
          // Lo pidio el papa de Roberto el 25-08, escribiendo el encabezado a
          // mano en el archivo que bajo de la app.
          fraccion(l.producido, solicita),
          null, // DOC. A ENVIAR 1ER PARCIL: lo decide una persona
          // 0 aqui SI es un dato: se sabe que no se ha mandado nada en
          // docenas. Lo que va vacio es cuando lo unico enviado fue en packs
          // (no se puede medir), y eso ya lo dice AVISO RAGNAR.
          enviadoSinMedir(l) && !enviadas ? null : enviadas ?? 0,
          solicita !== null ? num(Math.max(0, solicita - (enviadas || 0))) : null, // DOC. X ENVIO
          // STATUS se queda VACIA siempre: es la que teclea Cielo a mano y la
          // portada lo promete. Escribir aqui un aviso de la app haria que ese
          // texto se leyera como si fuera su status.
          '',
          // % enviado a maquila. Solo cuenta lo encargado en DOCENAS, igual
          // que la columna DOC. ENVIADAS de la que sale: un renglon pedido en
          // packs no se puede medir contra las docenas del plan, y va en null
          // (no en 0) para no decir que no se ha mandado nada.
          enviadoSinMedir(l) && !enviadas ? null : fraccion(enviadas, solicita),
          enviadoSinMedir(l) ? `enviado ${enviadoSinMedir(l)} (no se puede pasar a docenas)` : ''
        ]
        conc.addRow(varias ? [orden.oc, ...fila] : fila)
      }
    }
  }
  encConc.forEach((enc, i) => {
    const col = conc.getColumn(i + 1)
    col.width = i === 0 ? 26 : 15
    // Las columnas de porcentaje llevan formato de porcentaje: la celda
    // guarda 0.31 y Excel la muestra "31%", que es lo que se puede promediar
    // y graficar. Sin el formato se veria un 0.31 sin sentido.
    if (String(enc).startsWith('%')) col.numFmt = '0%'
  })

  // ---- ENVIOS ----
  const env = libro.addWorksheet('ENVIOS')
  const encEnv = varias ? ['OC', ...COLUMNAS_ENVIOS] : COLUMNAS_ENVIOS
  env.addRow(encEnv)
  env.getRow(1).font = { bold: true }
  env.views = [{ state: 'frozen', ySplit: 1 }]

  for (const orden of ordenes) {
    const bultos = [...(orden.arbol.bultos || [])].sort((a, b) =>
      String(a.folio).localeCompare(String(b.folio), 'es', { numeric: true })
    )
    for (const b of bultos) {
      const p = b.producto || {}
      // ⚠️ El hueco NO es cero. Un bulto capturado sin dato de docenas deja
      // 'docenas' en null (cruceProducto), y escribir 0 aqui diria "se
      // capturaron cero", que es otra cosa. Mismo criterio que el PDF, que
      // en ese caso imprime NA en vez de un numero.
      const docenas = typeof p.docenas === 'number' ? p.docenas
        : typeof p.total === 'number' ? p.total
        : null
      const fila = [
        b.folio || '',
        num((b.pesoGramos || 0) / 1000),
        p.codigo || '',
        p.descripcion || '',
        p.modelo || '',
        p.color || '',
        docenas === null ? '' : num(docenas),
        docenas === null ? '' : 'DOCENAS',
        // UPC: en el archivo de Cielo esta columna repite el modelo, no un
        // codigo de barras. Se replica tal cual para no cambiarle el
        // significado a una columna que ella ya usa.
        p.modelo || '',
        b.otResuelta || '',
        '', // REMISION: se llena cuando el folio salga en una
        '', // MAQUILERO: idem
        fecha(b.creadoEn)
      ]
      env.addRow(varias ? [orden.oc, ...fila] : fila)
    }
  }
  encEnv.forEach((_, i) => { env.getColumn(i + 1).width = i === 0 ? 12 : 16 })

  const buffer = await libro.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}

/** Nombre del archivo: una OC lleva su numero; varias, cuantas son. */
export function nombreDelExcel(ordenes) {
  const hoy = new Date().toISOString().slice(0, 10)
  if (ordenes.length === 1) return `OC_${String(ordenes[0].oc).replace(/[^\w-]/g, '')}_${hoy}.xlsx`
  return `Ordenes_de_compra_${ordenes.length}_${hoy}.xlsx`
}
