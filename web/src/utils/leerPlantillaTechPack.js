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
import { CAMPOS, HOJAS, ORDEN_HOJAS, PLANTILLA, PEDIDO_V1, TABLAS, ZONAS_FOTO, BANDA, LISTAS, rangoAIndices } from './plantillaTechPack.js'
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
    if (!nombres.has(n)) {
      // Un campo agregado despues (TP_EMBALAJE, 17-sep) no vuelve danadas a las
      // plantillas que se generaron antes: simplemente no traen ese dato.
      if (!CAMPOS[n]?.estructuraOpcional) faltaEstructura.push(`nombre ${n}`)
      continue
    }
    // El nombre existe pero puede apuntar a una hoja borrada o a un rango que
    // no se puede leer: eso tambien es plantilla danada, no un dato ausente
    // (Codex, 17-sep: TP_CLIENTE apuntando a una hoja inexistente se aceptaba
    // con faltaEstructura vacio y el cliente salia null en vez de rechazarse).
    const r = parsearRango(nombres.get(n))
    if (!r || !libro.getWorksheet(r.hoja)) faltaEstructura.push(`nombre ${n}`)
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
  // Ademas se devuelven los imageId por zona y por renglon de avios, para
  // que el visor las pinte en su lugar (VistaPlantillaTechPack).
  const fotos = {}
  const imagenesZona = {}
  for (const [n, def] of Object.entries(ZONAS_FOTO)) {
    const r = parsearRango(nombres.get(n))
    const h = r && libro.getWorksheet(r.hoja)
    if (!h) { fotos[n] = 0; imagenesZona[n] = []; continue }
    let cuenta = 0
    imagenesZona[n] = []
    for (const im of h.getImages?.() || []) {
      const tl = im.range?.tl || {}
      const br = im.range?.br || null
      const f0 = tl.nativeRow ?? Math.floor(tl.row ?? 0)
      const c0 = tl.nativeCol ?? Math.floor(tl.col ?? 0)
      const f1 = br ? br.nativeRow ?? Math.floor(br.row ?? f0) : f0
      const c1 = br ? br.nativeCol ?? Math.floor(br.col ?? c0) : c0
      if (f0 < BANDA.filas && c0 < 2) continue
      const cruza = f0 <= r.f2 - 1 && f1 >= r.f1 - 1 && c0 <= r.c2 - 1 && c1 >= r.c1 - 1
      if (cruza) { cuenta++; imagenesZona[n].push({ imageId: im.imageId, x: tl.col ?? c0, y: tl.row ?? f0 }) }
    }
    imagenesZona[n].sort((a, b) => a.y - b.y || a.x - b.x)
    fotos[n] = cuenta
  }
  // La imagen de cada avio: la anclada en la fila de ese renglon (columna J).
  const imagenesAvios = {}
  {
    const r = parsearRango(nombres.get('TP_TABLA_AVIOS'))
    const h = r && libro.getWorksheet(r.hoja)
    if (h) {
      for (const im of h.getImages?.() || []) {
        const tl = im.range?.tl || {}
        const f0 = (tl.nativeRow ?? Math.floor(tl.row ?? 0)) + 1
        const idx = f0 - (r.f1 + 1)
        if (idx >= 0 && imagenesAvios[idx] === undefined) imagenesAvios[idx] = im.imageId
      }
    }
  }

  // Lo que la migracion no supo acomodar (hoja _RAGNAR, clave noMigrado) y lo
  // que el tech pack traia del pedido antes de la v2 (clave pedidoAnterior).
  let noMigrado = []
  let pedidoAnterior = null
  let version = 1
  // La traza de donde salio (migradoDe, reporteMigracion) tambien se lee: el
  // editor regenera el libro y sin esto la perdia (Codex, 17-sep).
  let migradoDe = null
  let reporteMigracion = null
  const hr = libro.getWorksheet(HOJAS.ragnar)
  if (hr) {
    for (let f = 1; f <= Math.min(hr.rowCount, 20); f++) {
      const clave = String(valorPlano(hr.getCell(`A${f}`).value) ?? '')
      const valor = valorPlano(hr.getCell(`B${f}`).value)
      if (clave === 'noMigrado') {
        try { noMigrado = JSON.parse(String(valor || '[]')) } catch { noMigrado = [] }
      } else if (clave === 'pedidoAnterior' && valor) {
        try { pedidoAnterior = JSON.parse(String(valor)) } catch { pedidoAnterior = null }
      } else if (clave === 'version') {
        version = Number(valor) || 1
      } else if (clave === 'migradoDe' && valor) {
        try { migradoDe = JSON.parse(String(valor)) } catch { migradoDe = null }
      } else if (clave === 'reporteMigracion' && valor) {
        try { reporteMigracion = JSON.parse(String(valor)) } catch { reporteMigracion = null }
      }
    }
  }

  return { faltaEstructura, campos, tablas, fotos, imagenesZona, imagenesAvios, noMigrado, pedidoAnterior, version, migradoDe, reporteMigracion }
}

/**
 * Lo que un archivo v1 traia del PEDIDO (orden de compra, packs y, por codigo,
 * la OT y las docenas), leido de las celdas donde la v1 lo guardaba. Sirve
 * para conservarlo en 'pedidoAnterior' antes de quitarlo de la vista
 * (Roberto, 15-sep: "que no se vea, pero que no se desperdicie").
 * null si el archivo no trae nada de eso.
 */
export function leerPedidoV1(libro) {
  const h = libro?.getWorksheet?.(HOJAS.pedido)
  if (!h) return null
  const celda = (ref) => {
    const v = h.getCell(ref).value
    const x = v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v) ? v.result : valorPlano(v)
    return typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x
  }
  const oc = celda(PEDIDO_V1.campos.TP_OC)
  const packs = num(celda(PEDIDO_V1.campos.TP_PACKS))
  const renglones = []
  const t = TABLAS.TP_TABLA_PEDIDO
  // El rango REAL de la tabla (puede haber crecido mas alla de 20 renglones);
  // si el nombre no esta, el minimo de la plantilla.
  const nombre = (libro.definedNames?.model || []).find((d) => d?.name === 'TP_TABLA_PEDIDO')
  const rango = nombre ? parsearRango(nombre.ranges?.[0]) : null
  const ultima = rango ? rango.f2 : t.filaCab + t.filasReservadas
  for (let f = (rango ? rango.f1 : t.filaCab) + 1; f <= ultima; f++) {
    const codigo = celda(`C${f}`)
    const ot = celda(`${PEDIDO_V1.columnasPedido.ot}${f}`)
    const docenas = num(celda(`${PEDIDO_V1.columnasPedido.docenas}${f}`))
    // La tabla termina en el primer renglon sin codigo ni OT ni docenas, pero
    // se revisan todas las reservadas (puede haber huecos).
    if (!lleno(codigo) && !lleno(ot) && docenas == null) continue
    renglones.push({ codigo: lleno(codigo) ? String(codigo) : '', talla: lleno(celda(`A${f}`)) ? String(celda(`A${f}`)) : '', ot: lleno(ot) ? String(ot) : '', docenas })
  }
  if (!lleno(oc) && packs == null && !renglones.some((r) => lleno(r.ot) || r.docenas != null)) return null
  return { oc: lleno(oc) ? String(oc) : '', packs, renglones }
}

/**
 * La calificacion v2: los siete apartados de Lety, cada uno se cumple solo si
 * pasan TODAS sus comprobaciones. Devuelve la misma forma que `medicion` v1
 * ({porcentaje, calificacion, tiene, faltan}) mas el detalle de que falta.
 */
export function medirPlantilla(l) {
  const c = l.campos || {}
  const falta = Object.fromEntries(RUBROS_TECH_PACK.map((r) => [r.id, []]))

  // --- datos del modelo (v2: sin orden de compra, sin OT y sin cantidades del
  // pedido; Roberto, 15-sep). Con lo que un tech pack puro necesita, un tech
  // pack por modelo SI puede llegar al 100%.
  for (const n of ['TP_CLIENTE', 'TP_MARCA', 'TP_MODELO', 'TP_PRENDA', 'TP_TEJIDO', 'TP_FECHA', 'TP_ELABORO']) {
    if (!lleno(c[n])) falta.pedido.push(CAMPOS[n].etiqueta)
  }
  if (!(num(c.TP_PACK) > 0)) falta.pedido.push('Pares por pack')
  const pedRaw = l.tablas?.TP_TABLA_PEDIDO || []
  const ped = pedRaw.map((r, i) => ({ ...r, i })).filter((r) => lleno(r.codigo) || lleno(r.claveMicrosip) || lleno(r.descripcion))
  const completos = ped.filter((r) => lleno(r.codigo) && lleno(r.claveMicrosip))
  if (!completos.length) falta.pedido.push('al menos un codigo con su clave Microsip')
  else if (completos.length < ped.length) falta.pedido.push(`${ped.length - completos.length} codigo(s) sin clave Microsip`)

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
  // CAJA O BULTO (Roberto, 17-sep: "siempre va en bolsa pero no siempre en
  // caja"). Hay que decir cual, y lo demas se nombra con esa palabra.
  // Un valor que no sea CAJA o BULTO ("BOLSA", "CAJA O BULTO") no es un
  // embalaje elegido: no calificaba porque solo se comprobaba que no viniera
  // vacio, y un dato invalido no cuenta como capturado.
  const embCrudo = lleno(c.TP_EMBALAJE) ? String(c.TP_EMBALAJE).trim().toUpperCase() : ''
  const emb = LISTAS.embalaje.includes(embCrudo) ? embCrudo : ''
  const enQue = emb === 'BULTO' ? 'bulto' : emb === 'CAJA' ? 'caja' : 'caja o bulto'
  if (!emb) falta.caja.push('si se embarca en caja o en bulto')
  if (!(num(c.TP_DOCENAS_POR_CAJA) > 0)) falta.caja.push(`docenas por ${enQue}`)
  if (!(f.FOTO_CAJA > 0)) falta.caja.push(emb === 'BULTO' ? 'foto del bulto' : emb === 'CAJA' ? 'foto de la caja' : 'foto de la caja o el bulto')

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
  // v2: el tech pack ya no trae los packs del pedido; cuantos mandar lo dice la
  // TAREA (necesidadDeAvios). Antes, sin "packs del pedido" esto quedaba en
  // cuadra=false y el veredicto nunca pasaba de "inconcluso".
  let cuadra = true
  if (!(pack > 0)) avisos.push('En la hoja 1 faltan los pares por pack: si la tarea esta en docenas no se puede pasar a packs.')
  if (!avios.length) avisos.push('La hoja 3 AVIOS no trae ningun avio con clave.')
  if ((l.faltaEstructura || []).length) {
    cuadra = false
    avisos.push(`Plantilla danada: falta ${l.faltaEstructura.slice(0, 5).join(', ')}.`)
  }
  return { paresPorPack: pack > 0 ? pack : null, packs: null, docenas: null, avios, avisos, sinClave, cuadra }
}
