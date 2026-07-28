// Convencion usuario -> correo interno de Firebase Auth (patron RUNA). Los
// usuarios entran con un nombre simple (america, diana, lindbergh,
// estacion...); internamente Firebase Auth usa un correo del dominio interno
// fijo. Cualquier usuario nuevo dado de alta con
// scripts/provisionar_usuarios.mjs sigue esta convencion sin tocar este
// archivo.
export const DOMINIO_INTERNO = 'quini-ragnar.local'

export function emailDeUsuario(usuario) {
  const limpio = String(usuario || '').trim().toLowerCase()
  // Un correo completo se respeta tal cual (para pruebas); si no, se arma el
  // correo interno con la convencion usuario@dominio.
  if (limpio.includes('@')) return limpio
  return `${limpio}@${DOMINIO_INTERNO}`
}
