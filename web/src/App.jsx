import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Estacion from './pages/Estacion'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Todo vive en una sola pantalla con pestanas (Captura, Folios del
              dia, Historial, Indicadores, Maquilas), igual que
              captura-mecanicos: las rutas viejas /historial y /maquilas
              caen aqui por el comodin de abajo. */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Estacion />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
