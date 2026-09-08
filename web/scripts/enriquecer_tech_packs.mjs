// Copia MODELO, TALLA y COLOR del catalogo a los tech packs que ya estaban
// cargados antes del 2026-09-08 (los nuevos ya nacen con esos campos).
// Sirve para BUSCAR POR MODELO, que es lo que pidio Lety: el mismo modelo cae
// en muchas OT y sin esto hay que buscarlo a ciegas por codigo.
//
//   node scripts/enriquecer_tech_packs.mjs           ensayo
//   EJECUTAR=1 node scripts/enriquecer_tech_packs.mjs
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { NUM_SHARDS_CATALOGO, claveDeCodigo, shardDeCodigo } from '../src/utils/catalogoClaves.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EJECUTAR = process.env.EJECUTAR === '1'
initializeApp({ credential: cert(JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccountKey.json'), 'utf8'))) })
const db = getFirestore()

const cfg = (await db.doc('config/catalogoActual').get()).data() || {}
if (!cfg.versionId) { console.error('No hay catalogo activo.'); process.exit(1) }
if (cfg.numShards !== undefined && cfg.numShards !== NUM_SHARDS_CATALOGO) {
  console.error(`El catalogo usa ${cfg.numShards} shards y este script espera ${NUM_SHARDS_CATALOGO}.`); process.exit(1)
}
// ⚠️ OJO CON LA NOMENCLATURA (hallazgo del 2026-09-08): el codigo de un tech
// pack (RB10T208, WKD225T401, CAT234) NO es la clave del catalogo — es el
// codigo del CLIENTE, que en el catalogo de Atalanta vive en el campo
// `modelo`. La clave del catalogo es la de Microsip (1159-I, 4756). Por eso
// aqui se arma un indice inverso MODELO -> entradas, en vez de buscar por id.
const porModelo = new Map()
console.log('leyendo el catalogo para armar el indice por modelo...')
for (let i = 0; i < NUM_SHARDS_CATALOGO; i++) {
  const prods = (await db.doc(`catalogoVersiones/${cfg.versionId}/shards/${i}`).get()).data()?.productos || {}
  for (const e of Object.values(prods)) {
    const m = String(e.modelo || '').trim().toUpperCase()
    if (!m) continue
    if (!porModelo.has(m)) porModelo.set(m, [])
    porModelo.get(m).push(e)
  }
}
console.log('modelos distintos en el catalogo:', porModelo.size)
// Un codigo por talla (WKD225T401-4-6) se cae al modelo base.
const base = (c) => String(c).replace(/-\d{1,2}-\d{1,2}$/, '')
function entradasDe(codigo) {
  const k = String(codigo).trim().toUpperCase()
  return porModelo.get(k) || porModelo.get(base(k).toUpperCase()) || []
}

const snap = await db.collection('techPacks').get()
let alias = 0, yaTenian = 0, sinCatalogo = 0, actualizados = 0
const lote = []
for (const d of snap.docs) {
  const x = d.data()
  if (x.apuntaA) { alias++; continue }
  if (x.modelo !== undefined) { yaTenian++; continue }
  const es = entradasDe(x.codigo)
  if (!es.length) { sinCatalogo++; console.log(`   ${x.codigo}: no aparece como modelo en el catalogo`); continue }
  // Un modelo suele tener varias entradas (una por talla/color). Se guarda el
  // modelo tal cual y la lista de colores y tallas distintas, que es lo que
  // permite distinguir "combo blanco" de "combo beige" al buscar.
  const colores = [...new Set(es.map((e) => String(e.color || '').trim()).filter(Boolean))]
  const tallas = [...new Set(es.map((e) => String(e.talla || '').trim()).filter(Boolean))]
  const campos = {
    modelo: String(es[0].modelo || '').slice(0, 200),
    talla: tallas.join(', ').slice(0, 200),
    color: colores.join(', ').slice(0, 200)
  }
  if (!x.descripcion && es[0].descripcion) campos.descripcion = String(es[0].descripcion).slice(0, 200)
  actualizados++
  console.log(`   ${x.codigo}: modelo "${campos.modelo}" | talla "${campos.talla}" | color "${campos.color}"`)
  if (EJECUTAR) lote.push(d.ref.update(campos))
}
if (EJECUTAR) await Promise.all(lote)
console.log(`\n${EJECUTAR ? 'ACTUALIZADOS' : 'ENSAYO (nada escrito; EJECUTAR=1 para aplicar)'}: ${actualizados} tech packs`)
console.log(`alias saltados: ${alias} | ya tenian los campos: ${yaTenian} | sin catalogo: ${sinCatalogo}`)
