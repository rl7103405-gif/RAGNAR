// Corregir una remision ya emitida (PDF de salida): "anular y reemitir".
//
// Dos etapas deliberadamente separadas:
//   1. SIN autorizacion -> America arma la propuesta (maquila destino y lista
//      final de folios) y escribe el motivo. Se manda a Roberto.
//   2. CON autorizacion aprobada -> el modal muestra en SOLO LECTURA lo que
//      Roberto aprobo y solo permite aplicarlo. Si dejara editar aqui, la
//      autorizacion seria un permiso abierto para reemitir lo que sea.
import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { autoAprobarCorreccion, autorizacionVigente, pedirCorreccion } from '../utils/auditoria'
import { reemitirPdf, ErrorReemision } from '../utils/reemitirPdf'
import { compararAscendente } from '../utils/texto'

export default function CorregirPdfModal({ registro, onCerrar, onListo }) {
  const { authUser, perfil, esAdmin, esPrueba } = useAuth()
  const maquilas = useMaquilas()
  // Mismo criterio simetrico que al emitir: una correccion no puede cambiar la
  // remision de mundo, asi que el destino solo puede ser del mundo propio.
  const activas = useMemo(
    () => maquilas.filter((m) => m.activo && (m.esPrueba === true) === esPrueba),
    [maquilas, esPrueba]
  )

  const [cargando, setCargando] = useState(true)
  const [autorizacion, setAutorizacion] = useState(null)
  const [solicitudAprobada, setSolicitudAprobada] = useState(null)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  // Propuesta que arma America (etapa 1).
  const foliosOriginales = useMemo(
    () => [...(registro.folios || [])].map(String).sort(compararAscendente),
    [registro.folios]
  )
  const [seleccion, setSeleccion] = useState(() => new Set(foliosOriginales))
  const [maquilaId, setMaquilaId] = useState(registro.maquila?.id || '')
  const [motivo, setMotivo] = useState('')
  const [foliosExtra, setFoliosExtra] = useState('')

  const folioInternoOriginal = registro.encabezado?.folioInterno ?? '-'

  useEffect(() => {
    let cancelado = false
    autorizacionVigente(registro.id, 'editar_pdf')
      .then(async (auth) => {
        if (cancelado) return
        setAutorizacion(auth)
        if (auth?.solicitudId) {
          try {
            const snap = await getDoc(doc(db, 'solicitudesCorreccion', auth.solicitudId))
            if (!cancelado && snap.exists()) setSolicitudAprobada({ id: snap.id, ...snap.data() })
          } catch (err) {
            console.error('[CorregirPdfModal] No se pudo leer la solicitud aprobada:', err)
          }
        }
      })
      .catch((err) => {
        if (!cancelado) setError('No se pudo consultar el permiso: ' + (err.message || err))
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [registro.id])

  // esPrueba viaja con el usuario: reemitirPdf lo cruza contra el registro que
  // se corrige para no mezclar los dos consecutivos de folio interno.
  const usuario = {
    uid: authUser?.uid,
    nombre: perfil?.nombreCompleto || 'Estacion',
    esPrueba: perfil?.esPrueba === true
  }

  const foliosPropuestos = useMemo(() => {
    const extra = foliosExtra
      .split(/[\s,;]+/)
      .map((f) => f.trim())
      .filter(Boolean)
    return [...new Set([...seleccion, ...extra])].sort(compararAscendente)
  }, [seleccion, foliosExtra])

  const onPedirPermiso = async () => {
    setError('')
    const maquila = activas.find((m) => m.id === maquilaId)
    if (!maquila) return setError('Elige la maquila a la que debe ir la remision corregida.')
    if (!motivo.trim()) return setError('Escribe por que hay que corregirla (queda en la bitacora).')
    if (foliosPropuestos.length === 0) return setError('La remision corregida no puede quedar vacia.')
    setTrabajando(true)
    try {
      await pedirCorreccion({
        folio: registro.id,
        tipo: 'editar_pdf',
        motivo: motivo.trim(),
        usuario,
        propuesta: {
          maquilaId: maquila.id,
          maquilaNombre: maquila.nombre,
          folios: foliosPropuestos,
          folioInternoOriginal: Number(folioInternoOriginal)
        }
      })
      onListo(
        `Solicitud enviada a Roberto: corregir la remision con folio interno ${folioInternoOriginal}. ` +
          'Cuando la apruebe, vuelve a abrir este boton para aplicarla.'
      )
      onCerrar()
    } catch (err) {
      console.error('[CorregirPdfModal] No se pudo pedir el permiso:', err)
      setError('No se pudo enviar la solicitud: ' + (err.message || err))
    } finally {
      setTrabajando(false)
    }
  }

  const onAplicar = async () => {
    setError('')
    // Se aplica EXACTAMENTE lo aprobado por Roberto (o lo que el propio admin
    // arme, si es el quien corrige directo).
    const propuesta = solicitudAprobada?.propuesta
    const maquilaObjetivo = propuesta
      ? maquilas.find((m) => m.id === propuesta.maquilaId)
      : activas.find((m) => m.id === maquilaId)
    const foliosObjetivo = propuesta ? propuesta.folios : foliosPropuestos

    if (!maquilaObjetivo) {
      return setError('La maquila autorizada ya no existe en el catalogo: dala de alta o pide el permiso de nuevo.')
    }
    // Pudo desactivarse entre la aprobacion y el momento de aplicar.
    if (maquilaObjetivo.activo === false) {
      return setError(
        `La maquila "${maquilaObjetivo.nombre}" se dio de baja despues de autorizarse la correccion. ` +
          'Reactivala en Maquilas o pide el permiso de nuevo con otro destino.'
      )
    }
    if (!esAdmin && !propuesta) {
      return setError('No se encontro el detalle autorizado. Pide el permiso otra vez.')
    }
    if (esAdmin && !propuesta && !motivo.trim()) {
      return setError('Escribe el motivo de la correccion (queda en la bitacora).')
    }

    const quitados = foliosOriginales.filter((f) => !foliosObjetivo.includes(f))
    const agregados = foliosObjetivo.filter((f) => !foliosOriginales.includes(f))
    const confirmacion =
      `Se va a ANULAR la remision con folio interno ${folioInternoOriginal} y emitir una NUEVA ` +
      `con folio interno nuevo, para "${maquilaObjetivo.nombre}" con ${foliosObjetivo.length} folios.\n\n` +
      (quitados.length > 0 ? `Se quitan ${quitados.length}: ${quitados.slice(0, 10).join(', ')}\n` : '') +
      (agregados.length > 0 ? `Se agregan ${agregados.length}: ${agregados.slice(0, 10).join(', ')}\n` : '') +
      '\nOJO: esto corrige los DATOS y el papel, no mueve bultos fisicos. Si el papel anterior ya ' +
      'salio de la planta, hay que avisar en piso.\n\n¿Continuar?'
    if (!window.confirm(confirmacion)) return

    setTrabajando(true)
    try {
      // El admin que corrige directo NO se salta el rastro: se crea su propia
      // solicitud ya aprobada (con la misma propuesta) y su autorizacion. Las
      // reglas exigen ambas, y asi la bitacora es igual para todos.
      let solicitudParaUsar = solicitudAprobada
      if (!solicitudParaUsar) {
        solicitudParaUsar = await autoAprobarCorreccion({
          folio: registro.id,
          tipo: 'editar_pdf',
          motivo: motivo.trim(),
          usuario,
          propuesta: {
            maquilaId: maquilaObjetivo.id,
            maquilaNombre: maquilaObjetivo.nombre,
            folios: foliosObjetivo,
            folioInternoOriginal: Number(folioInternoOriginal)
          }
        })
      }
      const r = await reemitirPdf({
        registro,
        solicitud: solicitudParaUsar,
        maquila: maquilaObjetivo,
        folios: foliosObjetivo,
        usuario
      })
      onListo(
        `Remision corregida: folio interno ${r.folioInternoNuevo} (rev. ${r.revision}) anula y sustituye ` +
          `al ${folioInternoOriginal}. ${r.marcados} folio(s) quedaron en la nueva y ${r.desmarcados} ` +
          `regresaron a Pendientes. Se descargaron el PDF y el Excel corregidos.` +
          (r.avisos.length > 0 ? ' ' + r.avisos.join(' ') : '')
      )
      onCerrar()
    } catch (err) {
      console.error('[CorregirPdfModal] Error reemitiendo:', err)
      setError(
        err instanceof ErrorReemision ? err.message : 'No se pudo corregir: ' + (err.message || err)
      )
    } finally {
      setTrabajando(false)
    }
  }

  const puedeAplicar = Boolean(autorizacion) || esAdmin
  const propuestaAprobada = solicitudAprobada?.propuesta || null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
      }}
    >
      <div className="tarjeta" style={{ width: 'min(620px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>Corregir remision (folio interno {folioInternoOriginal})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          La remision original <strong>no se borra</strong>: queda como evidencia y se marca anulada.
          Se emite una nueva con <strong>folio interno nuevo</strong> que dice a cual sustituye.
        </p>

        {cargando && <p className="texto-suave">Consultando el permiso...</p>}
        {error && <div className="alerta-error" style={{ marginBottom: 10 }}>{error}</div>}

        {!cargando && puedeAplicar && propuestaAprobada && (
          <div className="alerta-exito" style={{ marginBottom: 12 }}>
            <strong>Roberto ya autorizo esta correccion.</strong> Se aplicara exactamente lo aprobado:
            <div style={{ marginTop: 6, fontSize: 14 }}>
              Destino: <strong>{propuestaAprobada.maquilaNombre}</strong>
              <br />
              Folios ({propuestaAprobada.folios.length}):{' '}
              {propuestaAprobada.folios.slice(0, 25).join(', ')}
              {propuestaAprobada.folios.length > 25 && ` y ${propuestaAprobada.folios.length - 25} mas`}
              <br />
              Motivo: {solicitudAprobada.motivo}
            </div>
          </div>
        )}

        {!cargando && (!puedeAplicar || (esAdmin && !propuestaAprobada)) && (
          <>
            <label className="campo">
              <span>Maquila / destino correcto</span>
              <select value={maquilaId} onChange={(e) => setMaquilaId(e.target.value)}>
                <option value="">-- Elige la maquila --</option>
                {activas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ margin: '10px 0' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                Folios de la remision ({seleccion.size} de {foliosOriginales.length} seleccionados)
              </span>
              <p className="texto-suave" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                Destilda los que NO deben ir. Los que quites regresan a &quot;Pendientes de PDF&quot;.
              </p>
              <div
                style={{
                  maxHeight: 160,
                  overflowY: 'auto',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '6px 8px'
                }}
              >
                {foliosOriginales.map((f) => (
                  <label key={f} style={{ display: 'inline-block', width: '33%', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={seleccion.has(f)}
                      onChange={() =>
                        setSeleccion((prev) => {
                          const nueva = new Set(prev)
                          if (nueva.has(f)) nueva.delete(f)
                          else nueva.add(f)
                          return nueva
                        })
                      }
                    />{' '}
                    {f}
                  </label>
                ))}
              </div>
            </div>

            <label className="campo">
              <span>Agregar folios que faltaron (separados por coma o espacio)</span>
              <input
                type="text"
                placeholder="ej. 445210, 445211"
                value={foliosExtra}
                onChange={(e) => setFoliosExtra(e.target.value)}
              />
            </label>

            <label className="campo">
              <span>Por que hay que corregirla</span>
              <input
                type="text"
                placeholder="ej. se envio a la maquila equivocada"
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>

            <p className="texto-suave" style={{ fontSize: 13 }}>
              Quedaria con <strong>{foliosPropuestos.length}</strong> folio(s).
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {!cargando && puedeAplicar && (
            <button className="btn-primario" disabled={trabajando} onClick={onAplicar}>
              {trabajando ? 'Corrigiendo...' : 'Aplicar la correccion'}
            </button>
          )}
          {!cargando && !autorizacion && !esAdmin && (
            <button className="btn-primario" disabled={trabajando} onClick={onPedirPermiso}>
              {trabajando ? 'Enviando...' : 'Pedir permiso a Roberto'}
            </button>
          )}
          <button className="btn-secundario" disabled={trabajando} onClick={onCerrar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
