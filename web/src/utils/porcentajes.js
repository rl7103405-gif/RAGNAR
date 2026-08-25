// EL PORCENTAJE HONESTO: nunca dice "100%" si no es 100, ni "0%" si hay algo.
//
// Lo pidio Roberto el 25-08 viendo una orden al 99.x% pintada como "100%":
// "hay algunas que nada mas les falta un folio de mandar; esas evidentemente
// no quiero que las redondees". El redondeo normal convierte 99.6 en 100, y
// un "100%" con un folio pendiente hace que nadie lo busque. Lo mismo al
// reves: 0.4% redondeado a "0%" dice que no se ha hecho nada cuando si hay.
//
// La regla: los extremos solo se muestran cuando son EXACTOS. Cerca de ellos
// se enseña un decimal (99.9%, 0.1%) para que se vea que falta o que ya hay.
export function porcentajeHonesto(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (v >= 100) return '100%'
  if (v <= 0) return '0%'
  // Pegado al 100 por abajo: piso a un decimal, topado en 99.9 para que
  // 99.97 no se vuelva "100.0".
  if (v > 99) return `${Math.min(99.9, Math.floor(v * 10) / 10).toFixed(1)}%`
  // Pegado al 0 por arriba: techo a un decimal, minimo 0.1.
  if (v < 1) return `${Math.max(0.1, Math.ceil(v * 10) / 10).toFixed(1)}%`
  return `${Math.round(v)}%`
}
