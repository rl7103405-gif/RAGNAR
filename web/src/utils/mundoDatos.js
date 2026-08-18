// Separa lo REAL de lo de PRUEBA en las pantallas de consulta.
//
// El aislamiento de ESCRITURA lo garantizan las reglas de Firestore (una
// cuenta de prueba no puede tocar nada real). Pero la LECTURA sigue siendo
// abierta para todo el personal interno --y tiene que serlo: Cielo cruza los
// reportes contra Microsip y necesita verlo todo--, asi que sin este filtro
// las capturas ZZTEST y las remisiones de prueba apareceran mezcladas en
// Historial, Indicadores y Reportes, sumando kilos y docenas a los totales
// del periodo. Eso no corrompe un dato, pero hace que la pantalla MIENTA, que
// para quien la lee es lo mismo.
//
// El criterio no es el mismo en las dos colecciones, y no puede serlo:
//   - Las REMISIONES (pdfsGenerados) y las TAREAS llevan el campo esPrueba,
//     que las reglas obligan a escribir bien en los dos sentidos.
//   - Los BULTOS no llevan campo: su marca es el PREFIJO del folio, que es lo
//     que las reglas exigen y lo que permite barrerlos despues.
const PREFIJO_PRUEBA = 'ZZTEST'

/** ¿Este bulto (o su folio) es de prueba? */
export function bultoEsDePrueba(bulto) {
  const folio = typeof bulto === 'string' ? bulto : bulto?.folio || bulto?.id || ''
  return String(folio).toUpperCase().startsWith(PREFIJO_PRUEBA)
}

/**
 * Deja el prefijo en MAYUSCULAS antes de guardar.
 *
 * La regla de Firestore compara `matches('^ZZTEST.*')`, que SI distingue
 * mayusculas. Sin esto, quien teclea "zztest001" pasa la validacion de la
 * pantalla (que es tolerante) y se lleva un permission-denied seco del
 * servidor, sin ninguna pista de por que.
 */
export function normalizarPrefijoPrueba(folio) {
  const texto = String(folio || '')
  return texto.toUpperCase().startsWith(PREFIJO_PRUEBA)
    ? PREFIJO_PRUEBA + texto.slice(PREFIJO_PRUEBA.length)
    : texto
}

/** ¿Este documento marcado (remision, tarea) es de prueba? */
export function documentoEsDePrueba(doc) {
  return doc?.esPrueba === true
}

/**
 * Deja solo los documentos de las maquilas que este usuario puede ver.
 *
 * Hace falta para las vistas que leen con `collectionGroup` (inventario,
 * solicitudes y envios de avios): esas NO pasan por el catalogo de maquilas,
 * asi que traen tambien lo de la maquila ficticia aunque el selector de al
 * lado ya este filtrado. Se les pasa la lista de maquilas del hook, que ya
 * viene acotada al mundo propio.
 */
export function soloDeMisMaquilas(lista, maquilasVisibles) {
  const ids = new Set((maquilasVisibles || []).map((m) => m.id))
  return (lista || []).filter((d) => ids.has(d?.maquilaId))
}

/**
 * Deja solo lo del mundo de quien esta mirando.
 *
 * `esPrueba` es el del USUARIO: una cuenta real ve la operacion sin la basura
 * de las pruebas, y una cuenta de prueba ve solo lo suyo (si viera todo, no
 * podria distinguir lo que acaba de hacer).
 */
export function soloDeMiMundo(lista, esPrueba, esDePrueba) {
  return (lista || []).filter((d) => esDePrueba(d) === !!esPrueba)
}
