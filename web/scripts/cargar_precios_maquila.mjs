/**
 * Carga los PRECIOS DE ENSAMBLE de las maquilas, por MAQUILA + MODELO.
 *
 * De donde sale cada precio
 * -------------------------
 * Del historico real de pagos (`datos/maquilas/PAGO MAQUILAS GENERAL.xlsx`),
 * tomando SOLO la tarifa normal. Cielo definio que la tarifa normal es
 * PAREADO SENCILLO, y que el "ETIQUETADO" que capturan Hugo Martinez y Roda
 * Textil ES pareado sencillo (costumbre suya al escribirlo).
 *
 * Los UPC se traducen a modelo con el archivo que Cielo lleno el 27-08
 * (`datos/precios/UPC-con-codigos-de-cada-pack-27AGO26.xlsx`): un modelo cubre
 * varios UPC y todos se pagan igual, por eso la llave es el modelo.
 *
 * Decisiones de direccion (27-08), que este script respeta
 * --------------------------------------------------------
 *  - **Los de $10 se quedan en $10.** Roberto: "si hay veces que cobran eso
 *    porque es especial". No se tocan.
 *  - **Donde hubo dos precios, gana el ULTIMO.** Roberto: "quedate con el
 *    ultimo precio". Se resuelve por numero de semana, no por frecuencia:
 *    Edgar Munguia GHCC5P -> $6 (cambio en la semana 16 y asi siguio),
 *    Roda GC3 -> $6.50 y Roda GC4 -> $7.50 (los bajos fueron casos sueltos).
 *  - Los 10 precios que Cielo confirmo por correo mandan sobre el historico.
 *
 * Uso (dry-run por defecto; ES DINERO, nada se escribe sin EJECUTAR=1):
 *   node scripts/cargar_precios_maquila.mjs
 *   EJECUTAR=1 node scripts/cargar_precios_maquila.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import ExcelJS from 'exceljs'

const EJECUTAR = process.env.EJECUTAR === '1'
const RUTA_PAGOS = 'C:/Users/elita/Desktop/RAGNAR/datos/maquilas/PAGO MAQUILAS GENERAL.xlsx'
const RUTA_PACKS = 'C:/Users/elita/Desktop/RAGNAR/datos/precios/UPC-con-codigos-de-cada-pack-27AGO26.xlsx'

// Los que Cielo confirmo explicitamente por correo (25-08). Mandan sobre el
// historico: son su palabra, no una inferencia nuestra. Llave: maquila||UPC.
const CONFIRMADOS = new Map([
  ['RODA TEXTIL||7506097255697', 6.5], ['RODA TEXTIL||7506097255765', 7.5],
  ['RODA TEXTIL||7506097255710', 6.5], ['HUGO MARTINEZ||9004', 3],
  ['EDGAR MUNGUIA||7506097258520', 6], ['EDGAR MUNGUIA||101697', 7],
  ['EDGAR MUNGUIA||SFT000', 5.5], ['EDGAR MUNGUIA||SFT001', 5.5],
  ['EDGAR MUNGUIA||RX24Q104', 10], ['JAVIER MENDOZA||CATT204', 6]
])

// Los nombres del Excel de pagos -> los maquilaId de Firestore.
const A_MAQUILA_ID = new Map([
  ['JAVIER MENDOZA', 'javier_mendoza'], ['EDGAR MUNGUIA', 'edgar_munguia'],
  ['ARACELI SANCHEZ', 'araceli_sanchez'], ['RODA TEXTIL', 'rober_lopez'],
  ['EDUARDO RODRIGUEZ', 'eduardo_rodriguez'], ['HUGO MARTINEZ', 'hugo_martinez']
])

const val = (c) => { let x = c.value; if (x && typeof x === 'object') x = x.result ?? x.text ?? ''; return String(x ?? '').trim() }
// La MISMA normalizacion que usa la app (normalizarModelo): mayusculas,
// espacios colapsados y la diagonal a guion, porque el modelo es el ID del
// documento y Firestore usa la diagonal como separador de ruta.
const norm = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/\//g, '-')
// EL PROCESO NORMAL ES EL DE CADA MAQUILA, NO UNO GLOBAL (corregido 28-08).
//
// La primera version fijaba 'PAREADO SENCILLO' como la tarifa normal de todos,
// con una excepcion a mano para Hugo y Roda porque Cielo dijo que su
// "ETIQUETADO" en realidad es pareado sencillo. El resultado fue que TRES
// maquilas se quedaron sin un solo precio -- y Roberto lo cazo: "no hace
// sentido que no tengamos los precios de esas maquilas".
//
// Tenia razon, y el histórico lo confirma: Eduardo Rodriguez tiene 111
// renglones de ETIQUETADO, TODOS a $5.50. El precio siempre estuvo ahi; lo
// tapaba mi filtro.
//
// La regla correcta es una sola y explica a las seis: la tarifa normal de una
// maquila es EL PROCESO QUE ESA MAQUILA DE VERDAD HACE, o sea el que domina
// sus renglones. Reproduce sin excepciones a mano lo que Cielo dijo (Edgar
// domina en pareado sencillo; Hugo y Roda en etiquetado) y ademas le da precio
// a las tres que faltaban.
function procesoNormalPorMaquila(ws, val, norm) {
  const cuenta = new Map()
  for (let r = 2; r <= ws.rowCount; r++) {
    const g = ws.getRow(r)
    const maq = norm(val(g.getCell(2)))
    const pro = norm(val(g.getCell(7)))
    const pre = Number(val(g.getCell(8))) || 0
    if (!maq || !pro || pre <= 0) continue
    if (!cuenta.has(maq)) cuenta.set(maq, new Map())
    const c = cuenta.get(maq)
    c.set(pro, (c.get(pro) || 0) + 1)
  }
  const normal = new Map()
  for (const [maq, c] of cuenta) {
    const [pro] = [...c.entries()].sort((a, b) => b[1] - a[1])[0]
    normal.set(maq, pro)
  }
  return normal
}
const numSemana = (s) => Number(String(s).match(/\d+/)?.[0] ?? 0)

async function main() {
  console.log(EJECUTAR ? '=== MODO REAL: se van a escribir precios ===\n' : '=== SIMULACION (nada se escribe) ===\n')

  // UPC -> modelo, segun Cielo
  const wbC = new ExcelJS.Workbook(); await wbC.xlsx.readFile(RUTA_PACKS)
  const wsC = wbC.getWorksheet('UPC A LIGAR')
  const upcAModelo = new Map()
  for (let r = 2; r <= wsC.rowCount; r++) {
    const g = wsC.getRow(r); const u = val(g.getCell(1)); const m = norm(val(g.getCell(4)))
    if (u && m) upcAModelo.set(u, m)
  }
  console.log(`equivalencias UPC -> modelo: ${upcAModelo.size}`)

  // Historico de pagos, solo tarifa normal
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(RUTA_PAGOS)
  const ws = wb.worksheets[0]
  const PROCESO_NORMAL = procesoNormalPorMaquila(ws, val, norm)
  console.log('')
  console.log('proceso normal de cada maquila (el que mas hace):')
  ;[...PROCESO_NORMAL.entries()].sort().forEach(([m, p]) => console.log(`  ${m.padEnd(18)} ${p}`))
  const esNormal = (maq, pro) => PROCESO_NORMAL.get(maq) === pro

  const acum = new Map() // maquila||modelo -> { porSemana: Map(sem -> Set(precio)), confirmado, docenas }
  for (let r = 2; r <= ws.rowCount; r++) {
    const g = ws.getRow(r)
    const sem = numSemana(val(g.getCell(1)))
    const maq = norm(val(g.getCell(2)))
    const upc = val(g.getCell(6))
    const pro = norm(val(g.getCell(7)))
    const pre = Number(val(g.getCell(8))) || 0
    const doc = Number(val(g.getCell(9))) || 0
    if (!maq || pre <= 0 || !esNormal(maq, pro)) continue
    const modelo = upcAModelo.get(upc) || norm(upc)
    if (!modelo) continue
    const k = `${maq}||${modelo}`
    if (!acum.has(k)) acum.set(k, { maq, modelo, porSemana: new Map(), confirmado: null, docenas: 0, upcs: new Set() })
    const e = acum.get(k)
    if (!e.porSemana.has(sem)) e.porSemana.set(sem, new Set())
    e.porSemana.get(sem).add(pre)
    e.docenas += doc
    e.upcs.add(upc)
    const conf = CONFIRMADOS.get(`${maq}||${upc}`)
    if (conf !== undefined) e.confirmado = conf
  }

  // Resolver el precio de cada clave
  const filas = []
  let porConfirmado = 0, porUltimo = 0, unico = 0
  for (const e of acum.values()) {
    const semanas = [...e.porSemana.keys()].sort((a, b) => a - b)
    const ultima = semanas[semanas.length - 1]
    const deUltima = [...e.porSemana.get(ultima)]
    const todos = new Set([...e.porSemana.values()].flatMap((s) => [...s]))
    let precio, razon
    if (e.confirmado !== null) { precio = e.confirmado; razon = 'confirmado por Cielo'; porConfirmado++ }
    else if (todos.size === 1) { precio = [...todos][0]; razon = 'unico en el historico'; unico++ }
    else {
      // "Quedate con el ultimo": el mayor de la ultima semana en que aparece.
      precio = Math.max(...deUltima); razon = `ultimo precio (semana ${ultima})`; porUltimo++
    }
    filas.push({ ...e, precio, razon, distintos: todos.size })
  }
  filas.sort((a, b) => a.maq.localeCompare(b.maq) || a.modelo.localeCompare(b.modelo))

  console.log(`\nPRECIOS A CARGAR: ${filas.length}`)
  console.log(`  precio unico en el historico: ${unico}`)
  console.log(`  confirmados por Cielo:        ${porConfirmado}`)
  console.log(`  resueltos por "ultimo precio": ${porUltimo}`)
  const diez = filas.filter((f) => f.precio === 10)
  console.log(`  que quedan en $10 (especiales, decision de direccion): ${diez.length}`)
  console.log('\nlos resueltos por ultimo precio o confirmados:')
  filas.filter((f) => f.razon !== 'unico en el historico').forEach((f) =>
    console.log(`  ${f.maq.padEnd(16)} ${f.modelo.padEnd(24)} $${String(f.precio).padEnd(6)} ${f.razon}`))

  const sinMaquila = filas.filter((f) => !A_MAQUILA_ID.has(f.maq))
  if (sinMaquila.length) {
    console.log(`\n⚠️ maquilas sin id conocido (NO se cargan): ${[...new Set(sinMaquila.map((f) => f.maq))].join(', ')}`)
  }

  if (!EJECUTAR) {
    console.log('\nSimulacion. Para aplicar: EJECUTAR=1 node scripts/cargar_precios_maquila.mjs')
    return
  }

  initializeApp({ credential: cert(JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'))) })
  const db = getFirestore()
  let ok = 0
  for (const f of filas) {
    const maquilaId = A_MAQUILA_ID.get(f.maq)
    if (!maquilaId) continue
    try {
      await db.collection('portalMaquila').doc(maquilaId).collection('preciosEnsamble').doc(f.modelo).set({
        modelo: f.modelo,
        maquilaId,
        precioPorPack: f.precio,
        notas: `${f.razon}. Cargado del historico el 27-08.`.slice(0, 200),
        actualizadoEn: FieldValue.serverTimestamp(),
        actualizadoPorUid: 'script-carga-historico',
        actualizadoPorNombre: 'Carga inicial (autorizada por direccion 27-08)'
      }, { merge: true })
      ok++
    } catch (err) {
      console.error(`  ERROR ${f.maq}/${f.modelo}:`, err.message)
    }
  }
  console.log(`\nprecios escritos: ${ok}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
