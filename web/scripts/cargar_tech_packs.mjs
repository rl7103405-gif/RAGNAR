/**
 * Carga MASIVA de tech packs a la biblioteca de RAGNAR desde la carpeta bajada
 * del Drive (`02 FICHAS TECNICAS`), LIGANDO cada uno a las ordenes de trabajo.
 *
 * COMO SE LIGA (hallazgo del 03-09-2026): el plan maestro de Adrian conoce
 * la mayoria de los disenos por su FOLIO DE FICHA (1561-I, 2711), no por el
 * nombre del tech pack. En el Drive, cada carpeta es un diseno y adentro
 * conviven el tech pack, la ficha (`FICHA1561-I,1562-I,1563-I.xlsx`,
 * `Fichas 2711.xlsx`, `1500-I 1501-I 1502-I`), los .PAS y el virtual. Asi que:
 *
 *   1. Por cada carpeta con un archivo TECH PACK:
 *      - codigo REAL = lo que sigue a "TECH PACK" en el nombre; si la carpeta
 *        se llama "talla 4-6", se le pega "-4-6" para que cada talla sea su
 *        propio documento (cada talla tiene su propia ficha y su propia OT).
 *      - folios = todos los NNN-L / NNNN-L / NNNN que aparezcan en nombres de
 *        archivos de esa carpeta que NO sean el tech pack, el virtual ni .PAS.
 *   2. Se sube el archivo UNA vez bajo techPacks/{codigo real}.
 *   3. Por cada folio se crea un ALIAS techPacks/{folio} con `apuntaA` al
 *      codigo real (sin archivo). El pegado por OT sigue el puntero.
 *
 * Escribe EXACTAMENTE lo que escribe la app: documento + chunks tp-NN de
 * 950 KB + manifiesto con sha256. Solo cuentas REALES (esPrueba:false).
 *
 * Uso (en web/):
 *   node scripts/cargar_tech_packs.mjs "C:\Users\elita\Desktop\techpacks-drive"           <- ensayo
 *   EJECUTAR=1 node scripts/cargar_tech_packs.mjs "..."                                    <- sube
 *   SOLO=WKD25L103,SFT104   REEMPLAZAR=1   (opcionales)
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const CARPETA = process.argv[2]
if (!CARPETA) {
  console.error('Uso: node scripts/cargar_tech_packs.mjs "<carpeta con los tech packs>"')
  process.exit(1)
}
const EJECUTAR = process.env.EJECUTAR === '1'
const REEMPLAZAR = process.env.REEMPLAZAR === '1'
const SOLO = new Set(String(process.env.SOLO || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))

const CHUNK_BYTES = 950000
const MAX_BYTES = 15728640
const MAX_CHUNKS = 17
const QUIEN = { uid: 'carga-drive-2026-09', nombre: 'Carga desde Drive (02 FICHAS TECNICAS) por Claude' }

// ------------------------------------------------------------ recorrer carpetas
const carpetas = new Map() // ruta -> { archivos: [nombre] }
function recorrer(dir) {
  const hijos = readdirSync(dir)
  const archivos = []
  for (const nombre of hijos) {
    const ruta = join(dir, nombre)
    const st = statSync(ruta)
    if (st.isDirectory()) recorrer(ruta)
    else if (!nombre.startsWith('~$')) archivos.push({ nombre, ruta, bytes: st.size })
  }
  if (archivos.length) carpetas.set(dir, archivos)
}
recorrer(CARPETA)

const esTechPack = (n) => /^TECH\s*PACK/i.test(n) && ['.xlsx', '.pdf'].includes(extname(n).toLowerCase())
const esVirtual = (n) => /VIRTUAL/i.test(n)
const esPas = (n) => /\.pas$/i.test(n)
// Folio: 3-4 digitos, opcional -LETRA, y que NO venga pegado a un guion o letra
// anterior (asi el '006' de 'CATM-FW18-006' no cuenta como folio).
const FOLIO_RE = /(?<![A-Z0-9-])(\d{3,4}(?:-[A-Z]{1,2})?)(?![A-Z0-9-])/gi

function codigoDe(nombreTP, carpeta) {
  let resto = basename(nombreTP, extname(nombreTP)).replace(/^TECH\s*PACK\s*/i, '').trim().replace(/\s+/g, ' ')
  resto = resto.replace(/\s*\(\d+\)$/, '').replace(/\.xlsx$/i, '').trim()
  // talla en el nombre ("... TALLA 4-6") o en la carpeta ("talla 4-6")
  let talla = null
  const mT = /\bTALLA\s*(\d{1,2}-\d{1,2})$/i.exec(resto) || /^(\S+)\s+(\d{1,2}-\d{1,2})$/.exec(resto)
  if (mT) { talla = mT[mT.length - 1]; resto = resto.replace(/\s*\bTALLA\s*\d{1,2}-\d{1,2}$/i, '').replace(/\s+\d{1,2}-\d{1,2}$/, '').trim() }
  const mC = /^talla\s*(\d{1,2}-\d{1,2})$/i.exec(basename(carpeta))
  if (mC) talla = mC[1]
  if (/^\d{4,}$/.test(resto) || /^PO\s+\d+/i.test(resto)) return { codigo: null, motivo: 'el nombre es un numero de pedido' }
  if (/\s/.test(resto)) {
    // "CIG82 513092001" -> CIG82-513092001 ; "S04-AZUL COMBO" no se adivina
    if (/^\S+\s+\d{6,}$/.test(resto)) resto = resto.replace(/\s+/, '-')
    else return { codigo: null, motivo: `el nombre trae palabras ("${resto}")` }
  }
  let codigo = resto.toUpperCase().replace(/[^A-Z0-9._-]/g, '')
  if (talla) codigo += '-' + talla
  if (!codigo || codigo.length > 60) return { codigo: null, motivo: 'codigo vacio o demasiado largo' }
  return { codigo }
}

const plan = [] // { codigo, ruta, nombre, bytes, folios[], carpetaRel, estado, motivo }
const sinCodigo = []
for (const [dir, archivos] of carpetas) {
  const tps = archivos.filter((a) => esTechPack(a.nombre))
  if (!tps.length) continue
  const folios = new Set()
  for (const a of archivos) {
    if (esTechPack(a.nombre) || esVirtual(a.nombre) || esPas(a.nombre)) continue
    const base = basename(a.nombre, extname(a.nombre))
    // solo nombres que huelen a ficha: contienen FICHA o son puros folios
    if (!/FICHA/i.test(base) && !/^[\d\s,\-A-Z]+$/i.test(base)) continue
    for (const m of base.matchAll(FOLIO_RE)) folios.add(m[1].toUpperCase())
  }
  const carpetaRel = relative(CARPETA, dir).replace(/\\/g, '/')
  for (const tp of tps) {
    let { codigo, motivo } = codigoDe(tp.nombre, dir)
    let deCarpeta = false
    if (!codigo) {
      // El nombre del archivo no sirve ("2408 DAMA", "PO 4504345772"), pero la
      // CARPETA casi siempre es el diseno: RB10T100, CIW12-513091001, CID93.
      const carpeta = basename(dir).trim().toUpperCase()
      const padre = basename(join(dir, '..')).trim().toUpperCase()
      const esTalla = /^TALLA\s*\d/i.test(basename(dir))
      const candidata = esTalla ? padre : carpeta
      if (/^[A-Z0-9][A-Z0-9._-]{2,59}$/.test(candidata) && !/^\d+$/.test(candidata)) {
        codigo = candidata
        const mC = /^TALLA\s*(\d{1,2}-\d{1,2})$/i.exec(basename(dir))
        if (mC) codigo += '-' + mC[1]
        deCarpeta = true
      }
    }
    if (!codigo) { sinCodigo.push({ ...tp, carpetaRel, motivo, folios: [...folios] }); continue }
    if (SOLO.size && !SOLO.has(codigo)) continue
    const estado = tp.bytes > MAX_BYTES ? 'pesado' : 'ok'
    plan.push({ codigo, ruta: tp.ruta, nombre: tp.nombre, bytes: tp.bytes, folios: [...folios], carpetaRel, estado, mtime: statSync(tp.ruta).mtimeMs, deCarpeta })
  }
}
// copias del mismo codigo: gana la mas reciente
const porCodigo = new Map()
for (const p of plan.filter((p) => p.estado === 'ok')) {
  const prev = porCodigo.get(p.codigo)
  if (!prev || p.mtime > prev.mtime) porCodigo.set(p.codigo, p)
}
// un folio no puede apuntar a dos codigos distintos
const dueñoDeFolio = new Map()
for (const p of porCodigo.values()) for (const f of p.folios) {
  if (dueñoDeFolio.has(f) && dueñoDeFolio.get(f) !== p.codigo) p.conflictos = [...(p.conflictos || []), `${f} tambien en ${dueñoDeFolio.get(f)}`]
  else dueñoDeFolio.set(f, p.codigo)
}

const mb = (b) => (b / 1048576).toFixed(1) + ' MB'
console.log(`Carpetas con tech pack: ${[...porCodigo.values()].length} disenos | archivos sin codigo: ${sinCodigo.length}`)
console.log('\nSE SUBEN (codigo <- archivo | folios que se ligan):')
for (const p of [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
  console.log(`  ${p.codigo.padEnd(28)} <- ${p.nombre} (${mb(p.bytes)})  [${p.carpetaRel}]  folios: ${p.folios.join(', ') || '— ninguno'}${p.deCarpeta ? '  (codigo tomado de la carpeta)' : ''}${p.conflictos ? '  ⚠ ' + p.conflictos.join('; ') : ''}`)
}
const pesados = plan.filter((p) => p.estado === 'pesado')
if (pesados.length) { console.log('\nPESADOS (>15 MB, exportar a PDF):'); pesados.forEach((p) => console.log(`  ${p.codigo} <- ${p.nombre} (${mb(p.bytes)}) [${p.carpetaRel}]`)) }
if (sinCodigo.length) { console.log('\nSIN CODIGO (que Lety diga cual es):'); sinCodigo.forEach((p) => console.log(`  ${p.nombre} [${p.carpetaRel}] -- ${p.motivo}; folios en la carpeta: ${p.folios.join(', ') || '—'}`)) }
const sinFolio = [...porCodigo.values()].filter((p) => !p.folios.length)
console.log(`\nResumen: ${porCodigo.size} a subir (${sinFolio.length} sin folio de ficha: se ligan solo por nombre) | ${pesados.length} pesados | ${sinCodigo.length} sin codigo | alias a crear: ${dueñoDeFolio.size}`)

if (!EJECUTAR) { console.log('\nEnsayo. Para subir de verdad: EJECUTAR=1 node scripts/cargar_tech_packs.mjs "<carpeta>"'); process.exit(0) }

// ------------------------------------------------------------ subir
const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()
const ahora = () => FieldValue.serverTimestamp()
const base = (codigo, extra) => ({
  codigo, descripcion: '', techPack: null, ftt: null,
  creadoEn: ahora(), creadoPorUid: QUIEN.uid, creadoPorNombre: QUIEN.nombre,
  actualizadoEn: ahora(), actualizadoPorUid: QUIEN.uid, actualizadoPorNombre: QUIEN.nombre,
  esPrueba: false, ...extra
})

let subidos = 0, saltados = 0, aliases = 0
for (const p of [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
  const ref = db.doc(`techPacks/${p.codigo}`)
  const actual = await ref.get()
  if (actual.exists && actual.data().techPack && !REEMPLAZAR) {
    console.log(`= ${p.codigo}: ya tiene tech pack, se salta`)
    saltados++
  } else {
    const bytes = readFileSync(p.ruta)
    const totalChunks = Math.ceil(bytes.length / CHUNK_BYTES)
    if (totalChunks > MAX_CHUNKS) { console.log(`! ${p.codigo}: rebasa 17 chunks`); continue }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const formato = extname(p.nombre).toLowerCase() === '.pdf' ? 'pdf' : 'xlsx'
    if (!actual.exists) await ref.set(base(p.codigo, { descripcion: `Drive: ${p.carpetaRel}`.slice(0, 200) }))
    for (let i = 0; i < totalChunks; i++) {
      await db.doc(`techPacks/${p.codigo}/chunks/tp-${String(i).padStart(2, '0')}`).set({ codigo: p.codigo, tipo: 'tp', datos: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
    }
    const sobr = await db.collection(`techPacks/${p.codigo}/chunks`).get()
    for (const d of sobr.docs) { const [t, n] = d.id.split('-'); if (t === 'tp' && Number(n) >= totalChunks) await d.ref.delete() }
    const previo = actual.exists ? actual.data().techPack : null
    await ref.update({
      techPack: { nombre: p.nombre.slice(0, 200), formato, tamano: bytes.length, totalChunks, sha256, version: (previo?.version || 0) + 1, subidoEn: ahora(), subidoPorUid: QUIEN.uid, subidoPorNombre: QUIEN.nombre },
      actualizadoEn: ahora(), actualizadoPorUid: QUIEN.uid, actualizadoPorNombre: QUIEN.nombre
    })
    console.log(`+ ${p.codigo}: ${totalChunks} chunk(s), ${mb(bytes.length)}, ${formato}`)
    subidos++
  }
  // alias por folio (siempre, aunque el archivo ya estuviera): es lo que liga a la OT
  for (const f of p.folios) {
    if (dueñoDeFolio.get(f) !== p.codigo) continue
    const aref = db.doc(`techPacks/${f}`)
    const a = await aref.get()
    if (a.exists && a.data().techPack) { console.log(`  ~ ${f}: ya es un tech pack propio, no se convierte en alias`); continue }
    if (a.exists && a.data().apuntaA === p.codigo) continue
    if (a.exists) await aref.update({ apuntaA: p.codigo, descripcion: `folio de ficha de ${p.codigo}`, actualizadoEn: ahora(), actualizadoPorUid: QUIEN.uid, actualizadoPorNombre: QUIEN.nombre })
    else await aref.set(base(f, { apuntaA: p.codigo, descripcion: `folio de ficha de ${p.codigo}` }))
    aliases++
  }
}
console.log(`\nListo: ${subidos} subidos, ${saltados} ya estaban, ${aliases} alias de folio creados/actualizados.`)
process.exit(0)
