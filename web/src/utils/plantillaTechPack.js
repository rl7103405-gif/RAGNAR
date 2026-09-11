// LA PLANTILLA TP-QUINI v1: el formato unico de tech pack.
//
// Roberto, 2026-09-11: "quiero crear un formato para que todos se vean iguales
// y sea mas facil para el sistema calificar... orden, orden, orden". El plan
// completo esta en docs/plan-plantilla-tech-pack-v1.md; este archivo es la
// UNICA fuente de la forma: el generador (generarPlantillaTechPack.js) la
// dibuja y el validador la lee. Cambiar aqui cambia los dos.
//
// Decisiones de Roberto (11-sep): logo en su zona fija A1:B3; los siete
// rubros pesan igual; las listas las mantiene Lety; el formato se exige desde
// ya y los 120 viejos se migran.
//
// Como se leen los datos: por NOMBRE DEFINIDO del libro (TP_CLIENTE apunta a
// '1 PEDIDO'!$B$5), nunca por coordenada suelta ni por resultado de formula.
// Las hojas 2-6 repiten la banda con formulas hacia la hoja 1 solo para que se
// vea; RAGNAR lee siempre la celda original de la hoja 1.

export const PLANTILLA = { id: 'TP-QUINI', version: 1, marca: 'TP-QUINI v1' }

export const HOJAS = {
  pedido: '1 PEDIDO',
  codigos: '2 CODIGOS Y RUTA',
  avios: '3 AVIOS',
  individual: '4 EMPAQUE INDIVIDUAL',
  bolsa: '5 PACKS EN BOLSA',
  caja: '6 CAJA',
  ragnar: '_RAGNAR'
}
export const ORDEN_HOJAS = ['pedido', 'codigos', 'avios', 'individual', 'bolsa', 'caja', 'ragnar']

// Titulo de la banda por hoja (fila 1).
export const TITULOS = {
  pedido: 'TECH PACK · 1 PEDIDO',
  codigos: 'TECH PACK · 2 CODIGOS Y RUTA DE PROCESO',
  avios: 'TECH PACK · 3 AVIOS (cuanto lleva cada pack)',
  individual: 'TECH PACK · 4 EMPAQUE INDIVIDUAL',
  bolsa: 'TECH PACK · 5 PACKS EN BOLSA',
  caja: 'TECH PACK · 6 CAJA'
}

// La banda: filas 1-3 de TODAS las hojas. El logo vive en A1:B3 y en ningun
// otro lado; una imagen anclada dentro de la banda no cuenta como foto.
export const BANDA = { filas: 3, logo: 'A1:B3', columnas: 10 }

// Las listas que Lety mantiene. Son ayuda de captura (desplegables), no
// candado: el validador vuelve a revisar.
export const LISTAS = {
  tejido: ['CIRCULAR', 'RECTILINEO', 'SEAMLESS', 'OTRO'],
  sistemaTalla: ['DAMA', 'CABALLERO', 'UNITALLA', 'NIÑO 0-2', 'NIÑO 2-4', 'NIÑO 4-6', 'NIÑO 7-9', 'NIÑO 8-10', 'NIÑO 10-13', 'JUVENIL'],
  procesos: ['TEJIDO', 'CERRADO', 'VOLTEADO', 'HORMADO', 'PAREADO', 'HABILITADO', 'EMBALAJE', 'BORDADO', 'TENIDO', 'ESTAMPADO', 'PLANCHADO'],
  tallaAvio: ['TODAS', 'DAMA', 'CABALLERO', 'UNITALLA', '0-2', '2-4', '4-6', '7-9', '8-10', '10-13']
}

// Los campos sueltos: nombre definido -> celda de la hoja 1 (o de su hoja).
// `rubro` es el apartado de Lety al que aporta (RUBROS_TECH_PACK).
export const CAMPOS = {
  TP_PLANTILLA: { hoja: 'pedido', celda: 'J1', etiqueta: 'Plantilla', tipo: 'texto', rubro: null, obligatorio: true },
  TP_MODELO: { hoja: 'pedido', celda: 'D2', etiqueta: 'Modelo', tipo: 'texto', rubro: 'pedido', obligatorio: true },
  TP_OC: { hoja: 'pedido', celda: 'G2', etiqueta: 'Orden de compra', tipo: 'texto', rubro: 'pedido', obligatorio: true },
  TP_FECHA: { hoja: 'pedido', celda: 'J2', etiqueta: 'Fecha', tipo: 'fecha', rubro: 'pedido', obligatorio: true },
  TP_CLIENTE: { hoja: 'pedido', celda: 'D3', etiqueta: 'Cliente', tipo: 'texto', rubro: 'pedido', obligatorio: true },
  TP_MARCA: { hoja: 'pedido', celda: 'G3', etiqueta: 'Marca', tipo: 'texto', rubro: 'pedido', obligatorio: true },
  TP_ELABORO: { hoja: 'pedido', celda: 'J3', etiqueta: 'Elaboro', tipo: 'texto', rubro: 'pedido', obligatorio: true },
  TP_PRENDA: { hoja: 'pedido', celda: 'B5', etiqueta: 'Prenda', tipo: 'texto', rubro: 'pedido', obligatorio: true },
  TP_TEJIDO: { hoja: 'pedido', celda: 'D5', etiqueta: 'Tipo de tejido', etiquetaCorta: 'TEJIDO', tipo: 'lista', lista: 'tejido', rubro: 'pedido', obligatorio: true },
  TP_SISTEMA_TALLA: { hoja: 'pedido', celda: 'F5', etiqueta: 'Sistema de talla', etiquetaCorta: 'TALLA', tipo: 'lista', lista: 'sistemaTalla', rubro: 'pedido', obligatorio: true },
  TP_VARIANTE: { hoja: 'pedido', celda: 'H5', etiqueta: 'Variante / color', etiquetaCorta: 'VARIANTE', tipo: 'texto', rubro: 'pedido', obligatorio: false },
  TP_PACK: { hoja: 'pedido', celda: 'B7', etiqueta: 'Pares por pack', tipo: 'entero', min: 1, max: 24, rubro: 'pedido', obligatorio: true },
  TP_PACKS: { hoja: 'pedido', celda: 'D7', etiqueta: 'Packs del pedido', etiquetaCorta: 'PACKS', tipo: 'entero', min: 1, rubro: 'pedido', obligatorio: true },
  TP_PARES: { hoja: 'pedido', celda: 'F7', etiqueta: 'Total de pares', etiquetaCorta: 'PARES', tipo: 'formula', rubro: null, obligatorio: false },
  TP_DOCENAS: { hoja: 'pedido', celda: 'H7', etiqueta: 'Total de docenas', etiquetaCorta: 'DOCENAS', tipo: 'formula', rubro: null, obligatorio: false },
  TP_INDIVIDUAL_TEXTO: { hoja: 'individual', celda: 'A5', etiqueta: 'Como se arma el par', tipo: 'texto', rubro: 'individual', obligatorio: false },
  TP_PACKS_POR_BOLSA: { hoja: 'bolsa', celda: 'B5', etiqueta: 'Packs por bolsa', tipo: 'entero', min: 1, rubro: 'bolsa', obligatorio: true },
  TP_BOLSA_TEXTO: { hoja: 'bolsa', celda: 'A7', etiqueta: 'Como se acomodan en la bolsa', tipo: 'texto', rubro: 'bolsa', obligatorio: false },
  TP_DOCENAS_POR_CAJA: { hoja: 'caja', celda: 'B5', etiqueta: 'Docenas por caja o bulto', tipo: 'entero', min: 1, rubro: 'caja', obligatorio: true },
  TP_CAJA_TEXTO: { hoja: 'caja', celda: 'A7', etiqueta: 'Como se acomoda en la caja', tipo: 'texto', rubro: 'caja', obligatorio: false }
}

// Las tablas: fila de encabezado fija, renglones hacia abajo hasta el primer
// renglon vacio. Cada columna tiene su letra y su tipo. El NOMBRE DEFINIDO de
// cada tabla INCLUYE la fila del encabezado (filaCab): quien la lea salta esa
// primera fila. filasReservadas es el minimo; el generador la agranda si la OT
// trae mas codigos.
export const TABLAS = {
  TP_TABLA_PEDIDO: {
    hoja: 'pedido', titulo: 'CODIGOS DEL PEDIDO (un renglon por codigo)', filaTitulo: 9, filaCab: 10, filasReservadas: 20, rubro: 'pedido',
    columnas: [
      { col: 'A', clave: 'talla', etiqueta: 'TALLA', tipo: 'texto', ancho: 12 },
      { col: 'B', clave: 'ot', etiqueta: 'OT', tipo: 'texto', ancho: 10, obligatorio: true },
      { col: 'C', clave: 'codigo', etiqueta: 'CODIGO INTERNO', tipo: 'texto', ancho: 16, obligatorio: true },
      { col: 'D', clave: 'claveMicrosip', etiqueta: 'CLAVE MICROSIP', tipo: 'texto', ancho: 18, obligatorio: true },
      { col: 'E', clave: 'descripcion', etiqueta: 'DESCRIPCION MICROSIP', tipo: 'texto', ancho: 34, span: 3 },
      { col: 'H', clave: 'upc', etiqueta: 'UPC', tipo: 'texto', ancho: 18, span: 2 },
      { col: 'J', clave: 'docenas', etiqueta: 'DOCENAS', tipo: 'decimal', min: 0, ancho: 11, obligatorio: true }
    ]
  },
  TP_TABLA_CODIGOS: {
    hoja: 'codigos', titulo: 'CODIGOS INTERNOS Y COLORES DEL PRODUCTO', filaTitulo: 5, filaCab: 6, filasReservadas: 20, rubro: 'codigos',
    columnas: [
      { col: 'A', clave: 'codigo', etiqueta: 'CODIGO', tipo: 'texto', ancho: 14, obligatorio: true },
      { col: 'B', clave: 'talla', etiqueta: 'TALLA', tipo: 'texto', ancho: 12 },
      { col: 'C', clave: 'colorCuerpo', etiqueta: 'COLOR / CUERPO', tipo: 'texto', ancho: 30, span: 2, obligatorio: true },
      { col: 'E', clave: 'bordado', etiqueta: 'BORDADO', tipo: 'texto', ancho: 26, span: 2 },
      { col: 'G', clave: 'hilo', etiqueta: 'COLOR DE HILO / LECHUGA', tipo: 'texto', ancho: 26, span: 2 },
      { col: 'I', clave: 'imagen', etiqueta: 'IMAGEN', tipo: 'imagen', ancho: 16, span: 2 }
    ]
  },
  TP_RUTA: {
    hoja: 'codigos', titulo: 'RUTA DE PROCESO', filaTitulo: 28, filaCab: 29, filasReservadas: 1, rubro: 'codigos', horizontal: true,
    columnas: [1, 2, 3, 4, 5, 6, 7].map((n, i) => ({ col: 'ABCDEFG'[i], clave: `proceso${n}`, etiqueta: `PROCESO ${n}`, tipo: 'lista', lista: 'procesos', ancho: 14 }))
  },
  TP_TABLA_AVIOS: {
    hoja: 'avios', titulo: 'AVIOS Y ETIQUETAS (USA = cuantos lleva CADA PACK; ENVIAR se calcula solo)', filaTitulo: 5, filaCab: 6, filasReservadas: 20, rubro: 'avios',
    columnas: [
      { col: 'A', clave: 'clave', etiqueta: 'CLAVE', tipo: 'texto', ancho: 12, obligatorio: true },
      { col: 'B', clave: 'descripcion', etiqueta: 'DESCRIPCION', tipo: 'texto', ancho: 36, span: 3 },
      { col: 'E', clave: 'usa', etiqueta: 'USA POR PACK', tipo: 'decimal', min: 0, ancho: 13, obligatorio: true },
      { col: 'F', clave: 'enviar', etiqueta: 'ENVIAR', tipo: 'formula', ancho: 11 },
      { col: 'G', clave: 'comoSeUsa', etiqueta: 'COMO SE USA', tipo: 'texto', ancho: 30, span: 2 },
      { col: 'I', clave: 'talla', etiqueta: 'TALLA', tipo: 'lista', lista: 'tallaAvio', ancho: 11 },
      { col: 'J', clave: 'imagen', etiqueta: 'IMAGEN', tipo: 'imagen', ancho: 16 }
    ]
  }
}

// Las zonas de foto: una imagen cuenta para la zona si su rectangulo de
// anclaje se cruza con el rango. Las cuatro juntas son el rubro 'fotos'.
export const ZONAS_FOTO = {
  FOTO_REFERENCIA: { hoja: 'pedido', rango: 'A33:J52', etiqueta: 'Foto de referencia del producto', rubro: 'fotos' },
  FOTO_INDIVIDUAL: { hoja: 'individual', rango: 'A8:J40', etiqueta: 'Como se arma el par (fotos y flechas)', rubro: 'individual' },
  FOTO_BOLSA: { hoja: 'bolsa', rango: 'A10:J40', etiqueta: 'Como van los packs en la bolsa', rubro: 'bolsa' },
  FOTO_CAJA: { hoja: 'caja', rango: 'A10:J40', etiqueta: 'Como se acomoda la caja', rubro: 'caja' }
}

// Lo que se guarda en la hoja oculta _RAGNAR (columna A = clave, B = valor).
export const CLAVES_RAGNAR = ['plantilla', 'version', 'generadoEn', 'generadoDesdeOt', 'generadoPorUid', 'generadoPorNombre', 'manifiesto']

const colIdx = (s) => [...s].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0)
const colLetra = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

/** 'A33:J52' -> { c1, f1, c2, f2 } en indices base 1 (columna A = 1). */
export function rangoAIndices(rango) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(rango || '').toUpperCase())
  if (!m) return null
  const col = (s) => [...s].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0)
  return { c1: col(m[1]), f1: Number(m[2]), c2: col(m[3]), f2: Number(m[4]) }
}

/** Referencia absoluta con hoja: ('pedido','B5') -> "'1 PEDIDO'!$B$5". */
export function referencia(hoja, celda) {
  const m = /^([A-Z]+)(\d+)$/.exec(celda)
  return `'${HOJAS[hoja]}'!$${m[1]}$${m[2]}`
}

/** El manifiesto que viaja en _RAGNAR: campo -> a donde apunta. */
export function manifiesto() {
  const campos = Object.fromEntries(Object.entries(CAMPOS).map(([n, c]) => [n, referencia(c.hoja, c.celda)]))
  // Rango minimo (filasReservadas); el generador escribe ademas en
  // `nombres` los rangos reales del libro.
  const tablas = Object.fromEntries(Object.entries(TABLAS).map(([n, t]) => { const ancho = t.columnas.reduce((a, c) => Math.max(a, colIdx(c.col) + (c.span || 1) - 1), 1); return [n, `'${HOJAS[t.hoja]}'!$A$${t.filaCab}:$${colLetra(ancho)}$${t.filaCab + (t.horizontal ? 1 : t.filasReservadas)}`] }))
  const fotos = Object.fromEntries(Object.entries(ZONAS_FOTO).map(([n, z]) => [n, `'${HOJAS[z.hoja]}'!${z.rango}`]))
  return { plantilla: PLANTILLA.id, version: PLANTILLA.version, campos, tablas, fotos }
}

/** Nombre de archivo sugerido: 'TECH PACK CPD32-UN-01711.xlsx'. */
export function nombreDeArchivo(modelo) {
  const limpio = String(modelo || 'NUEVO').toUpperCase().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
  return `TECH PACK ${limpio}.xlsx`
}
