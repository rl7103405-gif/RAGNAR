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
import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { mapaOtAOc, normalizarOt, resumenDeOcs, versionActiva } from '../utils/planMaestro'
import {
  armarPlDeLaOc,
  cierreDelRenglon,
  escucharEntregasPL,
  renglonesDeLaOc
} from '../utils/entregasPL'
import { escucharRecepcionesPT } from '../utils/recepcionPT'
import { porcentajeHonesto } from '../utils/porcentajes'
import { ErrorPackManual, ROLES_PACK_MANUAL, guardarPackManual, resolverPacksDeCodigos } from '../utils/packsFuentes'
import { NOMBRE_FUENTE, PARES_MAX, PARES_MIN, docenasDePacks, textoPack } from '../utils/packsPorCodigo'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const doc = (n) => (n == null ? '—' : `${Math.round(n * 100) / 100} doc`)
const dosDec = (n) => Math.round(Number(n) * 100) / 100
const codigoDe = (r) => String(r.codigoQuini || r.clave || '').trim().toUpperCase()

/**
 * Docenas embarcadas de una lista de entregas, con el pack VIGENTE de cada
 * codigo (packsPorCodigo.js). docenas null si ALGUN renglon no se puede
 * convertir (pack en conflicto): un total a medias diria menos de lo que de
 * verdad salio, y el pendiente saldria inflado. Los 'supuesto' (suelto, 1 par)
 * si se convierten, pero se cuentan aparte para decirlo.
 */
function docenasEmbarcadas(entregas, packs) {
  let total = 0
  let supuestos = 0
  let conflictos = 0
  for (const e of entregas) {
    for (const r of e.renglones || []) {
      const res = packs.get(codigoDe(r))
      if (!res || res.pares == null) {
        conflictos++
        continue
      }
      if (res.estado === 'supuesto') supuestos++
      total += docenasDePacks(num(r.packs), res.pares)
    }
  }
  return { docenas: conflictos ? null : total, supuestos, conflictos }
}

/** Evidencia de cada fuente, en una linea: "Microsip 3 · pedido del plan 3 · tech pack 6". */
function lineaEvidencias(res) {
  const porFuente = new Map()
  for (const e of res?.evidencias || []) {
    const s = porFuente.get(e.fuente) || new Set()
    s.add(e.pares)
    porFuente.set(e.fuente, s)
  }
  return [...porFuente.entries()].map(([f, s]) => `${NOMBRE_FUENTE[f]} ${[...s].join('/')}`).join(' · ')
}

/**
 * Decidir a mano los pares por pack (Valeria, Cielo). Por defecto se aplica a
 * todos los codigos del MISMO modelo en esta orden: Roberto pidio que fuera
 * "una vez por modelo", y la llave sigue siendo el codigo.
 */
function DecidirPack({ renglon, renglones, esPrueba, usuario, alGuardar, alCancelar }) {
  const hermanos = renglon.modelo ? renglones.filter((x) => x.modelo === renglon.modelo) : [renglon]
  const [pares, setPares] = useState(renglon.pack?.pares != null ? String(renglon.pack.pares) : '')
  const [nota, setNota] = useState('')
  const [todos, setTodos] = useState(hermanos.length > 1)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const guardar = async () => {
    setError('')
    const n = Number(pares)
    if (!Number.isInteger(n) || n < PARES_MIN || n > PARES_MAX) {
      setError(`Escribe cuántos pares trae el pack: un número entero del ${PARES_MIN} al ${PARES_MAX} (1 = suelto).`)
      return
    }
    const lista = todos ? hermanos : [renglon]
    setGuardando(true)
    let hechos = 0
    try {
      for (const r of lista) {
        await guardarPackManual({ codigo: r.codigo, modelo: r.modelo, pares: n, nota, usuario, esPrueba })
        hechos++
      }
      alGuardar()
    } catch (err) {
      const motivo = err instanceof ErrorPackManual ? err.message : err?.message || String(err)
      setError(
        (hechos ? `Se guardaron ${hechos} de ${lista.length}. ` : '') + 'No se pudo guardar: ' + motivo
      )
      if (hechos) alGuardar({ mantenerAbierto: true })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div style={{ padding: '8px 10px', background: '#fff8e6', border: '1px solid #f0d58a', borderRadius: 6, fontSize: 13 }}>
      <div style={{ marginBottom: 6 }}>
        <strong>{renglon.codigo}</strong>: {textoPack(renglon.pack)}
        {lineaEvidencias(renglon.pack) && (
          <div className="texto-suave" style={{ fontSize: 12 }}>Lo que dice cada fuente: {lineaEvidencias(renglon.pack)}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Pares por pack{' '}
          <input type="number" min={PARES_MIN} max={PARES_MAX} step="1" value={pares} onChange={(e) => setPares(e.target.value)} style={{ width: 60 }} disabled={guardando} />
        </label>
        <input type="text" placeholder="Nota (de dónde lo sacaste)" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} style={{ flex: '1 1 180px' }} disabled={guardando} />
        {hermanos.length > 1 && (
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} disabled={guardando} />
            Aplicar a los {hermanos.length} códigos del modelo {renglon.modelo}
          </label>
        )}
        <button className="btn-primario" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
        <button className="btn-secundario" onClick={alCancelar} disabled={guardando}>
          Cancelar
        </button>
      </div>
      {error && <p className="alerta-error" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  )
}

export default function PanelInventarioPT() {
  const { esPrueba, authUser, perfil } = useAuth()
  const puedeDecidirPack = ROLES_PACK_MANUAL.includes(perfil?.rol || '')
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
  // Pares por pack de cada codigo embarcado (Map codigo -> resolucion).
  const [packs, setPacks] = useState(() => new Map())
  const [packsListos, setPacksListos] = useState(false)
  const [versionPacks, setVersionPacks] = useState(0)
  const [decidiendo, setDecidiendo] = useState(null) // codigo con el formulario abierto

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

  // El pack de cada codigo que ya salio al cliente. Se recalcula cuando llegan
  // entregas nuevas o alguien decide un pack a mano (versionPacks).
  useEffect(() => {
    let vivo = true
    const lista = []
    for (const e of entregas) {
      for (const r of e.renglones || []) {
        const codigo = codigoDe(r)
        // En el acta la OT va como "7682 / 7683" cuando el codigo viene en varias.
        if (codigo) lista.push({ codigo, ots: String(r.ot || '').split('/').map((o) => o.trim()).filter(Boolean) })
      }
    }
    if (!lista.length) {
      setPacks(new Map())
      setPacksListos(true)
      return
    }
    setPacksListos(false)
    resolverPacksDeCodigos(lista, esPrueba)
      .then((m) => {
        if (!vivo) return
        setPacks(m)
        setPacksListos(true)
      })
      .catch((err) => {
        if (!vivo) return
        console.error('[InventarioPT] No se pudo resolver el pack de los codigos:', err)
        setError('No se pudo saber cuántos pares trae el pack de lo embarcado: ' + (err.message || err))
        setPacksListos(true)
      })
    return () => {
      vivo = false
    }
  }, [entregas, esPrueba, versionPacks])

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
        const calculando = deEsta.length > 0 && !packsListos
        const conv = deEsta.length && !calculando ? docenasEmbarcadas(deEsta, packs) : { docenas: deEsta.length ? null : 0, supuestos: 0, conflictos: 0 }
        const embarcado = conv.docenas
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
          calculando,
          packsSupuestos: conv.supuestos,
          packsConflicto: conv.conflictos,
          pendiente,
          enBodega,
          // "Terminada" = ya se embarco todo lo solicitado (o mas). Si la
          // cuenta se apoya en un pack SUPUESTO no se da por terminada: el
          // supuesto no es un dato y no puede cerrar una orden solo.
          cerrada:
            solicitado != null && embarcado != null && embarcado >= solicitado && solicitado > 0 && conv.supuestos === 0
        }
      }),
    [ocs, entregasPorOc, recibidoPorOc, packs, packsListos]
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
    const t = { solicitado: 0, recibido: 0, embarcado: 0, pendiente: 0, sinEquivalencia: 0, sinMeta: 0, conSupuestos: 0, calculando: false }
    for (const f of visibles) {
      if (f.solicitado == null) t.sinMeta += 1
      else t.solicitado += f.solicitado
      t.recibido += f.recibido
      if (f.calculando) t.calculando = true
      else if (f.embarcado == null) t.sinEquivalencia += 1
      else t.embarcado += f.embarcado
      if (f.packsSupuestos > 0) t.conSupuestos += 1
      if (f.pendiente != null) t.pendiente += f.pendiente
    }
    return t
  }, [visibles])

  const abrir = (oc) => {
    if (abierta?.oc === oc) {
      setAbierta(null)
      return
    }
    setDecidiendo(null)
    cargarDetalle(oc)
  }

  // Despues de decidir un pack: se recarga el detalle y se recalculan los totales.
  const trasDecidir = (oc, { mantenerAbierto } = {}) => {
    if (!mantenerAbierto) setDecidiendo(null)
    setVersionPacks((v) => v + 1)
    cargarDetalle(oc)
  }

  const cargarDetalle = async (oc) => {
    setCargandoOc(true)
    try {
      const plan = await renglonesDeLaOc(oc, { esPrueba })
      const pl = armarPlDeLaOc(entregasPorOc.get(oc) || [])
      // armarPlDeLaOc agrupa por CLAVE del cliente: dos claves pueden ser el
      // mismo codigo, asi que se SUMA por codigo en vez de pisar.
      const entregadoPorCodigo = new Map()
      for (const r of pl.renglones) {
        const c = String(r.codigoQuini || '').trim().toUpperCase()
        entregadoPorCodigo.set(c, (entregadoPorCodigo.get(c) || 0) + num(r.packsTotal))
      }
      const renglones = plan.map((r) => {
        const dadas = entregadoPorCodigo.get(r.codigo.toUpperCase()) || 0
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
              Embarcado <strong>{totales.calculando ? 'calculando...' : doc(totales.embarcado)}</strong>
              {totales.sinEquivalencia > 0 && (
                <span className="texto-suave"> (+{totales.sinEquivalencia} con pack en conflicto)</span>
              )}
              {totales.conSupuestos > 0 && (
                <span className="texto-suave"> ({totales.conSupuestos} con algún pack supuesto)</span>
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
                            {f.calculando ? (
                              <span className="texto-suave">{f.packsEmbarcados} packs · calculando...</span>
                            ) : f.embarcado == null ? (
                              <span
                                className="texto-suave"
                                title="Las fuentes no coinciden en cuántos pares trae el pack de algún código: abre el Detalle para decidirlo"
                              >
                                {f.packsEmbarcados} packs · pack en conflicto
                              </span>
                            ) : (
                              <>
                                {doc(f.embarcado)}
                                {f.packsEmbarcados > 0 && (
                                  <div className="texto-suave" style={{ fontSize: 11 }}>
                                    {f.packsEmbarcados} packs
                                  </div>
                                )}
                                {f.packsSupuestos > 0 && (
                                  <div
                                    style={{ fontSize: 11, color: '#8a5a00' }}
                                    title="Ninguna fuente dice el pack de algún código: se contó como suelto (1 par). No es un dato; abre el Detalle para confirmarlo."
                                  >
                                    incluye suelto supuesto
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
                            <th>Pack</th>
                            <th style={{ textAlign: 'right' }}>Solicitado</th>
                            <th style={{ textAlign: 'right' }}>Entregado</th>
                            <th style={{ textAlign: 'right' }}>Pendiente</th>
                            <th style={{ textAlign: 'right' }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {abierta.renglones.map((r) => {
                            const est = r.pack?.estado
                            const colorPack = est === 'conflicto' ? '#a52218' : est === 'supuesto' ? '#8a5a00' : undefined
                            return (
                              <React.Fragment key={r.codigo}>
                                <tr>
                                  <td><strong>{r.codigo}</strong></td>
                                  <td>{r.descripcion || '—'}</td>
                                  <td>{r.ot || '—'}</td>
                                  <td style={{ fontSize: 12, color: colorPack }}>
                                    {r.pack ? textoPack(r.pack) : 'sin dato del pack'}
                                    {r.pack?.discrepancias?.length > 0 && r.pack.origen === 'manual' && (
                                      <div className="texto-suave" title={lineaEvidencias(r.pack)}>
                                        (las fuentes decían: {lineaEvidencias(r.pack)})
                                      </div>
                                    )}
                                    {puedeDecidirPack && decidiendo !== r.codigo && (
                                      <div>
                                        <button
                                          className="btn-secundario"
                                          style={{ fontSize: 11, padding: '1px 6px', marginTop: 2 }}
                                          onClick={() => setDecidiendo(r.codigo)}
                                        >
                                          {est === 'conflicto' ? 'Decidir' : est === 'supuesto' ? 'Confirmar' : 'Corregir'}
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    {r.cantidadPlan} doc
                                    {r.packsPlan != null && (
                                      <div
                                        className="texto-suave"
                                        style={{ fontSize: 11, color: r.packsPlanEntero === false ? '#a52218' : undefined }}
                                        title={r.packsPlanEntero === false ? 'Esas docenas no dan packs completos con ese pack: revisar el plan o el pack' : undefined}
                                      >
                                        = {r.packsPlan} packs{r.packsPlanEntero === false ? ' (no da packs completos)' : ''}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>{r.dadas} packs</td>
                                  <td style={{ textAlign: 'right' }}>
                                    {r.cierre.sinEquivalencia ? (
                                      <span className="texto-suave" title="Las fuentes no coinciden en cuántos pares trae el pack">
                                        pack en conflicto
                                      </span>
                                    ) : (
                                      `${dosDec(r.cierre.pendientes)} packs`
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    {/* cierreDelRenglon da una FRACCION (0..1); porcentajeHonesto
                                        espera 0..100. Sin el x100 un 30% se pintaba como "0.3%". */}
                                    {r.cierre.porcentaje == null ? '—' : porcentajeHonesto(r.cierre.porcentaje * 100)}
                                  </td>
                                </tr>
                                {decidiendo === r.codigo && (
                                  <tr>
                                    <td colSpan={8}>
                                      <DecidirPack
                                        renglon={r}
                                        renglones={abierta.renglones}
                                        esPrueba={esPrueba}
                                        usuario={{ uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' }}
                                        alGuardar={(opc) => trasDecidir(abierta.oc, opc)}
                                        alCancelar={() => setDecidiendo(null)}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            )
                          })}
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
            Los pares por pack de cada código salen del artículo de Microsip, del pedido del plan o
            del tech pack. Si no coinciden, dice "pack en conflicto" y no se convierte hasta que
            alguien lo decida; si ninguna fuente lo dice, se cuenta como suelto (1 par) marcado
            como supuesto.
          </p>
        </>
      )}
    </div>
  )
}
