// Rangos de periodo para el historial (dia/semana/mes/año), en hora LOCAL de
// la PC (es una vista de consulta, no logica de negocio critica). La semana
// inicia en LUNES. offset navega periodos hacia atras/adelante (0 = actual,
// -1 = anterior, ...).

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
]

function fechaCorta(d) {
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`
}

/** Devuelve { inicio: Date, fin: Date (exclusivo), etiqueta: string }. */
export function rangoDePeriodo(tipo, offset = 0) {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  // TODO EL TIEMPO. Lo pidio Roberto con su papa el 2026-08-25 para el
  // Historial: una orden de compra vive semanas o meses, asi que partirla en
  // dias y semanas obligaba a ir brincando periodos para ver una sola orden
  // completa. Los INDICADORES si conservan sus periodos, que es donde la
  // pregunta si es "cuanto se hizo esta semana".
  //
  // El rango sigue siendo un rango de verdad (no se quita el where) para que
  // la consulta mantenga su orden por fecha y su paginacion: solo se abre de
  // par en par.
  if (tipo === 'todo') {
    return {
      inicio: new Date(2000, 0, 1),
      fin: new Date(hoy.getFullYear() + 50, 0, 1),
      etiqueta: 'todo el tiempo'
    }
  }

  if (tipo === 'dia') {
    const inicio = new Date(hoy)
    inicio.setDate(inicio.getDate() + offset)
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + 1)
    const etiqueta = `${DIAS_SEMANA[inicio.getDay()]} ${fechaCorta(inicio)}`
    return { inicio, fin, etiqueta }
  }

  if (tipo === 'semana') {
    const inicio = new Date(hoy)
    // Lunes de la semana actual: getDay() da 0=domingo..6=sabado.
    const desdeLunes = (inicio.getDay() + 6) % 7
    inicio.setDate(inicio.getDate() - desdeLunes + offset * 7)
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + 7)
    const ultimoDia = new Date(fin)
    ultimoDia.setDate(ultimoDia.getDate() - 1)
    return { inicio, fin, etiqueta: `semana del ${fechaCorta(inicio)} al ${fechaCorta(ultimoDia)}` }
  }

  if (tipo === 'mes') {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1)
    const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1)
    return { inicio, fin, etiqueta: `${MESES[inicio.getMonth()]} ${inicio.getFullYear()}` }
  }

  // año
  const inicio = new Date(hoy.getFullYear() + offset, 0, 1)
  const fin = new Date(inicio.getFullYear() + 1, 0, 1)
  return { inicio, fin, etiqueta: `año ${inicio.getFullYear()}` }
}
