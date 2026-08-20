// MI PERFIL: quién eres en RAGNAR, qué alcance tienes y dónde cambiar tu
// contraseña.
//
// Lo pidió Roberto el 19-08 copiando lo que ya existe en captura-mecanicos. El
// La ve TODO el mundo, incluidos los pesadores: Roberto fue explicito el 19-08
// — "Juan, Angel, todos, todos pueden tener lo de mi perfil". Aqui cada quien
// cambia su contraseña sin tener que descubrir un icono en el encabezado.
//
// El formulario es el MISMO componente que usa el portal de las maquilas
// (CambiarContrasena.jsx), no una copia: dos formularios que cambian
// credenciales es garantizar que un dia se arregle uno y el otro no.
//
// Desde el 2026-08-20 esta es la UNICA via para un interno: el engrane del
// encabezado quedo solo para las maquilas, que no tienen esta pestaña.
//
// ⚠️ SIN FOTO todavía: RAGNAR no tiene Firebase Storage montado (ver el
// comentario de PanelMiEquipo.jsx). Va en su propia tanda.
import { useAuth } from '../context/AuthContext'
import { auth } from '../firebase/config'
import CambiarContrasena from './CambiarContrasena'

// Qué hace cada rol, en las palabras del negocio y no en las del código. Es la
// misma explicación que da el Excel de cuentas.
const QUE_HACE = {
  admin: 'Ves todo y administras las cuentas de los demas.',
  produccion: 'Subes el plan maestro: que ordenes de trabajo cuelgan de cada orden de compra.',
  completo: 'Capturas, embarcas, generas remisiones y encargas tareas a las maquilas.',
  captura: 'Capturas folios en la bascula y generas sus etiquetas.',
  almacen: 'Mandas material a las maquilas y llevas el inventario de avios.',
  consulta: 'Consultas reportes e indicadores, y el catalogo de avios.'
}

const NIVEL = {
  oc: 'Las pantallas te abren en ORDEN DE COMPRA. Puedes bajar a orden de trabajo y a folio cuando quieras.',
  ot: 'Las pantallas te abren en ORDEN DE TRABAJO. Puedes bajar al folio cuando quieras.',
  folio: 'Las pantallas te abren en el FOLIO, que es el detalle mas fino.'
}

export default function PanelMiPerfil() {
  const { perfil, nivelDeVista, puedeCrearTareas, puedeSubirPlanMaestro } = useAuth()

  const usuario = perfil?.empleadoId || auth.currentUser?.email?.split('@')[0] || '-'
  const inicial = String(perfil?.nombreCompleto || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="tarjeta">
      <h2>Mi perfil</h2>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: '#e7effd',
            color: '#1e40af',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 30,
            fontWeight: 700
          }}
        >
          {inicial}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{perfil?.nombreCompleto || '-'}</div>
          <div className="texto-suave" style={{ fontSize: 13 }}>
            Usuario: <strong>{usuario}</strong> · Perfil: <strong>{perfil?.rol || '-'}</strong>
          </div>
        </div>
      </div>

      <p style={{ marginTop: 14, fontSize: 14 }}>{QUE_HACE[perfil?.rol] || ''}</p>

      {/* En que nivel arrancan las pantallas para este perfil. Se explica aqui
          porque si no, quien abre el Historial y lo ve todo cerrado puede
          creer que le falta informacion, cuando lo que pasa es que empieza
          arriba a proposito. */}
      <p className="texto-suave" style={{ fontSize: 13 }}>{NIVEL[nivelDeVista]}</p>

      <div style={{ marginTop: 12, fontSize: 14 }}>
        <strong>Lo que puedes hacer</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {puedeCrearTareas && <li>Encargar tareas a las maquilas y ver las de todos</li>}
          {puedeSubirPlanMaestro && <li>Subir el plan maestro de produccion</li>}
          {/* Un pesador NO ve historial ni indicadores: prometerselo aqui seria
              mandarlo a buscar una pestaña que no tiene. */}
          {perfil?.rol !== 'captura' && <li>Consultar el historial y los indicadores</li>}
          {perfil?.rol === 'captura' && <li>Capturar folios y generar sus etiquetas</li>}
          <li>Cambiar tu contrasena aqui mismo</li>
        </ul>
      </div>

      <div style={{ marginTop: 18, borderTop: '1px solid #e5e7eb', paddingTop: 14 }}>
        <strong style={{ fontSize: 15 }}>Cambiar mi contrasena</strong>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Por seguridad la actual no se puede mostrar (no se guarda legible), pero aqui la puedes
          cambiar.
        </p>
        <div style={{ maxWidth: 420 }}>
          <CambiarContrasena />
        </div>
      </div>
    </div>
  )
}
