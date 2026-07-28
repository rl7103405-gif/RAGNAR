// Tarjeta de carga del Excel diario de folios (America). Valida el archivo
// completo en el navegador y, solo si TODO es valido, hace el upsert
// acumulativo a foliosRuteo. Si la carga se corta (cierre de pestana, red),
// basta con volver a subir el mismo archivo: es idempotente.
import { useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { parsearFoliosRuteo, ErrorImportacion } from '../utils/importarFoliosRuteo'
import { cargarFoliosRuteo } from '../utils/cargarRuteo'
import {
  analizarHuecos,
  actualizarMaxFolio,
  leerMaxFolio,
  limpiarRuteoViejo,
  RETENCION_DIAS
} from '../utils/ruteoEstado'

export default function CargaRuteo() {
  const { authUser } = useAuth()
  const [estado, setEstado] = useState('inactivo') // inactivo | analizando | listo | cargando | terminado
  const [analisis, setAnalisis] = useState(null) // { esquema, archivo, registros }
  const [progreso, setProgreso] = useState(0)
  const [resumen, setResumen] = useState(null)
  const [error, setError] = useState('')
  const [erroresDetalle, setErroresDetalle] = useState([])
  const [huecos, setHuecos] = useState(null)
  const [limpieza, setLimpieza] = useState(null)
  const inputRef = useRef(null)

  const onArchivo = async (e) => {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    setError('')
    setErroresDetalle([])
    setResumen(null)
    setAnalisis(null)
    setHuecos(null)
    setLimpieza(null)
    setEstado('analizando')
    try {
      const datos = await parsearFoliosRuteo(archivo)
      // Aviso (sin bloquear) de folios faltantes en la secuencia: los folios
      // son consecutivos globales; se revisa solo el rango nuevo respecto al
      // maximo ya cargado en dias/archivos anteriores.
      try {
        const maxAnterior = await leerMaxFolio()
        setHuecos(analizarHuecos(datos.foliosPresentes, maxAnterior))
      } catch (err2) {
        console.error('[CargaRuteo] No se pudo analizar huecos:', err2)
      }
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
      // Folios que el archivo TRAE pero no son cargables (p.ej. docenas 0
      // del reporte Seguimiento): no tienen entrada en registros, pero si ya
      // existen en foliosRuteo su cargadoEn debe refrescarse igual (siguen
      // "vivos" en el Excel de hoy, la retencion de 15 dias no debe olvidarlos).
      const foliosSoloVistos = new Set(
        [...analisis.foliosPresentes].filter((f) => !analisis.registros.has(f))
      )
      const r = await cargarFoliosRuteo({
        registros: analisis.registros,
        archivo: analisis.archivo,
        uid: authUser.uid,
        foliosSoloVistos,
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
      // Registrar el maximo folio visto (monotono) y correr la purga de
      // retencion (folios no vistos en ningun Excel por 15 dias) SOLO si la
      // carga quedo completa: con errores, el maximo no debe avanzar (el
      // mensaje de arriba ya le pide volver a subir el archivo).
      if (r.errores.length === 0) {
        try {
          await actualizarMaxFolio(huecos?.maxArchivo ?? null)
          const borrados = await limpiarRuteoViejo()
          if (borrados > 0) setLimpieza(borrados)
        } catch (err2) {
          console.error('[CargaRuteo] Mantenimiento post-carga fallo:', err2)
        }
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
        Sube el archivo de folios en el turno 1 (America). Acepta .xlsx, .xls, .xlsm y .ods
        (formatos &quot;Folios ruteo&quot;, hoja &quot;DATOS PRODUCCION&quot; o reporte
        &quot;Seguimiento de Folios&quot;). Se pueden subir varios Excel al dia: cada carga
        suma y actualiza, no borra lo anterior. Los folios que dejen de aparecer en los
        Excel por mas de {RETENCION_DIAS} dias se desechan solos. Si el archivo tiene
        macros, primero ejecutalas en Excel y GUARDA: aqui solo se leen los valores guardados.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.ods"
        onChange={onArchivo}
        disabled={estado === 'analizando' || estado === 'cargando'}
      />

      {estado === 'analizando' && <p>Analizando archivo...</p>}

      {estado === 'listo' && analisis && (
        <div style={{ marginTop: 10 }}>
          <p>
            <strong>{analisis.archivo}</strong>: {total} folios validos
            (formato {
              { folios_ruteo: 'Folios ruteo', datos_produccion: 'DATOS PRODUCCION', seguimiento_folios: 'Seguimiento de Folios' }[analisis.esquema] || analisis.esquema
            })
            {analisis.omitidasSinDocenas > 0 &&
              ` — ${analisis.omitidasSinDocenas} filas sin docenas surtidas se omitieron`}.
          </p>
          {total > 0 ? (
            <button className="btn-primario" onClick={onCargar}>
              Cargar {total} folios
            </button>
          ) : (
            <p style={{ color: '#8a5300' }}>
              El archivo solo trae folios sin docenas surtidas: no hay nada que cargar (el aviso
              de folios faltantes de arriba sigue valiendo).
            </p>
          )}
        </div>
      )}

      {(estado === 'listo' || estado === 'terminado') && huecos && (huecos.totalFaltantes > 0 || huecos.saltoAnormal) && (
        <div className="alerta-error" style={{ marginTop: 10, background: '#fff4e0', color: '#8a5300' }}>
          {huecos.saltoAnormal ? (
            <>
              OJO: hay un salto anormal en la numeracion (del folio {huecos.saltoAnormal.desde} al{' '}
              {huecos.saltoAnormal.hasta}). Verifica que sea el archivo correcto. La carga SI se permite.
            </>
          ) : (
            <>
              OJO: faltan {huecos.totalFaltantes} folios en la secuencia:{' '}
              {huecos.faltantes.join(', ')}
              {huecos.totalFaltantes > huecos.faltantes.length && ' ...(y mas)'}. La carga SI se
              permite; avisale a quien genera los folios.
            </>
          )}
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
            {resumen.enriquecidos > 0 && `, ${resumen.enriquecidos} enriquecidos`}
            {resumen.omitidosViejos > 0 &&
              `, ${resumen.omitidosViejos} omitidos (el archivo trae datos mas viejos que los ya cargados)`}
            {resumen.omitidosSinFecha > 0 &&
              `, ${resumen.omitidosSinFecha} omitidos (sin Fecha Actualizacion; no se pisa un dato con fecha conocida)`}
            {resumen.errores.length > 0 && `, ${resumen.errores.length} con error`}.
          </p>
          {limpieza > 0 && (
            <p style={{ fontSize: 13, color: '#555' }}>
              Mantenimiento: se desecharon {limpieza} folios con mas de {RETENCION_DIAS} dias sin
              aparecer en ningun Excel.
            </p>
          )}
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
