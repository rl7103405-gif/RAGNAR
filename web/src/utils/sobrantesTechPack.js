// QUE HACER CON LOS "DATOS SIN ACOMODAR" DE UN TECH PACK.
//
// Cuando RAGNAR pasa un Excel del formato viejo a la plantilla, lo que no supo
// donde poner lo guarda (hoja _RAGNAR, clave noMigrado) para que no se pierda.
// Roberto, 18-sep: "esos datos no se pueden estar olvidando". Medido ese dia
// en la biblioteca: 214 textos en 83 tech packs, y la mayoria NO era un dato
// perdido sino ruido (encabezados como "COLOR", fechas, el nombre de la
// maquila del pedido viejo, o un valor que ya esta en su campo). Revuelto, el
// ruido tapaba lo que si importa: UPCs, colores, referencias a otros modelos.
//
// Esta funcion NO borra nada: clasifica cada texto. Lo que es ruido se esconde
// (con su motivo, a la vista si alguien lo pide); lo real se muestra con una
// pista de que parece y a donde va. Funcion pura (se prueba en Node).
import { CAMPOS, LISTAS } from './plantillaTechPack.js'

const norm = (s) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const pelado = (s) => norm(s).replace(/[^A-Z0-9]/g, '')

// Rotulos y encabezados de columna de la plantilla vieja: no son datos.
const ENCABEZADO = /^(COLOR(ES)?|COLOR ?\/ ?CUERPO|COLOR (DE )?CUERPO|CODIGOS?( INTERNOS?)?|TALLAS?|MODELO|DESCRIPCION|BORDADO|IMAGEN|HILO|LECHUGA|CANTIDAD|CLAVE|PROCESO ?\d|RUTA DE PROCESOS?|NOTAS?|OBSERVACIONES|TOTAL(ES)?|PIEZAS?|PARES|DOCENAS?|PACKS?|ETIQUETAS?|EMPAQUE|ITEM|PO:?|CODIGO (DEL )?PROVEEDOR|UPC ?\/ ?SKU:?|UPC:?|SKU:?|GENERO|ACOMODO|MEDIO|ATRAS)$/
const FECHA = /^(\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/

/**
 * @param {Array<{hoja, celda, texto}>} noMigrado  lo que guardo la conversion
 * @param {object} lectura  leerPlantilla(libro): para saber que campos ya estan llenos
 * @returns {{ reales: Array<{hoja, celda, texto, pista}>, ruido: Array<{hoja, celda, texto, motivo}> }}
 */
export function clasificarSobrantes(noMigrado, lectura) {
  const c = lectura?.campos || {}
  // Todo lo que YA esta en la plantilla, normalizado: si un sobrante dice lo
  // mismo, no se perdio nada.
  const yaEsta = new Set()
  for (const k of Object.keys(CAMPOS)) if (c[k] != null && String(c[k]).trim() !== '') yaEsta.add(norm(c[k]))
  const enRuta = new Set(Object.values((lectura?.tablas?.TP_RUTA || [])[0] || {}).filter((v) => v != null && String(v).trim() !== '').map(norm))
  const packs = Number(c.TP_PACK) || null
  const modelo = pelado(c.TP_MODELO)

  const tejidoVacio = !(c.TP_TEJIDO != null && String(c.TP_TEJIDO).trim() !== '')
  const embalajeVacio = !['CAJA', 'BULTO'].includes(norm(c.TP_EMBALAJE))
  const TEJIDOS = new Set(LISTAS.tejido.map(norm))
  const PROCESOS = new Set(LISTAS.procesos.map(norm))

  const reales = []
  const ruido = []
  const vistos = new Set()
  for (const x of noMigrado || []) {
    if (!x || x.recortado) continue
    const t = norm(x.texto)
    if (!t) continue
    // El mismo texto en la misma celda repetido (PAKAR lo traia tres veces).
    const llave = `${x.hoja}|${x.celda}|${t}`
    if (vistos.has(llave)) continue
    vistos.add(llave)
    let motivo = ''
    let pistaFija = ''
    // Un valor de la lista de tejidos, con el campo vacio: es EL dato que falta.
    if (TEJIDOS.has(t)) {
      if (tejidoVacio) pistaFija = `es el tipo de tejido: va en "Tipo de tejido" (hoja 1), que está vacío`
      else if (norm(c.TP_TEJIDO) === t) motivo = 'ya está en "Tipo de tejido"'
      else pistaFija = `dice ${t} pero "Tipo de tejido" dice ${norm(c.TP_TEJIDO)}: confirma cuál es`
    } else if (/\b(BULTO|CAJA)S?\b/.test(t) && /\b(SE VA|VA|SE EMBARCA|EMBARCA|SALE)\b/.test(t)) {
      // Solo la frase SIMPLE ("SE VA EN BULTO") puede darse por acomodada; con
      // una negacion, las dos palabras o una cantidad, lo decide una persona.
      const simple = /^(SE VA|VA|SE EMBARCA|EMBARCA|SALE) EN (BULTO|CAJA)S?$/.test(t)
      const en = /BULTO/.test(t) ? 'BULTO' : 'CAJA'
      if (simple && !embalajeVacio && norm(c.TP_EMBALAJE) === en) motivo = 'ya está en "Se embarca en"'
      else if (simple && embalajeVacio) pistaFija = `dice en qué se embarca: va en "Se embarca en" (hoja 6) = ${en}`
      else pistaFija = 'habla de cómo se embarca: revísalo contra "Se embarca en" y las docenas (hoja 6)'
    }
    if (pistaFija) { reales.push({ ...x, pista: pistaFija }); continue }
    if (motivo) { /* ya decidido arriba */ }
    else if (ENCABEZADO.test(t)) motivo = 'es un encabezado de columna, no un dato'
    else if (/^#(REF|VALUE|N\/A|DIV\/0|NAME|NUM)!?/.test(t)) motivo = 'es un error de fórmula del Excel viejo'
    else if (PROCESOS.has(t) && enRuta.has(t)) motivo = 'ya está en la ruta de proceso'
    else if (FECHA.test(t)) motivo = 'es una fecha del archivo viejo'
    else if (yaEsta.has(t)) motivo = 'ya está en su lugar en la plantilla'
    else if (/^\d+ ?PACK$/.test(t) && packs && Number(t.match(/\d+/)[0]) === packs) motivo = 'ya está en pares por pack'
    else if (/^[A-Z]{3,10}$/.test(t) && String(x.celda || '') === 'L1' && /^ETIQUETA/.test(norm(x.hoja))) motivo = 'es el nombre de la maquila del pedido viejo'
    if (motivo) { ruido.push({ ...x, motivo }); continue }

    let pista = 'revísalo: RAGNAR no sabe a dónde va'
    const digitos = t.replace(/\D/g, '')
    // El OTRO modelo va primero: "SIX PACK PC70497" dentro del archivo del
    // PC70495 es un copiar y pegar, no un pack distinto (18-sep).
    const otroModelo = (t.match(/\b[A-Z]{2,5}\d{2,}[A-Z0-9-]*\b/g) || []).find((m) => m.length >= 5 && modelo && !modelo.includes(pelado(m)) && !pelado(m).includes(modelo))
    if (otroModelo) pista = `menciona OTRO modelo (${otroModelo}): puede ser un error de copiar y pegar en el Excel`
    else if (/^\d{12,14}$/.test(t.replace(/[\s/]/g, '')) || /\b\d{12,14}\b/.test(t)) pista = 'parece un UPC o código de barras: va en la columna UPC del código que le toca (hoja 1)'
    else if (/\bPACK\b|PACK$/.test(t) && /\d|UNI|TRI|SIX/.test(t)) pista = packs ? `habla de un pack distinto al capturado (${packs} pares por pack): confirma cuál es` : 'dice cuántos pares trae el pack: va en "Pares por pack" (hoja 1)'
    else if (/POR DISTRIBUCION/.test(t)) pista = 'es la cantidad de un avío ("por distribución"): va en el avío que le toca (hoja 3)'
    else if (PROCESOS.has(t)) pista = 'es un proceso: va en la ruta de proceso (hoja 2)'
    else if (/^(ROJO|AZUL|VERDE|GRIS|BLANCO|NEGRO|MARINO|BEIGE|ROSA|AMARILLO|MORADO|CAFE|NARANJA|OXFORD|HUESO|CREMA)\b/.test(t) || /\bTCX\b/.test(t)) pista = 'parece un color: va en color de cuerpo, bordado o hilo del código que le toca (hoja 2)'
    else if (/\b(X|POR) CADA\b|\bPOR (PACK|BOLSA|CAJA|PIEZA|PAR)\b|^(BOLSA|CAJA|CINTA|ETIQUETA|PLASTIFLECHA|GANCHO|CABALLETE|TRANSFER|STICKER)\b/.test(t)) pista = 'parece un avío o su cantidad: va en avíos (hoja 3)'
    else if (/^[\d.,+\s]+$/.test(t) && digitos.length >= 2) pista = 'es un número suelto (¿item, pedido o cantidad del pedido?): si es del pedido, no va en el tech pack'
    else if (/HILO|ALGODON|POLIESTER|NYLON|SPANDEX|POLICOTON|LYCRA/.test(t)) pista = 'es un material o hilo: va en hilo del código que le toca (hoja 2)'
    reales.push({ ...x, pista })
  }
  return { reales, ruido }
}
