// EL AVANCE DE UN CÓDIGO Y DE UNA ORDEN DE TRABAJO frente a la biblioteca de
// tech packs. Funciones PURAS: no tocan Firebase, para poder probarlas con la
// biblioteca real desde un script (16-sep; antes vivían en tareasDiseno.js,
// que importa `db`, y no había forma de ejecutarlas fuera del navegador).
//
// LA REGLA QUE MANDA AQUÍ (Roberto, 16-sep, con Lety): un SIX PACK es UN
// modelo y UN solo tech pack, aunque cubra seis códigos. La app exigía un tech
// pack por código y por eso una orden entera salía en ceros. Medido ese día:
// 112 de los 133 tech packs de la biblioteca cubren más de un código.
import { RUBROS_TECH_PACK } from './completadoTechPack.js'
import { codigosCubiertosDe } from './clienteModeloTechPack.js'
import { CHECKLIST_VERSION, codigoComoId, datosDelTechPack } from './techPackNucleo.js'

/**
 * codigo -> documento de la biblioteca (incluye los alias, que se siguen), y
 * `.cubiertos`: codigo -> los tech packs que declaran cubrirlo (el six pack).
 */
export function indexarBiblioteca(biblioteca) {
  const m = new Map()
  m.cubiertos = new Map()
  ;(biblioteca || []).forEach((b) => {
    m.set(b.codigo, b)
    // Cuenta de prueba: la biblioteca guarda 'ZZTEST<codigo>' y la OT dice
    // '<codigo>'. Sin esto el avance del corral nunca veía lo subido
    // (code-reviewer, 15-sep). Un documento real con ese código gana.
    const s = String(b.codigo || '')
    if (b.esPrueba && s.startsWith('ZZTEST') && !m.has(s.slice(6))) m.set(s.slice(6), b)
    for (const c of codigosCubiertosDe(b)) {
      if (!m.cubiertos.has(c)) m.cubiertos.set(c, [])
      m.cubiertos.get(c).push(b)
    }
  })
  return m
}

// Los documentos de la biblioteca que responden por un codigo del plan:
//   1. el exacto CON ARCHIVO (siguiendo un alias si lo es),
//   2. el tech pack del MODELO que declara cubrirlo (six pack),
//   3. sus variantes por talla (WKD225T401 -> WKD225T401-4-6, -7-9...),
//   4. el exacto aunque no tenga archivo, para poder decir "sin tech pack".
//
// El orden importa: devolver primero el documento exacto aunque estuviera
// VACÍO tapaba el six pack que sí lo cubre (Codex, 16-sep).
//
// OJO: el plan NO dice cuántas tallas debe tener un codigo, así que aquí se
// evalúan las variantes que EXISTEN. Que existan todas las que deberían es
// criterio de Lety, no de la app (lo levantó Codex: "encontradas" no es lo
// mismo que "requeridas").
export function documentosDe(codigo, indice) {
  const id = codigoComoId(codigo)
  let d = indice.get(id)
  if (d?.apuntaA) d = indice.get(d.apuntaA) || null
  if (d && !d.apuntaA && d.techPack) return [d]
  const cubren = (indice.cubiertos?.get(id) || []).filter((b) => b.techPack && !b.apuntaA)
  if (cubren.length) return cubren
  if (d && !d.apuntaA) return [d]
  const pref = id + '-'
  return [...new Set(indice.values())].filter((b) => {
    const cod = String(b.codigo)
    return !b.apuntaA && (cod.startsWith(pref) || (b.esPrueba && cod.startsWith('ZZTEST' + pref)))
  })
}

// "Listo" sin ambiguedad: hay archivo, los siete rubros estan marcados,
// ninguno en "falta", al menos uno "ya esta", y el checklist es de la version
// vigente. Un tech pack sin revisar NO esta listo aunque tenga archivo.
export function evaluarDocumento(b) {
  const tiene = Boolean(b?.techPack?.totalChunks)
  const d = datosDelTechPack(b)
  const c = d.checklist || {}
  const ids = RUBROS_TECH_PACK.map((r) => r.id)
  const valores = ids.map((k) => c[k])
  const presentes = valores.every(Boolean)
  const completos = valores.filter((v) => v === 'completo').length
  const cuentan = valores.filter((v) => v !== 'no_aplica').length
  const porcentaje = cuentan ? Math.round((completos / cuentan) * 100) : 0
  const listo =
    tiene &&
    presentes &&
    valores.every((v) => v === 'completo' || v === 'no_aplica') &&
    completos >= 1 &&
    d.checklistVersion === CHECKLIST_VERSION
  return {
    tiene,
    listo,
    porcentaje,
    revisado: valores.some(Boolean),
    quien: b?.actualizadoPorNombre || '',
    cuando: b?.actualizadoEn || null
  }
}

/** El estado de UN codigo del plan frente a la biblioteca. */
export function estadoDelCodigo(codigo, indice) {
  const lista = documentosDe(codigo, indice)
  // pentester C2: coercion defensiva, por si algo cuela un codigo que no es
  // string (el panel lo pinta directo y React no acepta objetos como hijo).
  if (!lista.length) {
    return { codigo: String(codigo), tiene: false, listo: false, porcentaje: 0, revisado: false, quien: '', variantes: 0, etiqueta: 'sin tech pack', de: '' }
  }
  const evals = lista.map(evaluarDocumento)
  const tiene = evals.some((e) => e.tiene)
  const listo = evals.every((e) => e.listo)
  const porcentaje = Math.round(evals.reduce((t, e) => t + e.porcentaje, 0) / evals.length)
  const ultimo = evals.filter((e) => e.quien).sort((a, b) => (b.cuando?.toMillis?.() || 0) - (a.cuando?.toMillis?.() || 0))[0]
  // De qué tech pack viene, cuando NO es el del mismo código: es el six pack
  // que lo cubre, y hay que decirlo o parece que el código está listo solo.
  const otros = lista.filter((b) => String(b.codigo) !== codigoComoId(codigo)).map((b) => String(b.codigo))
  const otro = otros.length === lista.length ? otros.join(', ') : ''
  return {
    codigo: String(codigo),
    tiene,
    listo,
    porcentaje,
    revisado: evals.some((e) => e.revisado),
    quien: ultimo?.quien || '',
    variantes: lista.length > 1 ? lista.length : 0,
    de: otro,
    etiqueta: listo ? 'listo' : !tiene ? 'sin tech pack' : evals.some((e) => e.revisado) ? 'a medias' : 'sin revisar'
  }
}

/** El avance de una OT: todos sus codigos evaluados. */
export function avanceDeOt(codigos, indice) {
  // pentester C2: un 'codigos: [{}]' escrito desde la consola (la regla solo
  // valida que sea list, no el tipo de cada elemento) llegaba crudo hasta el
  // panel y React tronaba ("Objects are not valid as a React child"). Se
  // filtra a strings no vacios antes de evaluar.
  const validos = (codigos || []).filter((c) => typeof c === 'string' && c.trim())
  const estados = validos.map((c) => estadoDelCodigo(c, indice))
  const lista = estados.length > 0 && estados.every((e) => e.listo)
  const porcentaje = estados.length ? Math.round(estados.reduce((t, e) => t + e.porcentaje, 0) / estados.length) : 0
  const quienes = [...new Set(estados.map((e) => e.quien).filter(Boolean))]
  // LO QUE EL TECH PACK DICE CUBRIR Y LA ORDEN NO PIDE (Roberto, 16-sep:
  // "decirles, no, pues es que te faltan dos códigos de los seis"). Delata los
  // dedazos del archivo: el six pack PC70493 trae "63-95-K" donde la orden
  // pide "6395-K" (medido ese día).
  const pedidos = new Set(validos.map((c) => codigoComoId(c)))
  // Un código con un guion de más es el MISMO código mal escrito: así se
  // distingue el dedazo ("63-95-K" por "6395-K") de un código que de verdad
  // pertenece a otra orden, que no tiene nada de raro (code-reviewer, 16-sep:
  // el aviso salía igual de fuerte en los dos casos y se volvía ruido).
  const pelado = (c) => String(c).replace(/[^A-Z0-9]/gi, '').toUpperCase()
  const pedidosPelados = new Map(validos.map((c) => [pelado(codigoComoId(c)), codigoComoId(c)]))
  const docs = [...new Set(estados.flatMap((e) => documentosDe(e.codigo, indice)))]
  const ajenos = []
  for (const b of docs) {
    const cubre = codigosCubiertosDe(b)
    const fuera = cubre.filter((c) => !pedidos.has(c))
    if (!fuera.length || cubre.length <= 1) continue
    const dedazos = fuera
      .map((c) => ({ dice: c, deberiaDecir: pedidosPelados.get(pelado(c)) }))
      .filter((x) => x.deberiaDecir)
    ajenos.push({ codigo: String(b.codigo), cubre: cubre.length, fuera, dedazos })
  }
  return {
    estados,
    lista,
    porcentaje,
    quienes,
    total: estados.length,
    listos: estados.filter((e) => e.listo).length,
    sinTechPack: estados.filter((e) => !e.tiene).length,
    ajenos
  }
}
