// PORTAL DE LA MAQUILA — pestana "Tareas de ensamble": lo que Quini le
// encargo armar, con el TECH PACK del pedido visible SOLO EN PANTALLA.
//
// Desde el 2026-08-14 la maquila REPORTA su avance: marca cuando empieza y
// cuando termina. Lo que NO hace es cerrar la tarea -- eso es de Quini, y es
// el cierre lo que borra el tech pack. Asi un dedazo no le quita el documento
// con el que esta armando, y alguien de Quini verifica lo entregado antes de
// dar la tarea por buena.
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
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
  const { maquilaId, perfil, authUser } = useAuth()
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [visor, setVisor] = useState(null)
  const [trabajando, setTrabajando] = useState(null)
  // Tarea sobre la que se esta escribiendo la nota antes de declarar.
  const [declarando, setDeclarando] = useState(null)
  const [nota, setNota] = useState('')

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

  const onDeclarar = async () => {
    const t = declarando
    setError('')
    setAviso('')
    setTrabajando(t.id)
    try {
      await declararTareaEnsambleTerminada({ maquilaId, tarea: t, usuario: usuario(), nota })
      setAviso(`Avisaste que terminaste "${t.titulo}". Quini lo va a confirmar.`)
      setDeclarando(null)
      setNota('')
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
              Quini lo va a confirmar de su lado. Si quieres, dejale una nota (cuantos salieron, si hubo
              algun detalle).
            </p>
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
                {trabajando === declarando.id ? 'Guardando...' : 'Si, ya termine'}
              </button>
            </div>
          </div>
        </div>
      )}

      {visor && <VisorTechPack {...visor} onCerrar={() => setVisor(null)} />}
    </>
  )
}
