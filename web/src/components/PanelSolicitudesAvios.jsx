// Lo que ve ALVARO (almacen) y el admin: todas las solicitudes de material
// que mandan las maquilas, para atenderlas o rechazarlas con motivo. Desde el
// 2026-08-13 Lindbergh ya no entra aqui: los pedidos de material son de
// almacen (recorte de Roberto).
//
// El punto de esta pantalla: antes esto se pedia de boca y se perdia ("no me
// lo pediste" / "se me olvido"). Aqui queda escrito quien pidio que, cuando, y
// quien lo resolvio.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { soloDeMisMaquilas } from '../utils/mundoDatos'
import {
  ESTADOS_SOLICITUD,
  escucharTodasLasSolicitudes,
  resolverSolicitudAvios,
  ErrorSolicitudAvios
} from '../utils/solicitudesAvios'

export default function PanelSolicitudesAvios() {
  const { authUser, perfil, puedeManejarAvios } = useAuth()
  // Ya viene acotado al mundo propio; sirve para filtrar lo que llega por
  // collectionGroup, que no pasa por el catalogo.
  const maquilas = useMaquilas()
  const [solicitudes, setSolicitudes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(null)
  const [respuestas, setRespuestas] = useState({})
  const [verCerradas, setVerCerradas] = useState(false)

  useEffect(() => {
    const unsub = escucharTodasLasSolicitudes(
      (datos) => {
        setSolicitudes(soloDeMisMaquilas(datos, maquilas))
        setCargando(false)
      },
      (err) => {
        console.error('[SolicitudesAvios] Error:', err)
        setError('No se pudieron cargar las solicitudes: ' + (err.message || err))
        setCargando(false)
      }
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maquilas.length])

  const pendientes = useMemo(() => solicitudes.filter((s) => s.estado === 'pendiente'), [solicitudes])
  const cerradas = useMemo(() => solicitudes.filter((s) => s.estado !== 'pendiente'), [solicitudes])

  const usuario = { uid: authUser?.uid, nombre: perfil?.nombreCompleto || 'Almacen' }

  const fechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
      : '-'

  const onResolver = async (solicitud, estado) => {
    setError('')
    setAviso('')
    setTrabajando(solicitud.id)
    try {
      await resolverSolicitudAvios({
        solicitud,
        estado,
        respuesta: respuestas[solicitud.id] || '',
        usuario
      })
      setAviso(
        estado === 'atendida'
          ? `Marcada como ATENDIDA la solicitud de ${solicitud.maquilaNombre}. Ya la ve del otro lado.`
          : `Rechazada la solicitud de ${solicitud.maquilaNombre}, con el motivo que escribiste.`
      )
      setRespuestas((prev) => ({ ...prev, [solicitud.id]: '' }))
    } catch (err) {
      console.error('[SolicitudesAvios] No se pudo resolver:', err)
      setError(
        err instanceof ErrorSolicitudAvios ? err.message : 'No se pudo guardar: ' + (err.message || err)
      )
    } finally {
      setTrabajando(null)
    }
  }

  const tarjeta = (s, abierta) => (
    <div
      key={s.id}
      style={{
        border: '1px solid',
        borderColor: abierta ? '#f0c98a' : '#d8dee6',
        background: abierta ? '#fffdf7' : '#fff',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 12
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 16 }}>{s.maquilaNombre}</strong>
        <span className="texto-suave" style={{ fontSize: 13 }}>
          pidio el {fechaHora(s.creadoEn)}
        </span>
        {!abierta && (
          <span
            style={{
              fontSize: 12,
              borderRadius: 999,
              padding: '2px 10px',
              background: s.estado === 'atendida' ? '#e8f5ec' : '#fdf1f1',
              color: s.estado === 'atendida' ? '#1a7a3a' : '#a00'
            }}
          >
            {ESTADOS_SOLICITUD[s.estado] || s.estado}
            {s.resueltoPorNombre ? ` · ${s.resueltoPorNombre}` : ''}
          </span>
        )}
      </div>

      <table className="tabla-datos" style={{ fontSize: 13, marginTop: 8 }}>
        <thead>
          <tr>
            <th>Material</th>
            <th>Descripcion</th>
            <th>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {(s.renglones || []).map((r, i) => (
            <tr key={`${r.codigo}-${i}`}>
              <td style={{ fontWeight: 700 }}>{r.codigo}</td>
              <td>{r.descripcion || '-'}</td>
              <td>
                {r.cantidad} {r.unidad}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {s.nota && (
        <p className="texto-suave" style={{ fontSize: 13, margin: '6px 0 0' }}>
          Nota de la maquila: {s.nota}
        </p>
      )}
      {s.respuesta && (
        <p style={{ fontSize: 13, margin: '6px 0 0' }}>
          <strong>Respuesta:</strong> {s.respuesta}
        </p>
      )}

      {/* Solo quien MUEVE el material contesta una solicitud. Cielo y PT
          entran a esta pantalla para dar seguimiento (2026-08-28), y sin
          este candado verian botones que el servidor les va a negar. */}
      {abierta && puedeManejarAvios && (
        <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 10 }}>
          <label className="campo">
            <span>Respuesta para la maquila (obligatoria si la rechazas)</span>
            <input
              type="text"
              maxLength={300}
              placeholder="ej. se manda hoy en la camioneta de la tarde"
              value={respuestas[s.id] || ''}
              onChange={(e) => setRespuestas((prev) => ({ ...prev, [s.id]: e.target.value }))}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn-primario"
              disabled={trabajando === s.id}
              onClick={() => onResolver(s, 'atendida')}
            >
              {trabajando === s.id ? 'Guardando...' : 'Ya se manda (atendida)'}
            </button>
            <button
              className="btn-secundario"
              disabled={trabajando === s.id}
              onClick={() => onResolver(s, 'rechazada')}
            >
              No se puede (rechazar)
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}
      {cargando && <p className="texto-suave">Cargando...</p>}

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Material que piden las maquilas ({pendientes.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Cuando a una maquila le falta plastiflecha, etiquetas o cajas para poder ensamblar, lo
          pide aqui. Queda registrado quien lo pidio y quien lo atendio: ya no se pierde.
        </p>
        {!cargando && pendientes.length === 0 ? (
          <p className="texto-suave">No hay solicitudes pendientes.</p>
        ) : (
          pendientes.map((s) => tarjeta(s, true))
        )}
      </div>

      <div className="tarjeta">
        <h2
          onClick={() => setVerCerradas((v) => !v)}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ display: 'inline-block', width: 22 }}>{verCerradas ? '▾' : '▸'}</span>
          Ya resueltas ({cerradas.length})
        </h2>
        {verCerradas &&
          (cerradas.length === 0 ? (
            <p className="texto-suave">Todavia no hay solicitudes resueltas.</p>
          ) : (
            cerradas.map((s) => tarjeta(s, false))
          ))}
      </div>
    </>
  )
}
