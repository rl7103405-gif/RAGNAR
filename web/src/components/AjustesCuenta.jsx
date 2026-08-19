// Engranaje de ajustes de la cuenta: muestra quien esta conectado (nombre y
// usuario) y permite CAMBIAR la contrasena.
//
// El formulario en si vive en CambiarContrasena.jsx, compartido con la pestaña
// "Mi perfil": dos copias de un formulario que cambia credenciales es
// garantizar que un dia se arregle una y la otra se quede con el fallo.
import { useState } from 'react'
import { auth } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import CambiarContrasena from './CambiarContrasena'

export default function AjustesCuenta() {
  const { perfil } = useAuth()
  const [abierto, setAbierto] = useState(false)

  const usuario = perfil?.empleadoId || auth.currentUser?.email?.split('@')[0] || '-'

  return (
    <>
      <button
        className="btn-secundario"
        onClick={() => setAbierto(true)}
        title="Ajustes de la cuenta"
        aria-label="Ajustes de la cuenta"
      >
        ⚙
      </button>

      {abierto && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60
          }}
        >
          <div className="tarjeta" style={{ width: 'min(420px, 92vw)' }}>
            <h2>Mi cuenta</h2>
            <p style={{ marginTop: 6 }}>
              <strong>Nombre:</strong> {perfil?.nombreCompleto || '-'}
              <br />
              <strong>Usuario:</strong> {usuario}
            </p>
            <p style={{ fontSize: 13, color: '#777' }}>
              Por seguridad la contrasena actual no se puede mostrar (no se guarda legible);
              aqui puedes cambiarla.
            </p>

            <CambiarContrasena onListo={() => setAbierto(false)} />
          </div>
        </div>
      )}
    </>
  )
}
