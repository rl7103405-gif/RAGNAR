// Utilidades compartidas entre la web y los scripts Node (cargar_catalogo.mjs)
// para ubicar un codigo de producto dentro del catalogo sharded de Firestore.
// El catalogo (38 mil codigos) se guarda repartido en NUM_SHARDS_CATALOGO
// documentos por version (catalogoVersiones/{version}/shards/{n}); quien
// escribe y quien lee DEBEN usar exactamente estas mismas funciones para caer
// en el mismo shard y la misma clave.
export const NUM_SHARDS_CATALOGO = 64

// FNV-1a de 32 bits: hash estable y bien disperso (el hash "h*31" clasico
// distribuia hasta 10x mas codigos en unos shards que en otros con el
// catalogo real).
export function fnv1a(texto) {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function shardDeCodigo(codigo) {
  return String(fnv1a(codigo) % NUM_SHARDS_CATALOGO)
}

// Los codigos reales traen caracteres que son problematicos como nombre de
// campo de Firestore ('.809', '6171-.B': el punto se interpreta como
// separador de ruta en updates/FieldPath, y los nombres __x__ estan
// reservados). Se escapa todo lo que no sea [A-Za-z0-9-] como %XXXXXX (hex
// fijo de 6 digitos, para que el mapeo sea inyectivo sin necesidad de
// decodificar nunca).
export function claveDeCodigo(codigo) {
  let clave = ''
  for (const ch of String(codigo)) {
    if (/[A-Za-z0-9-]/.test(ch)) {
      clave += ch
    } else {
      clave += '%' + ch.codePointAt(0).toString(16).toUpperCase().padStart(6, '0')
    }
  }
  return clave
}
