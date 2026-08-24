// PORTAL DE LA MAQUILA — pestana "Tareas de ensamble": lo que Quini le
// encargo armar, con el TECH PACK del pedido visible SOLO EN PANTALLA.
//
// Desde el 2026-08-14 la maquila REPORTA su avance: marca cuando empieza y
// cuando termina. Lo que NO hace es cerrar la tarea -- eso es de Quini, y es
// el cierre lo que borra el tech pack. Asi un dedazo no le quita el documento
// con el que esta armando, y alguien de Quini verifica lo entregado antes de
// dar la tarea por buena.
import { generarRemisionMaquila } from '../utils/remisionMaquila'
import { descargarPdf } from '../utils/pdf'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import VisorTechPack from './VisorTechPack'
import {
  ESTADOS_TAREA_ENSAMBLE,
  ESTADOS_EN_LA_MAQUILA,
  declararTareaEnsambleTerminada,
  escucharTareasEnsambleDeMaquila,
  iniciarTareaEnsamble,
  retirarDeclaracionTareaEnsamble
} from '../utils/tareasEnsamble'

export default function TareasEnsambleMaquila() {
  const { maquilaId, perfil, authUser, esPrueba } = useAuth()
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [visor, setVisor] = useState(null)
  const [trabajando, setTrabajando] = useState(null)
  // Tarea sobre la que se esta escribiendo la nota antes de declarar.
  const [declarando, setDeclarando] = useState(null)
  const [nota, setNota] = useState('')
  // Lo que la maquila declara ENTREGAR, renglon por renglon. Arranca vacio a
  // proposito: si se precargara con lo que se le pidio, el papel diria que
  // entrego todo aunque haya entregado la mitad — y ese papel es con el que
  // cobra. { [codigo]: { packs, docenas, caja, observaciones } }
  const [entrega, setEntrega] = useState({})
  const [bultos, setBultos] = useState('')
  // Los precios que Cielo puso para ESTA maquila. Se leen al abrir el modal
  // porque son lo que imprime la remision con la que se cobra. Si no hay, la
  // columna sale en blanco para escribirla a mano, como hoy.
  const [precios, setPrecios] = useState(new Map())

  useEffect(() => {
    if (!maquilaId) return
    const unsub = escucharTareasEnsambleDeMaquila(maquilaId, setTareas, (err) => {
      console.error('[TareasEnsambleMaquila] Error escuchando:', err)
      setError('No se pudieron cargar tus tareas: ' + (err.message || err))
    })
    return unsub
  }, [maquilaId])

  // El visor se cierra solo si la tarea que se esta viendo deja de estar en
  // manos de la maquila (Quini la cerro mientras tenia el archivo abierto).
  // No recupera los bytes que ya se entregaron -- eso no lo puede hacer nadie
  // desde el navegador --, pero no deja el documento abierto en pantalla.
  useEffect(() => {
    if (!visor) return
    const viva = tareas.find((t) => t.id === visor.tareaId)
    if (!viva || !ESTADOS_EN_LA_MAQUILA.includes(viva.estado)) setVisor(null)
  }, [tareas, visor])

  const usuario = () => ({
    uid: authUser?.uid,
    nombre: perfil?.nombreCompleto || ''
  })

  const reportar = (err) => {
    console.error('[TareasEnsambleMaquila]', err)
    // 'permission-denied' aqui casi siempre es una carrera: Quini cerro o
    // devolvio la tarea mientras esta pantalla tenia el boton viejo.
    setError(
      err?.code === 'permission-denied'
        ? 'Esa tarea acaba de cambiar (Quini la cerro o te la regreso). Se actualizo sola: revisala.'
        : 'No se pudo guardar: ' + (err?.message || err)
    )
  }

  const onIniciar = async (t) => {
    setError('')
    setAviso('')
    setTrabajando(t.id)
    try {
      await iniciarTareaEnsamble({ maquilaId, tareaId: t.id, usuario: usuario() })
      setAviso(`Quedo marcado que empezaste "${t.titulo}".`)
    } catch (err) {
      reportar(err)
    } finally {
      setTrabajando(null)
    }
  }

  useEffect(() => {
    if (!maquilaId) return
    const unsub = onSnapshot(
      collection(db, 'portalMaquila', maquilaId, 'preciosEnsamble'),
      (snap) => {
        const m = new Map()
        snap.docs.forEach((d) => m.set(d.id, Number(d.data().precioPorPack) || 0))
        setPrecios(m)
      },
      (err) => console.warn('[TareasEnsamble] No se pudieron leer los precios:', err?.message)
    )
    return unsub
  }, [maquilaId])

  const ponEntrega = (codigo, campo, valor) =>
    setEntrega((prev) => ({ ...prev, [codigo]: { ...(prev[codigo] || {}), [campo]: valor } }))

  /** Los renglones listos para el PDF, con lo del catalogo ya resuelto. */
  const renglonesParaRemision = (t) =>
    (t.renglones || []).map((r) => {
      const cap = entrega[r.codigo] || {}
      return {
        ot: t.ot || '',
        subCliente: t.destino || '',
        codigo: r.codigo,
        // Descripcion, modelo y talla vienen DENTRO de la tarea: se
        // resolvieron del catalogo cuando Quini la creo. La maquila no puede
        // leer el catalogo (es externa) y no tiene por que hacerlo.
        descripcion: r.descripcion || '',
        modelo: r.modelo || '',
        talla: r.talla || '',
        packs: cap.packs,
        docenas: cap.docenas,
        // Si Cielo ya puso el precio de este codigo para esta maquila, va
        // impreso y la remision suma sola. Si no, la columna sale en blanco.
        precioUnitario: precios.get(r.codigo) || 0,
        observaciones: cap.observaciones || '',
        caja: cap.caja || ''
      }
    })

  const onDescargarRemision = (t) => {
    try {
      const blob = generarRemisionMaquila({
        renglones: renglonesParaRemision(t),
        enc: {
          maquila: perfil?.nombreCompleto || 'Maquila',
          recibe: 'DEPORTIVOS QUINI',
          direccion: '',
          folio: '',
          fechaEntrega: new Date().toLocaleDateString('es-MX'),
          entrega: perfil?.nombreCompleto || '',
          bultos
        },
        esPrueba
      })
      descargarPdf(blob, `Entrega ${t.titulo}.pdf`)
    } catch (err) {
      console.error('[TareasEnsambleMaquila] No se pudo generar la remision:', err)
      setError('No se pudo generar la remision: ' + (err.message || err))
    }
  }

  const onDeclarar = async () => {
    const t = declarando
    setError('')
    setAviso('')
    setTrabajando(t.id)
    try {
      await declararTareaEnsambleTerminada({ maquilaId, tarea: t, usuario: usuario(), nota })
      // La remision sale JUNTO con el aviso: es el papel que viaja con la
      // mercancia. Si falla el PDF, la tarea YA quedo declarada — se avisa y
      // se puede volver a descargar desde la tarjeta.
      onDescargarRemision(t)
      setAviso(
        `Avisaste que terminaste "${t.titulo}" y se descargo tu remision. ` +
          'Imprimela y mandala con la mercancia.'
      )
      setDeclarando(null)
      setNota('')
      setEntrega({})
      setBultos('')
    } catch (err) {
      reportar(err)
    } finally {
      setTrabajando(null)
    }
  }

  const onRetirar = async (t) => {
    if (!window.confirm(`¿Quitar el aviso de terminada de "${t.titulo}"? Vuelve a quedar en proceso.`)) return
    setError('')
    setAviso('')
    setTrabajando(t.id)
    try {
      await retirarDeclaracionTareaEnsamble({ maquilaId, tareaId: t.id })
      setAviso(`"${t.titulo}" volvio a quedar en proceso.`)
    } catch (err) {
      reportar(err)
    } finally {
      setTrabajando(null)
    }
  }

  // 'preparando' con publicadaEn: Quini le esta cambiando el archivo a una
  // tarea que la maquila ya vio. No es una tarea cerrada ni cancelada -- antes
  // se mostraba como "cancelada", que era mentira.
  const enMisManos = tareas.filter((t) => ESTADOS_EN_LA_MAQUILA.includes(t.estado))
  const actualizandose = tareas.filter((t) => t.estado === 'preparando')
  const cerradas = tareas.filter((t) => ['terminada', 'cancelada'].includes(t.estado))

  const fechaHora = (t) =>
    t?.toDate ? t.toDate().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'

  const tarjeta = (t) => {
    const enManos = ESTADOS_EN_LA_MAQUILA.includes(t.estado)
    return (
      <div
        key={t.id}
        style={{
          border: '1px solid',
          borderColor: t.estado === 'declarada' ? '#16a34a' : enManos ? '#d8dee6' : '#e5e7eb',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 10,
          background: '#fff',
          opacity: enManos || t.estado === 'preparando' ? 1 : 0.7
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
          <strong style={{ fontSize: 15 }}>{t.titulo}</strong>
          {t.ot && (
          <span
            style={{ fontSize: 12, background: '#ecfdf5', color: '#065f46', borderRadius: 999, padding: '2px 10px' }}
            title={t.destino ? `Orden de trabajo ${t.ot}, va a ${t.destino}` : `Orden de trabajo ${t.ot}`}
          >
            OT {t.ot}
            {t.destino ? ` · ${t.destino}` : ''}
          </span>
          )}

          <span className="texto-suave" style={{ fontSize: 13 }}>
            {ESTADOS_TAREA_ENSAMBLE[t.estado] || t.estado} · encargada el {fechaHora(t.creadoEn)}
          </span>
        </div>
        <div style={{ marginTop: 6, fontSize: 14 }}>
          {(t.renglones || []).map((r) => (
            <div key={r.codigo}>
              <strong>{r.codigo}</strong> · {r.cantidad} {r.unidad}
              {r.descripcion ? ` · ${r.descripcion}` : ''}
            </div>
          ))}
        </div>
        {t.notas && <p className="texto-suave" style={{ fontSize: 13, margin: '6px 0 0' }}>{t.notas}</p>}

        {/* Lo que Quini te regreso: va arriba de los botones y en rojo, porque
            es lo que hay que leer antes de volver a picar "ya termine". */}
        {t.motivoDevolucion && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 6,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              fontSize: 13
            }}
          >
            <strong style={{ color: '#b91c1c' }}>Te la regresaron:</strong> {t.motivoDevolucion}
            <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
              {t.devueltaPorNombre} · {fechaHora(t.devueltaEn)}
            </div>
          </div>
        )}

        {/* La historia de la tarea, en una linea */}
        {(t.iniciadaEn || t.declaradaEn) && (
          <div className="texto-suave" style={{ fontSize: 12, marginTop: 6 }}>
            {t.iniciadaEn && <>Empezaste el {fechaHora(t.iniciadaEn)}</>}
            {t.declaradaEn && <> · avisaste que terminaste el {fechaHora(t.declaradaEn)}</>}
          </div>
        )}
        {t.notaMaquila && (
          <p className="texto-suave" style={{ fontSize: 13, margin: '4px 0 0' }}>
            Tu nota: {t.notaMaquila}
          </p>
        )}

        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {enManos && t.techPack && (
            <button
              className="btn-secundario"
              onClick={() => setVisor({ maquilaId, tareaId: t.id, techPack: t.techPack })}
            >
              Ver tech pack
            </button>
          )}
          {enManos && !t.techPack && (
            <span className="texto-suave" style={{ fontSize: 13 }}>
              Esta tarea no trae tech pack adjunto.
            </span>
          )}

          {t.estado === 'abierta' && (
            <button className="btn-primario" disabled={trabajando === t.id} onClick={() => onIniciar(t)}>
              Ya empece
            </button>
          )}
          {['abierta', 'iniciada'].includes(t.estado) && (
            <button
              className="btn-primario"
              disabled={trabajando === t.id}
              onClick={() => {
                setDeclarando(t)
                setNota('')
              }}
              style={{ background: '#16a34a' }}
            >
              Ya termine
            </button>
          )}
          {t.estado === 'declarada' && (
            <button
              className="btn-secundario"
              onClick={() => {
                setDeclarando(t)
                setAviso('Vuelve a anotar lo que entregaste y descarga la remision otra vez.')
              }}
              style={{ marginRight: 8 }}
            >
              Volver a generar mi remision
            </button>
          )}
          {t.estado === 'declarada' && (
            <>
              <span style={{ fontSize: 13, color: '#16a34a', alignSelf: 'center' }}>
                Avisaste que terminaste. Falta que Quini lo confirme.
              </span>
              <button className="btn-secundario" disabled={trabajando === t.id} onClick={() => onRetirar(t)}>
                Me equivoque, sigo trabajando
              </button>
            </>
          )}

          {t.estado === 'preparando' && (
            <span className="texto-suave" style={{ fontSize: 13 }}>
              Quini esta actualizando el tech pack de esta tarea. En un momento la vuelves a ver.
            </span>
          )}
          {['terminada', 'cancelada'].includes(t.estado) && (
            <span className="texto-suave" style={{ fontSize: 13 }}>
              Tarea {t.estado === 'terminada' ? 'terminada' : 'cancelada'}: el tech pack ya no esta
              disponible.
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}

      <div className="tarjeta">
        <h2>Tareas de ensamble ({enMisManos.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Lo que Quini te encargo armar. Marca <strong>&quot;Ya empece&quot;</strong> cuando arranques y{' '}
          <strong>&quot;Ya termine&quot;</strong> cuando acabes; Quini lo confirma de su lado. El tech pack se
          consulta <strong>aqui en pantalla</strong> mientras la tarea es tuya.
        </p>
        {enMisManos.length === 0 ? (
          <p className="texto-suave">No tienes tareas de ensamble pendientes.</p>
        ) : (
          enMisManos.map(tarjeta)
        )}
        {actualizandose.map(tarjeta)}
      </div>

      {cerradas.length > 0 && (
        <div className="tarjeta" style={{ marginTop: 18 }}>
          <h2>Cerradas ({cerradas.length})</h2>
          {cerradas.map(tarjeta)}
        </div>
      )}

      {declarando && (
        <div
          onClick={() => setDeclarando(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 20,
              width: '100%',
              maxWidth: 460,
              boxShadow: '0 10px 40px rgba(0,0,0,.25)'
            }}
          >
            <h3 style={{ marginTop: 0 }}>Ya termine: {declarando.titulo}</h3>
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Anota <strong>lo que de verdad vas a entregar</strong>. Con esto se genera tu remision
              (el papel que va con la mercancia y con el que cobras), y Quini la confirma al recibir.
            </p>

            {/* Se captura lo ENTREGADO, no lo pedido: la maquila puede entregar
                menos de lo que se le encargo, y el papel tiene que decir lo que
                va en la caja. Arriba de cada campo se ve lo que se pidio, para
                comparar sin tener que recordarlo. */}
            <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 10 }}>
              {(declarando.renglones || []).map((r) => (
                <div
                  key={r.codigo}
                  style={{ borderTop: '1px solid #eef2f7', padding: '8px 0', fontSize: 13 }}
                >
                  <div>
                    <strong>{r.codigo}</strong>
                    {r.descripcion ? ' · ' + r.descripcion : ''}
                    <span className="texto-suave">
                      {' '}
                      · te pidieron {r.cantidad} {r.unidad}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    <label className="campo" style={{ flex: '1 1 90px', margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Packs armados</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={entrega[r.codigo]?.packs ?? ''}
                        onChange={(e) => ponEntrega(r.codigo, 'packs', e.target.value)}
                      />
                    </label>
                    <label className="campo" style={{ flex: '1 1 90px', margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Docenas</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={entrega[r.codigo]?.docenas ?? ''}
                        onChange={(e) => ponEntrega(r.codigo, 'docenas', e.target.value)}
                      />
                    </label>
                    <label className="campo" style={{ flex: '1 1 70px', margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Caja</span>
                      <input
                        type="text"
                        maxLength={10}
                        value={entrega[r.codigo]?.caja ?? ''}
                        onChange={(e) => ponEntrega(r.codigo, 'caja', e.target.value)}
                      />
                    </label>
                    <label className="campo" style={{ flex: '2 1 140px', margin: 0 }}>
                      <span style={{ fontSize: 11 }}>Observaciones</span>
                      <input
                        type="text"
                        maxLength={60}
                        placeholder="ej. pareado sencillo"
                        value={entrega[r.codigo]?.observaciones ?? ''}
                        onChange={(e) => ponEntrega(r.codigo, 'observaciones', e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <label className="campo">
              <span>Total de bultos / cajas que mandas</span>
              <input
                type="number"
                min="0"
                step="1"
                value={bultos}
                onChange={(e) => setBultos(e.target.value)}
                style={{ maxWidth: 140 }}
              />
            </label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="Opcional: alguna nota para Quini"
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn-secundario" onClick={() => setDeclarando(null)}>
                Cancelar
              </button>
              <button
                className="btn-primario"
                disabled={trabajando === declarando.id}
                onClick={onDeclarar}
                style={{ background: '#16a34a' }}
              >
                {trabajando === declarando.id ? 'Guardando...' : 'Ya termine y generar remision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {visor && <VisorTechPack {...visor} onCerrar={() => setVisor(null)} />}
    </>
  )
}
