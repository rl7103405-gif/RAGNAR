// INVENTARIO DE AVIOS de todas las maquilas (vista INTERNA).
//
// Lo ven America, Lindbergh, Alvaro y el admin. Dos cosas importan aqui:
//   1. Cuanto material tiene cada maquila (base para saber si puede ensamblar).
//   2. Las DISCREPANCIAS abiertas: donde lo que almacen mando no coincide con
//      lo que la maquila declaro. El inventario se quedo con lo de la maquila,
//      asi que esto es el aviso de que algo salio mal — y hay que revisarlo.
import { useEffect, useMemo, useState } from 'react'
import { collectionGroup, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { soloDeMisMaquilas } from '../utils/mundoDatos'
import { compararAscendente } from '../utils/texto'

export default function PanelInventarioAvios() {
  const { authUser, perfil, puedeManejarAvios } = useAuth()
  const maquilas = useMaquilas()
  const [saldos, setSaldos] = useState([])
  const [discrepancias, setDiscrepancias] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [maquilaFiltro, setMaquilaFiltro] = useState('')
  const [resoluciones, setResoluciones] = useState({})
  const [trabajando, setTrabajando] = useState(null)
  const [verRevisadas, setVerRevisadas] = useState(false)

  useEffect(() => {
    const unsubSaldos = onSnapshot(
      collectionGroup(db, 'saldosAvios'),
      // collectionGroup NO pasa por el catalogo: sin este filtro, el
      // inventario de la maquila ficticia se suma al de las reales.
      (snap) => setSaldos(soloDeMisMaquilas(snap.docs.map((d) => ({ id: d.id, ...d.data() })), maquilas)),
      (err) => {
        console.error('[InventarioAvios] Error leyendo saldos:', err)
        setError('No se pudo cargar el inventario: ' + (err.message || err))
      }
    )
    const unsubDisc = onSnapshot(
      collectionGroup(db, 'discrepanciasAvios'),
      (snap) => setDiscrepancias(soloDeMisMaquilas(snap.docs.map((d) => ({ id: d.id, ...d.data() })), maquilas)),
      (err) => console.error('[InventarioAvios] Error leyendo discrepancias:', err)
    )
    return () => {
      unsubSaldos()
      unsubDisc()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maquilas.length])

  const nombreMaquila = (mid) => maquilas.find((m) => m.id === mid)?.nombre || mid

  const porMaquila = useMemo(() => {
    const mapa = new Map()
    saldos
      .filter((s) => !maquilaFiltro || s.maquilaId === maquilaFiltro)
      .forEach((s) => {
        if (!mapa.has(s.maquilaId)) mapa.set(s.maquilaId, [])
        mapa.get(s.maquilaId).push(s)
      })
    return [...mapa.entries()]
      .map(([mid, filas]) => ({
        maquilaId: mid,
        nombre: nombreMaquila(mid),
        filas: filas.sort((a, b) => compararAscendente(a.codigo, b.codigo)),
        // Cuantos codigos tiene con saldo, para el encabezado.
        conSaldo: filas.filter((f) => Number(f.cantidad) > 0).length
      }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saldos, maquilaFiltro, maquilas])

  const abiertas = useMemo(
    () =>
      discrepancias
        .filter((d) => d.estado === 'abierta')
        .sort((a, b) => {
          // Las mas viejas arriba: son las que llevan mas tiempo sin resolver.
          const ta = a.abiertaEn?.toMillis ? a.abiertaEn.toMillis() : 0
          const tb = b.abiertaEn?.toMillis ? b.abiertaEn.toMillis() : 0
          return ta - tb
        }),
    [discrepancias]
  )
  const revisadas = useMemo(() => discrepancias.filter((d) => d.estado !== 'abierta'), [discrepancias])

  const fechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
      : '-'

  const diasDesde = (t) => {
    if (!t?.toDate) return null
    const dias = Math.floor((Date.now() - t.toDate().getTime()) / 86400000)
    return dias
  }

  const onRevisar = async (d) => {
    const texto = String(resoluciones[d.id] || '').trim()
    if (!texto) {
      setError('Escribe que paso con esta diferencia antes de marcarla revisada.')
      return
    }
    setError('')
    setAviso('')
    setTrabajando(d.id)
    try {
      await updateDoc(doc(db, 'portalMaquila', d.maquilaId, 'discrepanciasAvios', d.id), {
        estado: 'revisada',
        resueltoPorUid: authUser.uid,
        resueltoPorNombre: perfil?.nombreCompleto || '',
        resueltoEn: serverTimestamp(),
        resolucion: texto.slice(0, 300)
      })
      setAviso(`Diferencia de ${d.codigo} marcada como revisada.`)
      setResoluciones((prev) => ({ ...prev, [d.id]: '' }))
    } catch (err) {
      console.error('[InventarioAvios] No se pudo marcar revisada:', err)
      setError('No se pudo guardar: ' + (err.message || err))
    } finally {
      setTrabajando(null)
    }
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}

      {abiertas.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 18, borderLeft: '4px solid #dc2626' }}>
          <h2 style={{ color: '#a00' }}>
            Diferencias por revisar ({abiertas.length})
          </h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Aqui lo que almacen mando <strong>no coincide</strong> con lo que la maquila declaro
            recibir. El inventario se quedo con lo que dijo la maquila; esto es para que almacen se
            entere y quede constancia de que se revisó.
          </p>
          {abiertas.map((d) => {
            const dias = diasDesde(d.abiertaEn)
            return (
              <div
                key={`${d.maquilaId}__${d.id}`}
                style={{
                  border: '1px solid #e2c9c9',
                  background: '#fdf6f6',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 10
                }}
              >
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <strong>{nombreMaquila(d.maquilaId)}</strong>
                  <span style={{ fontWeight: 700 }}>{d.codigo}</span>
                  <span className="texto-suave" style={{ fontSize: 13 }}>
                    {d.descripcion}
                  </span>
                  {dias !== null && dias >= 3 && (
                    <span
                      style={{
                        fontSize: 12,
                        borderRadius: 999,
                        padding: '2px 10px',
                        background: '#fdf1f1',
                        color: '#a00',
                        fontWeight: 700
                      }}
                    >
                      lleva {dias} dias sin revisar
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  Se mando <strong>{d.cantidadEnviada}</strong> {d.unidad} · la maquila declaro{' '}
                  <strong>{d.cantidadRecibida}</strong> ·{' '}
                  <strong style={{ color: '#a00' }}>
                    {d.diferencia > 0 ? '+' : ''}
                    {d.diferencia}
                  </strong>
                </div>
                {d.comentarioMaquila && (
                  <p className="texto-suave" style={{ fontSize: 13, margin: '4px 0 0' }}>
                    La maquila dice: {d.comentarioMaquila}
                  </p>
                )}
                <p className="texto-suave" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                  Abierta el {fechaHora(d.abiertaEn)}
                </p>

                {puedeManejarAvios && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                    <label className="campo" style={{ flex: '1 1 320px', marginBottom: 0 }}>
                      <span>Que paso (queda registrado)</span>
                      <input
                        type="text"
                        maxLength={300}
                        placeholder="ej. se contaron mal al cargar, se le manda la diferencia el lunes"
                        value={resoluciones[d.id] || ''}
                        onChange={(e) =>
                          setResoluciones((prev) => ({ ...prev, [d.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      className="btn-primario"
                      disabled={trabajando === d.id}
                      onClick={() => onRevisar(d)}
                    >
                      {trabajando === d.id ? 'Guardando...' : 'Marcar revisada'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Inventario de material por maquila</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Lo que cada maquila tiene hoy, segun lo que ha confirmado recibir menos lo que se ha ido
          consumiendo. Cada numero se puede explicar movimiento por movimiento.
        </p>

        {maquilas.length > 1 && (
          <label className="campo" style={{ maxWidth: 300 }}>
            <span>Maquila</span>
            <select value={maquilaFiltro} onChange={(e) => setMaquilaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {maquilas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
        )}

        {porMaquila.length === 0 ? (
          <p className="texto-suave">
            Todavia no hay movimientos de inventario. Aparecera aqui cuando una maquila confirme el
            primer material que le manden.
          </p>
        ) : (
          porMaquila.map((g) => (
            <div key={g.maquilaId} style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontWeight: 700,
                  background: '#eef2f7',
                  padding: '6px 10px',
                  borderRadius: 4
                }}
              >
                {g.nombre}
                <span style={{ fontWeight: 400, fontSize: 13, marginLeft: 10, color: '#556' }}>
                  {g.conSaldo} material(es) con existencia
                </span>
              </div>
              <table className="tabla-datos" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Tiene</th>
                    <th>Ultimo movimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {g.filas.map((f) => (
                    <tr key={f.codigo} style={Number(f.cantidad) === 0 ? { color: '#8a8a8a' } : undefined}>
                      <td style={{ fontWeight: 700 }}>{f.codigo}</td>
                      <td>
                        <strong>{f.cantidad}</strong> {f.unidad}
                      </td>
                      <td className="texto-suave">{fechaHora(f.actualizadoEn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      <div className="tarjeta">
        <h2
          onClick={() => setVerRevisadas((v) => !v)}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ display: 'inline-block', width: 22 }}>{verRevisadas ? '▾' : '▸'}</span>
          Diferencias ya revisadas ({revisadas.length})
        </h2>
        {verRevisadas &&
          (revisadas.length === 0 ? (
            <p className="texto-suave">Todavia no hay diferencias revisadas.</p>
          ) : (
            <table className="tabla-datos" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Maquila</th>
                  <th>Material</th>
                  <th>Mandado / recibido</th>
                  <th>Que paso</th>
                  <th>Reviso</th>
                </tr>
              </thead>
              <tbody>
                {revisadas.map((d) => (
                  <tr key={`${d.maquilaId}__${d.id}`}>
                    <td>{nombreMaquila(d.maquilaId)}</td>
                    <td>{d.codigo}</td>
                    <td>
                      {d.cantidadEnviada} / {d.cantidadRecibida} ({d.diferencia > 0 ? '+' : ''}
                      {d.diferencia})
                    </td>
                    <td>{d.resolucion}</td>
                    <td className="texto-suave">
                      {d.resueltoPorNombre} · {fechaHora(d.resueltoEn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </>
  )
}
