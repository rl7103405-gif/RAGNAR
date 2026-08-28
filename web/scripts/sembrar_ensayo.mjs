/**
 * Siembra los FOLIOS DE RUTEO del ensayo, directo al mundo de prueba.
 *
 * Por que existe este script y no se sube el Excel por la app
 * ----------------------------------------------------------
 * Las reglas prohiben que una cuenta de prueba escriba en `foliosRuteo`
 * (`soloCuentaReal()`, firestore.rules:724) y esta bien que asi sea: el ruteo
 * del dia es de toda la planta. Pero subirlo con una cuenta REAL meteria los
 * folios inventados al ruteo de verdad, y despues apareceran en la captura de
 * America. Roberto lo corto el 28-08: "no quiero que aparezca eso".
 *
 * La salida es sembrarlos con el SDK de administrador, que no pasa por las
 * reglas. Quedan marcados por su propio ID (`ZZTEST-*`), que es justo el
 * prefijo con el que la app ya distingue los dos mundos (`esFolioDePrueba`
 * en utils/mundoDatos.js): las pantallas los filtran solos.
 *
 * Los documentos se escriben con EXACTAMENTE los campos que exige
 * `ruteoValido()`, para que se comporten igual que uno cargado del Excel.
 *
 * Uso (dry-run por defecto):
 *   node scripts/sembrar_ensayo.mjs
 *   EJECUTAR=1 node scripts/sembrar_ensayo.mjs
 *
 * Para deshacerlo: scripts/limpiar_ensayo.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'

const EJECUTAR = process.env.EJECUTAR === '1'
initializeApp({ credential: cert(JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'))) })
const db = getFirestore()

const h = (hora, min) => Timestamp.fromDate(new Date(2026, 7, 28, hora, min, 0))

// Los mismos 12 folios de datos\pruebas\1-RUTEO-del-dia-PRUEBA.xlsx.
// Seis codigos REALES del catalogo que caen en solo TRES modelos, a proposito.
const FOLIOS = [
  ['ZZTEST-01', '1506-I', 6, '9901_ENSAYO_PT', h(7, 10)],
  ['ZZTEST-02', '1506-I', 6, '9901_ENSAYO_PT', h(7, 25)],
  ['ZZTEST-03', '1508-I', 6, '9901_ENSAYO_PT', h(7, 40)],
  ['ZZTEST-04', '1508-I', 6, '9901_ENSAYO_PT', h(7, 55)],
  ['ZZTEST-05', '1527-I', 5, '9902_ENSAYO_PT', h(8, 10)],
  ['ZZTEST-06', '1527-I', 5, '9902_ENSAYO_PT', h(8, 25)],
  ['ZZTEST-07', '1528-I', 5, '9902_ENSAYO_PT', h(8, 40)],
  ['ZZTEST-08', '1528-I', 5, '9902_ENSAYO_PT', h(8, 55)],
  ['ZZTEST-09', '7934-J', 7, '9903_ENSAYO_PT', h(9, 10)],
  ['ZZTEST-10', '7934-J', 7, '9903_ENSAYO_PT', h(9, 25)],
  ['ZZTEST-11', '7935-J', 7, '9903_ENSAYO_PT', h(9, 40)],
  ['ZZTEST-12', '7935-J', 7, '9903_ENSAYO_PT', h(9, 55)]
]

async function main() {
  console.log(EJECUTAR ? '=== MODO REAL: se van a sembrar ===\n' : '=== SIMULACION (nada se escribe) ===\n')

  // Candado propio: ningun folio de este script puede no ser de prueba.
  const malos = FOLIOS.filter(([f]) => !/^ZZTEST/.test(f))
  if (malos.length) throw new Error('Hay folios que no son de prueba: ' + malos.map((m) => m[0]).join(', '))

  for (const [folio, codigo, docenas, pedido, fecha] of FOLIOS) {
    const doc = {
      folio,
      codigo,
      docenas,
      pares: 0,
      total: docenas,
      pedido,
      nombreGuia: 'SIN RUTA',
      descripcion: 'ENSAYO DE PRUEBA - no es produccion real',
      modelo: null,
      color: null,
      fecha,
      fechaActualizacion: fecha,
      archivoOrigen: '1-RUTEO-del-dia-PRUEBA.xlsx',
      cargadoEn: FieldValue.serverTimestamp(),
      cargadoPorUid: 'script-sembrar-ensayo'
    }
    console.log(`  ${folio}  ${codigo}  ${docenas} doc  ${pedido}`)
    if (EJECUTAR) await db.collection('foliosRuteo').doc(folio).set(doc)
  }

  if (!EJECUTAR) {
    console.log(`\n${FOLIOS.length} folios se sembrarian. Para aplicar:`)
    console.log('   EJECUTAR=1 node scripts/sembrar_ensayo.mjs')
    return
  }
  const s = await db.collection('foliosRuteo').where('__name__', '>=', 'ZZTEST').where('__name__', '<', 'ZZTESU').get()
  console.log(`\nsembrados. folios ZZTEST en el ruteo: ${s.size}`)
  console.log('Ya se pueden capturar con demo_pesador.')
}

main().catch((e) => { console.error(e); process.exit(1) })
