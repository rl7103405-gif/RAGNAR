// Tarjeta de carga del Excel diario de folios (America). Valida el archivo
// completo en el navegador y, solo si TODO es valido, hace el upsert
// acumulativo a foliosRuteo. Si la carga se corta (cierre de pestana, red),
// basta con volver a subir el mismo archivo: es idempotente.
import { useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { parsearFoliosRuteo, ErrorImportacion } from '../utils/importarFoliosRuteo'
import { cargarFoliosRuteo } from '../utils/cargarRuteo'

export default function CargaRuteo() {
  const { authUser } = useAuth()
  const [estado, setEstado] = useState('inactivo') // inactivo | analizando | listo | cargando | terminado
  const [analisis, setAnalisis] = useState(null) // { esquema, archivo, registros }
  const [progreso, setProgreso] = useState(0)
  const [resumen, setResumen] = useState(null)
  const [error, setError] = useState('')
  const [erroresDetalle, setErroresDetalle] = useState([])
  const inputRef = useRef(null)

  const onArchivo = async (e) => {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    setError('')
    setErroresDetalle([])
    setResumen(null)
    setAnalisis(null)
    setEstado('analizando')
    try {
      const datos = await parsearFoliosRuteo(archivo)
      setAnalisis(datos)
      setEstado('listo')
    } catch (err) {
      setEstado('inactivo')
      if (err instanceof ErrorImportacion) {
        setError(err.message)
        setErroresDetalle(err.errores)
      } else {
        setError('No se pudo leer el archivo: ' + (err.message || err))
      }
    } finally {
      // Permite volver a seleccionar el mismo archivo (p.ej. tras corregirlo
      // en Excel y guardarlo otra vez).
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onCargar = async () => {
    if (!analisis) return
    setEstado('cargando')
    setError('')
    setProgreso(0)
    try {
      const r = await cargarFoliosRuteo({
        registros: analisis.registros,
        archivo: analisis.archivo,
        uid: authUser.uid,
        onProgreso: (hechos) => setProgreso(hechos)
      })
      setResumen(r)
      setEstado('terminado')
      if (r.errores.length > 0) {
        setError(
          `${r.errores.length} folios no se pudieron guardar. Vuelve a subir el mismo archivo para completarlos.`
        )
        setErroresDetalle(r.errores.slice(0, 10).map((x) => `Folio ${x.folio}: ${x.mensaje}`))
      }
    } catch (err) {
      setEstado('listo')
      setError('La carga fallo: ' + (err.message || err))
    }
  }

  const total = analisis ? analisis.registros.size : 0

  return (
    <div className="tarjeta" style={{ marginBottom: 18 }}>
      <h2>Excel de folios del dia</h2>
      <p style={{ fontSize: 14, color: '#555', marginTop: 4 }}>
        Sube el archivo de folios (formato &quot;Folios ruteo&quot; o la hoja
        &quot;DATOS PRODUCCION&quot; de la plantilla). Si el archivo tiene macros,
        primero ejecutalas en Excel y GUARDA: aqui solo se leen los valores guardados.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm"
        onChange={onArchivo}
        disabled={estado === 'analizando' || estado === 'cargando'}
      />

      {estado === 'analizando' && <p>Analizando archivo...</p>}

      {estado === 'listo' && analisis && (
        <div style={{ marginTop: 10 }}>
          <p>
            <strong>{analisis.archivo}</strong>: {total} folios validos
            (formato {analisis.esquema === 'folios_ruteo' ? 'Folios ruteo' : 'DATOS PRODUCCION'}).
          </p>
          <button className="btn-primario" onClick={onCargar}>
            Cargar {total} folios
          </button>
        </div>
      )}

      {estado === 'cargando' && (
        <p>
          Cargando... {progreso}/{total} folios. No cierres esta pestana.
        </p>
      )}

      {estado === 'terminado' && resumen && (
        <div style={{ marginTop: 10 }}>
          <p>
            <strong>Carga terminada:</strong> {resumen.nuevos} nuevos, {resumen.actualizados} actualizados,{' '}
            {resumen.sinCambios} sin cambios
            {resumen.omitidosViejos > 0 &&
              `, ${resumen.omitidosViejos} omitidos (el archivo trae datos mas viejos que los ya cargados)`}
            {resumen.omitidosSinFecha > 0 &&
              `, ${resumen.omitidosSinFecha} omitidos (sin Fecha Actualizacion; no se pisa un dato con fecha conocida)`}
            {resumen.errores.length > 0 && `, ${resumen.errores.length} con error`}.
          </p>
        </div>
      )}

      {error && <div className="alerta-error" style={{ marginTop: 10 }}>{error}</div>}
      {erroresDetalle.length > 0 && (
        <ul style={{ marginTop: 6, fontSize: 13, color: '#a00' }}>
          {erroresDetalle.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
