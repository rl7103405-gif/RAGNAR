// Tarjeta de carga del Excel diario de folios (America). Valida el archivo
// completo en el navegador y, solo si TODO es valido, hace el upsert
// acumulativo a foliosRuteo. Si la carga se corta (cierre de pestana, red),
// basta con volver a subir el mismo archivo: es idempotente.
import { compararAscendente } from '../utils/texto'
import { useRef, useState } from 'react'
import { addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { parsearFoliosRuteo, ErrorImportacion } from '../utils/importarFoliosRuteo'
import { cargarFoliosRuteo } from '../utils/cargarRuteo'
import { recruzarBultosSinRuteo } from '../utils/recruzarBultos'
import HistorialCargas from './HistorialCargas'
import {
  analizarHuecos,
  actualizarMaxFolio,
  leerMaxFolio,
  limpiarRuteoViejo,
  RETENCION_DIAS
} from '../utils/ruteoEstado'

export default function CargaRuteo() {
  const { authUser, perfil } = useAuth()
  const [estado, setEstado] = useState('inactivo') // inactivo | analizando | listo | cargando | terminado
  const [analisis, setAnalisis] = useState(null) // { esquema, archivo, registros }
  const [progreso, setProgreso] = useState(0)
  const [resumen, setResumen] = useState(null)
  // Resultado del reintento de cruce que corre despues de cargar el Excel.
  const [recruce, setRecruce] = useState(null)
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
    setRecruce(null)
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
    // La subida se anota ANTES de empezar: una carga larga que se interrumpe
    // (se cierra la pestana, se va la red) dejaba CERO rastro, y despues
    // nadie sabia si el Excel del dia se habia subido o no. Queda como
    // 'en progreso' y se completa al terminar.
    let refCarga = null
    try {
      refCarga = await addDoc(collection(db, 'cargasRuteo'), {
        archivo: analisis.archivo,
        esquema: analisis.esquema,
        totalFolios: analisis.registros.size,
        nuevos: 0,
        actualizados: 0,
        sinCambios: 0,
        enriquecidos: 0,
        omitidos: 0,
        errores: 0,
        completa: false,
        subioNombre: perfil?.nombreCompleto || 'Estacion',
        subioUid: authUser.uid,
        creadoEn: serverTimestamp()
      })
    } catch (err0) {
      console.error('[CargaRuteo] No se pudo anotar el inicio de la subida:', err0)
    }

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

      // Con el ruteo ya cargado, se reintenta el cruce de los bultos que se
      // pesaron ANTES de que su folio existiera en el Excel (America carga
      // tarde o le faltan folios): dejan de decir SIN RUTEO y recuperan su
      // codigo/docenas/pedido. Va en su propio try: si falla, la carga del
      // Excel ya quedo hecha y solo se pierde el enriquecimiento.
      setRecruce({ trabajando: true })
      try {
        const rc = await recruzarBultosSinRuteo({
          usuario: { uid: authUser.uid, nombre: perfil?.nombreCompleto || 'Estacion' }
        })
        setRecruce({ trabajando: false, ...rc })
      } catch (err) {
        console.error('[CargaRuteo] No se pudo reintentar el cruce:', err)
        setRecruce({ trabajando: false, error: err.message || String(err) })
      }
      if (r.errores.length > 0) {
        setError(
          `${r.errores.length} folios no se pudieron guardar. Vuelve a subir el mismo archivo para completarlos.`
        )
        // Ordenados por folio (llegaban en orden de terminacion de los
        // workers, o sea revueltos) para poderlos cotejar contra el Excel.
        setErroresDetalle(
          [...r.errores]
            .sort((a, b) => compararAscendente(a.folio, b.folio))
            .slice(0, 10)
            .map((x) => `Folio ${x.folio}: ${x.mensaje}`)
        )
      }

      // Se cierra el registro con el resultado real. Si esto falla, la fila
      // se queda en 'en progreso': se ve que alguien la intento y no se
      // completo, que es justo lo que antes no quedaba en ningun lado.
      if (refCarga) {
        try {
          await updateDoc(refCarga, {
            nuevos: r.nuevos,
            actualizados: r.actualizados,
            sinCambios: r.sinCambios,
            enriquecidos: r.enriquecidos,
            omitidos: r.omitidosViejos + r.omitidosSinFecha,
            errores: r.errores.length,
            completa: true
          })
        } catch (err2) {
          console.error('[CargaRuteo] No se pudo cerrar el registro de la subida:', err2)
        }
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
    <>
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
            {recruce?.trabajando && (
              <div style={{ marginTop: 8, fontWeight: 400 }}>
                Revisando los bultos que se habian pesado sin ruteo...
              </div>
            )}
            {recruce && !recruce.trabajando && !recruce.error && (
              <div style={{ marginTop: 8, fontWeight: 400 }}>
                {recruce.resueltos > 0 ? (
                  <>
                    <strong>{recruce.resueltos} bulto{recruce.resueltos === 1 ? '' : 's'} que estaba
                    {recruce.resueltos === 1 ? '' : 'n'} SIN RUTEO ya recuper{recruce.resueltos === 1 ? 'o' : 'aron'} su
                    codigo</strong> con este archivo:{' '}
                    {recruce.folios
                      .slice(0, 12)
                      .map((f) => `${f.folio}${f.codigo ? ` (${f.codigo})` : ''}`)
                      .join(', ')}
                    {recruce.folios.length > 12 && ` y ${recruce.folios.length - 12} mas`}.
                  </>
                ) : recruce.revisados > 0 ? (
                  <>Se revisaron {recruce.revisados} bulto(s) sin ruteo y ninguno aparece en este archivo.</>
                ) : (
                  <>No hay bultos pendientes de cruzar.</>
                )}
                {recruce.siguenSinRuteo > 0 && (
                  <> Siguen sin ruteo: <strong>{recruce.siguenSinRuteo}</strong> (no vienen en ningun Excel cargado).</>
                )}
                {recruce.omitidosPorPdf > 0 && (
                  <> {recruce.omitidosPorPdf} sin ruteo ya salieron en un PDF y NO se tocaron:
                  su papel ya se imprimio asi, avisale a Roberto si hay que corregirlos.</>
                )}
                {recruce.errores?.length > 0 && (
                  <div style={{ color: '#a00', marginTop: 4 }}>
                    <strong>{recruce.errores.length} bulto(s) NO se pudieron actualizar</strong> (el
                    Excel si se cargo bien): {recruce.errores[0].mensaje}. Avisale a Roberto.
                  </div>
                )}
              </div>
            )}
            {recruce?.error && (
              <div style={{ marginTop: 8, fontWeight: 400, color: '#8a5300' }}>
                El Excel se cargo bien, pero no se pudo reintentar el cruce de los bultos sin
                ruteo: {recruce.error}
              </div>
            )}
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

      <HistorialCargas />
    </>
  )
}
