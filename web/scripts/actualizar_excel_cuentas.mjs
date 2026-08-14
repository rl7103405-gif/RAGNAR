/**
 * Reescribe RAGNAR-CUENTAS.xlsx con TODAS las cuentas que existen hoy.
 *
 * NO toca nada: no crea cuentas, no cambia contrasenas, no escribe en
 * Firestore. Solo lee los perfiles y arma el Excel.
 *
 * Las contrasenas que ya estaban anotadas en el Excel SE CONSERVAN (se leen
 * del archivo anterior y se vuelven a escribir). Las que nunca se anotaron
 * quedan en blanco: Firebase guarda las contrasenas cifradas y NO hay forma
 * de leerlas, ni desde aqui ni desde la consola. Si alguien pierde la suya,
 * la unica salida es cambiarsela:
 *   node scripts/resetear_password.mjs <usuario>
 *
 * El archivo esta cubierto por .gitignore (*.xlsx): no entra al repo.
 *
 * Uso (en web/):
 *   node scripts/actualizar_excel_cuentas.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import {
  DOMINIO,
  PENDIENTE,
  QUE_VE,
  RUTA_EXCEL,
  abrirLibro,
  cargarExcelJs,
  columnasDe,
  explicarFalloDeEscritura,
  guardarLibro
} from './lib/excelCuentas.mjs'

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const Workbook = await cargarExcelJs()

// ---- 1. Rescatar las contrasenas ya anotadas en el Excel anterior ----
const yaAnotadas = new Map()
const previo = await abrirLibro()
if (previo) {
  previo.eachSheet((hoja) => {
    const col = columnasDe(hoja)
    if (!col) return
    hoja.eachRow((fila, n) => {
      if (n === 1) return
      const usuario = String(fila.getCell(col.usuario).value || '').trim()
      const pass = String(fila.getCell(col.pass).value || '').trim()
      // Ni el recordatorio ni las notas entre parentesis del formato viejo
      // ("(ya existia, no se cambio)") son contrasenas: reciclarlos haria que
      // el reporte del final dijera que ya no falta nadie.
      if (!usuario || !pass || pass === PENDIENTE || pass.startsWith('(')) return
      yaAnotadas.set(usuario, pass)
    })
  })
  console.log(`Rescatadas ${yaAnotadas.size} contrasena(s) del Excel anterior.`)
}

// ---- 2. Leer los perfiles reales ----
const snap = await db.collection('usuarios').get()
const perfiles = snap.docs
  // El empleadoId se normaliza aqui: un espacio de mas capturado a mano rompe
  // tanto el rescate de la contrasena como la busqueda en Auth.
  .map((d) => ({ ...d.data(), uid: d.id, empleadoId: String(d.data().empleadoId || '').trim() }))
  .filter((u) => u.empleadoId)
  .sort((a, b) => a.empleadoId.localeCompare(b.empleadoId, 'es'))

// ¿El perfil tiene cuenta de acceso de verdad? Un perfil sin cuenta en Auth
// no puede entrar, y conviene que se vea en el Excel.
for (const p of perfiles) {
  try {
    await auth.getUserByEmail(`${p.empleadoId}@${DOMINIO}`)
    p.tieneAcceso = true
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    p.tieneAcceso = false
  }
}

const maquilasSnap = await db.collection('maquilas').get()
const catalogoMaquilas = new Map(maquilasSnap.docs.map((d) => [d.id, d.data()]))

// ---- 3. Armar el Excel ----
const libro = new Workbook()
libro.creator = 'RAGNAR'
libro.created = new Date()

const estiloEncabezado = (hoja) => {
  const fila = hoja.getRow(1)
  fila.font = { bold: true }
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } }
  hoja.views = [{ state: 'frozen', ySplit: 1 }]
}

// Mismo criterio que la app y las reglas: exigen activo == true explicito.
// Un perfil sin el campo tampoco puede entrar, y aqui tiene que verse.
//
// Las CUENTAS DE PRUEBA se marcan aqui y no solo en el nombre: este script
// reconstruye el libro entero cada vez que corre, asi que si la marca no se
// derivara del perfil se perderia en la primera regeneracion y el Excel
// pasaria a decir que son personal de la fabrica.
const estadoDe = (p) => {
  const prefijo = p.esPrueba === true ? 'PRUEBA · ' : ''
  if (!p.tieneAcceso) return prefijo + 'SIN CUENTA: no puede entrar'
  if (p.activo !== true) return prefijo + 'DE BAJA: bloqueado'
  return prefijo + 'activo'
}

// Hoja 1: personal de Quini
const personal = libro.addWorksheet('Personal de Quini')
personal.addRow(['Usuario', 'Quien es', 'Rol', 'Contrasena', 'Estado', 'Que ve'])
perfiles
  .filter((p) => p.rol !== 'maquila')
  .forEach((p) =>
    personal.addRow([
      p.empleadoId,
      p.nombreCompleto || '',
      p.rol || '',
      yaAnotadas.get(p.empleadoId) || PENDIENTE,
      estadoDe(p),
      QUE_VE[p.rol] || ''
    ])
  )
personal.columns = [{ width: 15 }, { width: 20 }, { width: 11 }, { width: 24 }, { width: 26 }, { width: 54 }]
estiloEncabezado(personal)

// Hoja 2: maquilas
const maquilas = libro.addWorksheet('Maquilas')
maquilas.addRow(['Maquila', 'Usuario', 'Contrasena', 'ID interno', 'Estado', 'Que ve'])
perfiles
  .filter((p) => p.rol === 'maquila')
  .forEach((p) => {
    const cat = catalogoMaquilas.get(p.maquilaId) || {}
    const prefijo = p.esPrueba === true ? 'PRUEBA · ' : ''
    const estado = !catalogoMaquilas.has(p.maquilaId)
      ? prefijo + 'DATO ROTO: su maquilaId no esta en el catalogo'
      : cat.activo !== true
        ? prefijo + 'MAQUILA DE BAJA: portal cerrado'
        : estadoDe(p)
    maquilas.addRow([
      p.nombreCompleto || cat.nombre || '',
      p.empleadoId,
      yaAnotadas.get(p.empleadoId) || PENDIENTE,
      p.maquilaId || '',
      estado,
      QUE_VE.maquila
    ])
  })
maquilas.columns = [{ width: 22 }, { width: 18 }, { width: 24 }, { width: 18 }, { width: 30 }, { width: 54 }]
estiloEncabezado(maquilas)

// Pintar de rojo lo que necesita atencion.
;[personal, maquilas].forEach((hoja) => {
  hoja.eachRow((fila, n) => {
    if (n === 1) return
    fila.eachCell((celda) => {
      const v = String(celda.value || '')
      // includes y no startsWith: el estado puede venir con el prefijo
      // "PRUEBA · " delante, y con startsWith una cuenta de prueba sin acceso
      // dejaria de pintarse de rojo justo cuando hay que mirarla.
      const necesitaAtencion =
        v === PENDIENTE ||
        ['SIN CUENTA', 'DE BAJA', 'MAQUILA DE BAJA', 'DATO ROTO'].some((x) => v.includes(x))
      if (necesitaAtencion) celda.font = { color: { argb: 'FFAA0000' }, bold: true }
    })
  })
})

// Hoja 3: instrucciones
const info = libro.addWorksheet('Como entrar')
info.addRow(['RAGNAR — cuentas de acceso'])
info.getRow(1).font = { bold: true, size: 14 }
;[
  [''],
  ['Liga', 'https://quini-ragnar.web.app'],
  ['Usuario', 'El de la columna "Usuario", tal cual, sin arroba. La app le pone el dominio sola.'],
  [''],
  ['Por que hay contrasenas en blanco'],
  ['', 'Firebase guarda las contrasenas cifradas. NO se pueden leer: ni desde un script,'],
  ['', 'ni desde la consola de Firebase. Las que estan en blanco son las que se'],
  ['', 'teclearon a mano al crear la cuenta; escribelas tu aqui y quedan guardadas.'],
  [''],
  ['Si alguien perdio su contrasena'],
  ['', 'En web/:  node scripts/resetear_password.mjs <usuario>'],
  ['', 'Genera una nueva, la aplica y la deja escrita en este mismo Excel.'],
  ['', 'Solo afecta a esa persona.'],
  [''],
  ['Para dar de alta a alguien nuevo'],
  ['', 'En web/:  node scripts/crear_usuario_interno.mjs <usuario> "<Nombre>" <rol>'],
  ['', 'Roles: admin | completo | consulta | almacen | captura'],
  ['', 'Sin EJECUTAR=1 solo enseña lo que haria. Las maquilas van por su propio script.'],
  [''],
  [''],
  ['Las cuentas que dicen PRUEBA'],
  ['', 'NO son personal de la fabrica: son un juego de cuentas para probar la app,'],
  ['', 'una por cada perfil. Se crean con  node scripts/crear_usuarios_prueba.mjs'],
  ['', 'y lo que generan se borra con  node scripts/limpiar_datos_prueba.mjs'],
  ['', 'Las reglas de Firestore las tienen acotadas: solo pueden tocar folios que'],
  ['', 'empiecen con ZZTEST y la maquila "ZZZ PRUEBAS - NO USAR". No hay que'],
  ['', 'repartirlas a nadie del personal: cada quien usa la suya.'],
  [''],
  ['Para dar de baja a alguien', 'Poner activo=false en su perfil de usuarios: pierde el acceso al instante.'],
  ['Para cerrar el portal de una maquila', 'Darla de baja en el catalogo de maquilas (activo=false).'],
  [''],
  ['⚠️ Este archivo tiene contrasenas'],
  ['', 'No se sube al repo (lo cubre .gitignore con *.xlsx) ni al vault de notas.'],
  ['', 'Si lo compartes, que sea por un medio privado.']
].forEach((r) => info.addRow(r))
info.columns = [{ width: 36 }, { width: 82 }]

// El Excel se reconstruye desde los perfiles vivos, asi que una contrasena
// rescatada de alguien que ya no esta en Firestore se queda fuera. Es lo
// correcto (esa cuenta ya no existe), pero callarlo no: si el perfil
// desaparecio por un error de captura y no por una baja de verdad, esta es la
// ultima oportunidad de ver esa contrasena antes de que se pierda.
const vivos = new Set(perfiles.map((p) => p.empleadoId))
const descartadas = [...yaAnotadas.entries()].filter(([usuario]) => !vivos.has(usuario))
if (descartadas.length) {
  console.log(`\n${descartadas.length} contrasena(s) del Excel anterior YA NO SE VAN A ESCRIBIR:`)
  console.log('ese usuario ya no existe en Firestore. Si fue un error, copiala ahora.')
  descartadas.forEach(([usuario, pass]) => console.log(`  - ${usuario}: ${pass}`))
}

try {
  await guardarLibro(libro)
} catch (err) {
  console.error('\nNo se pudo escribir el Excel. El archivo anterior quedo INTACTO.')
  console.error(explicarFalloDeEscritura(err))
  process.exit(1)
}

const pendientes = perfiles.filter((p) => !yaAnotadas.has(p.empleadoId))
console.log(`\nExcel escrito: ${RUTA_EXCEL}`)
console.log(`${perfiles.length} cuenta(s) en total.`)
if (pendientes.length) {
  console.log(`\n${pendientes.length} sin contrasena anotada (escribelas a mano en el Excel):`)
  pendientes.forEach((p) => console.log(`  - ${p.empleadoId} (${p.rol})`))
}
const sinAcceso = perfiles.filter((p) => !p.tieneAcceso)
if (sinAcceso.length) {
  console.log(`\n${sinAcceso.length} perfil(es) SIN cuenta de acceso (no pueden entrar):`)
  sinAcceso.forEach((p) => console.log(`  - ${p.empleadoId} (${p.rol})`))
}
process.exit(0)
