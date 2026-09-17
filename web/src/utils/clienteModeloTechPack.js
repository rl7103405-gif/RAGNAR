// CLIENTE Y MODELO DE UN TECH PACK (funcion pura, sin Firebase).
//
// Roberto, 2026-09-15: "los tech packs ya no se manejan por OC ni OT sino por
// MODELO y por CLIENTE". Los 120 de la biblioteca traen cliente, marca y modelo
// llenos DENTRO de la plantilla TP-Quini (medido: 120/120), pero RAGNAR nunca
// los saco a la base, asi que no se podia buscar ni agrupar por ellos.
//
// Medido el mismo dia: 14 clientes, con "ÓPTIMA" (28) y "OPTIMA" (4) como el
// mismo cliente escrito distinto; 92 modelos, 0 con dos clientes; 15 modelos
// con varios tech packs (uno por talla). Algunos TP_MODELO traen varios
// modelos en texto ("RB10T100, RB10T101, RB10T103").
//
// Lo que se guarda es el texto TAL CUAL lo escribio Lety; la normalizacion es
// solo para comparar y agrupar (Codex: no guardar la clave normalizada).

/** "Óptima  " y "OPTIMA" agrupan juntos: sin acentos, mayusculas y espacios
 *  colapsados (no eliminados: "GRUPO UNION" no es "GRUPOUNION"). */
export function claveCliente(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Los modelos de un TP_MODELO. Solo se parte por coma, punto y coma o salto
 *  de linea: NUNCA por espacio, guion o diagonal, que son parte del modelo
 *  ("CATM-FW18-006", "REGEN LT-744"). */
export function modelosDeTexto(texto) {
  const vistos = new Set()
  const salida = []
  for (const pedazo of String(texto ?? '').split(/[,;\n\r]+/)) {
    const limpio = pedazo.replace(/\s+/g, ' ').trim()
    const k = claveCliente(limpio)
    if (!limpio || vistos.has(k)) continue
    vistos.add(k)
    salida.push(limpio)
  }
  return salida
}

const texto = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return s || null
}

/**
 * La identidad de un tech pack leida de su plantilla (leerPlantilla(libro)).
 * null en cada campo que no venga: nunca se inventa ni se hereda del archivo
 * anterior (Codex: un PDF o un Excel ajeno deja los campos vacios).
 */
export function identidadDePlantilla(lectura) {
  const c = lectura?.campos || {}
  return {
    cliente: texto(c.TP_CLIENTE, 120),
    marca: texto(c.TP_MARCA, 120),
    modeloPlantilla: texto(c.TP_MODELO, 200),
    tallaPlantilla: tallaDePlantilla(lectura),
    // Los códigos del modelo que trae la tabla: un six pack es UN tech pack
    // con seis códigos (Roberto, 16-sep), no seis tech packs.
    codigosCubiertos: codigosDeRenglones(lectura?.tablas?.TP_TABLA_PEDIDO)
  }
}

/**
 * La TALLA del tech pack, para distinguir las tallas de un mismo modelo
 * (Roberto, 15-sep: "divide las tallas"). Sale de la tabla de codigos de la
 * plantilla (medido: 105 de 120 traen una sola talla, 15 varias, 0 ninguna);
 * si no trae, del "sistema de talla". Varias tallas van juntas: "S/M / L/XL".
 */
export function tallaDePlantilla(lectura) {
  const vistas = new Set()
  const tallas = []
  for (const r of lectura?.tablas?.TP_TABLA_PEDIDO || []) {
    const t = String(r?.talla ?? '').replace(/\s+/g, ' ').trim()
    const k = claveCliente(t)
    if (t && !vistas.has(k)) { vistas.add(k); tallas.push(t) }
  }
  return texto(tallas.length ? tallas.join(' / ') : lectura?.campos?.TP_SISTEMA_TALLA, 120)
}

export const IDENTIDAD_VACIA = Object.freeze({ cliente: null, marca: null, modeloPlantilla: null, tallaPlantilla: null, codigosCubiertos: [] })

/**
 * La identidad de un tech pack del FORMATO VIEJO (el de Lety, antes de la
 * plantilla TP-Quini), leída con extraerTechPackViejo. Roberto, 16-sep: Mónica
 * subió 12 así y quedaron todos en "(sin cliente)" porque solo se leía la
 * plantilla — el archivo sí traía cliente BEZDEK, marca PIERRE y su modelo.
 *
 * @param {{datos: object}} extraido lo que devuelve extraerTechPackViejo
 */
export function identidadDeTechPackViejo(extraido) {
  const d = extraido?.datos || {}
  return {
    cliente: texto(d.cliente, 120),
    marca: texto(d.marca, 120),
    modeloPlantilla: texto(d.modelo, 200),
    // El formato viejo no tiene tabla de tallas por renglón como la plantilla:
    // la talla es el "sistema de talla" (CABALLERO, DAMA, 4-6...).
    tallaPlantilla: texto(d.sistemaTalla || [...new Set((d.renglones || []).map((r) => r?.talla).filter(Boolean))].join(' / '), 120),
    codigosCubiertos: codigosDeRenglones(d.renglones)
  }
}

/**
 * LOS CÓDIGOS QUE CUBRE UN TECH PACK. Roberto, 16-sep: "un six pack tiene un
 * modelo y un solo tech pack, aunque vengan seis códigos". El archivo trae esa
 * lista en su tabla de códigos; sin ella la app exigía un tech pack por código.
 * Sin repetidos y acotada: es un índice para buscar, no la prueba de nada.
 */
export function codigosDeRenglones(renglones, max = 60) {
  const vistos = new Set()
  const salida = []
  for (const r of renglones || []) {
    const c = textoDe(r?.codigo ?? r).replace(/\s+/g, '').trim().toUpperCase()
    // Un código SIEMPRE trae un número (6729-K, 1442-I, 4845, WKD225T401). Sin
    // esto se colaban encabezados sueltos del Excel viejo como "TEJIDO" o
    // "COLOR", que después se buscarían como si fueran códigos (medido el
    // 16-sep en el archivo de 6729-K).
    if (!c || c.length > 60 || !/[0-9]/.test(c) || vistos.has(c)) continue
    vistos.add(c)
    salida.push(c)
    if (salida.length >= max) break
  }
  return salida
}

/** Los códigos que cubre un tech pack ya guardado (lista vacía si no se sabe). */
export function codigosCubiertosDe(b) {
  return Array.isArray(b?.codigosCubiertos) ? b.codigosCubiertos.filter((c) => typeof c === 'string' && c) : []
}

/** El campo como texto, o '' si no lo es. Defensa: un cliente que no sea texto
 *  (un mapa, un numero) tumbaba la biblioteca entera al pintarse o al ordenar
 *  (pentester, 15-sep). Las reglas ya no lo dejan entrar; esto es por si acaso. */
export function textoDe(v) {
  return typeof v === 'string' ? v : ''
}

/** Los modelos con los que se agrupa un tech pack: los de la plantilla; si no
 *  hay, el que dijo el catalogo o Lety (datosEditables). */
export function modelosDelTechPack(b) {
  const dePlantilla = modelosDeTexto(textoDe(b?.modeloPlantilla))
  if (dePlantilla.length) return dePlantilla
  const otro = textoDe(b?.datosEditables?.modelo ?? b?.modelo).trim()
  return otro ? [otro] : []
}

/**
 * La biblioteca agrupada por CLIENTE -> MODELO -> tech packs. Un tech pack con
 * varios modelos aparece bajo cada uno (el archivo no se duplica). Los que no
 * traen cliente van al final en "(sin cliente)".
 *
 * @returns [{ cliente, clave, modelos: [{ modelo, clave, techPacks: [...] }], total }]
 */
export function agruparPorClienteYModelo(biblioteca) {
  const clientes = new Map()
  for (const b of biblioteca || []) {
    if (!b || b.apuntaA) continue
    const cliente = textoDe(b.cliente).trim()
    const kc = claveCliente(cliente) || '~SIN'
    if (!clientes.has(kc)) clientes.set(kc, { cliente: cliente || '(sin cliente)', clave: kc, grafias: new Map(), modelos: new Map(), ids: new Set() })
    const g = clientes.get(kc)
    if (cliente) g.grafias.set(cliente, (g.grafias.get(cliente) || 0) + 1)
    g.ids.add(b.id || b.codigo)
    const modelos = modelosDelTechPack(b)
    for (const m of modelos.length ? modelos : ['(sin modelo)']) {
      const km = claveCliente(m)
      if (!g.modelos.has(km)) g.modelos.set(km, { modelo: m, clave: km, techPacks: [] })
      g.modelos.get(km).techPacks.push(b)
    }
  }
  const orden = (a, b) => a.localeCompare(b, 'es', { numeric: true })
  return [...clientes.values()]
    .map((g) => ({
      // Se muestra la grafia mas usada ("ÓPTIMA" sobre "OPTIMA").
      cliente: g.grafias.size ? [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0] : g.cliente,
      clave: g.clave,
      grafias: [...g.grafias.keys()],
      total: g.ids.size,
      modelos: [...g.modelos.values()]
        .map((m) => {
          const techPacks = m.techPacks.sort((x, y) => orden(x.codigo || '', y.codigo || ''))
          return { ...m, techPacks, tallas: agruparPorTalla(techPacks) }
        })
        .sort((x, y) => orden(x.modelo, y.modelo))
    }))
    .sort((a, b) => (a.clave === '~SIN' ? 1 : b.clave === '~SIN' ? -1 : orden(a.cliente, b.cliente)))
}

/** La talla con la que se muestra un tech pack: la de su plantilla; si no
 *  hay, la que dijo Lety o el catalogo. '' si nadie la dice. */
export function tallaDelTechPack(b) {
  return (textoDe(b?.tallaPlantilla) || textoDe(b?.datosEditables?.talla) || textoDe(b?.talla)).trim()
}

/** Los tech packs de un modelo separados por talla (Roberto, 15-sep: "divide
 *  las tallas"). Sin talla van al final. [{ talla, clave, techPacks }] */
export function agruparPorTalla(techPacks) {
  const grupos = new Map()
  for (const b of techPacks || []) {
    const talla = tallaDelTechPack(b)
    const k = claveCliente(talla) || '~SIN'
    if (!grupos.has(k)) grupos.set(k, { talla: talla || '(sin talla)', clave: k, techPacks: [] })
    grupos.get(k).techPacks.push(b)
  }
  return [...grupos.values()].sort((a, b) =>
    a.clave === '~SIN' ? 1 : b.clave === '~SIN' ? -1 : a.talla.localeCompare(b.talla, 'es', { numeric: true })
  )
}

/** ¿El tech pack coincide con la busqueda? Todas las palabras tienen que
 *  aparecer en codigo, cliente, marca, modelo(s), descripcion, talla o color. */
export function coincideTechPack(b, busqueda) {
  const palabras = claveCliente(busqueda).split(' ').filter(Boolean)
  if (!palabras.length) return true
  const e = b?.datosEditables || {}
  const pajar = claveCliente(
    [b?.codigo, b?.cliente, b?.marca, b?.modeloPlantilla, b?.modelo, e.modelo, b?.descripcion, b?.tallaPlantilla, e.talla ?? b?.talla, e.color ?? b?.color].map(textoDe).join(' ')
  )
  return palabras.every((p) => pajar.includes(p))
}
