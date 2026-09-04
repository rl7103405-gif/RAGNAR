// Cuando se despliega una version nueva, los pedazos con nombre viejo (el lector
// de Excel, pdfjs) dejan de existir y el rewrite del hosting contesta HTML: el
// import dinamico truena con "Expected a JavaScript module... text/html". Vite
// avisa con este evento; la salida correcta es recargar UNA vez (el guard evita
// el bucle si el fallo fuera otro). Pasó el 04-09-2026 con Roberto y Lety.
window.addEventListener('vite:preloadError', (evento) => {
  const marca = 'ragnar:recarga-por-version'
  if (sessionStorage.getItem(marca)) return
  sessionStorage.setItem(marca, String(Date.now()))
  evento.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => sessionStorage.removeItem('ragnar:recarga-por-version'))

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
