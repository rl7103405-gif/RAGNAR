// EL ARBOL que pidio Lindbergh en la junta del 17-08.
//
// Textual suyo: "orden de compra 24-49, llevas un avance de 92%... vete al
// historial... son todas estas: 100, 100, 100, 85, 0 y 93. Abro la que me
// interesa ver y necesito todos sus componentes. Ese es un arbol".
//
//   Orden de compra  ->  ordenes de trabajo  ->  codigos (planeado vs hecho)
//
// El nivel de cada quien (tambien de la junta): America trabaja en folio+OT,
// Lindbergh en OT+OC, y el dueno solo OC — "su labor no debe estar en los
// folios". Por eso esta pantalla arranca en la orden de compra y el folio ni
// siquiera aparece: quien necesita folios los tiene en Captura e Historial.
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { lineasDeOc, resumenDeOcs, versionActiva } from '../utils/planMaestro'
import { armarArbolDeOc, esEnDocenas } from '../utils/arbolOrdenes'

const pct = (v) => (v === null ? '—' : `${v.toFixed(0)}%`)

/** Verde cuando va bien, ambar a medias, rojo cuando no ha arrancado. */
function colorDe(porcentaje) {
  if (porcentaje === null) return '#94a3b8'
  if (porcentaje >= 99) return '#16a34a'
  if (porcentaje >= 50) return '#d97706'
  return '#dc2626'
}

function Barra({ porcentaje }) {
  return (
    <div style={{ background: '#e5e7eb', borderRadius: 999, height: 8, width: 120, overflow: 'hidden' }}>
      <div
        style={{
          width: `${porcentaje === null ? 0 : Math.max(2, porcentaje)}%`,
          height: '100%',
          background: colorDe(porcentaje)
        }}
      />
    </div>
  )
}

export default function PanelArbolOrdenes() {
  const { esInterno, esPrueba } = useAuth()
  const [version, setVersion] = useState(null)
  const [ocs, setOcs] = useState([])
  const [abierta, setAbierta] = useState(null) // { oc, arbol }
  const [otAbierta, setOtAbierta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [cargandoOc, setCargandoOc] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    versionActiva()
      .then(async (v) => {
        if (cancelado) return
        setVersion(v)
        if (v) setOcs(await resumenDeOcs(v))
      })
      .catch((err) => {
        console.error('[Arbol] Error cargando el plan:', err)
        if (!cancelado) setError('No se pudo cargar el plan maestro: ' + (err.message || err))
      })
      .finally(() => !cancelado && setCargando(false))
    return () => {
      cancelado = true
    }
  }, [])

  const abrirOc = async (oc) => {
    if (abierta?.oc === oc) {
      setAbierta(null)
      return
    }
    setError('')
    setCargandoOc(true)
    setOtAbierta(null)
    try {
      const lineasDelPlan = await lineasDeOc(version, oc)
      const arbol = await armarArbolDeOc({ lineasDelPlan, esPrueba })
      setAbierta({ oc, arbol })
    } catch (err) {
      console.error('[Arbol] Error armando la orden de compra:', err)
      setError('No se pudo armar el arbol: ' + (err.message || err))
    } finally {
      setCargandoOc(false)
    }
  }

  if (!esInterno) return null

  if (cargando) {
    return (
      <div className="tarjeta">
        <h2>Ordenes de compra</h2>
        <p className="texto-suave">Cargando...</p>
      </div>
    )
  }

  // Sin plan maestro no hay arbol. Se dice por que y quien lo sube, en vez de
  // ensenar una pantalla vacia que parece un error de la app.
  if (!version) {
    return (
      <div className="tarjeta">
        <h2>Ordenes de compra</h2>
        <p className="texto-suave">
          Todavia no hay plan maestro cargado. Es el archivo que dice que ordenes de trabajo cuelgan
          de cada orden de compra, y lo sube <strong>Adrian</strong> desde su pestana de produccion.
          En cuanto lo suba, aqui aparece el avance agrupado.
        </p>
      </div>
    )
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="tarjeta">
        <h2>Ordenes de compra ({ocs.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Cada orden de compra del cliente con sus ordenes de trabajo. Pica una para ver como va y
          abrir sus componentes.
        </p>

        {ocs.length === 0 && <p className="texto-suave">El plan vigente no trae ninguna orden.</p>}

        {ocs.map((o) => {
          const activa = abierta?.oc === o.oc
          const arbol = activa ? abierta.arbol : null
          return (
            <div
              key={o.oc}
              style={{
                border: '1px solid #d8dee6',
                borderRadius: 8,
                marginBottom: 10,
                background: '#fff'
              }}
            >
              <button
                onClick={() => abrirOc(o.oc)}
                style={{
                  width: '100%',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'center',
                  padding: '12px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <strong style={{ fontSize: 16 }}>{o.oc}</strong>
                {/* A QUIEN VA. Lo pidio Roberto el 18-08: la orden sin cliente
                    es un numero que no dice nada. Sale del plan de Adrian
                    (columna 'Nom ped'); si una OC junta varios destinos se
                    muestran todos. */}
                {(o.destinos || []).map((d) => (
                  <span
                    key={d}
                    style={{ fontSize: 12, background: '#ecfdf5', color: '#065f46', borderRadius: 999, padding: '2px 10px' }}
                  >
                    {d}
                  </span>
                ))}
                {o.cliente && (
                  <span className="texto-suave" style={{ fontSize: 13 }}>{o.cliente}</span>
                )}
                <span className="texto-suave" style={{ fontSize: 13 }}>
                  {/* El total real, no el largo del array: 'ots' viene topado
                      para que el resumen quepa en un documento de Firestore. */}
                  {o.totalOts ?? o.ots.length} ordenes de trabajo
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                  {arbol && (
                    <>
                      <span className="texto-suave" style={{ fontSize: 11 }}>hecho</span>
                      <Barra porcentaje={arbol.total.porcentaje} />
                      <strong style={{ color: colorDe(arbol.total.porcentaje), minWidth: 44, textAlign: 'right' }}>
                        {pct(arbol.total.porcentaje)}
                      </strong>
                      <span
                        style={{ fontSize: 12, minWidth: 96, textAlign: 'right', color: '#1e40af' }}
                        title={
                          arbol.totalEnvio?.porcentaje === null
                            ? 'No se puede sacar el % de lo mandado: las tareas se encargaron en packs y el plan va en docenas.'
                            : `${(arbol.totalEnvio?.enviado || 0).toFixed(0)} de ${(arbol.totalEnvio?.planeado || 0).toFixed(0)} docenas mandadas a maquila`
                        }
                      >
                        mandado {pct(arbol.totalEnvio?.porcentaje)}
                      </span>
                    </>
                  )}
                  <span className="texto-suave">{activa ? '▲' : '▼'}</span>
                </span>
              </button>

              {activa && cargandoOc && (
                <p className="texto-suave" style={{ padding: '0 14px 12px' }}>Calculando el avance...</p>
              )}

              {activa && arbol && !cargandoOc && (
                <div style={{ padding: '0 14px 12px' }}>
                  {/* 'Sin cantidades' (hueco de datos) y 'meta total 0' (dato
                      real) no son lo mismo, aunque las dos den porcentaje
                      null: la primera es que el plan no dice cuanto, la
                      segunda es que el plan SI dijo, y dijo cero. lineasSinMeta
                      es lo que distingue una de la otra. */}
                  {arbol.total.porcentaje === null && arbol.total.lineasSinMeta > 0 && (
                    <p className="texto-suave" style={{ fontSize: 13 }}>
                      El plan no trae cantidades para esta orden, asi que no se puede medir avance.
                      Se ven igual sus ordenes de trabajo.
                    </p>
                  )}

                  {arbol.total.porcentaje === null
                    && arbol.total.lineasSinMeta === 0
                    && arbol.otsExcluidasDelTotal < arbol.ramas.length && (
                    <p className="texto-suave" style={{ fontSize: 13 }}>
                      La meta total de esta orden es 0 (caso rarisimo, pero real: todas sus lineas
                      traen cantidad planeada 0). No es un hueco de datos.
                    </p>
                  )}

                  {arbol.otsExcluidasDelTotal > 0 && (
                    <p className="texto-suave" style={{ fontSize: 12 }}>
                      El % de <strong>hecho</strong> se calculo sobre las OT con folios
                      encontrados; {arbol.otsExcluidasDelTotal} orden
                      {arbol.otsExcluidasDelTotal === 1 ? '' : 'es'} sin datos no entra
                      {arbol.otsExcluidasDelTotal === 1 ? '' : 'n'} al numero. El de{' '}
                      <strong>mandado</strong> si las incluye: lo que se encarga a una maquila no
                      depende de que el rastro de la captura siga vivo.
                    </p>
                  )}

                  {/* Si no se pudieron leer las tareas de una maquila, la
                      columna "Ya en maquila" sale corta y parece que no se ha
                      encargado nada. Se dice, en vez de dejar creer un cero. */}
                  {arbol.maquilasNoLeidas?.length > 0 && (
                    <p style={{ fontSize: 12, color: '#b45309' }}>
                      {arbol.enviosSinPermiso
                        ? 'Tu cuenta no tiene permiso para ver lo que se encargo a las maquilas, asi que la columna "Ya en maquila" sale vacia. No quiere decir que no se haya mandado nada.'
                        : `No se pudieron leer las tareas de ${arbol.maquilasNoLeidas.join(', ')}: la columna "Ya en maquila" puede estar incompleta.`}
                    </p>
                  )}

                  {arbol.ramas.map((r) => {
                    const abiertaOt = otAbierta === r.ot
                    return (
                      <div key={r.ot} style={{ borderTop: '1px solid #eef2f7', padding: '8px 0' }}>
                        <button
                          onClick={() => setOtAbierta(abiertaOt ? null : r.ot)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            gap: 12,
                            alignItems: 'center',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            textAlign: 'left',
                            padding: 0
                          }}
                        >
                          <span style={{ minWidth: 90 }}>OT {r.ot}</span>
                          {r.destino && (
                            <span className="texto-suave" style={{ fontSize: 12 }}>{r.destino}</span>
                          )}
                          <span className="texto-suave" style={{ fontSize: 12 }}>
                            {r.folios} folios
                          </span>
                          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                            {/* Dos numeros distintos, etiquetados: "hecho" es
                                produccion capturada, "mandado" es lo que ya
                                salio a ensamblar. Sin etiqueta, dos
                                porcentajes juntos se confunden. */}
                            <span className="texto-suave" style={{ fontSize: 11 }}>hecho</span>
                            <Barra porcentaje={r.porcentaje} />
                            <strong style={{ color: colorDe(r.porcentaje), minWidth: 44, textAlign: 'right' }}>
                              {pct(r.porcentaje)}
                            </strong>
                            <span
                              style={{ fontSize: 12, minWidth: 96, textAlign: 'right', color: '#1e40af' }}
                              title={
                                r.envio?.porcentaje === null
                                  ? 'No se puede sacar el % de lo mandado: las tareas se encargaron en packs y el plan va en docenas.'
                                  : `${(r.envio?.enviado || 0).toFixed(0)} de ${(r.envio?.planeado || 0).toFixed(0)} docenas mandadas; faltan ${(r.envio?.faltaPorMandar ?? 0).toFixed(0)}`
                              }
                            >
                              mandado {pct(r.envio?.porcentaje)}
                            </span>
                            <span className="texto-suave">{abiertaOt ? '▲' : '▼'}</span>
                          </span>
                        </button>

                        {abiertaOt && (
                          <table style={{ width: '100%', marginTop: 8, fontSize: 13 }}>
                            <thead>
                              <tr className="texto-suave">
                                <th style={{ textAlign: 'left' }}>Codigo</th>
                                <th style={{ textAlign: 'right' }}>Piden</th>
                                <th style={{ textAlign: 'right' }}>Hecho</th>
                                <th style={{ textAlign: 'right' }}>Falta</th>
                                {/* El tercer estado que pidio el papa de Roberto:
                                    de lo hecho, cuanto ya salio a ensamblar. Va
                                    en su propia unidad (packs) y separado por una
                                    linea, porque NO se resta de las docenas. */}
                                <th
                                  style={{ textAlign: 'right', borderLeft: '1px solid #e5e7eb', paddingLeft: 8 }}
                                  title="Lo que ya se encargo a una maquila, acumulado (incluye tareas ya terminadas). Va en la unidad con la que se pidio la tarea, casi siempre packs, y por eso NO se resta de las columnas de la izquierda, que van en docenas."
                                >
                                  Ya en maquila
                                </th>
                                <th
                                  style={{ textAlign: 'right' }}
                                  title="Cuanto de lo que piden falta por mandar a ensamblar. Solo sale cuando la tarea se encargo en docenas, la misma unidad del plan."
                                >
                                  Falta mandar
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.lineas.map((l) => {
                                // ⚠️ Sin meta NO hay 'falta'. Antes esto hacia
                                // (cantidadPlaneada || 0) - producido, o sea que
                                // una linea sin meta daba falta 0 y se pintaba
                                // con el ✓ verde: exactamente igual que una
                                // terminada. Un renglon del que no sabemos nada
                                // no se puede ver como uno cumplido.
                                const conMeta = typeof l.cantidadPlaneada === 'number'
                                const falta = conMeta
                                  ? Math.max(0, l.cantidadPlaneada - (l.producido || 0))
                                  : null
                                return (
                                  <tr key={`${l.ot}_${l.codigo}`}>
                                    <td>{l.codigo || <em className="texto-suave">sin codigo</em>}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      {conMeta ? l.cantidadPlaneada : <span title="El Excel no traia cantidad para este renglon">—</span>}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>{(l.producido || 0).toFixed(0)}</td>
                                    <td
                                      style={{
                                        textAlign: 'right',
                                        color: !conMeta ? '#94a3b8' : falta > 0 ? '#dc2626' : '#16a34a'
                                      }}
                                    >
                                      {!conMeta ? (
                                        <span title="Sin meta en el plan: no se puede saber cuanto falta">
                                          sin meta
                                        </span>
                                      ) : falta > 0 ? (
                                        falta.toFixed(0)
                                      ) : (
                                        '✓'
                                      )}
                                    </td>
                                    <td
                                      style={{
                                        textAlign: 'right',
                                        borderLeft: '1px solid #e5e7eb',
                                        paddingLeft: 8,
                                        color: l.enviado?.length ? '#1e40af' : '#94a3b8'
                                      }}
                                      title={
                                        l.enviado?.length
                                          ? l.enviado
                                              .map((e) => `${e.cantidad} ${e.unidad}: ${e.maquilas.join(', ')}`)
                                              .join(' | ')
                                          : 'Todavia no se encarga a ninguna maquila'
                                      }
                                    >
                                      {/* Cada unidad en su propio renglon: packs
                                          y docenas no se suman entre si. */}
                                      {l.enviado?.length
                                        ? l.enviado.map((e) => (
                                            <div key={e.unidad}>
                                              {e.cantidad.toFixed(0)} {e.unidad}
                                            </div>
                                          ))
                                        : '—'}
                                    </td>
                                    {(() => {
                                      // Solo lo encargado en DOCENAS resta del
                                      // plan; lo pedido en packs no se puede
                                      // restar y se dice, en vez de fingir que
                                      // no se ha mandado nada.
                                      // La MISMA funcion que usa el porcentaje
                                      // de arriba: dos copias de esta lista se
                                      // desincronizan y el detalle empieza a
                                      // contradecir al encabezado sin avisar.
                                      const enDoc = (l.enviado || []).filter((e) =>
                                        esEnDocenas(e.unidad)
                                      )
                                      const otras = (l.enviado || []).length - enDoc.length
                                      if (!conMeta) {
                                        return <td style={{ textAlign: 'right', color: '#94a3b8' }}>—</td>
                                      }
                                      if (otras > 0 && !enDoc.length) {
                                        return (
                                          <td
                                            style={{ textAlign: 'right', color: '#94a3b8' }}
                                            title="Se encargo en packs: no se puede restar de las docenas del plan."
                                          >
                                            n/d
                                          </td>
                                        )
                                      }
                                      const mandado = enDoc.reduce((a, e) => a + e.cantidad, 0)
                                      const faltaMandar = Math.max(0, l.cantidadPlaneada - mandado)
                                      return (
                                        <td
                                          style={{
                                            textAlign: 'right',
                                            color: faltaMandar > 0 ? '#b45309' : '#16a34a'
                                          }}
                                        >
                                          {faltaMandar > 0 ? faltaMandar.toFixed(0) : '✓'}
                                        </td>
                                      )
                                    })()}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}

                  {/* Si la consulta por el campo congelado fallo, lo unico que
                      se esta viendo es lo que alcanza el ruteo: 15 dias. Los
                      numeros se verian completos estando cortados, y eso es
                      justo lo que no puede pasar sin avisar. */}
                  {arbol.soloRuteo && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: '10px 12px',
                        borderRadius: 6,
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        fontSize: 13
                      }}
                    >
                      <strong>Estos numeros pueden estar incompletos.</strong> No se pudo consultar
                      por la orden de trabajo guardada en el bulto, asi que solo se esta viendo lo
                      que sigue en el ruteo (los ultimos 15 dias). Avisale a Beto: falta un indice en
                      la base.
                    </div>
                  )}

                  {/* OT del plan sin UN SOLO folio. Es la señal que separa
                      "no se ha producido" de "ya se produjo pero el rastro se
                      purgo": el ruteo se borra a los 15 dias y una orden de
                      compra tarda semanas. Sin este aviso, las dos cosas se
                      ven identicas: 0%. */}
                  {arbol.otsSinProduccion.length > 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        fontSize: 13
                      }}
                    >
                      <strong>
                        {arbol.otsSinProduccion.length} ordenes de trabajo sin ningun folio:
                      </strong>{' '}
                      {arbol.otsSinProduccion.slice(0, 12).join(', ')}
                      {arbol.otsSinProduccion.length > 12 && ` y ${arbol.otsSinProduccion.length - 12} mas`}
                      <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
                        O todavia no se producen, o se produjeron hace mas de 15 dias y ya salieron
                        del ruteo. Los bultos capturados desde el 17-08 se encuentran siempre.
                      </div>
                    </div>
                  )}

                  {/* Lo que no cuadra. Es la mitad util cuando algo falla: un
                      arbol que lo esconde pasa por completo estando incompleto. */}
                  {arbol.fueraDelPlan.length > 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        fontSize: 13
                      }}
                    >
                      <strong>Se produjo esto y el plan no lo menciona:</strong>
                      <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
                        O el plan esta incompleto, o se capturo contra una orden de trabajo que no
                        tocaba.
                      </div>
                      {arbol.fueraDelPlan.slice(0, 10).map((f) => (
                        <div key={`${f.ot}_${f.codigo}`}>
                          OT {f.ot} · {f.codigo || '(sin codigo)'} · {f.docenas.toFixed(0)} docenas
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
