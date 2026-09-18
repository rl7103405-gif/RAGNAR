/**
 * ACOMODA SOLO LO QUE NO TIENE DUDA DE LOS "DATOS SIN ACOMODAR".
 *
 * Roberto, 18-sep: "esos datos no se pueden estar olvidando". De los textos que
 * la conversion no supo donde poner, dos casos tienen UN solo lugar posible:
 *   - un valor de la lista de tejidos ("CIRCULAR") con "Tipo de tejido" vacio;
 *   - una frase que dice en que se embarca ("SE VA EN BULTO") con "Se embarca
 *     en" vacio (y si es bulto sin docenas, el estandar de 50 docenas).
 * Todo lo demas se queda en la lista para que Lety decida: RAGNAR no adivina.
 *
 * Igual que rellenar_desde_original.mjs: SOLO celdas vacias, verifica que ningun
 * dato existente cambie y que las fotos sean las mismas, precondicion de tiempo,
 * y si estaba aprobado traslada el visto bueno marcado como hecho por RAGNAR.
 * El texto acomodado sale de la lista de pendientes (ya quedo en su lugar).
 *
 * Uso (en web/):  node scripts/acomodar_sobrantes.mjs            <- ensayo
 *                 EJECUTAR=1 node scripts/acomodar_sobrantes.mjs
 */
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idPedazo, idsDePedazos } from '../src/utils/pedazosTechPack.js'
import { leerPlantilla, medirPlantilla } from '../src/utils/leerPlantillaTechPack.js'
import { identidadDePlantilla } from '../src/utils/clienteModeloTechPack.js'
import { DOCENAS_POR_BULTO_ESTANDAR, HOJAS, LISTAS } from '../src/utils/plantillaTechPack.js'

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
const CHUNK_BYTES = 950000
const MAX_CHUNKS = 17
const MARCA = { uid: 'acomodo-sobrantes-2026-09-18', nombre: 'RAGNAR (acomodo datos del archivo anterior)' }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const aBuffer = (v) => Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v)
const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const norm = (s) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const colNum = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
const TEJIDOS = new Set(LISTAS.tejido.map(norm))
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

async function vigente(ref, tp) {
  const ch = await ref.collection('chunks').get()
  const porId = new Map(ch.docs.map((d) => [d.id, d]))
  const { ids, completo } = idsDePedazos(new Set(porId.keys()), 'tp', tp)
  return completo ? Buffer.concat(ids.map((id) => aBuffer(porId.get(id).data().datos))) : null
}
function celdaDe(libro, nombre) {
  const d = (libro.definedNames.model || []).find((x) => x.name === nombre)
  const m = /^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)/.exec(String(d?.ranges?.[0] || ''))
  const hoja = m && libro.getWorksheet(m[1].replace(/''/g, "'"))
  return hoja ? hoja.getCell(Number(m[3]), colNum(m[2])) : null
}
// Vacia DE VERDAD: una formula lee como null en leerPlantilla y no se puede pisar.
const vacia = (celda) => celda.value === null || celda.value === undefined || (typeof celda.value === 'string' && celda.value.trim() === '')
function comparar(antes, despues) {
  const cambios = []
  for (const [k, v] of Object.entries(antes.campos)) if (lleno(v) && String(v) !== String(despues.campos[k])) cambios.push(k)
  for (const [t, filas] of Object.entries(antes.tablas)) filas.forEach((f, i) => { for (const [c, v] of Object.entries(f)) if (lleno(v) && String(v) !== String(despues.tablas[t]?.[i]?.[c])) cambios.push(`${t}[${i}].${c}`) })
  if (JSON.stringify(antes.fotos) !== JSON.stringify(despues.fotos)) cambios.push('fotos')
  return cambios
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
let hechos = 0, nada = 0, rechazados = 0
for (const d of snap.docs.sort((a, b) => a.id.localeCompare(b.id))) {
  const x = d.data()
  if (x.apuntaA || !x.techPack?.totalChunks || x.techPack.formato !== 'xlsx') continue
  try {
    const buf = await vigente(d.ref, x.techPack)
    if (!buf || sha(buf) !== x.techPack.sha256) continue
    const libro = new ExcelJS.Workbook(); await libro.xlsx.load(buf)
    const antes = leerPlantilla(libro)
    const sob = antes.noMigrado || []
    if (!sob.length) continue
    const usados = new Set()
    const que = []
    // tejido
    if (!lleno(antes.campos.TP_TEJIDO)) {
      const tej = [...new Set(sob.filter((s) => TEJIDOS.has(norm(s.texto))).map((s) => norm(s.texto)))]
      if (tej.length === 1) {
        const c = celdaDe(libro, 'TP_TEJIDO')
        if (c && vacia(c)) { c.value = tej[0]; que.push(`tejido = ${tej[0]}`); sob.forEach((s, i) => { if (norm(s.texto) === tej[0]) usados.add(i) }) }
      }
    }
    // en que se embarca (+ estandar de bulto)
    if (!['CAJA', 'BULTO'].includes(norm(antes.campos.TP_EMBALAJE))) {
      // Solo la frase SIMPLE: con negacion, las dos palabras o una cantidad
      // ("SE VA EN BULTO DE 40 DOCENAS") lo decide una persona (Codex, 18-sep).
      const dichos = sob.map((s, i) => ({ i, t: norm(s.texto) })).filter((s) => /^(SE VA|VA|SE EMBARCA|EMBARCA|SALE) EN (BULTO|CAJA)S?$/.test(s.t))
      const en = [...new Set(dichos.map((s) => (/BULTO/.test(s.t) ? 'BULTO' : 'CAJA')))]
      if (en.length === 1) {
        // Las plantillas de antes del 17-sep no traen el campo: se agrega igual
        // que lo hace el generador (etiqueta en D5, valor en E5 de la hoja 6).
        if (!celdaDe(libro, 'TP_EMBALAJE')) {
          const h6 = libro.getWorksheet(HOJAS.caja)
          if (h6 && !lleno(h6.getCell('E5').value) && !lleno(h6.getCell('D5').value)) {
            h6.getCell('D5').value = 'SE EMBARCA EN'
            h6.getCell('E5').dataValidation = { type: 'list', allowBlank: true, formulae: ['"CAJA,BULTO"'], showErrorMessage: true, errorTitle: 'Elige de la lista', error: 'CAJA o BULTO' }
            libro.definedNames.add(`'${HOJAS.caja}'!$E$5`, 'TP_EMBALAJE')
          }
        }
        const c = celdaDe(libro, 'TP_EMBALAJE')
        if (c && vacia(c)) {
          c.value = en[0]; que.push(`se embarca en ${en[0]}`); dichos.forEach((s) => usados.add(s.i))
          if (en[0] === 'BULTO' && !lleno(antes.campos.TP_DOCENAS_POR_CAJA)) {
            const cd = celdaDe(libro, 'TP_DOCENAS_POR_CAJA')
            if (cd && vacia(cd)) { cd.value = DOCENAS_POR_BULTO_ESTANDAR; que.push(`${DOCENAS_POR_BULTO_ESTANDAR} docenas por bulto (estandar)`) }
          }
        }
      }
    }
    if (!que.length) { nada++; continue }
    // lo acomodado sale de la lista de pendientes
    const hr = libro.getWorksheet(HOJAS.ragnar)
    for (let f = 1; f <= Math.min(hr.rowCount, 20); f++) {
      if (String(hr.getCell(`A${f}`).value) === 'noMigrado') { const quedan = sob.filter((_, i) => !usados.has(i)); hr.getCell(`B${f}`).value = quedan.length ? JSON.stringify(quedan) : '' }
    }
    const nuevo = Buffer.from(await libro.xlsx.writeBuffer())
    const vuelta = new ExcelJS.Workbook(); await vuelta.xlsx.load(nuevo)
    const despues = leerPlantilla(vuelta)
    const cambios = comparar(antes, despues)
    if ((despues.faltaEstructura || []).length || cambios.length) { console.log(`  ${d.id.padEnd(18)} NO se toca: verificacion (${[...(despues.faltaEstructura || []), ...cambios].slice(0, 3).join('; ')})`); rechazados++; continue }
    const total = Math.ceil(nuevo.length / CHUNK_BYTES)
    if (total > MAX_CHUNKS) { rechazados++; continue }
    const shaNuevo = sha(nuevo)
    const aprobado = Boolean(x.aprobacion?.sha256 && x.aprobacion.sha256 === x.techPack.sha256)
    const med = medirPlantilla(despues)
    console.log(`  ${d.id.padEnd(18)} ${que.join(' · ')} · ${medirPlantilla(antes).porcentaje}% -> ${med.porcentaje}% · ${aprobado ? 'aprobado: el visto bueno se traslada' : 'pendiente de Lety'}`)
    if (!EJECUTAR) { hechos++; continue }

    for (let i = 0; i < total; i++) await d.ref.collection('chunks').doc(idPedazo('tp', shaNuevo, i)).set({ codigo: d.id, tipo: 'tp', datos: nuevo.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
    const manifiesto = { nombre: x.techPack.nombre, formato: 'xlsx', tamano: nuevo.length, totalChunks: total, sha256: shaNuevo, version: (x.techPack.version || 1) + 1, subidoEn: FieldValue.serverTimestamp(), subidoPorUid: MARCA.uid, subidoPorNombre: MARCA.nombre }
    const subido = await vigente(d.ref, manifiesto)
    if (!subido || sha(subido) !== shaNuevo) throw new Error('lo subido no coincide con lo verificado')
    const lote = db.batch()
    const cambiosPadre = {
      techPack: manifiesto, ...identidadDePlantilla(despues),
      medicion: { ...med, hojas: vuelta.worksheets.length, medidoEn: new Date(), version: '2026-09-v2-plantilla' },
      actualizadoEn: FieldValue.serverTimestamp(), actualizadoPorUid: MARCA.uid, actualizadoPorNombre: MARCA.nombre
    }
    if (aprobado) {
      const refEvento = d.ref.collection('aprobaciones').doc()
      cambiosPadre.aprobacion = { version: manifiesto.version, sha256: shaNuevo, porUid: x.aprobacion.porUid, porNombre: x.aprobacion.porNombre, en: x.aprobacion.en, trasladadaPor: 'RAGNAR', trasladadaDe: { version: x.aprobacion.version, sha256: x.aprobacion.sha256 } }
      cambiosPadre.ultimoEventoAprobacionId = refEvento.id
      lote.set(refEvento, {
        accion: 'trasladar', version: manifiesto.version, sha256: shaNuevo, porUid: x.aprobacion.porUid, porNombre: x.aprobacion.porNombre, en: x.aprobacion.en,
        trasladadaPor: 'RAGNAR', trasladadaDe: { version: x.aprobacion.version, sha256: x.aprobacion.sha256 },
        motivo: `RAGNAR acomodo datos que su propio archivo ya traia sin acomodar (${que.join(', ')}); no cambio ningun dato existente`,
        trasladadaEn: FieldValue.serverTimestamp()
      })
    } else cambiosPadre.aprobacion = null
    lote.update(d.ref, cambiosPadre, { lastUpdateTime: d.updateTime })
    lote.set(d.ref.collection('versiones').doc(`tp-${manifiesto.version}-${shaNuevo}`), {
      tipo: 'tp', version: manifiesto.version, nombre: manifiesto.nombre, tamano: manifiesto.tamano, sha256: shaNuevo,
      subidoEn: FieldValue.serverTimestamp(), subidoPorUid: MARCA.uid, subidoPorNombre: `${MARCA.nombre}: ${que.join(', ')}`.slice(0, 120)
    })
    await lote.commit()
    // Solo los pedazos del archivo VIEJO de este tech pack (su huella): nunca los
    // de una subida que llegara en medio (Codex, 18-sep).
    const existentes = new Set((await d.ref.collection('chunks').get()).docs.map((c) => c.id))
    const viejos = idsDePedazos(existentes, 'tp', x.techPack)
    if (viejos.completo) for (const id of viejos.ids) await d.ref.collection('chunks').doc(id).delete()
    hechos++
  } catch (err) {
    console.log(`  ${d.id.padEnd(18)} ERROR ${(err?.message || String(err)).slice(0, 140)}`)
    rechazados++
  }
}
console.log(`\n${EJECUTAR ? 'acomodados' : 'listos para acomodar'}: ${hechos} | sin nada seguro que acomodar: ${nada} | no se tocaron: ${rechazados}`)
if (!EJECUTAR) console.log('Ensayo. Para aplicarlo: EJECUTAR=1 node scripts/acomodar_sobrantes.mjs')
process.exit(0)
