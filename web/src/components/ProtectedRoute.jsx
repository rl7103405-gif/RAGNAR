import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { authUser, activo, cargando } = useAuth()

  if (cargando) return <div className="centro-pantalla">Cargando...</div>
  if (!authUser) return <Navigate to="/login" replace />
  if (!activo) {
    return (
      <div className="centro-pantalla">
        <div className="tarjeta">
          Esta cuenta no tiene un perfil activo. Avisa a Roberto.
        </div>
      </div>
    )
  }
  return children
}
