// MI PERFIL: quién eres en RAGNAR, qué alcance tienes y dónde cambiar tu
// contraseña.
//
// Lo pidió Roberto el 19-08 copiando lo que ya existe en captura-mecanicos. El
// cambio de contraseña ya vivía en el engrane del encabezado (AjustesCuenta) y
// ahí SIGUE: esta pestaña no lo duplica, lo señala. Duplicar un formulario que
// cambia credenciales es pedir que uno de los dos se quede sin actualizar.
//
// ⚠️ SIN FOTO todavía: RAGNAR no tiene Firebase Storage montado (ver el
// comentario de PanelMiEquipo.jsx). Va en su propia tanda.
import { useAuth } from '../context/AuthContext'
import { auth } from '../firebase/config'

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
  const { perfil, esInterno, nivelDeVista, puedeCrearTareas, puedeSubirPlanMaestro } = useAuth()

  if (!esInterno) return null

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
          {puedeCrearTareas && <li>Encargar tareas y ver las de todos</li>}
          {puedeSubirPlanMaestro && <li>Subir el plan maestro de produccion</li>}
          <li>Consultar el historial y los indicadores</li>
        </ul>
      </div>

      <p className="texto-suave" style={{ fontSize: 13, marginTop: 14 }}>
        Para cambiar tu contrasena usa el engrane <strong>⚙</strong> de arriba a la derecha. No se
        pone aqui para no tener dos formularios distintos que cambien lo mismo.
      </p>
    </div>
  )
}
