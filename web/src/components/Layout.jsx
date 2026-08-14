// Marco comun: barra superior con titulo, usuario, ajustes y salir. Mismo
// patron que el Layout de captura-mecanicos para que las dos apps se sientan
// iguales.
import { useAuth } from '../context/AuthContext'
import AjustesCuenta from './AjustesCuenta'

export default function Layout({ titulo, children }) {
  const { perfil, cerrarSesion, esPrueba } = useAuth()

  return (
    <div className="layout">
      {/* Franja permanente en las cuentas de prueba. Se entra y se sale de
          ellas varias veces al dia para probar cada perfil, y lo peor que
          puede pasar es creer que se esta en la cuenta de siempre: por eso
          va arriba de todo, no como un detalle en una esquina. */}
      {esPrueba && (
        <div
          style={{
            background: '#d97706',
            color: '#fff',
            padding: '6px 12px',
            fontWeight: 700,
            fontSize: 13,
            textAlign: 'center',
            letterSpacing: 0.3
          }}
        >
          CUENTA DE PRUEBA — folios ZZTEST y maquila de pruebas. Nada de esto es operacion real.
        </div>
      )}
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
