// LOS AVIOS QUE PIDE UN TECH PACK, Y CUANTOS NECESITA UNA TAREA.
//
// Roberto, 2026-09-11 (tras la junta con Lindbergh): "en la parte de
// etiquetas dice 'cuatro por pack', y asi no puedes sacar cuanto va a
// necesitar la maquila... vamos a dejar todo en uno por unidad y tu
// multiplicas". El estandar quedo en el propio Excel de Lety:
//
//   - Hoja INFORMACION DE PEDIDOS: PACK (pares por pack), CANTIDAD DE PACKS,
//     TOTAL DE PARES, TOTAL DE DOCENAS.
//   - Hoja ETIQUETAS: un renglon por avio con CLAVE, DESCRIPCION, CANTIDAD (el
//     texto para la persona: "6 PACKS DENTRO DE UNA BOLSA"), USA (el NUMERO
//     que usa cada pack: 1, 3, 0.1667) y ENVIAR (USA x packs).
//
// Aqui se lee USA, que es lo unico que la maquina puede multiplicar sin
// adivinar. CANTIDAD se conserva solo para mostrarla.
//
// Funcion PURA sobre una forma plana de las hojas ({nombre, filas: [[...]]}),
// para probarla sin ExcelJS ni la app. `hojasDeLibro` convierte un Workbook
// de ExcelJS a esa forma.

const normaliza = (s) =>
  String(valorPlano(s) ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** El valor "plano" de una celda de ExcelJS (formulas, texto enriquecido...). */
export function valorPlano(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    if ('result' in v) return valorPlano(v.result)
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return valorPlano(v.text)
    if (v instanceof Date) return v.toISOString()
    return ''
  }
  return v
}

/** Workbook de ExcelJS -> [{nombre, filas: [[valor por columna]]}] */
export function hojasDeLibro(libro, maxFilas = 200) {
  return libro.worksheets.map((hoja) => {
    const filas = []
    hoja.eachRow({ includeEmpty: false }, (fila, n) => {
      if (n > maxFilas) return
      const valores = []
      fila.eachCell({ includeEmpty: true }, (celda, col) => {
        valores[col - 1] = valorPlano(celda.value)
      })
      filas[n - 1] = valores
    })
    return { nombre: hoja.name, filas }
  })
}

// La MISMA forma que el catalogo de avios (Avios.jsx, normalizarCodigoAvio):
// mayusculas, espacios como guion, y fuera todo lo que no sea A-Z 0-9 . _ -.
// Una clave con diagonal o acento no existe en el catalogo y ademas no puede
// ser id de documento.
export const normalizarClaveAvio = (s) =>
  String(valorPlano(s) ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9._-]/g, '')
    .slice(0, 60)

const aNumero = (v0) => {
  const v = valorPlano(v0)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let t = String(v ?? '').trim()
  // "1,5" es un decimal escrito a la mexicana; "1,500" es un millar. Cualquier
  // otra mezcla de comas no se adivina.
  if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.')
  else if (/^-?\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

// Busca una celda cuyo texto empiece con `etiqueta` y devuelve el primer
// numero a su derecha en la misma fila o, si no hay, el primero en la MISMA
// columna una fila abajo (asi vienen "PACK / 3" en INFORMACION DE PEDIDOS).
function numeroJuntoA(filas, etiqueta) {
  for (let r = 0; r < filas.length; r++) {
    const fila = filas[r] || []
    for (let c = 0; c < fila.length; c++) {
      if (!normaliza(fila[c]).startsWith(normaliza(etiqueta))) continue
      for (let k = c + 1; k < fila.length; k++) {
        const n = aNumero(fila[k])
        if (n != null) return n
        if (normaliza(fila[k]) && normaliza(fila[k]) !== normaliza(fila[c])) break
      }
      for (let rr = r + 1; rr < Math.min(filas.length, r + 3); rr++) {
        const n = aNumero((filas[rr] || [])[c])
        if (n != null) return n
      }
    }
  }
  return null
}

/**
 * Lee el estandar del tech pack.
 *
 * @returns {{
 *   paresPorPack: number|null, packs: number|null, docenas: number|null,
 *   avios: {clave: string, descripcion: string, cantidadTexto: string, usaPorPack: number|null, enviar: number|null}[],
 *   avisos: string[]
 * }}
 */
export function aviosDelTechPack(hojas) {
  const avisos = []
  const info = (hojas || []).find((h) => normaliza(h.nombre).startsWith('INFORMACION'))
  const etiq = (hojas || []).find((h) => normaliza(h.nombre).startsWith('ETIQUETA'))

  let paresPorPack = null
  let packs = null
  let docenas = null
  if (info) {
    paresPorPack = numeroJuntoA(info.filas, 'PACK')
    packs = numeroJuntoA(info.filas, 'CANTIDAD DE PACKS')
    docenas = numeroJuntoA(info.filas, 'TOTAL DE DOCENAS')
  } else {
    avisos.push('No trae la hoja INFORMACION DE PEDIDOS: no se sabe cuantos pares lleva cada pack.')
  }
  if (etiq && packs == null) packs = numeroJuntoA(etiq.filas, 'PACKS')
  if (paresPorPack != null && (paresPorPack <= 0 || paresPorPack > 24)) {
    avisos.push(`El PACK dice ${paresPorPack} pares y no parece un pack real.`)
    paresPorPack = null
  }

  const avios = []
  let sinClave = 0
  if (!etiq) {
    avisos.push('No trae la hoja ETIQUETAS: no se sabe que avios lleva.')
    return { paresPorPack, packs, docenas, avios, avisos, sinClave, cuadra: false }
  }

  // El encabezado: la fila que trae CLAVE y USA.
  let cab = -1
  const col = { clave: -1, descripcion: -1, cantidad: -1, usa: -1, enviar: -1 }
  for (let r = 0; r < etiq.filas.length; r++) {
    const fila = etiq.filas[r] || []
    const idx = (pref) => fila.findIndex((v) => normaliza(v).startsWith(pref))
    const iClave = idx('CLAVE')
    const iUsa = fila.findIndex((v) => normaliza(v) === 'USA')
    if (iClave >= 0 && iUsa >= 0) {
      cab = r
      col.clave = iClave
      col.descripcion = idx('DESCRIPCION')
      col.cantidad = idx('CANTIDAD')
      col.usa = iUsa
      col.enviar = idx('ENVIAR')
      break
    }
    // USA puede venir una fila ARRIBA de CLAVE (la fila de "ETIQUETAS EXTERNAS").
    if (iClave >= 0 && cab < 0) {
      const arriba = etiq.filas[r - 1] || []
      const iUsaArriba = arriba.findIndex((v) => normaliza(v) === 'USA')
      if (iUsaArriba >= 0) {
        cab = r
        col.clave = iClave
        col.descripcion = idx('DESCRIPCION')
        col.cantidad = idx('CANTIDAD')
        col.usa = iUsaArriba
        col.enviar = arriba.findIndex((v) => normaliza(v) === 'ENVIAR')
        break
      }
    }
  }
  if (cab < 0) {
    avisos.push('En ETIQUETAS no encontre las columnas CLAVE y USA: el tech pack no sigue el estandar.')
    return { paresPorPack, packs, docenas, avios, avisos, sinClave, cuadra: false }
  }

  for (let r = cab + 1; r < etiq.filas.length; r++) {
    const fila = etiq.filas[r] || []
    const claveCruda = normaliza(fila[col.clave])
    const clave = normalizarClaveAvio(fila[col.clave])
    const descripcion = String(fila[col.descripcion] ?? '').replace(/\s+/g, ' ').trim()
    const usaPorPack = aNumero(fila[col.usa])
    if (!clave && !descripcion && usaPorPack == null) continue
    // Se acaba la tabla en cuanto empieza otra seccion (EMPAQUE, RECIBE Y
    // AUTORIZA...). Esas filas son celdas combinadas: el mismo texto se
    // repite en la columna de la clave y en la de la descripcion, y no traen
    // numero en USA. Una clave de verdad es corta y no es igual a su
    // descripcion.
    // (Un texto de seccion no trae digitos; una clave de avio siempre.)
    const combinada = claveCruda && claveCruda === normaliza(descripcion) && usaPorPack == null && !/\d/.test(claveCruda)
    const primera = normaliza(fila.find((v) => normaliza(v)))
    if (combinada || (!clave && /^(EMPAQUE|RECIBE|ENTREGA|COPIA|SE EMPACAN)/.test(primera))) break
    const enviar = col.enviar >= 0 ? aNumero(fila[col.enviar]) : null
    if (!clave) {
      // Sin clave no se cruza con nada, pero SI cuenta: un renglon material
      // que no se pudo leer no puede desaparecer del veredicto.
      avisos.push(`"${descripcion || claveCruda || 'renglon ' + (r + 1)}" no trae clave valida: no se puede cruzar con el inventario.`)
      sinClave++
      continue
    }
    if (usaPorPack == null) avisos.push(`${clave}: la columna USA no trae numero ("${valorPlano(fila[col.usa]) ?? ''}").`)
    else if (usaPorPack < 0) avisos.push(`${clave}: la columna USA trae un numero negativo (${usaPorPack}).`)
    avios.push({
      clave,
      descripcion,
      cantidadTexto: String(fila[col.cantidad] ?? '').replace(/\s+/g, ' ').trim(),
      usaPorPack: usaPorPack != null && usaPorPack < 0 ? null : usaPorPack,
      enviar
    })
  }
  if (!avios.length) avisos.push('La hoja ETIQUETAS no trae ningun avio con clave.')
  // Las cuatro cifras del pedido tienen que cuadrar entre si; si no, no se
  // sabe cual esta mal y no se puede dar por bueno el calculo.
  const pares = info ? numeroJuntoA(info.filas, 'TOTAL DE PARES') : null
  let cuadra = true
  const positivas = [paresPorPack, packs, pares, docenas].every((n) => n != null && n > 0)
  if (!positivas) {
    avisos.push('En INFORMACION DE PEDIDOS faltan cifras (pack, packs, pares o docenas) o vienen en cero: no se puede comprobar el pedido.')
    cuadra = false
  } else {
    if (Math.abs(paresPorPack * packs - pares) > 0.5) {
      avisos.push(`No cuadra: ${packs} packs x ${paresPorPack} pares da ${paresPorPack * packs}, no ${pares}.`)
      cuadra = false
    }
    if (Math.abs(pares / 12 - docenas) > 0.5) {
      avisos.push(`No cuadra: ${pares} pares son ${pares / 12} docenas, no ${docenas}.`)
      cuadra = false
    }
  }
  return { paresPorPack, packs, docenas, avios, avisos, sinClave, cuadra }
}

/**
 * Cuantos packs pide una tarea de ensamble, con el PACK del tech pack.
 * Renglones en docenas -> docenas x 12 / pares por pack. En packs -> directo.
 * En otra unidad no se sabe.
 */
export function packsDeLaTarea(renglones, paresPorPack) {
  let packs = 0
  let docenas = 0
  for (const r of renglones || []) {
    const cantidad = Number(r?.cantidad) || 0
    const unidad = String(r?.unidad || '').trim().toLowerCase()
    if (cantidad <= 0) continue
    if (unidad === 'packs') packs += cantidad
    else if (unidad === 'docenas') docenas += cantidad
    else return { packs: null, motivo: `la tarea esta en ${unidad || 'una unidad sin nombre'}` }
  }
  if (docenas > 0) {
    if (!paresPorPack) return { packs: null, motivo: 'la tarea esta en docenas y el tech pack no dice cuantos pares lleva cada pack' }
    packs += (docenas * 12) / paresPorPack
  }
  if (packs <= 0) return { packs: null, motivo: 'la tarea no trae cantidades' }
  return { packs: Math.ceil(packs - 1e-9), motivo: '' }
}

const UNIDADES_A_PIEZAS = { piezas: 1, pieza: 1, pza: 1, pzas: 1, millares: 1000, millar: 1000 }

/**
 * Lo que necesita la tarea de cada avio y si alcanza con lo que la maquila
 * tiene HOY. Es una foto: no descuenta lo que otras tareas abiertas de la
 * misma maquila van a consumir (Codex, 11-sep), y la pantalla lo dice.
 *
 * saldos:   { [clave]: {cantidad, unidad} } (lo que no exista = 0 piezas).
 * catalogo: Set de claves que SI existen en el catalogo de avios. Si se pasa,
 *           una clave que no este ahi no se compara: "sin saldo" solo quiere
 *           decir cero cuando la clave es conocida.
 *
 * veredicto: 'faltante' | 'suficiente' | 'inconcluso'. Nunca sale
 * 'suficiente' si quedo un solo renglon sin leer o sin comparar.
 */
export function necesidadDeAvios(lectura, renglones, saldos = {}, catalogo = null) {
  const { packs, motivo } = packsDeLaTarea(renglones, lectura.paresPorPack)

  // La misma clave puede venir en dos renglones (dos tallas, dos usos): se
  // suma ANTES de comparar, si no el mismo saldo se cuenta dos veces.
  const porClave = new Map()
  for (const a of lectura.avios) {
    const previo = porClave.get(a.clave)
    if (!previo) {
      porClave.set(a.clave, { ...a })
      continue
    }
    previo.descripcion = previo.descripcion || a.descripcion
    previo.cantidadTexto = [previo.cantidadTexto, a.cantidadTexto].filter(Boolean).join(' + ')
    previo.usaPorPack = previo.usaPorPack == null || a.usaPorPack == null ? null : previo.usaPorPack + a.usaPorPack
    previo.enviar = previo.enviar == null || a.enviar == null ? null : previo.enviar + a.enviar
  }

  const filas = [...porClave.values()].map((a) => {
    const necesita = packs != null && a.usaPorPack != null ? Math.ceil(a.usaPorPack * packs - 1e-9) : null
    const saldo = saldos[a.clave]
    const enCatalogo = catalogo ? catalogo.has(a.clave) : true
    const unidad = String(saldo?.unidad || 'piezas').trim().toLowerCase()
    const factor = UNIDADES_A_PIEZAS[unidad]
    const hayOriginal = saldo ? Number(saldo.cantidad) || 0 : 0
    let hay = null
    let porQueNo = ''
    if (!enCatalogo && !saldo) porQueNo = 'la clave no esta en el catalogo de avios'
    else if (saldo && !factor) porQueNo = `el saldo esta en ${unidad} y no se puede pasar a piezas`
    else hay = saldo ? Math.trunc(hayOriginal * factor) : 0
    const faltan = necesita != null && hay != null ? Math.max(0, necesita - hay) : null
    return {
      ...a,
      necesita,
      hay,
      hayOriginal,
      hayUnidad: saldo ? unidad : 'piezas',
      comparable: hay != null,
      porQueNo,
      faltan,
      alcanza: faltan == null ? null : faltan === 0
    }
  })

  const avisos = [...lectura.avisos]
  if (packs == null) avisos.push(`No se pudo calcular: ${motivo}.`)
  else if (lectura.packs != null && lectura.packs !== packs) {
    avisos.push(`El tech pack esta hecho para ${lectura.packs} packs y la tarea pide ${packs}: se calcula con lo de la tarea.`)
  }
  const medidas = filas.filter((f) => f.comparable && f.necesita != null)
  const faltantes = medidas.filter((f) => !f.alcanza).length
  const sinComparar = filas.length - medidas.length + (lectura.sinClave || 0)
  const completo = packs != null && filas.length > 0 && sinComparar === 0 && lectura.cuadra !== false
  const veredicto = faltantes > 0 ? 'faltante' : completo ? 'suficiente' : 'inconcluso'
  // Por que quedo inconcluso, para decirlo en la pantalla.
  const porQueInconcluso = veredicto !== 'inconcluso' ? ''
    : packs == null ? 'no se pudo saber cuantos packs pide la tarea'
      : !filas.length ? 'el tech pack no trae avios con clave'
        : sinComparar ? `${sinComparar} ${sinComparar === 1 ? 'renglon quedo' : 'renglones quedaron'} sin leer o sin comparar`
          : 'las cifras del pedido en el tech pack no cuadran'
  return { packs, filas, avisos, faltantes, sinComparar, veredicto, porQueInconcluso, alcanzaTodo: veredicto === 'suficiente' }
}
