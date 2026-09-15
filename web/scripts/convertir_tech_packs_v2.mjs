/**
 * CONVIERTE LOS TECH PACKS DE LA PLANTILLA TP-QUINI v1 A v2 ("el tech pack
 * puro, sin OT"), EN SU LUGAR, CON AUDITORIA DATO POR DATO.
 *
 * Roberto, 2026-09-15: la v2 no lleva orden de compra, OT ni cantidades del
 * pedido, y en avios no lleva la columna ENVIAR. Lo que traian (OC, packs, OT
 * y docenas por codigo) queda oculto en _RAGNAR, clave 'pedidoAnterior'.
 *
 * Por cada archivo:
 *   1. se abre con ExcelJS; si no es plantilla o ya es v2, se salta;
 *   2. antes = leerPlantilla; se convierte (convertirLibroAV2), se guarda y se
 *      vuelve a abrir: despues = leerPlantilla;
 *   3. AUDITORIA: campos, tablas, fotos, imagenes y noMigrado IDENTICOS; en
 *      despues version 2, pedidoAnterior igual al que tenia el v1, estructura
 *      completa, hoja 1 sin G2/D7/F7/H7 y hoja 3 sin formulas en F. Cualquier
 *      diferencia = FALLA y ese archivo no se convierte.
 *
 * Uso (en web/):
 *   ORIGEN=local node scripts/convertir_tech_packs_v2.mjs "<carpeta con .xlsx>" [SALIDA="<carpeta>"]
 *     (SALIDA tambien se acepta como variable de entorno; ahi escribe los v2
 *      convertidos para abrirlos en Excel)
 *   ORIGEN=firestore node scripts/convertir_tech_packs_v2.mjs          <- ensayo, solo lee
 *   ORIGEN=firestore EJECUTAR=1 node scripts/convertir_tech_packs_v2.mjs
 *   SOLO=CODIGO1,CODIGO2   (opcional, en los dos modos)
 *
 * Con EJECUTAR=1 (solo firestore), por cada tech pack que pase la auditoria:
 *   a. respaldo de los pedazos v1 en techPacks/{codigo}/respaldoV1/tp-NN
 *      (verificado por sha256) y copia local en
 *      datos/tech-packs-v1-respaldo-2026-09-15/;
 *   b. sube los pedazos v2 y verifica su sha256;
 *   c. en una transaccion, con precondicion de que techPack.sha256 no cambio,
 *      actualiza techPack, medicion y pedidoAnterior. No toca cliente, marca
 *      ni modeloPlantilla.
 */
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { HOJAS, PLANTILLA, ZONAS_FOTO } from '../src/utils/plantillaTechPack.js'
import { esPlantilla, leerPedidoV1, leerPlantilla, medirPlantilla } from '../src/utils/leerPlantillaTechPack.js'
import { convertirLibroAV2 } from '../src/utils/convertirPlantillaV2.js'
import { idsDePedazos } from '../src/utils/pedazosTechPack.js'

const ORIGEN = String(process.env.ORIGEN || '').toLowerCase()
const argumentos = process.argv.slice(2)
const argSalida = argumentos.find((a) => /^SALIDA=/i.test(a))
const SALIDA = argSalida ? argSalida.replace(/^SALIDA=/i, '') : process.env.SALIDA || ''
const CARPETA = argumentos.find((a) => !/^SALIDA=/i.test(a))
const EJECUTAR = process.env.EJECUTAR === '1'
const SOLO = new Set(String(process.env.SOLO || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
const CHUNK_BYTES = 950000
const MAX_CHUNKS = 17
const QUIEN = { uid: 'migracion-tp-quini-v2', nombre: 'Plantilla TP-Quini v2 (automatica)' }
const VERSION_MEDICION = '2026-09-v3-plantilla-v2'
const MAX_RENGLONES_PEDIDO = 60
const RESPALDO_LOCAL = new URL('../../datos/tech-packs-v1-respaldo-2026-09-15/', import.meta.url)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const pad2 = (i) => String(i).padStart(2, '0')

if (ORIGEN !== 'local' && ORIGEN !== 'firestore') {
  console.error('Uso: ORIGEN=local node scripts/convertir_tech_packs_v2.mjs "<carpeta>" [SALIDA="<carpeta>"]\n     ORIGEN=firestore node scripts/convertir_tech_packs_v2.mjs')
  process.exit(1)
}
if (ORIGEN === 'local' && !CARPETA) { console.error('ORIGEN=local necesita la carpeta de los .xlsx'); process.exit(1) }
if (EJECUTAR && ORIGEN !== 'firestore') { console.error('EJECUTAR=1 solo aplica con ORIGEN=firestore (en local se usa SALIDA)'); process.exit(1) }

// ------------------------------------------------------------------ auditoria

/** Una diferencia legible entre dos valores (o null si son iguales). */
function diferencia(ruta, a, b) {
  if (isDeepStrictEqual(a, b)) return null
  const corto = (v) => { const t = v instanceof Date ? v.toISOString() : JSON.stringify(v); return String(t).slice(0, 80) }
  return `${ruta}: ${corto(a)} -> ${corto(b)}`
}

function auditar(antes, despues, pedidoV1, libro2) {
  const fallas = []
  const push = (d) => { if (d) fallas.push(d) }

  // Campos: todos iguales, salvo la marca (TP_PLANTILLA) que pasa a v2.
  const nombresCampos = new Set([...Object.keys(antes.campos), ...Object.keys(despues.campos)])
  for (const n of nombresCampos) {
    if (n === 'TP_PLANTILLA') continue
    push(diferencia(`campo ${n}`, antes.campos[n], despues.campos[n]))
  }
  if (despues.campos.TP_PLANTILLA !== PLANTILLA.marca) fallas.push(`campo TP_PLANTILLA: "${despues.campos.TP_PLANTILLA}" (se esperaba ${PLANTILLA.marca})`)

  // Tablas: renglon por renglon y clave por clave.
  const nombresTablas = new Set([...Object.keys(antes.tablas), ...Object.keys(despues.tablas)])
  for (const n of nombresTablas) {
    const ta = antes.tablas[n] || []
    const td = despues.tablas[n] || []
    if (ta.length !== td.length) fallas.push(`tabla ${n}: ${ta.length} renglones -> ${td.length}`)
    for (let i = 0; i < Math.max(ta.length, td.length); i++) {
      const claves = new Set([...Object.keys(ta[i] || {}), ...Object.keys(td[i] || {})])
      for (const k of claves) push(diferencia(`tabla ${n}[${i}].${k}`, ta[i]?.[k], td[i]?.[k]))
    }
  }

  // Fotos e imagenes.
  for (const z of Object.keys(ZONAS_FOTO)) {
    push(diferencia(`fotos ${z}`, antes.fotos[z], despues.fotos[z]))
    push(diferencia(`imagenesZona ${z} (cuantas)`, (antes.imagenesZona[z] || []).length, (despues.imagenesZona[z] || []).length))
  }
  push(diferencia('imagenesAvios (cuantas)', Object.keys(antes.imagenesAvios || {}).length, Object.keys(despues.imagenesAvios || {}).length))
  push(diferencia('noMigrado', antes.noMigrado, despues.noMigrado))

  // Lo que la v2 exige.
  if (despues.version !== 2) fallas.push(`version despues = ${despues.version}`)
  push(diferencia('pedidoAnterior', pedidoV1, despues.pedidoAnterior))
  if ((despues.faltaEstructura || []).length) fallas.push(`falta estructura: ${despues.faltaEstructura.join(', ')}`)
  const h1 = libro2.getWorksheet(HOJAS.pedido)
  for (const d of ['G2', 'D7', 'F7', 'H7']) {
    const v = h1?.getCell(d).value
    if (v !== null && v !== undefined && v !== '') fallas.push(`hoja 1 ${d} sigue con valor ${JSON.stringify(v).slice(0, 60)}`)
  }
  const h3 = libro2.getWorksheet(HOJAS.avios)
  h3?.eachRow({ includeEmpty: false }, (fila, f) => {
    const v = fila.getCell('F').value
    if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) fallas.push(`hoja 3 F${f} sigue con formula`)
  })
  return fallas
}

const resumenPedido = (p) => p ? `OC "${p.oc || ''}" · packs ${p.packs ?? '-'} · ${p.renglones.filter((r) => r.ot).length} renglon(es) con OT` : 'sin pedido v1'
const resumenMedida = (m) => `${m.porcentaje}%${m.detalle?.pedido?.length ? ` (pedido falta: ${m.detalle.pedido.join('; ')})` : ''}`

/**
 * Convierte y audita un archivo. Nunca lanza.
 * @returns {{ estado: 'saltado'|'falla'|'ok', motivo?: string, fallas?: string[], v2?: Buffer, ... }}
 */
async function procesar(buf) {
  try {
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.load(buf)
    if (!esPlantilla(libro)) return { estado: 'saltado', motivo: 'no es plantilla TP-Quini' }
    const antes = leerPlantilla(libro)
    if (antes.version >= 2) return { estado: 'saltado', motivo: 'ya es v2' }
    const pedidoV1 = leerPedidoV1(libro)
    const medidaAntes = medirPlantilla(antes)

    const r = convertirLibroAV2(libro)
    if (r.yaEraV2) return { estado: 'saltado', motivo: 'ya es v2' }
    const v2 = Buffer.from(await libro.xlsx.writeBuffer())
    const libro2 = new ExcelJS.Workbook()
    await libro2.xlsx.load(v2)
    const despues = leerPlantilla(libro2)
    const fallas = auditar(antes, despues, pedidoV1, libro2)
    const medidaDespues = medirPlantilla(despues)
    const fotos = (l) => Object.keys(ZONAS_FOTO).map((z) => l.fotos[z] ?? 0).join('/')
    return {
      estado: fallas.length ? 'falla' : 'ok',
      fallas,
      v2,
      hojas: libro2.worksheets.length,
      pedidoAnterior: despues.pedidoAnterior,
      medidaAntes,
      medidaDespues,
      cambios: r.cambios,
      linea: `fotos ${fotos(antes)} -> ${fotos(despues)} · ${resumenPedido(pedidoV1)} · medicion ${resumenMedida(medidaAntes)} -> ${resumenMedida(medidaDespues)} · ${buf.length} -> ${v2.length} bytes`
    }
  } catch (err) {
    return { estado: 'falla', fallas: [`error: ${(err?.message || String(err)).slice(0, 200)}`] }
  }
}

const cuenta = { ok: 0, falla: 0, saltado: 0, aplicado: 0, noAplicado: 0 }
const ejemplosFalla = []
function reportar(codigo, res, extra = '') {
  cuenta[res.estado]++
  const et = `  ${String(codigo).padEnd(26)}`
  if (res.estado === 'saltado') { console.log(`${et} se salta: ${res.motivo}`); return }
  if (res.estado === 'ok') { console.log(`${et} OK ${extra}· ${res.linea}`); return }
  console.log(`${et} FALLA ${extra}${res.linea ? '· ' + res.linea : ''}`)
  for (const f of res.fallas.slice(0, 8)) console.log(`      - ${f}`)
  if (res.fallas.length > 8) console.log(`      ... y ${res.fallas.length - 8} diferencia(s) mas`)
  ejemplosFalla.push({ codigo, fallas: res.fallas.slice(0, 3) })
}

// ---------------------------------------------------------------- ORIGEN=local
if (ORIGEN === 'local') {
  console.log(`ENSAYO LOCAL sobre ${CARPETA}${SALIDA ? ` · escribe los v2 en ${SALIDA}` : ' (sin SALIDA: no escribe nada)'}`)
  if (SALIDA) mkdirSync(SALIDA, { recursive: true })
  const archivos = readdirSync(CARPETA).filter((n) => /\.xlsx$/i.test(n) && !n.startsWith('~$') && statSync(join(CARPETA, n)).isFile()).sort()
  for (const nombre of archivos) {
    const codigo = basename(nombre, '.xlsx').replace(/^TECH PACK /i, '')
    if (SOLO.size && !SOLO.has(codigo.toUpperCase())) continue
    const res = await procesar(readFileSync(join(CARPETA, nombre)))
    reportar(codigo, res)
    // Solo se escriben los que pasaron la auditoria.
    if (SALIDA && res.estado === 'ok') writeFileSync(join(SALIDA, nombre), res.v2)
  }
}

// ------------------------------------------------------------ ORIGEN=firestore
if (ORIGEN === 'firestore') {
  const { initializeApp, cert } = await import('firebase-admin/app')
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore')
  initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
  const db = getFirestore()
  console.log(EJECUTAR ? 'APLICANDO (escribe en la biblioteca real)' : 'ENSAYO FIRESTORE (solo lee)')

  const aBuffer = (v) => Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v)
  const pedazos = async (ref, sub) => (await ref.collection(sub).get()).docs.filter((d) => d.id.startsWith('tp-')).sort((a, b) => a.id.localeCompare(b.id))
  async function bajarVerificado(ref, sub, m) {
    // Ids viejos ('tp-00') o con la huella ('tp-<hex>-00', desde el 15-sep).
    const todos = await pedazos(ref, sub)
    const porId = new Map(todos.map((d) => [d.id, d]))
    const docs = idsDePedazos(new Set(porId.keys()), 'tp', m).ids.map((id) => porId.get(id)).filter(Boolean)
    if (docs.length !== m.totalChunks) return { error: `trae ${docs.length} pedazos y el manifiesto dice ${m.totalChunks}` }
    const buf = Buffer.concat(docs.map((d) => aBuffer(d.data().datos)))
    if (m.tamano && buf.length !== m.tamano) return { error: `pesa ${buf.length} y el manifiesto dice ${m.tamano}` }
    if (!m.sha256 || sha(buf) !== m.sha256) return { error: 'la huella sha256 no coincide' }
    return { buf }
  }
  async function subirPedazos(ref, sub, codigo, buf) {
    const total = Math.ceil(buf.length / CHUNK_BYTES)
    for (let i = 0; i < total; i++) {
      await ref.collection(sub).doc(`tp-${pad2(i)}`).set({ codigo, tipo: 'tp', datos: buf.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
    }
    // Pedazos 'tp-' de mas (el archivo anterior era mas grande) se borran.
    // Y los que traen la huella de un archivo anterior ('tp-<hex>-00').
    for (const d of await pedazos(ref, sub)) if (!/^tp-\d{2}$/.test(d.id) || Number(d.id.split('-')[1]) >= total) await d.ref.delete()
    return total
  }

  const snap = await db.collection('techPacks').get()
  const docs = snap.docs.filter((d) => !d.data().apuntaA && d.data().techPack?.formato === 'xlsx' && d.data().techPack?.totalChunks).sort((a, b) => a.id.localeCompare(b.id))
  if (EJECUTAR) mkdirSync(RESPALDO_LOCAL, { recursive: true })

  for (const d of docs) {
    const codigo = d.id
    if (SOLO.size && !SOLO.has(codigo.toUpperCase())) continue
    const data = d.data()
    const tp = data.techPack
    const marcaPrueba = data.esPrueba ? '[prueba] ' : ''
    const original = await bajarVerificado(d.ref, 'chunks', tp)
    if (original.error) { reportar(codigo, { estado: 'falla', fallas: [`NO SE LEE: ${original.error}`] }, marcaPrueba); continue }
    const res = await procesar(original.buf)
    if (res.estado === 'ok' && Math.ceil(res.v2.length / CHUNK_BYTES) > MAX_CHUNKS) {
      res.estado = 'falla'
      res.fallas = [`el v2 pesa ${res.v2.length} bytes (> ${MAX_CHUNKS} pedazos)`]
    }
    reportar(codigo, res, marcaPrueba)
    if (!EJECUTAR || res.estado !== 'ok') continue

    // --- EJECUTAR=1: respaldo, subida y manifiesto -------------------------
    try {
      // a. Respaldo v1 (si ya hay uno identico de una corrida anterior, se deja).
      const previo = await bajarVerificado(d.ref, 'respaldoV1', tp)
      if (previo.error) {
        await subirPedazos(d.ref, 'respaldoV1', codigo, original.buf)
        const vuelta = await bajarVerificado(d.ref, 'respaldoV1', tp)
        if (vuelta.error) throw new Error(`el respaldo v1 en Firestore no verifica (${vuelta.error}); no se toca el oficial`)
      }
      writeFileSync(new URL(`${encodeURIComponent(codigo)}__${encodeURIComponent(String(tp.nombre || 'tech-pack.xlsx').replace(/[\\/:*?"<>|]+/g, '-'))}`, RESPALDO_LOCAL), original.buf)

      // Justo antes de pisar los pedazos: el manifiesto sigue siendo el que se leyo.
      const vivo = (await d.ref.get()).data()?.techPack
      if (vivo?.sha256 !== tp.sha256) throw new Error('el tech pack cambio mientras se convertia; no se toca')

      // b. Pedazos v2, verificados.
      const shaV2 = sha(res.v2)
      const totalV2 = await subirPedazos(d.ref, 'chunks', codigo, res.v2)
      const subido = await bajarVerificado(d.ref, 'chunks', { totalChunks: totalV2, tamano: res.v2.length, sha256: shaV2 })
      if (subido.error) throw new Error(`lo subido no verifica (${subido.error}); el respaldo v1 esta en respaldoV1`)

      // c. Manifiesto, medicion y pedidoAnterior, con precondicion.
      const p = res.pedidoAnterior
      const pedidoAnterior = p ? { ...p, renglones: (p.renglones || []).slice(0, MAX_RENGLONES_PEDIDO) } : null
      const aplicado = await db.runTransaction(async (tx) => {
        const actual = await tx.get(d.ref)
        if (actual.data()?.techPack?.sha256 !== tp.sha256) return false
        tx.update(d.ref, {
          techPack: { ...tp, nombre: tp.nombre, tamano: res.v2.length, totalChunks: totalV2, sha256: shaV2, version: (tp.version || 1) + 1, subidoEn: FieldValue.serverTimestamp(), subidoPorUid: QUIEN.uid, subidoPorNombre: QUIEN.nombre },
          medicion: { ...res.medidaDespues, hojas: res.hojas, version: VERSION_MEDICION, medidoEn: new Date() },
          pedidoAnterior
        })
        return true
      })
      if (aplicado) { cuenta.aplicado++; console.log(`      aplicado: ${totalV2} pedazos, sha ${shaV2.slice(0, 12)}`) }
      else { cuenta.noAplicado++; console.log('      NO aplicado: el manifiesto cambio durante la subida (revisar a mano; respaldo v1 en respaldoV1)') }
    } catch (err) {
      cuenta.noAplicado++
      console.log(`      ERROR al aplicar: ${(err?.message || String(err)).slice(0, 200)}`)
    }
  }
}

// ---------------------------------------------------------------- resumen
console.log(`\nconvertibles (auditoria limpia): ${cuenta.ok} | FALLA: ${cuenta.falla} | saltados (no plantilla o ya v2): ${cuenta.saltado}`)
if (EJECUTAR) console.log(`aplicados: ${cuenta.aplicado} | no aplicados: ${cuenta.noAplicado}`)
if (ejemplosFalla.length) {
  console.log('Fallas:')
  for (const e of ejemplosFalla) console.log(`  ${e.codigo}: ${e.fallas.join(' | ')}`)
}
if (ORIGEN === 'firestore' && !EJECUTAR) console.log('\nEnsayo. Para aplicarlo:  ORIGEN=firestore EJECUTAR=1 node scripts/convertir_tech_packs_v2.mjs')
if (ORIGEN === 'local' && SALIDA) console.log(`\nLos v2 que pasaron la auditoria quedaron en ${SALIDA}`)
process.exit(0)
