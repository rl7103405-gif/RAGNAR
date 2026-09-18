/**
 * RELLENA LOS HUECOS DE LOS TECH PACKS APROBADOS CON LO QUE DICE SU PROPIO
 * ARCHIVO ORIGINAL, SIN QUITARLES LA APROBACION.
 *
 * Roberto, 2026-09-18: "arreglalos, pero ve que no le quiten la aprobacion;
 * pruebalos tu mismo". Los tech packs migrados el 11-sep pasaron por el lector
 * de ANTES: no leia el encabezado "COLOR" a secas ni sacaba los pares por pack
 * de "UNIPACK". El lector de hoy si (17-sep).
 *
 * QUE HACE, y que NO hace:
 *   - NO reconvierte. Abre el archivo VIGENTE (la plantilla que Lety aprobo) y
 *     solo ESCRIBE EN CELDAS VACIAS: pares por pack, y color / bordado / hilo
 *     de cada codigo. Nunca sobrescribe un dato.
 *   - El dato sale del ARCHIVO ORIGINAL de ese mismo tech pack (el que se
 *     respaldo en respaldoOriginal al migrar, verificado por su huella), leido
 *     con el lector de hoy. No se inventa nada.
 *   - Verifica antes de escribir: reabre lo nuevo, y comprueba que la
 *     estructura sigue sana, que cada celda que tenia dato sigue IGUAL, y que
 *     las fotos son las mismas.
 *   - La aprobacion se TRASLADA a la version nueva conservando quien y cuando
 *     aprobo, y queda el rastro en techPacks/{codigo}/aprobaciones con
 *     'trasladadaDe' y el motivo.
 *
 * Uso (en web/):
 *   node scripts/rellenar_desde_original.mjs            <- ensayo
 *   EJECUTAR=1 node scripts/rellenar_desde_original.mjs
 *   SOLO=5518-C,CIW03                                    (opcional)
 */
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { idPedazo, idsDePedazos, idsSobrantes } from '../src/utils/pedazosTechPack.js'
import { leerPlantilla, medirPlantilla } from '../src/utils/leerPlantillaTechPack.js'
import { extraerTechPackViejo } from '../src/utils/migrarTechPackViejo.js'
import { identidadDePlantilla } from '../src/utils/clienteModeloTechPack.js'
import { TABLAS } from '../src/utils/plantillaTechPack.js'
// Mismos valores que tareasEnsamble.js (ese archivo importa Firebase del navegador).
const CHUNK_BYTES = 950000
const MAX_CHUNKS = 17

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) })
const db = getFirestore()
const EJECUTAR = process.env.EJECUTAR === '1'
const SOLO = new Set(String(process.env.SOLO || '').split(',').map((s) => s.trim()).filter(Boolean))
const MARCA = { uid: 'relleno-original-2026-09-18', nombre: 'RAGNAR (relleno con datos de su archivo original)' }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const pad2 = (i) => String(i).padStart(2, '0')
const aBuffer = (v) => Buffer.from(v?._byteString?.binaryString ? Buffer.from(v._byteString.binaryString, 'binary') : v)
const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const pelado = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const colNum = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
console.log(EJECUTAR ? 'APLICANDO' : 'ENSAYO (no escribe nada)')

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
function rango(libro, nombre) {
  const d = (libro.definedNames.model || []).find((x) => x.name === nombre)
  const m = /^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(d?.ranges?.[0] || ''))
  if (!m) return null
  return { hoja: libro.getWorksheet(m[1].replace(/''/g, "'")), c1: colNum(m[2]), f1: Number(m[3]), c2: colNum(m[4] || m[2]), f2: Number(m[5] || m[3]) }
}
// Todo lo que tenia dato ANTES tiene que seguir IGUAL despues.
function comparar(antes, despues) {
  const cambios = []
  for (const [k, v] of Object.entries(antes.campos)) if (lleno(v) && String(v) !== String(despues.campos[k])) cambios.push(`${k}: "${v}" -> "${despues.campos[k]}"`)
  for (const [t, filas] of Object.entries(antes.tablas)) {
    filas.forEach((f, i) => { for (const [c, v] of Object.entries(f)) if (lleno(v) && String(v) !== String(despues.tablas[t]?.[i]?.[c])) cambios.push(`${t}[${i}].${c}`) })
  }
  if (JSON.stringify(antes.fotos) !== JSON.stringify(despues.fotos)) cambios.push(`fotos ${JSON.stringify(antes.fotos)} -> ${JSON.stringify(despues.fotos)}`)
  const nAvios = (m) => Object.values(m || {}).filter(Boolean).length
  if (nAvios(antes.imagenesAvios) !== nAvios(despues.imagenesAvios)) cambios.push("imagenes de avios")
  return cambios
}

const snap = await db.collection('techPacks').where('esPrueba', '==', false).get()
let rellenados = 0, sinCambio = 0, rechazados = 0
for (const d of snap.docs.sort((a, b) => a.id.localeCompare(b.id))) {
  const codigo = d.id
  const x = d.data()
  if (SOLO.size && !SOLO.has(codigo)) continue
  if (x.apuntaA || !x.techPack?.totalChunks || x.techPack.formato !== 'xlsx') continue
  const aprobado = Boolean(x.aprobacion?.sha256 && x.aprobacion.sha256 === x.techPack.sha256)
  if (!aprobado) continue // los pendientes los ve Lety al aprobar; aqui solo los aprobados
  try {
    const orig = await respaldo(d.ref, x.techPackAnterior)
    if (!orig) continue
    const buf = await vigente(d.ref, x.techPack)
    if (!buf) { console.log(`  ${codigo.padEnd(20)} pedazos incompletos: NO se toca`); rechazados++; continue }
    // Lo que se abre tiene que ser EXACTAMENTE el archivo aprobado (Codex, 18-sep).
    if (sha(buf) !== x.techPack.sha256 || sha(buf) !== x.aprobacion.sha256) { console.log(`  ${codigo.padEnd(20)} el archivo no es el aprobado (huella): NO se toca`); rechazados++; continue }
    const libro = new ExcelJS.Workbook(); await libro.xlsx.load(buf)
    const antes = leerPlantilla(libro)
    const lo = new ExcelJS.Workbook(); await lo.xlsx.load(orig)
    const { datos } = extraerTechPackViejo(lo, { codigo })

    const hechos = []
    // pares por pack
    if (!lleno(antes.campos.TP_PACK) && Number(datos.paresPorPack) > 0) {
      const r = rango(libro, 'TP_PACK')
      if (r?.hoja) { r.hoja.getCell(r.f1, r.c1).value = Number(datos.paresPorPack); hechos.push(`pares por pack = ${datos.paresPorPack}`) }
    }
    // color / bordado / hilo por codigo, solo en celdas vacias
    const rc = rango(libro, 'TP_TABLA_CODIGOS')
    const cols = Object.fromEntries(TABLAS.TP_TABLA_CODIGOS.columnas.map((c) => [c.clave, colNum(c.col)]))
    const porCodigo = new Map((datos.codigosRuta || []).map((c) => [pelado(c.codigo), c]))
    let celdas = 0
    // En la hoja 2 la columna CODIGO es una FORMULA que jala el codigo de la
    // hoja 1; el codigo de cada renglon se toma de la tabla del pedido por
    // POSICION, igual que lo empareja la calificacion (medirPlantilla).
    const codigosPedido = (antes.tablas.TP_TABLA_PEDIDO || []).map((r) => r.codigo)
    if (rc?.hoja) {
      for (let f = rc.f1 + 1; f <= rc.f2; f++) {
        const cod = codigosPedido[f - rc.f1 - 1]
        const o = porCodigo.get(pelado(cod))
        if (!lleno(cod) || !o) continue
        for (const k of ['colorCuerpo', 'bordado', 'hilo']) {
          const celda = rc.hoja.getCell(f, cols[k])
          if (!lleno(celda.value) && lleno(o[k])) { celda.value = String(o[k]); celdas++ }
        }
      }
    }
    if (celdas) hechos.push(`${celdas} celda(s) de color/bordado/hilo`)
    if (!hechos.length) { sinCambio++; continue }

    const nuevo = Buffer.from(await libro.xlsx.writeBuffer())
    const vuelta = new ExcelJS.Workbook(); await vuelta.xlsx.load(nuevo)
    const despues = leerPlantilla(vuelta)
    const cambios = comparar(antes, despues)
    if ((despues.faltaEstructura || []).length || cambios.length) {
      console.log(`  ${codigo.padEnd(20)} NO se toca: la verificacion fallo (${[...(despues.faltaEstructura || []), ...cambios].slice(0, 3).join('; ')})`)
      rechazados++; continue
    }
    const total = Math.ceil(nuevo.length / CHUNK_BYTES)
    if (total > MAX_CHUNKS) { console.log(`  ${codigo.padEnd(20)} rebasa 15 MB: NO se toca`); rechazados++; continue }
    const shaNuevo = sha(nuevo)
    const medAntes = medirPlantilla(antes).porcentaje
    const med = medirPlantilla(despues)
    console.log(`  ${codigo.padEnd(20)} ${hechos.join(' · ')} · ${medAntes}% -> ${med.porcentaje}% · aprobado por ${x.aprobacion.porNombre} se conserva`)
    if (!EJECUTAR) { rellenados++; continue }

    for (let i = 0; i < total; i++) {
      await d.ref.collection('chunks').doc(idPedazo('tp', shaNuevo, i)).set({ codigo, tipo: 'tp', datos: nuevo.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
    }
    const manifiesto = { nombre: x.techPack.nombre, formato: 'xlsx', tamano: nuevo.length, totalChunks: total, sha256: shaNuevo, version: (x.techPack.version || 1) + 1, subidoEn: FieldValue.serverTimestamp(), subidoPorUid: MARCA.uid, subidoPorNombre: MARCA.nombre }
    const subido = await vigente(d.ref, manifiesto)
    if (!subido || sha(subido) !== shaNuevo) throw new Error('lo subido no coincide con lo verificado (sha256)')
    // El visto bueno se TRASLADA a la version nueva: misma persona y fecha, y
    // dice que lo traslado RAGNAR y de que version venia (Codex, 18-sep: sin
    // eso se le atribuiria a Lety una aprobacion que no hizo).
    const aprobacion = {
      version: manifiesto.version, sha256: shaNuevo, porUid: x.aprobacion.porUid, porNombre: x.aprobacion.porNombre, en: x.aprobacion.en,
      trasladadaPor: 'RAGNAR', trasladadaDe: { version: x.aprobacion.version, sha256: x.aprobacion.sha256 }
    }
    const lote = db.batch()
    // Si la aprobacion original todavia no esta en el historial, se rescata primero.
    if (!x.ultimoEventoAprobacionId) {
      lote.set(d.ref.collection('aprobaciones').doc(), {
        accion: 'aprobar', version: x.aprobacion.version, sha256: x.aprobacion.sha256, porUid: x.aprobacion.porUid, porNombre: x.aprobacion.porNombre, en: x.aprobacion.en,
        rescatado: true, rescatadoEn: FieldValue.serverTimestamp()
      })
    }
    const refEvento = d.ref.collection('aprobaciones').doc()
    // PRECONDICION: si alguien subio, aprobo o retiro mientras se procesaba,
    // el documento ya no es el que se leyo y el lote entero se rechaza.
    lote.update(d.ref, {
      techPack: manifiesto,
      ...identidadDePlantilla(despues),
      medicion: { ...med, hojas: vuelta.worksheets.length, medidoEn: new Date(), version: '2026-09-v2-plantilla' },
      aprobacion,
      ultimoEventoAprobacionId: refEvento.id,
      actualizadoEn: FieldValue.serverTimestamp(), actualizadoPorUid: MARCA.uid, actualizadoPorNombre: MARCA.nombre
    }, { lastUpdateTime: d.updateTime })
    lote.set(d.ref.collection('versiones').doc(`tp-${manifiesto.version}-${shaNuevo}`), {
      tipo: 'tp', version: manifiesto.version, nombre: manifiesto.nombre, tamano: manifiesto.tamano, sha256: shaNuevo,
      subidoEn: FieldValue.serverTimestamp(), subidoPorUid: MARCA.uid, subidoPorNombre: `${MARCA.nombre}: ${hechos.join(', ')}`.slice(0, 120)
    })
    lote.set(refEvento, {
      accion: 'trasladar', version: manifiesto.version, sha256: shaNuevo, porUid: x.aprobacion.porUid, porNombre: x.aprobacion.porNombre, en: x.aprobacion.en,
      trasladadaPor: 'RAGNAR',
      trasladadaDe: { version: x.aprobacion.version, sha256: x.aprobacion.sha256 },
      motivo: `RAGNAR relleno huecos con datos del archivo original que ya estaba aprobado (${hechos.join(', ')}); no cambio ningun dato existente`,
      trasladadaEn: FieldValue.serverTimestamp()
    })
    await lote.commit()
    // Limpieza SOLO si lo vigente sigue siendo lo que se acaba de publicar: si
    // alguien subio despues, sus pedazos no se tocan (Codex, 18-sep).
    const ahora = (await d.ref.get()).data()
    if (ahora?.techPack?.sha256 === shaNuevo) {
      const existentes = new Set((await d.ref.collection('chunks').get()).docs.map((c) => c.id))
      for (const id of idsSobrantes(existentes, 'tp', ahora.techPack)) await d.ref.collection('chunks').doc(id).delete()
    }
    rellenados++
  } catch (err) {
    console.log(`  ${codigo.padEnd(20)} ERROR ${(err?.message || String(err)).slice(0, 160)}`)
    rechazados++
  }
}
console.log(`\n${EJECUTAR ? 'rellenados' : 'listos para rellenar'}: ${rellenados} | nada que rellenar: ${sinCambio} | no se tocaron (verificacion o error): ${rechazados}`)
if (!EJECUTAR) console.log('Ensayo. Para aplicarlo: EJECUTAR=1 node scripts/rellenar_desde_original.mjs')
process.exit(0)
