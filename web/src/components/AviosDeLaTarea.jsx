// LOS AVIOS QUE NECESITA UNA TAREA, CONTRA LO QUE LA MAQUILA TIENE.
//
// Roberto, 2026-09-11: "en el momento que el lider genere una tarea, avisarle
// a la maquila si tiene suficiente inventario de avios". El calculo vive en
// utils/aviosTechPack.js (funcion pura, probada aparte); aqui solo se baja
// el tech pack de la tarea, se lee en el navegador y se cruza con los saldos.
//
// Nada se escribe: es una lectura para decidir que mandar. Si el tech pack
// no sigue el estandar (sin columna USA), se dice tal cual, no se inventa.
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { descargarTechPack, ErrorTareaEnsamble } from '../utils/tareasEnsamble'
import { abrirLibro, ErrorLibreriaExcel } from '../utils/excelJs'
import { leerSaldosConUnidad } from '../utils/inventarioAvios'
import { aviosDelTechPack, hojasDeLibro, necesidadDeAvios } from '../utils/aviosTechPack'
import { aviosDesdePlantilla, esPlantilla, leerPlantilla } from '../utils/leerPlantillaTechPack'

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('es-MX'))

export default function AviosDeLaTarea({ maquilaId, maquilaNombre, tareaId, tarea, onCerrar }) {
  const [estado, setEstado] = useState('cargando')
  const [mensaje, setMensaje] = useState('Bajando el tech pack...')
  const [resultado, setResultado] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const buffer = await descargarTechPack({ maquilaId, tareaId, techPack: tarea.techPack })
        if (!vivo) return
        setMensaje('Leyendo la hoja de etiquetas...')
        const libro = await abrirLibro(buffer)
        // Plantilla TP-Quini: se lee por nombres (hoja 3 AVIOS); formato viejo: por etiquetas.
        const lectura = esPlantilla(libro) ? aviosDesdePlantilla(leerPlantilla(libro)) : aviosDelTechPack(hojasDeLibro(libro))
        if (!vivo) return
        setMensaje('Leyendo lo que tiene la maquila...')
        const claves = [...new Set(lectura.avios.map((a) => a.clave))]
        const [saldos, enCatalogo] = await Promise.all([
          claves.length ? leerSaldosConUnidad(maquilaId, claves) : {},
          Promise.all(claves.map(async (c) => [c, (await getDoc(doc(db, 'avios', c))).exists()]))
        ])
        if (!vivo) return
        const catalogo = new Set(enCatalogo.filter(([, existe]) => existe).map(([c]) => c))
        setResultado(necesidadDeAvios(lectura, tarea.renglones || [], saldos, catalogo))
        setEstado('listo')
      } catch (err) {
        console.error('[AviosDeLaTarea]', err)
        if (!vivo) return
        setEstado('error')
        setMensaje(
          err instanceof ErrorTareaEnsamble || err instanceof ErrorLibreriaExcel
            ? err.message
            : 'No se pudo calcular: ' + (err.message || err)
        )
      }
    })()
    return () => { vivo = false }
  }, [maquilaId, tareaId, tarea])

  const r = resultado
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal tp-modal-editar" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Avíos que necesita {tarea.ot ? `la OT ${tarea.ot}` : 'esta tarea'}</h3>
          <span className="texto-suave" style={{ fontSize: 13 }}>{maquilaNombre || maquilaId}</span>
          <button className="btn-secundario" style={{ marginLeft: 'auto' }} onClick={onCerrar}>Cerrar</button>
        </div>

        {estado === 'cargando' && <p className="texto-suave">{mensaje}</p>}
        {estado === 'error' && <div className="alerta-error">{mensaje}</div>}

        {estado === 'listo' && r && (
          <>
            <p className="texto-suave" style={{ margin: 0, fontSize: 13 }}>
              Sale de la columna USA (hoja 3 AVIOS, o ETIQUETAS en el formato anterior) del tech pack (cuánto lleva cada pack), multiplicada por los
              packs de la tarea{r.packs != null ? ` (${num(r.packs)} packs)` : ''}, y se compara con el inventario de
              avíos que la maquila tiene registrado hoy en RAGNAR. Es una foto de este momento: no descuenta lo que
              otras tareas abiertas de la misma maquila también van a consumir.
            </p>

            {(
              <div
                className="tarjeta"
                style={{
                  padding: '10px 14px',
                  background: r.veredicto === 'faltante' ? '#fee2e2' : r.veredicto === 'suficiente' ? '#dcfce7' : '#fef3c7',
                  border: 'none',
                  fontWeight: 700
                }}
              >
                {r.veredicto === 'faltante'
                  ? `Le faltan ${r.faltantes} ${r.faltantes === 1 ? 'avío' : 'avíos'} a la maquila para esta tarea.`
                  : r.veredicto === 'suficiente'
                    ? 'Con lo registrado hoy, a la maquila le alcanza para esta tarea.'
                    : `No se puede dar por bueno: ${r.porQueInconcluso} (ver abajo).`}
              </div>
            )}

            {r.avisos.length > 0 && (
              <ul className="texto-suave" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {r.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}

            {r.filas.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Clave</th>
                      <th>Avío</th>
                      <th>Por pack</th>
                      <th>Necesita</th>
                      <th>Tiene la maquila</th>
                      <th>Faltan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.filas.map((f) => (
                      <tr key={f.clave} style={f.alcanza === false ? { background: '#fff1f2' } : undefined}>
                        <td><strong>{f.clave}</strong></td>
                        <td>
                          {f.descripcion || <span className="texto-suave">sin descripción</span>}
                          {f.cantidadTexto && !/^\d+(\.\d+)?$/.test(f.cantidadTexto) ? (
                            <div className="texto-suave" style={{ fontSize: 11 }}>{f.cantidadTexto}</div>
                          ) : null}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {f.usaPorPack == null ? <span className="texto-suave">sin número</span> : Number(f.usaPorPack.toFixed(4))}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{num(f.necesita)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {f.comparable
                            ? `${num(f.hay)} piezas${f.hayUnidad !== 'piezas' ? ` (${num(f.hayOriginal)} ${f.hayUnidad})` : ''}`
                            : <span className="texto-suave">{f.hayOriginal ? `${num(f.hayOriginal)} ${f.hayUnidad}: ` : ''}{f.porQueNo}</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {f.faltan == null ? (
                            <span className="texto-suave">—</span>
                          ) : f.faltan === 0 ? (
                            <span style={{ color: '#166534', fontWeight: 700 }}>alcanza</span>
                          ) : (
                            <span style={{ color: '#b91c1c', fontWeight: 700 }}>{num(f.faltan)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
