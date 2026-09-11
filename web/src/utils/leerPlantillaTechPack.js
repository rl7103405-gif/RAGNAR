// LEE Y CALIFICA UN TECH PACK HECHO EN LA PLANTILLA TP-QUINI v1.
//
// Fase F3 (lectura) de docs/plan-plantilla-tech-pack-v1.md. Todo se lee por
// NOMBRE DEFINIDO (TP_CLIENTE, TP_TABLA_AVIOS, FOTO_BOLSA...), nunca por
// coordenada suelta ni por resultado de formula. Si al archivo le falta una
// hoja o un nombre, se dice ("plantilla danada"); no se adivina.
//
// Roberto, 2026-09-11: los 120 tech packs viejos se reemplazan por su version
// en la plantilla, asi que el "% hecho" y "Avios que necesita" tienen que
// entender este formato. La calificacion usa los MISMOS siete apartados de
// Lety (RUBROS_TECH_PACK), con el mismo peso, pero revisa el dato y no solo
// que la hoja exista.
//
// Funcion pura sobre un Workbook de ExcelJS ya abierto.
import { CAMPOS, HOJAS, ORDEN_HOJAS, PLANTILLA, TABLAS, ZONAS_FOTO, BANDA, rangoAIndices } from './plantillaTechPack.js'
import { normalizarClaveAvio, valorPlano } from './aviosTechPack.js'
import { RUBROS_TECH_PACK } from './completadoTechPack.js'

const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = String(v ?? '').replace(/,/g, '').trim()
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}
const colNum = (s) => [...s].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0)

/** ¿Este libro es de la plantilla? (hoja _RAGNAR con plantilla = TP-QUINI) */
export function esPlantilla(libro) {
  const h = libro?.getWorksheet?.(HOJAS.ragnar)
  return Boolean(h) && String(valorPlano(h.getCell('B1').value) ?? '').trim() === PLANTILLA.id
}

/** "'1 PEDIDO'!$A$10:$J$30" -> { hoja, c1, f1, c2, f2 } (base 1) */
function parsearRango(ref) {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref || '').trim())
  if (!m) return null
  const hoja = (m[1] ?? m[2]).replace(/''/g, "'")
  const r = rangoAIndices(`${m[3]}${m[4]}:${m[5] || m[3]}${m[6] || m[4]}`)
  return r ? { hoja, ...r } : null
}

/**
 * @returns {{ faltaEstructura: string[], campos: object, tablas: object, fotos: object }}
 *   tablas: { NOMBRE: [ {clave: valor} ... ] } con TODOS los renglones del
 *   rango (tambien vacios), en orden: la posicion importa (hoja 1 <-> hoja 2).
 */
export function leerPlantilla(libro) {
  const faltaEstructura = []
  for (const k of ORDEN_HOJAS) if (!libro.getWorksheet(HOJAS[k])) faltaEstructura.push(`hoja ${HOJAS[k]}`)
  const nombres = new Map()
  for (const d of libro.definedNames?.model || []) if (d?.name && d.ranges?.[0]) nombres.set(d.name, d.ranges[0])
  for (const n of [...Object.keys(CAMPOS), ...Object.keys(TABLAS), ...Object.keys(ZONAS_FOTO)]) {
    if (!nombres.has(n)) faltaEstructura.push(`nombre ${n}`)
  }

  const leerCelda = (hoja, fila, col) => {
    const v = hoja.getRow(fila).getCell(col).value
    // Una formula NO es dato (la plantilla solo las usa para mostrar).
    if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return null
    const x = valorPlano(v)
    return typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x
  }

  const campos = {}
  for (const [n, def] of Object.entries(CAMPOS)) {
    if (def.tipo === 'formula') continue
    const r = parsearRango(nombres.get(n))
    const h = r && libro.getWorksheet(r.hoja)
    campos[n] = h ? leerCelda(h, r.f1, r.c1) : null
  }

  const tablas = {}
  for (const [n, def] of Object.entries(TABLAS)) {
    const r = parsearRango(nombres.get(n))
    const h = r && libro.getWorksheet(r.hoja)
    if (!h) { tablas[n] = []; continue }
    const filas = []
    // El rango incluye el encabezado (primera fila): se salta.
    for (let f = r.f1 + 1; f <= r.f2; f++) {
      const renglon = {}
      for (const c of def.columnas) {
        if (c.tipo === 'formula' || c.tipo === 'imagen') continue
        renglon[c.clave] = leerCelda(h, f, colNum(c.col))
      }
      filas.push(renglon)
    }
    tablas[n] = filas
  }

  // Imagenes por zona: cuenta si su rectangulo se cruza con la zona. La banda
  // (filas 1-3, logo en A1:B3) nunca cuenta como foto.
  const fotos = {}
  for (const [n, def] of Object.entries(ZONAS_FOTO)) {
    const r = parsearRango(nombres.get(n))
    const h = r && libro.getWorksheet(r.hoja)
    if (!h) { fotos[n] = 0; continue }
    let cuenta = 0
    for (const im of h.getImages?.() || []) {
      const tl = im.range?.tl || {}
      const br = im.range?.br || null
      const f0 = tl.nativeRow ?? Math.floor(tl.row ?? 0)
      const c0 = tl.nativeCol ?? Math.floor(tl.col ?? 0)
      const f1 = br ? br.nativeRow ?? Math.floor(br.row ?? f0) : f0
      const c1 = br ? br.nativeCol ?? Math.floor(br.col ?? c0) : c0
      if (f0 < BANDA.filas && c0 < 2) continue
      const cruza = f0 <= r.f2 - 1 && f1 >= r.f1 - 1 && c0 <= r.c2 - 1 && c1 >= r.c1 - 1
      if (cruza) cuenta++
    }
    fotos[n] = cuenta
  }

  return { faltaEstructura, campos, tablas, fotos }
}

/**
 * La calificacion v2: los siete apartados de Lety, cada uno se cumple solo si
 * pasan TODAS sus comprobaciones. Devuelve la misma forma que `medicion` v1
 * ({porcentaje, calificacion, tiene, faltan}) mas el detalle de que falta.
 */
export function medirPlantilla(l) {
  const c = l.campos || {}
  const falta = Object.fromEntries(RUBROS_TECH_PACK.map((r) => [r.id, []]))

  // --- pedido
  for (const n of ['TP_CLIENTE', 'TP_MARCA', 'TP_MODELO', 'TP_PRENDA', 'TP_TEJIDO', 'TP_FECHA', 'TP_ELABORO', 'TP_OC']) {
    if (!lleno(c[n])) falta.pedido.push(CAMPOS[n].etiqueta)
  }
  if (!(num(c.TP_PACK) > 0)) falta.pedido.push('Pares por pack')
  if (!(num(c.TP_PACKS) > 0)) falta.pedido.push('Packs del pedido')
  const pedRaw = l.tablas?.TP_TABLA_PEDIDO || []
  const ped = pedRaw.map((r, i) => ({ ...r, i })).filter((r) => lleno(r.codigo) || lleno(r.ot) || lleno(r.claveMicrosip) || lleno(r.docenas))
  const completos = ped.filter((r) => lleno(r.ot) && lleno(r.claveMicrosip) && num(r.docenas) > 0)
  if (!completos.length) falta.pedido.push('al menos un codigo con OT, clave Microsip y docenas')
  else if (completos.length < ped.length) falta.pedido.push(`${ped.length - completos.length} renglon(es) del pedido incompletos`)

  // --- codigos y ruta (hoja 2): cada codigo del pedido con su color de cuerpo
  const codRaw = l.tablas?.TP_TABLA_CODIGOS || []
  const conCodigo = ped.filter((r) => lleno(r.codigo))
  if (!conCodigo.length) falta.ruta.push('la tabla del pedido no trae codigos internos')
  const sinColor = conCodigo.filter((r) => !lleno(codRaw[r.i]?.colorCuerpo))
  if (sinColor.length) falta.ruta.push(`${sinColor.length} codigo(s) sin color de cuerpo`)
  const procesos = Object.values((l.tablas?.TP_RUTA || [])[0] || {}).filter(lleno)
  if (!procesos.length) falta.ruta.push('ruta de proceso')

  // --- avios (hoja 3)
  const avios = (l.tablas?.TP_TABLA_AVIOS || []).filter((r) => lleno(r.clave) || lleno(r.descripcion) || lleno(r.usa))
  if (!avios.length) falta.etiquetas.push('ningun avio')
  const sinClave = avios.filter((r) => !normalizarClaveAvio(r.clave)).length
  if (sinClave) falta.etiquetas.push(`${sinClave} avio(s) sin clave`)
  const sinUsa = avios.filter((r) => normalizarClaveAvio(r.clave) && !(num(r.usa) >= 0)).length
  if (sinUsa) falta.etiquetas.push(`${sinUsa} avio(s) sin USA por pack`)

  // --- empaque
  const f = l.fotos || {}
  if (!lleno(c.TP_INDIVIDUAL_TEXTO) && !(f.FOTO_INDIVIDUAL > 0)) falta.individual.push('instrucciones o foto de como se arma el par')
  if (!(num(c.TP_PACKS_POR_BOLSA) > 0)) falta.bolsa.push('packs por bolsa')
  if (!(f.FOTO_BOLSA > 0)) falta.bolsa.push('foto de la bolsa')
  if (!(num(c.TP_DOCENAS_POR_CAJA) > 0)) falta.caja.push('docenas por caja')
  if (!(f.FOTO_CAJA > 0)) falta.caja.push('foto de la caja')

  // --- fotos: las cuatro zonas
  for (const z of Object.keys(ZONAS_FOTO)) if (!(f[z] > 0)) falta.fotos.push(ZONAS_FOTO[z].etiqueta)

  const ids = RUBROS_TECH_PACK.map((r) => r.id)
  const tiene = ids.filter((id) => !falta[id].length)
  const porcentaje = Math.round((tiene.length / ids.length) * 100)
  return {
    porcentaje,
    calificacion: Math.round(porcentaje) / 10,
    tiene,
    faltan: ids.filter((id) => falta[id].length),
    detalle: falta,
    plantillaDanada: (l.faltaEstructura || []).length > 0,
    faltaEstructura: (l.faltaEstructura || []).slice(0, 20)
  }
}

/**
 * Los avios de la hoja 3 con la MISMA forma que aviosDelTechPack (para
 * necesidadDeAvios y el boton "Avios que necesita").
 */
export function aviosDesdePlantilla(l) {
  const c = l.campos || {}
  const avisos = []
  const pack = num(c.TP_PACK)
  const packs = num(c.TP_PACKS)
  const avios = []
  let sinClave = 0
  for (const r of (l.tablas?.TP_TABLA_AVIOS || []).filter((x) => lleno(x.clave) || lleno(x.descripcion) || lleno(x.usa))) {
    const clave = normalizarClaveAvio(r.clave)
    if (!clave) {
      sinClave++
      avisos.push(`"${r.descripcion || 'renglon'}" no trae clave valida: no se puede cruzar con el inventario.`)
      continue
    }
    let usa = num(r.usa)
    if (usa == null) avisos.push(`${clave}: USA POR PACK no trae numero.`)
    else if (usa < 0) { avisos.push(`${clave}: USA POR PACK es negativo (${usa}).`); usa = null }
    avios.push({ clave, descripcion: String(r.descripcion || ''), cantidadTexto: String(r.comoSeUsa || ''), usaPorPack: usa, enviar: null })
  }
  const docenas = pack > 0 && packs > 0 ? (pack * packs) / 12 : null
  let cuadra = pack > 0 && packs > 0
  if (!cuadra) avisos.push('En la hoja 1 faltan los pares por pack o los packs del pedido: no se puede comprobar el pedido.')
  const docTabla = (l.tablas?.TP_TABLA_PEDIDO || []).reduce((a, r) => a + (num(r.docenas) || 0), 0)
  if (cuadra && docTabla > 0 && Math.abs(docTabla - docenas) > 0.5) {
    cuadra = false
    avisos.push(`No cuadra: ${packs} packs x ${pack} pares = ${docenas} docenas, y la tabla del pedido suma ${docTabla}.`)
  }
  if (!avios.length) avisos.push('La hoja 3 AVIOS no trae ningun avio con clave.')
  if ((l.faltaEstructura || []).length) {
    cuadra = false
    avisos.push(`Plantilla danada: falta ${l.faltaEstructura.slice(0, 5).join(', ')}.`)
  }
  return { paresPorPack: pack > 0 ? pack : null, packs: packs > 0 ? packs : null, docenas, avios, avisos, sinClave, cuadra }
}
