import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// VERSION DE LA APP (Roberto 2026-08-28: "que tambien venga la ultima version
// para corroborar... que los dos estemos en la version correcta y corroborar
// que hayas hecho el push de manera correcta").
//
// Se calcula SOLA en cada build, a proposito: una version escrita a mano en
// package.json se olvida de subir justo el dia que importa, y entonces miente
// — que es peor que no tenerla. La fecha del build es la que de verdad
// responde "esto que estoy viendo, ¿es lo nuevo o lo de ayer?", y el commit
// deja comprobar contra el repo que lo desplegado es lo que se escribio.
function versionDelBuild() {
  const ahora = new Date()
  const dosDigitos = (n) => String(n).padStart(2, '0')
  const fecha =
    `${dosDigitos(ahora.getDate())}/${dosDigitos(ahora.getMonth() + 1)}/${ahora.getFullYear()}` +
    ` ${dosDigitos(ahora.getHours())}:${dosDigitos(ahora.getMinutes())}`
  let commit = ''
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // Sin git (o build fuera del repo): la fecha sola ya sirve.
  }
  return { fecha, commit }
}

const VERSION = versionDelBuild()

export default defineConfig({
  // Se inyectan como literales en el bundle. No son variables de entorno: no
  // hay nada secreto aqui, es solo la etiqueta de la version.
  define: {
    __VERSION_FECHA__: JSON.stringify(VERSION.fecha),
    __VERSION_COMMIT__: JSON.stringify(VERSION.commit)
  },
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  }
})
