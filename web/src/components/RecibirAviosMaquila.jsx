// Lo que usa la MAQUILA para confirmar el material que le manda Alvaro.
//
// Aqui no se palomea "llego todo" a ciegas: se escribe CUANTO llego de cada
// cosa. Ese numero es lo que va a alimentar su inventario, asi que si dice 950
// donde se mandaron 1000, la diferencia queda escrita y visible para los dos.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  acusarAvios,
  escucharAcusesDeMaquila,
  escucharEnviosDeMaquila,
  ErrorEnvioAvios
} from '../utils/enviosAvios'
import AjustarInventarioMaquila from './AjustarInventarioMaquila'
import { compararAscendente } from '../utils/texto'

export default function RecibirAviosMaquila() {
  const { authUser, perfil } = useAuth()
  const maquilaId = perfil?.maquilaId || ''
  const nombreMaquila = perfil?.nombreCompleto || ''

  const [envios, setEnvios] = useState([])
  const [acuses, setAcuses] = useState({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [abierto, setAbierto] = useState(null)
  // Borrador: { cantidades: {i: '500'}, comentario: '' }
  const [borrador, setBorrador] = useState(null)
  const [guardando, setGuardando] = useState(false)
  // Su propio inventario: lo que tiene hoy de cada material.
  const [saldos, setSaldos] = useState([])

  useEffect(() => {
    if (!maquilaId) {
      setCargando(false)
      return
    }
    const unsubEnvios = escucharEnviosDeMaquila(
      maquilaId,
      (datos) => {
        setEnvios(datos)
        setCargando(false)
      },
      (err) => {
        console.error('[RecibirAvios] Error:', err)
        setError('No se pudo cargar: ' + (err.message || err))
        setCargando(false)
      }
    )
    const unsubAcuses = escucharAcusesDeMaquila(maquilaId, setAcuses, (err) =>
      console.error('[RecibirAvios] Error leyendo acuses:', err)
    )
    const unsubSaldos = onSnapshot(
      collection(db, 'portalMaquila', maquilaId, 'saldosAvios'),
      (snap) =>
        setSaldos(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => compararAscendente(a.codigo, b.codigo))
        ),
      (err) => console.error('[RecibirAvios] Error leyendo saldos:', err)
    )
    return () => {
      unsubEnvios()
      unsubAcuses()
      unsubSaldos()
    }
  }, [maquilaId])

  const pendientes = useMemo(() => envios.filter((e) => !acuses[e.id]), [envios, acuses])
  const confirmados = useMemo(() => envios.filter((e) => acuses[e.id]), [envios, acuses])

  const fechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
      : '-'

  const abrir = (envio) => {
    if (abierto === envio.id) {
      setAbierto(null)
      setBorrador(null)
      return
    }
    setAbierto(envio.id)
    setError('')
    // Se precargan las cantidades ENVIADAS: lo normal es que llegue todo, y
    // asi solo se corrige lo que no cuadro.
    const cantidades = {}
    ;(envio.renglones || []).forEach((r, i) => {
      cantidades[i] = String(r.cantidad)
    })
    setBorrador({ cantidades, comentario: '' })
  }

  const onConfirmar = async (envio) => {
    setError('')
    setAviso('')
    const recibido = (envio.renglones || []).map((r, i) => ({
      codigo: r.codigo,
      cantidad: Number(borrador?.cantidades?.[i])
    }))
    const hayDiferencia = recibido.some((f, i) => f.cantidad !== Number(envio.renglones[i].cantidad))

    const texto = hayDiferencia
      ? 'Vas a reportar que las cantidades NO coinciden con lo que se mando:\n\n' +
        recibido
          .map((f, i) =>
            f.cantidad !== Number(envio.renglones[i].cantidad)
              ? `  ${f.codigo}: se mando ${envio.renglones[i].cantidad}, llego ${f.cantidad}`
              : null
          )
          .filter(Boolean)
          .join('\n') +
        '\n\nEsto queda registrado para las dos partes. ¿Confirmas?'
      : 'Vas a confirmar que llego TODO completo, tal como se mando.\n\n' +
        'Esto no se puede editar despues. ¿Confirmas?'
    if (!window.confirm(texto)) return

    setGuardando(true)
    try {
      const r = await acusarAvios({
        maquilaId,
        envio,
        recibido,
        comentario: borrador?.comentario,
        usuario: { uid: authUser.uid, nombre: nombreMaquila }
      })
      setAviso(
        r.hayDiferencia
          ? 'Reportaste las diferencias. Almacen ya las ve.'
          : 'Confirmaste el material completo. Gracias.'
      )
      setAbierto(null)
      setBorrador(null)
    } catch (err) {
      console.error('[RecibirAvios] No se pudo confirmar:', err)
      setError(err instanceof ErrorEnvioAvios ? err.message : 'No se pudo guardar: ' + (err.message || err))
    } finally {
      setGuardando(false)
    }
  }

  if (!maquilaId) {
    return (
      <div className="tarjeta">
        <h2>Tu cuenta no tiene una maquila asignada</h2>
        <p>Avisale a Roberto para que la configure.</p>
      </div>
    )
  }

  const tarjeta = (envio, yaConfirmado) => {
    const acuse = acuses[envio.id]
    const estaAbierto = abierto === envio.id
    const conDiferencias = acuse?.resultado === 'con_diferencias'
    return (
      <div
        key={envio.id}
        style={{
          border: '1px solid',
          borderColor: yaConfirmado ? '#d8dee6' : '#f0c98a',
          background: yaConfirmado ? '#fff' : '#fffdf7',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 12
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <strong style={{ fontSize: 16 }}>Material del {fechaHora(envio.creadoEn)}</strong>
          <span className="texto-suave" style={{ fontSize: 13 }}>
            {(envio.renglones || []).length} material(es) · lo mando {envio.enviadoPorNombre}
          </span>
          {acuse && (
            <span
              style={{
                fontSize: 12,
                borderRadius: 999,
                padding: '2px 10px',
                background: conDiferencias ? '#fdf1f1' : '#e8f5ec',
                color: conDiferencias ? '#a00' : '#1a7a3a'
              }}
            >
              {conDiferencias ? 'Confirmado con diferencias' : 'Confirmado completo'}
            </span>
          )}
        </div>

        {envio.nota && (
          <p className="texto-suave" style={{ fontSize: 13, margin: '4px 0 0' }}>
            Nota de almacen: {envio.nota}
          </p>
        )}

        <button className="btn-secundario" style={{ marginTop: 8 }} onClick={() => abrir(envio)}>
          {estaAbierto ? 'Cerrar' : yaConfirmado ? 'Ver el detalle' : 'Revisar y confirmar'}
        </button>

        {estaAbierto && (
          <div style={{ marginTop: 10 }}>
            <table className="tabla-datos" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Se mando</th>
                  <th>{yaConfirmado ? 'Llego' : '¿Cuanto llego?'}</th>
                </tr>
              </thead>
              <tbody>
                {(envio.renglones || []).map((r, i) => {
                  const llego = acuse?.recibido?.[i]?.cantidad
                  const difiere = acuse && Number(llego) !== Number(r.cantidad)
                  return (
                    <tr key={`${r.codigo}-${i}`} style={difiere ? { background: '#fdf1f1' } : undefined}>
                      <td>
                        <strong>{r.codigo}</strong> <span className="texto-suave">{r.descripcion}</span>
                      </td>
                      <td>
                        {r.cantidad} {r.unidad}
                      </td>
                      <td>
                        {yaConfirmado ? (
                          <span style={difiere ? { fontWeight: 700, color: '#a00' } : undefined}>
                            {llego ?? '-'} {r.unidad}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            style={{ width: 100 }}
                            value={borrador?.cantidades?.[i] ?? ''}
                            onChange={(e) =>
                              setBorrador((prev) => ({
                                ...prev,
                                cantidades: { ...prev.cantidades, [i]: e.target.value }
                              }))
                            }
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {acuse?.comentario && (
              <p style={{ fontSize: 13, color: '#a00', marginTop: 6 }}>
                Lo que reportaste: {acuse.comentario}
              </p>
            )}

            {!yaConfirmado && (
              <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 10 }}>
                <p className="texto-suave" style={{ fontSize: 13, marginTop: 0 }}>
                  Las cantidades vienen precargadas con lo que se mando. <strong>Corrige solo lo
                  que no cuadre</strong> y confirma.
                </p>
                <label className="campo">
                  <span>Nota (obligatoria si alguna cantidad no coincide)</span>
                  <input
                    type="text"
                    maxLength={300}
                    placeholder="ej. de la caja CJ-6 solo llegaron 40, venian mojadas"
                    value={borrador?.comentario || ''}
                    onChange={(e) => setBorrador((p) => ({ ...p, comentario: e.target.value }))}
                  />
                </label>
                <button className="btn-primario" disabled={guardando} onClick={() => onConfirmar(envio)}>
                  {guardando ? 'Guardando...' : 'Confirmar lo que llego'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}
      {cargando && <p className="texto-suave">Cargando...</p>}

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Tu inventario de material</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Lo que tienes hoy segun lo que has confirmado recibir. Si un numero no cuadra
          con lo que tienes fisicamente, <strong>corrigelo tu mismo</strong> con el boton
          de abajo.
        </p>
        {saldos.length === 0 ? (
          <p className="texto-suave">
            Todavia no tienes material registrado. Aparecera aqui cuando confirmes el primer envio.
          </p>
        ) : (
          <table className="tabla-datos" style={{ fontSize: 14 }}>
            <thead>
              <tr>
                <th>Material</th>
                <th>Tienes</th>
              </tr>
            </thead>
            <tbody>
              {saldos.map((s) => (
                <tr key={s.codigo} style={Number(s.cantidad) === 0 ? { color: '#8a8a8a' } : undefined}>
                  <td style={{ fontWeight: 700 }}>{s.codigo}</td>
                  <td>
                    <strong>{s.cantidad}</strong> {s.unidad}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* La correccion vive DENTRO de la tarjeta del inventario: es sobre
            estos numeros, no una pantalla aparte que haya que ir a buscar. */}
        <AjustarInventarioMaquila saldos={saldos} />
      </div>

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Material por confirmar ({pendientes.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Lo que almacen registro que te mando. Cuenta lo que tienes fisicamente y confirma cuanto
          llego de cada cosa: eso es lo que va a quedar en tu inventario.
        </p>
        {!cargando && pendientes.length === 0 ? (
          <p className="texto-suave">No tienes material pendiente de confirmar.</p>
        ) : (
          pendientes.map((e) => tarjeta(e, false))
        )}
      </div>

      <div className="tarjeta">
        <h2>Ya confirmado ({confirmados.length})</h2>
        {!cargando && confirmados.length === 0 ? (
          <p className="texto-suave">Todavia no has confirmado material.</p>
        ) : (
          confirmados.map((e) => tarjeta(e, true))
        )}
      </div>
    </>
  )
}
