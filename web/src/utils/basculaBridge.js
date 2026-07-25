// Llama al bridge local de la bascula (bridge/bascula_bridge.py, ya probado
// en la version anterior del sistema) que corre en la misma PC. Mismo
// endpoint y misma logica de validacion que app/static/app.js
// (leerPesoBascula) para no cambiar de comportamiento al migrar.
const BASE_URL = import.meta.env.VITE_BASCULA_BRIDGE_URL || 'http://localhost:8001'

export async function leerPesoBascula() {
  const respuesta = await fetch(`${BASE_URL}/peso`)
  if (!respuesta.ok) throw new Error('No se pudo leer la bascula')
  return respuesta.json()
}

// Traduce la lectura cruda del bridge al mismo criterio de "es utilizable"
// que usaba validacion.html: error explicito, sin lectura todavia, lectura
// vieja (no vigente) o bascula inestable (aguja moviendose) se rechazan.
export function motivoLecturaInvalida(lectura) {
  if (lectura.error) return lectura.error
  if (lectura.peso === null || lectura.peso === undefined) {
    return 'todavia no hay una lectura de peso. Verifica que el bulto este sobre la bascula.'
  }
  if (lectura.vigente === false) {
    return 'la bascula no ha enviado una lectura reciente. Verifica que este encendida y conectada.'
  }
  if (lectura.estable === false) {
    return 'espera a que la bascula estabilice antes de capturar.'
  }
  return null
}
