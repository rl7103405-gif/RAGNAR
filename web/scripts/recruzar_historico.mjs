/**
 * RE-CRUCE DEL HISTORICO: recupera los bultos que quedaron 'sin_ruteo' /
 * 'sin_catalogo' AUNQUE YA HAYAN SALIDO EN UN PDF.
 *
 * Por que existe este script y no lo hace la app sola
 * ---------------------------------------------------
 * El re-cruce normal (utils/recruzarBultos.js, que corre al subir el Excel de
 * folios) OMITE a proposito los bultos con `pdfGeneradoEn`: si el papel ya se
 * imprimio y se mando a la maquila, cambiarle los datos despues haria que el
 * documento emitido deje de cuadrar con lo guardado.
 *
 * El costo de ese candado se midio el 2026-08-27: **447 bultos** cuyo folio YA
 * esta en el ruteo seguian diciendo "SIN RUTEO" para siempre, y su produccion
 * no se contaba en el arbol ni en los porcentajes.
 *
 * Roberto autorizo levantarlo (27-08): "recruzalos, para que todos tengan ese
 * orden, aunque ya hayan salido... y si quieren reimprimir el PDF, que ya
 * aparezca con el recruce".
 *
 * Que hace con el PDF ya emitido
 * ------------------------------
 * La reimpresion usa la copia CONGELADA que vive dentro de pdfsGenerados
 * (`capturas[]`), no los bultos vivos. Como Roberto quiere que al reimprimir
 * salgan los datos corregidos, esa copia tambien se actualiza -- pero ANTES se
 * respalda tal cual en `capturasOriginales`, junto con `snapshotRespaldadoEn`.
 *
 * Asi se cumplen las dos cosas: el papel reimpreso trae el dato bueno, y sigue
 * existiendo prueba de que decia el papel que recibio la maquila, por si algun
 * dia hay una aclaracion con ellos. Un respaldo que ya existe NO se pisa: el
 * original es el del primer re-cruce, no el del ultimo.
 *
 * Uso (dry-run por defecto; nada se escribe sin EJECUTAR=1):
 *   node scripts/recruzar_historico.mjs
 *   EJECUTAR=1 node scripts/recruzar_historico.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const EJECUTAR = process.env.EJECUTAR === '1'

initializeApp({ credential: cert(JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'))) })
const db = getFirestore()

const norm = (s) => String(s ?? '').trim()

/** La OT de un pedido, con el MISMO criterio que la captura: plan y luego texto. */
function otDelTexto(pedido) {
  const t = norm(pedido).toUpperCase()
  const conEtiqueta = t.match(/OT[:\s-]*(\d{3,6})/)
  if (conEtiqueta) return conEtiqueta[1]
  const alInicio = t.match(/^(\d{3,6})[_\s-]/)
  return alInicio ? alInicio[1] : ''
}

async function main() {
  console.log(EJECUTAR ? '=== MODO REAL: se va a escribir ===' : '=== SIMULACION (nada se escribe) ===\n')

  // El diccionario del plan vigente, para resolver la OT igual que la captura.
  const planActivo = await db.collection('config').doc('planMaestroActivo').get()
  const versionPlan = planActivo.exists ? planActivo.data().versionId : null
  const pedidoAOt = new Map()
  if (versionPlan) {
    const dic = await db.collection('planMaestroPedidos').get()
    dic.docs.forEach((d) => {
      const x = d.data()
      if (x.versionId === versionPlan && x.pedidoClave) {
        pedidoAOt.set(String(x.pedidoClave).toUpperCase(), String(x.ot).trim())
      }
    })
  }
  console.log(`plan vigente: ${versionPlan || '(ninguno)'} | ${pedidoAOt.size} pedidos en el diccionario`)

  const catCfg = await db.collection('config').doc('catalogoActual').get()
  const versionCatalogo = catCfg.exists ? catCfg.data().versionId : null

  const snap = await db.collection('bultos').where('cruce', 'in', ['sin_ruteo', 'sin_catalogo']).get()
  const candidatos = snap.docs.map((d) => ({ folio: d.id, ...d.data() })).filter((b) => !b.esPrueba)
  console.log(`bultos sin cruzar (reales): ${candidatos.length}\n`)

  const plan = []
  let sinRuteoTodavia = 0
  for (const b of candidatos) {
    const r = await db.collection('foliosRuteo').doc(b.folio).get()
    if (!r.exists) { sinRuteoTodavia++; continue }
    const d = r.data()
    const pedido = norm(d.pedido)
    const ot = pedidoAOt.get(pedido.toUpperCase()) || otDelTexto(pedido)
    plan.push({
      folio: b.folio,
      antes: b.cruce,
      conPdf: !!b.pdfGeneradoEn,
      producto: {
        codigo: norm(d.codigo) || null,
        docenas: typeof d.docenas === 'number' ? d.docenas : null,
        pares: typeof d.pares === 'number' ? d.pares : null,
        total: typeof d.total === 'number' ? d.total : null,
        pedido: pedido || null,
        descripcion: norm(d.descripcion) || null,
        modelo: norm(d.modelo) || null,
        color: norm(d.color) || null,
        ...(ot ? { ot, otOrigen: pedidoAOt.has(pedido.toUpperCase()) ? 'plan' : 'texto' } : {})
      }
    })
  }

  console.log(`RECUPERABLES: ${plan.length}   (siguen sin ruteo: ${sinRuteoTodavia})`)
  console.log(`  de esos, con PDF ya emitido: ${plan.filter((p) => p.conPdf).length}`)
  console.log('\nprimeros 10:')
  plan.slice(0, 10).forEach((p) =>
    console.log(`  ${p.folio} [${p.antes}] -> ${p.producto.codigo} | ${p.producto.docenas} doc | OT ${p.producto.ot || '(sin)'}`))

  if (!EJECUTAR) {
    console.log('\nSimulacion. Para aplicar: EJECUTAR=1 node scripts/recruzar_historico.mjs')
    return
  }

  // --- Escritura ---
  let ok = 0
  const pdfsTocados = new Map() // pdfId -> Map(folio -> producto)
  for (const p of plan) {
    try {
      await db.collection('bultos').doc(p.folio).update({
        producto: p.producto,
        // Si el codigo existe en el catalogo lo dira el proximo cruce; aqui el
        // dato del ruteo ya es una mejora real sobre 'sin_ruteo'.
        cruce: 'completo',
        catalogoVersion: versionCatalogo,
        recruzadoEn: FieldValue.serverTimestamp(),
        recruzadoPor: 'script recruzar_historico (autorizado por Roberto 27-08)'
      })
      ok++
      // Bitacora, como el re-cruce de la app
      await db.collection('cambiosCaptura').add({
        folio: p.folio, accion: 'recruce',
        usuarioNombre: 'Script historico (autorizado por Roberto)',
        despues: { codigo: p.producto.codigo, docenas: p.producto.docenas, ot: p.producto.ot || null },
        nota: 'Re-cruce del historico: el bulto ya habia salido en PDF',
        creadoEn: FieldValue.serverTimestamp()
      })
    } catch (err) {
      console.error(`  ERROR en ${p.folio}:`, err.message)
    }
  }
  console.log(`\nbultos actualizados: ${ok} de ${plan.length}`)

  // --- Actualizar el snapshot de los PDFs, respaldando el original ---
  const porFolio = new Map(plan.map((p) => [p.folio, p.producto]))
  const pdfs = await db.collection('pdfsGenerados').get()
  let pdfsActualizados = 0, capturasCambiadas = 0
  for (const d of pdfs.docs) {
    const x = d.data()
    if (!Array.isArray(x.capturas)) continue
    let cambio = false
    const nuevas = x.capturas.map((c) => {
      const prod = porFolio.get(String(c.folio))
      if (!prod) return c
      cambio = true; capturasCambiadas++
      return { ...c, producto: prod, cruce: 'completo' }
    })
    if (!cambio) continue
    const parche = { capturas: nuevas }
    // El respaldo del ORIGINAL solo se escribe una vez.
    if (!x.capturasOriginales) {
      parche.capturasOriginales = x.capturas
      parche.snapshotRespaldadoEn = FieldValue.serverTimestamp()
    }
    await d.ref.update(parche)
    pdfsActualizados++
  }
  console.log(`PDFs con snapshot actualizado: ${pdfsActualizados} (${capturasCambiadas} folios dentro)`)
  console.log('El original quedo respaldado en capturasOriginales.')
}

main().catch((e) => { console.error(e); process.exit(1) })
