// LOS PEDAZOS (chunks) DE UN ARCHIVO DE LA BIBLIOTECA (funcion pura, sin Firebase).
//
// Antes cada subida escribia 'tp-00', 'tp-01'... y dos personas subiendo al
// mismo codigo casi a la vez se pisaban los pedazos: ganaba un manifiesto y
// quedaban los pedazos del otro, y el archivo no se podia bajar hasta que
// alguien lo volviera a subir (code-reviewer, 15-sep; Roberto: "hay que
// evitar esos riesgos").
//
// Desde el 15-sep cada subida escribe con la HUELLA del archivo en el id
// ('tp-<16 hex>-00'): una subida nunca toca los pedazos de otra. Los archivos
// que ya estaban siguen con el id viejo y se leen igual.

const pad2 = (n) => String(n).padStart(2, '0')

export const prefijoPedazos = (tipo, sha256) => `${tipo}-${String(sha256 || '').slice(0, 16)}-`
export const idPedazo = (tipo, sha256, i) => prefijoPedazos(tipo, sha256) + pad2(i)
export const idPedazoViejo = (tipo, i) => `${tipo}-${pad2(i)}`

/**
 * Los ids de los pedazos de un manifiesto: los de su huella si estan todos;
 * si no, los viejos si estan todos. `completo:false` si no esta ninguno de
 * los dos juegos (la descarga lo dice; la huella se valida despues igual).
 * @param {Set<string>} existentes ids que hay en la subcoleccion
 */
export function idsDePedazos(existentes, tipo, manifiesto) {
  const n = Number(manifiesto?.totalChunks) || 0
  const nuevos = Array.from({ length: n }, (_, i) => idPedazo(tipo, manifiesto?.sha256, i))
  if (n && nuevos.every((x) => existentes.has(x))) return { ids: nuevos, completo: true }
  const viejos = Array.from({ length: n }, (_, i) => idPedazoViejo(tipo, i))
  if (n && viejos.every((x) => existentes.has(x))) return { ids: viejos, completo: true }
  return { ids: viejos.some((x) => existentes.has(x)) ? viejos : nuevos, completo: false }
}

/**
 * Los pedazos de ese tipo que ya no son del manifiesto vigente. Si el vigente
 * no esta completo no se propone borrar nada (podria estarse reponiendo).
 * Sin manifiesto (archivo quitado), sobran todos los de ese tipo.
 */
export function idsSobrantes(existentes, tipo, manifiesto) {
  let quedan = new Set()
  if (manifiesto?.totalChunks) {
    const { ids, completo } = idsDePedazos(existentes, tipo, manifiesto)
    if (!completo) return []
    quedan = new Set(ids)
  }
  return [...existentes].filter((x) => x.startsWith(tipo + '-') && !quedan.has(x))
}
