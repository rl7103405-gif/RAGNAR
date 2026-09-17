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
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { destinoDeOt, renglonesDeLaOt, versionActiva } from '../utils/planMaestro'
import { datosDeCodigos } from '../utils/datosDelCatalogo'
import { paresPorPack } from '../utils/entregasPL'
import { nombreDeArchivo } from '../utils/plantillaTechPack'
import { normalizarOt } from '../utils/planMaestroNucleo'
import { codigosDeOtAsignada } from '../utils/tareasDiseno'
import { formatoDeArchivo, MAX_TECHPACK_BYTES } from '../utils/tareasEnsamble'
import {
  codigoComoId,
  datosDelTechPack,
  descargarDeBiblioteca,
  editarDatosTechPack,
  ErrorBiblioteca,
  escucharBiblioteca,
  aprobarTechPack,
  estaAprobado,
  guardarEnBiblioteca,
  historialDelTechPack,
  versionesDelTechPack,
  mismosDatos,
  otsPorCodigo,
  otsSinTechPack,
  quitarDeBiblioteca,
  TIPOS
} from '../utils/techPacks'
import { avanceDelTechPack, RUBROS_TECH_PACK } from '../utils/completadoTechPack'
import { agruparPorClienteYModelo, coincideTechPack, modelosDelTechPack, textoDe } from '../utils/clienteModeloTechPack'
import VisorTechPack from './VisorTechPack'
import EditorPlantillaTechPack from './EditorPlantillaTechPack'
import { escucharEdiciones, marcarEdicion, textoEdiciones } from '../utils/editandoTechPack'

const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '—')
// "WKD225T401-4-6" -> "WKD225T401": el plan trae el codigo base y una OT por
// talla; la biblioteca guarda una entrada por talla. Mismo criterio que el
// pegado por OT (techPacksDeLaOt).
const codigoBase = (c) => String(c || '').replace(/-\d{1,2}-\d{1,2}$/, '')
const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(1)} MB`

// QUE TAN COMPLETOS ESTAN LOS TECH PACKS (Roberto, 2026-09-10: "no veo el
// avance de los tech packs... hay que armar una tabla; en base al tech pack
// estandar que nos mando Lety vamos a sacar una calificacion, ese va a ser un
// diez de diez").
//
// La calificacion la calcula web/scripts/medir_tech_packs.mjs leyendo las
// HOJAS del archivo y comparandolas con las siete del estandar. Se guarda en
// el documento (`medicion`) para no bajar 120 Excel cada vez que alguien abre
// la pantalla. Si Lety llena el checklist a mano, ESE manda: ella sabe si una
// hoja esta bien llena y la app solo sabe si existe.
function AvanceDeTechPacks({ biblioteca, onVer, onEditar, puedeEditar }) {
  const [abierto, setAbierto] = useState(null)
  const filas = biblioteca.filter((b) => !b.apuntaA && b.techPack)
  const medidos = filas.filter((b) => b.medicion?.porcentaje != null)
  if (!filas.length) return null

  const rubros = RUBROS_TECH_PACK.map((r) => {
    // Lo que Lety marco a mano manda sobre lo que leyo la maquina.
    const falta = medidos.filter((b) => {
      const suyo = b.datosEditables?.checklist?.[r.id]
      if (suyo === 'no_aplica') return false
      if (suyo === 'completo') return false
      if (suyo === 'pendiente') return true
      return (b.medicion.faltan || []).includes(r.id)
    })
    return { ...r, faltan: falta.length, ejemplos: falta.slice(0, 3).map((b) => b.codigo), lista: falta }
  }).sort((a, b) => b.faltan - a.faltan)

  const promedio = medidos.length
    ? Math.round(medidos.reduce((t, b) => t + b.medicion.porcentaje, 0) / medidos.length)
    : 0
  const completos = medidos.filter((b) => b.medicion.porcentaje === 100).length
  const escalones = [
    { min: 100, etiqueta: 'Completos (10/10)', tono: 'ok' },
    { min: 80, etiqueta: 'Casi listos (8 a 9.9)', tono: '' },
    { min: 60, etiqueta: 'A medias (6 a 7.9)', tono: 'aviso' },
    { min: 0, etiqueta: 'Muy incompletos (menos de 6)', tono: 'aviso' }
  ].map((e, i, todos) => {
    const tope = i === 0 ? 101 : todos[i - 1].min
    return { ...e, cuantos: medidos.filter((b) => b.medicion.porcentaje >= e.min && b.medicion.porcentaje < tope).length }
  })

  return (
    <details className="tarjeta tp-cuadro" open>
      <summary className="tp-cuadro-cab">
        <strong style={{ fontSize: 16 }}>Que tan completos estan</strong>
        <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
          {medidos.length} medidos · promedio {(promedio / 10).toFixed(1)} de 10 · {completos} en 10
        </span>
      </summary>
      <p className="texto-suave" style={{ margin: '4px 0 10px', fontSize: 13 }}>
        Se califica contra el tech pack que Lety dio como su ejemplo al 100%: sus siete apartados valen igual.
        La app mide si el apartado ESTA; que este bien lleno lo dice Lety desde Editar, y lo que ella marque manda.
        {filas.length - medidos.length > 0 && ` ${filas.length - medidos.length} no se pueden medir (son PDF).`}
      </p>

      <div className="tp-tiles" style={{ marginBottom: 12 }}>
        {escalones.map((e) => (
          <div key={e.etiqueta} className={`tp-tile ${e.cuantos && e.tono ? 'tp-tile-' + e.tono : ''}`}>
            <div className="tp-tile-valor">{e.cuantos}</div>
            <div className="tp-tile-titulo">{e.etiqueta}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="tabla-datos">
          <thead>
            <tr>
              <th>Que falta</th>
              <th>A cuantos</th>
              <th>De cada 10</th>
              <th>Por ejemplo</th>
            </tr>
          </thead>
          <tbody>
            {rubros.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td title={r.ayuda}>
                    {/* Se abre y lista a cuales les falta, con Ver / Editar
                        (Roberto, 11-sep: "que se puedan abrir y te lleve directo"). */}
                    {r.faltan > 0 ? (
                      <button type="button" className="tp-desplegar" onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
                        {abierto === r.id ? '▾' : '▸'} {r.titulo}
                      </button>
                    ) : r.titulo}
                  </td>
                  <td>{r.faltan === 0 ? <span className="texto-suave">a ninguno</span> : r.faltan}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {medidos.length ? <Barra porcentaje={Math.round((r.faltan / medidos.length) * 100)} /> : null}
                  </td>
                  <td className="texto-suave" style={{ fontSize: 12 }}>{abierto === r.id ? '' : r.ejemplos.join(', ') + (r.faltan > 3 ? '…' : '')}</td>
                </tr>
                {abierto === r.id && (
                  <tr>
                    <td colSpan={4} style={{ padding: '4px 0 10px 18px' }}>
                      <div className="tp-lista-falta">
                        {r.lista.map((b) => (
                          <span key={b.id} className="tp-lista-falta-item">
                            <span className="tp-codigo">{b.codigo}</span>
                            <button className="btn-secundario tp-btn-chico" onClick={() => onVer(b)}>Ver</button>
                            {puedeEditar && <button className="btn-primario tp-btn-chico" onClick={() => onEditar(b)}>Editar</button>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// Barra chica para la tabla de avance.
function Barra({ porcentaje }) {
  const p = Math.max(0, Math.min(100, Number(porcentaje) || 0))
  return (
    <span style={{ display: 'inline-block', width: 90, height: 8, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden', verticalAlign: 'middle' }}>
      <span style={{ display: 'block', width: `${p}%`, height: '100%', background: p > 60 ? '#f59e0b' : '#94a3b8' }} />
    </span>
  )
}

// "73% hecho" al lado de cada tech pack (Roberto, 11-sep: "que diga setenta y
// tres por ciento hecho... pon el porcentaje o la calificacion al lado"). Al
// pasar el mouse dice que le falta. Sin medicion (los PDF) dice "sin medir" en
// gris: un hueco en blanco se leia como un error.
function PorcentajeHecho({ avance }) {
  if (!avance) {
    return (
      <span className="tp-pill tp-acc-pill tp-pill-neutro" title="Todavia no se mide (los PDF no tienen hojas). Lety lo puede calificar desde Editar.">
        sin medir
      </span>
    )
  }
  const p = avance.porcentaje
  const tono = p >= 100 ? { bg: '#dcfce7', fg: '#166534' } : p >= 60 ? { bg: '#fef3c7', fg: '#92400e' } : { bg: '#fee2e2', fg: '#991b1b' }
  return (
    <span
      className="tp-pill tp-acc-pill"
      style={{ background: tono.bg, color: tono.fg, fontWeight: 700 }}
      title={avance.faltan.length ? `Falta: ${avance.faltan.join(', ')}` : 'Completo contra el estandar de Lety'}
    >
      {p}% hecho
    </span>
  )
}

// Las acciones de UN tech pack, en el MISMO orden y del MISMO ancho en todos
// los cuadros: Editar · % hecho · Ver (Roberto, 11-sep: "algunos empiezan con
// hecho, despues ver y despues editar, esta mal... darle simetria").
function AccionesTechPack({ b, etiqueta = 'Ver tech pack', faltaTexto = 'sin tech pack', titulo, avance, puedeEditar, onEditar, onVer, onConsultar, onDesaprobar, puedeSubir, onReemplazar, onQuitar, ocupado }) {
  const tiene = Boolean(b.techPack?.totalChunks)
  return (
    <div className="tp-acciones">
      {/* Retirar el visto bueno: sale de la biblioteca y vuelve a la bandeja.
          Solo para quien puede aprobar (Lety o el admin). */}
      {onDesaprobar && tiene && (
        <button className="btn-secundario tp-btn-chico" disabled={ocupado} onClick={() => onDesaprobar(b)} title="Lo saca de la biblioteca hasta que lo vuelvas a aprobar">
          Quitar aprobación
        </button>
      )}
      {onConsultar && (
        <button className="btn-secundario tp-btn-chico" onClick={() => onConsultar(b)} title="Ver quien lo subio o lo cambio, sin entrar a Editar">
          Quién lo modificó
        </button>
      )}

      {puedeEditar && (
        <button className="btn-primario tp-btn-chico" onClick={() => onEditar(b)}>
          Editar
        </button>
      )}
      {tiene ? (
        <>
          <PorcentajeHecho avance={avance} />
          <button className="btn-secundario tp-btn-chico tp-acc-ver" title={titulo} onClick={() => onVer(b)}>
            {etiqueta}
          </button>
        </>
      ) : (
        <span className="tp-pill tp-pill-falta tp-acc-falta">{faltaTexto}</span>
      )}
    </div>
  )
}

// Una orden de compra del arbol, con sus OT y sus disenos. Vive en su propio
// componente porque ahora se pinta en DOS cuadros: el de las ordenes de compra
// de verdad y el de las OT que todavia no tienen una (Roberto, 2026-09-10).
function OrdenDeCompra({ o, resumen, mb, setVisor, avanceDe, puedeEditar, onEditar, puedeSubir, onReemplazar, onQuitar, ocupado }) {
  return (
      <details className="tp-oc" open>
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
                  <div className="tp-diseno-info">
                    <span className="tp-codigo">{g.base}</span>
                    {g.variantes.length > 1 || g.variantes[0].codigo !== g.base ? (
                      <span className="tp-meta">
                        {g.variantes.length} {g.variantes.length === 1 ? 'talla' : 'tallas'}
                      </span>
                    ) : null}
                    {g.variantes.length === 1 && (resumen.foliosDe.get(g.variantes[0].codigo) || []).length > 0 && (
                      <span className="tp-meta" title={`folios ${(resumen.foliosDe.get(g.variantes[0].codigo) || []).join(', ')}`}>
                        folios {(resumen.foliosDe.get(g.variantes[0].codigo) || []).join(', ')}
                      </span>
                    )}
                  </div>
                  {/* Una talla por renglon, apiladas y alineadas a la derecha. */}
                  <div className="tp-acciones-lista">
                    {g.variantes.map((b) => {
                      const talla = b.codigo !== g.base ? b.codigo.slice(g.base.length + 1) : ''
                      return (
                        <AccionesTechPack
                          key={b.id}
                          b={b}
                          etiqueta={talla ? `Ver talla ${talla}` : 'Ver tech pack'}
                          faltaTexto={talla ? `talla ${talla} sin tech pack` : 'sin tech pack'}
                          titulo={b.techPack ? `${b.techPack.formato?.toUpperCase()} · ${mb(b.techPack.tamano)} · v${b.techPack.version || 1}${(resumen.foliosDe.get(b.codigo) || []).length ? ' · folios ' + resumen.foliosDe.get(b.codigo).join(', ') : ''}` : undefined}
                          avance={avanceDe(b)}
                          puedeEditar={puedeEditar}
                          onEditar={onEditar}
                          onVer={(x) => setVisor({ codigo: x.codigo, tipo: 'tp', manifiesto: x.techPack })}
                          puedeSubir={puedeSubir}
                          onReemplazar={onReemplazar}
                          onQuitar={onQuitar}
                          ocupado={ocupado}
                        />
                      )
                    })}
                    {g.variantes.some((b) => b.ftt?.totalChunks) && (
                      <div className="tp-acciones">
                        {g.variantes.filter((b) => b.ftt?.totalChunks).map((b) => (
                          <button key={b.id + '-ftt'} className="btn-secundario tp-btn-chico tp-acc-ver" onClick={() => setVisor({ codigo: b.codigo, tipo: 'ftt', manifiesto: b.ftt })}>
                            Ver FTT{b.codigo !== g.base ? ` ${b.codigo.slice(g.base.length + 1)}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </details>
  )
}

export default function PanelTechPacks() {
  const { authUser, perfil, esPrueba, puedeSubirTechPacks, puedeEditarTechPacks, puedeAprobarTechPacks, puedeAsignarDiseno, esEquipoDiseno } = useAuth()
  const [biblioteca, setBiblioteca] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [progreso, setProgreso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  // El tech pack que se esta editando (null = el modal cerrado).
  const [editando, setEditando] = useState(null)
  const [consultando, setConsultando] = useState(null)
  // El editor del contenido (plantilla): datos, tablas, avios y fotos.
  const [editandoContenido, setEditandoContenido] = useState(null)
  const [codigo, setCodigo] = useState('')
  const [filtro, setFiltro] = useState('')
  const [soloSin, setSoloSin] = useState(false)
  const [visor, setVisor] = useState(null) // { codigo, tipo, manifiesto }
  // El avance de cada tech pack para la etiqueta "73% hecho". Un alias de folio
  // no tiene archivo ni medicion: se lee el de su codigo real.
  const techPackPorId = useMemo(() => {
    const m = new Map()
    for (const b of biblioteca) {
      m.set(b.id, b)
      if (b.codigo && !m.has(b.codigo)) m.set(b.codigo, b)
    }
    return m
  }, [biblioteca])
  const avanceDe = (b) => avanceDelTechPack(b?.apuntaA ? techPackPorId.get(b.apuntaA) || b : b)
  // Un alias de folio se edita en su codigo real (el alias no tiene datos propios).
  const editarTechPack = (b) => setEditando((b.apuntaA && techPackPorId.get(b.apuntaA)) || b)
  const verTechPack = (b, pantalla = 1) => setVisor({ codigo: b.codigo, tipo: 'tp', manifiesto: b.techPack, pantalla })
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

  // NUEVO TECH PACK EN LA PLANTILLA TP-QUINI (Roberto, 11-sep: "cuando se
  // crea un nuevo tech pack se genera con ese formato y todo sale igual").
  // Se arma un Excel NUEVO prellenado con lo que sabe el plan y se descarga;
  // Lety lo completa en Excel y lo sube como siempre.
  const [generando, setGenerando] = useState(false)
  const onNuevaPlantilla = async () => {
    const limpia = normalizarOt(ot)
    setError('')
    setAviso('')
    if (!limpia) {
      setError('Escribe la orden de trabajo para prellenar la plantilla (o deja el modelo en el codigo).')
      return
    }
    setGenerando(true)
    try {
      const [renglonesPlan, destino] = await Promise.all([renglonesDeLaOt(limpia), destinoDeOt(limpia)])
      const catalogo = await datosDeCodigos(renglonesPlan.map((r) => r.codigo))
      const renglones = renglonesPlan.map((r) => {
        const cat = catalogo.get(r.codigo) || {}
        return { talla: cat.talla || '', ot: limpia, codigo: r.codigo, descripcion: r.descripcion || cat.descripcion || '', docenas: r.cantidad }
      })
      // Un tech pack es de UN modelo con UN pack y UNA OC. Si la OT trae mas de
      // uno, no se elige por su cuenta: se deja vacio y se avisa (Codex, 11-sep).
      const unicos = (lista) => [...new Set(lista.filter(Boolean))]
      const modelos = unicos(renglonesPlan.map((r) => catalogo.get(r.codigo)?.modelo))
      const modelo = codigo || (modelos.length === 1 ? modelos[0] : '')
      const packsVistos = unicos(renglones.map((r) => paresPorPack(r.descripcion)))
      const pares = packsVistos.length === 1 ? packsVistos[0] : undefined
      const ocs = unicos(renglonesPlan.map((r) => r.oc))
      const avisosOt = []
      if (modelos.length > 1) avisosOt.push(`la OT trae ${modelos.length} modelos (${modelos.join(', ')}): un tech pack es de un solo modelo, revisa`)
      if (packsVistos.length > 1) avisosOt.push(`las descripciones dicen packs distintos (${packsVistos.join(', ')}): el pack se dejo vacio`)
      const { cargarWorkbook } = await import('../utils/excelJs.js')
      const { generarPlantillaTechPack, descargarLibro } = await import('../utils/generarPlantillaTechPack.js')
      const { LOGO_QUINI_PNG_BASE64 } = await import('../assets/logoQuini.js')
      const Workbook = await cargarWorkbook()
      const libro = generarPlantillaTechPack({
        Workbook,
        logoBase64: LOGO_QUINI_PNG_BASE64,
        datos: {
          ot: limpia,
          // v2: el tech pack no lleva OC, OT ni docenas a la vista. De que orden
          // se armo queda OCULTO en _RAGNAR (Roberto, 15-sep: "que no se vea,
          // chance nos sirve").
          pedidoAnterior: renglones.length
            ? { oc: ocs.join(', '), packs: null, renglones: renglones.map((r) => ({ codigo: r.codigo, talla: r.talla, ot: r.ot, docenas: r.docenas ?? null })) }
            : null,
          cliente: destino || renglonesPlan.find((r) => r.destino)?.destino || '',
          modelo,
          paresPorPack: pares,
          elaboro: perfil?.nombre || perfil?.nombreCompleto || '',
          renglones,
          generadoPorUid: authUser?.uid || '',
          generadoPorNombre: perfil?.nombre || perfil?.nombreCompleto || ''
        }
      })
      await descargarLibro(libro, nombreDeArchivo(modelo || `OT ${limpia}`))
      setAviso(
        renglones.length
          ? `Plantilla de la OT ${limpia} descargada con ${renglones.length} ${renglones.length === 1 ? 'codigo' : 'codigos'} del plan${pares ? ` y pack de ${pares}` : ''}. Completala en Excel y subela aqui mismo.${avisosOt.length ? ' OJO: ' + avisosOt.join('; ') + '.' : ''}`
          : `Plantilla descargada. La OT ${limpia} no esta en el plan: la tabla del pedido va vacia, llenala en Excel.`
      )
    } catch (err) {
      console.error('[TechPacks] plantilla:', err)
      setError('No se pudo armar la plantilla: ' + (err?.message || String(err)))
    } finally {
      setGenerando(false)
    }
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
      // usuario-real (10-sep): una OT cargada a mano en Tareas de diseno no
      // esta en el plan, pero SUS codigos si estan en la asignacion. Se
      // buscan ahi antes de mandar a nadie a copiarlos de la otra pestana.
      if (!lista.length && (puedeAsignarDiseno || esEquipoDiseno)) {
        const deAsignacion = await codigosDeOtAsignada({ ot: limpia, uid: authUser?.uid, esPrueba, alcance: puedeAsignarDiseno ? 'jefa' : 'mias' }).catch((e) => { console.warn('[TechPacks] codigos de la asignacion:', e); return [] })
        if (deAsignacion.length) {
          setCodigosDeOt(deAsignacion)
          setAviso(`La OT ${limpia} no esta en el plan; estos codigos vienen de tu asignacion en Tareas de diseno.`)
          if (deAsignacion.length === 1) setCodigo(deAsignacion[0].codigo)
          return
        }
      }
      setCodigosDeOt(lista)
      if (!lista.length) {
        setError(`El plan vigente no conoce la OT ${limpia}. Si la cargaste a mano en Tareas de diseno, escribe el codigo directo (esta en tu asignacion); si es del plan, pide a Adrian que la suba.`)
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
    // Si ese codigo YA tiene tech pack, se dice cual y se pregunta: antes se
    // reemplazaba sin avisar (usuario-real como Lety, 15-sep).
    const existente = techPackPorId.get(esPrueba && !id.startsWith('ZZTEST') ? 'ZZTEST' + id : id)
    const previo = existente?.[TIPOS[tipo].campo]
    if (previo) {
      const quien = [textoDe(existente.cliente), modelosDelTechPack(existente).join(', ')].filter(Boolean).join(' · ')
      if (!window.confirm(`${existente.codigo} ya tiene ${TIPOS[tipo].titulo.toLowerCase()}${quien ? ` (${quien})` : ''}, version ${previo.version || 1}. Lo vas a REEMPLAZAR por "${file.name}". ¿Seguir?`)) return
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
      // Ya no se habla de OT ni de Adrian: el estandar es cliente y modelo, que
      // salen de la plantilla y se ven en la vista de abajo.
      setAviso(
        `${TIPOS[tipo].titulo} de ${idFinal || id} guardado.` +
          (tipo === 'tp' ? ' Queda con el cliente y el modelo que dice su plantilla (si es PDF, sin cliente).' : '')
      )
      setCruce(null)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(false)
    }
  }

  // Reemplazar el archivo de un codigo que YA tiene tech pack, desde su renglon.
  const onReemplazar = async (item, file) => {
    if (!file) return
    setError('')
    setAviso('')
    const formato = formatoDeArchivo(file.name)
    if (!formato) { setError('El archivo tiene que ser .pdf o .xlsx.'); return }
    if (file.size > MAX_TECHPACK_BYTES) { setError(`El archivo pesa ${mb(file.size)} y el tope son 15 MB.`); return }
    if (!window.confirm(`¿Reemplazar el tech pack de ${item.codigo} por "${file.name}"? El anterior queda en el historial de versiones.`)) return
    setTrabajando(true)
    try {
      await guardarEnBiblioteca({ codigo: item.codigo, tipo: 'tp', contenido: await file.arrayBuffer(), nombre: file.name, formato, usuario, esPrueba, onProgreso: setProgreso })
      setAviso(`Tech pack de ${item.codigo} reemplazado (version ${(item.techPack?.version || 1) + 1}).`)
      setCruce(null)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(false)
    }
  }

  // Aprobar (o retirar el visto bueno). La aprobación es de ESTA versión del
  // archivo: si alguien subió otra mientras se revisaba, el servidor lo rechaza
  // y aquí se dice por qué (Codex, 16-sep).
  const onAprobar = async (item, aprobar) => {
    if (!aprobar && !window.confirm(`¿Quitarle la aprobación a ${item.codigo}? Sale de la biblioteca hasta que lo vuelvas a aprobar.`)) return
    setTrabajando(true)
    setError('')
    try {
      await aprobarTechPack({ codigo: item.codigo, techPack: item.techPack, usuario, aprobar })
      setAviso(
        aprobar
          ? `${item.codigo} aprobado: ya está en la biblioteca y se le puede mandar a una maquila.`
          : `${item.codigo} salió de la biblioteca: vuelve a "Por aprobar".`
      )
    } catch (err) {
      reportar(err)
    } finally {
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

  // DESCARGAR LA BIBLIOTECA A EXCEL (Lety, 8-sep): "que lo pueda descargar y
  // trabajarlo como lo tenemos". Sale lo que se ve en la tabla, con el ligue a
  // OT/OC del plan, para que se pueda seguir usando fuera de la app.
  const descargarExcel = async () => {
    try {
      const { cargarWorkbook } = await import('../utils/excelJs.js')
      const Workbook = await cargarWorkbook()
      const libro = new Workbook()
      const hoja = libro.addWorksheet('Tech packs')
      hoja.columns = [
        { header: 'Codigo', key: 'codigo', width: 20 },
        { header: 'Cliente', key: 'cliente', width: 22 },
        { header: 'Marca', key: 'marca', width: 18 },
        { header: 'Modelo (plantilla)', key: 'modeloPlantilla', width: 24 },
        { header: 'Modelo', key: 'modelo', width: 18 },
        { header: 'Descripcion', key: 'descripcion', width: 42 },
        { header: 'Talla', key: 'talla', width: 16 },
        { header: 'Color', key: 'color', width: 30 },
        { header: 'Tech pack', key: 'tp', width: 12 },
        { header: 'FTT', key: 'ftt', width: 10 },
        { header: 'Archivo', key: 'archivo', width: 40 },
        { header: 'Ordenes de trabajo', key: 'ots', width: 26 },
        { header: 'Folios de ficha', key: 'folios', width: 26 },
        { header: 'Lo subio', key: 'quien', width: 18 },
        { header: 'Cuando', key: 'cuando', width: 14 },
        { header: 'Nombre puesto por', key: 'nombrePuestoPor', width: 16 }
      ]
      hoja.getRow(1).font = { bold: true }
      const lista = biblioteca.filter((b) => !b.apuntaA)
      lista.forEach((b) => {
        const ots = enPlan
          ? [...new Set([...(enPlan.get(b.codigo) || []), ...(enPlan.get(codigoBase(b.codigo)) || [])].map((x) => x.ot))]
          : []
        const datos = datosDelTechPack(b)
        hoja.addRow({
          codigo: b.codigo,
          cliente: textoDe(b.cliente),
          marca: textoDe(b.marca),
          modeloPlantilla: textoDe(b.modeloPlantilla),
          modelo: datos.modelo || '',
          descripcion: b.descripcion || '',
          talla: datos.talla || '',
          color: datos.color || '',
          tp: b.techPack?.totalChunks ? 'SI' : 'NO',
          ftt: b.ftt?.totalChunks ? 'SI' : 'NO',
          archivo: b.techPack?.nombre || '',
          ots: ots.join(', '),
          folios: (resumen.foliosDe.get(b.codigo) || []).join(', '),
          quien: b.actualizadoPorNombre || b.creadoPorNombre || '',
          cuando: fecha(b.actualizadoEn || b.creadoEn),
          nombrePuestoPor: b.datosEditables?.modelo ? 'Lety' : 'catalogo'
        })
      })
      const buf = await libro.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Tech packs ${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[TechPacks] No se pudo generar el Excel:', err)
      setError('No se pudo generar el Excel: ' + (err?.message || err))
    }
  }

  const visibles = useMemo(() => {
    return biblioteca.filter((b) => !b.apuntaA).filter((b) => {
      if (soloSin && b.techPack?.totalChunks) return false
      // Se busca por CLIENTE y MARCA ademas de codigo, modelo, talla y color
      // (Roberto, 2026-09-15: el estandar es modelo + cliente). Todas las
      // palabras tienen que aparecer, sin importar acentos ni mayusculas.
      return coincideTechPack(b, filtro)
    })
  }, [biblioteca, filtro, soloSin])

  // LA VISTA ESTANDAR: cliente -> modelo -> tech packs (Roberto, 2026-09-15:
  // "ya no se manejan por OC ni OT sino por modelo y cliente").
  // LO QUE ESPERA EL VISTO BUENO DE LETY (Roberto, 16-sep). Mientras no lo
  // apruebe no entra a la biblioteca ni se le puede mandar a una maquila: por
  // eso sale en su propia bandeja y NO en la vista por cliente y modelo.
  const porAprobar = useMemo(
    () => biblioteca.filter((b) => !b.apuntaA && b.techPack?.totalChunks && !estaAprobado(b)),
    [biblioteca]
  )
  const aprobados = useMemo(() => biblioteca.filter((b) => b.apuntaA || !b.techPack?.totalChunks || estaAprobado(b)), [biblioteca])
  const porCliente = useMemo(() => agruparPorClienteYModelo(aprobados), [aprobados])
  const totalClientes = porCliente.filter((c) => c.clave !== '~SIN').length
  const totalTechPacksCliente = porCliente.reduce((n, c) => n + c.total, 0)

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
      // Y los codigos que LETY declaro a mano (2026-09-10). Es lo que saca del
      // ultimo cuadro a los tech packs viejos, cuyo pedido es anterior al plan
      // que Adrian empezo a subir en agosto: la app no los puede adivinar.
      ;(b.datosEditables?.codigos || []).forEach((c) => agrega(enPlan.get(String(c).toUpperCase())))
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
    // Roberto (2026-09-10): tres cuadros que se abren y se cierran, en vez de
    // una sola lista larga. Las OC de verdad por un lado, las OT que todavia
    // no tienen orden de compra por otro, y lo que no cuelga de nada al final.
    const conOc = ocs.filter((o) => o.oc !== 'SIN OC')
    const sinOc = ocs.filter((o) => o.oc === 'SIN OC')
    return {
      ocs,
      conOc,
      sinOc,
      otsSinOc: sinOc.reduce((n, o) => n + o.ots.length, 0),
      sinOrden: sinOrden.sort((x, y) => x.codigo.localeCompare(y.codigo)),
      totalConOrden
    }
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
            El tech pack de empaque de cada código, ordenado por cliente y modelo.
          </p>
        </div>
        {/* Sin FTT ni "Sin OT en el plan" (Roberto, 15-sep: la ficha de tejido no
            se va a usar y la OT ya no es el estandar). */}
        <div className="tp-tiles">
          <Tile titulo="Codigos" valor={resumen.total} />
          <Tile titulo="Clientes" valor={totalClientes} />
          <Tile titulo="Con tech pack" valor={resumen.conTp} tono="ok" />
        </div>
      </div>

      {error && <div className="alerta-error">{error}</div>}
      {aviso && <div className="alerta-exito">{aviso}</div>}

      {/* ------------------------------------------------ BUSCAR: lo PRIMERO */}
      {/* Dos correcciones seguidas: primero estaba dentro de la lista plegada
          y no se encontraba; luego quedo arriba de la lista pero abajo del
          arbol, o sea a media pagina. Va aqui, pegado a la cabecera, porque
          buscar un tech pack es lo que mas se hace en esta pantalla. */}
      <div className="tarjeta tp-buscador">
        <label className="tp-busca-caja">
          <svg className="tp-busca-lupa" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <input
            className="tp-busca-input"
            type="search"
            aria-label="Buscar un tech pack"
            placeholder="Busca un tech pack por modelo, cliente o código"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
          {filtro && (
            <button type="button" className="tp-busca-limpiar" onClick={() => setFiltro('')} aria-label="Limpiar la búsqueda">×</button>
          )}
        </label>
        <div className="tp-fila" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          <span className="texto-suave" style={{ fontSize: 13 }}>Por ejemplo: CHEDRAUI, WKD225T401 o RAYAS</span>
          <div className="tp-fila" style={{ gap: 10 }}>
            <label className="tp-check">
              <input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} />
              Solo los que no tienen tech pack
            </label>
            <button className="btn-secundario tp-btn-chico" onClick={descargarExcel} disabled={!biblioteca.length}>
              Descargar Excel
            </button>
          </div>
        </div>
        {(filtro || soloSin) && (
          <div style={{ marginTop: 12 }}>
            <div className="texto-suave" style={{ fontSize: 13, marginBottom: 6 }}>
              {visibles.length === 0
                ? 'Nada con esa busqueda.'
                : `${visibles.length} ${visibles.length === 1 ? 'resultado' : 'resultados'}`}
            </div>
            <div className="tp-resultados">
              {visibles.slice(0, 30).map((b) => (
                <div key={b.id} className="tp-diseno">
                  <div className="tp-diseno-info">
                    <span className="tp-codigo">{b.codigo}</span>
                    {textoDe(b.cliente) ? <span className="tp-meta" title={textoDe(b.marca) ? `${textoDe(b.cliente)} · ${textoDe(b.marca)}` : textoDe(b.cliente)}><strong>{textoDe(b.cliente)}</strong></span> : null}
                    {/* Todos los modelos del tech pack, para que se entienda por que salio
                        (buscar RB10T101 trae RB10T100, que los lleva los tres). */}
                    {modelosDelTechPack(b).length ? <span className="tp-meta" title={modelosDelTechPack(b).join(', ')}>modelo {modelosDelTechPack(b).join(', ')}</span> : null}
                    {b.descripcion ? <span className="tp-meta" title={b.descripcion}>{b.descripcion}</span> : null}
                  </div>
                  <div className="tp-acciones-lista">
                    <AccionesTechPack b={b} avance={avanceDe(b)} puedeEditar={puedeEditarTechPacks} onEditar={editarTechPack} onVer={verTechPack} onConsultar={setConsultando} onDesaprobar={puedeAprobarTechPacks ? (x) => onAprobar(x, false) : null} puedeSubir={puedeSubirTechPacks} onReemplazar={onReemplazar} onQuitar={onQuitar} ocupado={trabajando} />
                    {b.ftt?.totalChunks ? (
                      <div className="tp-acciones">
                        <button className="btn-secundario tp-btn-chico tp-acc-ver" onClick={() => setVisor({ codigo: b.codigo, tipo: 'ftt', manifiesto: b.ftt })}>
                          Ver FTT
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {visibles.length > 30 && (
                <div className="texto-suave" style={{ fontSize: 12 }}>
                  ...y {visibles.length - 30} mas. Afina la busqueda o abre la lista completa.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------- el arbol, en TRES cuadros que se
          abren y se cierran (Roberto, 2026-09-10). Cada uno responde a una
          pregunta distinta: que hay por orden de compra, que trae orden de
          trabajo pero todavia no de compra, y que no cuelga de nada. */}
      {/* ---------------------------------- POR APROBAR. Lo que subió el equipo
          y espera el visto bueno de Lety (Roberto, 16-sep). Va PRIMERO: es lo
          único de esta pantalla que tiene a alguien esperando. */}
      {porAprobar.length > 0 && (
        <div className="tarjeta tp-cuadro" style={{ borderLeft: '4px solid #d97706' }}>
          <div className="tp-cuadro-cab">
            <strong style={{ fontSize: 16 }}>Por aprobar ({porAprobar.length})</strong>
            <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
              {puedeAprobarTechPacks
                ? 'Revísalos y apruébalos: hasta entonces no entran a la biblioteca ni se le pueden mandar a una maquila.'
                : 'Ya se subieron. Entran a la biblioteca cuando Lety los apruebe.'}
            </span>
          </div>
          <div className="tp-disenos">
            {porAprobar.map((b) => (
              <div key={b.id} className="tp-diseno">
                <div className="tp-diseno-info">
                  <span className="tp-codigo">{b.codigo}</span>
                  {textoDe(b.cliente) ? <span className="tp-meta"><strong>{textoDe(b.cliente)}</strong></span> : <span className="tp-meta texto-suave">sin cliente</span>}
                  {modelosDelTechPack(b).length ? <span className="tp-meta">{modelosDelTechPack(b).join(', ')}</span> : null}
                  {(b.codigosCubiertos || []).length > 1 && (
                    <span className="tp-meta" title={b.codigosCubiertos.join(', ')}>cubre {b.codigosCubiertos.length} códigos</span>
                  )}
                  {b.medicion?.porcentaje != null && (
                    <span className="tp-meta" title={(b.medicion.faltan || []).join(', ')}>
                      calificación {b.medicion.porcentaje}%{(b.medicion.faltan || []).length ? ` · falta ${b.medicion.faltan.join(', ')}` : ''}
                    </span>
                  )}
                  <span className="tp-meta texto-suave" style={{ fontSize: 12 }}>
                    lo subió {b.techPack?.subidoPorNombre || '?'} · {fecha(b.techPack?.subidoEn)}
                  </span>
                </div>
                <div className="tp-acciones">
                  <button className="btn-secundario tp-btn-chico" onClick={() => verTechPack(b)}>Ver tech pack</button>
                  {puedeAprobarTechPacks && (
                    <button className="btn-primario tp-btn-chico" disabled={trabajando} onClick={() => onAprobar(b, true)}>
                      Aprobar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------- LA VISTA ESTANDAR: por cliente y
          modelo (Roberto, 2026-09-15). Va antes que el arbol de ordenes. */}
      {porCliente.length > 0 && (
        <details className="tarjeta tp-cuadro" open>
          <summary className="tp-cuadro-cab">
            <strong style={{ fontSize: 16 }}>Por cliente y modelo</strong>
            <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
              {totalClientes} {totalClientes === 1 ? 'cliente' : 'clientes'} · {totalTechPacksCliente} {totalTechPacksCliente === 1 ? 'tech pack' : 'tech packs'}
            </span>
          </summary>
          <p className="texto-suave" style={{ margin: '4px 0 8px', fontSize: 13 }}>
            El estándar: cada tech pack es de un cliente y un modelo, tal como viene escrito en su plantilla.
            Si un tech pack trae varios modelos, aparece bajo cada uno.
          </p>
          <div className="tp-arbol">
            {porCliente.map((c) => (
              <details key={c.clave} className="tp-oc">
                <summary>
                  <span className="tp-oc-titulo">{c.cliente}</span>
                  <span className="texto-suave">
                    {' '}· {c.modelos.length} {c.modelos.length === 1 ? 'modelo' : 'modelos'} · {c.total} {c.total === 1 ? 'tech pack' : 'tech packs'}
                  </span>
                  {c.grafias.length > 1 && (
                    <span className="texto-suave" style={{ fontSize: 12 }}>(también escrito: {c.grafias.filter((g) => g !== c.cliente).join(', ')})</span>
                  )}
                </summary>
                {c.modelos.map((m) => (
                  <div key={m.clave} className="tp-ot">
                    <div className="tp-ot-cab">
                      <span className="tp-ot-num">{m.modelo}</span>
                      <span className="texto-suave"> · {m.techPacks.length} {m.techPacks.length === 1 ? 'tech pack' : 'tech packs'}</span>
                      {m.tallas.length > 1 && (
                        <span className="texto-suave"> · {m.tallas.length} tallas: {m.tallas.map((t) => t.talla).join(' · ')}</span>
                      )}
                    </div>
                    {/* Las tallas de un mismo modelo solo se distinguian por el final
                        del codigo (Roberto, 15-sep: "divide las tallas"). */}
                    {m.tallas.map((t) => (
                    <div key={t.clave} className="tp-talla">
                    <div className="tp-talla-cab">Talla {t.talla}</div>
                    <div className="tp-disenos">
                      {t.techPacks.map((b) => (
                        <div key={b.id} className="tp-diseno">
                          <div className="tp-diseno-info">
                            <span className="tp-codigo">{b.codigo}</span>
                            {/* El modelo ya esta en el encabezado del grupo, y sale de
                                la plantilla: aqui solo los OTROS modelos del mismo
                                tech pack, para no mostrar el del catalogo, que puede
                                decir otra cosa (code-reviewer, 15-sep). */}
                            {modelosDelTechPack(b).length > 1 && (
                              <span className="tp-meta">tambien {modelosDelTechPack(b).filter((x) => x !== m.modelo).join(', ')}</span>
                            )}
                            {b.descripcion && !/^Drive:/i.test(b.descripcion) ? <span className="tp-meta" title={b.descripcion}>{b.descripcion}</span> : null}
                            {/* Lo que antes solo decia la lista completa: version y quien lo cambio. */}
                            <span className="tp-meta texto-suave" style={{ fontSize: 12 }}>
                              {b.techPack?.version ? `v${b.techPack.version} · ` : ''}{fecha(b.actualizadoEn)}{b.actualizadoPorNombre ? ` · ${b.actualizadoPorNombre}` : ''}
                            </span>
                          </div>
                          <div className="tp-acciones-lista">
                            <AccionesTechPack b={b} avance={avanceDe(b)} puedeEditar={puedeEditarTechPacks} onEditar={editarTechPack} onVer={verTechPack} onConsultar={setConsultando} onDesaprobar={puedeAprobarTechPacks ? (x) => onAprobar(x, false) : null} puedeSubir={puedeSubirTechPacks} onReemplazar={onReemplazar} onQuitar={onQuitar} ocupado={trabajando} />
                            {b.ftt?.totalChunks ? (
                              <div className="tp-acciones">
                                <button className="btn-secundario tp-btn-chico tp-acc-ver" onClick={() => setVisor({ codigo: b.codigo, tipo: 'ftt', manifiesto: b.ftt })}>
                                  Ver FTT
                                </button>
                                {puedeSubirTechPacks && (
                                  <button className="btn-secundario tp-btn-chico" disabled={trabajando} onClick={() => onQuitar(b, 'ftt')}>
                                    Quitar FTT
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    </div>
                    ))}
                  </div>
                ))}
              </details>
            ))}
          </div>
        </details>
      )}

      {/* ---------------------------------- el arbol OC/OT se conserva, plegado
          (Roberto, 2026-09-15: "lo de OC/OT no se debe perder"). */}
      {/* Abierto cuando no hay vista por cliente (biblioteca vacia o todavia
          cargando): si no, el aviso de "no hay nada" quedaba escondido. */}
      <details className="tarjeta tp-cuadro" open={porCliente.length === 0}>
        <summary className="tp-cuadro-cab">
          <strong style={{ fontSize: 16 }}>Buscar por orden de compra u orden de trabajo</strong>
        </summary>
        <p className="texto-suave" style={{ margin: '4px 0 10px', fontSize: 13 }}>
          La forma anterior: cada tech pack cuelga de las órdenes del plan maestro. Sirve para ver qué tech packs lleva una orden; el estándar es por cliente y modelo.
        </p>
      {enPlan === null ? (
        <div>
          <p className="texto-suave" style={{ margin: 0 }}>Leyendo el plan maestro...</p>
        </div>
      ) : arbol.conOc.length === 0 && arbol.sinOc.length === 0 && arbol.sinOrden.length === 0 ? (
        <div>
          <div className="tp-vacio">
            <div className="tp-vacio-titulo">Todavia no hay nada en la biblioteca</div>
          </div>
        </div>
      ) : (
        <>
          <details className="tp-cuadro" open>
            <summary className="tp-cuadro-cab">
              <strong style={{ fontSize: 16 }}>Por orden de compra</strong>
              <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
                {arbol.conOc.length} {arbol.conOc.length === 1 ? 'orden de compra' : 'ordenes de compra'}
                {' · '}
                {arbol.conOc.reduce((n, o) => n + o.ots.length, 0)} de trabajo
              </span>
            </summary>
            <p className="texto-suave" style={{ margin: '4px 0 8px', fontSize: 13 }}>
              Cada tech pack cuelga de la orden de trabajo que le da el plan, por su codigo o por sus folios de ficha.
            </p>
            {arbol.conOc.length === 0 ? (
              <p className="texto-suave" style={{ margin: '8px 0 0 12px' }}>Ninguna todavia.</p>
            ) : (
              <div className="tp-arbol">
                {arbol.conOc.map((o) => (
                  <OrdenDeCompra key={o.oc} o={o} resumen={resumen} mb={mb} setVisor={setVisor} avanceDe={avanceDe} puedeEditar={puedeEditarTechPacks} onEditar={editarTechPack} puedeSubir={puedeSubirTechPacks} onReemplazar={onReemplazar} onQuitar={onQuitar} ocupado={trabajando} />
                ))}
              </div>
            )}
          </details>

          <details className="tp-cuadro" style={{ marginTop: 12 }}>
            <summary className="tp-cuadro-cab">
              <strong style={{ fontSize: 16 }}>Sin orden de compra</strong>
              <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
                {arbol.otsSinOc} {arbol.otsSinOc === 1 ? 'orden de trabajo' : 'ordenes de trabajo'}
              </span>
            </summary>
            <p className="texto-suave" style={{ margin: '4px 0 8px', fontSize: 13 }}>
              Tienen orden de trabajo en el plan, pero el plan no dice a que orden de compra pertenecen.
            </p>
            {arbol.sinOc.length === 0 ? (
              <p className="texto-suave" style={{ margin: '8px 0 0 12px' }}>Ninguna: todas las OT traen su orden de compra.</p>
            ) : (
              <div className="tp-arbol">
                {arbol.sinOc.map((o) => (
                  <OrdenDeCompra key={o.oc} o={o} resumen={resumen} mb={mb} setVisor={setVisor} avanceDe={avanceDe} puedeEditar={puedeEditarTechPacks} onEditar={editarTechPack} puedeSubir={puedeSubirTechPacks} onReemplazar={onReemplazar} onQuitar={onQuitar} ocupado={trabajando} />
                ))}
              </div>
            )}
          </details>

          <details className="tp-cuadro" style={{ marginTop: 12 }}>
            <summary className="tp-cuadro-cab">
              <strong style={{ fontSize: 16 }}>Sin orden de compra ni de trabajo</strong>
              <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
                {arbol.sinOrden.length} {arbol.sinOrden.length === 1 ? 'diseno' : 'disenos'}
              </span>
            </summary>
            <p className="texto-suave" style={{ margin: '4px 0 8px', fontSize: 13 }}>
              Desarrollos que aun no son pedido, o que Adrian todavia no ha subido al plan. Aqui caen tambien los
              tech packs que se cargaron sin ligar a ningun codigo del plan.
            </p>
            {arbol.sinOrden.length === 0 ? (
              <p className="texto-suave" style={{ margin: '8px 0 0 12px' }}>Ninguno: todos cuelgan de una OT.</p>
            ) : (
              <div className="tp-disenos">
                {arbol.sinOrden.map((b) => (
                  <div key={b.id} className="tp-diseno">
                    <div className="tp-diseno-info">
                      <span className="tp-codigo">{b.codigo}</span>
                      {b.descripcion ? <span className="tp-meta" title={b.descripcion}>{b.descripcion}</span> : null}
                    </div>
                    {/* Editar AQUI mismo (2026-09-11): este cuadro es donde Lety
                        liga cada tech pack a sus codigos u ordenes. */}
                    <div className="tp-acciones-lista">
                      <AccionesTechPack b={b} avance={avanceDe(b)} puedeEditar={puedeEditarTechPacks} onEditar={editarTechPack} onVer={verTechPack} onConsultar={setConsultando} onDesaprobar={puedeAprobarTechPacks ? (x) => onAprobar(x, false) : null} puedeSubir={puedeSubirTechPacks} onReemplazar={onReemplazar} onQuitar={onQuitar} ocupado={trabajando} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </details>
        </>
      )}
      </details>

      {/* ------------------------------------------------ subir, en dos pasos */}
      {puedeSubirTechPacks && (
        <div className="tarjeta tp-subir">
          {/* Titulo del cuadro (Roberto, 15-sep: "no esta muy bien indicado"). */}
          <div className="tp-subir-cab">
            <h2 style={{ margin: 0 }}>Agregar un tech pack</h2>
            <p className="texto-suave" style={{ margin: '4px 0 0' }}>
              Sube el tech pack de un código, o reemplaza el que ya tiene.
            </p>
          </div>
          <div className="tp-paso">
            <span className="tp-num">1</span>
            <div style={{ flex: 1 }}>
              {/* El codigo va PRIMERO (Roberto, 2026-09-15: el estandar es
                  modelo + cliente, ya no la OT). La OT queda como ayuda para
                  quien no se sabe el codigo. */}
              <h3 style={{ margin: 0 }}>¿De qué código es?</h3>
              <p className="texto-suave" style={{ margin: '4px 0 10px' }}>
                Escribe el código del diseño. Si no lo sabes, búscalo abajo por su orden de trabajo.
              </p>
              <div className="tp-fila">
                <input
                  className="tp-input"
                  placeholder="Código del diseño (ej. WKD225T401)"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                  disabled={trabajando}
                  style={{ width: '100%', maxWidth: 320, fontSize: 16 }}
                />
                {/* Descargar la plantilla no escribe nada: el admin (Roberto)
                    tambien puede, para probarla. Editar sigue siendo solo de desarrollo.
                    Sigue usando la OT de abajo si se escribio. */}
                {puedeSubirTechPacks && (
                  <button
                    className="btn-primario"
                    onClick={onNuevaPlantilla}
                    disabled={trabajando || generando}
                    title="Descarga un Excel nuevo en el formato TP-Quini, prellenado con lo que el plan sabe de la OT que escribas abajo"
                  >
                    {generando ? 'Armando...' : 'Nuevo tech pack (plantilla)'}
                  </button>
                )}
              </div>
              <div className="tp-fila" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                <span className="texto-suave" style={{ fontSize: 13 }}>¿No sabes el código? Búscalo por orden de trabajo:</span>
                <input
                  className="tp-input"
                  placeholder="Orden de trabajo (ej. 7887)"
                  value={ot}
                  onChange={(e) => setOt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onBuscarOt()}
                  disabled={trabajando}
                  style={{ width: '100%', maxWidth: 200 }}
                />
                <button className="btn-secundario tp-btn-chico" onClick={onBuscarOt} disabled={trabajando || codigosDeOt === 'buscando'}>
                  {codigosDeOt === 'buscando' ? 'Buscando...' : 'Ver sus códigos'}
                </button>
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
                <span className="texto-suave" style={{ fontSize: 13 }}>
                  PDF o Excel, maximo 15 MB. Mejor PDF. Si ya habia uno, lo reemplaza y sube la version.
                </span>
              </div>
              {progreso && <p className="tp-progreso">{progreso}</p>}
            </div>
          </div>
        </div>
      )}

      {consultando && <ModalConsultarTechPack item={consultando} onCerrar={() => setConsultando(null)} />}

      <AvanceDeTechPacks biblioteca={biblioteca} onVer={verTechPack} onEditar={editarTechPack} puedeEditar={puedeEditarTechPacks} />

      {/* El cuadro "Que me falta por subir, segun el plan" (cruce con el plan
          maestro por OT) se quito el 15-sep: Roberto, "ya lo estamos viendo por
          cliente y modelo, no por OT ni OC". Lo pendiente se ve con "Solo los
          que no tienen tech pack" del buscador. onCruzar queda por si vuelve. */}

      {editando && (

        <ModalEditarTechPack
          key={editando.codigo}
          item={editando}
          usuario={{ uid: authUser?.uid || '', nombre: perfil?.nombreCompleto || '' }}
          onCerrar={() => setEditando(null)}
          onGuardado={(msg) => { setEditando(null); setAviso(msg) }}
          puedeSubir={puedeSubirTechPacks}
          esPrueba={esPrueba}
          ocupado={trabajando}
          onVer={(b, pantalla) => { setEditando(null); verTechPack(b, pantalla) }}
          onEditarContenido={(b) => { setEditando(null); setEditandoContenido(b) }}
          onReemplazar={async (b, f) => { await onReemplazar(b, f); setEditando(null) }}
          onQuitar={async (b) => { setEditando(null); await onQuitar(b, 'tp') }}

        />

      )}

      {editandoContenido && (
        <EditorPlantillaTechPack
          key={editandoContenido.codigo}
          item={editandoContenido}
          usuario={{ uid: authUser?.uid || '', nombre: perfil?.nombreCompleto || '' }}
          esPrueba={esPrueba}
          onCerrar={() => setEditandoContenido(null)}
          onGuardado={(msg) => { setEditandoContenido(null); setAviso(msg); setCruce(null) }}
        />
      )}

      {visor && (
        <VisorTechPack
          techPack={visor.manifiesto}
          pantalla={visor.pantalla || 1}
          avance={visor.tipo === 'tp' ? avanceDe(techPackPorId.get(visor.codigo)) : null}
          cargar={() => descargarDeBiblioteca({ codigo: visor.codigo, tipo: visor.tipo, manifiesto: visor.manifiesto })}
          onCerrar={() => setVisor(null)}
        />
      )}
    </div>
  )
}

// El nombre del modelo, con el de Lety por encima del del catalogo. Cuando el
// catalogo solo repite el codigo (pasa en 22 de los 38) no se pinta nada: es
// ruido, y peor, hace creer que el dato esta puesto.
function NombreDelModelo({ item, corto = false }) {
  const d = datosDelTechPack(item)
  const propio = Boolean(item?.datosEditables?.modelo)
  if (!d.modelo || (!propio && d.modelo === item?.codigo)) {
    return corto ? null : <span className="texto-suave">sin nombre</span>
  }
  return (
    <>
      <span className="tp-pill">{d.modelo}</span>
      {d.color ? <span className="texto-suave" style={{ fontSize: 12, marginLeft: 6 }}>{d.color}</span> : null}
    </>
  )
}

// EDITAR UN TECH PACK. Todo lo que Lety pidio teclear, en una sola pantalla, y
// el historial de quien lo toco debajo.
function ModalEditarTechPack({ item, usuario, onCerrar, onGuardado, puedeSubir = false, esPrueba = false, ocupado = false, onVer, onReemplazar, onQuitar, onEditarContenido }) {
  // Aviso en vivo si alguien mas lo tiene abierto (Roberto, 14-sep).
  const [otros, setOtros] = useState([])
  useEffect(() => {
    const quitar = marcarEdicion({ codigo: item.codigo, usuario, esPrueba, que: 'datos' })
    const dejar = escucharEdiciones({ codigo: item.codigo, miUid: usuario?.uid, alRecibir: setOtros })
    return () => { quitar(); dejar() }
  }, [item.codigo, usuario?.uid, esPrueba])
  const inicial = datosDelTechPack(item)
  const [modelo, setModelo] = useState(inicial.modelo)
  const [talla, setTalla] = useState(inicial.talla)
  const [color, setColor] = useState(inicial.color)
  const [notas, setNotas] = useState(inicial.notas)
  // A que codigos u ordenes pertenece. Se teclea separado por comas, como las
  // OT del tablero de diseno: es el mismo gesto que ella ya conoce.
  const [codigosTxt, setCodigosTxt] = useState((inicial.codigos || []).join(', '))
  const [checklist, setChecklist] = useState(inicial.checklist || {})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // El porcentaje se CALCULA, no se guarda: un numero guardado se queda viejo
  // en cuanto cambia el checklist. 'no aplica' no cuenta ni a favor ni en
  // contra, para que un modelo sin caja no salga eternamente incompleto.
  const cuentan = RUBROS_TECH_PACK.filter((r) => checklist[r.id] !== 'no_aplica')
  const completos = cuentan.filter((r) => checklist[r.id] === 'completo').length
  const faltan = cuentan.filter((r) => checklist[r.id] === 'pendiente').length
  const noAplican = RUBROS_TECH_PACK.length - cuentan.length
  // Con los siete en "no aplica" sale 0% (decision de Roberto, 8-sep), y el
  // desglose de al lado es lo que dice como leerlo: el numero solo engana
  // (seis "no aplica" y uno "ya esta" tambien darian 100%).
  const porcentaje = cuentan.length ? Math.round((completos / cuentan.length) * 100) : 0
  const evaluado = RUBROS_TECH_PACK.some((r) => checklist[r.id])
  // El mismo numero que la etiqueta "% hecho" de la lista, con las marcas que
  // Lety va poniendo en este momento (antes de guardar).
  const avanceVivo = avanceDelTechPack({ ...item, datosEditables: { ...(item.datosEditables || {}), checklist } })
  const desglose = `${completos} ya ${completos === 1 ? 'esta' : 'estan'} · ${faltan} ${faltan === 1 ? 'falta' : 'faltan'} · ${noAplican} no ${noAplican === 1 ? 'aplica' : 'aplican'}`

  // Roberto, 8-sep: "no puede simplemente borrarlo... no le debe dejar guardar
  // ese movimiento". Un tech pack sin nombre no le sirve a nadie.
  const sinNombre = !String(modelo || '').trim()

  const guardar = async () => {
    if (sinNombre) {
      setError('El nombre del modelo no puede quedar vacio. Escribe como se llama (COMBO BEIGE, RAYAS...) o cancela.')
      return
    }
    setGuardando(true)
    setError('')
    try {
      const r = await editarDatosTechPack({
        codigo: item.codigo,
        actual: item,
        datos: { modelo, talla, color, notas, checklist, codigos: codigosTxt.split(/[,;\s]+/).filter(Boolean) },
        usuario
      })
      onGuardado(r.sinCambios ? 'No habia nada que cambiar.' : `Guardado: ${item.codigo}.`)
    } catch (e) {
      console.error('[TechPacks] No se pudo guardar la edicion:', e)
      setError(e?.message || String(e))
      setGuardando(false)
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal tp-modal-editar" onClick={(e) => e.stopPropagation()}>
        <div className="tp-fila" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Editar <span className="tp-codigo">{item.codigo}</span></h3>
          <button className="btn-secundario tp-btn-chico" onClick={onCerrar}>Cerrar</button>
        </div>
        {otros.length > 0 && <div className="tp-editando">{textoEdiciones(otros)}</div>}

        {/* Las seis pantallas de la plantilla y que le falta a cada una
            (Roberto, 11-sep: "que te diga que pantalla quieres editar"). El
            contenido de cada pantalla (fotos, OT, avios) se edita en Excel y se
            vuelve a subir con Reemplazar; lo de abajo (nombre, codigos, checklist)
            se edita aqui mismo. */}
        {item.techPack?.totalChunks && (
          <div className="tp-campo">
            <span>Las seis pantallas del tech pack</span>
            <div className="tp-pantallas">
              {[['pedido', '1 Modelo'], ['ruta', '2 Códigos y ruta'], ['etiquetas', '3 Avíos'], ['individual', '4 Empaque individual'], ['bolsa', '5 Packs en bolsa'], ['caja', '6 Caja']].map(([id, titulo], i) => {
                const detalle = item.medicion?.detalle?.[id]
                const faltaV1 = !item.medicion?.detalle && (item.medicion?.faltan || []).includes(id)
                const falta = detalle?.length ? detalle : faltaV1 ? ['no está'] : []
                return (
                  <button type="button" key={id} className={`tp-pantalla ${falta.length ? 'falta' : 'ok'}`} onClick={() => onVer?.(item, i + 1)} title="Abrir esta pantalla del tech pack">
                    <strong>{titulo}</strong>
                    <span className="texto-suave" style={{ fontSize: 12 }}>{falta.length ? `falta: ${falta.join(', ')}` : 'completo'}</span>
                    <span className="tp-pantalla-ir">abrir ›</span>
                  </button>
                )
              })}
            </div>
            <small className="texto-suave">
              Pica una pantalla para verla.
              {onEditarContenido && item.techPack?.formato === 'xlsx' && (
                <> <button type="button" className="btn-primario tp-btn-chico" style={{ marginLeft: 6 }} onClick={() => onEditarContenido(item)}>Editar el contenido (datos, avíos, fotos)</button></>
              )}
            </small>
          </div>
        )}

        <label className="tp-campo">
          <span>Nombre del modelo</span>
          <input
            className="tp-input"
            value={modelo}
            maxLength={160}
            placeholder="Como se llama en el Drive: COMBO BEIGE, RAYAS..."
            onChange={(e) => setModelo(e.target.value)}
          />
          <small className="texto-suave">
            El catalogo trae un nombre generico y el mismo codigo puede ser dos modelos distintos.
            Este es el nombre que ve todo el mundo.
          </small>
        </label>

        <div className="tp-fila" style={{ gap: 10 }}>
          <label className="tp-campo" style={{ flex: 1 }}>
            <span>Talla</span>
            <input className="tp-input" value={talla} maxLength={60} onChange={(e) => setTalla(e.target.value)} />
          </label>
          <label className="tp-campo" style={{ flex: 2 }}>
            <span>Color</span>
            <input className="tp-input" value={color} maxLength={200} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>

        <label className="tp-campo">
          <span>A que codigos u ordenes pertenece</span>
          <input
            className="tp-input"
            value={codigosTxt}
            placeholder="ej. 1564-I, 6080-K, 7942"
            onChange={(e) => setCodigosTxt(e.target.value)}
          />
          <small className="texto-suave">
            Separa con comas. Sirve para que este tech pack aparezca en su orden de compra y de trabajo, y para que
            se pueda pegar por OT al encargarle a una maquila. Si lo dejas vacio, queda en &quot;Sin orden de compra
            ni de trabajo&quot;.
            {(inicial.codigos || []).length > 0 && (
              <> Ahora tiene {(inicial.codigos || []).length}.</>
            )}
          </small>
        </label>

        <div className="tp-campo">
          <span>
            Que le falta a este tech pack
            {/* El numero de arriba es el MISMO que la etiqueta "% hecho" de la
                lista (Roberto, 11-sep): lo que Lety marca manda y lo que no ha
                marcado lo pone la medicion de la app. Si solo se contara lo
                marcado, marcar un punto bajaria un 86% a 14%. */}
            {avanceVivo ? (
              <>
                <strong style={{ marginLeft: 8 }}>{avanceVivo.porcentaje}% hecho</strong>
                <span className="texto-suave" style={{ marginLeft: 8, fontSize: 12 }}>
                  {evaluado ? `(tus marcas: ${desglose})` : '(medido por la app; sin revisar por ti)'}
                </span>
              </>
            ) : evaluado ? (
              <>
                <strong style={{ marginLeft: 8 }}>{porcentaje}% hecho</strong>
                <span className="texto-suave" style={{ marginLeft: 8, fontSize: 12 }}>({desglose})</span>
              </>
            ) : (
              <span className="texto-suave" style={{ marginLeft: 8 }}>sin revisar</span>
            )}
          </span>
          <small className="texto-suave">
            Los siete puntos del tech pack que quedo como estandar (QUI-CSHA20X).
          </small>
          <div className="tp-checklist">
            {RUBROS_TECH_PACK.map((r) => (
              <div key={r.id} className="tp-checklist-fila">
                <div>
                  <strong>{r.titulo}</strong>
                  <div className="texto-suave" style={{ fontSize: 12 }}>{r.ayuda}</div>
                </div>
                <select
                  className="tp-input"
                  style={{ width: 130 }}
                  value={checklist[r.id] || ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setChecklist((prev) => {
                      const next = { ...prev }
                      if (v) next[r.id] = v
                      else delete next[r.id] // "sin revisar" BORRA la llave: mandar undefined truena la escritura
                      return next
                    })
                  }}
                >
                  <option value="">sin revisar</option>
                  <option value="completo">ya esta</option>
                  <option value="pendiente">falta</option>
                  <option value="no_aplica">no aplica</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <label className="tp-campo">
          <span>Notas</span>
          <textarea
            className="tp-input"
            rows={3}
            maxLength={2000}
            value={notas}
            placeholder="Cuanta plastiflecha lleva, como va la bolsa, lo que haya que decirle a la maquila..."
            onChange={(e) => setNotas(e.target.value)}
          />
        </label>

        {error && <p className="alerta-error">{error}</p>}

        <div className="tp-fila" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn-secundario" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button className="btn-primario" onClick={guardar} disabled={guardando || sinNombre} title={sinNombre ? 'Falta el nombre del modelo' : undefined}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>

        {puedeSubir && item.techPack?.totalChunks && (
          <div className="tp-campo tp-archivo-acciones">
            <span>El archivo del tech pack</span>
            <small className="texto-suave">
              {item.techPack.nombre} · v{item.techPack.version || 1} · {mb(item.techPack.tamano)}
            </small>
            <div className="tp-fila" style={{ gap: 10 }}>
              <label className="btn-primario" style={{ cursor: ocupado ? 'default' : 'pointer' }} title="Sube otro archivo en lugar de este (queda como version nueva)">
                Reemplazar por otro archivo
                <input type="file" accept=".pdf,.xlsx" style={{ display: 'none' }} disabled={ocupado || guardando} onChange={(e) => { onReemplazar?.(item, e.target.files?.[0]); e.target.value = '' }} />
              </label>
              <button type="button" className="btn-secundario tp-quitar-fuerte" disabled={ocupado || guardando} onClick={() => onQuitar?.(item)} title="Quita el archivo; el codigo se queda sin tech pack">
                Quitar el tech pack
              </button>
            </div>
          </div>
        )}

        <details className="tp-historial">
          <summary>Quien lo ha modificado</summary>
          <QuienLoModifico codigo={item.codigo} />
        </details>
      </div>
    </div>
  )
}

// QUIEN LO MODIFICO: dos rastros en una sola lista, las ediciones de datos
// (historial) y cada archivo guardado, incluido lo del editor del contenido
// (versiones). Se usa en Editar y en Consultar.
function QuienLoModifico({ codigo }) {
  const [historial, setHistorial] = useState(null)
  useEffect(() => {
    let vivo = true
    const ms = (t) => (t?.toMillis ? t.toMillis() : 0)
    Promise.all([historialDelTechPack(codigo).catch(() => []), versionesDelTechPack(codigo)])
      .then(([h, v]) => {
        if (!vivo) return
        const ediciones = h.map((x) => ({ ...x, clase: 'datos', id: 'h-' + x.id }))
        const subidas = v.map((x) => ({ id: 'v-' + x.id, clase: 'archivo', quienNombre: x.subidoPorNombre, cuando: x.subidoEn, tipo: x.tipo, version: x.version }))
        setHistorial([...ediciones, ...subidas].sort((a, b) => ms(b.cuando) - ms(a.cuando)))
      })
    return () => { vivo = false }
  }, [codigo])
  return (
    <>
      {historial === null ? (
        <p className="texto-suave">Leyendo...</p>
      ) : historial.length === 0 ? (
        <p className="texto-suave">Todavia nadie lo ha modificado desde la app.</p>
      ) : (
        <ul>
          {historial.map((h) => (
            <li key={h.id}>
              <strong>{h.quienNombre || 'alguien'}</strong>
              <span className="texto-suave">
                {' '}· {fecha(h.cuando)} ·{' '}
                {h.clase === 'archivo'
                  ? `guardo ${h.tipo === 'ftt' ? 'la FTT' : 'el tech pack'} (version ${h.version})`
                  : `cambio ${resumirCambio(h)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="texto-suave" style={{ fontSize: 12, margin: '6px 0 0' }}>
        Los archivos guardados antes del 15 de septiembre no quedaron registrados aqui.
      </p>
    </>
  )
}

// CONSULTAR (Roberto, 15-sep): ver quien subio o cambio un tech pack sin
// tener que entrar a "Editar". Solo lectura; lo ve quien ve la biblioteca.
function ModalConsultarTechPack({ item, onCerrar }) {
  const modelos = modelosDelTechPack(item)
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: '100%' }}>
        <div className="tp-fila" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Quién lo modificó · <span className="tp-codigo">{item.codigo}</span></h3>
            <p className="texto-suave" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {[textoDe(item.cliente), modelos.join(', '), item.techPack?.version ? `version ${item.techPack.version}` : ''].filter(Boolean).join(' · ') || 'Sin datos de la plantilla'}
            </p>
          </div>
          <button className="btn-secundario tp-btn-chico" onClick={onCerrar}>Cerrar</button>
        </div>
        <div className="tp-historial" style={{ marginTop: 12 }}>
          <QuienLoModifico codigo={item.codigo} />
        </div>
      </div>
    </div>
  )
}

// El renglon de historial guarda el estado completo antes y despues (asi la
// regla puede comprobar que no miente); el resumen legible se saca aqui.
function resumirCambio(h) {
  const antes = h?.antes || {}
  const despues = h?.despues || {}
  const nombres = { modelo: 'el modelo', talla: 'la talla', color: 'el color', notas: 'las notas', checklist: 'el checklist' }
  const cambiados = Object.keys(nombres).filter(
    (k) => !mismosDatos(antes[k] ?? null, despues[k] ?? null)
  )
  return cambiados.length ? cambiados.map((k) => nombres[k]).join(', ') : 'nada visible'
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

function Documento({ item, tipo, avance, onVer, onQuitar, puedeEditar, ocupado }) {
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
      {tipo === 'tp' && <PorcentajeHecho avance={avance} />}
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
