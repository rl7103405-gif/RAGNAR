/**
 * ¿CUANTOS TECH PACKS DE LA BIBLIOTECA TRAEN EL DEFECTO DEL LECTOR VIEJO?
 *
 * El 17-sep se arreglo el lector del formato viejo: la ruta que viene pegada a
 * los codigos sin su titulo se leia como un codigo mas ("TEJIDO" con talla
 * "HABILITADO"), el encabezado "COLOR" a secas no se leia, y la celda PACK
 * vacia no se sacaba de "UNIPACK". Los 120 que se migraron el 11-sep pasaron
 * por el lector de ANTES.
 *
 * Por cada tech pack con respaldo del original (subcoleccion respaldoOriginal):
 *   1. lee el archivo VIGENTE (la plantilla) y mira si trae el defecto;
 *   2. vuelve a leer el ORIGINAL con el lector de HOY;
 *   3. dice que se ganaria: codigos limpios, ruta, colores, pares por pack.
 *
 * SOLO LECTURA. No escribe nada.
 *
 * Uso (en web/):  node scripts/medir_defecto_lector_viejo.mjs
 */
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { idsDePedazos } from '../src/utils/pedazosTechPack.js'
import { leerPlantilla } from '../src/utils/leerPlantillaTechPack.js'
import { extraerTechPackViejo } from '../src/utils/migrarTechPackViejo.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const sha = (b) => createHash('sha256').update(b).digest('hex')
const pad2 = (i) => String(i).padStart(2, '0')
const aBuffer = (v) => Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v)
const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''

async function vigente(ref, tp) {
  const ch = await ref.collection('chunks').get()
  const porId = new Map(ch.docs.map((d) => [d.id, d]))
  const { ids, completo } = idsDePedazos(new Set(porId.keys()), 'tp', tp)
  return completo ? Buffer.concat(ids.map((id) => aBuffer(porId.get(id).data().datos))) : null
}
async function respaldo(ref, ant) {
  if (!ant?.totalChunks) return null
  const r = await ref.collection('respaldoOriginal').get()
  const porId = new Map(r.docs.map((d) => [d.id, d]))
  const partes = []
  for (let i = 0; i < ant.totalChunks; i++) { const d = porId.get(`tp-${pad2(i)}`); if (!d) return null; partes.push(aBuffer(d.data().datos)) }
  const b = Buffer.concat(partes)
  return sha(b) === ant.sha256 ? b : null
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
const docs = snap.docs.filter((d) => d.data().techPack?.totalChunks && d.data().techPack.formato === 'xlsx' && !d.data().apuntaA)
const filas = []
for (const d of docs.sort((a, b) => a.id.localeCompare(b.id))) {
  const x = d.data()
  const buf = await vigente(d.ref, x.techPack)
  if (!buf) { filas.push({ codigo: d.id, error: 'pedazos incompletos' }); continue }
  const lib = new ExcelJS.Workbook(); await lib.xlsx.load(buf)
  const l = leerPlantilla(lib)
  const ped = (l.tablas.TP_TABLA_PEDIDO || []).map((r, i) => ({ ...r, i })).filter((r) => lleno(r.codigo) || lleno(r.claveMicrosip) || lleno(r.descripcion))
  const cod = l.tablas.TP_TABLA_CODIGOS || []
  const ruta = Object.values((l.tablas.TP_RUTA || [])[0] || {}).filter(lleno)
  const codigosMalos = ped.filter((r) => lleno(r.codigo) && !/\d/.test(String(r.codigo))).map((r) => r.codigo)
  const sinColor = ped.filter((r) => lleno(r.codigo) && !lleno(cod[r.i]?.colorCuerpo)).length
  const defecto = codigosMalos.length > 0 || ruta.length === 0 || (ped.length > 0 && sinColor === ped.length) || !lleno(l.campos.TP_PACK)
  const f = { codigo: d.id, aprobado: Boolean(x.aprobacion?.sha256 && x.aprobacion.sha256 === x.techPack.sha256), version: x.techPack.version, editadoPor: x.techPack.subidoPorNombre, codigosMalos, rutaVacia: ruta.length === 0, sinColor: `${sinColor}/${ped.length}`, sinPack: !lleno(l.campos.TP_PACK), defecto }
  if (defecto) {
    const orig = await respaldo(d.ref, x.techPackAnterior)
    if (!orig) f.original = 'SIN respaldo verificable'
    else {
      const lo = new ExcelJS.Workbook(); await lo.xlsx.load(orig)
      const { datos } = extraerTechPackViejo(lo, { codigo: d.id })
      f.hoy = {
        codigosMalos: (datos.renglones || []).filter((r) => lleno(r.codigo) && !/\d/.test(String(r.codigo))).map((r) => r.codigo),
        ruta: (datos.ruta || []).length,
        conColor: (datos.codigosRuta || []).filter((c) => lleno(c.colorCuerpo)).length,
        pack: datos.paresPorPack ?? null
      }
    }
  }
  filas.push(f)
}

const conDefecto = filas.filter((f) => f.defecto)
console.log(`tech packs Excel: ${filas.length} | con algun defecto: ${conDefecto.length} | aprobados de esos: ${conDefecto.filter((f) => f.aprobado).length}`)
console.log(`  codigo que es un proceso ("TEJIDO"): ${filas.filter((f) => f.codigosMalos?.length).length}`)
console.log(`  ruta vacia: ${filas.filter((f) => f.rutaVacia).length}`)
console.log(`  ningun codigo con color: ${filas.filter((f) => f.defecto && f.sinColor && f.sinColor.split('/')[0] === f.sinColor.split('/')[1] && f.sinColor !== '0/0').length}`)
console.log(`  sin pares por pack: ${filas.filter((f) => f.sinPack).length}`)
const mejora = conDefecto.filter((f) => f.hoy && (f.hoy.codigosMalos.length < f.codigosMalos.length || (f.rutaVacia && f.hoy.ruta > 0) || (f.hoy.conColor > 0 && f.sinColor.startsWith(f.sinColor.split('/')[1])) || (f.sinPack && f.hoy.pack)))
console.log(`\nel lector de HOY los mejoraria: ${mejora.length} | sin respaldo del original: ${conDefecto.filter((f) => f.original).length}`)
console.log(`  editados por una persona despues de migrar (ojo, reconvertir perderia su trabajo): ${mejora.filter((f) => !/Migracion|RAGNAR|conversion/i.test(f.editadoPor || '')).length}`)
for (const f of conDefecto) console.log('  ', f.codigo.padEnd(20), f.aprobado ? 'APROB' : 'pend ', `v${f.version}`, String(f.editadoPor).slice(0, 26).padEnd(26), '| malos', JSON.stringify(f.codigosMalos), '| ruta', f.rutaVacia ? 'VACIA' : 'ok', '| color', f.sinColor, '| pack', f.sinPack ? 'NO' : 'ok', '| hoy:', JSON.stringify(f.hoy || f.original))
process.exit(0)
