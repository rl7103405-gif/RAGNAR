// Lo que usa ALVARO para mandarle material a una maquila, y para ver que
// confirmo cada una.
//
// Si el envio atiende una solicitud de la maquila, se liga: asi queda claro
// que lo que pidio ya se mando (y por que, si se mando distinto).
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { soloDeMisMaquilas } from '../utils/mundoDatos'
import { useAvios } from './Avios'
import SelectorAvio from './SelectorAvio'
import {
  enviarAvios,
  escucharTodosLosEnvios,
  escucharTodosLosAcuses,
  ErrorEnvioAvios
} from '../utils/enviosAvios'

export default function PanelEnviarAvios() {
  const { authUser, perfil, esPrueba } = useAuth()
  const maquilas = useMaquilas()
  // Simetrico: cada mundo ve solo sus maquilas (las reglas exigen lo mismo;
  // aqui es para que nadie la elija por error y choque con permission-denied).
  const activas = useMemo(
    () => maquilas.filter((m) => m.activo && (m.esPrueba === true) === esPrueba),
    [maquilas, esPrueba]
  )
  const avios = useAvios()
  const aviosActivos = useMemo(() => avios.filter((a) => a.activo !== false), [avios])

  const [maquilaId, setMaquilaId] = useState('')
  const [renglones, setRenglones] = useState([{ codigo: '', cantidad: '' }])
  const [nota, setNota] = useState('')
  const [envios, setEnvios] = useState([])
  const [acuses, setAcuses] = useState({})
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)

  useEffect(() => {
    const unsubEnvios = escucharTodosLosEnvios((datos) => setEnvios(soloDeMisMaquilas(datos, maquilas)), (err) => {
      console.error('[EnviarAvios] Error leyendo envios:', err)
      setError('No se pudieron cargar los envios: ' + (err.message || err))
    })
    const unsubAcuses = escucharTodosLosAcuses(setAcuses, (err) =>
      console.error('[EnviarAvios] Error leyendo acuses:', err)
    )
    return () => {
      unsubEnvios()
      unsubAcuses()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maquilas.length])

  const usuario = { uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' }

  const cambiar = (i, campo, valor) =>
    setRenglones((prev) => prev.map((r, j) => (i === j ? { ...r, [campo]: valor } : r)))

  const onEnviar = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    const maquila = activas.find((m) => m.id === maquilaId)
    if (!maquila) return setError('Elige la maquila a la que le vas a mandar.')

    const conDatos = renglones
      .filter((r) => r.codigo && String(r.cantidad).trim())
      .map((r) => {
        const avio = aviosActivos.find((a) => a.codigo === r.codigo)
        return {
          codigo: r.codigo,
          descripcion: avio?.descripcion || '',
          cantidad: Number(r.cantidad),
          unidad: avio?.unidad || 'piezas'
        }
      })

    setEnviando(true)
    try {
      await enviarAvios({
        maquilaId: maquila.id,
        maquilaNombre: maquila.nombre,
        renglones: conDatos,
        nota,
        usuario
      })
      setRenglones([{ codigo: '', cantidad: '' }])
      setNota('')
      setAviso(
        `Envio registrado para ${maquila.nombre}. Ya lo ve en su portal y tiene que confirmar ` +
          'cuanto le llego de cada cosa.'
      )
    } catch (err) {
      console.error('[EnviarAvios] No se pudo enviar:', err)
      setError(err instanceof ErrorEnvioAvios ? err.message : 'No se pudo registrar: ' + (err.message || err))
    } finally {
      setEnviando(false)
    }
  }

  const fechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
      : '-'

  const sinConfirmar = envios.filter((e) => !acuses[`${e.maquilaId}__${e.id}`])
  const confirmados = envios.filter((e) => acuses[`${e.maquilaId}__${e.id}`])

  const tarjetaEnvio = (envio) => {
    const acuse = acuses[`${envio.maquilaId}__${envio.id}`]
    const conDiferencias = acuse?.resultado === 'con_diferencias'
    return (
      <div
        key={`${envio.maquilaId}__${envio.id}`}
        style={{
          border: '1px solid',
          borderColor: conDiferencias ? '#e2c9c9' : '#d8dee6',
          background: conDiferencias ? '#fdf6f6' : '#fff',
          borderRadius: 8,
          padding: '10px 12px',
          marginBottom: 10
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <strong>{envio.maquilaNombre}</strong>
          <span className="texto-suave" style={{ fontSize: 13 }}>
            {fechaHora(envio.creadoEn)} · {(envio.renglones || []).length} material(es) ·{' '}
            {envio.enviadoPorNombre}
          </span>
          {acuse ? (
            <span
              style={{
                fontSize: 12,
                borderRadius: 999,
                padding: '2px 10px',
                background: conDiferencias ? '#fdf1f1' : '#e8f5ec',
                color: conDiferencias ? '#a00' : '#1a7a3a'
              }}
            >
              {conDiferencias ? 'Recibido CON DIFERENCIAS' : 'Recibido completo'} ·{' '}
              {fechaHora(acuse.creadoEn)}
            </span>
          ) : (
            <span
              style={{
                fontSize: 12,
                borderRadius: 999,
                padding: '2px 10px',
                background: '#fff4e0',
                color: '#8a5300'
              }}
            >
              Sin confirmar
            </span>
          )}
        </div>

        <table className="tabla-datos" style={{ fontSize: 13, marginTop: 6 }}>
          <thead>
            <tr>
              <th>Material</th>
              <th>Se mando</th>
              {acuse && <th>Llego</th>}
            </tr>
          </thead>
          <tbody>
            {(envio.renglones || []).map((r, i) => {
              const llego = acuse?.recibido?.[i]?.cantidad
              const difiere = acuse && Number(llego) !== Number(r.cantidad)
              return (
                <tr key={`${r.codigo}-${i}`} style={difiere ? { background: '#fdf1f1' } : undefined}>
                  <td>
                    <strong>{r.codigo}</strong>{' '}
                    <span className="texto-suave">{r.descripcion}</span>
                  </td>
                  <td>
                    {r.cantidad} {r.unidad}
                  </td>
                  {acuse && (
                    <td style={difiere ? { fontWeight: 700, color: '#a00' } : undefined}>
                      {llego ?? '-'} {r.unidad}
                      {difiere && ` (${Number(llego) - Number(r.cantidad) > 0 ? '+' : ''}${Number(llego) - Number(r.cantidad)})`}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>

        {envio.nota && (
          <p className="texto-suave" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Tu nota: {envio.nota}
          </p>
        )}
        {acuse?.comentario && (
          <p style={{ fontSize: 13, margin: '4px 0 0', color: '#a00' }}>
            <strong>La maquila dice:</strong> {acuse.comentario}
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}

      <form className="tarjeta" onSubmit={onEnviar} style={{ marginBottom: 18 }}>
        <h2>Mandar material a una maquila</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Registra lo que sale de almacen. La maquila tiene que confirmar cuanto le llego de cada
          cosa, y si no coincide queda marcado en rojo para las dos partes.
        </p>

        <label className="campo" style={{ maxWidth: 320 }}>
          <span>Maquila</span>
          <select value={maquilaId} onChange={(e) => setMaquilaId(e.target.value)}>
            <option value="">-- Elige la maquila --</option>
            {activas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>

        {aviosActivos.length === 0 ? (
          <p className="texto-suave">
            Primero da de alta los materiales en la pestana <strong>Avios</strong>.
          </p>
        ) : (
          <>
            {renglones.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 6 }}>
                <label className="campo" style={{ flex: '2 1 260px' }}>
                  <span>Material</span>
                  {/* Buscable: el catalogo son 158 claves y bajar la lista a
                      ojo es lento (Roberto, 2026-08-14). */}
                  <SelectorAvio
                    avios={aviosActivos}
                    valor={r.codigo}
                    onElegir={(codigo) => cambiar(i, 'codigo', codigo)}
                  />
                </label>
                <label className="campo" style={{ flex: '0 1 150px' }}>
                  <span>
                    Cantidad
                    {r.codigo && <> ({aviosActivos.find((a) => a.codigo === r.codigo)?.unidad})</>}
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={r.cantidad}
                    onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
                  />
                </label>
                {renglones.length > 1 && (
                  <button
                    type="button"
                    className="btn-secundario"
                    onClick={() => setRenglones((prev) => prev.filter((_, j) => j !== i))}
                  >
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
              <span>Nota (opcional)</span>
              <input
                type="text"
                maxLength={300}
                placeholder="ej. va en la camioneta de la tarde, con la remision 84"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            </label>

            <button className="btn-primario" type="submit" disabled={enviando}>
              {enviando ? 'Registrando...' : 'Registrar envio'}
            </button>
          </>
        )}
      </form>

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Sin confirmar por la maquila ({sinConfirmar.length})</h2>
        {sinConfirmar.length === 0 ? (
          <p className="texto-suave">Todos los envios estan confirmados.</p>
        ) : (
          sinConfirmar.map(tarjetaEnvio)
        )}
      </div>

      <div className="tarjeta">
        <h2 onClick={() => setVerHistorial((v) => !v)} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <span style={{ display: 'inline-block', width: 22 }}>{verHistorial ? '▾' : '▸'}</span>
          Ya confirmados ({confirmados.length})
        </h2>
        {verHistorial &&
          (confirmados.length === 0 ? (
            <p className="texto-suave">Todavia ninguna maquila ha confirmado un envio.</p>
          ) : (
            confirmados.map(tarjetaEnvio)
          ))}
      </div>
    </>
  )
}
