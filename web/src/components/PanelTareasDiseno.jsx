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
  cerrarEncargoConAsignaciones,
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
      let fallas = 0
      const pares = await Promise.all(uidsJefas.map(async (u) => [u, await equipoDe(u).catch(() => { fallas++; return [] })]))
      if (!vivo) return
      setEquipoPorJefa(new Map(pares))
      // Codex (10-sep): sin esto un fallo de lectura dejaba el "equipo
      // completo" incompleto en silencio.
      if (fallas) setError(`No se pudo leer el equipo de ${fallas} jefa(s): la tabla por persona esta incompleta. Recarga para reintentar.`)
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
      const codigosMios = mias.reduce((t, a) => t + a.total, 0)
      const listasMias = mias.filter((a) => a.lista).length
      return [
        { t: 'Mis OT abiertas', v: mias.length, que: 'Ordenes de trabajo que te asignaron y siguen abiertas.' },
        { t: 'Listas', v: listasMias, tono: listasMias ? 'ok' : '', que: 'OT en las que todos los codigos ya tienen tech pack con el checklist completo.' },
        { t: 'A medias', v: mias.filter((a) => !a.lista && a.porcentaje > 0).length, tono: 'aviso', que: 'OT con algun avance pero todavia no listas.' },
        // usuario-real (9-sep): "0" sin codigos cargados se leia como "vas bien";
        // era el cero de un conjunto vacio. Sin codigos, no hay nada que contar.
        // usuario-real (10-sep): el mismo codigo en dos OT se contaba dos veces;
        // Lety piensa en fichas que pedir, no en renglones: codigos DISTINTOS.
        { t: 'Codigos sin tech pack', v: codigosMios ? codigosSinTechPack(mias) : '—', tono: codigosMios && codigosSinTechPack(mias) ? 'aviso' : '', que: 'De los codigos que te tocan, cuantos (distintos) no tienen ni el archivo del tech pack en la biblioteca.' },
        { t: 'Avance promedio', v: mias.length ? Math.round(mias.reduce((t, a) => t + a.porcentaje, 0) / mias.length) + '%' : '—', que: 'Promedio del checklist de tus codigos (archivo + los 7 rubros).' }
      ]
    }
    const abiertos = encargos.filter((e) => e.estado === 'abierto')
    const filas = abiertos.flatMap((e) => avances.get(e.id)?.filas || [])
    const codigos = filas.reduce((t, f) => t + f.total, 0)
    const listas = filas.filter((f) => f.lista).length
    return [
      { t: 'Encargos abiertos', v: abiertos.length, que: 'Un encargo es una orden de compra (o un grupo de OT cargadas a mano) que hay que dejar con todos sus tech packs listos.' },
      { t: 'OT en encargos', v: filas.length, que: 'Ordenes de trabajo que suman los encargos abiertos.' },
      { t: 'OT listas', v: listas, tono: listas ? 'ok' : '', que: 'OT en las que todos los codigos ya tienen tech pack con el checklist completo.' },
      { t: 'OT sin asignar', v: filas.filter((f) => !f.asignacion).length, tono: filas.some((f) => !f.asignacion) ? 'aviso' : '', que: 'OT que todavia no le tocan a nadie del equipo.' },
      { t: 'Codigos sin tech pack', v: codigos ? codigosSinTechPack(filas) : '—', tono: codigos && codigosSinTechPack(filas) ? 'aviso' : '', que: 'De los codigos de las OT (del plan o tecleados), cuantos (distintos) no tienen ni el archivo del tech pack en la biblioteca. Sin codigos cargados no hay nada que contar.' },
      { t: 'Avance promedio', v: filas.length ? Math.round(filas.reduce((t, f) => t + f.porcentaje, 0) / filas.length) + '%' : '—', que: 'Promedio del checklist de los codigos (archivo + los 7 rubros).' }
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
          {vista === 'jefa' && 'Un encargo es una orden de compra (o un grupo de OT que cargas a mano) que hay que dejar con todos sus tech packs listos. Reparte sus ordenes de trabajo entre tu equipo; una OT esta lista cuando todos sus codigos tienen tech pack con el checklist completo.'}
          {vista === 'equipo' && 'Lo que te toca. Cada codigo se pone listo cuando su tech pack tiene archivo y el checklist completo en la pestana Tech packs.'}
        </p>
        <div className="tp-tiles" style={{ marginTop: 12 }}>
          {tiles.map((x) => (
            <div key={x.t} className={`tp-tile ${x.tono ? 'tp-tile-' + x.tono : ''}`} title={x.que}>
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
          onCerrarEncargo={(encargo, estado) => {
            // usuario-real (10-sep): cerraba de un clic, sin preguntar, con una
            // OT sin asignar y 0 de 3 listas; y Monica seguia viendo sus OT
            // abiertas. Se pregunta con los numeros y se arrastran las
            // asignaciones (cerrarEncargoConAsignaciones).
            const av = avances.get(encargo.id) || { listas: 0, total: 0, sinAsignar: 0 }
            const abiertas = asignaciones.filter((a) => a.encargoId === encargo.id && a.estado === 'abierta').length
            const verbo = estado === 'cerrado' ? 'Cerrar' : 'Cancelar'
            const ok = window.confirm(
              `${verbo} el encargo ${encargo.oc}?\n\n` +
                `Lleva ${av.listas} de ${av.total} OT listas` +
                (av.sinAsignar ? ` y ${av.sinAsignar} sin asignar` : '') +
                `.${abiertas ? `\nLas ${abiertas} asignacion(es) abierta(s) se ${estado === 'cerrado' ? 'cierran' : 'cancelan'} tambien (queda en su historial) y el equipo deja de verlas como pendientes.` : ''}` +
                `\n\nEl reparto se sigue pudiendo consultar en el encargo ${estado}.`
            )
            if (!ok) return
            correr(
              () => cerrarEncargoConAsignaciones({ encargo, estado, asignaciones, equipo: equipoPorJefa.get(encargo.responsableUid) ?? equipo, usuario }),
              (r) => `Encargo ${encargo.oc} ${estado}${r.asignaciones ? ` y ${r.asignaciones} asignacion(es) ${estado === 'cerrado' ? 'cerrada(s)' : 'cancelada(s)'}` : ''}.`
            )
          }}
        />
      )}

      {vista !== 'equipo' && <PorPersona asignaciones={asignaciones} indice={indice} equipo={vista === 'admin' ? [...equipoPorJefa.values()].flat() : equipo} />}

      {vista === 'equipo' && <MisAsignaciones asignaciones={asignaciones} indice={indice} />}
    </div>
  )
}

// Codigos DISTINTOS sin archivo de tech pack, a partir de avances (filas de
// encargo o de asignacion): el mismo codigo en dos OT es UNA ficha que pedir.
function codigosSinTechPack(avances) {
  return new Set(avances.flatMap((f) => (f.estados || []).filter((c) => !c.tiene).map((c) => c.codigo))).size
}

// ---------------------------------------------------------------- jefa: cuanto lleva cada quien
// usuario-real (10-sep): "para ver cuanto lleva mi equipo no hay donde
// verlo": los indicadores eran del encargo, no de las personas.
function PorPersona({ asignaciones, indice, equipo }) {
  const abiertas = asignaciones.filter((a) => a.estado === 'abierta')
  if (!abiertas.length && !(equipo || []).length) return null
  const porUid = new Map()
  // Primero el equipo completo (Codex: quien no tiene nada tambien cuenta),
  // luego lo asignado.
  ;(equipo || []).forEach((u) => porUid.set(u.id, { nombre: u.nombreCompleto || '—', ots: [], avances: [] }))
  abiertas.forEach((a) => {
    const av = avanceDeOt(a.codigos, indice)
    const p = porUid.get(a.asignadoAUid) || { nombre: a.asignadoANombre, ots: [], avances: [] }
    p.ots.push(a.ot)
    p.avances.push(av)
    porUid.set(a.asignadoAUid, p)
  })
  const filas = [...porUid.entries()].map(([id, p]) => ({ id, ...p })).sort((x, y) => x.nombre.localeCompare(y.nombre))
  return (
    <div className="tarjeta" style={{ marginTop: 12 }}>
      <h3 style={{ margin: 0 }}>Cuanto lleva cada quien</h3>
      <p className="texto-suave" style={{ margin: '4px 0 8px', fontSize: 13 }}>Carga y avance de las OT asignadas a cada quien (solo abiertas). El avance es el promedio por OT (cada OT pesa igual, tenga uno o veinte codigos) y sale de los tech packs; la biblioteca es de todos, asi que mide lo asignado, no quien subio cada archivo.</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabla-datos">
          <thead>
            <tr>
              <th>Persona</th>
              <th>OT abiertas</th>
              <th>Listas</th>
              <th>Codigos sin tech pack</th>
              <th>Avance</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => {
              const listas = p.avances.filter((a) => a.lista).length
              const total = p.avances.reduce((t, a) => t + a.total, 0)
              const prom = p.avances.length ? Math.round(p.avances.reduce((t, a) => t + a.porcentaje, 0) / p.avances.length) : 0
              return (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td>{p.ots.length ? <>{p.ots.length} <span className="texto-suave" style={{ fontSize: 12 }}>({p.ots.join(', ')})</span></> : <span className="texto-suave">nada asignado</span>}</td>
                  <td>{listas}</td>
                  <td>{total ? codigosSinTechPack(p.avances) : <span className="texto-suave">sin codigos</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><Barra porcentaje={prom} chica /> <span style={{ fontSize: 13 }}>{prom}%</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
            {e.origen === 'manual' && <span className="tp-pill" style={{ marginLeft: 8 }} title="Las OT se teclearon a mano; no vienen del plan de Adrian">cargado a mano</span>}
            <span className="texto-suave" style={{ marginLeft: 10, fontSize: 13 }}>
              {e.creadoPorUid === uid && e.responsableUid === uid
                ? `lo cargaste tu · ${fecha(e.creadoEn)}`
                : `encargada a ${e.responsableNombre} · ${fecha(e.creadoEn)}`}
              {e.fechaObjetivo ? ` · para el ${fecha(e.fechaObjetivo)}` : ''}
              {cerrado ? ` · ${e.estado} · abre para ver el reparto` : ''}
            </span>
          </div>
          <div className="tp-fila" style={{ gap: 12 }}>
            <Barra porcentaje={av.porcentaje} />
            <strong>{av.listas} de {av.total} OT listas</strong>
            <span className="texto-suave" style={{ fontSize: 13 }} title="Promedio del checklist de todos los codigos del encargo (archivo + 7 rubros), aunque la OT no este lista todavia">checklist al {av.interno}%</span>
            {av.sinAsignar > 0 && !cerrado && <span className="tp-pill tp-pill-falta">{av.sinAsignar} sin asignar</span>}
            {(esAdmin || (e.origen === 'manual' && e.responsableUid === uid)) && !cerrado && (
              <span className="tp-fila" style={{ gap: 6 }}>
                <button
                  className="btn-secundario tp-btn-chico"
                  disabled={ocupado}
                  onClick={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    onCerrarEncargo(e, 'cerrado')
                  }}
                >
                  {ocupado ? 'Cerrando...' : 'Cerrar encargo'}
                </button>
                <button
                  className="btn-secundario tp-btn-chico"
                  disabled={ocupado}
                  onClick={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    onCerrarEncargo(e, 'cancelado')
                  }}
                >
                  {ocupado ? 'Un momento...' : 'Cancelar encargo'}
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
      <td style={{ fontSize: 13 }}>
        {a ? (
          <>
            {a.asignadoANombre}
            {a.estado !== 'abierta' && <span className="tp-pill" style={{ marginLeft: 6 }}>{a.estado}</span>}
            <div className="texto-suave" style={{ fontSize: 12 }}>
              desde {fecha(a.creadoEn)}{a.fechaObjetivo ? ` · para el ${fecha(a.fechaObjetivo)}` : ''}
            </div>
            <HistorialAsignacion asignacion={a} />
          </>
        ) : (
          <span className="tp-pill tp-pill-falta">sin asignar</span>
        )}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <Barra porcentaje={fila.porcentaje} chica />
        <span style={{ marginLeft: 6, fontSize: 13 }}>{fila.lista ? 'lista' : fila.total ? `${fila.listos} de ${fila.total} codigos` : 'sin codigos todavia'}</span>
        {/* usuario-real (10-sep): "Asignada a" y "Quien lo ha trabajado" se
            peleaban en dos columnas y la tabla no cabia (987 px en 818).
            Quien ha tocado los tech packs va aqui, chiquito, solo si hay. */}
        {fila.quienes.length > 0 && <div className="texto-suave" style={{ fontSize: 12 }} title="Quien ha subido o editado los tech packs de estos codigos">tech packs de {fila.quienes.join(', ')}</div>}
      </td>
      <td>
        {puedeRepartir && (!a || reasignando) && (
          <span className="tp-fila" style={{ gap: 6, flexWrap: 'wrap' }}>
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
            {!a && (
              <label className="texto-suave" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Para cuando la quieres lista. Se puede dejar vacio.">
                limite <input className="tp-input" type="date" style={{ width: 130 }} value={fechaObj} onChange={(e) => setFechaObj(e.target.value)} />
              </label>
            )}
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
          <span className="tp-fila" style={{ gap: 6, flexWrap: 'wrap' }}>
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
function HistorialAsignacion({ asignacion }) {
  const asignacionId = asignacion.id
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [renglones, setRenglones] = useState(null)
  const [error, setError] = useState('')

  const cargar = () => {
    setCargando(true)
    historialDeAsignacion(asignacionId)
      .then((r) => setRenglones(r))
      .catch((err) => setError(err?.message || 'No se pudo leer el historial.'))
      .finally(() => setCargando(false))
  }
  const alAbrir = (e) => {
    const yaAbierto = e.target.open
    setAbierto(yaAbierto)
    if (yaAbierto && renglones === null && !cargando) cargar()
  }
  // Codex (10-sep): si el historial ya estaba abierto y la asignacion cambio
  // (correccion, reasignacion, cierre en cascada), el renglon nuevo no
  // aparecia hasta recargar la pagina. La revision es la senal.
  useEffect(() => {
    if (abierto && renglones !== null) cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignacion.revision])

  return (
    <details style={{ marginTop: 4 }} onToggle={alAbrir} open={abierto}>
      <summary style={{ cursor: 'pointer', fontSize: 12 }}>Historial</summary>
      {cargando && <div className="texto-suave" style={{ fontSize: 12 }}>Cargando…</div>}
      {error && <div className="texto-suave" style={{ fontSize: 12 }}>{error}</div>}
      {renglones && (
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
          {/* usuario-real (10-sep): "no queda registrado que yo asigne la OT ni
              con que codigos empezo". La regla solo admite renglones de
              revision 2 en adelante; el reparto original vive en el propio
              documento y se muestra desde ahi. */}
          {(() => {
            // Codex: despues de una reasignacion la foto actual ya no es la
            // original. La rev 1 real es el 'antes' del renglon mas viejo.
            const masViejo = renglones.length ? renglones.reduce((m, h) => (h.revision < m.revision ? h : m)) : null
            const origen = masViejo?.antes || asignacion
            const codigos = Array.isArray(origen.codigos) ? origen.codigos.filter((c) => typeof c === 'string') : []
            return (
              <li>
                rev 1 · asignada a {origen.asignadoANombre || '—'}
                {codigos.length ? ` con ${codigos.length} codigo(s): ${codigos.join(', ')}` : ''}
                {' · '}{asignacion.asignadoPorNombre || '—'} · {fecha(asignacion.creadoEn)}
              </li>
            )
          })()}
        </ul>
      )}
    </details>
  )
}

// ---------------------------------------------------------------- equipo: lo mio
function MisAsignaciones({ asignaciones, indice }) {
  const abiertas = asignaciones.filter((a) => a.estado === 'abierta')
  const cerradas = asignaciones.length - abiertas.length
  if (!abiertas.length) {
    return (
      <div className="tarjeta tp-vacio">
        <div className="tp-vacio-titulo">No tienes ordenes de trabajo abiertas</div>
        <div className="texto-suave">
          Cuando tu jefa te asigne una, aparece aqui con sus codigos.
          {cerradas ? ` Tienes ${cerradas} cerrada(s) o cancelada(s).` : ''}
        </div>
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
              {a.planVersionId === 'manual' ? `${a.oc} (cargada a mano)` : `OC ${a.oc}`} · te la asigno {a.asignadoPorNombre} el {fecha(a.creadoEn)}{a.fechaObjetivo ? ` · para el ${fecha(a.fechaObjetivo)}` : ''}
            </span>
          </div>
          <div className="tp-fila" style={{ gap: 10 }}>
            <Barra porcentaje={av.porcentaje} />
            <strong>{av.lista ? 'Lista' : av.total ? `${av.listos} de ${av.total} codigos listos` : 'sin codigos todavia'}</strong>
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
