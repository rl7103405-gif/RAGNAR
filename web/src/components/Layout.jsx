// Marco comun: barra superior con titulo, usuario, ajustes y salir. Mismo
// patron que el Layout de captura-mecanicos para que las dos apps se sientan
// iguales.
import { useAuth } from '../context/AuthContext'
import AjustesCuenta from './AjustesCuenta'

export default function Layout({ titulo, children }) {
  const { perfil, cerrarSesion } = useAuth()

  return (
    <div className="layout">
      <header className="barra-superior">
        <div className="barra-titulo">{titulo}</div>
        <div className="barra-usuario">
          <span className="usuario-nombre">
            {perfil?.nombreCompleto || 'Estacion'}
            <span className="usuario-rol">Embarques</span>
          </span>
          <AjustesCuenta />
          <button className="btn-salir" onClick={cerrarSesion}>
            Salir
          </button>
        </div>
      </header>
      <main className="contenido">{children}</main>
    </div>
  )
}
