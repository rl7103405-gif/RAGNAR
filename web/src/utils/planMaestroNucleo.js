// EL NUCLEO DEL PLAN MAESTRO: normalizacion, clasificacion e identificadores.
//
// Vive aparte de planMaestro.js por una razon practica: aqui NO se importa
// Firebase. Todo lo de este archivo son funciones puras, asi que se pueden
// correr en Node contra el Excel real de Adrian sin levantar la app ni tocar
// produccion — que es como se verifico el lector antes de subir nada.
//
// planMaestro.js re-exporta todo esto, asi que quien ya importaba de alla no
// se entera del cambio.

/** Firestore acepta hasta 30 valores en un `in`. */
export const MAX_IN = 30

// ---------------------------------------------------------------------------
// Normalizacion
// ---------------------------------------------------------------------------
// El cruce OT del plan <-> OT del folio es TODO lo que sostiene el arbol. Si
// un lado dice '7887' y el otro 'OT 7887' o '07887', el arbol sale vacio y no
// hay ningun error que lo delate. Por eso ambos lados pasan por aqui.

/** OT normalizada: sin espacios, sin prefijos, sin ceros a la izquierda. */
export function normalizarOt(valor) {
  const texto = String(valor ?? '').trim().toUpperCase()
  if (!texto) return ''
  // Se quita un prefijo 'OT' pegado o separado.
  const sinPrefijo = texto.replace(/^OT[\s.:-]*/i, '')
  // Si trae sufijos separados por guion o barra se conservan: una OT '7887-A'
  // NO es la '7887'.
  const limpio = sinPrefijo.replace(/\s+/g, '')
  // Ceros a la izquierda: '07887' y '7887' son la misma OT.
  return limpio.replace(/^0+(?=\d)/, '')
}

/** OC normalizada. Se conservan los guiones: '24-49' es como la nombran. */
export function normalizarOc(valor) {
  return String(valor ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

/** Codigo de producto normalizado (mismo criterio que el resto de la app). */
export function normalizarCodigo(valor) {
  return String(valor ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * Clave canonica del texto del pedido, para cruzar el plan con el ruteo.
 *
 * Aqui NO se quitan guiones ni guiones bajos: en este negocio forman parte del
 * identificador ('7512_REPOSICION_7551' y '7512' son pedidos distintos). Lo
 * unico que se empareja es lo que cambia sin querer al copiar entre Exceles:
 * mayusculas, acentos y espacios de sobra.
 */
export function normalizarPedido(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    // Topado aqui y no en la escritura: idDePedido() (y con el, la LECTURA en
    // otResuelta.js y cruceProducto.js) tambien pasa la clave por esta misma
    // funcion. Si el tope viviera solo del lado de la escritura, una celda de
    // mas de 200 caracteres produciria un id distinto al que arma la lectura
    // y la OT dejaria de encontrarse. La regla de Firestore exige
    // size() <= 200 en pedidoClave; sin este tope, un pedido mas largo tumba
    // el LOTE COMPLETO de 400 escrituras con un permission-denied que no dice
    // que renglon fue.
    .slice(0, 200)
}

// ---------------------------------------------------------------------------
// Estados de la orden de compra
// ---------------------------------------------------------------------------
// El archivo real trae la columna OC vacia en la mayoria de los renglones, y
// ademas la usa como bitacora: hay '0' y hay 'FCST' (forecast, o sea que
// todavia no existe orden firme). Tratar esos dos como ordenes de compra
// pintaria en el arbol una OC llamada 'FCST' con 113 renglones, que no existe.
//
// Son TRES estados y la diferencia importa: 'sin' es un hueco que se va a
// llenar; 'invalida' es una marca del proceso de Adrian; solo 'valida' se
// dibuja como rama del arbol.
export const OC_VALIDA = 'valida'
export const OC_SIN = 'sin'
export const OC_INVALIDA = 'invalida'

/** Valores que aparecen en la columna OC y NO son ordenes de compra. */
const OC_NO_ES_ORDEN = new Set(['0', 'FCST', 'NA', 'N/A', '-', '--', 'SINOC', 'PENDIENTE', 'X'])

/**
 * Clasifica lo que venga en la columna OC.
 * Devuelve { estado, oc, bruto } — `oc` solo trae valor si el estado es valida.
 */
export function clasificarOc(valor) {
  const bruto = String(valor ?? '').trim()
  const oc = normalizarOc(bruto)
  if (!oc) return { estado: OC_SIN, oc: '', bruto }
  if (OC_NO_ES_ORDEN.has(oc)) return { estado: OC_INVALIDA, oc: '', bruto }
  // Una OC de mas de 40 caracteres no la acepta el servidor, y tampoco existe.
  if (oc.length > 40) return { estado: OC_INVALIDA, oc: '', bruto }
  return { estado: OC_VALIDA, oc, bruto }
}

// ---------------------------------------------------------------------------
// Identificadores de documento
// ---------------------------------------------------------------------------

/**
 * Escapa una parte para meterla en un id compuesto.
 *
 * Dos motivos: (1) sin escapar el separador, {oc:'A__B'} y {oc:'A', ot:'B'}
 * producirian el mismo id y una linea pisaria a la otra — regla dura que ya
 * nos mordio con el sincronizador de SICAP; (2) Firestore PROHIBE la barra en
 * un id de documento, y el archivo real trae pedidos como
 * '4788_ENTRYIRONMAN_ENTRYSPORT_UNISEX_L/XL'.
 */
function esc(valor) {
  return encodeURIComponent(String(valor ?? '')).replace(/_/g, '%5F')
}

/** ID de una linea del plan. */
export function idDeLinea({ versionId, oc, ot, codigo, sufijo = '' }) {
  return [versionId, oc, ot, codigo, sufijo].map(esc).join('__')
}

/** ID de una entrada del diccionario pedido -> OT. Determinista: es lo que
 *  permite resolver la OT de una captura con UNA lectura puntual. */
export function idDePedido(versionId, pedidoClave) {
  return [versionId, esc(normalizarPedido(pedidoClave))].join('__')
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

/**
 * Agrupa lineas por OC. Se usa al subir (para dejar el resumen guardado) y al
 * leer una version vieja que no lo traiga.
 */
export function resumirOcs(lineas) {
  const porOc = new Map()
  for (const l of lineas) {
    if (!l.oc) continue // una linea sin OC no forma una rama del arbol
    if (!porOc.has(l.oc)) {
      porOc.set(l.oc, { oc: l.oc, ots: new Set(), destinos: new Set(), lineas: 0, planeado: 0, sinMeta: 0 })
    }
    const g = porOc.get(l.oc)
    g.ots.add(l.ot)
    // A quien va: 'Modular Walmart Jun-Sep', 'Shasa RA Agosto'. Una OC casi
    // siempre trae uno solo, pero no se asume: se juntan los distintos.
    if (l.destino) g.destinos.add(l.destino)
    g.lineas += 1
    // Se suma SOLO lo que de verdad tiene meta. Contar una linea sin cantidad
    // como si fuera cero haria que el denominador del avance mienta hacia
    // arriba y la orden se vea mas adelantada de lo que esta.
    if (typeof l.cantidadPlaneada === 'number') g.planeado += l.cantidadPlaneada
    else g.sinMeta += 1
  }
  return [...porOc.values()]
    // Los dos arrays van topados: este resumen viaja dentro de UN documento de
    // Firestore (tope 1 MB) y una OC con cientos de OT lo inflaria. Se guarda
    // cuantas hubo en realidad para que la pantalla no mienta al truncar.
    .map((g) => ({
      ...g,
      totalOts: g.ots.size,
      ots: [...g.ots].sort().slice(0, 200),
      destinos: [...g.destinos].sort().slice(0, 6)
    }))
    .sort((a, b) => String(b.oc).localeCompare(String(a.oc), 'es', { numeric: true }))
}
