// AVANCE DE LO ENCARGADO A LAS MAQUILAS.
//
// Roberto, 2026-09-10: "me gustaria tener un apartado en las maquilas de
// tareas encargadas, e ir viendo el avance como lo tenemos en las tareas de
// America". El calculo vive en utils/avanceTareasEnsamble.js (funcion pura,
// probada aparte); esta pantalla solo escucha los datos y los pinta.
//
// Se escucha IGUAL que PanelTareasMaquila: maquila por maquila, con la lista
// de useMaquilas(). Asi se respeta el corral de pruebas de las reglas sin
// repetir la logica aqui.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { escucharTareasEnsambleDeVarias } from '../utils/tareasEnsamble'
import { escucharRecepcionesPT } from '../utils/recepcionPT'
import { avanceDeTareasEnsamble } from '../utils/avanceTareasEnsamble'

const COLOR_ETAPA = {
  preparando: { fondo: '#f1f5f9', texto: '#475569' },
  abierta: { fondo: '#fef3c7', texto: '#92400e' },
  iniciada: { fondo: '#dbeafe', texto: '#1e40af' },
  declarada: { fondo: '#ede9fe', texto: '#5b21b6' },
  terminada: { fondo: '#dcfce7', texto: '#166534' }
}

function Barra({ porcentaje }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <span style={{ background: '#e5e7eb', borderRadius: 999, height: 8, width: 100, overflow: 'hidden', display: 'inline-block' }}>
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${porcentaje === null ? 0 : Math.max(2, porcentaje)}%`,
            background: porcentaje === null ? '#94a3b8' : porcentaje >= 99 ? '#16a34a' : porcentaje >= 50 ? '#d97706' : '#dc2626'
          }}
        />
      </span>
      <strong style={{ minWidth: 40, textAlign: 'right', fontSize: 13 }}>
        {porcentaje === null ? '—' : `${porcentaje.toFixed(0)}%`}
      </strong>
    </span>
  )
}

function fechaCorta(texto) {
  if (!texto) return ''
  const [a, m, d] = String(texto).split('-')
  return d && m ? `${d}/${m}/${String(a).slice(2)}` : texto
}

export default function PanelAvanceMaquilas() {
  const { esPrueba } = useAuth()
  const maquilas = useMaquilas()
  const [tareas, setTareas] = useState(null)
  const [recepciones, setRecepciones] = useState(null)
  const [errorTareas, setErrorTareas] = useState('')
  const [errorRecepciones, setErrorRecepciones] = useState('')
  const [verTerminadas, setVerTerminadas] = useState(false)

  const idsMaquilas = maquilas.map((m) => m.id).join(',')
  useEffect(() => {
    const ids = idsMaquilas ? idsMaquilas.split(',') : []
    setErrorTareas('')
    setTareas(null)
    return escucharTareasEnsambleDeVarias(
      ids,
      // El error NO se limpia cuando llega otra maquila: se escucha maquila por
      // maquila, y si una falla y otra responde, el total quedaria incompleto
      // sin aviso.
      (lista) => setTareas(lista),
      (err) => {
        console.error('[PanelAvanceMaquilas] tareas:', err)
        setErrorTareas('No se pudieron leer las tareas encargadas. Si sigue, avísale a Roberto.')
      }
    )
  }, [idsMaquilas])

  useEffect(() => {
    setErrorRecepciones('')
    return escucharRecepcionesPT(
      esPrueba,
      (lista) => {
        setRecepciones(lista)
        setErrorRecepciones('')
      },
      (err) => {
        // Sin recepciones la etapa sigue sirviendo; las docenas se marcan como
        // no disponibles (nunca como cero, que se leeria "no ha llegado nada").
        console.error('[PanelAvanceMaquilas] recepciones:', err)
        setErrorRecepciones('No se pudo leer lo recibido por Producto Terminado: las docenas no están disponibles por ahora.')
      }
    )
  }, [esPrueba])

  const docenasDisponibles = recepciones !== null && !errorRecepciones
  const avance = useMemo(
    () => avanceDeTareasEnsamble(tareas || [], docenasDisponibles ? recepciones : []),
    [tareas, recepciones, docenasDisponibles]
  )
  const nombre = (id) => maquilas.find((m) => m.id === id)?.nombre || id
  const { resumen } = avance

  if (tareas === null) {
    // Sin ninguna lectura buena no se pintan tiles: saldrian ceros falsos.
    return errorTareas ? (
      <p className="alerta-error">{errorTareas}</p>
    ) : (
      <div className="tarjeta texto-suave">Cargando lo encargado a las maquilas…</div>
    )
  }
  const textoDocenas = errorRecepciones ? 'no disponible' : 'cargando…'

  const tiles = [
    { t: 'Tareas vivas', v: resumen.vivas },
    { t: 'Por publicar', v: resumen.porPublicar },
    { t: 'Sin empezar', v: resumen.sinEmpezar, tono: resumen.sinEmpezar ? 'aviso' : '' },
    { t: 'En proceso', v: resumen.enProceso },
    { t: 'Por confirmar', v: resumen.porConfirmar, tono: resumen.porConfirmar ? 'aviso' : '' },
    { t: 'Atrasadas', v: resumen.atrasadas, tono: resumen.atrasadas ? 'aviso' : '' },
    {
      t: 'Docenas recibidas',
      v: !docenasDisponibles ? '—' : resumen.meta ? `${resumen.recibidas} de ${resumen.meta}` : '—'
    }
  ]

  return (
    <div>
      <div className="tarjeta">
        <h3 style={{ margin: 0 }}>Avance de lo encargado</h3>
        <p className="texto-suave" style={{ margin: '4px 0 12px', fontSize: 13 }}>
          Dos lecturas del mismo avance. La <strong>etapa</strong> es lo que dice la maquila en su portal. Las{' '}
          <strong>docenas</strong> son lo que Producto Terminado ya recibió de vuelta de esa maquila para esa OT: si
          Valeria todavía no lo recibe, sale en cero aunque la maquila vaya adelantada. Solo se miden las tareas con OT y
          pedidas en docenas.
        </p>
        <div className="tp-tiles">
          {tiles.map((x) => (
            <div key={x.t} className={`tp-tile ${x.tono ? 'tp-tile-' + x.tono : ''}`}>
              <div className="tp-tile-valor">{x.v}</div>
              <div className="tp-tile-titulo">{x.t}</div>
            </div>
          ))}
        </div>
        {resumen.fueraDelCalculo > 0 && (
          <p className="texto-suave" style={{ margin: '8px 0 0', fontSize: 12 }}>
            {resumen.fueraDelCalculo} {resumen.fueraDelCalculo === 1 ? 'tarea viva no entra' : 'tareas vivas no entran'} en
            las docenas (sin OT o no pedidas en docenas).
          </p>
        )}
        <label className="texto-suave" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" checked={verTerminadas} onChange={(e) => setVerTerminadas(e.target.checked)} />
          Mostrar también las terminadas
        </label>
      </div>

      {errorTareas && <p className="alerta-error">{errorTareas}</p>}
      {errorRecepciones && <p className="alerta-error">{errorRecepciones}</p>}

      {avance.maquilas.length === 0 ? (
        !errorTareas && (
          <div className="tarjeta tp-vacio">
            <div className="tp-vacio-titulo">Todavía no hay tareas encargadas</div>
            <div className="texto-suave">Cuando se encargue una en "Encargar a la maquila", aparece aquí con su avance.</div>
          </div>
        )
      ) : (
        avance.maquilas.map((m) => {
          const lista = verTerminadas ? m.tareas : m.tareas.filter((t) => t.viva)
          if (!lista.length) return null
          return (
            <details key={m.maquilaId} className="tarjeta tp-cuadro" open>
              <summary className="tp-cuadro-cab" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ fontSize: 16 }}>{nombre(m.maquilaId)}</strong>
                <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
                  {m.vivas} {m.vivas === 1 ? 'viva' : 'vivas'}
                  {m.atrasadas ? ` · ${m.atrasadas} ${m.atrasadas === 1 ? 'atrasada' : 'atrasadas'}` : ''}
                  {docenasDisponibles && m.meta ? ` · ${m.recibidas} de ${m.meta} docenas` : ''}
                </span>
                {docenasDisponibles && (
                  <span style={{ marginLeft: 'auto' }}><Barra porcentaje={m.porcentaje} /></span>
                )}
              </summary>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Orden</th>
                      <th>Etapa</th>
                      <th>Publicada hace</th>
                      <th>Para cuándo</th>
                      <th>Docenas recibidas</th>
                      <th>Avance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((t) => {
                      const color = COLOR_ETAPA[t.estado] || COLOR_ETAPA.preparando
                      return (
                        <tr key={t.id}>
                          <td>
                            <strong>{t.ot ? `OT ${t.ot}` : t.titulo || 'Sin orden'}</strong>
                            {t.destino ? <div className="texto-suave" style={{ fontSize: 12 }}>{t.destino}</div> : null}
                          </td>
                          <td>
                            <span style={{ background: color.fondo, color: color.texto, borderRadius: 999, padding: '2px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>
                              {t.etapa}
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {!t.publicada ? (
                              <span className="texto-suave">sin publicar</span>
                            ) : t.dias === 0 ? (
                              'hoy'
                            ) : (
                              `${t.dias} ${t.dias === 1 ? 'día' : 'días'}`
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {t.fechaRequerida ? (
                              <span style={t.atrasada ? { color: '#b91c1c', fontWeight: 700 } : undefined}>
                                {fechaCorta(t.fechaRequerida)}{t.atrasada ? ' · atrasada' : ''}
                              </span>
                            ) : (
                              <span className="texto-suave">sin fecha</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {!docenasDisponibles ? (
                              <span className="texto-suave">{textoDocenas}</span>
                            ) : t.medible ? (
                              `${t.recibidas} de ${t.meta}`
                            ) : (
                              <span className="texto-suave">no se mide ({t.motivo})</span>
                            )}
                          </td>
                          <td>{docenasDisponibles && t.medible ? <Barra porcentaje={t.porcentaje} /> : null}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )
        })
      )}
    </div>
  )
}
