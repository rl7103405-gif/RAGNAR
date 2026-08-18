// BITACORA DE SUBIDAS DEL PLAN MAESTRO: qué archivo se subió, cuándo, quién y
// qué cambió con él.
//
// Es el mismo registro que ya existe para el Excel de folios que sube América
// a diario ([[HistorialCargas]]), y lo pidió Roberto con esas palabras: "debería
// aparecer como los folios, el registro de lo que has subido". El plan no es un
// archivo que se carga una vez: Adrián lo trabaja por mes y lo sube seguido, así
// que sin bitácora nadie puede contestar "¿desde cuándo aparece esta orden?" ni
// "¿qué trajo la subida del martes?".
//
// Es INMUTABLE: nadie la edita ni la borra desde la app.
import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase/config'

const ULTIMAS = 15

export default function HistorialPlanes() {
  const [versiones, setVersiones] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'planMaestroVersiones'), orderBy('creadoEn', 'desc'), limit(ULTIMAS))
    const unsub = onSnapshot(
      q,
      (snap) => setVersiones(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error('[HistorialPlanes] Error escuchando versiones:', err)
        setError('No se pudo cargar el historial de subidas: ' + (err.message || err))
      }
    )
    return unsub
  }, [])

  const fechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX')}`
      : '-'

  return (
    <div className="tarjeta">
      <h2>Ultimas subidas del plan</h2>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
        Cada vez que se sube un plan queda anotado aqui con lo que trajo. El plan es{' '}
        <strong>acumulativo</strong>: cada archivo agrega o corrige lo suyo y lo que no menciona se
        conserva, asi que subir el mes que falta no borra el que ya estaba.
      </p>
      {error && <div className="alerta-error">{error}</div>}
      {versiones.length === 0 && !error && (
        <p className="texto-suave">Todavia no se ha subido ningun plan.</p>
      )}
      {versiones.length > 0 && (
        <table className="tabla-datos">
          <thead>
            <tr>
              <th>Cuando</th>
              <th>Archivo</th>
              <th>Subio</th>
              <th>Lineas</th>
              <th>Que trajo</th>
            </tr>
          </thead>
          <tbody>
            {versiones.map((v) => {
              const r = v.resumen || null
              return (
                <tr key={v.id}>
                  <td>{fechaHora(v.creadoEn)}</td>
                  <td>{v.archivo || '-'}</td>
                  <td>{v.subidoPorNombre || '-'}</td>
                  <td>{v.totalLineas ?? '-'}</td>
                  <td>
                    {/* Una version que se quedo en 'borrador' es una subida que
                        se corto a la mitad: nunca llego a ser el plan vigente.
                        Se dice con esas palabras, igual que en las cargas de
                        folios, en vez de dejarla como si hubiera entrado. */}
                    {v.estado !== 'activa' ? (
                      <span style={{ color: '#8a5300' }}>
                        SIN TERMINAR — no llego a activarse, vuelve a subir el archivo
                      </span>
                    ) : !r ? (
                      <span className="texto-suave">
                        {v.totalPedidos ?? 0} pedidos en el diccionario
                      </span>
                    ) : (
                      <>
                        {r.totalOcsNuevas ?? 0} ordenes de compra nuevas,{' '}
                        {r.totalOcsActualizadas ?? 0} ya existentes, {r.conservadas ?? 0} lineas
                        conservadas del plan anterior
                        {r.totalMudadas > 0 && (
                          <span style={{ color: '#8a5300' }}>
                            {' '}
                            · {r.totalMudadas} ordenes de trabajo cambiaron de orden de compra
                          </span>
                        )}
                        {r.ocsNuevas?.length > 0 && (
                          <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
                            Nuevas: {r.ocsNuevas.slice(0, 10).join(' · ')}
                            {r.ocsNuevas.length > 10 && ` y ${r.ocsNuevas.length - 10} mas`}
                          </div>
                        )}
                        {r.mudadas?.length > 0 && (
                          <div style={{ fontSize: 12, marginTop: 2, color: '#8a5300' }}>
                            {r.mudadas
                              .slice(0, 5)
                              .map((m) =>
                                typeof m === 'string' ? m : `OT ${m.ot}: ${m.antes} -> ${m.ahora}`
                              )
                              .join(' · ')}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
