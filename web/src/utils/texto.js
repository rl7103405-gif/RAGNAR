// Busqueda por texto en tablas ya cargadas (sin ir a Firestore): insensible a
// mayusculas y a acentos, coincidencia parcial. Compartido por Historial y
// Reportes para que ambos busquen con el MISMO criterio.

export function normalizar(valor) {
  return String(valor ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function coincide(valor, consulta) {
  return normalizar(valor).includes(normalizar(consulta))
}

/** Fecha local (no UTC) en 'AAAA-MM-DD', para los inputs type="date": con
 *  toISOString se brincaria un dia segun la zona horaria. */
export function fechaLocalISO(fecha) {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Comparador ascendente que entiende numeros dentro del texto: '744' < '7887'
 *  y 'F-9' < 'F-10' (localeCompare numerico). Para ordenar folios y OTs. */
export function compararAscendente(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true })
}
