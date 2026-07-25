// Pantalla de login. Cuenta unica de la estacion de prueba.
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ESTACION_EMAIL } from '../constants/estacion'

export default function Login() {
  const { authUser, activo, cargando, iniciarSesion } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  if (!cargando && authUser && activo) {
    return <Navigate to="/" replace />
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setEnviando(true)
    try {
      // La cuenta se identifica con un nombre de usuario simple; internamente
      // Firebase Auth usa un correo interno fijo (ver constants/estacion.js).
      const email = ESTACION_EMAIL[usuario.trim().toLowerCase()] || usuario.trim()
      await iniciarSesion(email, password)
    } catch (err) {
      setError(traducirError(err.code))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="centro-pantalla">
      <form className="tarjeta login-card" onSubmit={onSubmit}>
        <h1 className="login-titulo">RAGNAR</h1>
        <p className="login-sub">Estacion de captura - inicia sesion</p>

        <label className="campo">
          <span>Usuario</span>
          <input
            type="text"
            autoComplete="username"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            required
          />
        </label>

        <label className="campo">
          <span>Contrasena</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="alerta-error">{error}</div>}

        <button className="btn-primario btn-grande" type="submit" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

function traducirError(code) {
  switch (code) {
    case 'auth/invalid-email':
      return 'Usuario invalido.'
    case 'auth/user-disabled':
      return 'Usuario deshabilitado.'
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Usuario o contrasena incorrectos.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento.'
    default:
      return 'No se pudo iniciar sesion. Revisa tu conexion.'
  }
}
