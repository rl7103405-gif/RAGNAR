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
  // Buscar por ORDEN DE TRABAJO: Lety conoce la OT antes que el codigo (Roberto,
  // 2026-09-03: 'ella lo unico que tiene que hacer es ligar el tech pack con la
  // OT'). Se resuelve OT -> codigos con el plan y ella elige a cual va.
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

  const onSubir = async (tipo, file) => {
    if (!file) return
    setError('')
    setAviso('')
    const id = codigoComoId(codigo)
    if (!id) {
      setError('Escribe primero el codigo del diseno (ej. WKD225T401).')
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

  const onBuscarOt = async () => {
    const limpia = normalizarOt(ot)
    setError('')
    if (!limpia) {
      setError('Escribe la orden de trabajo (4 digitos, ej. 7887).')
      return
    }
    setCodigosDeOt('buscando')
    try {
      const r = await renglonesDeLaOt(limpia)
      setCodigosDeOt(r.map((x) => ({ codigo: codigoComoId(x.codigo), descripcion: x.descripcion, oc: x.oc })).filter((x) => x.codigo))
      if (!r.length) setError(`El plan vigente no conoce la OT ${limpia}. Pide a Adrian que la suba, o escribe el codigo directo.`)
    } catch (err) {
      setCodigosDeOt(null)
      reportar(err)
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
    const total = biblioteca.length
    const conTp = biblioteca.filter((b) => b.techPack?.totalChunks).length
    const conFtt = biblioteca.filter((b) => b.ftt?.totalChunks).length
    const soloFtt = biblioteca.filter((b) => b.ftt?.totalChunks && !b.techPack?.totalChunks).length
    const fueraDelPlan = enPlan ? biblioteca.filter((b) => !enPlan.get(b.codigo)?.length).length : null
    return { total, conTp, conFtt, soloFtt, fueraDelPlan }
  }, [biblioteca, enPlan])

  const visibles = useMemo(() => {
    const f = filtro.trim().toUpperCase()
    return biblioteca.filter((b) => {
      if (soloSin && b.techPack?.totalChunks) return false
      if (!f) return true
      return `${b.codigo} ${b.descripcion || ''}`.toUpperCase().includes(f)
    })
  }, [biblioteca, filtro, soloSin])

  const otsConFaltantes = Array.isArray(cruce) ? cruce.filter((o) => o.faltan.length) : []

  return (
    <div>
      <div className="tarjeta">
        <h2>Tech packs</h2>
        <p style={{ color: '#475569', marginTop: 4 }}>
          Un renglon por codigo. <strong>Tener la FTT no es tener tech pack</strong>: el que se le
          manda a la maquila es el <strong>tech pack de empaque</strong>; la ficha tecnica de tejido
          se guarda aparte, solo para saber que ya existe.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
          <Dato titulo="Codigos en la biblioteca" valor={resumen.total} />
          <Dato titulo="Con tech pack de empaque" valor={resumen.conTp} color="#16a34a" />
          <Dato titulo="Con FTT" valor={resumen.conFtt} />
          <Dato titulo="Solo FTT, sin tech pack" valor={resumen.soloFtt} color={resumen.soloFtt ? '#d97706' : undefined} />
          {resumen.fueraDelPlan != null && (
            <Dato titulo="Sin OT en el plan vigente" valor={resumen.fueraDelPlan} color={resumen.fueraDelPlan ? '#d97706' : undefined} />
          )}
        </div>
      </div>

      {puedeSubirTechPacks && (
        <div className="tarjeta" style={{ background: '#f8fafc' }}>
          <h3>Subir un documento</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input
              placeholder="Orden de trabajo (ej. 7887)"
              value={ot}
              onChange={(e) => setOt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onBuscarOt()}
              disabled={trabajando}
              style={{ width: 200 }}
            />
            <button className="btn-secundario" onClick={onBuscarOt} disabled={trabajando || codigosDeOt === 'buscando'}>
              {codigosDeOt === 'buscando' ? 'Buscando...' : 'Ver los codigos de esa OT'}
            </button>
            {Array.isArray(codigosDeOt) && codigosDeOt.length > 0 && (
              <span style={{ fontSize: 13, color: '#475569' }}>Elige a cual va el documento:</span>
            )}
          </div>
          {Array.isArray(codigosDeOt) && codigosDeOt.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {codigosDeOt.map((c) => (
                <button
                  key={c.codigo}
                  className={codigo === c.codigo ? 'btn-primario' : 'btn-secundario'}
                  onClick={() => setCodigo(c.codigo)}
                  title={c.descripcion || ''}
                >
                  {c.codigo}
                  {c.descripcion ? <span style={{ fontWeight: 400, color: codigo === c.codigo ? '#e2e8f0' : '#64748b' }}> · {c.descripcion.slice(0, 40)}</span> : null}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Codigo del diseno (ej. WKD225T401)"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              disabled={trabajando}
              style={{ minWidth: 260 }}
            />
            <label className="btn-primario" style={{ cursor: trabajando ? 'wait' : 'pointer' }}>
              {trabajando ? 'Subiendo...' : 'Subir TECH PACK de empaque'}
              <input
                type="file"
                accept=".pdf,.xlsx"
                style={{ display: 'none' }}
                disabled={trabajando}
                onChange={(e) => {
                  onSubir('tp', e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <label className="btn-secundario" style={{ cursor: trabajando ? 'wait' : 'pointer' }}>
              Subir FTT (ficha de tejido)
              <input
                type="file"
                accept=".pdf,.xlsx"
                style={{ display: 'none' }}
                disabled={trabajando}
                onChange={(e) => {
                  onSubir('ftt', e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
            PDF o Excel, maximo 15 MB. Mejor PDF: el Excel se muestra como extraccion. Si el codigo ya
            tiene ese documento, lo reemplaza y sube la version.
          </p>
          {progreso && <p style={{ color: '#2563eb' }}>{progreso}</p>}
        </div>
      )}

      {error && <div className="alerta error">{error}</div>}
      {aviso && <div className="alerta ok">{aviso}</div>}

      <div className="tarjeta">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Buscar por codigo o descripcion"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} />
            Solo los que NO tienen tech pack
          </label>
          <span style={{ color: '#64748b', fontSize: 13 }}>{visibles.length} de {biblioteca.length}</span>
        </div>
        {visibles.length === 0 ? (
          <p style={{ color: '#64748b', marginTop: 10 }}>
            {biblioteca.length === 0 ? 'La biblioteca esta vacia.' : 'Nada con ese filtro.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table>
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
                    <td><strong>{b.codigo}</strong></td>
                    <td>{b.descripcion || <span style={{ color: '#94a3b8' }}>sin descripcion</span>}</td>
                    <td style={{ fontSize: 13 }}><LigueAlPlan lista={enPlan ? enPlan.get(b.codigo) : undefined} cargando={enPlan === null} /></td>
                    <td><Documento item={b} tipo="tp" onVer={setVisor} onQuitar={onQuitar} puedeEditar={puedeSubirTechPacks} ocupado={trabajando} /></td>
                    <td><Documento item={b} tipo="ftt" onVer={setVisor} onQuitar={onQuitar} puedeEditar={puedeSubirTechPacks} ocupado={trabajando} /></td>
                    <td style={{ fontSize: 13, color: '#475569' }}>
                      {fecha(b.actualizadoEn)}
                      {b.actualizadoPorNombre ? ` · ${b.actualizadoPorNombre}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="tarjeta">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Ordenes de trabajo del plan sin tech pack</h3>
          <button className="btn-secundario" onClick={onCruzar} disabled={cruce === 'cargando'}>
            {cruce === 'cargando' ? 'Cruzando...' : cruce ? 'Volver a cruzar' : 'Cruzar con el plan maestro'}
          </button>
        </div>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
          Por cada OT del plan vigente, los codigos a los que les falta el tech pack de empaque. Es lo
          que Lindbergh no va a poder pegar al encargar la tarea.
        </p>
        {Array.isArray(cruce) && (
          otsConFaltantes.length === 0 ? (
            <p style={{ color: '#16a34a', marginTop: 8 }}>Todas las OT del plan tienen tech pack para todos sus codigos.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <p style={{ color: '#b45309' }}>
                <strong>{otsConFaltantes.length}</strong> de {cruce.length} OT tienen al menos un codigo sin tech pack.
              </p>
              <table>
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
                      <td><strong>{o.ot}</strong></td>
                      <td>{o.oc || <span style={{ color: '#94a3b8' }}>sin OC</span>}</td>
                      <td>{o.destino}</td>
                      <td>
                        {o.faltan.join(', ')}
                        <span style={{ color: '#64748b' }}> ({o.faltan.length} de {o.total})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
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

function Dato({ titulo, valor, color }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || '#0f172a' }}>{valor}</div>
    </div>
  )
}

function Documento({ item, tipo, onVer, onQuitar, puedeEditar, ocupado }) {
  const m = item[TIPOS[tipo].campo]
  if (!m?.totalChunks) return <span style={{ color: tipo === 'tp' ? '#dc2626' : '#94a3b8' }}>{tipo === 'tp' ? 'FALTA' : '—'}</span>
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn-secundario" onClick={() => onVer({ codigo: item.codigo, tipo, manifiesto: m })}>
        Ver
      </button>
      <span style={{ fontSize: 12, color: '#475569' }}>
        v{m.version || 1} · {m.formato?.toUpperCase()} · {mb(m.tamano)} · {fecha(m.subidoEn)}
      </span>
      {puedeEditar && (
        <button className="btn-secundario" style={{ color: '#dc2626' }} disabled={ocupado} onClick={() => onQuitar(item, tipo)}>
          Quitar
        </button>
      )}
    </div>
  )
}

function LigueAlPlan({ lista, cargando }) {
  if (cargando) return <span style={{ color: '#94a3b8' }}>leyendo el plan...</span>
  if (!lista?.length) return <span style={{ color: '#d97706' }}>sin OT en el plan vigente</span>
  return (
    <span>
      {lista.map((x, i) => (
        <span key={x.ot}>
          {i > 0 ? ', ' : ''}
          <strong>{x.ot}</strong>
          {x.oc ? <span style={{ color: '#64748b' }}> (OC {x.oc})</span> : <span style={{ color: '#94a3b8' }}> (sin OC)</span>}
        </span>
      ))}
    </span>
  )
}
