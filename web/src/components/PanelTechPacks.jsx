// TECH PACKS: la biblioteca de Lety y el tablero de que falta.
//
// Dos lectores con dos necesidades:
//   - Lety (rol 'desarrollo') SUBE: por codigo, el tech pack de empaque (B6)
//     y, aparte, la ficha tecnica de tejido (FTT, B2). Son documentos
//     distintos y la pantalla no deja confundirlos.
//   - El papa, Lindbergh y el admin VEN: cuantos codigos tienen que, y que
//     ordenes de trabajo del plan siguen sin tech pack. Es el "control de los
//     avances de Lety" que pidio Roberto, vivo en vez de foto.
//
// El proyecto de julio (RESUMEN_PROYECTO_QUINI_FICHAS_BOM) media esto
// escaneando Google Drive y regenerando un HTML a mano. Aqui la fuente es
// RAGNAR: lo que Lety sube se ve al instante.
//
// La subida va en DOS pasos a proposito (Roberto, 2026-09-03: "ella lo unico
// que tiene que hacer es ligar el tech pack con la OT"): primero se dice de
// que orden de trabajo (o codigo) es, y hasta que el codigo esta elegido se
// habilitan los botones de subir. Asi no se sube nada "al aire".
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { renglonesDeLaOt, versionActiva } from '../utils/planMaestro'
import { normalizarOt } from '../utils/planMaestroNucleo'
import { formatoDeArchivo, MAX_TECHPACK_BYTES } from '../utils/tareasEnsamble'
import {
  codigoComoId,
  descargarDeBiblioteca,
  ErrorBiblioteca,
  escucharBiblioteca,
  guardarEnBiblioteca,
  otsPorCodigo,
  otsSinTechPack,
  quitarDeBiblioteca,
  TIPOS
} from '../utils/techPacks'
import VisorTechPack from './VisorTechPack'

const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '—')
// "WKD225T401-4-6" -> "WKD225T401": el plan trae el codigo base y una OT por
// talla; la biblioteca guarda una entrada por talla. Mismo criterio que el
// pegado por OT (techPacksDeLaOt).
const codigoBase = (c) => String(c || '').replace(/-\d{1,2}-\d{1,2}$/, '')
const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(1)} MB`

export default function PanelTechPacks() {
  const { authUser, perfil, esPrueba, puedeSubirTechPacks } = useAuth()
  const [biblioteca, setBiblioteca] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [progreso, setProgreso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [filtro, setFiltro] = useState('')
  const [soloSin, setSoloSin] = useState(false)
  const [visor, setVisor] = useState(null) // { codigo, tipo, manifiesto }
  const [cruce, setCruce] = useState(null) // null | 'cargando' | [...]
  // codigo -> [{ot, oc}] segun el plan vigente; null mientras carga, Map vacio si no hay plan
  const [enPlan, setEnPlan] = useState(null)
  // Buscar por ORDEN DE TRABAJO: Lety conoce la OT antes que el codigo.
  const [ot, setOt] = useState('')
  const [codigosDeOt, setCodigosDeOt] = useState(null) // null | 'buscando' | [] | [{codigo, descripcion, oc}]

  useEffect(() => {
    const parar = escucharBiblioteca(
      esPrueba,
      (lista) => {
        setBiblioteca(lista)
        setError('')
      },
      (err) => setError('No se pudo leer la biblioteca: ' + (err.message || err))
    )
    return parar
  }, [esPrueba])

  // El ligue a OT/OC se lee del plan al abrir la pestana (una consulta). Si
  // falla, la tabla sigue sirviendo: solo se queda sin esa columna.
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const versionId = await versionActiva()
        const m = await otsPorCodigo(versionId)
        if (!cancelado) setEnPlan(m)
      } catch (err) {
        console.warn('[TechPacks] No se pudo leer el plan para ligar OT/OC:', err)
        if (!cancelado) setEnPlan(new Map())
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const usuario = { uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' }

  const reportar = (err) => {
    console.error('[TechPacks]', err)
    setError(err instanceof ErrorBiblioteca ? err.message : 'Fallo: ' + (err.message || err))
  }

  const onBuscarOt = async () => {
    const limpia = normalizarOt(ot)
    setError('')
    setAviso('')
    if (!limpia) {
      setError('Escribe la orden de trabajo (4 digitos, ej. 7887).')
      return
    }
    setCodigosDeOt('buscando')
    try {
      const r = await renglonesDeLaOt(limpia)
      const lista = r
        .map((x) => ({ codigo: codigoComoId(x.codigo), descripcion: x.descripcion, oc: x.oc }))
        .filter((x) => x.codigo)
      setCodigosDeOt(lista)
      if (!lista.length) {
        setError(`El plan vigente no conoce la OT ${limpia}. Pide a Adrian que la suba, o escribe el codigo directo.`)
      } else if (lista.length === 1) {
        // Un solo codigo: se elige solo, que es lo normal.
        setCodigo(lista[0].codigo)
      }
    } catch (err) {
      setCodigosDeOt(null)
      reportar(err)
    }
  }

  const onSubir = async (tipo, file) => {
    if (!file) return
    setError('')
    setAviso('')
    const id = codigoComoId(codigo)
    if (!id) {
      setError('Primero di de que codigo es: busca la orden de trabajo o escribe el codigo.')
      return
    }
    const formato = formatoDeArchivo(file.name)
    if (!formato) {
      setError('El archivo tiene que ser .pdf o .xlsx. Mejor PDF: se ve tal cual.')
      return
    }
    if (file.size > MAX_TECHPACK_BYTES) {
      setError(`El archivo pesa ${mb(file.size)} y el tope son 15 MB.`)
      return
    }
    setTrabajando(true)
    try {
      const idFinal = await guardarEnBiblioteca({
        codigo: id,
        tipo,
        contenido: await file.arrayBuffer(),
        nombre: file.name,
        formato,
        usuario,
        esPrueba,
        onProgreso: setProgreso
      })
      const ligado = enPlan?.get(idFinal || id)
      setAviso(
        `${TIPOS[tipo].titulo} de ${idFinal || id} guardado.` +
          (enPlan && !ligado?.length
            ? ' OJO: ese codigo no esta en ninguna orden de trabajo del plan vigente; se guardo igual, pero nadie lo va a poder pegar por OT hasta que Adrian lo suba.'
            : ligado?.length
              ? ` Ligado a ${ligado.length === 1 ? 'la OT' : 'las OT'} ${ligado.map((x) => x.ot).join(', ')}.`
              : '')
      )
      setCruce(null)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(false)
    }
  }

  const onQuitar = async (item, tipo) => {
    if (!window.confirm(`¿Quitar ${TIPOS[tipo].titulo.toLowerCase()} de ${item.codigo}? Las tareas que ya lo tienen pegado no se tocan.`)) return
    setTrabajando(true)
    setError('')
    try {
      await quitarDeBiblioteca({ codigo: item.codigo, tipo, usuario, onProgreso: setProgreso })
      setAviso(`Quitado de ${item.codigo}.`)
      setCruce(null)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(false)
    }
  }

  const onCruzar = async () => {
    setCruce('cargando')
    setError('')
    try {
      const versionId = await versionActiva()
      if (!versionId) {
        setCruce([])
        setAviso('No hay plan maestro cargado: no hay contra que cruzar.')
        return
      }
      setCruce(await otsSinTechPack(biblioteca, versionId))
    } catch (err) {
      setCruce(null)
      reportar(err)
    }
  }

  const resumen = useMemo(() => {
    // Los alias (folio -> codigo real) no cuentan como disenos.
    const reales = biblioteca.filter((b) => !b.apuntaA)
    const total = reales.length
    const conTp = reales.filter((b) => b.techPack?.totalChunks).length
    const conFtt = reales.filter((b) => b.ftt?.totalChunks).length
    const soloFtt = reales.filter((b) => b.ftt?.totalChunks && !b.techPack?.totalChunks).length
    // Un diseno esta "en el plan" si su codigo o alguno de sus alias (folios) esta
    const foliosDe = new Map()
    biblioteca.forEach((b) => { if (b.apuntaA) { if (!foliosDe.has(b.apuntaA)) foliosDe.set(b.apuntaA, []); foliosDe.get(b.apuntaA).push(b.codigo) } })
    const fueraDelPlan = enPlan
      ? reales.filter(
          (b) =>
            !enPlan.get(b.codigo)?.length &&
            !enPlan.get(codigoBase(b.codigo))?.length &&
            !(foliosDe.get(b.codigo) || []).some((f) => enPlan.get(f)?.length)
        ).length
      : null
    return { total, conTp, conFtt, soloFtt, fueraDelPlan, foliosDe }
  }, [biblioteca, enPlan])

  const visibles = useMemo(() => {
    const f = filtro.trim().toUpperCase()
    return biblioteca.filter((b) => !b.apuntaA).filter((b) => {
      if (soloSin && b.techPack?.totalChunks) return false
      if (!f) return true
      return `${b.codigo} ${b.descripcion || ''}`.toUpperCase().includes(f)
    })
  }, [biblioteca, filtro, soloSin])

  const otsConFaltantes = Array.isArray(cruce) ? cruce.filter((o) => o.faltan.length) : []

  // EL ARBOL: orden de compra -> orden de trabajo -> disenos con tech pack.
  // Es la misma forma que el arbol de Ordenes de compra (Roberto, 04-09:
  // "necesito que las ordenes igual, como el arbol"). Un diseno cuelga de una
  // OT si el plan lo dice por su codigo, por su codigo base (tallas) o por
  // alguno de sus folios de ficha. Los que no cuelgan de ninguna OT van al
  // apartado "todavia sin orden": son fichas de desarrollos que aun no son
  // pedido, y eso es normal, no un error.
  const arbol = useMemo(() => {
    const reales = biblioteca.filter((b) => !b.apuntaA)
    if (!enPlan) return { ocs: [], sinOrden: reales, totalConOrden: 0 }
    const porOc = new Map() // oc -> Map(ot -> [disenos])
    const sinOrden = []
    let totalConOrden = 0
    for (const b of reales) {
      const ots = new Map()
      const agrega = (lista) => (lista || []).forEach((x) => { if (!ots.has(x.ot)) ots.set(x.ot, x.oc || '') })
      agrega(enPlan.get(b.codigo))
      if (codigoBase(b.codigo) !== b.codigo) agrega(enPlan.get(codigoBase(b.codigo)))
      ;(resumen.foliosDe.get(b.codigo) || []).forEach((f) => agrega(enPlan.get(f)))
      if (!ots.size) { sinOrden.push(b); continue }
      totalConOrden++
      for (const [ot, oc] of ots) {
        const llaveOc = oc || 'SIN OC'
        if (!porOc.has(llaveOc)) porOc.set(llaveOc, new Map())
        const porOt = porOc.get(llaveOc)
        if (!porOt.has(ot)) porOt.set(ot, [])
        porOt.get(ot).push(b)
      }
    }
    // Lo que le FALTA a cada OT (si ya se cruzo con el plan)
    const faltanDe = new Map()
    if (Array.isArray(cruce)) cruce.forEach((o) => faltanDe.set(o.ot, o))
    const ocs = [...porOc.entries()]
      .map(([oc, porOt]) => ({
        oc,
        ots: [...porOt.entries()]
          .map(([ot, disenos]) => {
            // Las tallas de un mismo diseno van juntas: un renglon por codigo
            // base con un boton por talla (el plan da una OT por talla y
            // Lindbergh elige cual al pegar).
            const porBase = new Map()
            disenos.forEach((b) => {
              const base = codigoBase(b.codigo)
              if (!porBase.has(base)) porBase.set(base, { base, variantes: [] })
              porBase.get(base).variantes.push(b)
            })
            const grupos = [...porBase.values()]
              .map((g) => ({ ...g, variantes: g.variantes.sort((x, y) => x.codigo.localeCompare(y.codigo, 'es', { numeric: true })) }))
              .sort((x, y) => x.base.localeCompare(y.base))
            return { ot, grupos, faltan: faltanDe.get(ot)?.faltan || [], destino: faltanDe.get(ot)?.destino || '' }
          })
          .sort((x, y) => x.ot.localeCompare(y.ot, 'es', { numeric: true }))
      }))
      .sort((x, y) => (x.oc === 'SIN OC' ? 1 : y.oc === 'SIN OC' ? -1 : x.oc.localeCompare(y.oc, 'es', { numeric: true })))
    return { ocs, sinOrden: sinOrden.sort((x, y) => x.codigo.localeCompare(y.codigo)), totalConOrden }
  }, [biblioteca, enPlan, resumen.foliosDe, cruce])
  const codigoListo = Boolean(codigoComoId(codigo))
  const ligueDelElegido = codigoListo && enPlan ? enPlan.get(codigoComoId(codigo)) : null

  return (
    <div className="tp">
      {/* ------------------------------------------------ cabecera + tiles */}
      <div className="tarjeta tp-cabecera">
        <div>
          <h2 style={{ margin: 0 }}>Tech packs</h2>
          <p className="texto-suave" style={{ margin: '6px 0 0' }}>
            Un renglon por codigo de diseno. <strong>Tener la FTT no es tener tech pack</strong>: a la
            maquila se le manda el <strong>tech pack de empaque</strong>; la ficha de tejido se guarda
            aparte, solo para saber que ya existe.
          </p>
        </div>
        <div className="tp-tiles">
          <Tile titulo="Codigos" valor={resumen.total} />
          <Tile titulo="Con tech pack" valor={resumen.conTp} tono="ok" />
          <Tile titulo="Con FTT" valor={resumen.conFtt} />
          <Tile titulo="Solo FTT" valor={resumen.soloFtt} tono={resumen.soloFtt ? 'aviso' : ''} />
          {resumen.fueraDelPlan != null && (
            <Tile titulo="Sin OT en el plan" valor={resumen.fueraDelPlan} tono={resumen.fueraDelPlan ? 'aviso' : ''} />
          )}
        </div>
      </div>

      {error && <div className="alerta-error">{error}</div>}
      {aviso && <div className="alerta-exito">{aviso}</div>}

      {/* ------------------------------------------------ subir, en dos pasos */}
      {puedeSubirTechPacks && (
        <div className="tarjeta tp-subir">
          <div className="tp-paso">
            <span className="tp-num">1</span>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}>¿De que orden de trabajo es?</h3>
              <p className="texto-suave" style={{ margin: '4px 0 10px' }}>
                Escribe la OT y la app te dice sus codigos. Si ya sabes el codigo, escribelo directo.
              </p>
              <div className="tp-fila">
                <input
                  className="tp-input"
                  placeholder="Orden de trabajo (ej. 7887)"
                  value={ot}
                  onChange={(e) => setOt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onBuscarOt()}
                  disabled={trabajando}
                  style={{ width: 220 }}
                />
                <button className="btn-secundario" onClick={onBuscarOt} disabled={trabajando || codigosDeOt === 'buscando'}>
                  {codigosDeOt === 'buscando' ? 'Buscando...' : 'Ver sus codigos'}
                </button>
                <span className="texto-suave">o</span>
                <input
                  className="tp-input"
                  placeholder="Codigo del diseno (ej. WKD225T401)"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                  disabled={trabajando}
                  style={{ width: 280 }}
                />
              </div>
              {Array.isArray(codigosDeOt) && codigosDeOt.length > 0 && (
                <div className="tp-chips">
                  <span className="texto-suave" style={{ fontSize: 13 }}>
                    {codigosDeOt.length === 1 ? 'Esa OT lleva un solo codigo:' : `Esa OT lleva ${codigosDeOt.length} codigos, elige a cual va:`}
                  </span>
                  {codigosDeOt.map((c) => (
                    <button
                      key={c.codigo}
                      className={`tp-chip ${codigo === c.codigo ? 'activo' : ''}`}
                      onClick={() => setCodigo(c.codigo)}
                      title={c.descripcion || ''}
                    >
                      <strong>{c.codigo}</strong>
                      {c.descripcion ? <span> · {c.descripcion.slice(0, 40)}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`tp-paso ${codigoListo ? '' : 'tp-paso-apagado'}`}>
            <span className="tp-num">2</span>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}>
                {codigoListo ? (
                  <>
                    Sube el documento de <span className="tp-codigo">{codigoComoId(codigo)}</span>
                  </>
                ) : (
                  'Sube el documento'
                )}
              </h3>
              <p className="texto-suave" style={{ margin: '4px 0 10px' }}>
                {!codigoListo
                  ? 'Se habilita cuando el codigo este elegido arriba.'
                  : ligueDelElegido?.length
                    ? `Ligado a ${ligueDelElegido.length === 1 ? 'la OT' : 'las OT'} ${ligueDelElegido.map((x) => x.ot + (x.oc ? ` (OC ${x.oc})` : '')).join(', ')}.`
                    : enPlan
                      ? 'Ese codigo no esta en ninguna OT del plan vigente. Se puede subir igual.'
                      : 'Leyendo el plan...'}
              </p>
              <div className="tp-fila">
                <label className={`btn-primario tp-btn-archivo ${!codigoListo || trabajando ? 'apagado' : ''}`}>
                  {trabajando ? 'Subiendo...' : 'Subir TECH PACK de empaque'}
                  <input
                    type="file"
                    accept=".pdf,.xlsx"
                    style={{ display: 'none' }}
                    disabled={!codigoListo || trabajando}
                    onChange={(e) => {
                      onSubir('tp', e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                <label className={`btn-secundario tp-btn-archivo ${!codigoListo || trabajando ? 'apagado' : ''}`}>
                  Subir FTT (ficha de tejido)
                  <input
                    type="file"
                    accept=".pdf,.xlsx"
                    style={{ display: 'none' }}
                    disabled={!codigoListo || trabajando}
                    onChange={(e) => {
                      onSubir('ftt', e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                <span className="texto-suave" style={{ fontSize: 13 }}>
                  PDF o Excel, maximo 15 MB. Mejor PDF. Si ya habia uno, lo reemplaza y sube la version.
                </span>
              </div>
              {progreso && <p className="tp-progreso">{progreso}</p>}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ el arbol */}
      <div className="tarjeta">
        <div className="tp-fila" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Por orden de compra y orden de trabajo</h3>
            <p className="texto-suave" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Cada tech pack cuelga de la orden de trabajo que el plan le da, por su codigo o por sus folios de ficha.
              {Array.isArray(cruce) ? ' Con el cruce hecho, cada OT dice tambien que codigos le faltan.' : ' Pulsa "Cruzar con el plan maestro" para ver ademas lo que le falta a cada OT.'}
            </p>
          </div>
          <div className="tp-fila">
            <span className="tp-pill">{arbol.totalConOrden} con orden</span>
            <span className={`tp-pill ${arbol.sinOrden.length ? 'tp-pill-aviso' : ''}`}>{arbol.sinOrden.length} todavia sin orden</span>
          </div>
        </div>

        {enPlan === null ? (
          <p className="texto-suave" style={{ marginTop: 12 }}>Leyendo el plan maestro...</p>
        ) : arbol.ocs.length === 0 && arbol.sinOrden.length === 0 ? (
          <div className="tp-vacio">
            <div className="tp-vacio-titulo">Todavia no hay nada en la biblioteca</div>
          </div>
        ) : (
          <div className="tp-arbol">
            {arbol.ocs.map((o) => (
              <details key={o.oc} className="tp-oc" open>
                <summary>
                  <span className="tp-oc-titulo">{o.oc === 'SIN OC' ? 'Ordenes de trabajo sin orden de compra' : `OC ${o.oc}`}</span>
                  <span className="texto-suave"> · {o.ots.length} {o.ots.length === 1 ? 'orden de trabajo' : 'ordenes de trabajo'} · {o.ots.reduce((n, t) => n + t.grupos.length, 0)} {o.ots.reduce((n, t) => n + t.grupos.length, 0) === 1 ? 'diseno' : 'disenos'}</span>
                </summary>
                {o.ots.map((t) => (
                  <div key={t.ot} className="tp-ot">
                    <div className="tp-ot-cab">
                      <span className="tp-ot-num">OT {t.ot}</span>
                      {t.destino ? <span className="texto-suave"> · {t.destino}</span> : null}
                      {t.faltan.length > 0 && (
                        <span className="tp-pill tp-pill-falta" style={{ marginLeft: 8 }}>faltan {t.faltan.length}: {t.faltan.join(', ')}</span>
                      )}
                    </div>
                    <div className="tp-disenos">
                      {t.grupos.map((g) => (
                        <div key={g.base} className="tp-diseno">
                          <div>
                            <span className="tp-codigo">{g.base}</span>
                            {g.variantes.length > 1 || g.variantes[0].codigo !== g.base ? (
                              <span className="texto-suave" style={{ fontSize: 12, marginLeft: 8 }}>
                                {g.variantes.length} {g.variantes.length === 1 ? 'talla' : 'tallas'}
                              </span>
                            ) : null}
                            {g.variantes.length === 1 && (resumen.foliosDe.get(g.variantes[0].codigo) || []).length > 0 && (
                              <span className="texto-suave" style={{ fontSize: 12, marginLeft: 8 }}>folios {(resumen.foliosDe.get(g.variantes[0].codigo) || []).join(', ')}</span>
                            )}
                          </div>
                          <div className="tp-fila">
                            {g.variantes.map((b) => {
                              const talla = b.codigo !== g.base ? b.codigo.slice(g.base.length + 1) : ''
                              return b.techPack?.totalChunks ? (
                                <button
                                  key={b.id}
                                  className="btn-secundario tp-btn-chico"
                                  title={`${b.techPack.formato?.toUpperCase()} · ${mb(b.techPack.tamano)} · v${b.techPack.version || 1}${(resumen.foliosDe.get(b.codigo) || []).length ? ' · folios ' + resumen.foliosDe.get(b.codigo).join(', ') : ''}`}
                                  onClick={() => setVisor({ codigo: b.codigo, tipo: 'tp', manifiesto: b.techPack })}
                                >
                                  {talla ? `Ver talla ${talla}` : 'Ver tech pack'}
                                </button>
                              ) : (
                                <span key={b.id} className="tp-pill tp-pill-falta">{talla ? `talla ${talla} sin tech pack` : 'sin tech pack'}</span>
                              )
                            })}
                            {g.variantes.some((b) => b.ftt?.totalChunks) &&
                              g.variantes.filter((b) => b.ftt?.totalChunks).map((b) => (
                                <button key={b.id + '-ftt'} className="btn-secundario tp-btn-chico" onClick={() => setVisor({ codigo: b.codigo, tipo: 'ftt', manifiesto: b.ftt })}>
                                  Ver FTT{b.codigo !== g.base ? ` ${b.codigo.slice(g.base.length + 1)}` : ''}
                                </button>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </details>
            ))}

            <details className="tp-oc tp-oc-sin" open={arbol.ocs.length === 0}>
              <summary>
                <span className="tp-oc-titulo">Todavia sin orden de trabajo</span>
                <span className="texto-suave"> · {arbol.sinOrden.length} · desarrollos que aun no son pedido, o que Adrian no ha subido al plan</span>
              </summary>
              {arbol.sinOrden.length === 0 ? (
                <p className="texto-suave" style={{ margin: '8px 0 0 12px' }}>Ninguno: todos los tech packs cuelgan de una OT.</p>
              ) : (
                <div className="tp-disenos">
                  {arbol.sinOrden.map((b) => (
                    <div key={b.id} className="tp-diseno">
                      <div>
                        <span className="tp-codigo">{b.codigo}</span>
                        {b.descripcion ? <span className="texto-suave" style={{ fontSize: 12, marginLeft: 8 }}>{b.descripcion}</span> : null}
                      </div>
                      <div className="tp-fila">
                        {b.techPack?.totalChunks ? (
                          <button className="btn-secundario tp-btn-chico" onClick={() => setVisor({ codigo: b.codigo, tipo: 'tp', manifiesto: b.techPack })}>Ver tech pack</button>
                        ) : (
                          <span className="tp-pill tp-pill-falta">sin tech pack</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </details>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ la lista completa (plegada) */}
      <details className="tarjeta tp-lista">
        <summary className="tp-fila" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
          <h3 style={{ margin: 0 }}>Lista completa, codigo por codigo</h3>
          <span className="texto-suave" style={{ fontSize: 13 }}>{biblioteca.filter((b) => !b.apuntaA).length} codigos · abrir</span>
        </summary>
        <div className="tp-fila" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <div className="tp-fila">
            <input
              className="tp-input"
              placeholder="Buscar por codigo o descripcion"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              style={{ width: 260 }}
            />
            <label className="tp-check">
              <input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} />
              Solo los que no tienen tech pack
            </label>
            <span className="texto-suave" style={{ fontSize: 13 }}>{visibles.length} de {biblioteca.length}</span>
          </div>
        </div>
        {visibles.length === 0 ? (
          <div className="tp-vacio">
            {biblioteca.length === 0 ? (
              <>
                <div className="tp-vacio-titulo">Todavia no hay nada en la biblioteca</div>
                <div className="texto-suave">
                  {puedeSubirTechPacks
                    ? 'Arriba: escribe la orden de trabajo, elige el codigo y sube el tech pack.'
                    : 'Cuando Lety suba el primer tech pack aparece aqui.'}
                </div>
              </>
            ) : (
              <div className="texto-suave">Nada con ese filtro.</div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Descripcion</th>
                  <th>OT / OC (segun el plan)</th>
                  <th>Tech pack de empaque</th>
                  <th>FTT</th>
                  <th>Ultimo cambio</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="tp-codigo">{b.codigo}</span>
                    </td>
                    <td>{b.descripcion || <span className="texto-suave">sin descripcion</span>}</td>
                    <td style={{ fontSize: 13 }}>
                      <LigueAlPlan
                        lista={
                          enPlan
                            ? [
                                ...(enPlan.get(b.codigo) || []),
                                ...(codigoBase(b.codigo) !== b.codigo ? enPlan.get(codigoBase(b.codigo)) || [] : []),
                                ...(resumen.foliosDe.get(b.codigo) || []).flatMap((f) => enPlan.get(f) || [])
                              ]
                            : undefined
                        }
                        porTalla={codigoBase(b.codigo) !== b.codigo && !enPlan?.get(b.codigo)?.length && Boolean(enPlan?.get(codigoBase(b.codigo))?.length)}
                        folios={resumen.foliosDe.get(b.codigo) || []}
                        cargando={enPlan === null}
                      />
                    </td>
                    <td>
                      <Documento item={b} tipo="tp" onVer={setVisor} onQuitar={onQuitar} puedeEditar={puedeSubirTechPacks} ocupado={trabajando} />
                    </td>
                    <td>
                      <Documento item={b} tipo="ftt" onVer={setVisor} onQuitar={onQuitar} puedeEditar={puedeSubirTechPacks} ocupado={trabajando} />
                    </td>
                    <td className="texto-suave" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                      {fecha(b.actualizadoEn)}
                      {b.actualizadoPorNombre ? ` · ${b.actualizadoPorNombre}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {/* ------------------------------------------------ cruce con el plan */}
      <div className="tarjeta">
        <div className="tp-fila" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Ordenes de trabajo del plan sin tech pack</h3>
            <p className="texto-suave" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Por cada OT del plan vigente, los codigos a los que les falta el tech pack de empaque: lo
              que Lindbergh no va a poder pegar al encargar la tarea.
            </p>
          </div>
          <button className="btn-secundario" onClick={onCruzar} disabled={cruce === 'cargando'}>
            {cruce === 'cargando' ? 'Cruzando...' : cruce ? 'Volver a cruzar' : 'Cruzar con el plan maestro'}
          </button>
        </div>
        {Array.isArray(cruce) &&
          (otsConFaltantes.length === 0 ? (
            <p className="tp-ok" style={{ marginTop: 12 }}>
              Todas las OT del plan tienen tech pack para todos sus codigos.
            </p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <p className="tp-aviso">
                <strong>{otsConFaltantes.length}</strong> de {cruce.length} OT tienen al menos un codigo sin tech pack.
              </p>
              <table className="tabla-datos">
                <thead>
                  <tr>
                    <th>OT</th>
                    <th>OC</th>
                    <th>Destino</th>
                    <th>Codigos sin tech pack</th>
                  </tr>
                </thead>
                <tbody>
                  {otsConFaltantes.map((o) => (
                    <tr key={o.ot}>
                      <td>
                        <strong>{o.ot}</strong>
                      </td>
                      <td>{o.oc || <span className="texto-suave">sin OC</span>}</td>
                      <td>{o.destino}</td>
                      <td>
                        {o.faltan.map((c) => (
                          <span key={c} className="tp-pill tp-pill-falta">
                            {c}
                          </span>
                        ))}
                        <span className="texto-suave" style={{ fontSize: 13 }}>
                          {' '}
                          ({o.faltan.length} de {o.total})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>

      {visor && (
        <VisorTechPack
          techPack={visor.manifiesto}
          cargar={() => descargarDeBiblioteca({ codigo: visor.codigo, tipo: visor.tipo, manifiesto: visor.manifiesto })}
          onCerrar={() => setVisor(null)}
        />
      )}
    </div>
  )
}

function Tile({ titulo, valor, tono = '' }) {
  return (
    <div className={`tp-tile ${tono ? 'tp-tile-' + tono : ''}`}>
      <div className="tp-tile-valor">{valor}</div>
      <div className="tp-tile-titulo">{titulo}</div>
    </div>
  )
}

function LigueAlPlan({ lista, folios = [], cargando, porTalla = false }) {
  if (cargando) return <span className="texto-suave">leyendo el plan...</span>
  // Una OT puede venir por el codigo y por varios folios: se muestra una vez.
  const vistas = new Map()
  ;(lista || []).forEach((x) => { if (!vistas.has(x.ot)) vistas.set(x.ot, x) })
  return (
    <span>
      {vistas.size === 0 ? (
        <span className="tp-pill tp-pill-aviso">sin OT en el plan</span>
      ) : (
        [...vistas.values()].map((x) => (
          <span key={x.ot} className="tp-pill">
            {x.ot}
            {x.oc ? <span className="texto-suave"> · OC {x.oc}</span> : null}
          </span>
        ))
      )}
      {porTalla && (
        <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
          por el codigo base (el plan lleva una OT por talla; Lindbergh elige al pegar)
        </div>
      )}
      {folios.length > 0 && (
        <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
          folios: {folios.join(', ')}
        </div>
      )}
    </span>
  )
}

function Documento({ item, tipo, onVer, onQuitar, puedeEditar, ocupado }) {
  const m = item[TIPOS[tipo].campo]
  if (!m?.totalChunks) {
    return tipo === 'tp' ? (
      <span className="tp-pill tp-pill-falta">FALTA</span>
    ) : (
      <span className="texto-suave">—</span>
    )
  }
  return (
    <div className="tp-doc">
      <button className="btn-secundario tp-btn-chico" onClick={() => onVer({ codigo: item.codigo, tipo, manifiesto: m })}>
        Ver
      </button>
      <span className="texto-suave" style={{ fontSize: 12 }}>
        v{m.version || 1} · {m.formato?.toUpperCase()} · {mb(m.tamano)} · {fecha(m.subidoEn)}
      </span>
      {puedeEditar && (
        <button className="tp-quitar" disabled={ocupado} onClick={() => onQuitar(item, tipo)}>
          Quitar
        </button>
      )}
    </div>
  )
}
