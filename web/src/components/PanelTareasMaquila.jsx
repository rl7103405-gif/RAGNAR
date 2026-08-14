// TAREAS A MAQUILAS (interno): Lindbergh (flag puedeCrearTareas) y el admin
// encargan ensambles a las maquilas, con el TECH PACK del pedido adjunto.
//
// El tech pack: la maquila SOLO LO VE mientras la tarea esta abierta, y al
// terminar la tarea (regresa el producto terminado) se BORRA. Se recomienda
// subirlo en PDF: el Excel se muestra como extraccion, no como copia fiel.
// La subida deja la tarea en 'preparando' (invisible para la maquila) hasta
// que el archivo termina de subir; si se corta, aqui mismo se reintenta con
// el archivo elegido de nuevo, o se cancela la tarea.
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import VisorTechPack from './VisorTechPack'
import {
  ESTADOS_TAREA_ENSAMBLE,
  ErrorTareaEnsamble,
  MAX_TECHPACK_BYTES,
  crearTareaEnsamble,
  escucharTareasEnsambleDeVarias,
  formatoDeArchivo,
  limpiarTechPack,
  prepararCambioDeTechPack,
  subirTechPack,
  terminarTareaEnsamble
} from '../utils/tareasEnsamble'

const RENGLON_VACIO = { codigo: '', descripcion: '', cantidad: '', unidad: 'packs' }

export default function PanelTareasMaquila() {
  const { authUser, perfil, puedeCrearTareas, esPrueba } = useAuth()
  const maquilas = useMaquilas()
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [progreso, setProgreso] = useState('')
  const [trabajando, setTrabajando] = useState(null)
  const [visor, setVisor] = useState(null) // { maquilaId, tareaId, techPack }
  const [mostrarCerradas, setMostrarCerradas] = useState(false)

  const [nueva, setNueva] = useState({ maquilaId: '', titulo: '', notas: '' })
  const [renglones, setRenglones] = useState([{ ...RENGLON_VACIO }])
  const [archivo, setArchivo] = useState(null)

  // Se escucha maquila por maquila (no collectionGroup) para que el orden por
  // fecha sea real; depende del catalogo, asi que se re-suscribe si cambia.
  const idsMaquilas = maquilas.map((m) => m.id).join(',')
  useEffect(() => {
    if (!puedeCrearTareas) return
    const ids = idsMaquilas ? idsMaquilas.split(',') : []
    const unsub = escucharTareasEnsambleDeVarias(ids, setTareas, (err) => {
      console.error('[PanelTareasMaquila] Error escuchando:', err)
      setError('No se pudieron cargar las tareas: ' + (err.message || err))
    })
    return unsub
  }, [puedeCrearTareas, idsMaquilas])

  const usuario = () => ({ uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' })
  const nombreMaquila = (id) => maquilas.find((m) => m.id === id)?.nombre || id

  const reportar = (err) => {
    console.error('[PanelTareasMaquila]', err)
    setError(err instanceof ErrorTareaEnsamble ? err.message : String(err?.message || err))
  }

  const onCrear = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    setTrabajando('crear')
    try {
      await crearTareaEnsamble({
        maquilaId: nueva.maquilaId,
        titulo: nueva.titulo,
        renglones,
        notas: nueva.notas,
        archivo,
        usuario: usuario(),
        onProgreso: setProgreso
      })
      setNueva({ maquilaId: '', titulo: '', notas: '' })
      setRenglones([{ ...RENGLON_VACIO }])
      setArchivo(null)
      setAviso(
        archivo
          ? 'Tarea creada y tech pack subido: la maquila ya la ve en su portal.'
          : 'Tarea creada: la maquila ya la ve en su portal.'
      )
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  // Reintentar (o cambiar) el archivo de una tarea. Para 'preparando' sube
  // directo; para 'abierta' primero la regresa a 'preparando' (la maquila
  // deja de verla mientras) y luego sube.
  const onSubirArchivo = async (tarea, file) => {
    if (!file) return
    setError('')
    setAviso('')
    const formato = formatoDeArchivo(file.name)
    if (!formato) {
      setError('El tech pack tiene que ser .pdf o .xlsx. Mejor PDF: se ve tal cual.')
      return
    }
    // El tamano se revisa ANTES de leer el archivo: un arrayBuffer() de 100 MB
    // cuelga el navegador antes de poder decir "el tope son 15 MB".
    if (file.size > MAX_TECHPACK_BYTES) {
      setError(
        `El archivo pesa ${(file.size / 1048576).toFixed(1)} MB y el tope son 15 MB. ` +
          'Exportalo a PDF o quitale hojas que no necesite la maquila.'
      )
      return
    }
    setTrabajando(tarea.id)
    try {
      if (tarea.estado === 'abierta') await prepararCambioDeTechPack(tarea.maquilaId, tarea.id)
      await subirTechPack({
        maquilaId: tarea.maquilaId,
        tareaId: tarea.id,
        contenido: await file.arrayBuffer(),
        nombre: file.name,
        formato,
        onProgreso: setProgreso
      })
      setAviso(`Tech pack de "${tarea.titulo}" subido: la maquila ya lo puede ver.`)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  const onTerminar = async (tarea, estado) => {
    const pregunta =
      estado === 'terminada'
        ? `¿Terminar "${tarea.titulo}"? ${tarea.techPack ? 'El tech pack SE BORRA y la maquila deja de verlo.' : ''}`
        : `¿Cancelar "${tarea.titulo}"? ${tarea.techPack ? 'El tech pack SE BORRA.' : ''}`
    if (!window.confirm(pregunta)) return
    setError('')
    setAviso('')
    setTrabajando(tarea.id)
    try {
      await terminarTareaEnsamble({
        maquilaId: tarea.maquilaId,
        tarea,
        estado,
        usuario: usuario(),
        onProgreso: setProgreso
      })
      setAviso(
        estado === 'terminada'
          ? `Tarea "${tarea.titulo}" terminada${tarea.techPack ? ' y tech pack borrado' : ''}.`
          : `Tarea "${tarea.titulo}" cancelada${tarea.techPack ? ' y tech pack borrado' : ''}.`
      )
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  const onLimpiarPendiente = async (tarea) => {
    setError('')
    setTrabajando(tarea.id)
    try {
      await limpiarTechPack({ maquilaId: tarea.maquilaId, tareaId: tarea.id, onProgreso: setProgreso })
      setAviso(`Tech pack de "${tarea.titulo}" borrado.`)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  const fechaDe = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '-')

  if (!puedeCrearTareas) {
    return (
      <div className="tarjeta">
        <p className="texto-suave">Esta pestana es de quien encarga tareas a las maquilas.</p>
      </div>
    )
  }

  const vivas = tareas.filter((t) => ['preparando', 'abierta'].includes(t.estado))
  const cerradas = tareas.filter((t) => ['terminada', 'cancelada'].includes(t.estado))

  const tarjeta = (t) => (
    <div
      key={`${t.maquilaId}_${t.id}`}
      style={{
        border: '1px solid #d8dee6',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 10,
        background: t.estado === 'preparando' ? '#fff8e6' : '#fff',
        opacity: ['terminada', 'cancelada'].includes(t.estado) ? 0.75 : 1
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 15 }}>{t.titulo}</strong>
        <span
          style={{ fontSize: 12, background: '#e7effd', color: '#1e40af', borderRadius: 999, padding: '2px 10px' }}
        >
          {nombreMaquila(t.maquilaId)}
        </span>
        <span className="texto-suave" style={{ fontSize: 13 }}>
          {ESTADOS_TAREA_ENSAMBLE[t.estado] || t.estado} · pedida el {fechaDe(t.creadoEn)}
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 13 }}>
        {(t.renglones || []).map((r) => (
          <div key={r.codigo}>
            <strong>{r.codigo}</strong> · {r.cantidad} {r.unidad}
            {r.descripcion ? ` · ${r.descripcion}` : ''}
          </div>
        ))}
      </div>
      {t.notas && <p className="texto-suave" style={{ fontSize: 13, margin: '6px 0 0' }}>{t.notas}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
        {t.techPack && (
          <button
            className="btn-secundario"
            onClick={() => setVisor({ maquilaId: t.maquilaId, tareaId: t.id, techPack: t.techPack })}
          >
            Ver tech pack
          </button>
        )}
        {t.estado === 'preparando' && (
          <>
            <label className="btn-secundario" style={{ cursor: 'pointer' }}>
              {trabajando === t.id ? 'Subiendo...' : 'Subir el tech pack (se corto la subida)'}
              <input
                type="file"
                accept=".pdf,.xlsx"
                style={{ display: 'none' }}
                disabled={trabajando === t.id}
                onChange={(e) => {
                  onSubirArchivo(t, e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <button
              className="btn-secundario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'cancelada')}
            >
              Cancelar tarea
            </button>
          </>
        )}
        {t.estado === 'abierta' && (
          <>
            <label className="btn-secundario" style={{ cursor: 'pointer' }}>
              {t.techPack ? 'Cambiar tech pack' : 'Adjuntar tech pack'}
              <input
                type="file"
                accept=".pdf,.xlsx"
                style={{ display: 'none' }}
                disabled={trabajando === t.id}
                onChange={(e) => {
                  onSubirArchivo(t, e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <button
              className="btn-primario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'terminada')}
              title="Cuando la maquila ya regreso el producto terminado"
            >
              Terminar (regreso el PT)
            </button>
            <button
              className="btn-secundario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'cancelada')}
            >
              Cancelar
            </button>
          </>
        )}
        {['terminada', 'cancelada'].includes(t.estado) && t.techPack && (
          <button
            className="btn-secundario"
            disabled={trabajando === t.id}
            onClick={() => onLimpiarPendiente(t)}
            style={{ borderColor: '#dc2626', color: '#dc2626' }}
          >
            Borrar el tech pack pendiente
          </button>
        )}
        {['terminada', 'cancelada'].includes(t.estado) && (
          <span className="texto-suave" style={{ fontSize: 12 }}>
            {t.terminadaPorNombre ? `Cerrada por ${t.terminadaPorNombre} el ${fechaDe(t.terminadaEn)}` : ''}
            {t.techPack ? ' · el tech pack NO se ha borrado' : ' · tech pack borrado'}
          </span>
        )}
      </div>
    </div>
  )

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}
      {progreso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{progreso}</div>}

      <form className="tarjeta" onSubmit={onCrear} style={{ marginBottom: 18 }}>
        <h2>Encargar ensamble a una maquila</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          La maquila ve la tarea en su portal con el tech pack <strong>solo en pantalla</strong>{' '}
          (sin descarga), y el archivo <strong>se borra</strong> cuando la tarea termina. Subelo de
          preferencia en <strong>PDF</strong>: el Excel se muestra como extraccion, no tal cual.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <label className="campo" style={{ flex: '1 1 220px' }}>
            <span>Maquila</span>
            <select
              value={nueva.maquilaId}
              onChange={(e) => setNueva({ ...nueva, maquilaId: e.target.value })}
            >
              <option value="">Elige la maquila</option>
              {maquilas
                // Cada mundo ve solo sus maquilas: un Tech Pack de un pedido
                // real no debe poder mandarse a la maquila de pruebas.
                .filter((m) => m.activo && (m.esPrueba === true) === esPrueba)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
            </select>
          </label>
          <label className="campo" style={{ flex: '2 1 260px' }}>
            <span>Titulo (pedido o cliente)</span>
            <input
              type="text"
              placeholder="ej. Shasa OC 1116302"
              maxLength={120}
              value={nueva.titulo}
              onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })}
            />
          </label>
        </div>

        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Modelos a ensamblar</span>
          {renglones.map((r, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              <input
                type="text"
                placeholder="Codigo / modelo"
                style={{ flex: '1 1 140px' }}
                value={r.codigo}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], codigo: e.target.value }
                  setRenglones(copia)
                }}
              />
              <input
                type="text"
                placeholder="Descripcion (opcional)"
                style={{ flex: '2 1 200px' }}
                value={r.descripcion}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], descripcion: e.target.value }
                  setRenglones(copia)
                }}
              />
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Cantidad"
                style={{ flex: '0 1 110px' }}
                value={r.cantidad}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], cantidad: e.target.value }
                  setRenglones(copia)
                }}
              />
              <select
                style={{ flex: '0 1 110px' }}
                value={r.unidad}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], unidad: e.target.value }
                  setRenglones(copia)
                }}
              >
                <option value="packs">packs</option>
                <option value="docenas">docenas</option>
                <option value="piezas">piezas</option>
              </select>
              {renglones.length > 1 && (
                <button
                  type="button"
                  className="btn-secundario"
                  onClick={() => setRenglones(renglones.filter((_, j) => j !== i))}
                >
                  Quitar
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-secundario"
            style={{ marginTop: 6 }}
            onClick={() => setRenglones([...renglones, { ...RENGLON_VACIO }])}
          >
            + Otro modelo
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, alignItems: 'flex-end' }}>
          <label className="campo" style={{ flex: '2 1 260px' }}>
            <span>Notas para la maquila (opcional)</span>
            <input
              type="text"
              maxLength={300}
              value={nueva.notas}
              onChange={(e) => setNueva({ ...nueva, notas: e.target.value })}
            />
          </label>
          <label className="campo" style={{ flex: '1 1 240px' }}>
            <span>Tech pack (PDF de preferencia, o Excel) · max 15 MB</span>
            <input
              type="file"
              accept=".pdf,.xlsx"
              onChange={(e) => setArchivo(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        <button className="btn-primario" type="submit" disabled={trabajando === 'crear'}>
          {trabajando === 'crear' ? progreso || 'Creando...' : 'Encargar a la maquila'}
        </button>
      </form>

      <div className="tarjeta">
        <h2>Tareas de ensamble ({vivas.length})</h2>
        {vivas.length === 0 ? (
          <p className="texto-suave">No hay tareas de ensamble abiertas.</p>
        ) : (
          vivas.map(tarjeta)
        )}
        {cerradas.length > 0 && (
          <>
            <button
              className="btn-secundario"
              style={{ marginTop: 6 }}
              onClick={() => setMostrarCerradas(!mostrarCerradas)}
            >
              {mostrarCerradas ? 'Ocultar terminadas' : `Ver terminadas (${cerradas.length})`}
            </button>
            {mostrarCerradas && <div style={{ marginTop: 10 }}>{cerradas.map(tarjeta)}</div>}
          </>
        )}
      </div>

      {visor && <VisorTechPack {...visor} onCerrar={() => setVisor(null)} />}
    </>
  )
}
