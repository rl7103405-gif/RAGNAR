// LO QUE VIENE PARA PRODUCTO TERMINADO.
//
// Lo pidio Roberto el 2026-08-28 con estas palabras: "es importante que ella
// tenga como un aviso de que, oye, ya estan haciendo esto, tal vez preparate
// en x dias para recibir esto, o hoy te va a llegar esto y vete preparando".
//
// El problema real que resuelve: hoy PT se entera de que llega mercancia
// cuando el camion ya esta afuera. Todo lo que hace falta para avisarle YA
// EXISTE en las tareas de ensamble -- solo que nadie se lo estaba enseñando.
//
// Desde el 28-08 tambien RECIBE: PT registra lo que conto al llegar la
// mercancia. No hizo falta esperar a que se persista lo que la maquila
// declara, porque el acta de PT es independiente a proposito -- lo encargado
// sale de la tarea, lo recibido lo cuenta Valeria, y la diferencia es el
// hallazgo. Ver utils/recepcionPT.js.
//
// Lo que TODAVIA no hay es el codigo de barras en la remision (para no teclear
// nada) ni el inventario acumulado. Eso sigue en IDEAS.md.
//
// Esta pantalla es del rol 'pt' (Valeria). Cielo NO la ve: ella lleva los
// pagos, no recibe mercancia. Las dos compartieron el rol 'consulta' hasta
// el 28-08, y mientras lo compartieron todo lo que se le daba a una le
// aparecia a la otra.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { escucharTareasEnsambleDeVarias } from '../utils/tareasEnsamble'
import {
  ETIQUETA_ESTADO,
  escucharRecepcionesPT,
  estadoDelRenglon,
  registrarRecepcionPT
} from '../utils/recepcionPT'

// Los tres avisos, en el orden en que le importan a PT: primero lo que esta a
// punto de llegar. 'preparando' no aparece: es un borrador que la maquila ni
// siquiera ha visto, avisarlo seria anunciar algo que todavia puede cancelarse.
const GRUPOS = [
  {
    estado: 'declarada',
    titulo: 'Por llegar',
    detalle: 'La maquila ya avisó que terminó. Esto es lo próximo en entrar.',
    clase: 'alerta-exito',
    fecha: 'declaradaEn'
  },
  {
    estado: 'iniciada',
    titulo: 'La maquila lo está armando',
    detalle: 'Ya empezaron. Falta que avisen que terminaron.',
    clase: 'alerta-aviso',
    fecha: 'iniciadaEn'
  },
  {
    estado: 'abierta',
    titulo: 'Encargado, sin empezar',
    detalle: 'La tarea ya se le mandó a la maquila, pero todavía no la inicia.',
    clase: '',
    fecha: 'publicadaEn'
  }
]

const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '—')

/** Cuantos dias han pasado desde ese timestamp. Sirve para "lleva 3 dias". */
function diasDesde(t) {
  if (!t?.toDate) return null
  const ms = Date.now() - t.toDate().getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

export default function PanelPorLlegar() {
  const { authUser, perfil, esPrueba } = useAuth()
  const maquilas = useMaquilas()
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [recibiendo, setRecibiendo] = useState(null) // la tarea que se esta contando
  const [contado, setContado] = useState({})
  const [notaGeneral, setNotaGeneral] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [recepciones, setRecepciones] = useState([])

  // Se escucha maquila por maquila, igual que PanelTareasMaquila: useMaquilas
  // ya viene filtrado por mundo, asi que una cuenta de prueba solo se suscribe
  // a la maquila ficticia y una real nunca ve lo de prueba.
  const idsMaquilas = maquilas.map((m) => m.id).join(',')
  useEffect(() => {
    const ids = idsMaquilas ? idsMaquilas.split(',') : []
    return escucharTareasEnsambleDeVarias(ids, setTareas, (err) => {
      console.error('[PorLlegar] Error escuchando tareas:', err)
      setError('No se pudieron cargar los avisos: ' + (err.message || err))
    })
  }, [idsMaquilas])

  useEffect(() => {
    return escucharRecepcionesPT(esPrueba, setRecepciones, (err) => {
      console.error('[PorLlegar] Error escuchando recepciones:', err)
    })
  }, [esPrueba])

  const nombreMaquila = (id) => maquilas.find((m) => m.id === id)?.nombre || id

  const abrirRecepcion = (t) => {
    setError('')
    setAviso('')
    setRecibiendo(t)
    // Se abre VACIO, no con lo encargado ya escrito. Prellenarlo invitaria a
    // guardar sin contar, que es justo lo que el acta tiene que evitar.
    setContado({})
    setNotaGeneral('')
  }

  const ponContado = (codigo, campo, valor) =>
    setContado((prev) => ({ ...prev, [codigo]: { ...(prev[codigo] || {}), [campo]: valor } }))

  const onGuardarRecepcion = async () => {
    setError('')
    setGuardando(true)
    try {
      await registrarRecepcionPT({
        tarea: recibiendo,
        contado,
        nota: notaGeneral,
        usuario: { uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' },
        esPrueba
      })
      setAviso(`Quedo registrada la recepcion de "${recibiendo.titulo || recibiendo.ot}".`)
      setRecibiendo(null)
      setContado({})
      setNotaGeneral('')
    } catch (err) {
      console.error('[PorLlegar] No se pudo registrar:', err)
      setError('No se pudo registrar: ' + (err.message || err))
    } finally {
      setGuardando(false)
    }
  }

  const porGrupo = useMemo(() => {
    const m = new Map(GRUPOS.map((g) => [g.estado, []]))
    tareas.forEach((t) => {
      if (m.has(t.estado)) m.get(t.estado).push(t)
    })
    return m
  }, [tareas])

  const porLlegar = porGrupo.get('declarada') || []

  /** Lo encargado en esa tarea, sumado por unidad (packs y docenas conviven). */
  const resumenCantidades = (t) => {
    const porUnidad = new Map()
    ;(t.renglones || []).forEach((r) => {
      const u = String(r.unidad || 'packs')
      porUnidad.set(u, (porUnidad.get(u) || 0) + (Number(r.cantidad) || 0))
    })
    return [...porUnidad.entries()].map(([u, n]) => `${n} ${u}`).join(' · ') || '—'
  }

  return (
    <div className="tarjeta">
      <h2>Recibir</h2>

      {error && <div className="alerta-error">{error}</div>}
      {aviso && <div className="alerta-exito">{aviso}</div>}

      {porLlegar.length > 0 && (
        <div className="alerta-exito">
          <strong>
            {porLlegar.length === 1
              ? 'Hay 1 entrega por llegar.'
              : `Hay ${porLlegar.length} entregas por llegar.`}
          </strong>{' '}
          Las maquilas ya avisaron que terminaron.
        </div>
      )}

      {GRUPOS.filter((g) => g.estado === 'declarada').map((g) => {
        const lista = porGrupo.get(g.estado) || []
        return (
          <div key={g.estado} style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 2 }}>
              {g.titulo} {lista.length > 0 && <span className="texto-suave">({lista.length})</span>}
            </h3>
            <p className="texto-suave" style={{ marginTop: 0 }}>
              {g.detalle}
            </p>

            {lista.length === 0 ? (
              <p className="texto-suave">
                No hay nada esperando a que lo recibas. Aquí van a aparecer las
                entregas en cuanto la maquila avise que terminó.
              </p>
            ) : (
              <table className="tabla-datos">
                <thead>
                  <tr>
                    <th>Maquila</th>
                    <th>Pedido / cliente</th>
                    <th>OT</th>
                    <th>Códigos</th>
                    <th>Cantidad encargada</th>
                    <th>Desde</th>
                    {g.estado === 'declarada' && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((t) => {
                    const dias = diasDesde(t[g.fecha])
                    return (
                      <tr key={`${t.maquilaId || ''}-${t.id}`}>
                        <td>{nombreMaquila(t.maquilaId)}</td>
                        <td>{t.titulo || '—'}</td>
                        <td>{t.ot || '—'}</td>
                        <td>{(t.renglones || []).length}</td>
                        <td>{resumenCantidades(t)}</td>
                        <td>
                          {fecha(t[g.fecha])}
                          {dias !== null && (
                            <span className="texto-suave">
                              {' '}
                              {dias === 0 ? '(hoy)' : dias === 1 ? '(ayer)' : `(hace ${dias} días)`}
                            </span>
                          )}
                        </td>
                        {g.estado === 'declarada' && (
                          <td>
                            <button className="btn-primario" onClick={() => abrirRecepcion(t)}>
                              Registrar lo que llego
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      {recibiendo && (
        <div className="modal-fondo" onClick={() => !guardando && setRecibiendo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-cabecera">
              <h2>Recibir: {recibiendo.titulo || recibiendo.ot || 'tarea'}</h2>
              <button className="btn-cerrar" onClick={() => setRecibiendo(null)} disabled={guardando}>
                ×
              </button>
            </div>
            <p className="texto-suave">
              De <strong>{nombreMaquila(recibiendo.maquilaId)}</strong>
              {recibiendo.ot ? ` · orden de trabajo ${recibiendo.ot}` : ''}. Escribe{' '}
              <strong>lo que contaste</strong>, no lo que dice el papel. Si algo no
              cuadra, así queda registrado.
            </p>

            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'right' }}>Encargado</th>
                  <th style={{ textAlign: 'right' }}>Llegó</th>
                  <th>Cómo quedó</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {(recibiendo.renglones || []).map((r) => {
                  const c = contado[r.codigo] || {}
                  const est = estadoDelRenglon(r.cantidad, c.cantidad)
                  const color =
                    est === 'completo'
                      ? '#16a34a'
                      : est === 'faltante'
                        ? '#dc2626'
                        : est === 'sobrante'
                          ? '#d97706'
                          : '#64748b'
                  return (
                    <tr key={r.codigo}>
                      <td>
                        <strong>{r.codigo}</strong>
                      </td>
                      <td>{r.descripcion || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {r.cantidad} {r.unidad || 'packs'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          style={{ width: 90, textAlign: 'right' }}
                          value={c.cantidad ?? ''}
                          onChange={(e) => ponContado(r.codigo, 'cantidad', e.target.value)}
                        />
                      </td>
                      <td style={{ color }}>{ETIQUETA_ESTADO[est]}</td>
                      <td>
                        <input
                          type="text"
                          placeholder="opcional"
                          value={c.nota ?? ''}
                          onChange={(e) => ponContado(r.codigo, 'nota', e.target.value)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <label className="campo" style={{ marginTop: 12 }}>
              <span>Nota de la entrega (opcional)</span>
              <input
                type="text"
                value={notaGeneral}
                onChange={(e) => setNotaGeneral(e.target.value)}
                placeholder="Cajas mojadas, llegó incompleto, quién la trajo..."
              />
            </label>

            <p className="texto-suave">
              Una vez guardada <strong>no se puede editar</strong>: es el acta de lo que
              contaste, con tu nombre y la hora. Si te equivocas, levanta otra y explícalo
              en la nota.
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-primario" onClick={onGuardarRecepcion} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar recepción'}
              </button>
              <button onClick={() => setRecibiendo(null)} disabled={guardando}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <h3 style={{ marginBottom: 2 }}>
          Lo que ya recibiste{' '}
          {recepciones.length > 0 && <span className="texto-suave">({recepciones.length})</span>}
        </h3>
        {recepciones.length === 0 ? (
          <p className="texto-suave">Todavía no se ha registrado ninguna recepción.</p>
        ) : (
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Maquila</th>
                <th>Pedido</th>
                <th>OT</th>
                <th>¿Cuadró?</th>
                <th>Quién recibió</th>
              </tr>
            </thead>
            <tbody>
              {recepciones.map((r) => (
                <tr key={r.id}>
                  <td>{fecha(r.recibidoEn)}</td>
                  <td>{nombreMaquila(r.maquilaId)}</td>
                  <td>{r.tareaTitulo || '—'}</td>
                  <td>{r.ot || '—'}</td>
                  <td style={{ color: r.cuadro ? '#16a34a' : '#dc2626' }}>
                    {r.cuadro
                      ? 'Sí, todo completo'
                      : `No — ${r.renglonesConProblema} ${
                          r.renglonesConProblema === 1 ? 'código' : 'códigos'
                        }`}
                  </td>
                  <td>{r.recibidoPorNombre || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 30, paddingTop: 6, borderTop: '1px solid #e2e8f0' }}>
        <h3 style={{ marginBottom: 2 }}>Lo que viene más adelante</h3>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          Todavía no llega nada de esto: es para que sepas qué se está trabajando y
          puedas ir preparando el espacio.
        </p>
        {GRUPOS.filter((g) => g.estado !== 'declarada').map((g) => {
          const lista = porGrupo.get(g.estado) || []
          return (
            <div key={g.estado} style={{ marginTop: 14 }}>
              <strong>{g.titulo}</strong>{' '}
              {lista.length > 0 && <span className="texto-suave">({lista.length})</span>}
              <p className="texto-suave" style={{ margin: '2px 0 6px' }}>
                {g.detalle}
              </p>
              {lista.length === 0 ? (
                <p className="texto-suave">Nada por ahora.</p>
              ) : (
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Maquila</th>
                      <th>Pedido / cliente</th>
                      <th>OT</th>
                      <th>Códigos</th>
                      <th>Cantidad encargada</th>
                      <th>Desde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((t) => {
                      const dias = diasDesde(t[g.fecha])
                      return (
                        <tr key={`${t.maquilaId || ''}-${t.id}`}>
                          <td>{nombreMaquila(t.maquilaId)}</td>
                          <td>{t.titulo || '—'}</td>
                          <td>{t.ot || '—'}</td>
                          <td>{(t.renglones || []).length}</td>
                          <td>{resumenCantidades(t)}</td>
                          <td>
                            {fecha(t[g.fecha])}
                            {dias !== null && (
                              <span className="texto-suave">
                                {' '}
                                {dias === 0 ? '(hoy)' : dias === 1 ? '(ayer)' : `(hace ${dias} días)`}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>

      <p className="texto-suave" style={{ marginTop: 22 }}>
        Todavía se cuenta a mano. Falta que la remisión de la maquila traiga su{' '}
        <strong>código de barras</strong> para que al leerlo aparezca solo todo lo que
        mandó, sin teclear nada.
      </p>

    </div>
  )
}
