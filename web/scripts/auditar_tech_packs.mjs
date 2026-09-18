/**
 * REPASO DE TODOS LOS TECH PACKS: que falta, que esta raro y que quedo sin acomodar.
 *
 * Roberto, 18-sep: "dale una repasada a todos los tech packs, por si se nos
 * escapo algo... por si falta algun dato o esta equivocado". SOLO LECTURA.
 *
 * Por cada tech pack con archivo Excel lee la plantilla vigente y reporta:
 *   - lo que le falta segun la calificacion (medirPlantilla), rubro por rubro;
 *   - datos SOSPECHOSOS: un modelo distinto escrito en su propio archivo, codigos
 *     repetidos, codigos que no estan en el catalogo del modelo, pares por pack
 *     que no cuadra con lo que dice la descripcion (SIX PACK con pack 3...);
 *   - los "datos sin acomodar" (_RAGNAR.noMigrado), separando el RUIDO
 *     (encabezados como COLOR, CODIGO) de lo que SI es un dato perdido.
 *
 * Uso (en web/):  node scripts/auditar_tech_packs.mjs  [> reporte.txt]
 *                 JSON=ruta.json  guarda el detalle completo
 */
import ExcelJS from 'exceljs'
import { readFileSync, writeFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { idsDePedazos } from '../src/utils/pedazosTechPack.js'
import { leerPlantilla, medirPlantilla } from '../src/utils/leerPlantillaTechPack.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const aBuffer = (v) => Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v)
const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const pelado = (s) => norm(s).replace(/[^A-Z0-9]/g, '')

// Encabezados y rotulos de la plantilla vieja: no son datos, son titulos de columna.
const RUIDO = /^(COLOR(ES)?|COLOR \/ CUERPO|COLOR CUERPO|CODIGO(S)?|CODIGO INTERNO|TALLA(S)?|MODELO|DESCRIPCION|BORDADO|IMAGEN|HILO|LECHUGA|CANTIDAD|CLAVE|PROCESO \d|RUTA DE PROCESO|NOTAS?|OBSERVACIONES|TOTAL(ES)?|PIEZAS?|PARES|DOCENAS?|PACKS?|ETIQUETAS?|EMPAQUE.*|X|-|N\/A|NA)$/

async function vigente(ref, tp) {
  const ch = await ref.collection('chunks').get()
  const porId = new Map(ch.docs.map((d) => [d.id, d]))
  const { ids, completo } = idsDePedazos(new Set(porId.keys()), 'tp', tp)
  return completo ? Buffer.concat(ids.map((id) => aBuffer(porId.get(id).data().datos))) : null
}

const PACKS = [[/\bUNI ?PACK\b/, 1], [/\b(DUO|BI) ?PACK\b/, 2], [/\bTRI ?PACK\b/, 3], [/\bSIX ?PACK\b/, 6]]
const packDicho = (t) => { for (const [re, n] of PACKS) if (re.test(norm(t))) return n; const m = /(?<![\d\-./])\b(\d{1,2}) ?PACK\b/.exec(norm(t)); return m ? Number(m[1]) : null }

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
const filas = []
for (const d of snap.docs.sort((a, b) => a.id.localeCompare(b.id))) {
  const x = d.data()
  if (x.apuntaA || !x.techPack?.totalChunks) continue
  const f = { codigo: d.id, cliente: String(x.cliente || ''), aprobado: Boolean(x.aprobacion?.sha256 && x.aprobacion.sha256 === x.techPack.sha256), formato: x.techPack.formato }
  if (x.techPack.formato !== 'xlsx') { f.nota = 'PDF: no se puede revisar por dentro'; filas.push(f); continue }
  const buf = await vigente(d.ref, x.techPack)
  if (!buf) { f.nota = 'PEDAZOS INCOMPLETOS'; filas.push(f); continue }
  const lib = new ExcelJS.Workbook(); await lib.xlsx.load(buf)
  const l = leerPlantilla(lib)
  const m = medirPlantilla(l)
  f.porcentaje = m.porcentaje
  f.falta = Object.entries(m.detalle).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(', ')}`)
  const c = l.campos
  const modelo = String(c.TP_MODELO || '')
  const ped = (l.tablas.TP_TABLA_PEDIDO || []).filter((r) => lleno(r.codigo) || lleno(r.claveMicrosip) || lleno(r.descripcion))
  const raros = []
  // un modelo distinto escrito en su propio archivo (en descripciones o sobrantes)
  const modelosEnArchivo = new Set()
  for (const t of [...ped.map((r) => r.descripcion), ...(l.noMigrado || []).map((s) => s.texto)]) {
    for (const mm of norm(t).matchAll(/\b([A-Z]{2,5}\d{3,6}[A-Z0-9-]*)\b/g)) modelosEnArchivo.add(mm[1])
  }
  const propio = pelado(modelo)
  const ajenos = [...modelosEnArchivo].filter((mm) => propio && !propio.includes(pelado(mm)) && !pelado(mm).includes(propio))
  if (ajenos.length) raros.push(`su archivo menciona otro modelo: ${ajenos.join(', ')} (el suyo es ${modelo})`)
  // codigos repetidos
  const vistos = new Map()
  for (const r of ped) if (lleno(r.codigo)) vistos.set(pelado(r.codigo), (vistos.get(pelado(r.codigo)) || 0) + 1)
  const rep = [...vistos].filter(([, n]) => n > 1).map(([k]) => k)
  if (rep.length) raros.push(`codigo repetido: ${rep.join(', ')}`)
  // codigos sin digitos (un rotulo colado como codigo)
  const malos = ped.filter((r) => lleno(r.codigo) && !/\d/.test(String(r.codigo))).map((r) => r.codigo)
  if (malos.length) raros.push(`"codigo" que no es codigo: ${malos.join(', ')}`)
  // pares por pack contra lo que dice el propio archivo
  const dichos = new Set([modelo, ...ped.map((r) => r.descripcion)].map(packDicho).filter(Boolean))
  if (lleno(c.TP_PACK) && dichos.size === 1 && ![...dichos].includes(Number(c.TP_PACK))) raros.push(`pares por pack = ${c.TP_PACK} pero el archivo dice ${[...dichos][0]}`)
  if (dichos.size > 1) raros.push(`el archivo dice packs distintos: ${[...dichos].join(' y ')}`)
  // codigos cubiertos que no aparecen en su tabla
  const enTabla = new Set(ped.map((r) => pelado(r.codigo)))
  const cubre = (x.codigosCubiertos || []).filter((cc) => !enTabla.has(pelado(cc)))
  if (cubre.length) raros.push(`dice cubrir codigos que no estan en su tabla: ${cubre.join(', ')}`)
  f.raros = raros
  const sob = l.noMigrado || []
  f.ruido = sob.filter((s) => RUIDO.test(norm(s.texto))).map((s) => s.texto)
  f.sinAcomodar = sob.filter((s) => !RUIDO.test(norm(s.texto))).map((s) => `${s.hoja}!${s.celda}: ${s.texto}`)
  filas.push(f)
}

const xs = filas.filter((f) => f.porcentaje != null)
console.log(`tech packs: ${filas.length} | Excel revisados: ${xs.length} | PDF u otros: ${filas.length - xs.length}`)
console.log(`al 100 %: ${xs.filter((f) => f.porcentaje === 100).length}`)
console.log(`con algo SOSPECHOSO: ${xs.filter((f) => f.raros.length).length}`)
console.log(`con "datos sin acomodar": ${xs.filter((f) => f.sinAcomodar.length || f.ruido.length).length} (de esos, solo ruido de encabezados: ${xs.filter((f) => !f.sinAcomodar.length && f.ruido.length).length})`)
console.log(`  total de textos sin acomodar: ${xs.reduce((n, f) => n + f.sinAcomodar.length, 0)} reales + ${xs.reduce((n, f) => n + f.ruido.length, 0)} de ruido`)
const faltaCuenta = {}
for (const f of xs) for (const linea of f.falta) for (const k of linea.split(': ')[1].split(', ')) { const key = linea.split(':')[0] + ' · ' + k.replace(/^\d+ /, 'N '); faltaCuenta[key] = (faltaCuenta[key] || 0) + 1 }
console.log('\nLO QUE MAS FALTA (en cuantos tech packs):')
Object.entries(faltaCuenta).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ${k}`))
console.log('\nSOSPECHOSOS:')
for (const f of xs.filter((f) => f.raros.length)) console.log(`  ${f.codigo.padEnd(18)} ${f.aprobado ? 'aprob' : 'pend '} | ${f.raros.join(' | ')}`)
console.log('\nDATOS SIN ACOMODAR (sin el ruido):')
for (const f of xs.filter((f) => f.sinAcomodar.length)) console.log(`  ${f.codigo.padEnd(18)} ${f.sinAcomodar.slice(0, 6).join(' || ')}${f.sinAcomodar.length > 6 ? ` || ... (+${f.sinAcomodar.length - 6})` : ''}`)
for (const f of filas.filter((f) => f.nota)) console.log(`  ${f.codigo.padEnd(18)} ${f.nota}`)
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(filas, null, 1))
process.exit(0)
