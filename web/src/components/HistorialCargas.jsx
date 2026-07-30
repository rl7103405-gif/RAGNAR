// Bitacora de cargas del Excel de folios: que archivo se subio, cuando y
// quien, con el resumen de lo que trajo. Es INMUTABLE (nadie la edita ni la
// borra desde la app), igual que la bitacora de PDFs generados.
import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase/config'

const ULTIMAS = 15

export default function HistorialCargas() {
  const [cargas, setCargas] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'cargasRuteo'), orderBy('creadoEn', 'desc'), limit(ULTIMAS))
    const unsub = onSnapshot(
      q,
      (snap) => setCargas(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error('[HistorialCargas] Error escuchando cargas:', err)
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
      <h2>Ultimas subidas del Excel</h2>
      {error && <div className="alerta-error">{error}</div>}
      {cargas.length === 0 && !error && (
        <p className="texto-suave">Todavia no se ha subido ningun archivo.</p>
      )}
      {cargas.length > 0 && (
        <table className="tabla-datos">
          <thead>
            <tr>
              <th>Cuando</th>
              <th>Archivo</th>
              <th>Subio</th>
              <th>Folios</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {cargas.map((c) => (
              <tr key={c.id}>
                <td>{fechaHora(c.creadoEn)}</td>
                <td>{c.archivo || '-'}</td>
                <td>{c.subioNombre || '-'}</td>
                <td>{c.totalFolios ?? '-'}</td>
                <td>
                  {c.completa === false ? (
                    // Se anota al empezar y se cierra al terminar: si quedo
                    // asi, la carga se corto a medias (pestana cerrada, red).
                    <span style={{ color: '#8a5300' }}>
                      SIN TERMINAR — vuelve a subir el archivo
                    </span>
                  ) : (
                    <>
                      {c.nuevos ?? 0} nuevos, {c.actualizados ?? 0} actualizados,{' '}
                      {c.sinCambios ?? 0} sin cambios
                      {c.enriquecidos > 0 && `, ${c.enriquecidos} enriquecidos`}
                      {c.omitidos > 0 && `, ${c.omitidos} omitidos`}
                      {c.errores > 0 && (
                        <span style={{ color: '#a00' }}>, {c.errores} con error</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
