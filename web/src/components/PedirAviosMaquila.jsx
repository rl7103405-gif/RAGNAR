// Lo que usa la MAQUILA para pedir el material que le falta (plastiflecha,
// etiquetas, cajas, cinta). Le llega directo a Alvaro.
//
// Elige del catalogo de avios en vez de escribir texto libre: si escribiera
// "plastiflechas" a mano, Alvaro no sabria cual de los ~6 tipos es.
import { useMemo, useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAvios } from './Avios'
import SelectorAvio from './SelectorAvio'
import {
  ESTADOS_SOLICITUD,
  cancelarSolicitudAvios,
  escucharSolicitudesDeMaquila,
  pedirAvios,
  ErrorSolicitudAvios
} from '../utils/solicitudesAvios'

export default function PedirAviosMaquila() {
  const { authUser, perfil } = useAuth()
  const maquilaId = perfil?.maquilaId || ''
  const nombreMaquila = perfil?.nombreCompleto || ''
  const avios = useAvios()
  const activos = useMemo(() => avios.filter((a) => a.activo !== false), [avios])

  const [renglones, setRenglones] = useState([{ codigo: '', cantidad: '' }])
  const [nota, setNota] = useState('')
  const [mias, setMias] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!maquilaId) return
    const unsub = escucharSolicitudesDeMaquila(
      maquilaId,
      setMias,
      (err) => console.error('[PedirAvios] Error leyendo mis solicitudes:', err)
    )
    return unsub
  }, [maquilaId])

  const cambiar = (i, campo, valor) =>
    setRenglones((prev) => prev.map((r, j) => (i === j ? { ...r, [campo]: valor } : r)))

  const quitar = (i) => setRenglones((prev) => prev.filter((_, j) => j !== i))

  const onPedir = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    const conDatos = renglones
      .filter((r) => r.codigo && String(r.cantidad).trim())
      .map((r) => {
        const avio = activos.find((a) => a.codigo === r.codigo)
        return {
          codigo: r.codigo,
          descripcion: avio?.descripcion || '',
          cantidad: Number(r.cantidad),
          unidad: avio?.unidad || 'piezas'
        }
      })
    if (conDatos.length === 0) {
      setError('Elige al menos un material y pon cuanto necesitas.')
      return
    }
    setGuardando(true)
    try {
      await pedirAvios({
        maquilaId,
        maquilaNombre: nombreMaquila,
        renglones: conDatos,
        nota,
        usuario: { uid: authUser.uid, nombre: nombreMaquila }
      })
      setRenglones([{ codigo: '', cantidad: '' }])
      setNota('')
      setAviso('Listo: tu solicitud ya le llego a Quini. Aqui abajo puedes ver como va.')
    } catch (err) {
      console.error('[PedirAvios] No se pudo pedir:', err)
      setError(
        err instanceof ErrorSolicitudAvios ? err.message : 'No se pudo enviar: ' + (err.message || err)
      )
    } finally {
      setGuardando(false)
    }
  }

  const onCancelar = async (s) => {
    if (!window.confirm(`¿Cancelar la solicitud del ${fechaHora(s.creadoEn)}?`)) return
    setError('')
    try {
      await cancelarSolicitudAvios(s)
      setAviso('Solicitud cancelada.')
    } catch (err) {
      setError('No se pudo cancelar: ' + (err.message || err))
    }
  }

  const fechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
      : '-'

  const colorEstado = (estado) =>
    estado === 'atendida'
      ? { bg: '#e8f5ec', fg: '#1a7a3a' }
      : estado === 'pendiente'
        ? { bg: '#fff4e0', fg: '#8a5300' }
        : { bg: '#f3f4f6', fg: '#556' }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}

      <form className="tarjeta" onSubmit={onPedir} style={{ marginBottom: 18 }}>
        <h2>Pedir material que te falta</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Si te falta plastiflecha, etiquetas, cajas o cinta para poder ensamblar, pidelo aqui.
          Le llega directo a almacen y queda registrado: ya no se pierde el recado.
        </p>

        {activos.length === 0 ? (
          <p className="texto-suave">
            Todavia no hay materiales dados de alta en el catalogo. Avisale a Quini.
          </p>
        ) : (
          <>
            {renglones.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 6 }}>
                <label className="campo" style={{ flex: '2 1 260px' }}>
                  <span>Material</span>
                  {/* Mismo buscador que usa almacen: la maquila tiene el
                      mismo problema de lista larga. */}
                  <SelectorAvio
                    avios={activos}
                    valor={r.codigo}
                    onElegir={(codigo) => cambiar(i, 'codigo', codigo)}
                  />
                </label>
                <label className="campo" style={{ flex: '0 1 150px' }}>
                  <span>
                    Cuanto necesitas
                    {r.codigo && (
                      <> ({activos.find((a) => a.codigo === r.codigo)?.unidad || 'piezas'})</>
                    )}
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="ej. 500"
                    value={r.cantidad}
                    onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
                  />
                </label>
                {renglones.length > 1 && (
                  <button type="button" className="btn-secundario" onClick={() => quitar(i)}>
                    Quitar
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-secundario"
              style={{ marginBottom: 10 }}
              onClick={() => setRenglones((prev) => [...prev, { codigo: '', cantidad: '' }])}
            >
              + Agregar otro material
            </button>

            <label className="campo">
              <span>Nota (opcional): para que es, para cuando lo necesitas...</span>
              <input
                type="text"
                maxLength={300}
                placeholder="ej. es para la OT 7887, se me acabaron hoy"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            </label>

            <button className="btn-primario" type="submit" disabled={guardando}>
              {guardando ? 'Enviando...' : 'Pedir a Quini'}
            </button>
          </>
        )}
      </form>

      <div className="tarjeta">
        <h2>Lo que has pedido ({mias.length})</h2>
        {mias.length === 0 ? (
          <p className="texto-suave">Todavia no has pedido material.</p>
        ) : (
          mias.map((s) => {
            const c = colorEstado(s.estado)
            return (
              <div
                key={s.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 8
                }}
              >
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span className="texto-suave" style={{ fontSize: 13 }}>
                    {fechaHora(s.creadoEn)}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      borderRadius: 999,
                      padding: '2px 10px',
                      background: c.bg,
                      color: c.fg
                    }}
                  >
                    {ESTADOS_SOLICITUD[s.estado] || s.estado}
                  </span>
                  {s.estado === 'pendiente' && (
                    <button className="btn-secundario" onClick={() => onCancelar(s)}>
                      Cancelar
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {(s.renglones || [])
                    .map((r) => `${r.codigo} × ${r.cantidad} ${r.unidad}`)
                    .join(' · ')}
                </div>
                {s.nota && (
                  <p className="texto-suave" style={{ fontSize: 12, margin: '4px 0 0' }}>
                    Tu nota: {s.nota}
                  </p>
                )}
                {s.respuesta && (
                  <p style={{ fontSize: 13, margin: '4px 0 0' }}>
                    <strong>Quini contesto:</strong> {s.respuesta}
                    {s.resueltoPorNombre ? ` (${s.resueltoPorNombre})` : ''}
                  </p>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
