// PORTAL DE LA MAQUILA — pestana "Tareas de ensamble": lo que Quini le
// encargo armar, con el TECH PACK del pedido visible SOLO EN PANTALLA.
//
// La maquila aqui NO reporta nada todavia: ve la tarea, consulta el tech
// pack mientras arma, y cuando regresa el producto terminado Quini cierra la
// tarea y el tech pack desaparece (el retorno declarado por OT es la
// siguiente etapa del portal).
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import VisorTechPack from './VisorTechPack'
import {
  ESTADOS_TAREA_ENSAMBLE,
  escucharTareasEnsambleDeMaquila
} from '../utils/tareasEnsamble'

export default function TareasEnsambleMaquila() {
  const { maquilaId } = useAuth()
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')
  const [visor, setVisor] = useState(null)

  useEffect(() => {
    if (!maquilaId) return
    const unsub = escucharTareasEnsambleDeMaquila(maquilaId, setTareas, (err) => {
      console.error('[TareasEnsambleMaquila] Error escuchando:', err)
      setError('No se pudieron cargar tus tareas: ' + (err.message || err))
    })
    return unsub
  }, [maquilaId])

  const abiertas = tareas.filter((t) => t.estado === 'abierta')
  const cerradas = tareas.filter((t) => t.estado !== 'abierta')
  const fechaDe = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '-')

  const tarjeta = (t) => (
    <div
      key={t.id}
      style={{
        border: '1px solid',
        borderColor: t.estado === 'abierta' ? '#d8dee6' : '#e5e7eb',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 10,
        background: '#fff',
        opacity: t.estado === 'abierta' ? 1 : 0.7
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 15 }}>{t.titulo}</strong>
        <span className="texto-suave" style={{ fontSize: 13 }}>
          {ESTADOS_TAREA_ENSAMBLE[t.estado] || t.estado} · encargada el {fechaDe(t.creadoEn)}
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 14 }}>
        {(t.renglones || []).map((r) => (
          <div key={r.codigo}>
            <strong>{r.codigo}</strong> · {r.cantidad} {r.unidad}
            {r.descripcion ? ` · ${r.descripcion}` : ''}
          </div>
        ))}
      </div>
      {t.notas && <p className="texto-suave" style={{ fontSize: 13, margin: '6px 0 0' }}>{t.notas}</p>}
      <div style={{ marginTop: 10 }}>
        {t.estado === 'abierta' && t.techPack && (
          <button
            className="btn-primario"
            onClick={() => setVisor({ maquilaId, tareaId: t.id, techPack: t.techPack })}
          >
            Ver tech pack
          </button>
        )}
        {t.estado === 'abierta' && !t.techPack && (
          <span className="texto-suave" style={{ fontSize: 13 }}>
            Esta tarea no trae tech pack adjunto.
          </span>
        )}
        {t.estado !== 'abierta' && (
          <span className="texto-suave" style={{ fontSize: 13 }}>
            Tarea {t.estado === 'terminada' ? 'terminada' : 'cancelada'}: el tech pack ya no esta
            disponible.
          </span>
        )}
      </div>
    </div>
  )

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="tarjeta">
        <h2>Tareas de ensamble ({abiertas.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Lo que Quini te encargo armar. El tech pack se consulta <strong>aqui en pantalla</strong>{' '}
          mientras la tarea esta abierta; al terminar la tarea deja de estar disponible.
        </p>
        {abiertas.length === 0 ? (
          <p className="texto-suave">No tienes tareas de ensamble abiertas.</p>
        ) : (
          abiertas.map(tarjeta)
        )}
      </div>
      {cerradas.length > 0 && (
        <div className="tarjeta" style={{ marginTop: 18 }}>
          <h2>Terminadas ({cerradas.length})</h2>
          {cerradas.map(tarjeta)}
        </div>
      )}
      {visor && <VisorTechPack {...visor} onCerrar={() => setVisor(null)} />}
    </>
  )
}
