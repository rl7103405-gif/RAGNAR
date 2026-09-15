/**
 * AJUSTA EL INVENTARIO DE AVIOS DE UNA MAQUILA A UN CONTEO FISICO.
 *
 * Roberto, 2026-09-15, con el conteo de Hugo que mando Cielo: "cambialo a lo
 * de hoy". EL CONTEO MANDA: el saldo final de cada codigo queda igual a lo
 * contado, y lo que RAGNAR tenia y no aparece en el conteo queda en 0.
 *
 * NO SE PISA EL SALDO. Igual que en la app (AjustarInventarioMaquila), por
 * cada codigo que cambia se escribe un movimiento 'ajuste_conteo' con la
 * DIFERENCIA, saldoAntes = el saldo vigente y saldoDespues = lo contado, y el
 * saldo apunta a ese movimiento. La cadena del libro sigue cuadrando.
 *
 * Uso (en web/):
 *   node scripts/ajustar_inventario_por_conteo.mjs <maquilaId> <archivo.xlsx> <hoja> <AAAA-MM-DD>
 *   EJECUTAR=1 node scripts/ajustar_inventario_por_conteo.mjs ...     <- escribe de verdad
 *
 * Seguro de repetir: el id del movimiento es conteo_<fecha>_<codigo>; si ya
 * existe, ese codigo se salta. Cada codigo se escribe en una TRANSACCION que
 * relee el saldo y exige que siga apuntando al mismo ultimo movimiento.
 */
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const EJECUTAR = process.env.EJECUTAR === '1'
const FIRMA_UID = 'ajuste-conteo-maquila'
const FIRMA_NOMBRE = 'Ajuste por conteo fisico de maquila'

const [maquilaId, archivo, nombreHoja, fecha] = process.argv.slice(2)
if (!maquilaId || !archivo || !nombreHoja || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) {
  console.error('Uso: node scripts/ajustar_inventario_por_conteo.mjs <maquilaId> <archivo.xlsx> <hoja> <AAAA-MM-DD>')
  process.exit(1)
}

// LA MISMA normalizacion que el catalogo de avios (importar_catalogo_avios.mjs,
// Avios.jsx y cargar_inventario_inicial.mjs): espacios -> guion. Si no, los
// SRFID no cruzan con el catalogo.
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const normalizarCodigo = (v) =>
  sinAcentos(v).trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._-]/g, '').slice(0, 60)
const texto = (v) => (v == null ? '' : typeof v === 'object' ? String(v.result ?? v.text ?? '') : String(v))
const numeroDe = (v) => {
  if (v == null) return null
  if (typeof v === 'object') {
    if (v instanceof Date || !('result' in v) || typeof v.result === 'object') return null
    return Number.isFinite(Number(v.result)) ? Number(v.result) : null
  }
  const n = Number(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : null
}

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()

const maq = await db.collection('maquilas').doc(maquilaId).get()
if (!maq.exists || maq.data().esPrueba) {
  console.error(`La maquila ${maquilaId} no existe o es de prueba.`)
  process.exit(1)
}

// --- el conteo ---
const libro = new ExcelJS.Workbook()
await libro.xlsx.readFile(archivo)
const hoja = libro.worksheets.find((h) => h.name.trim().toUpperCase() === nombreHoja.trim().toUpperCase())
if (!hoja) {
  console.error(`No existe la hoja "${nombreHoja}". Hay: ${libro.worksheets.map((h) => h.name).join(', ')}`)
  process.exit(1)
}
let filaEnc = 0, colCodigo = 0, colCantidad = 0
for (let n = 1; n <= Math.min(6, hoja.rowCount) && !filaEnc; n++) {
  for (let c = 1; c <= 12; c++) {
    const t = sinAcentos(texto(hoja.getRow(n).getCell(c).value)).trim().toUpperCase()
    if (/^(CODIGO|CODIGOS|ARTICULO)$/.test(t)) colCodigo = c
    if (/^(CANTIDAD|PIEZAS|INVENTARIO( EN)? MAQUILA)$/.test(t)) colCantidad = c
  }
  if (colCodigo && colCantidad) filaEnc = n
  else colCodigo = colCantidad = 0
}
if (!filaEnc) {
  console.error('No encontre los encabezados CODIGO y CANTIDAD/PIEZAS en las primeras 6 filas.')
  process.exit(1)
}

const conteo = new Map()
const avisos = []
// Un renglon que SI vino pero no se pudo leer no es "no lo tiene": ese saldo
// no se toca, y con alguno asi no se aplica nada (code-reviewer, 15-sep).
const ilegibles = new Set()
for (let n = filaEnc + 1; n <= hoja.rowCount; n++) {
  const fila = hoja.getRow(n)
  const codigo = normalizarCodigo(texto(fila.getCell(colCodigo).value))
  if (!codigo || /^(TOTAL|TOTALES|SUMA)$/.test(codigo)) continue
  const cantidad = numeroDe(fila.getCell(colCantidad).value)
  if (cantidad === null || cantidad < 0) { ilegibles.add(codigo); avisos.push(`fila ${n} ${codigo}: cantidad ilegible, NO se toca`); continue }
  if (!Number.isInteger(cantidad)) { ilegibles.add(codigo); avisos.push(`fila ${n} ${codigo}: ${cantidad} no es entero, NO se toca`); continue }
  if (conteo.has(codigo)) {
    // Mismo criterio que la carga inicial: iguales = renglon copiado; distintos = se suman.
    const antes = conteo.get(codigo)
    avisos.push(antes === cantidad ? `${codigo}: renglon repetido igual (${cantidad}), cuenta una vez` : `${codigo}: dos renglones ${antes} + ${cantidad}, se suman`)
    if (antes !== cantidad) conteo.set(codigo, antes + cantidad)
    continue
  }
  conteo.set(codigo, cantidad)
}

// --- RAGNAR ---
const base = db.collection('portalMaquila').doc(maquilaId)
const catalogo = new Map((await db.collection('avios').get()).docs.map((d) => [normalizarCodigo(d.id), d.data()]))
const saldos = new Map((await base.collection('saldosAvios').get()).docs.map((d) => [d.id, d.data()]))

const codigos = [...new Set([...conteo.keys(), ...[...saldos.entries()].filter(([, s]) => Number(s.cantidad)).map(([c]) => c)])].sort()
const plan = []
for (const codigo of codigos) {
  if (ilegibles.has(codigo)) continue
  const crudo = Number(saldos.get(codigo)?.cantidad) || 0
  if (!Number.isInteger(crudo)) avisos.push(`${codigo}: el saldo de RAGNAR no era entero (${crudo})`)
  const actual = Math.trunc(crudo)
  const contado = conteo.has(codigo) ? conteo.get(codigo) : 0
  if (actual === contado) continue
  const cat = catalogo.get(codigo)
  plan.push({
    codigo,
    actual,
    contado,
    diferencia: contado - actual,
    unidad: saldos.get(codigo)?.unidad || cat?.unidad || 'piezas',
    descripcion: String(cat?.descripcion || saldos.get(codigo)?.descripcion || '').slice(0, 200),
    ultimoMovimientoId: saldos.get(codigo)?.ultimoMovimientoId ?? null,
    noContado: !conteo.has(codigo),
    sinCatalogo: !cat
  })
}

console.log(`${EJECUTAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)'} · ${maq.data().nombre} (${maquilaId}) · conteo del ${fecha} · hoja "${hoja.name}"`)
console.log(`Conteo: ${conteo.size} codigos · RAGNAR: ${saldos.size} saldos · cambian: ${plan.length}`)
for (const p of plan) {
  console.log(`  ${p.codigo.padEnd(22)} ${p.unidad.padEnd(9)} ${String(p.actual).padStart(6)} -> ${String(p.contado).padStart(6)}  (${p.diferencia > 0 ? '+' : ''}${p.diferencia})${p.noContado ? '  NO VIENE EN EL CONTEO -> 0' : ''}${p.sinCatalogo ? '  (no esta en el catalogo)' : ''}`)
}
const millares = plan.filter((p) => p.unidad === 'millares')
if (millares.length) console.log(`\nOJO: ${millares.map((p) => p.codigo).join(', ')} estan en MILLARES en RAGNAR; el conteo se toma en esa misma unidad.`)
if (avisos.length) console.log('\nAvisos del archivo:\n  ' + avisos.join('\n  '))

if (EJECUTAR && ilegibles.size) {
  console.log(`\nNO SE APLICA NADA: ${ilegibles.size} renglon(es) del conteo no se pudieron leer. Corrige el archivo y vuelve a correr.`)
  process.exit(1)
}
if (!EJECUTAR) {
  console.log(`\nEnsayo. Para aplicarlo: EJECUTAR=1 node scripts/ajustar_inventario_por_conteo.mjs ${maquilaId} "${archivo}" "${nombreHoja}" ${fecha}`)
  process.exit(0)
}

const origenId = `conteo_${fecha}_${maquilaId}`
const motivo = `Conteo fisico de la maquila del ${fecha} (${archivo.split(/[\\/]/).pop()}), enviado por Cielo. El conteo manda.`.slice(0, 300)
let hechos = 0, saltados = 0, fallidos = 0
for (const p of plan) {
  const movId = `conteo_${fecha.replace(/-/g, '')}_${p.codigo}`
  const refMov = base.collection('movimientosAvios').doc(movId)
  const refSaldo = base.collection('saldosAvios').doc(p.codigo)
  try {
    const r = await db.runTransaction(async (tx) => {
      const [mov, saldo] = await Promise.all([tx.get(refMov), tx.get(refSaldo)])
      if (mov.exists) {
        const grabado = mov.data().saldoDespues
        if (grabado !== p.contado) console.log(`  ${p.codigo}: YA se aplico un conteo de esta fecha que dejo ${grabado}, y este archivo pide ${p.contado}. Requiere otro ajuste a mano.`)
        return 'ya'
      }
      const vigente = saldo.exists ? Math.trunc(Number(saldo.data().cantidad) || 0) : 0
      // La cadena, no solo el numero: el saldo tiene que seguir apuntando al
      // mismo ultimo movimiento que se leyo al armar el plan.
      const ultimo = saldo.exists ? saldo.data().ultimoMovimientoId ?? null : null
      if (vigente !== p.actual || ultimo !== p.ultimoMovimientoId) throw new Error(`el saldo cambio mientras tanto (${p.actual} -> ${vigente}); corre el ensayo otra vez`)
      const ahora = Timestamp.now()
      tx.set(refMov, {
        maquilaId, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad,
        tipo: 'ajuste_conteo', cantidad: p.diferencia, saldoAntes: p.actual, saldoDespues: p.contado,
        origenTipo: 'conteo', origenId, motivo,
        hechoPorUid: FIRMA_UID, hechoPorNombre: FIRMA_NOMBRE, creadoEn: ahora
      })
      if (saldo.exists) tx.update(refSaldo, { cantidad: p.contado, ultimoMovimientoId: movId, actualizadoEn: ahora })
      else tx.set(refSaldo, { codigo: p.codigo, maquilaId, unidad: p.unidad, cantidad: p.contado, ultimoMovimientoId: movId, creadoEn: ahora, actualizadoEn: ahora })
      return 'ok'
    })
    if (r === 'ya') saltados++
    else hechos++
  } catch (err) {
    fallidos++
    console.log(`  ${p.codigo}: NO SE APLICO — ${err.message}`)
  }
}
console.log(`\nLISTO: ${hechos} ajustes · ${saltados} ya estaban · ${fallidos} fallidos`)
process.exit(fallidos ? 1 : 0)
