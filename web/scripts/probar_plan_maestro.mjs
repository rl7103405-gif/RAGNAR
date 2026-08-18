/**
 * Corre el lector del plan maestro contra un Excel, SIN tocar Firestore.
 *
 *   node scripts/probar_plan_maestro.mjs "../datos/plan-maestro/archivo.xlsx"
 *
 * Para que sirve: cuando Adrian mande un archivo nuevo o le cambie las
 * columnas, esto dice en diez segundos que entendio la app — cuantas ordenes,
 * cuantos pedidos, que columnas gano cada campo y que se quedo fuera — antes
 * de que el lo suba y se lleve la sorpresa en pantalla.
 *
 * Importa el MISMO lector que usa la app (no una copia), por eso vale como
 * verificacion. Puede hacerlo porque planMaestroNucleo.js no importa Firebase.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leerPlanMaestro } from '../src/utils/importarPlanMaestro.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))

const ruta = process.argv[2]
if (!ruta) {
  console.error('Uso: node scripts/probar_plan_maestro.mjs <archivo.xlsx>')
  process.exit(1)
}
const absoluta = path.resolve(AQUI, '..', ruta)
if (!fs.existsSync(absoluta)) {
  console.error('No existe el archivo:', absoluta)
  process.exit(1)
}

// El lector espera un File del navegador; en Node basta con algo que tenga
// arrayBuffer(), que es lo unico que usa.
const buffer = fs.readFileSync(absoluta)
const comoArchivo = {
  name: path.basename(absoluta),
  arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

const n = (v) => String(v ?? 0).padStart(6)

const { lineas, pedidos, diagnostico: d } = await leerPlanMaestro(comoArchivo)

console.log('\n============================================================')
console.log('ARCHIVO:', comoArchivo.name)
console.log('============================================================')

console.log('\n--- LO QUE ENTRO ---')
console.log(n(d.totalLineas), 'lineas del plan (OC + OT + codigo)')
console.log(n(d.totalOcs), 'ordenes de compra')
console.log(n(d.totalOts), 'ordenes de trabajo CON orden de compra')
console.log(n(d.totalPedidos), 'entradas del diccionario pedido -> OT')
console.log(n(d.otsEnDiccionario), 'ordenes de trabajo que conoce el diccionario')

console.log('\n--- HOJAS LEIDAS ---')
d.hojasLeidas.forEach((h) => {
  const cols = Object.entries(h.columnas)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=col${v}`)
    .join(' ')
  console.log(`  ${h.hoja}: ${h.lineas} lineas, ${h.pedidos} pedidos`)
  console.log(`     ${cols || '(ninguna columna)'}`)
})

console.log('\n--- HOJAS IGNORADAS ---')
d.hojasIgnoradas.forEach((h) => {
  console.log(`  ${h.hoja}: ${h.encabezados.slice(0, 8).join(' | ')}`)
})

if (d.ambiguedades.length) {
  console.log('\n--- COLUMNAS QUE COMPITIERON (revisar que gano la buena) ---')
  d.ambiguedades.forEach((a) => {
    console.log(`  [${a.hoja}] ${a.campo}: gano "${a.gano}", se descarto: ${a.descartadas.join(', ')}`)
  })
}

console.log('\n--- LO QUE NO ENTRO ---')
console.log(n(d.sinOc), 'renglones sin orden de compra (normal: la columna es nueva)')
console.log(n(d.ocInvalida), "renglones con OC no valida ('0', 'FCST'...)")
console.log(n(d.formulaSinResultado), 'renglones cuya OC es una FORMULA QUE EXCEL NO GUARDO CALCULADA')
console.log(n(d.sinCantidad), 'lineas sin meta (entran, pero no se les puede medir avance)')
console.log(n(d.sinCodigo), 'lineas sin codigo')
console.log(n(d.duplicadosDeOtraHoja), 'renglones descartados: esa OT ya la aporto otra hoja')
console.log(n(d.totalIncompletos), 'renglones rechazados')
console.log(n(d.totalConflictosDePedido), 'pedidos con DOS ordenes distintas (se descartan)')

if (d.renglonesIncompletos.length) {
  console.log('\n  primeros rechazados:')
  d.renglonesIncompletos.slice(0, 10).forEach((r) => console.log(`    [${r.hoja}] fila ${r.fila}: ${r.motivo}`))
}
if (d.conflictosDePedido.length) {
  console.log('\n  primeros conflictos de pedido:')
  d.conflictosDePedido.slice(0, 10).forEach((c) => console.log(`    "${c.pedido}" -> ${c.ots.join(' y ')}`))
}

console.log('\n--- MUESTRA DE LINEAS ---')
lineas.slice(0, 8).forEach((l) => {
  const meta = l.cantidadPlaneada === null ? 'SIN META' : l.cantidadPlaneada
  console.log(`  OC ${String(l.oc).padEnd(12)} OT ${String(l.ot).padEnd(7)} ${String(l.codigo).padEnd(12)} ${meta}`)
})

console.log('\n--- MUESTRA DEL DICCIONARIO ---')
pedidos.slice(0, 8).forEach((p) => {
  console.log(`  ${String(p.ot).padEnd(7)} <- ${p.pedidoTexto}`)
})

// Las OC con mas ordenes de trabajo: es la vista que va a ver Lindbergh.
const porOc = new Map()
lineas.forEach((l) => {
  if (!porOc.has(l.oc)) porOc.set(l.oc, new Set())
  porOc.get(l.oc).add(l.ot)
})
console.log('\n--- ORDENES DE COMPRA (las que veria Lindbergh) ---')
;[...porOc.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 15)
  .forEach(([oc, ots]) => console.log(`  OC ${String(oc).padEnd(12)} ${String(ots.size).padStart(3)} ordenes de trabajo`))
console.log()
