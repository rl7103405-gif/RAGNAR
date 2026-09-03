// INVENTARIO DE PRODUCTO TERMINADO — "pendientes de surtir por cliente".
//
// Roberto, 2026-09-03: *"pon el inventario de PT tambien ahi"* (en las pestanas
// de Valeria), y como referencia dejo el reporte de Microsip "Pendientes de
// surtir por cliente": por CLIENTE -> orden de compra -> articulo -> unidades
// que faltan por entregar. Esta pantalla tiene esa misma forma, pero se arma
// sola con lo que RAGNAR ya sabe:
//
//   SOLICITADO   lo que pide el plan maestro de Adrian, por orden de compra
//                (docenas).
//   RECIBIDO     lo que Valeria ya conto de vuelta de las maquilas
//                (recepcionesPT, docenas, sumado por la OT de cada acta).
//   EMBARCADO    lo que ya salio al cliente (entregasPL, en PACKS: es como
//                viene el PL).
//   PENDIENTE    solicitado - embarcado.
//   EN BODEGA    recibido - embarcado: lo que esta fisicamente en PT sin salir.
//
// ⚠️ LAS UNIDADES NO SON LAS MISMAS y aqui no se disimula. El plan y las actas
// de recepcion van en DOCENAS; el PL va en PACKS. Convertir exige saber
// cuantos pares trae el pack ("3PACK", "10PACK"), que sale de la descripcion
// del articulo. Cuando se sabe, se resta y se dice en docenas. Cuando NO se
// sabe, la celda dice "sin equivalencia" y se muestran los packs tal cual, en
// vez de inventar un saldo. Es la misma regla que el balance del Excel del PL,
// y la misma que el papa de Roberto pidio para el PL de Walmart: "una celda
// vacia no es un cero".
//
// Se lee UNA vez el resumen del plan (que viaja en config/planMaestroActivo) y
// se escuchan entregas y recepciones; el detalle por codigo de una orden se
// carga solo al abrirla, porque son 60 ordenes y ~400 lineas.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { mapaOtAOc, normalizarOt, resumenDeOcs, versionActiva } from '../utils/planMaestro'
import {
  armarPlDeLaOc,
  cierreDelRenglon,
  escucharEntregasPL,
  packsPorDocena,
  renglonesDeLaOc
} from '../utils/entregasPL'
import { escucharRecepcionesPT } from '../utils/recepcionPT'
import { porcentajeHonesto } from '../utils/porcentajes'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const doc = (n) => (n == null ? '—' : `${Math.round(n * 100) / 100} doc`)

/**
 * Docenas embarcadas de una lista de entregas, o null si ALGUN renglon no se
 * puede convertir. Un total a medias (sumando solo lo convertible) diria menos
 * de lo que de verdad salio, y el pendiente saldria inflado.
 */
function docenasEmbarcadas(entregas) {
  let total = 0
  for (const e of entregas) {
    for (const r of e.renglones || []) {
      const factor = packsPorDocena(r.articulo)
      if (factor == null) return null
      total += num(r.packs) / factor
    }
  }
  return total
}

export default function PanelInventarioPT() {
  const { esPrueba } = useAuth()
  const [ocs, setOcs] = useState([])
  const [otAOc, setOtAOc] = useState(() => new Map())
  const [entregas, setEntregas] = useState([])
  const [recepciones, setRecepciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(true)
  // La orden abierta y su detalle por codigo (se carga al abrir).
  const [abierta, setAbierta] = useState(null) // { oc, renglones, error }
  const [cargandoOc, setCargandoOc] = useState(false)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    Promise.all([versionActiva().then((v) => resumenDeOcs(v)), mapaOtAOc()])
      .then(([resumen, mapa]) => {
        if (!vivo) return
        setOcs(resumen || [])
        setOtAOc(mapa || new Map())
        setCargando(false)
      })
      .catch((err) => {
        if (!vivo) return
        console.error('[InventarioPT] No se pudo leer el plan:', err)
        setError('No se pudo leer el plan maestro: ' + (err.message || err))
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  useEffect(
    () =>
      escucharEntregasPL(esPrueba, setEntregas, (err) =>
        setError('No se pudieron leer las entregas al cliente: ' + (err.message || err))
      ),
    [esPrueba]
  )
  useEffect(
    () =>
      escucharRecepcionesPT(esPrueba, setRecepciones, (err) =>
        setError('No se pudo leer lo recibido de maquilas: ' + (err.message || err))
      ),
    [esPrueba]
  )

  // Lo recibido de maquilas, sumado por ORDEN DE COMPRA a traves de la OT del
  // acta. Las actas viejas (antes del 2026-09-03) no traen OT por renglon y
  // caen en 'sinOc': se dicen aparte, no se pierden.
  const recibidoPorOc = useMemo(() => {
    const m = new Map()
    let sinOc = 0
    for (const r of recepciones) {
      for (const g of r.renglones || []) {
        if (g.docenasRecibidas == null) continue
        const oc = g.ot ? otAOc.get(normalizarOt(g.ot)) : null
        if (!oc) {
          sinOc += num(g.docenasRecibidas)
          continue
        }
        m.set(oc, (m.get(oc) || 0) + num(g.docenasRecibidas))
      }
    }
    return { porOc: m, sinOc }
  }, [recepciones, otAOc])

  const entregasPorOc = useMemo(() => {
    const m = new Map()
    for (const e of entregas) {
      const lista = m.get(e.oc) || []
      lista.push(e)
      m.set(e.oc, lista)
    }
    return m
  }, [entregas])

  // Una fila por orden de compra, con sus cinco numeros.
  const filas = useMemo(
    () =>
      ocs.map((o) => {
        const deEsta = entregasPorOc.get(o.oc) || []
        const solicitado = o.sinMeta > 0 ? null : num(o.planeado)
        const recibido = recibidoPorOc.porOc.get(o.oc) ?? 0
        const packsEmbarcados = deEsta.reduce((a, e) => a + num(e.totalPacks), 0)
        const embarcado = deEsta.length ? docenasEmbarcadas(deEsta) : 0
        const pendiente =
          solicitado != null && embarcado != null ? Math.max(0, solicitado - embarcado) : null
        const enBodega = embarcado != null ? recibido - embarcado : null
        return {
          ...o,
          cliente: (o.destinos || []).join(' · ') || '(sin destino)',
          solicitado,
          recibido,
          entregas: deEsta.length,
          packsEmbarcados,
          embarcado,
          pendiente,
          enBodega,
          // "Terminada" = ya se embarco todo lo solicitado (o mas).
          cerrada: solicitado != null && embarcado != null && embarcado >= solicitado && solicitado > 0
        }
      }),
    [ocs, entregasPorOc, recibidoPorOc]
  )

  const visibles = useMemo(() => {
    const palabras = busqueda.trim().toUpperCase().split(/\s+/).filter(Boolean)
    return filas
      .filter((f) => !soloPendientes || !f.cerrada)
      .filter((f) => {
        if (!palabras.length) return true
        const texto = `${f.oc} ${f.cliente} ${(f.ots || []).join(' ')}`.toUpperCase()
        return palabras.every((w) => texto.includes(w))
      })
  }, [filas, busqueda, soloPendientes])

  // Agrupado por CLIENTE, como el reporte de Microsip.
  const porCliente = useMemo(() => {
    const m = new Map()
    for (const f of visibles) {
      if (!m.has(f.cliente)) m.set(f.cliente, [])
      m.get(f.cliente).push(f)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
  }, [visibles])

  const totales = useMemo(() => {
    const t = { solicitado: 0, recibido: 0, embarcado: 0, pendiente: 0, sinEquivalencia: 0, sinMeta: 0 }
    for (const f of visibles) {
      if (f.solicitado == null) t.sinMeta += 1
      else t.solicitado += f.solicitado
      t.recibido += f.recibido
      if (f.embarcado == null) t.sinEquivalencia += 1
      else t.embarcado += f.embarcado
      if (f.pendiente != null) t.pendiente += f.pendiente
    }
    return t
  }, [visibles])

  const abrir = async (oc) => {
    if (abierta?.oc === oc) {
      setAbierta(null)
      return
    }
    setCargandoOc(true)
    try {
      const plan = await renglonesDeLaOc(oc)
      const pl = armarPlDeLaOc(entregasPorOc.get(oc) || [])
      const entregadoPorCodigo = new Map(pl.renglones.map((r) => [r.codigoQuini, r.packsTotal]))
      const renglones = plan.map((r) => {
        const dadas = entregadoPorCodigo.get(r.codigo) || 0
        return { ...r, dadas, cierre: cierreDelRenglon(r.packsPlan, dadas) }
      })
      setAbierta({ oc, renglones, error: '' })
    } catch (err) {
      setAbierta({ oc, renglones: [], error: err.message || String(err) })
    } finally {
      setCargandoOc(false)
    }
  }

  return (
    <div className="tarjeta">
      <h2>Inventario de producto terminado</h2>
      <p className="texto-suave">
        Lo que falta por surtir a cada cliente, por orden de compra: lo que pide el plan, lo que ya
        volvió de las maquilas y lo que ya se embarcó. Pica una orden para ver el detalle por código.
      </p>

      {error && <div className="alerta-error">{error}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por cliente, orden de compra u OT"
          style={{ flex: '1 1 260px', maxWidth: 420, padding: '7px 10px' }}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(e) => setSoloPendientes(e.target.checked)}
          />
          Solo las que todavía deben algo
        </label>
      </div>

      {cargando ? (
        <p className="texto-suave">Leyendo el plan...</p>
      ) : ocs.length === 0 ? (
        <p className="texto-suave">El plan vigente no trae órdenes de compra.</p>
      ) : (
        <>
          {/* El resumen arriba, como el "Total" del reporte de Microsip. */}
          <div
            style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              padding: '10px 14px',
              background: '#f5f7fa',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13
            }}
          >
            <span>
              <strong>{visibles.length}</strong> órdenes de compra
            </span>
            <span>
              Solicitado <strong>{doc(totales.solicitado)}</strong>
              {totales.sinMeta > 0 && (
                <span className="texto-suave"> (+{totales.sinMeta} sin meta)</span>
              )}
            </span>
            <span>
              Recibido de maquilas <strong>{doc(totales.recibido)}</strong>
            </span>
            <span>
              Embarcado <strong>{doc(totales.embarcado)}</strong>
              {totales.sinEquivalencia > 0 && (
                <span className="texto-suave"> (+{totales.sinEquivalencia} sin equivalencia)</span>
              )}
            </span>
            <span>
              Pendiente de surtir <strong style={{ color: '#a52218' }}>{doc(totales.pendiente)}</strong>
            </span>
          </div>

          {recibidoPorOc.sinOc > 0 && (
            <p className="texto-suave" style={{ fontSize: 12 }}>
              {doc(recibidoPorOc.sinOc)} recibidas de maquilas no se pudieron atribuir a una orden
              de compra (actas sin orden de trabajo, o cuya OT no está en el plan). Están contadas
              aparte, no perdidas.
            </p>
          )}

          {porCliente.length === 0 && (
            <p className="texto-suave">Nada coincide. Quita el filtro o afina la búsqueda.</p>
          )}

          {porCliente.map(([cliente, lista]) => (
            <div key={cliente} style={{ marginTop: 16 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{cliente}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Orden de compra</th>
                      <th style={{ textAlign: 'right' }}>Solicitado</th>
                      <th style={{ textAlign: 'right' }}>Recibido de maquilas</th>
                      <th style={{ textAlign: 'right' }}>Embarcado</th>
                      <th style={{ textAlign: 'right' }}>Pendiente de surtir</th>
                      <th style={{ textAlign: 'right' }}>En bodega</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((f) => {
                      const activa = abierta?.oc === f.oc
                      return (
                        <tr key={f.oc} style={activa ? { background: '#eef2f7' } : undefined}>
                          <td>
                            <strong>{f.oc}</strong>
                            <div className="texto-suave" style={{ fontSize: 12 }}>
                              {f.totalOts ?? (f.ots || []).length} OT · {f.entregas}{' '}
                              {f.entregas === 1 ? 'entrega' : 'entregas'}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {f.solicitado == null ? (
                              <span className="texto-suave" title="Alguna línea del plan no trae cantidad">
                                sin meta
                              </span>
                            ) : (
                              doc(f.solicitado)
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>{doc(f.recibido)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {f.embarcado == null ? (
                              <span
                                className="texto-suave"
                                title="El PL va en packs y no se sabe cuántos pares trae el pack de algún artículo: no se puede pasar a docenas"
                              >
                                {f.packsEmbarcados} packs · sin equivalencia
                              </span>
                            ) : (
                              <>
                                {doc(f.embarcado)}
                                {f.packsEmbarcados > 0 && (
                                  <div className="texto-suave" style={{ fontSize: 11 }}>
                                    {f.packsEmbarcados} packs
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: f.pendiente ? '#a52218' : '#16a34a' }}>
                            {f.pendiente == null ? <span className="texto-suave">—</span> : doc(f.pendiente)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {f.enBodega == null ? (
                              <span className="texto-suave">—</span>
                            ) : (
                              <span
                                style={{ color: f.enBodega < 0 ? '#a52218' : undefined }}
                                title={
                                  f.enBodega < 0
                                    ? 'Se embarcó más de lo que se registró como recibido de maquilas: revisar las actas de recepción'
                                    : undefined
                                }
                              >
                                {doc(f.enBodega)}
                              </span>
                            )}
                          </td>
                          <td>
                            <button className="btn-secundario" onClick={() => abrir(f.oc)} disabled={cargandoOc}>
                              {activa ? 'Cerrar' : 'Detalle'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {abierta && lista.some((f) => f.oc === abierta.oc) && (
                <div style={{ margin: '8px 0 4px 12px', padding: '10px 12px', background: '#fafbfc', borderRadius: 8 }}>
                  <strong>Orden {abierta.oc}, por código</strong>
                  {abierta.error ? (
                    <p className="alerta-error" style={{ marginTop: 8 }}>{abierta.error}</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="tabla-datos" style={{ marginTop: 8 }}>
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Artículo</th>
                            <th>OT</th>
                            <th style={{ textAlign: 'right' }}>Solicitado</th>
                            <th style={{ textAlign: 'right' }}>Entregado</th>
                            <th style={{ textAlign: 'right' }}>Pendiente</th>
                            <th style={{ textAlign: 'right' }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {abierta.renglones.map((r) => (
                            <tr key={r.codigo}>
                              <td><strong>{r.codigo}</strong></td>
                              <td>{r.descripcion || '—'}</td>
                              <td>{r.ot || '—'}</td>
                              <td style={{ textAlign: 'right' }}>
                                {r.cantidadPlan} doc
                                {r.packsPlan != null && (
                                  <div className="texto-suave" style={{ fontSize: 11 }}>= {r.packsPlan} packs</div>
                                )}
                              </td>
                              <td style={{ textAlign: 'right' }}>{r.dadas} packs</td>
                              <td style={{ textAlign: 'right' }}>
                                {r.cierre.sinEquivalencia ? (
                                  <span className="texto-suave" title="No se sabe cuántos pares trae el pack">
                                    sin equivalencia
                                  </span>
                                ) : (
                                  `${r.cierre.pendientes} packs`
                                )}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {/* cierreDelRenglon da una FRACCION (0..1); porcentajeHonesto
                                    espera 0..100. Sin el x100 un 30% se pintaba como "0.3%". */}
                                {r.cierre.porcentaje == null ? '—' : porcentajeHonesto(r.cierre.porcentaje * 100)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <p className="texto-suave" style={{ fontSize: 12, marginTop: 14 }}>
            El plan y lo recibido van en <strong>docenas</strong>; el PL va en <strong>packs</strong>.
            Se pasa a docenas solo cuando la descripción del artículo dice cuántos pares trae el pack
            (3PACK, 10PACK...). Donde no se sabe, se dice "sin equivalencia" en vez de inventar el
            saldo.
          </p>
        </>
      )}
    </div>
  )
}
