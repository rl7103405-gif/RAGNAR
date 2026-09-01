/**
 * Paridad de claves del catalogo entre el FRONT y la CLOUD FUNCTION.
 *
 * El catalogo se guarda repartido en 64 shards. Quien escribe
 * (`functions/productos.js`, y antes `cargar_catalogo.mjs`) y quien lee
 * (`web/src/utils/datosDelCatalogo.js`, `cruceProducto.js`) tienen que
 * calcular EXACTAMENTE el mismo shard y la misma clave de campo para cada
 * codigo. Si se separan, el catalogo queda escrito donde nadie lo busca: la
 * app no truena, simplemente deja de encontrar productos y la captura empieza
 * a salir sin descripcion, modelo ni talla.
 *
 * Las funciones estan duplicadas a proposito (el front es ESM, functions es
 * CommonJS). Esta prueba es lo que hace que esa duplicacion sea segura.
 *
 *   node web/scripts/verificar_claves_catalogo.mjs
 *
 * Sale con codigo 1 si difieren, para poder colgarlo de un hook si se quiere.
 */
import { createRequire } from 'module'
import {
  NUM_SHARDS_CATALOGO,
  fnv1a,
  shardDeCodigo,
  claveDeCodigo
} from '../src/utils/catalogoClaves.js'

const require = createRequire(import.meta.url)
const fn = require('../../functions/productos.js')._internos

// Codigos reales y casos borde que ya mordieron alguna vez: el '#' y el punto
// del inicio, el guion, minusculas, acentos y un vacio.
const CASOS = [
  '#7081-G',
  '.809',
  '6171-.B',
  'WKDSS26Q211',
  'GRDS-099',
  'SFT106',
  'SFT419',
  '1506-I',
  '7934-J',
  'A',
  'a',
  'Ñ-01',
  'CÓDIGO CON ESPACIO',
  '0',
  '__proto__',
  'x'.repeat(60)
]

// Ademas de los casos a mano, un barrido generado: si el hash difiere solo en
// ciertos rangos de caracteres, 16 casos podrian no verlo.
const generados = []
for (let i = 0; i < 2000; i++) {
  generados.push('P' + i.toString(36).toUpperCase() + (i % 7 === 0 ? '-.' : ''))
}

let fallas = 0
const reportar = (msg) => {
  console.error('  ✗ ' + msg)
  fallas++
}

if (NUM_SHARDS_CATALOGO !== fn.NUM_SHARDS_CATALOGO) {
  reportar(
    `NUM_SHARDS_CATALOGO difiere: front=${NUM_SHARDS_CATALOGO} function=${fn.NUM_SHARDS_CATALOGO}`
  )
}

for (const codigo of [...CASOS, ...generados]) {
  if (fnv1a(codigo) !== fn.fnv1a(codigo)) {
    reportar(`fnv1a difiere en ${JSON.stringify(codigo)}: ${fnv1a(codigo)} vs ${fn.fnv1a(codigo)}`)
  }
  if (shardDeCodigo(codigo) !== fn.shardDeCodigo(codigo)) {
    reportar(
      `shard difiere en ${JSON.stringify(codigo)}: ${shardDeCodigo(codigo)} vs ${fn.shardDeCodigo(codigo)}`
    )
  }
  if (claveDeCodigo(codigo) !== fn.claveDeCodigo(codigo)) {
    reportar(
      `clave difiere en ${JSON.stringify(codigo)}: ${claveDeCodigo(codigo)} vs ${fn.claveDeCodigo(codigo)}`
    )
  }
}

// La clave tiene que ser INYECTIVA: dos codigos distintos no pueden acabar en
// el mismo nombre de campo, o uno pisaria al otro dentro del shard.
const vistas = new Map()
for (const codigo of [...CASOS, ...generados]) {
  const clave = claveDeCodigo(codigo)
  if (vistas.has(clave) && vistas.get(clave) !== codigo) {
    reportar(`clave repetida: ${JSON.stringify(codigo)} y ${JSON.stringify(vistas.get(clave))} -> ${clave}`)
  }
  vistas.set(clave, codigo)
}

// El nombre de campo resultante debe ser valido para Firestore: sin puntos
// (separador de ruta) y sin la forma reservada __x__.
for (const codigo of [...CASOS, ...generados]) {
  const clave = claveDeCodigo(codigo)
  if (clave.includes('.') || clave.includes('/') || /^__.*__$/.test(clave)) {
    reportar(`clave invalida para Firestore en ${JSON.stringify(codigo)}: ${clave}`)
  }
}

// --- El mapeo de columnas de Atalanta, que es el otro punto donde se rompe ---
const FILA = {
  CodigoProducto: '#7081-G',
  Articulo: 'PANTUFLETA NIÑOS',
  Descripcion: 'PFMINNIROSROS',
  Talla: '13',
  Color: 'ROSA',
  Referencia: 'DISNEY',
  Linea_Producto: 'DISNEY',
  NoCategoria: 2
}
const t = fn.traducir(FILA)
if (t.error) {
  reportar('traducir() rechazo una fila valida: ' + t.error)
} else {
  const esperado = {
    codigo: '#7081-G',
    descripcion: 'PANTUFLETA NIÑOS',
    modelo: 'PFMINNIROSROS', // Descripcion de SQL -> modelo. NO es un typo.
    talla: '13',
    color: 'ROSA',
    referencia: 'DISNEY',
    linea: 'DISNEY'
  }
  for (const [k, v] of Object.entries(esperado)) {
    if (t.datos[k] !== v) reportar(`traducir(): ${k} = ${JSON.stringify(t.datos[k])}, se esperaba ${JSON.stringify(v)}`)
  }
  const sobrantes = Object.keys(t.datos).filter((k) => !(k in esperado))
  if (sobrantes.length) reportar('traducir() agrego campos no esperados: ' + sobrantes.join(', '))
}

// Minusculas -> el catalogo se guarda en MAYUSCULAS o la captura no lo halla.
const min = fn.traducir({ CodigoProducto: 'sft106' })
if (min.error || min.datos.codigo !== 'SFT106') {
  reportar('traducir() no paso el codigo a mayusculas: ' + JSON.stringify(min))
}
// Vacios -> null, no ''.
const vac = fn.traducir({ CodigoProducto: 'X', Articulo: '   ', Talla: '' })
if (vac.error || vac.datos.descripcion !== null || vac.datos.talla !== null) {
  reportar('traducir() no normalizo los vacios a null: ' + JSON.stringify(vac))
}
// Sin codigo -> se rechaza, no se guarda con clave vacia.
for (const malo of [{}, { CodigoProducto: '' }, { CodigoProducto: '   ' }, { CodigoProducto: null }, null, 'texto', []]) {
  if (!fn.traducir(malo).error) reportar('traducir() acepto una fila invalida: ' + JSON.stringify(malo))
}

// texto(): tope de longitud, para no reventar el limite de 1 MiB de un shard
// con un valor gigante en una sola fila.
const largo = fn.texto('x'.repeat(500))
if (!largo || largo.length > 250) {
  reportar(`texto() no acoto un valor largo: longitud resultante ${largo ? largo.length : largo}`)
}
const corto = fn.texto('  ABC  ')
if (corto !== 'ABC') {
  reportar(`texto() no limpio un valor corto normal: ${JSON.stringify(corto)}`)
}
const filaLarga = fn.traducir({ CodigoProducto: 'Y', Articulo: 'z'.repeat(500) })
if (filaLarga.error || !filaLarga.datos.descripcion || filaLarga.datos.descripcion.length > 250) {
  reportar('traducir() no acoto un Articulo largo: ' + JSON.stringify(filaLarga))
}

// versionDesdeSync: nada de ids con '/' ni relativos.
for (const [entrada, ok] of [
  ['2026-08-31T02:00', true],
  ['a/b', true],
  ['..', true],
  ['', false]
]) {
  const v = fn.versionDesdeSync(entrada)
  if (ok && (!v || v.includes('/') || v.length > 120)) {
    reportar(`versionDesdeSync(${JSON.stringify(entrada)}) devolvio algo invalido: ${v}`)
  }
  if (!ok && v) reportar(`versionDesdeSync(${JSON.stringify(entrada)}) debio ser null y dio ${v}`)
}

if (fallas === 0) {
  console.log(`OK: front y function calculan igual (${CASOS.length + generados.length} codigos) y el mapeo de columnas es el esperado.`)
  process.exit(0)
}
console.error(`\n${fallas} diferencia(s). NO desplegar hasta resolverlas.`)
process.exit(1)
