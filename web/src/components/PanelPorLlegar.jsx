// RECIBIR (Producto Terminado).
//
// Aqui Valeria registra lo que le llega de vuelta de la maquila. El flujo es el
// que pidio Roberto el 2026-08-28: "acabo de recibir un pedido, pongo mis
// especificaciones, se compara con los folios, con lo que ha salido, y ya se
// saca lo que entro".
//
// Elige la SALIDA (el documento con el que se le mando la mercancia a la
// maquila), la pantalla trae lo que salio de cada codigo, ella escribe lo que
// conto, y el acta queda con la diferencia.
//
// ⚠️ Esta pantalla es del rol 'pt'. Cielo NO la ve: ella lleva los pagos, no
// recibe mercancia.
//
// Abajo, como referencia, lo que las maquilas tienen en sus manos segun las
// tareas de ensamble. Hoy sale vacio porque las maquilas todavia no tienen
// cuenta y nadie esta creando tareas; se deja porque sera informacion real en
// cuanto empiecen, y porque recibir NO depende de eso.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { escucharTareasEnsambleDeVarias } from '../utils/tareasEnsamble'
import {
  ETIQUETA_ESTADO,
  escucharRecepcionesPT,
  estadoDelRenglon,
  mapaOtAOc,
  olvidarCacheDeSalidas,
  otsYOcsDeSalida,
  registrarRecepcionPT,
  renglonesDeLaSalida,
  SIN_OT,
  salidasParaRecibir,
  textoBuscableDeSalida
} from '../utils/recepcionPT'

// Cuantos resultados se pintan. Con mas, la lista deja de ayudar y hay que
// afinar la busqueda; el contador dice cuantos quedaron fuera.
const MAX_RESULTADOS = 12

const ESTADOS_EN_MAQUILA = [
  { estado: 'declarada', titulo: 'Ya avisaron que terminaron', fecha: 'declaradaEn' },
  { estado: 'iniciada', titulo: 'Lo están armando', fecha: 'iniciadaEn' },
  { estado: 'abierta', titulo: 'Encargado, sin empezar', fecha: 'publicadaEn' }
]

const COLOR_ESTADO = {
  completo: '#16a34a',
  faltante: '#dc2626',
  sobrante: '#d97706',
  sin_contar: '#64748b',
  sin_referencia: '#64748b'
}

const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '—')

// RECIBIR: lo que vuelve de las maquilas.
//
// ⚠️ Aqui vivio un rato un tercer nivel de pestanas ("Recibe de maquila" /
// "Embarca al cliente") encima de las tres de abajo. Roberto lo quito el
// 2026-09-02: "ya estamos viendo tres subpestañas y eso ya es ruido visual".
// Embarcar al cliente es OTRA COSA —no es recibir— y se fue a su propia
// pestana de primer nivel, entre Recibir y Maquilas. Aqui quedan solo las
// tres secciones que de verdad son de recibir.
export default function PanelRecibeDeMaquila() {
  const { authUser, perfil, esPrueba } = useAuth()
  const maquilas = useMaquilas()

  const [salidas, setSalidas] = useState([])
  const [cargandoSalidas, setCargandoSalidas] = useState(true)
  const [salidaId, setSalidaId] = useState('')
  const [contado, setContado] = useState({})
  const [notaGeneral, setNotaGeneral] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [recepciones, setRecepciones] = useState([])
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  // Sub-pestanas, con el mismo patron que la pantalla de Maquilas. Roberto
  // las pidio el 28-08: en una sola columna, registrar una entrega quedaba
  // revuelto con el historial y con la referencia de las maquilas.
  const [seccion, setSeccion] = useState('registrar')
  const [busqueda, setBusqueda] = useState('')
  const [otAOc, setOtAOc] = useState(() => new Map())

  useEffect(() => {
    let vivo = true
    setCargandoSalidas(true)
    salidasParaRecibir(esPrueba)
      .then((s) => {
        if (!vivo) return
        setSalidas(s)
        setCargandoSalidas(false)
      })
      .catch((err) => {
        if (!vivo) return
        console.error('[Recibir] No se pudieron leer las salidas:', err)
        setError('No se pudieron cargar las salidas: ' + (err.message || err))
        setCargandoSalidas(false)
      })
    return () => {
      vivo = false
    }
  }, [esPrueba])

  useEffect(
    () =>
      escucharRecepcionesPT(esPrueba, setRecepciones, (err) => {
        console.error('[Recibir] Error escuchando recepciones:', err)
        setError('No se pudo cargar lo ya recibido: ' + (err.message || err))
      }),
    [esPrueba]
  )

  // El mapa OT -> OC del plan vigente: una lectura, y con ella se puede
  // buscar por orden de compra aunque la salida no la traiga guardada.
  useEffect(() => {
    let vivo = true
    mapaOtAOc().then((m) => vivo && setOtAOc(m))
    return () => {
      vivo = false
    }
  }, [])

  const idsMaquilas = maquilas.map((m) => m.id).join(',')
  useEffect(() => {
    const ids = idsMaquilas ? idsMaquilas.split(',') : []
    return escucharTareasEnsambleDeVarias(ids, setTareas, (err) =>
      console.warn('[Recibir] No se pudieron leer las tareas:', err?.message)
    )
  }, [idsMaquilas])

  const indexadas = useMemo(
    () => salidas.map((x) => ({ salida: x, buscable: textoBuscableDeSalida(x, otAOc) })),
    [salidas, otAOc]
  )

  const encontradas = useMemo(() => {
    // Cada palabra por separado y todas tienen que estar: asi "302 rober" o
    // "7976 lopez" encuentran, sin obligar a teclearlo en el mismo orden.
    const palabras = busqueda.trim().toUpperCase().split(/\s+/).filter(Boolean)
    if (palabras.length === 0) return indexadas
    return indexadas.filter((x) => palabras.every((w) => x.buscable.includes(w)))
  }, [indexadas, busqueda])

  const salida = salidas.find((s) => s.id === salidaId) || null
  const renglones = useMemo(() => (salida ? renglonesDeLaSalida(salida) : []), [salida])
  const yaRecibidas = useMemo(
    () => new Set(recepciones.map((r) => r.documentoId)),
    [recepciones]
  )

  const nombreMaquila = (id) => maquilas.find((m) => m.id === id)?.nombre || id

  const ponContado = (codigo, campo, valor) =>
    setContado((prev) => ({ ...prev, [codigo]: { ...(prev[codigo] || {}), [campo]: valor } }))

  const elegirSalida = (id) => {
    setSalidaId(id)
    // Se abre VACIO, no con lo que salio ya escrito: prellenarlo invitaria a
    // guardar sin contar, que es justo lo que el acta debe evitar.
    setContado({})
    setNotaGeneral('')
    setError('')
    setAviso('')
  }

  const onGuardar = async () => {
    setError('')
    setGuardando(true)
    try {
      await registrarRecepcionPT({
        salida,
        contado,
        nota: notaGeneral,
        usuario: { uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' },
        esPrueba
      })
      setAviso(
        `Quedó registrada la recepción del folio ${salida?.encabezado?.folioInterno || ''}.`
      )
      olvidarCacheDeSalidas()
      elegirSalida('')
      setBusqueda('')
    } catch (err) {
      console.error('[Recibir] No se pudo registrar:', err)
      setError('No se pudo registrar: ' + (err.message || err))
    } finally {
      setGuardando(false)
    }
  }

  const registrar = (
    <div className="tarjeta">
      <h2>Registrar una entrega</h2>
      <p className="texto-suave">
        Cuando te llegue algo de una maquila, elige aquí con qué documento salió y
        escribe lo que contaste. La pantalla lo compara sola contra lo que se mandó.
      </p>

      {error && <div className="alerta-error">{error}</div>}
      {aviso && <div className="alerta-exito">{aviso}</div>}

      {cargandoSalidas ? (
        <p className="texto-suave">Cargando salidas...</p>
      ) : salidas.length === 0 ? (
        <p className="texto-suave">
          Todavía no hay salidas a maquilas registradas. Van a aparecer aquí en cuanto
          se emita la primera.
        </p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              margin: '14px 0 6px'
            }}
          >
            <strong>
              {salidaId ? 'Salida elegida' : '¿De qué salida es lo que llegó?'}
            </strong>
            {!salidaId && (
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por folio, bulto, OT, OC o maquila"
              style={{ flex: '1 1 280px', maxWidth: 420, padding: '7px 10px' }}
            />
            )}
          </div>

          <p className="texto-suave" style={{ fontSize: 13, marginTop: 0 }}>
            {salidaId
              ? 'Cuenta lo que llegó de cada orden de trabajo. Si te equivocaste de salida, pica "Quitar".'
              : encontradas.length === salidas.length
              ? `Las más recientes de ${salidas.length}. Si la tuya no está a la vista, búscala.`
              : `${encontradas.length} de ${salidas.length} salidas coinciden.`}
          </p>

          {encontradas.length === 0 ? (
            <p className="texto-suave">
              Nada con eso. Prueba con el folio interno de la salida, el folio de
              alguno de los bultos, la orden de trabajo o el nombre de la maquila.
            </p>
          ) : (
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Maquila</th>
                  <th>Salió</th>
                  <th>Bultos</th>
                  <th>OT</th>
                  <th>OC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {/* Con una salida ya elegida se enseña SOLO esa: las otras once
                    estorban para contar, que es lo que sigue. Roberto, 28-08. */}
                {(salidaId
                  ? encontradas.filter(({ salida: x }) => x.id === salidaId)
                  : encontradas.slice(0, MAX_RESULTADOS)
                ).map(({ salida: x }) => {
                  const { ots, ocs } = otsYOcsDeSalida(x, otAOc)
                  const elegida = x.id === salidaId
                  return (
                    <tr
                      key={x.id}
                      style={elegida ? { background: '#eef2f7', fontWeight: 600 } : undefined}
                    >
                      <td>
                        <strong>{x.encabezado?.folioInterno || '—'}</strong>
                        {yaRecibidas.has(x.id) && (
                          <div className="texto-suave" style={{ fontSize: 12 }}>
                            ya recibida
                          </div>
                        )}
                      </td>
                      <td>{x.maquila?.nombre || x.maquila?.id}</td>
                      <td>{x.fechaTexto || '—'}</td>
                      <td>{x.totalFolios ?? (x.capturas || []).length}</td>
                      <td>{ots.join(', ') || '—'}</td>
                      <td>{ocs.join(', ') || '—'}</td>
                      <td>
                        <button
                          className={elegida ? '' : 'btn-primario'}
                          onClick={() => elegirSalida(elegida ? '' : x.id)}
                        >
                          {elegida ? 'Quitar' : 'Es esta'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {!salidaId && encontradas.length > MAX_RESULTADOS && (
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Se muestran las {MAX_RESULTADOS} más recientes de {encontradas.length}.
              Afina la búsqueda para ver el resto.
            </p>
          )}
        </>
      )}

      {salida && (
        <>
          <p className="texto-suave">
            Salió el <strong>{salida.fechaTexto || '—'}</strong> a{' '}
            <strong>{salida.maquila?.nombre}</strong>:{' '}
            <strong>{renglones.reduce((a, r) => a + r.docenasEnviadas, 0)} docenas</strong> en{' '}
            {renglones.length} {renglones.length === 1 ? 'orden de trabajo' : 'órdenes de trabajo'}.
            {yaRecibidas.has(salida.id) && (
              <>
                {' '}
                <strong style={{ color: '#d97706' }}>
                  Ojo: esta salida ya tiene una recepción registrada.
                </strong>
              </>
            )}
          </p>

          {/* UN RENGLON POR ORDEN DE TRABAJO. Roberto, 2026-09-03, viendo a
              Valeria usarlo: "a Valeria solo le sirve el consolidado, ni los
              codigos ni los bultos". La descripcion queda como pista chica bajo
              la OT, por si hay que reconocer de que se trata. */}
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Orden de trabajo</th>
                <th>Orden de compra</th>
                <th style={{ textAlign: 'right' }}>Salieron</th>
                <th style={{ textAlign: 'right' }}>Llegaron</th>
                <th>Cómo quedó</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => {
                const c = contado[r.ot] || {}
                const est = estadoDelRenglon(r.docenasEnviadas, c.docenas)
                const oc = r.ot !== SIN_OT ? otAOc.get(r.ot) : ''
                return (
                  <tr key={r.ot}>
                    <td>
                      <strong>{r.ot}</strong>
                      <div className="texto-suave" style={{ fontSize: 12 }}>
                        {r.descripcion || (r.codigos.length ? r.codigos.join(', ') : '—')}
                      </div>
                    </td>
                    <td>{oc || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.docenasEnviadas} doc</td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        style={{ width: 90, textAlign: 'right' }}
                        value={c.docenas ?? ''}
                        onChange={(e) => ponContado(r.ot, 'docenas', e.target.value)}
                      />
                    </td>
                    <td style={{ color: COLOR_ESTADO[est] }}>{ETIQUETA_ESTADO[est]}</td>
                    <td>
                      <input
                        type="text"
                        placeholder="opcional"
                        value={c.nota ?? ''}
                        onChange={(e) => ponContado(r.ot, 'nota', e.target.value)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <label className="campo" style={{ marginTop: 12, maxWidth: 640 }}>
            <span>Nota de la entrega (opcional)</span>
            <input
              type="text"
              value={notaGeneral}
              onChange={(e) => setNotaGeneral(e.target.value)}
              placeholder="Cajas mojadas, quién la trajo, llegó incompleto..."
            />
          </label>

          <p className="texto-suave">
            Escribe <strong>lo que contaste tú</strong>, no lo que diga el papel. Una vez
            guardada <strong>no se puede editar</strong>: queda con tu nombre y la hora.
            Si te equivocas, registra otra y explícalo en la nota.
          </p>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primario" onClick={onGuardar} disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar recepción'}
            </button>
            <button onClick={() => elegirSalida('')} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </>
      )}

    </div>
  )

  const yaRecibido = (
    <div className="tarjeta">
      <div>
        <h2 style={{ marginBottom: 2 }}>
          Lo que ya recibiste{' '}
          {recepciones.length > 0 && <span className="texto-suave">({recepciones.length})</span>}
        </h2>
        {recepciones.length === 0 ? (
          <p className="texto-suave">
            Todavía no se ha registrado ninguna recepción. En cuanto guardes la
            primera aparece aquí, con su acta.
          </p>
        ) : (
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Folio de salida</th>
                <th>Maquila</th>
                <th>¿Cuadró?</th>
                <th>Qué llegó, por orden de trabajo</th>
                <th>Quién recibió</th>
              </tr>
            </thead>
            <tbody>
              {recepciones.map((r) => (
                <tr key={r.id}>
                  <td>{fecha(r.recibidoEn)}</td>
                  <td>{r.folioInterno || '—'}</td>
                  <td>{r.maquilaNombre || nombreMaquila(r.maquilaId)}</td>
                  <td style={{ color: r.cuadro ? '#16a34a' : '#dc2626' }}>
                    {r.cuadro
                      ? 'Sí, todo completo'
                      : `No — ${r.renglonesConProblema} ${
                          r.renglonesConProblema === 1 ? 'orden' : 'órdenes'
                        }`}
                  </td>
                  {/* El detalle que Valeria pidio el 03-09: sin abrir el acta,
                      ver de cada OT cuanto salio, cuanto llego y que paso. */}
                  <td style={{ fontSize: 13 }}>
                    {(r.renglones || []).map((g, i) => (
                      <div key={i} style={{ marginBottom: 4, color: COLOR_ESTADO[g.estado] || '#0f172a' }}>
                        <strong>{g.ot || SIN_OT}</strong>
                        {g.descripcion ? <span className="texto-suave"> · {g.descripcion}</span> : null}
                        {' · '}
                        {g.docenasRecibidas == null
                          ? `sin contar (salieron ${g.docenasEnviadas} doc)`
                          : `${g.docenasRecibidas} de ${g.docenasEnviadas} doc`}
                        {' · '}
                        {ETIQUETA_ESTADO[g.estado] || g.estado}
                        {g.estado === 'faltante' && ` (faltaron ${g.docenasEnviadas - g.docenasRecibidas})`}
                        {g.estado === 'sobrante' && ` (de más ${g.docenasRecibidas - g.docenasEnviadas})`}
                        {g.nota ? <span className="texto-suave"> — {g.nota}</span> : null}
                      </div>
                    ))}
                    {r.nota ? <div className="texto-suave">Nota: {r.nota}</div> : null}
                  </td>
                  <td>{r.recibidoPorNombre || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )

  const enMaquilas = (
    <div className="tarjeta">
      <div>
        <h2 style={{ marginBottom: 2 }}>Lo que las maquilas tienen en sus manos</h2>
        <p className="texto-suave" style={{ marginTop: 0 }}>
          Solo como referencia, según las tareas que se les encargaron. Para recibir no
          hace falta que algo aparezca aquí.
        </p>
        {ESTADOS_EN_MAQUILA.map((g) => {
          const lista = tareas.filter((t) => t.estado === g.estado)
          return (
            <div key={g.estado} style={{ marginTop: 10 }}>
              <strong>{g.titulo}</strong>{' '}
              {lista.length > 0 && <span className="texto-suave">({lista.length})</span>}
              {lista.length === 0 ? (
                <p className="texto-suave" style={{ margin: '2px 0' }}>
                  Nada por ahora.
                </p>
              ) : (
                <ul className="texto-suave" style={{ margin: '4px 0' }}>
                  {lista.map((t) => (
                    <li key={`${t.maquilaId || ''}-${t.id}`}>
                      {nombreMaquila(t.maquilaId)} · {t.titulo || 'sin título'}
                      {t.ot ? ` · OT ${t.ot}` : ''} · desde {fecha(t[g.fecha])}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const SECCIONES = [
    { id: 'registrar', label: 'Registrar una entrega', render: () => registrar },
    {
      id: 'recibido',
      label: `Ya recibido${recepciones.length ? ` (${recepciones.length})` : ''}`,
      render: () => yaRecibido
    },
    { id: 'maquilas', label: 'En las maquilas', render: () => enMaquilas }
  ]
  const actual = SECCIONES.find((x) => x.id === seccion) || SECCIONES[0]

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {SECCIONES.map((x) => (
          <button
            key={x.id}
            className={`tab ${actual.id === x.id ? 'activo' : ''}`}
            onClick={() => setSeccion(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>
      {actual.render()}
    </>
  )
}
