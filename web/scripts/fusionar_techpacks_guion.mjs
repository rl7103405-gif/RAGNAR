/**
 * ARREGLA LOS TECH PACKS FANTASMA que nacieron con un GUION TIPOGRAFICO.
 *
 * Roberto, 2026-09-17 (lo vio Lety): "estos dos modelos que son de Óptima no
 * están en Óptima… no pueden quedar ningún tech pack así suelto".
 *
 * Lo que paso: Word, Excel y el Drive convierten solos el '-' en '–' (en dash),
 * y quien copia el codigo se lo trae. 'CIW11–513090001' y 'CIW11-513090001'
 * eran el MISMO archivo (misma huella sha256) guardado en DOS documentos, y
 * ninguno cuadraba con el plan maestro.
 *
 * El arreglo de raiz ya esta en normalizarCodigo (planMaestroNucleo.js): de
 * aqui en adelante los guiones raros se emparejan solos. Este script limpia lo
 * que ya quedo mal.
 *
 * QUE HACE, por cada tech pack cuyo id trae un guion tipografico:
 *   - si el id BUENO ya existe y es el MISMO archivo -> borra el fantasma
 *   - si el id BUENO no existe                       -> copia el documento y
 *     sus pedazos al id bueno, y borra el fantasma
 *   - si el id bueno existe con OTRO archivo         -> NO TOCA NADA y avisa
 *     (eso lo decide una persona: son dos archivos distintos)
 *
 * Uso (en web/):
 *   node scripts/fusionar_techpacks_guion.mjs            <- ensayo
 *   EJECUTAR=1 node scripts/fusionar_techpacks_guion.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { normalizarCodigo } from '../src/utils/planMaestroNucleo.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

const RAROS = /[‐‑‒–—―−]/

const snap = await db.collection('techPacks').get()
const fantasmas = snap.docs.filter((d) => RAROS.test(d.id))
console.log(`tech packs con guion tipografico: ${fantasmas.length}`)

let borrados = 0, movidos = 0, conflictos = 0
for (const d of fantasmas) {
  const bueno = normalizarCodigo(d.id)
  const x = d.data()
  const otro = await db.collection('techPacks').doc(bueno).get()
  const mismoArchivo = otro.exists && otro.data()?.techPack?.sha256 && otro.data().techPack.sha256 === x.techPack?.sha256

  if (otro.exists && !mismoArchivo) {
    conflictos++
    console.log(`  ${d.id}  -> ${bueno}: YA EXISTE con OTRO archivo. NO se toca, decidelo tu.`)
    continue
  }

  if (mismoArchivo) {
    borrados++
    console.log(`  ${d.id}  -> ${bueno}: duplicado exacto (misma huella). Se borra el fantasma.`)
  } else {
    movidos++
    console.log(`  ${d.id}  -> ${bueno}: se copia al codigo bueno (con sus ${x.techPack?.totalChunks || 0} pedazo(s)) y se borra el fantasma.`)
  }
  if (!EJECUTAR) continue

  // 1. Copiar el documento y sus pedazos al id bueno, si hace falta.
  if (!mismoArchivo) {
    const { codigo, ...resto } = x
    await db.collection('techPacks').doc(bueno).set({ ...resto, codigo: bueno })
    const chunks = await d.ref.collection('chunks').get()
    for (const c of chunks.docs) {
      await db.collection('techPacks').doc(bueno).collection('chunks').doc(c.id).set({ ...c.data(), codigo: bueno })
    }
    // El historial y las versiones se copian tal cual: son el rastro de quien
    // lo subio y lo edito, y perderlo seria peor que el fantasma.
    for (const sub of ['versiones', 'historial']) {
      const s = await d.ref.collection(sub).get()
      for (const r of s.docs) await db.collection('techPacks').doc(bueno).collection(sub).doc(r.id).set(r.data())
    }
  }

  // 2. Borrar el fantasma con todo lo que cuelga.
  await db.recursiveDelete(d.ref)
}

console.log(`\n${borrados} duplicado(s) borrados · ${movidos} movido(s) al codigo bueno · ${conflictos} conflicto(s) sin tocar`)
if (!EJECUTAR) console.log('\nEnsayo. Para aplicarlo:  EJECUTAR=1 node scripts/fusionar_techpacks_guion.mjs')
