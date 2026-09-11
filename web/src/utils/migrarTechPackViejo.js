// PASA UN TECH PACK VIEJO A LA PLANTILLA TP-QUINI v1 (fase F6 del plan).
//
// Roberto, 2026-09-11: "quiero que todos los tech packs anteriores ya tengan
// este formato, que los ciento veintiuno tengan este formato".
//
// Lee un Excel del formato anterior (INFORMACION DE PEDIDOS, CODIGOS-RUTA DE
// PROCESOS, ETIQUETAS, EMPAQUE...) y devuelve los `datos` que entiende
// generarPlantillaTechPack, MAS un reporte campo por campo: de que celda salio,
// que tan seguro es, y que no cuadra. Es un BORRADOR: el archivo original no
// se toca y Lety confirma (docs/plan-plantilla-tech-pack-v1.md, seccion 6).
//
// Los datos se buscan por su ETIQUETA ("CLIENTE", "PACK", "CLAVE"...), no por
// coordenada: 90 de 101 archivos traen el bloque en las mismas celdas, pero
// los demas vienen corridos y aqui no se adivina la posicion.
//
// Funcion pura sobre un Workbook de ExcelJS ya abierto: no toca Firestore.
import { normalizarClaveAvio, valorPlano } from './aviosTechPack.js'

const norm = (v) =>
  String(valorPlano(v) ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '')
    .trim()
const texto = (v) => {
  const x = valorPlano(v)
  if (x instanceof Date) return x
  return String(x ?? '').replace(/\s+/g, ' ').trim()
}
const numero = (v) => {
  const x = valorPlano(v)
  if (typeof x === 'number' && Number.isFinite(x)) return x
  const t = String(x ?? '').replace(/,/g, '').trim()
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}
const PXC = (w) => Math.round((w || 8.43) * 7 + 5)
const PXR = (h) => Math.round((h || 15) * 96 / 72)
const dir = (hoja, fila, col) => `${hoja.name}!${hoja.getRow(fila).getCell(col).address}`

const ETIQUETAS_BLOQUE = ['CLIENTE', 'MODELO', 'TALLAS', 'PRENDA', 'MARCA', 'TIPO DE TEJIDO', 'FECHA', 'ELABORO']
const PIE = /^(RECIBE Y AUTORIZA|ENTREGA|COPIA DE AUTORIZACION|COPIA DP|COPIAS? PROCESOS)/

/** Primera celda cuyo texto normalizado sea exactamente una de las etiquetas. */
function buscar(hoja, etiquetas, maxFila = 60) {
  const set = new Set(etiquetas.map(norm))
  const tope = Math.min(hoja.rowCount, maxFila)
  for (let f = 1; f <= tope; f++) {
    const fila = hoja.getRow(f)
    for (let c = 1; c <= Math.min(fila.cellCount || 30, 30); c++) {
      if (set.has(norm(fila.getCell(c).value))) return { fila: f, col: c }
    }
  }
  return null
}

/** El dato a la DERECHA de una etiqueta (saltando celdas combinadas que repiten
 *  la etiqueta y sin brincar a la siguiente etiqueta). */
function aLaDerecha(hoja, pos, extra = []) {
  if (!pos) return null
  const fila = hoja.getRow(pos.fila)
  const etiqueta = norm(fila.getCell(pos.col).value)
  const otras = new Set([...ETIQUETAS_BLOQUE, ...extra].map(norm))
  for (let c = pos.col + 1; c <= pos.col + 5; c++) {
    const v = fila.getCell(c).value
    const n = norm(v)
    if (!n || n === etiqueta) continue
    if (otras.has(n)) return null
    return { valor: texto(v), origen: dir(hoja, pos.fila, c) }
  }
  return null
}

/** El dato DEBAJO de un encabezado (misma columna, primera fila con algo). */
function debajo(hoja, pos) {
  if (!pos) return null
  // El encabezado suele venir combinado en dos filas ("DOCENAS POR CODIGO" en
  // I5:I6): la celda de abajo repite el texto y el numero va despues.
  const etiqueta = norm(hoja.getRow(pos.fila).getCell(pos.col).value)
  for (let f = pos.fila + 1; f <= pos.fila + 3; f++) {
    const v = hoja.getRow(f).getCell(pos.col).value
    const n = norm(v)
    if (n && n !== etiqueta) return { valor: valorPlano(v), origen: dir(hoja, f, pos.col) }
  }
  return null
}

/** Encabezado de tabla: la fila que trae TODAS las columnas pedidas. */
function encabezado(hoja, requeridas, opcionales = [], maxFila = 60) {
  const tope = Math.min(hoja.rowCount, maxFila)
  for (let f = 1; f <= tope; f++) {
    const fila = hoja.getRow(f)
    const cols = {}
    for (let c = 1; c <= 30; c++) {
      const n = norm(fila.getCell(c).value)
      if (!n) continue
      for (const nombre of [...requeridas, ...opcionales]) {
        if (cols[nombre] === undefined && n === norm(nombre)) cols[nombre] = c
      }
    }
    if (requeridas.every((r) => cols[r] !== undefined)) return { fila: f, cols }
  }
  return null
}

const clasificarHoja = (nombre) => {
  const n = norm(nombre)
  if (n.startsWith('INFORMACION DE PEDIDO')) return 'informacion'
  if (n.startsWith('CODIGOS')) return 'codigos'
  if (n.startsWith('ETIQUETA')) return 'etiquetas'
  if (n.startsWith('VIRTUAL')) return 'virtual'
  // Hojas de ficha textil / costura / medidas: no son empaque, sus fotos no
  // se meten en las zonas de empaque ("MEDIDAS EN CRUDO Y FINALES" no es caja).
  if (/MEDIDA|DESGLOCE|DESGLOSE|^DESG |MATERIALES|PROVEEDOR|ESPECIFICACION|FICHA|^HOJA ?\d*$/.test(n)) return 'otra'
  if (/BOLSA/.test(n)) return 'bolsa'
  if (/CAJA|EMPAQUE FINAL/.test(n)) return 'caja'
  if (/INDIVIDUAL|ACOMODO|HABILITA|PLASTIFLECHA/.test(n)) return 'individual'
  // Hojas con el nombre del diseno ("CPD32-UN01711", "CIW10 - 513089001"):
  // en el formato viejo son el acomodo del empaque individual.
  if (/\d/.test(n) && n.split(' ').filter((w) => /^[A-Z]{4,}$/.test(w)).length < 2) return 'individual'
  return 'otra'
}

/**
 * @param {object} libro   Workbook de ExcelJS ya cargado (el tech pack viejo)
 * @param {object} [ctx]   { codigo, ocDelPlan, destinoDelPlan } lo que el plan sabe
 * @returns {{ datos: object, reporte: object }}
 */
export function extraerTechPackViejo(libro, ctx = {}) {
  const campos = {}
  const conflictos = []
  const faltantes = []
  const nota = (nombre, valor, origen, confianza = 'alta') => {
    if (valor === null || valor === undefined || valor === '') return
    campos[nombre] = { valor: valor instanceof Date ? valor.toISOString().slice(0, 10) : valor, origen, confianza }
  }

  const hojas = libro.worksheets.map((h) => ({ hoja: h, tipo: clasificarHoja(h.name) }))
  const deTipo = (t) => hojas.filter((x) => x.tipo === t).map((x) => x.hoja)
  const info = deTipo('informacion')[0] || null
  const codigos = deTipo('codigos')[0] || null
  const etiquetasHojas = deTipo('etiquetas')
  if (etiquetasHojas.length > 1) conflictos.push(`trae ${etiquetasHojas.length} hojas de etiquetas (varios modelos en un archivo): se juntaron, revisar`)

  // ------------------------------------------------ bloque de encabezado
  // Se busca en INFORMACION; si no existe, en la primera hoja que lo traiga.
  const conBloque = [info, codigos, ...etiquetasHojas, ...libro.worksheets].filter(Boolean)
  const leerBloque = (etq) => {
    for (const h of conBloque) {
      const r = aLaDerecha(h, buscar(h, [etq], 20))
      if (r && r.valor !== '') return r
    }
    return null
  }
  const cliente = leerBloque('CLIENTE')
  const modelo = leerBloque('MODELO')
  const tallas = leerBloque('TALLAS')
  const prenda = leerBloque('PRENDA')
  const marca = leerBloque('MARCA')
  const tejido = leerBloque('TIPO DE TEJIDO')
  const fecha = leerBloque('FECHA')
  const elaboro = leerBloque('ELABORO')
  nota('TP_CLIENTE', cliente?.valor, cliente?.origen)
  nota('TP_MODELO', modelo?.valor, modelo?.origen)
  nota('TP_SISTEMA_TALLA', tallas?.valor, tallas?.origen, 'media')
  nota('TP_PRENDA', prenda?.valor, prenda?.origen)
  nota('TP_MARCA', marca?.valor, marca?.origen)
  nota('TP_TEJIDO', tejido?.valor, tejido?.origen)
  nota('TP_ELABORO', elaboro?.valor, elaboro?.origen)
  let fechaDate = null
  if (fecha?.valor instanceof Date) fechaDate = fecha.valor
  else if (fecha?.valor) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha.valor))
    const m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(String(fecha.valor))
    if (iso) fechaDate = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12))
    else if (m) fechaDate = new Date(Date.UTC(Number(m[3].length === 2 ? '20' + m[3] : m[3]), Number(m[2]) - 1, Number(m[1]), 12))
  }
  nota('TP_FECHA', fechaDate, fecha?.origen, fechaDate ? 'alta' : 'baja')

  // ------------------------------------------------ cantidades del pedido
  let paresPorPack = null
  let packs = null
  let docenasTotal = null
  let docenasPorCodigo = null
  if (info) {
    const pk = debajo(info, buscar(info, ['PACK'], 20))
    if (pk) {
      const m = /(\d+)/.exec(String(pk.valor))
      paresPorPack = m ? Number(m[1]) : null
      nota('TP_PACK', paresPorPack, pk.origen, typeof pk.valor === 'number' ? 'alta' : 'media')
    }
    const pcs = debajo(info, buscar(info, ['CANTIDAD DE PACKS'], 20))
    if (pcs && numero(pcs.valor) != null) { packs = numero(pcs.valor); nota('TP_PACKS', packs, pcs.origen) }
    const doc = debajo(info, buscar(info, ['TOTAL DE DOCENAS'], 20))
    if (doc && numero(doc.valor) != null) docenasTotal = numero(doc.valor)
    const dpc = debajo(info, buscar(info, ['DOCENAS POR CODIGO'], 20))
    if (dpc && numero(dpc.valor) != null) docenasPorCodigo = numero(dpc.valor)
    if (paresPorPack && packs && docenasTotal && Math.abs((paresPorPack * packs) / 12 - docenasTotal) > 0.5) {
      conflictos.push(`las cifras del pedido no cuadran: ${packs} packs x ${paresPorPack} pares = ${(paresPorPack * packs) / 12} docenas, el archivo dice ${docenasTotal}`)
    }
  } else {
    faltantes.push('hoja INFORMACION DE PEDIDOS (sin pack, packs, OC ni codigos Microsip)')
  }

  // ------------------------------------------------ tabla Microsip
  const microsip = []
  if (info) {
    const cab = encabezado(info, ['PEDIDO', 'OT'], ['CLAVE MICROSIP', 'DESCRIPCION MICROSIP', 'UPC', 'DISENO'])
    if (cab) {
      for (let f = cab.fila + 1; f <= Math.min(info.rowCount, cab.fila + 60); f++) {
        const fila = info.getRow(f)
        const primera = norm(fila.getCell(1).value)
        if (PIE.test(primera)) break
        const ot = texto(fila.getCell(cab.cols.OT).value)
        const clave = cab.cols['CLAVE MICROSIP'] ? texto(fila.getCell(cab.cols['CLAVE MICROSIP']).value) : ''
        const pedido = texto(fila.getCell(cab.cols.PEDIDO).value)
        if (!ot && !clave && !pedido) {
          if (microsip.length) break
          continue
        }
        microsip.push({
          fila: f,
          pedido: String(pedido),
          ot: String(ot).replace(/^OT[_ ]?/i, ''),
          claveMicrosip: String(clave),
          descripcion: cab.cols['DESCRIPCION MICROSIP'] ? String(texto(fila.getCell(cab.cols['DESCRIPCION MICROSIP']).value)) : '',
          upc: cab.cols.UPC ? String(texto(fila.getCell(cab.cols.UPC).value)) : '',
          diseno: cab.cols.DISENO ? String(texto(fila.getCell(cab.cols.DISENO).value)) : ''
        })
      }
    } else faltantes.push('tabla de codigos Microsip (PEDIDO / OT)')
  }

  // ------------------------------------------------ OC: archivo vs etiquetas vs plan
  const ocsArchivo = [...new Set(microsip.map((m) => m.pedido).filter(Boolean))]
  const ocsEtiquetas = []
  for (const h of etiquetasHojas) {
    for (let c = 1; c <= 14; c++) {
      const m = /OC[_ ]?(\d{6,})/i.exec(String(valorPlano(h.getRow(1).getCell(c).value) ?? ''))
      if (m) ocsEtiquetas.push(m[1])
    }
  }
  let oc = ''
  if (ctx.ocDelPlan) {
    oc = String(ctx.ocDelPlan)
    nota('TP_OC', oc, 'plan maestro vigente (por la OT)')
  } else if (ocsArchivo.length === 1) {
    oc = ocsArchivo[0]
    nota('TP_OC', oc, `${info.name}!tabla Microsip`, 'media')
  }
  const todasOc = [...new Set([oc, ...ocsArchivo, ...ocsEtiquetas].filter(Boolean))]
  if (todasOc.length > 1) conflictos.push(`OC distintas: ${[ctx.ocDelPlan ? `plan ${ctx.ocDelPlan}` : '', ocsArchivo.length ? `hoja pedido ${ocsArchivo.join('/')}` : '', ocsEtiquetas.length ? `etiquetas ${ocsEtiquetas.join('/')}` : ''].filter(Boolean).join(' · ')}`)
  if (!oc) faltantes.push('orden de compra')

  // ------------------------------------------------ codigos internos y ruta
  const codigosRuta = []
  let ruta = []
  if (codigos) {
    const cab = encabezado(codigos, ['CODIGO'], ['DESCRIPCION', 'MODELO', 'TALLA', 'COLOR/CUERPO', 'BORDADO', 'COLOR DE HILO/ LECHUGAR', 'COLOR DE HILO/LECHUGA', 'COLOR DE HILO'])
    if (cab) {
      const col = (...nombres) => nombres.map((n) => cab.cols[n]).find((x) => x !== undefined)
      for (let f = cab.fila + 1; f <= Math.min(codigos.rowCount, cab.fila + 60); f++) {
        const fila = codigos.getRow(f)
        const cod = texto(fila.getCell(cab.cols.CODIGO).value)
        const n = norm(cod)
        if (!n) { if (codigosRuta.length) break; continue }
        if (/^RUTA DE PROCESO|^PROCESO 1/.test(n) || PIE.test(n)) break
        const g = (c) => (c ? String(texto(fila.getCell(c).value)) : '')
        codigosRuta.push({
          fila: f,
          codigo: String(cod),
          talla: g(col('TALLA')),
          modelo: g(col('MODELO')),
          descripcion: g(col('DESCRIPCION')),
          colorCuerpo: g(col('COLOR/CUERPO')),
          bordado: g(col('BORDADO')),
          hilo: g(col('COLOR DE HILO/ LECHUGAR', 'COLOR DE HILO/LECHUGA', 'COLOR DE HILO'))
        })
      }
    } else faltantes.push('tabla de codigos internos (CODIGO / COLOR)')
    const pr = buscar(codigos, ['PROCESO 1'], 80)
    if (pr) {
      const fila = codigos.getRow(pr.fila + 1)
      const vistos = []
      for (let c = 1; c <= 14; c++) {
        const n = norm(fila.getCell(c).value)
        if (n && !vistos.includes(n)) vistos.push(n)
      }
      ruta = vistos.slice(0, 7)
      if (ruta.length) nota('TP_RUTA', ruta.join(' > '), `${codigos.name}!fila ${pr.fila + 1}`)
    }
  } else faltantes.push('hoja CODIGOS-RUTA DE PROCESOS')

  // ------------------------------------------------ renglones del pedido
  // El formato viejo NO trae el codigo interno junto a la clave Microsip: la
  // hoja de pedido y la de codigos van en el mismo orden. Se juntan por
  // posicion y, si no traen el mismo numero de renglones, se dice.
  // Primero por MODELO (en archivos de varios modelos, RB10T100/101/103, la
  // clave Microsip o el DISENO dicen de cual es cada renglon); si no, por orden.
  const normM = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const modelosCod = [...new Set(codigosRuta.map((c) => c.modelo).filter(Boolean))]
  if (new Set(modelosCod.map(normM)).size > 1) conflictos.push(`trae ${modelosCod.length} modelos en un archivo (${modelosCod.join(', ')}): en la plantilla nueva va un tech pack por modelo`)
  const usados = new Set()
  let porOrden = 0
  const microsipDe = (i) => {
    const cr = codigosRuta[i]
    if (cr?.modelo) {
      const cand = microsip.map((m, j) => [m, j]).filter(([m]) => normM(m.claveMicrosip) === normM(cr.modelo) || normM(m.diseno) === normM(cr.modelo))
      if (cand.length) {
        const libre = cand.find(([, j]) => !usados.has(j)) || cand[0]
        usados.add(libre[1])
        return libre[0]
      }
    }
    porOrden++
    return microsip[i] || {}
  }
  const n = codigosRuta.length || microsip.length
  const docenasCadaUno = docenasPorCodigo ?? (docenasTotal && n ? docenasTotal / n : null)
  const renglones = []
  for (let i = 0; i < n; i++) {
    const ms = codigosRuta.length ? microsipDe(i) : microsip[i] || {}
    const cr = codigosRuta[i] || {}
    renglones.push({
      talla: cr.talla || (tallas?.valor ? String(tallas.valor) : ''),
      ot: ms.ot || '',
      codigo: cr.codigo || '',
      claveMicrosip: ms.claveMicrosip || '',
      descripcion: ms.descripcion || cr.descripcion || '',
      upc: ms.upc || '',
      docenas: docenasCadaUno != null ? Math.round(docenasCadaUno * 100) / 100 : ''
    })
  }
  if (porOrden && microsip.length && codigosRuta.length && microsip.length !== codigosRuta.length) {
    conflictos.push(`${codigosRuta.length} codigos internos vs ${microsip.length} renglones Microsip: ${porOrden} se juntaron por orden, revisar`)
  }
  if (docenasPorCodigo == null && docenasTotal && n) conflictos.push(`sin DOCENAS POR CODIGO: se repartieron ${docenasTotal} docenas parejo entre ${n} codigos`)

  // ------------------------------------------------ avios (ETIQUETAS)
  const avios = []
  let aviosConUsaDelArchivo = 0
  let aviosUsaInferido = 0
  for (const h of etiquetasHojas) {
    const opcionales = ['DESCRIPCION', 'CANTIDAD', 'TALLA', 'USA']
    const cab = encabezado(h, ['CLAVE'], opcionales) || encabezado(h, ['CODIGO'], opcionales)
    if (!cab) continue
    const colClave = cab.cols.CLAVE ?? cab.cols.CODIGO
    // USA puede venir una fila arriba (formato estandar nuevo de Lety).
    let colUsa = cab.cols.USA
    if (colUsa === undefined) {
      const arriba = h.getRow(cab.fila - 1)
      for (let c = 1; c <= 20; c++) if (norm(arriba.getCell(c).value) === 'USA') colUsa = c
    }
    let vacias = 0
    for (let f = cab.fila + 1; f <= Math.min(h.rowCount, cab.fila + 40); f++) {
      const fila = h.getRow(f)
      const crudaClave = fila.getCell(colClave).value
      const desc = cab.cols.DESCRIPCION ? String(texto(fila.getCell(cab.cols.DESCRIPCION).value)) : ''
      const nClave = norm(crudaClave)
      if (/^SE EMPACAN/.test(nClave) || PIE.test(nClave)) break
      // Subtitulos dentro de la tabla ("EMPAQUE", "ETIQUETAS EXTERNAS"): se sigue.
      if (/^(EMPAQUE|ETIQUETAS (EXTERNAS|INTERNAS))$/.test(nClave) || /^(EMPAQUE|ETIQUETAS (EXTERNAS|INTERNAS))$/.test(norm(desc))) { vacias = 0; continue }
      if (nClave && nClave === norm(desc) && !/\d/.test(nClave)) break
      if (!nClave && !desc) { if (++vacias >= 4) break; continue }
      vacias = 0
      const cantidadTexto = cab.cols.CANTIDAD ? String(texto(fila.getCell(cab.cols.CANTIDAD).value)) : ''
      let usa = colUsa ? numero(fila.getCell(colUsa).value) : null
      let confianza = 'alta'
      if (usa != null) aviosConUsaDelArchivo++
      else {
        // Se infiere de CANTIDAD solo cuando el texto lo dice sin ambiguedad.
        const t = norm(cantidadTexto)
        let m
        if ((m = /^(\d+(?:\.\d+)?)\s*(POR PACK|X PACK)?$/.exec(t))) { usa = Number(m[1]); confianza = 'baja' }
        else if ((m = /^(\d+)\s*(X|POR)\s*(PIEZA|PAR)$/.exec(t)) && paresPorPack) { usa = Number(m[1]) * paresPorPack; confianza = 'baja' }
        else if ((m = /^(\d+)\s*PACKS? (DENTRO DE UNA|EN UNA|POR) BOLSA/.exec(t))) { usa = 1 / Number(m[1]); confianza = 'media' }
        else if ((m = /^(\d+)\s*DOC(ENAS|S)?\s*(X|POR)\s*(BOLSA|CAJA|BULTO)/.exec(t)) && paresPorPack) { usa = paresPorPack / (Number(m[1]) * 12); confianza = 'media' }
        if (usa != null) aviosUsaInferido++
      }
      avios.push({
        clave: normalizarClaveAvio(crudaClave),
        descripcion: desc,
        usa,
        comoSeUsa: cantidadTexto,
        talla: cab.cols.TALLA ? String(texto(fila.getCell(cab.cols.TALLA).value)) : '',
        confianza,
        origen: dir(h, f, colClave),
        filaExcel: f,
        hoja: h.name
      })
    }
  }
  if (!etiquetasHojas.length) faltantes.push('hoja ETIQUETAS (avios)')
  const sinClave = avios.filter((a) => !a.clave).length
  if (sinClave) conflictos.push(`${sinClave} avio(s) sin clave: hay que ponersela`)
  const sinUsa = avios.filter((a) => a.usa == null).length
  if (sinUsa) conflictos.push(`${sinUsa} avio(s) sin USA por pack: hay que capturarlo`)
  if (aviosUsaInferido) conflictos.push(`${aviosUsaInferido} avio(s) con USA sacado del texto de CANTIDAD: confirmar`)

  // ------------------------------------------------ textos de empaque
  const textoDeHojas = (tipo) => {
    const vistos = []
    for (const h of deTipo(tipo)) {
      for (let f = 7; f <= Math.min(h.rowCount, 60); f++) {
        const fila = h.getRow(f)
        for (let c = 1; c <= 12; c++) {
          const t = String(texto(fila.getCell(c).value))
          const nn = norm(t)
          if (!nn || nn.length < 6 || PIE.test(nn)) continue
          if (/^(EMPAQUE|COLOCACION DE PLASTIFLECHAS$|ACOMODO|HABILITADO$)/.test(nn) && nn.split(' ').length <= 4) continue
          if (ETIQUETAS_BLOQUE.includes(nn)) continue
          if (!vistos.some((v) => norm(v) === nn)) vistos.push(t)
        }
      }
    }
    return vistos.join(' · ').slice(0, 900)
  }
  const textos = { individual: textoDeHojas('individual'), bolsa: textoDeHojas('bolsa'), caja: textoDeHojas('caja') }
  const buscaNum = (re, ...fuentes) => { for (const f of fuentes) { const m = re.exec(norm(f)); if (m) return Number(m[1]) } return null }
  const packsPorBolsa = buscaNum(/(\d+)\s*PACKS?\s*(EN|DENTRO|POR|X)\b/, textos.bolsa, ...avios.map((a) => a.comoSeUsa))
  const docenasPorCaja = buscaNum(/(\d+)\s*DOC/, textos.caja)
  nota('TP_PACKS_POR_BOLSA', packsPorBolsa, 'texto de empaque en bolsa / etiquetas', 'media')
  nota('TP_DOCENAS_POR_CAJA', docenasPorCaja, 'texto de empaque de caja', 'media')
  if (!packsPorBolsa) faltantes.push('packs por bolsa')
  if (!docenasPorCaja) faltantes.push('docenas por caja')

  // ------------------------------------------------ fotos por zona
  // El logo viejo va arriba a la derecha (fila 0-1, columna 7 o mas): no es foto.
  const fotos = { FOTO_REFERENCIA: [], FOTO_INDIVIDUAL: [], FOTO_BOLSA: [], FOTO_CAJA: [] }
  let logosSaltados = 0
  let fotosSaltadas = 0
  // Caja de la imagen en pixeles de SU hoja original: asi se respeta el
  // acomodo que Lety hizo (pasos 1-2-3-4, frente/atras) y su proporcion.
  const cajaPx = (hoja, im) => {
    const tl = im.range?.tl
    const br = im.range?.br
    const ext = im.range?.ext
    if (!tl) return null
    const colW = (c) => PXC(hoja.getColumn(c + 1).width)
    const rowH = (r) => PXR(hoja.getRow(r + 1).height)
    const posX = (col) => { const ci = Math.floor(col); let x = 0; for (let c = 0; c < ci; c++) x += colW(c); return x + (col - ci) * colW(ci) }
    const posY = (row) => { const ri = Math.floor(row); let y = 0; for (let r = 0; r < ri; r++) y += rowH(r); return y + (row - ri) * rowH(ri) }
    const x = posX(tl.col ?? tl.nativeCol ?? 0)
    const y = posY(tl.row ?? tl.nativeRow ?? 0)
    let w = 0
    let h = 0
    if (br) { w = posX(br.col ?? br.nativeCol) - x; h = posY(br.row ?? br.nativeRow) - y } else if (ext) { w = ext.width; h = ext.height }
    return w > 2 && h > 2 ? { x, y, w, h } : null
  }
  const media = (id) => {
    const im = libro.getImage(id)
    if (!im) return null
    const ext = String(im.extension || '').toLowerCase()
    const bytes = im.buffer ? new Uint8Array(im.buffer) : null
    return bytes && ['png', 'jpeg', 'jpg', 'gif'].includes(ext) ? { bytes, extension: ext } : null
  }
  for (const { hoja, tipo } of hojas) {
    for (const im of hoja.getImages?.() || []) {
      const tl = im.range?.tl || {}
      const fila0 = tl.nativeRow ?? Math.floor(tl.row ?? 0)
      const col0 = tl.nativeCol ?? Math.floor(tl.col ?? 0)
      if (fila0 <= 1 && col0 >= 6) { logosSaltados++; continue }
      const m0 = media(im.imageId)
      if (!m0) { fotosSaltadas++; continue }
      const m = { ...m0, caja: cajaPx(hoja, im), grupo: hoja.name }
      if (tipo === 'etiquetas') {
        const avio = avios.find((a) => a.hoja === hoja.name && a.filaExcel === fila0 + 1)
        if (avio && !avio.imagen) avio.imagen = m
        else fotosSaltadas++
      } else if (tipo === 'informacion' || tipo === 'virtual') fotos.FOTO_REFERENCIA.push(m)
      else if (tipo === 'individual') fotos.FOTO_INDIVIDUAL.push(m)
      else if (tipo === 'bolsa') fotos.FOTO_BOLSA.push(m)
      else if (tipo === 'caja') fotos.FOTO_CAJA.push(m)
      else fotosSaltadas++ // swatches de codigos-ruta y hojas raras
    }
  }
  for (const [zona, lista] of Object.entries(fotos)) {
    if (lista.length > 40) { conflictos.push(`${zona}: ${lista.length} imagenes, se pusieron 40`); fotos[zona] = lista.slice(0, 40) }
    if (!fotos[zona].length) faltantes.push(`foto en ${zona}`)
  }

  if (!ctx.destinoDelPlan && !cliente) faltantes.push('cliente')

  const datos = {
    oc,
    ot: renglones.find((r) => r.ot)?.ot || '',
    cliente: cliente?.valor || ctx.destinoDelPlan || '',
    marca: marca?.valor || '',
    modelo: modelo?.valor || ctx.codigo || '',
    prenda: prenda?.valor || '',
    tejido: tejido?.valor || '',
    sistemaTalla: tallas?.valor || '',
    elaboro: elaboro?.valor || '',
    fecha: fechaDate,
    paresPorPack: paresPorPack || undefined,
    packs: packs || undefined,
    renglones,
    codigosRuta,
    ruta,
    avios: avios.map(({ clave, descripcion, usa, comoSeUsa, talla, imagen }) => ({ clave, descripcion, usa, comoSeUsa, talla, imagen })),
    textos,
    packsPorBolsa: packsPorBolsa || undefined,
    docenasPorCaja: docenasPorCaja || undefined,
    fotos
  }
  const reporte = {
    campos,
    conflictos,
    faltantes,
    conteo: {
      renglones: renglones.length,
      codigosInternos: codigosRuta.length,
      microsip: microsip.length,
      avios: avios.length,
      aviosConUsaDelArchivo,
      aviosUsaInferido,
      fotos: Object.fromEntries(Object.entries(fotos).map(([k, v]) => [k, v.length])),
      logosSaltados,
      fotosSaltadas,
      hojas: libro.worksheets.map((h) => `${h.name} (${clasificarHoja(h.name)})`)
    }
  }
  return { datos, reporte }
}
