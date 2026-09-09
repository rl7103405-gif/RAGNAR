// TAREAS DE DISENO: la lupa sobre el equipo de Lety.
//
// Tres personas ven tres cosas distintas de los mismos datos:
//   - El admin (Roberto) ENCARGA una orden de compra a Lety y ve todo.
//   - Lety (puedeAsignarDiseno) REPARTE las OT de sus encargos entre su equipo
//     y ve cuanto lleva cada quien.
//   - Monica y Maria Fernanda (supervisorDisenoUid) ven SOLO lo suyo: que OT
//     les toco y que le falta a cada codigo.
//
// El avance no se captura: sale de la biblioteca de tech packs (ver
// utils/tareasDiseno.js). Marcar el checklist en Tech packs ES avanzar aqui.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { planVigente } from '../utils/planMaestro'
import { escucharBiblioteca } from '../utils/techPacks'
import {
  asignarOt,
  avanceDeEncargo,
  avanceDeOt,
  cambiarAsignacion,
  cambiarEncargo,
  crearEncargo,
  crearEncargoManual,
  parsearCodigos,
  equipoDe,
  ErrorDiseno,
  escucharAsignaciones,
  escucharEncargos,
  historialDeAsignacion,
  indexarBiblioteca,
  lineasPorOtDeVersion,
  parsearOtsDetallado,
  responsablesDeDiseno
} from '../utils/tareasDiseno'
// (parsearOts se dejo en tareasDiseno.js por compatibilidad; este panel usa
// la version detallada para poder avisar de las OT que no se entendieron.)

const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '—')
const aFecha = (s) => (s ? new Date(s + 'T12:00:00') : null)

export default function PanelTareasDiseno() {
  const { authUser, perfil, esPrueba, esAdmin, puedeAsignarDiseno } = useAuth()
  const uid = authUser?.uid || ''
  const usuario = { uid, nombre: perfil?.nombreCompleto || '' }
  const vista = esAdmin ? 'admin' : puedeAsignarDiseno ? 'jefa' : 'equipo'

  const [biblioteca, setBiblioteca] = useState([])
  const [encargos, setEncargos] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [lineasPorOt, setLineasPorOt] = useState(new Map())
  // true mientras el efecto de abajo esta pidiendo las lineas del plan de
  // alguna version que todavia no estaba cargada (Codex: sin esto, FilaOt no
  // puede distinguir "esta OT de verdad no tiene lineas en el plan" de
  // "las lineas del plan todavia no llegan", y aMano parpadea).
  const [cargandoLineas, setCargandoLineas] = useState(false)
  const [equipo, setEquipo] = useState([])
  const [equipoPorJefa, setEquipoPorJefa] = useState(new Map())
  const [responsables, setResponsables] = useState([])
  const [ocsDelPlan, setOcsDelPlan] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  const reportar = (e) => {
    console.error('[Diseno]', e)
    setError(e instanceof ErrorDiseno ? e.message : 'Fallo: ' + (e?.message || e))
  }

  // La biblioteca, en vivo: de ahi sale el avance.
  useEffect(() => escucharBiblioteca(esPrueba, setBiblioteca, (e) => setError('No se pudo leer la biblioteca: ' + (e.message || e))), [esPrueba])

  // Encargos y asignaciones, segun quien mira.
  useEffect(() => {
    if (!uid) return undefined
    const paraEncargos = vista === 'equipo' ? () => {} : escucharEncargos({ esAdmin, uid, esPrueba }, setEncargos, reportar)
    const alcance = vista === 'admin' ? 'todas' : vista === 'jefa' ? 'jefa' : 'mias'
    const paraAsignaciones = escucharAsignaciones({ alcance, uid, esPrueba }, setAsignaciones, reportar)
    return () => {
      paraEncargos()
      paraAsignaciones()
    }
  }, [uid, vista, esAdmin, esPrueba])

  // Las claves de dependencia se sacan de `encargos` con useMemo: el arreglo
  // es nuevo en CADA snapshot (hasta si solo cambio un encargo), y si el
  // useEffect dependiera de `encargos` directo, cada cambio de cualquier
  // encargo repetiria la lectura pesada de las lineas del plan y del equipo
  // de cada jefa. Con la clave serializada, solo se dispara cuando el
  // CONJUNTO de versiones/jefas realmente cambia.
  // 'manual' se excluye: no existe version de plan que lo respalde, y
  // pedirsela a lineasPorOtDeVersion solo gastaria una consulta que siempre
  // vuelve vacia (Codex).
  const claveVersiones = useMemo(
    () => [...new Set(encargos.map((e) => e.planVersionId).filter((v) => v && v !== 'manual'))].sort().join(','),
    [encargos]
  )
  const claveResponsables = useMemo(
    () => [...new Set(encargos.map((e) => e.responsableUid).filter(Boolean))].sort().join(','),
    [encargos]
  )

  // El equipo (para repartir) y las jefas (para encargar).
  useEffect(() => {
    if (!uid) return undefined
    let vivo = true
    if (vista === 'jefa') equipoDe(uid).then((r) => vivo && setEquipo(r)).catch((e) => vivo && reportar(e))
    if (vista === 'admin') {
      responsablesDeDiseno().then((r) => vivo && setResponsables(r)).catch((e) => vivo && reportar(e))
      planVigente()
        .then((p) => vivo && setOcsDelPlan((p?.ocs || []).map((x) => ({ oc: x.oc, totalOts: x.totalOts || x.ots?.length || 0, destinos: x.destinos || [] }))))
        .catch(() => vivo && setOcsDelPlan([]))
    }
    return () => {
      vivo = false
    }
  }, [uid, vista])

  // Para el admin, `equipo` (arriba) solo se llena en vista 'jefa': aqui se
  // carga el equipo de CADA jefa que tenga un encargo, para que el select de
  // "Asignar a" no salga vacio cuando el admin reparte.
  useEffect(() => {
    if (vista !== 'admin' || !claveResponsables) return undefined
    let vivo = true
    ;(async () => {
      const uidsJefas = claveResponsables.split(',')
      const pares = await Promise.all(uidsJefas.map(async (u) => [u, await equipoDe(u).catch(() => [])]))
      if (vivo) setEquipoPorJefa(new Map(pares))
    })()
    return () => {
      vivo = false
    }
  }, [vista, claveResponsables])

  // Las lineas del plan por OT, SOLO para ver las OT todavia sin asignar
  // (admin y Lety). Una persona del equipo no las necesita. Cuesta una
  // lectura por linea del plan (hoy ~380): solo se piden las versiones que
  // AUN no esten en lineasPorOt (se revisa si ya hay alguna clave 'v|...'),
  // y se fusiona con lo que ya habia en vez de reemplazarlo entero.
  useEffect(() => {
    if (vista === 'equipo' || !claveVersiones) return undefined
    let vivo = true
    ;(async () => {
      const versiones = claveVersiones.split(',')
      const pendientes = versiones.filter((v) => ![...lineasPorOt.keys()].some((k) => k.startsWith(v + '|')))
      if (!pendientes.length) return
      // Solo se prende mientras de verdad hay algo pendiente por pedir: si
      // todas las versiones ya estaban en lineasPorOt no hay vuelta de red y
      // aMano no debe quedarse "cargando" para siempre (Codex).
      setCargandoLineas(true)
      const m = new Map()
      for (const v of pendientes) {
        const parcial = await lineasPorOtDeVersion(v).catch(() => new Map())
        parcial.forEach((codigos, ot) => m.set(v + '|' + ot, codigos))
      }
      if (vivo) {
        if (m.size) setLineasPorOt((prev) => new Map([...prev, ...m]))
        setCargandoLineas(false)
      }
    })()
    return () => {
      vivo = false
    }
    // lineasPorOt se lee adentro a proposito (solo para saber que YA esta
    // cargado) pero no entra en las dependencias: si entrara, cada
    // setLineasPorOt volveria a disparar este efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, claveVersiones])

  const indice = useMemo(() => indexarBiblioteca(biblioteca), [biblioteca])

  const avances = useMemo(() => {
    const m = new Map()
    encargos.forEach((e) => {
      const lineas = new Map()
      ;(e.ots || []).forEach((ot) => lineas.set(ot, lineasPorOt.get(e.planVersionId + '|' + ot) || []))
      m.set(e.id, avanceDeEncargo(e, asignaciones, lineas, indice))
    })
    return m
  }, [encargos, asignaciones, lineasPorOt, indice])

  // Indicadores propios de diseno: tech packs, no docenas.
  const tiles = useMemo(() => {
    if (vista === 'equipo') {
      const mias = asignaciones.filter((a) => a.estado === 'abierta').map((a) => avanceDeOt(a.codigos, indice))
      return [
        { t: 'Mis OT abiertas', v: mias.length },
        { t: 'Listas', v: mias.filter((a) => a.lista).length, tono: 'ok' },
        { t: 'A medias', v: mias.filter((a) => !a.lista && a.porcentaje > 0).length, tono: 'aviso' },
        { t: 'Codigos sin tech pack', v: mias.reduce((t, a) => t + a.sinTechPack, 0), tono: 'aviso' },
        { t: 'Avance promedio', v: mias.length ? Math.round(mias.reduce((t, a) => t + a.porcentaje, 0) / mias.length) + '%' : '—' }
      ]
    }
    const abiertos = encargos.filter((e) => e.estado === 'abierto')
    const filas = abiertos.flatMap((e) => avances.get(e.id)?.filas || [])
    return [
      { t: 'Encargos abiertos', v: abiertos.length },
      { t: 'OT en encargos', v: filas.length },
      { t: 'OT listas', v: filas.filter((f) => f.lista).length, tono: 'ok' },
      { t: 'OT sin asignar', v: filas.filter((f) => !f.asignacion).length, tono: filas.some((f) => !f.asignacion) ? 'aviso' : '' },
      { t: 'Codigos sin tech pack', v: filas.reduce((t, f) => t + f.sinTechPack, 0), tono: 'aviso' },
      { t: 'Avance promedio', v: filas.length ? Math.round(filas.reduce((t, f) => t + f.porcentaje, 0) / filas.length) + '%' : '—' }
    ]
  }, [vista, encargos, asignaciones, avances, indice])

  const correr = async (fn, ok) => {
    setTrabajando(true)
    setError('')
    setAviso('')
    try {
      const r = await fn()
      setAviso(typeof ok === 'function' ? ok(r) : ok)
    } catch (e) {
      reportar(e)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div>
      <div className="tarjeta tp-cabecera">
        <h2 style={{ margin: 0 }}>Tareas de diseno</h2>
        <p className="texto-suave" style={{ marginTop: 4 }}>
          {vista === 'admin' && 'Encarga una orden de compra a Lety y mira cuanto lleva su equipo. El avance sale solo de los tech packs.'}
          {vista === 'jefa' && 'Reparte las ordenes de trabajo de cada encargo entre tu equipo. Una OT esta lista cuando todos sus codigos tienen tech pack con el checklist completo.'}
          {vista === 'equipo' && 'Lo que te toca. Cada codigo se pone listo cuando su tech pack tiene archivo y el checklist completo en la pestana Tech packs.'}
        </p>
        <div className="tp-tiles" style={{ marginTop: 12 }}>
          {tiles.map((x) => (
            <div key={x.t} className={`tp-tile ${x.tono ? 'tp-tile-' + x.tono : ''}`}>
              <div className="tp-tile-valor">{x.v}</div>
              <div className="tp-tile-titulo">{x.t}</div>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="alerta-error">{error}</p>}
      {aviso && <p className="alerta-ok">{aviso}</p>}

      {vista !== 'equipo' && (
        <FormEncargoManual
          esAdmin={esAdmin}
          responsables={responsables}
          usuario={usuario}
          encargos={encargos}
          ocupado={trabajando}
          onCargar={(datos) =>
            correr(
              () => crearEncargoManual({ ...datos, usuario, esPrueba, existentes: encargos }),
              (r) => `Cargado ${datos.etiqueta} con ${r.ots.length} ordenes de trabajo.`
            )
          }
        />
      )}

      {vista === 'admin' && (
        <FormEncargo
          ocs={ocsDelPlan}
          responsables={responsables}
          encargos={encargos}
          ocupado={trabajando}
          onEncargar={(datos) =>
            correr(
              () => crearEncargo({ ...datos, usuario, esPrueba, existentes: encargos }),
              (r) => `Encargada la orden ${datos.oc} con ${r.ots.length} ordenes de trabajo.`
            )
          }
        />
      )}

      {vista !== 'equipo' && (
        <ListaEncargos
          encargos={encargos}
          avances={avances}
          asignaciones={asignaciones}
          equipo={equipo}
          equipoPorJefa={equipoPorJefa}
          esAdmin={esAdmin}
          uid={uid}
          puedeRepartir={vista === 'jefa' || esAdmin}
          cargandoLineas={cargandoLineas}
          ocupado={trabajando}
          onAsignar={(encargo, ot, destinataria, fechaObjetivo, codigosManuales) =>
            correr(
              () => asignarOt({ encargo, ot, destinataria, fechaObjetivo, usuario, esPrueba, existentes: asignaciones, codigosManuales }),
              `OT ${ot} asignada a ${destinataria.nombre}.`
            )
          }
          onCambiar={(asignacion, cambios, motivo, ok) => correr(() => cambiarAsignacion({ asignacion, cambios, motivo, usuario }), ok)}
          onCerrarEncargo={(encargo, estado) =>
            correr(() => cambiarEncargo({ encargo, estado, usuario }), `Encargo ${encargo.oc} ${estado}.`)
          }
        />
      )}

      {vista === 'equipo' && <MisAsignaciones asignaciones={asignaciones} indice={indice} />}
    </div>
  )
}

// ---------------------------------------------------------------- admin: encargar
function FormEncargo({ ocs, responsables, encargos, ocupado, onEncargar }) {
  const [oc, setOc] = useState('')
  const [resp, setResp] = useState('')
  const [fechaObj, setFechaObj] = useState('')
  const [notas, setNotas] = useState('')
  const abiertas = new Set(encargos.filter((e) => e.estado === 'abierto').map((e) => e.oc))
  const responsable = responsables.find((r) => r.id === resp)
  return (
    <div className="tarjeta">
      <h3 style={{ marginTop: 0 }}>Encargar una orden de compra</h3>
      <div className="tp-fila" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="tp-campo" style={{ minWidth: 220 }}>
          <span>Orden de compra (del plan vigente)</span>
          <input className="tp-input" list="ocs-plan" value={oc} onChange={(e) => setOc(e.target.value.toUpperCase())} placeholder="Escribe o elige" />
          <datalist id="ocs-plan">
            {ocs.filter((x) => !abiertas.has(x.oc)).map((x) => (
              <option key={x.oc} value={x.oc}>{`${x.totalOts} OT · ${(x.destinos || []).slice(0, 2).join(', ')}`}</option>
            ))}
          </datalist>
        </label>
        <label className="tp-campo" style={{ minWidth: 200 }}>
          <span>Se le encarga a</span>
          <select className="tp-input" value={resp} onChange={(e) => setResp(e.target.value)}>
            <option value="">Elige</option>
            {responsables.map((r) => (
              <option key={r.id} value={r.id}>{r.nombreCompleto}</option>
            ))}
          </select>
        </label>
        <label className="tp-campo">
          <span>Fecha objetivo (opcional)</span>
          <input className="tp-input" type="date" value={fechaObj} onChange={(e) => setFechaObj(e.target.value)} />
        </label>
        <label className="tp-campo" style={{ flex: 1, minWidth: 200 }}>
          <span>Notas (opcional)</span>
          <input className="tp-input" value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} />
        </label>
        <button
          className="btn-primario"
          disabled={ocupado || !oc.trim() || !responsable}
          onClick={() => {
            onEncargar({ oc, responsable: { uid: responsable.id, nombre: responsable.nombreCompleto || '' }, fechaObjetivo: aFecha(fechaObj), notas })
            setOc('')
            setNotas('')
          }}
        >
          {ocupado ? 'Guardando...' : 'Encargar'}
        </button>
      </div>
      {responsables.length === 0 && (
        <p className="texto-suave" style={{ fontSize: 13, marginBottom: 0 }}>No hay nadie con permiso de repartir tareas de diseno. Se marca en el perfil (equipo_diseno.mjs).</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- jefa y admin: cargar a mano
function FormEncargoManual({ esAdmin, responsables, usuario, encargos, ocupado, onCargar }) {
  const [etiqueta, setEtiqueta] = useState('')
  const [ots, setOts] = useState('')
  const [resp, setResp] = useState('')
  const [fechaObj, setFechaObj] = useState('')
  const [notas, setNotas] = useState('')
  const { ots: lista, rechazadas } = parsearOtsDetallado(ots)
  const responsable = esAdmin ? responsables.find((r) => r.id === resp) : null
  return (
    <details className="tarjeta">
      <summary style={{ cursor: 'pointer' }}>
        <strong>Cargar ordenes de trabajo a mano</strong>
        <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>cuando el plan no las trae, o no cuelgan de una orden de compra</span>
      </summary>
      <div className="tp-fila" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
        <label className="tp-campo" style={{ minWidth: 220 }}>
          <span>Etiqueta del encargo</span>
          <input className="tp-input" value={etiqueta} maxLength={40} placeholder="PIER RESURTIDO SEP" onChange={(e) => setEtiqueta(e.target.value.toUpperCase())} />
        </label>
        <label className="tp-campo" style={{ flex: 1, minWidth: 260 }}>
          <span>Ordenes de trabajo (separadas por coma, punto y coma o espacio)</span>
          <input className="tp-input" value={ots} placeholder="7593, 7594, 7887-A" onChange={(e) => setOts(e.target.value)} />
          <small className="texto-suave">{lista.length ? `${lista.length} OT: ${lista.slice(0, 8).join(', ')}${lista.length > 8 ? '...' : ''}` : 'todavia ninguna'}</small>
          {rechazadas.length > 0 && (
            <small className="tp-aviso">no se entendieron: {rechazadas.join(', ')}</small>
          )}
        </label>
        {esAdmin && (
          <label className="tp-campo" style={{ minWidth: 200 }}>
            <span>Se le encarga a</span>
            <select className="tp-input" value={resp} onChange={(e) => setResp(e.target.value)}>
              <option value="">Elige</option>
              {responsables.map((r) => (
                <option key={r.id} value={r.id}>{r.nombreCompleto}</option>
              ))}
            </select>
          </label>
        )}
        <label className="tp-campo">
          <span>Fecha objetivo (opcional)</span>
          <input className="tp-input" type="date" value={fechaObj} onChange={(e) => setFechaObj(e.target.value)} />
        </label>
        <label className="tp-campo" style={{ flex: 1, minWidth: 200 }}>
          <span>Notas (opcional)</span>
          <input className="tp-input" value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} />
        </label>
        <button
          className="btn-primario"
          disabled={ocupado || !etiqueta.trim() || !lista.length || rechazadas.length > 0 || (esAdmin && !responsable)}
          onClick={() => {
            onCargar({
              etiqueta,
              ots: lista,
              responsable: esAdmin ? { uid: responsable.id, nombre: responsable.nombreCompleto || '' } : { uid: usuario.uid, nombre: usuario.nombre },
              fechaObjetivo: aFecha(fechaObj),
              notas
            })
            setEtiqueta('')
            setOts('')
            setNotas('')
          }}
        >
          {ocupado ? 'Guardando...' : 'Cargar'}
        </button>
      </div>
      <p className="texto-suave" style={{ fontSize: 12, marginBottom: 0 }}>
        Al repartir cada OT vas a escribir sus codigos. Un encargo manual se queda manual aunque despues aparezca en el plan.
      </p>
    </details>
  )
}

// ---------------------------------------------------------------- admin y jefa: los encargos
function ListaEncargos({ encargos, avances, asignaciones, equipo, equipoPorJefa, esAdmin, uid, puedeRepartir, cargandoLineas, ocupado, onAsignar, onCambiar, onCerrarEncargo }) {
  if (!encargos.length) {
    return (
      <div className="tarjeta tp-vacio">
        <div className="tp-vacio-titulo">Todavia no hay encargos</div>
        <div className="texto-suave">Cuando se encargue una orden de compra aparece aqui con sus ordenes de trabajo.</div>
      </div>
    )
  }
  return encargos.map((e) => {
    const av = avances.get(e.id) || { filas: [], listas: 0, total: 0, porcentaje: 0, interno: 0, sinAsignar: 0 }
    const cerrado = e.estado !== 'abierto'
    return (
      <details key={e.id} className={`tarjeta td-encargo ${cerrado ? 'td-cerrado' : ''}`} open={!cerrado}>
        <summary className="tp-fila" style={{ justifyContent: 'space-between', cursor: 'pointer', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong style={{ fontSize: 16 }}>{e.origen === 'manual' ? e.oc : `OC ${e.oc}`}</strong>
            {e.origen === 'manual' && <span className="tp-pill" style={{ marginLeft: 8 }}>manual</span>}
            <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
              encargada a {e.responsableNombre} · {fecha(e.creadoEn)}
              {e.fechaObjetivo ? ` · para el ${fecha(e.fechaObjetivo)}` : ''}
              {cerrado ? ` · ${e.estado}` : ''}
            </span>
          </div>
          <div className="tp-fila" style={{ gap: 12 }}>
            <Barra porcentaje={av.porcentaje} />
            <strong>{av.listas} de {av.total} OT listas</strong>
            <span className="texto-suave" style={{ fontSize: 13 }}>avance interno {av.interno}%</span>
            {av.sinAsignar > 0 && !cerrado && <span className="tp-pill tp-pill-falta">{av.sinAsignar} sin asignar</span>}
            {(esAdmin || (e.origen === 'manual' && e.responsableUid === uid)) && !cerrado && (
              <span className="tp-fila" style={{ gap: 6 }}>
                <button
                  className="btn-secundario tp-btn-chico"
                  onClick={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    onCerrarEncargo(e, 'cerrado')
                  }}
                >
                  Cerrar encargo
                </button>
                <button
                  className="btn-secundario tp-btn-chico"
                  onClick={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    onCerrarEncargo(e, 'cancelado')
                  }}
                >
                  Cancelar encargo
                </button>
              </span>
            )}
          </div>
        </summary>
        {e.notas && <p className="texto-suave" style={{ fontSize: 13 }}>{e.notas}</p>}
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>OT</th>
                <th>Codigos</th>
                <th>Asignada a</th>
                <th>Avance</th>
                <th>Quien lo ha trabajado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {av.filas.map((f) => (
                <FilaOt
                  key={f.ot}
                  fila={f}
                  encargo={e}
                  equipo={equipo}
                  equipoPorJefa={equipoPorJefa}
                  puedeRepartir={puedeRepartir && !cerrado}
                  cargandoLineas={cargandoLineas}
                  ocupado={ocupado}
                  onAsignar={onAsignar}
                  onCambiar={onCambiar}
                />
              ))}
            </tbody>
          </table>
        </div>
      </details>
    )
  })
}

function FilaOt({ fila, encargo, equipo, equipoPorJefa, puedeRepartir, cargandoLineas, ocupado, onAsignar, onCambiar }) {
  const equipoDisponible = equipoPorJefa?.get(encargo.responsableUid) ?? equipo
  const [dest, setDest] = useState('')
  const [fechaObj, setFechaObj] = useState('')
  const [reasignando, setReasignando] = useState(false)
  const a = fila.asignacion
  const [codigosTxt, setCodigosTxt] = useState('')
  const [corrigiendo, setCorrigiendo] = useState(false)
  // Mientras las lineas del plan siguen en vuelo (cargandoLineas), NO se
  // puede saber todavia si esta OT trae codigos del plan o no: sin el
  // guarda, aMano se prendia (mostraba el input de codigos a mano) y luego
  // se apagaba solo cuando llegaba el plan (Codex: el "parpadeo").
  const aMano = encargo.planVersionId === 'manual' || (!cargandoLineas && (fila.codigosDelPlan?.length || 0) === 0)
  // "Corregir codigos" es distinto: la asignacion YA existe, asi que ya se
  // sabe con certeza si trajo o no lineas del plan (no hay nada en vuelo que
  // esperar). Ademas cubre el caso de un encargo DEL PLAN cuya asignacion se
  // armo a mano porque esa OT no traia lineas.
  const puedeCorregirCodigos = encargo.planVersionId === 'manual' || (fila.codigosDelPlan?.length || 0) === 0
  const persona = equipoDisponible.find((u) => u.id === dest)
  return (
    <tr className={fila.lista ? 'td-lista' : undefined}>
      <td><span className="tp-codigo">{fila.ot}</span></td>
      <td style={{ fontSize: 13 }}>
        {fila.alcanceAlterado && (() => {
          const m = fila.codigosDelPlan?.length || 0
          const n = (fila.codigosDelPlan || []).filter((c) => (fila.codigosAsignados || []).includes(c)).length
          return (
            <span
              className="tp-pill tp-pill-falta"
              style={{ display: 'block', marginBottom: 4 }}
              title={`El plan tiene ${m} codigos para esta OT; la asignacion trae ${n} de esos ${m}. Se esta contando el avance contra el plan completo, no contra lo que trae la asignacion.`}
            >
              alcance alterado: la asignacion trae {n} de {m} codigos del plan
            </span>
          )
        })()}
        {/* pentester P3b: si el alcance se corrigio despues de asignar (revision
            > 1 con la asignacion todavia abierta), el admin lo tiene que ver
            junto a los chips: el denominador de la barra cambio. */}
        {fila.revision > 1 && a?.estado === 'abierta' && (
          <span className="tp-pill tp-pill-falta" style={{ display: 'block', marginBottom: 4 }}>
            alcance corregido (rev {fila.revision})
          </span>
        )}
        {fila.estados.length === 0 ? (
          <span className="texto-suave">sin codigos en el plan</span>
        ) : (
          fila.estados.map((c) => (
            <span key={c.codigo} className={`td-codigo td-${c.etiqueta.replace(/ /g, '-')}`} title={`${c.etiqueta}${c.variantes ? ` · ${c.variantes} tallas` : ''}${c.quien ? ` · ${c.quien}` : ''}`}>
              {c.codigo}{c.variantes ? `×${c.variantes}` : ''}
            </span>
          ))
        )}
      </td>
      <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
        {a ? (
          <>
            {a.asignadoANombre}
            <div className="texto-suave" style={{ fontSize: 12 }}>
              desde {fecha(a.creadoEn)}{a.fechaObjetivo ? ` · para el ${fecha(a.fechaObjetivo)}` : ''}
            </div>
            <HistorialAsignacion asignacionId={a.id} />
          </>
        ) : (
          <span className="tp-pill tp-pill-falta">sin asignar</span>
        )}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <Barra porcentaje={fila.porcentaje} chica />
        <span style={{ marginLeft: 6, fontSize: 13 }}>{fila.lista ? 'lista' : `${fila.listos} de ${fila.total} codigos`}</span>
      </td>
      <td style={{ fontSize: 13 }}>{fila.quienes.length ? fila.quienes.join(', ') : <span className="texto-suave">nadie todavia</span>}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {puedeRepartir && (!a || reasignando) && (
          <span className="tp-fila" style={{ gap: 6 }}>
            <select className="tp-input" style={{ width: 150 }} value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">{a ? 'Reasignar a' : 'Asignar a'}</option>
              {equipoDisponible.map((u) => (
                <option key={u.id} value={u.id}>{u.nombreCompleto}</option>
              ))}
            </select>
            {!a && aMano && (
              <input
                className="tp-input"
                style={{ width: 220 }}
                value={codigosTxt}
                placeholder="Codigos: 1273-I, 1274-I"
                title="Los codigos de esta OT, separados por coma"
                onChange={(e) => setCodigosTxt(e.target.value)}
              />
            )}
            {!a && <input className="tp-input" type="date" style={{ width: 140 }} value={fechaObj} onChange={(e) => setFechaObj(e.target.value)} title="Fecha objetivo (opcional)" />}
            <button
              className="btn-primario tp-btn-chico"
              disabled={ocupado || !persona || (!a && aMano && parsearCodigos(codigosTxt).length === 0)}
              onClick={() => {
                if (a) {
                  onCambiar(a, { asignadoAUid: persona.id, asignadoANombre: persona.nombreCompleto || '' }, 'reasignada', `OT ${fila.ot} reasignada a ${persona.nombreCompleto}.`)
                  setReasignando(false)
                } else {
                  onAsignar(encargo, fila.ot, { uid: persona.id, nombre: persona.nombreCompleto || '' }, aFecha(fechaObj), codigosTxt)
                }
                setDest('')
              }}
            >
              {a ? 'Cambiar' : 'Asignar'}
            </button>
            {a && <button className="btn-secundario tp-btn-chico" onClick={() => setReasignando(false)}>Cancelar</button>}
          </span>
        )}
        {puedeRepartir && a && !reasignando && (
          <span className="tp-fila" style={{ gap: 6 }}>
            <button className="btn-secundario tp-btn-chico" disabled={ocupado} onClick={() => setReasignando(true)}>Reasignar</button>
            {puedeCorregirCodigos && !corrigiendo && (
              <button className="btn-secundario tp-btn-chico" disabled={ocupado} onClick={() => { setCodigosTxt((a.codigos || []).join(', ')); setCorrigiendo(true) }}>Corregir codigos</button>
            )}
            {puedeCorregirCodigos && corrigiendo && (() => {
              const codigosCorregidos = parsearCodigos(codigosTxt)
              const excedeTope = codigosCorregidos.length > 120
              return (
                <span className="tp-fila" style={{ gap: 6 }}>
                  <input className="tp-input" style={{ width: 220 }} value={codigosTxt} onChange={(e) => setCodigosTxt(e.target.value)} />
                  {excedeTope && <small className="tp-aviso">maximo 120</small>}
                  <button
                    className="btn-primario tp-btn-chico"
                    disabled={ocupado || codigosCorregidos.length === 0 || excedeTope}
                    onClick={() => { onCambiar(a, { codigos: codigosCorregidos }, 'codigos corregidos', `Codigos de la OT ${fila.ot} corregidos.`); setCorrigiendo(false) }}
                  >
                    Guardar
                  </button>
                  <button className="btn-secundario tp-btn-chico" onClick={() => setCorrigiendo(false)}>Cancelar</button>
                </span>
              )
            })()}
            <button
              className="btn-secundario tp-btn-chico"
              disabled={ocupado}
              onClick={() => onCambiar(a, { estado: 'cancelada' }, 'cancelada por la jefa', `Asignacion de la OT ${fila.ot} cancelada.`)}
            >
              Quitar
            </button>
          </span>
        )}
      </td>
    </tr>
  )
}

// pentester P3a: 'codigos: +A, +B / -C' en vez de dejar que un cambio de
// alcance se pierda en el "Monica -> Monica" del renglon (mismo nombre, mismo
// estado, pero el denominador de la barra cambio).
function diffCodigos(antes, despues) {
  const a = antes || []
  const d = despues || []
  const agregados = d.filter((c) => !a.includes(c))
  const quitados = a.filter((c) => !d.includes(c))
  if (!agregados.length && !quitados.length) return null
  const partes = []
  if (agregados.length) partes.push(agregados.map((c) => `+${c}`).join(', '))
  if (quitados.length) partes.push(quitados.map((c) => `−${c}`).join(', '))
  return partes.join(' / ')
}

// Carga perezosa: no lee el historial hasta que se abre el <details>. Cada
// renglon cerrado no gasta ni una lectura.
function HistorialAsignacion({ asignacionId }) {
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [renglones, setRenglones] = useState(null)
  const [error, setError] = useState('')

  const alAbrir = (e) => {
    const yaAbierto = e.target.open
    setAbierto(yaAbierto)
    if (yaAbierto && renglones === null && !cargando) {
      setCargando(true)
      historialDeAsignacion(asignacionId)
        .then((r) => setRenglones(r))
        .catch((err) => setError(err?.message || 'No se pudo leer el historial.'))
        .finally(() => setCargando(false))
    }
  }

  return (
    <details style={{ marginTop: 4 }} onToggle={alAbrir} open={abierto}>
      <summary style={{ cursor: 'pointer', fontSize: 12 }}>Historial</summary>
      {cargando && <div className="texto-suave" style={{ fontSize: 12 }}>Cargando…</div>}
      {error && <div className="texto-suave" style={{ fontSize: 12 }}>{error}</div>}
      {renglones && renglones.length === 0 && <div className="texto-suave" style={{ fontSize: 12 }}>Sin cambios todavia.</div>}
      {renglones && renglones.length > 0 && (
        <ul style={{ fontSize: 12, paddingLeft: 16, margin: '4px 0' }}>
          {renglones.map((h) => {
            const diff = diffCodigos(h.antes?.codigos, h.despues?.codigos)
            const soloCodigos = diff && h.antes?.asignadoANombre === h.despues?.asignadoANombre && h.antes?.estado === h.despues?.estado
            return (
              <li key={h.id}>
                rev {h.revision} · {soloCodigos ? (
                  `codigos: ${diff}`
                ) : (
                  <>
                    {h.antes?.asignadoANombre || '—'}
                    {h.antes?.estado && h.despues?.estado && h.antes.estado !== h.despues.estado ? ` (${h.antes.estado})` : ''}
                    {' → '}
                    {h.despues?.asignadoANombre || '—'}
                    {h.despues?.estado ? ` (${h.despues.estado})` : ''}
                  </>
                )}
                {diff && !soloCodigos ? ` · codigos: ${diff}` : ''}
                {' · '}{h.quienNombre || '—'} · {fecha(h.cuando)}
                {h.motivo ? ` · ${h.motivo}` : ''}
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}

// ---------------------------------------------------------------- equipo: lo mio
function MisAsignaciones({ asignaciones, indice }) {
  const abiertas = asignaciones.filter((a) => a.estado === 'abierta')
  if (!abiertas.length) {
    return (
      <div className="tarjeta tp-vacio">
        <div className="tp-vacio-titulo">No tienes ordenes de trabajo asignadas</div>
        <div className="texto-suave">Cuando Lety te asigne una, aparece aqui con sus codigos.</div>
      </div>
    )
  }
  return abiertas.map((a) => {
    const av = avanceDeOt(a.codigos, indice)
    return (
      <div key={a.id} className={`tarjeta td-encargo ${av.lista ? 'td-lista' : ''}`}>
        <div className="tp-fila" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong style={{ fontSize: 16 }}>OT {a.ot}</strong>
            <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
              OC {a.oc} · te la asigno {a.asignadoPorNombre} el {fecha(a.creadoEn)}{a.fechaObjetivo ? ` · para el ${fecha(a.fechaObjetivo)}` : ''}
            </span>
          </div>
          <div className="tp-fila" style={{ gap: 10 }}>
            <Barra porcentaje={av.porcentaje} />
            <strong>{av.lista ? 'Lista' : `${av.listos} de ${av.total} codigos listos`}</strong>
          </div>
        </div>
        {a.notas && <p className="texto-suave" style={{ fontSize: 13 }}>{a.notas}</p>}
        <table className="tabla-datos" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Estado</th>
              <th>Checklist</th>
              <th>Ultimo cambio</th>
            </tr>
          </thead>
          <tbody>
            {av.estados.map((c) => (
              <tr key={c.codigo}>
                <td><span className="tp-codigo">{c.codigo}</span>{c.variantes ? <span className="texto-suave" style={{ fontSize: 12 }}> · {c.variantes} tallas</span> : null}</td>
                <td><span className={`td-codigo td-${c.etiqueta.replace(/ /g, '-')}`}>{c.etiqueta}</span></td>
                <td>{c.tiene ? `${c.porcentaje}%` : <span className="texto-suave">sube el archivo en Tech packs</span>}</td>
                <td className="texto-suave" style={{ fontSize: 13 }}>{c.quien || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  })
}

function Barra({ porcentaje, chica = false }) {
  const p = Math.max(0, Math.min(100, Number(porcentaje) || 0))
  return (
    <span className={`td-barra ${chica ? 'td-barra-chica' : ''}`} title={`${p}%`}>
      <span className={`td-barra-lleno ${p >= 100 ? 'td-barra-ok' : ''}`} style={{ width: `${p}%` }} />
    </span>
  )
}
