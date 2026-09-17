// EL NÚCLEO DE UN TECH PACK: lo que se puede calcular sin Firebase.
//
// Vive aparte de techPacks.js (que importa `db`) para que el avance y sus
// pruebas corran también en Node, con la biblioteca real (16-sep). Mismo
// motivo por el que existe planMaestroNucleo.js.
import { normalizarCodigo } from './planMaestroNucleo.js'

// LOS DATOS QUE SE EDITAN A MANO, y su version de checklist.
export const CHECKLIST_VERSION = '2026-09-v1'

/** El codigo como id de documento: normalizado y sin caracteres que Firestore
 *  no admite en un id ('/' y los que empiezan con '__'). */
export function codigoComoId(codigo) {
  const limpio = normalizarCodigo(codigo)
  if (!limpio) return ''
  if (limpio.includes('/') || limpio.startsWith('__') || limpio.length > 60) return ''
  if (limpio === '.' || limpio === '..') return ''
  return limpio
}

/**
 * Lo que se muestra de un tech pack: MANDA lo que tecleó Lety
 * (`datosEditables`) sobre lo que dijo el catálogo, que queda congelado.
 */
export function datosDelTechPack(b) {
  const e = b?.datosEditables || {}
  return {
    modelo: e.modelo ?? b?.modelo ?? '',
    talla: e.talla ?? b?.talla ?? '',
    color: e.color ?? b?.color ?? '',
    notas: e.notas ?? '',
    checklist: e.checklist || null,
    checklistVersion: e.checklistVersion || '',
    codigos: Array.isArray(e.codigos) ? e.codigos : []
  }
}
