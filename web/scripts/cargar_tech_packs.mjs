/**
 * Carga MASIVA de tech packs a la biblioteca de RAGNAR desde una carpeta local
 * (lo que Roberto baja del Drive del papa).
 *
 * Escribe EXACTAMENTE lo que escribe la app (web/src/utils/techPacks.js):
 * techPacks/{codigo} con el manifiesto y techPacks/{codigo}/chunks/tp-NN con
 * el archivo troceado a 950 KB y sha256. Asi el visor, el pegado por OT y el
 * limpiador de pruebas los tratan igual que si los hubiera subido Lety.
 *
 * Uso (en web/):
 *   node scripts/cargar_tech_packs.mjs "C:\Users\elita\Desktop\techpacks-drive"           <- ensayo
 *   EJECUTAR=1 node scripts/cargar_tech_packs.mjs "C:\Users\elita\Desktop\techpacks-drive" <- sube
 *   SOLO=WKD25L103,SFT104 ...   <- limitar a ciertos codigos
 *   REEMPLAZAR=1 ...            <- pisar los que ya tengan tech pack (por defecto se saltan)
 *
 * Reglas del nombre de archivo (convencion del Drive):
 *   "TECH PACK <CODIGO>.xlsx|pdf"            -> codigo
 *   "TECH PACK <CODIGO> TALLA 4-6.xlsx"      -> SE REPORTA y no se sube: la
 *        biblioteca guarda UN archivo por codigo y aqui hay uno por talla.
 *        Decision de Roberto (ver tech-packs-en-drive.md en el vault).
 *   Sin "TECH PACK" en el nombre, o el "codigo" es un numero de pedido
 *        (solo digitos, 4+), o trae espacios/palabras ("COMBO ROSA") -> lista
 *        "sin codigo" para que Lety diga cual es.
 *   > 15 MB -> lista "pesados": exportar a PDF desde Excel.
 *
 * Es solo para cuentas REALES (esPrueba:false): los tech packs de Lety son
 * operacion real. El corral de pruebas se llena por la app, no por aqui.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const CARPETA = process.argv[2]
if (!CARPETA) {
  console.error('Uso: node scripts/cargar_tech_packs.mjs "<carpeta con los tech packs>"')
  process.exit(1)
}
const EJECUTAR = process.env.EJECUTAR === '1'
const REEMPLAZAR = process.env.REEMPLAZAR === '1'
const SOLO = new Set(
  String(process.env.SOLO || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
)

// Mismos numeros que la app y las reglas.
const CHUNK_BYTES = 950000
const MAX_BYTES = 15728640
const MAX_CHUNKS = 17
const QUIEN = { uid: 'carga-drive-2026-09', nombre: 'Carga inicial desde Drive (Claude, 03-09-2026)' }

// ------------------------------------------------------------ clasificar
const archivos = []
function recorrer(dir) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    const st = statSync(ruta)
    if (st.isDirectory()) recorrer(ruta)
    else if (['.xlsx', '.pdf'].includes(extname(nombre).toLowerCase()) && !nombre.startsWith('~$')) {
      archivos.push({ ruta, nombre, bytes: st.size })
    }
  }
}
recorrer(CARPETA)

function clasificar(a) {
  const base = basename(a.nombre, extname(a.nombre)).trim()
  const m = /^TECH\s*PACK\s+(.+)$/i.exec(base)
  if (!m) return { estado: 'sin_codigo', motivo: 'el nombre no empieza con TECH PACK' }
  let resto = m[1].trim().replace(/\s+/g, ' ')
  // "(1)" y "copia de" al final: Drive los agrega, no son parte del codigo
  resto = resto.replace(/\s*\(\d+\)$/, '').replace(/\.xlsx$/i, '').trim()
  if (/\bTALLA\b/i.test(resto)) {
    return { estado: 'talla', codigo: resto.split(/\s+TALLA\s+/i)[0].toUpperCase(), motivo: 'un archivo por talla' }
  }
  // "SFT321 4-6", "CHYPCT310 8-10": talla sin la palabra
  if (/^\S+\s+\d{1,2}-\d{1,2}$/.test(resto)) {
    return { estado: 'talla', codigo: resto.split(/\s+/)[0].toUpperCase(), motivo: 'un archivo por talla' }
  }
  if (/^\d{4,}$/.test(resto) || /^PO\s+\d+/i.test(resto)) {
    return { estado: 'sin_codigo', motivo: 'el nombre es un numero de pedido, no un codigo de diseno' }
  }
  if (/\s/.test(resto)) {
    return { estado: 'sin_codigo', motivo: `el nombre trae palabras ("${resto}"): no se adivina el codigo` }
  }
  const codigo = resto.toUpperCase().replace(/[^A-Z0-9._-]/g, '')
  if (!codigo || codigo.length > 60) return { estado: 'sin_codigo', motivo: 'codigo vacio o demasiado largo' }
  if (a.bytes > MAX_BYTES) return { estado: 'pesado', codigo, motivo: `${(a.bytes / 1048576).toFixed(1)} MB (tope 15)` }
  return { estado: 'ok', codigo }
}

const plan = archivos.map((a) => ({ ...a, ...clasificar(a) }))
const ok = plan.filter((p) => p.estado === 'ok' && (!SOLO.size || SOLO.has(p.codigo)))

// Dos archivos con el mismo codigo (copias en varias carpetas): gana el mas
// reciente por fecha de modificacion; el resto se reporta.
const porCodigo = new Map()
for (const p of ok) {
  const mtime = statSync(p.ruta).mtimeMs
  const previo = porCodigo.get(p.codigo)
  if (!previo || mtime > previo.mtime) porCodigo.set(p.codigo, { ...p, mtime })
}

// ------------------------------------------------------------ reporte
const imprimir = (titulo, lista, f) => {
  if (!lista.length) return
  console.log(`\n${titulo} (${lista.length}):`)
  lista.forEach((p) => console.log('  ' + f(p)))
}
console.log(`Archivos encontrados: ${archivos.length} en ${CARPETA}`)
imprimir('SE SUBEN', [...porCodigo.values()], (p) => `${p.codigo}  <- ${p.nombre} (${(p.bytes / 1048576).toFixed(1)} MB)`)
imprimir('COPIAS DESCARTADAS (mismo codigo, mas viejas)', ok.filter((p) => porCodigo.get(p.codigo)?.ruta !== p.ruta), (p) => `${p.codigo}  <- ${p.ruta}`)
imprimir('POR TALLA (no se suben: decision pendiente)', plan.filter((p) => p.estado === 'talla'), (p) => `${p.codigo}  <- ${p.nombre}`)
imprimir('PESADOS (>15 MB: exportar a PDF)', plan.filter((p) => p.estado === 'pesado'), (p) => `${p.codigo}  <- ${p.nombre}  ${p.motivo}`)
imprimir('SIN CODIGO (que Lety diga cual es)', plan.filter((p) => p.estado === 'sin_codigo'), (p) => `${p.nombre}  -- ${p.motivo}`)

if (!EJECUTAR) {
  console.log('\nEnsayo. Para subir de verdad: EJECUTAR=1 node scripts/cargar_tech_packs.mjs "<carpeta>"')
  process.exit(0)
}

// ------------------------------------------------------------ subir
const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

let subidos = 0
let saltados = 0
for (const p of porCodigo.values()) {
  const ref = db.doc(`techPacks/${p.codigo}`)
  const actual = await ref.get()
  if (actual.exists && actual.data().techPack && !REEMPLAZAR) {
    console.log(`= ${p.codigo}: ya tiene tech pack, se salta (REEMPLAZAR=1 para pisarlo)`)
    saltados++
    continue
  }
  const bytes = readFileSync(p.ruta)
  const totalChunks = Math.ceil(bytes.length / CHUNK_BYTES)
  if (totalChunks > MAX_CHUNKS) {
    console.log(`! ${p.codigo}: rebasa los 17 chunks, se salta`)
    continue
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const formato = extname(p.nombre).toLowerCase() === '.pdf' ? 'pdf' : 'xlsx'

  if (!actual.exists) {
    await ref.set({
      codigo: p.codigo,
      descripcion: '',
      techPack: null,
      ftt: null,
      creadoEn: FieldValue.serverTimestamp(),
      creadoPorUid: QUIEN.uid,
      creadoPorNombre: QUIEN.nombre,
      actualizadoEn: FieldValue.serverTimestamp(),
      actualizadoPorUid: QUIEN.uid,
      actualizadoPorNombre: QUIEN.nombre,
      esPrueba: false
    })
  }
  // Chunks nuevos primero; el manifiesto al final (igual que la app).
  for (let i = 0; i < totalChunks; i++) {
    const pedazo = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
    await db.doc(`techPacks/${p.codigo}/chunks/tp-${String(i).padStart(2, '0')}`).set({
      codigo: p.codigo,
      tipo: 'tp',
      datos: pedazo
    })
  }
  const sobrantes = await db.collection(`techPacks/${p.codigo}/chunks`).get()
  for (const d of sobrantes.docs) {
    const [t, n] = d.id.split('-')
    if (t === 'tp' && Number(n) >= totalChunks) await d.ref.delete()
  }
  const previo = actual.exists ? actual.data().techPack : null
  await ref.update({
    techPack: {
      nombre: p.nombre.slice(0, 200),
      formato,
      tamano: bytes.length,
      totalChunks,
      sha256,
      version: (previo?.version || 0) + 1,
      subidoEn: FieldValue.serverTimestamp(),
      subidoPorUid: QUIEN.uid,
      subidoPorNombre: QUIEN.nombre
    },
    actualizadoEn: FieldValue.serverTimestamp(),
    actualizadoPorUid: QUIEN.uid,
    actualizadoPorNombre: QUIEN.nombre
  })
  console.log(`+ ${p.codigo}: ${totalChunks} chunk(s), ${(bytes.length / 1048576).toFixed(1)} MB, ${formato}`)
  subidos++
}
console.log(`\nListo: ${subidos} subidos, ${saltados} saltados.`)
process.exit(0)
