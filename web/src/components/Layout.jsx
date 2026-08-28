// Marco comun: barra superior con titulo, usuario y salir. Mismo patron que el
// Layout de captura-mecanicos para que las dos apps se sientan iguales.
//
// ⚠️ EL ENGRANE SOLO LO VEN LAS MAQUILAS. Los internos lo perdieron el
// 2026-08-20, cuando "Mi perfil" ya traia el mismo formulario de contraseña
// dentro y el icono se volvio un duplicado (Roberto: "quitalo porque ya lo
// tenemos en las pestañas").
//
// Para las maquilas SIGUE, y no es un olvido: sus cuatro pestañas son recibir,
// ensamble, material y pedir — NINGUNA es "Mi perfil". Quitarselo a ellas
// tambien las dejaria sin ninguna forma de cambiar su contraseña.
import { useAuth } from '../context/AuthContext'
import Novedades from './Novedades'
import AjustesCuenta from './AjustesCuenta'

export default function Layout({ titulo, children }) {
  const { perfil, cerrarSesion, esPrueba, esInterno } = useAuth()

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
          {/* La campana va ANTES de Salir: es lo que se mira al entrar, no al
              irse. Se le muestra a todos, incluidas las maquilas: tambien les
              cambia la pantalla y tambien tienen derecho a saber que cambio. */}
          <Novedades />
          {!esInterno && <AjustesCuenta />}
          <button className="btn-salir" onClick={cerrarSesion}>
            Salir
          </button>
        </div>
      </header>
      <main className="contenido">{children}</main>
    </div>
  )
}
