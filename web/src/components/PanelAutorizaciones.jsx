// Pestana Autorizaciones (solo admin: Roberto). Dos cosas:
//  1. Solicitudes de correccion de folios que YA salieron en un PDF: aprobar
//     o rechazar. Al aprobar se crea la autorizacion de un solo uso que las
//     reglas de Firestore exigen para poder editar/eliminar ese folio.
//  2. Bitacora de cambios: quien edito o elimino que captura, cuando y por que.
import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { aprobarCorreccion, rechazarCorreccion } from '../utils/auditoria'
import { useMaquilas } from './Maquilas'

const TEXTO_TIPO = {
  editar_peso: 'corregir el peso',
  eliminar: 'eliminar la captura',
  editar_pdf: 'CORREGIR UNA REMISION (anular y reemitir)',
  // El sujeto de este no es un folio: es 'ORDEN__maquila'. Lo que se autoriza
  // es que UNA orden de trabajo se reparta entre DOS maquilas, que normalmente
  // esta prohibido.
  ot_segunda_maquila: 'REPARTIR UNA ORDEN DE TRABAJO EN DOS MAQUILAS'
}

/** Lo que se ve como "sujeto" de la solicitud. Para el reparto de una orden,
 *  el folio viene como 'ORDEN__maquila' y asi crudo no se entiende. */
export function sujetoLegible(solicitud) {
  if (solicitud?.tipo !== 'ot_segunda_maquila') return solicitud?.folio
  const partes = String(solicitud.folio || '').split('__')
  if (partes.length !== 2) return solicitud.folio
  return `orden ${partes[0]} → tambien a ${partes[1]}`
}

export default function PanelAutorizaciones() {
  const { authUser, perfil, esAdmin, esPrueba } = useAuth()
  // Para separar mundos en las solicitudes de reparto de una orden: ahi el
  // sujeto no es un folio ZZTEST sino 'ORDEN__maquila', y quien dice si es de
  // prueba es la MAQUILA. useMaquilas ya devuelve solo las del mundo propio.
  const maquilas = useMaquilas()
  const [pendientes, setPendientes] = useState([])
  const [resueltas, setResueltas] = useState([])
  const [cambios, setCambios] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(null)

  useEffect(() => {
    const subs = []
    // Cada mundo ve sus propios registros. Sin esto, a Roberto le aparecen en
    // la bandeja las solicitudes de prueba con su boton de "Aprobar" (que el
    // servidor le rechaza), y a la cuenta de prueba le aparecen las
    // solicitudes REALES pendientes de America. El criterio es el prefijo del
    // folio, que es lo que llevan estos documentos (no un campo esPrueba).
    const idsMaquilas = (maquilas || []).map((m) => m.id)
    const esDeMiMundo = (d) => {
      if (d.tipo === 'ot_segunda_maquila') {
        const partes = String(d.folio || '').split('__')
        // Si la maquila del sujeto no es de mi mundo, la solicitud no es mia:
        // sin esto, a Roberto le apareceria en la bandeja una solicitud de
        // prueba con su boton de Aprobar, y el servidor se la rechazaria.
        return partes.length === 2 && idsMaquilas.includes(partes[1])
      }
      return /^ZZTEST/i.test(String(d.folio || '')) === esPrueba
    }
    const manejar = (setter, etiqueta) => [
      (snap) => setter(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(esDeMiMundo)),
      (err) => {
        console.error(`[PanelAutorizaciones] Error escuchando ${etiqueta}:`, err)
        setError(`No se pudieron cargar ${etiqueta}: ` + (err.message || err))
      }
    ]

    subs.push(
      onSnapshot(
        query(
          collection(db, 'solicitudesCorreccion'),
          where('estado', '==', 'pendiente'),
          orderBy('creadoEn', 'desc'),
          limit(50)
        ),
        ...manejar(setPendientes, 'las solicitudes pendientes')
      )
    )
    subs.push(
      onSnapshot(
        query(collection(db, 'solicitudesCorreccion'), orderBy('creadoEn', 'desc'), limit(30)),
        ...manejar(setResueltas, 'el historial de solicitudes')
      )
    )
    subs.push(
      onSnapshot(
        query(collection(db, 'cambiosCaptura'), orderBy('creadoEn', 'desc'), limit(100)),
        ...manejar(setCambios, 'la bitacora de cambios')
      )
    )
    return () => subs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esPrueba, maquilas])

  const fechaHora = (t) =>
    t?.toDate ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX')}` : '-'

  const usuario = { uid: authUser?.uid, nombre: perfil?.nombreCompleto || 'Admin' }

  const onAprobar = async (solicitud) => {
    setError('')
    setAviso('')
    setTrabajando(solicitud.id)
    try {
      await aprobarCorreccion({ solicitud, usuario })
      setAviso(
        (solicitud.tipo === 'editar_pdf'
          ? `Autorizado: ${solicitud.pedidoPorNombre} ya puede anular la remision con folio interno ` +
            `${solicitud.propuesta?.folioInternoOriginal ?? '?'} y reemitirla a "${solicitud.propuesta?.maquilaNombre ?? '?'}" ` +
            `con ${solicitud.propuesta?.folios?.length ?? 0} folios (se emitira con folio interno NUEVO). `
          : `Autorizado: ${solicitud.pedidoPorNombre} ya puede ${TEXTO_TIPO[solicitud.tipo]} — ${sujetoLegible(solicitud)}. `) +
          'El permiso es de un solo uso.'
      )
    } catch (err) {
      console.error('[PanelAutorizaciones] Error aprobando:', err)
      setError('No se pudo aprobar: ' + (err.message || err))
    } finally {
      setTrabajando(null)
    }
  }

  const onRechazar = async (solicitud) => {
    setError('')
    setAviso('')
    setTrabajando(solicitud.id)
    try {
      await rechazarCorreccion({ solicitud, usuario })
      setAviso(`Solicitud rechazada: ${sujetoLegible(solicitud)}.`)
    } catch (err) {
      console.error('[PanelAutorizaciones] Error rechazando:', err)
      setError('No se pudo rechazar: ' + (err.message || err))
    } finally {
      setTrabajando(null)
    }
  }

  const descripcionCambio = (c) => {
    if (c.accion === 'editar_peso') {
      const antes = c.antes?.pesoGramos != null ? (c.antes.pesoGramos / 1000).toFixed(2) : '?'
      const despues = c.despues?.pesoGramos != null ? (c.despues.pesoGramos / 1000).toFixed(2) : '?'
      const docenas = c.antes?.docenas != null ? ` (${c.antes.docenas} docenas)` : ''
      return `Peso: ${antes} kg → ${despues} kg${docenas}`
    }
    if (c.accion === 'eliminar') {
      const peso = c.antes?.pesoGramos != null ? (c.antes.pesoGramos / 1000).toFixed(2) : '?'
      const docenas = c.antes?.docenas != null ? `, ${c.antes.docenas} docenas` : ''
      return `Eliminada (tenia ${peso} kg${docenas}${c.antes?.codigo ? `, codigo ${c.antes.codigo}` : ''})`
    }
    if (c.accion === 'recaptura') {
      const antes = c.antes?.pesoGramos != null ? (c.antes.pesoGramos / 1000).toFixed(2) : '?'
      const despues = c.despues?.pesoGramos != null ? (c.despues.pesoGramos / 1000).toFixed(2) : '?'
      const docenas = c.antes?.docenas != null ? ` (${c.antes.docenas} docenas)` : ''
      return `Recapturada: ${antes} kg → ${despues} kg${docenas}`
    }
    return c.accion
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}

      {esAdmin && (
        <div className="tarjeta" style={{ marginBottom: 18 }}>
          <h2>Solicitudes por autorizar ({pendientes.length})</h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Correcciones de folios que YA salieron en un PDF. Al aprobar, quien la pidio puede
            aplicar ese cambio UNA vez.
          </p>
          {pendientes.length === 0 ? (
            <p className="texto-suave">Sin solicitudes pendientes.</p>
          ) : (
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Folio</th>
                  <th>Que pide</th>
                  <th>Motivo</th>
                  <th>Quien pide</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((s) => (
                  <tr key={s.id}>
                    <td>{fechaHora(s.creadoEn)}</td>
                    <td><strong>{sujetoLegible(s)}</strong></td>
                    <td>{TEXTO_TIPO[s.tipo] || s.tipo}</td>
                    <td style={{ maxWidth: 320 }}>
                      {s.motivo}
                      {/* En una remision se aprueba el CAMBIO CONCRETO, no un
                          permiso abierto: aqui se ve exactamente que se va a
                          emitir si se aprueba. */}
                      {s.tipo === 'editar_pdf' && s.propuesta && (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 12,
                            background: '#f4f7fb',
                            border: '1px solid #dbe4ef',
                            borderRadius: 6,
                            padding: '6px 8px'
                          }}
                        >
                          <div>
                            Anula el folio interno <strong>{s.propuesta.folioInternoOriginal}</strong> y
                            emite uno NUEVO.
                          </div>
                          <div>
                            Destino: <strong>{s.propuesta.maquilaNombre}</strong>
                          </div>
                          <div>
                            Quedaria con <strong>{s.propuesta.folios?.length ?? 0}</strong> folio(s):{' '}
                            {(s.propuesta.folios || []).slice(0, 15).join(', ')}
                            {(s.propuesta.folios || []).length > 15 &&
                              ` y ${s.propuesta.folios.length - 15} mas`}
                          </div>
                        </div>
                      )}
                    </td>
                    <td>{s.pedidoPorNombre}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn-primario"
                        disabled={trabajando === s.id}
                        onClick={() => onAprobar(s)}
                      >
                        Aprobar
                      </button>{' '}
                      <button
                        className="btn-secundario"
                        disabled={trabajando === s.id}
                        onClick={() => onRechazar(s)}
                      >
                        Rechazar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Bitacora de cambios ({cambios.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Todo peso corregido y toda captura eliminada queda aqui, con quien lo hizo y por que.
          Este registro no se puede editar ni borrar.
        </p>
        {cambios.length === 0 ? (
          <p className="texto-suave">Sin cambios registrados.</p>
        ) : (
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Folio</th>
                <th>Cambio</th>
                <th>Quien</th>
                <th>Motivo / permiso</th>
              </tr>
            </thead>
            <tbody>
              {cambios.map((c) => (
                <tr key={c.id}>
                  <td>{fechaHora(c.creadoEn)}</td>
                  <td>{c.folio}</td>
                  <td>{descripcionCambio(c)}</td>
                  <td>{c.hechoPorNombre}</td>
                  <td style={{ maxWidth: 280 }}>
                    {c.motivo || (c.autorizacionId ? 'con autorizacion' : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {esAdmin && (
        <div className="tarjeta">
          <h2>Historial de solicitudes</h2>
          {resueltas.length === 0 ? (
            <p className="texto-suave">Sin solicitudes registradas.</p>
          ) : (
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Folio</th>
                  <th>Que pidio</th>
                  <th>Estado</th>
                  <th>Quien pidio</th>
                  <th>Resolvio</th>
                </tr>
              </thead>
              <tbody>
                {resueltas.map((s) => (
                  <tr key={s.id}>
                    <td>{fechaHora(s.creadoEn)}</td>
                    <td>{s.folio}</td>
                    <td>{TEXTO_TIPO[s.tipo] || s.tipo}</td>
                    <td>
                      {s.estado}
                      {s.usadaEn ? ' (ya aplicada)' : ''}
                    </td>
                    <td>{s.pedidoPorNombre}</td>
                    <td>{s.resueltoPorNombre || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  )
}
