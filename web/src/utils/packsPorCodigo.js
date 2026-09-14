// CUANTOS PARES TRAE EL PACK DE UN CODIGO (funcion pura, sin Firebase).
//
// RAGNAR cuenta en DOCENAS (plan de Adrian, recepciones de PT) y el PL al
// cliente va en PACKS. Para pasar de uno a otro hay que saber los pares por
// pack de cada codigo, y ningun lugar lo dice solo. Medido contra produccion el
// 2026-09-14 (1,557 codigos del plan):
//   - el catalogo: CERO descripciones con pack;
//   - Microsip, en el NOMBRE del articulo del modelo ("3 PACK CALCETA NIÑA 4-6
//     BABY PHAT WKD125C402"): ~770 codigos, ligados por el modelo;
//   - el texto del pedido de Adrian por OT ("07682_WKD225T401_NIÑA 4-6_3 PACK
//     TIN_JUNIO"): ~440;
//   - el "pares por pack" de los tech packs de Lety: ~380.
//
// Lo que decidio Roberto (14-sep):
//   1. Manda Microsip, luego el pedido, luego el tech pack (solo importa para
//      decir de DONDE salio cuando coinciden).
//   2. Si las fuentes dicen cosas distintas, RAGNAR NO escoge: 'conflicto',
//      sin conversion, hasta que alguien lo decida a mano.
//   3. Si ninguna fuente dice pack, es SUELTO (1 par), pero marcado como
//      'supuesto' para que nadie lo confunda con un dato.
//   4. Lo manual (Valeria, Cielo) resuelve el conflicto o corrige el supuesto;
//      lo que decian las fuentes queda anotado como discrepancia.
//
// La llave es el CODIGO, no el modelo: el PL y las entregas ya van por codigo,
// y un modelo puede agrupar presentaciones distintas (lo sugirio Codex).

import { normalizarCodigo } from './planMaestroNucleo.js'

export const PARES_MIN = 1
export const PARES_MAX = 24

export const FUENTES = ['microsip', 'pedido', 'techpack']
export const NOMBRE_FUENTE = { manual: 'captura manual', microsip: 'Microsip', pedido: 'pedido del plan', techpack: 'tech pack', supuesto: 'supuesto' }

// Palabras que en Microsip dicen el pack sin numero ("TIN SIXPACK NO SHOW").
const PALABRAS = { UNIPACK: 1, BIPACK: 2, DUOPACK: 2, TRIPACK: 3, SIXPACK: 6 }

const paresValidos = (n) => Number.isInteger(n) && n >= PARES_MIN && n <= PARES_MAX

/** Pares por pack escritos en un texto: "3 PACK", "6PACK", "3-PACK", "10 PK",
 *  "TRIPACK". null si no lo dice o el numero no es un pack real. */
export function paresEnTexto(texto) {
  const t = String(texto || '').toUpperCase()
  if (!t) return null
  // El numero no puede venir pegado a otro digito ("12345PACK" no es un pack)
  // y PACK/PAK/PK no puede seguir de otra letra ("PKG", "PACKING").
  // Tampoco puede venir tras un punto ("3.5 PACK" no son 5 pares). "PACKS"
  // en plural cuenta igual.
  const m = /(?:^|[^0-9.])(\d{1,2})\s*-?\s*(?:PACK|PAK|PK)S?(?![A-Z])/.exec(t)
  if (m) {
    const n = Number(m[1])
    return paresValidos(n) ? n : null
  }
  for (const [palabra, n] of Object.entries(PALABRAS)) {
    if (new RegExp(`(?:^|[^A-Z])${palabra}(?![A-Z])`).test(t)) return n
  }
  return null
}

/** "LT-744" y "LT744" son el mismo modelo: solo letras y digitos, sin acentos. */
export function claveModelo(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

/** Los pedazos de un texto que PARECEN un modelo: letras Y digitos, 5 o mas
 *  caracteres, y que no sean el propio "3PACK". "WKD125C402" si; "NIÑA", "4-6"
 *  y "JUNIO" no. */
export function tokensDeModelo(texto) {
  const salida = new Set()
  for (const pedazo of String(texto || '').split(/[\s_/,;()]+/)) {
    const k = claveModelo(pedazo)
    if (k.length >= 5 && /[A-Z]/.test(k) && /\d/.test(k) && !/PACK|PAK/.test(k)) salida.add(k)
  }
  return salida
}

/**
 * Lo que dice cada fuente sobre UN codigo.
 *
 * @param {object} p
 * @param {string} p.codigo
 * @param {string} p.modeloCatalogo        el `modelo` del catalogo de productos
 * @param {Array<{ot:string, textos:string[]}>} p.pedidosDeSusOts  los textos de
 *        pedido de cada OT donde viene el codigo en el plan
 * @param {object} p.fuentes               config/packsFuentes:
 *        { microsip: {TOKEN: [pares]}, techpack: {CODIGO: [{pares, techPack}]} }
 * @returns {Array<{fuente, pares, detalle}>}
 */
export function evidenciasDeCodigo({ codigo, modeloCatalogo, pedidosDeSusOts, fuentes }) {
  const cod = normalizarCodigo(codigo)
  const evid = []
  const tokensCatalogo = tokensDeModelo(modeloCatalogo)
  // El modelo del catalogo tambien se prueba completo ("DZ-005" -> "DZ005"
  // tiene 5 caracteres pero tokensDeModelo lo parte si trae espacios).
  const completo = claveModelo(modeloCatalogo)
  if (completo.length >= 4) tokensCatalogo.add(completo)

  // PEDIDO. planMaestroPedidos liga el texto con la OT, NO con el codigo, y una
  // OT puede traer varios codigos. Se atribuye solo cuando no hay duda: la OT
  // tiene UN solo pedido, o el modelo escrito en el pedido es el del codigo.
  // Repartir todos los textos de la OT a todos sus codigos fabricaria choques.
  const tokensPedido = new Set()
  for (const { ot, textos } of pedidosDeSusOts || []) {
    const lista = [...new Set((textos || []).map((t) => String(t || '').trim()).filter(Boolean))]
    for (const t of lista) {
      const suyos = tokensDeModelo(t)
      const esDeSuModelo = [...suyos].some((k) => tokensCatalogo.has(k))
      if (lista.length !== 1 && !esDeSuModelo) continue
      suyos.forEach((k) => tokensPedido.add(k))
      const pares = paresEnTexto(t)
      if (pares != null) evid.push({ fuente: 'pedido', pares, detalle: `OT ${ot}: ${t.slice(0, 80)}` })
    }
  }

  // MICROSIP, por el modelo: el del catalogo y el que venga escrito en el
  // pedido atribuido (a veces el catalogo trae otro nombre del mismo modelo).
  const microsip = fuentes?.microsip || {}
  const vistos = new Set()
  for (const k of new Set([...tokensCatalogo, ...tokensPedido])) {
    for (const pares of microsip[k] || []) {
      const n = Number(pares)
      if (!paresValidos(n) || vistos.has(`${k}|${n}`)) continue
      vistos.add(`${k}|${n}`)
      evid.push({ fuente: 'microsip', pares: n, detalle: `modelo ${k}` })
    }
  }

  // TECH PACK de Lety: ya viene por codigo desde el script cargador.
  for (const e of fuentes?.techpack?.[cod] || []) {
    const n = Number(e?.pares)
    if (paresValidos(n)) evid.push({ fuente: 'techpack', pares: n, detalle: `tech pack ${e.techPack || cod}` })
  }
  return evid
}

/**
 * La resolucion de un codigo. Un solo estado, para que no se contradigan
 * banderas sueltas:
 *   'resuelto'  -> pares es un dato (origen: manual | microsip | pedido | techpack)
 *   'conflicto' -> las fuentes no coinciden y nadie ha decidido: pares null
 *   'supuesto'  -> ninguna fuente dice pack: pares 1 (suelto), NO es un dato
 *
 * @param {object} p
 * @param {{pares:number}|null} p.manual
 * @param {Array} p.evidencias  de evidenciasDeCodigo
 */
export function resolverPack({ manual, evidencias }) {
  const evid = (evidencias || []).filter((e) => paresValidos(Number(e?.pares)))
  const m = manual ? Number(manual.pares) : null
  if (m != null && paresValidos(m)) {
    return {
      estado: 'resuelto',
      origen: 'manual',
      pares: m,
      evidencias: evid,
      discrepancias: evid.filter((e) => Number(e.pares) !== m),
      manual
    }
  }
  const valores = [...new Set(evid.map((e) => Number(e.pares)))]
  if (valores.length === 0) {
    return { estado: 'supuesto', origen: 'supuesto', pares: 1, evidencias: [], discrepancias: [], manual: null }
  }
  if (valores.length > 1) {
    return { estado: 'conflicto', origen: null, pares: null, evidencias: evid, discrepancias: evid, manual: null }
  }
  const origen = FUENTES.find((f) => evid.some((e) => e.fuente === f))
  return { estado: 'resuelto', origen, pares: valores[0], evidencias: evid, discrepancias: [], manual: null }
}

/** "3 pares por pack (Microsip)" · "suelto, 1 par (supuesto)" · "pack en
 *  conflicto: Microsip 3, tech pack 6" */
export function textoPack(res) {
  if (!res) return 'sin dato del pack'
  if (res.estado === 'indisponible') return 'pack no disponible (no se cargaron las fuentes)'
  if (res.estado === 'conflicto') {
    const porFuente = new Map()
    for (const e of res.evidencias) {
      const lista = porFuente.get(e.fuente) || new Set()
      lista.add(e.pares)
      porFuente.set(e.fuente, lista)
    }
    const partes = [...porFuente.entries()].map(([f, s]) => `${NOMBRE_FUENTE[f]} ${[...s].join('/')}`)
    return `pack en conflicto: ${partes.join(', ')}`
  }
  if (res.estado === 'supuesto') return 'suelto, 1 par (supuesto)'
  const pares = res.pares === 1 ? '1 par' : `${res.pares} pares por pack`
  return `${pares} (${NOMBRE_FUENTE[res.origen] || res.origen})`
}

/** Packs que son unas docenas, EXACTO (sin redondear: redondear inventa o
 *  pierde producto). null si no hay pares. `entero` dice si cuadra. */
export function packsDeDocenas(docenas, pares) {
  const d = Number(docenas)
  if (!paresValidos(Number(pares)) || !Number.isFinite(d)) return { packs: null, entero: false }
  const packs = (d * 12) / Number(pares)
  const redondo = Math.round(packs)
  return { packs, entero: Math.abs(packs - redondo) < 1e-9 }
}

/** Docenas que son unos packs. null si no hay pares. */
export function docenasDePacks(packs, pares) {
  const p = Number(packs)
  if (!paresValidos(Number(pares)) || !Number.isFinite(p)) return null
  return (p * Number(pares)) / 12
}

/** Codigos que se pueden guardar como ID de documento del valor manual (las
 *  reglas exigen lo mismo). */
export const PATRON_CODIGO_MANUAL = /^[A-Z0-9][A-Z0-9._-]{0,59}$/

export function idPackManual(codigo, esPrueba) {
  const cod = normalizarCodigo(codigo)
  if (!PATRON_CODIGO_MANUAL.test(cod)) return null
  return cod + (esPrueba ? '__prueba' : '')
}
