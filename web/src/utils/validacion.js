// Normalizacion y validacion de folio/peso - replica app/validation.py del
// backend Python original para no cambiar de comportamiento al migrar.
const PATRON_FOLIO = /^[A-Za-z0-9._-]+$/
export const PESO_MAX_GRAMOS = 100000 // 100 kg

export function normalizarFolio(valor) {
  const folio = String(valor ?? '').trim()
  if (!folio) throw new Error('Folio vacio')
  if (folio.length > 50 || !PATRON_FOLIO.test(folio)) {
    throw new Error(
      'Folio invalido: usa solo letras, numeros, punto, guion o guion bajo (maximo 50 caracteres)'
    )
  }
  return folio
}

// Si el folio es totalmente numerico, se le quitan los ceros a la izquierda
// (el Excel de ruteo trae folios como enteros, pero el escaner puede mandar
// con ceros). Folios alfanumericos se conservan tal cual.
// Nota: NO se usa Number/parseInt para esto -- un folio numerico de 18+
// digitos pierde precision con la representacion de punto flotante de JS
// (a diferencia del entero arbitrario de Python, str(int(folio))). Se
// recortan los ceros a la izquierda con texto puro.
export function canonizarFolio(valor) {
  const folio = String(valor ?? '').trim()
  if (/^\d+$/.test(folio)) return folio.replace(/^0+(?=\d)/, '')
  return folio
}

export function validarPesoGramos(peso, pesoMaximoGramos = PESO_MAX_GRAMOS) {
  const numero = Number(peso)
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error('Peso invalido')
  }
  if (numero > pesoMaximoGramos) {
    throw new Error(
      `Peso de ${(numero / 1000).toFixed(2)} kg fuera de rango (maximo ${(pesoMaximoGramos / 1000).toFixed(0)} kg). Revisa la bascula.`
    )
  }
  return numero
}
