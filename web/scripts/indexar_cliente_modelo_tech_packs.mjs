/**
 * Saca CLIENTE, MARCA y MODELO de la plantilla de cada tech pack y los escribe
 * en techPacks/{codigo} (cliente, marca, modeloPlantilla). Roberto, 2026-09-15:
 * "los tech packs ya no se manejan por OC ni OT sino por modelo y cliente".
 * Medido ese dia: los 120 traen los tres datos dentro del Excel y ninguno en
 * la base.
 *
 * De aqui en adelante lo hace solo guardarEnBiblioteca en cada subida; esto es
 * para los que ya estaban.
 *
 * Uso (en web/):
 *   node scripts/indexar_cliente_modelo_tech_packs.mjs          <- ensayo: muestra las diferencias
 *   EJECUTAR=1 node scripts/indexar_cliente_modelo_tech_packs.mjs
 *
 * Seguro de correr varias veces (solo escribe si cambia algo). Verifica los
 * pedazos del archivo (ids, tamano y sha256) antes de leerlo, y escribe en una
 * transaccion que exige que el manifiesto siga siendo EL MISMO que se leyo:
 * si Lety reemplazo el archivo mientras tanto, no se pisa su identidad nueva.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import ExcelJS from 'exceljs'
import { esPlantilla, leerPlantilla } from '../src/utils/leerPlantillaTechPack.js'
import { IDENTIDAD_VACIA, claveCliente, identidadDePlantilla } from '../src/utils/clienteModeloTechPack.js'
import { idsDePedazos } from '../src/utils/pedazosTechPack.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

async function archivoVerificado(id, m) {
  const chunks = await db.collection('techPacks').doc(id).collection('chunks').get()
  const porId = new Map(chunks.docs.map((d) => [d.id, d]))
  const tp = idsDePedazos(new Set(porId.keys()), 'tp', m).ids.map((id) => porId.get(id)).filter(Boolean)
  if (tp.length !== m.totalChunks) return { error: `trae ${tp.length} pedazos y el manifiesto dice ${m.totalChunks}` }
  const buf = Buffer.concat(tp.map((d) => {
    const v = d.data().datos
    return Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v)
  }))
  if (m.tamano && buf.length !== m.tamano) return { error: `pesa ${buf.length} y el manifiesto dice ${m.tamano}` }
  if (m.sha256 && createHash('sha256').update(buf).digest('hex') !== m.sha256) return { error: 'la huella sha256 no coincide' }
  return { buf }
}

const snap = await db.collection('techPacks').get()
let cambian = 0, iguales = 0, noPlantilla = 0, fallidos = 0, sinArchivo = 0
const clientes = new Map()
for (const d of snap.docs) {
  const x = d.data()
  if (x.apuntaA) continue
  if (!x.techPack) { sinArchivo++; continue }
  let identidad = { ...IDENTIDAD_VACIA }
  if (x.techPack.formato === 'xlsx') {
    const r = await archivoVerificado(d.id, x.techPack)
    if (r.error) { fallidos++; console.log(`  ${d.id.padEnd(26)} NO SE LEE: ${r.error}`); continue }
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.load(r.buf)
    if (esPlantilla(libro)) identidad = identidadDePlantilla(leerPlantilla(libro))
    else noPlantilla++
  } else noPlantilla++
  if (identidad.cliente) clientes.set(claveCliente(identidad.cliente), [...new Set([...(clientes.get(claveCliente(identidad.cliente)) || []), identidad.cliente])])
  const igual = ['cliente', 'marca', 'modeloPlantilla', 'tallaPlantilla'].every((k) => (x[k] ?? null) === identidad[k])
  if (igual) { iguales++; continue }
  cambian++
  console.log(`  ${d.id.padEnd(26)} ${x.esPrueba ? '[prueba] ' : ''}cliente "${identidad.cliente ?? ''}" · marca "${identidad.marca ?? ''}" · modelo "${identidad.modeloPlantilla ?? ''}" · talla "${identidad.tallaPlantilla ?? ''}"`)
  if (EJECUTAR) {
    await db.runTransaction(async (tx) => {
      const vivo = await tx.get(d.ref)
      if (vivo.data()?.techPack?.sha256 !== x.techPack.sha256) {
        console.log(`    ${d.id}: el archivo cambio mientras se leia, se deja como esta`)
        return
      }
      tx.update(d.ref, identidad)
    })
  }
}
console.log(`\n${cambian} por actualizar, ${iguales} ya al dia, ${noPlantilla} PDF o no plantilla (quedan sin cliente), ${sinArchivo} sin archivo, ${fallidos} que no se pudieron leer`)
const dobles = [...clientes.values()].filter((g) => g.length > 1)
if (dobles.length) console.log('Clientes escritos de mas de una forma (se agrupan juntos en pantalla):', dobles.map((g) => g.join(' = ')).join(' · '))
if (!EJECUTAR) console.log('\nEnsayo. Para guardarlo:  EJECUTAR=1 node scripts/indexar_cliente_modelo_tech_packs.mjs')
