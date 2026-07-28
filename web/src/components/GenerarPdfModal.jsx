// Modal de generacion del PDF de salida: quien lo genera elige la maquila
// (obligatoria, una sola) y puede capturar digitalmente los campos del
// encabezado que antes salian como N/A; lo que deje vacio queda EN BLANCO en
// el papel para llenarse a mano. Los folios ya vienen seleccionados desde la
// tabla; aqui se RELEEN de Firestore justo antes de generar para que el
// documento salga con los datos vigentes (no con una foto vieja de pantalla).
import { useState } from 'react'
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { generarPdfSalida, descargarPdf } from '../utils/pdf'

const MAX_FOLIOS_PDF = 200
// Maximos por campo (antes un unico MAX_CAMPO=120 para todos): con textos
// largos en varios campos a la vez se encimaban en el PDF (ver pdf.js, cajas
// de ancho fijo). Estos topes garantizan UNA sola linea con los maxWidth
// reales que usa pdf.js: la caja de folio/fechas (derecha) mide maxWidth 100
// a fuente 9; direccion/concepto miden maxWidth 110 a fuente 10;
// observaciones mide maxWidth 310 a fuente 9. Medido con jsPDF: mas
// caracteres que esto envuelve a 2-3 lineas y se encima con el texto de abajo.
// direccionEnvio ocupa ahora una LINEA COMPLETA del encabezado (~500pt a
// fuente 10): las direcciones reales de las maquilas no caben en la media
// columna original.
const MAX_POR_CAMPO = {
  folioInterno: 18,
  ordenTrabajo: 18,
  fechaSolicitud: 18,
  fechaEntrega: 18,
  direccionEnvio: 95,
  conceptoSalida: 20,
  observaciones: 60
}

function limpiarCampo(texto, maximo) {
  let limpio = ''
  for (const ch of String(texto || '')) {
    const cp = ch.codePointAt(0)
    limpio += cp < 32 || cp === 127 ? ' ' : ch
  }
  return limpio.replace(/\s+/g, ' ').trim().slice(0, maximo)
}

const LOTE_RELECTURA = 10

export default function GenerarPdfModal({ folios, operador, onCerrar, onListo, onDepurar }) {
  const { authUser } = useAuth()
  const maquilas = useMaquilas()
  const activas = maquilas.filter((m) => m.activo)
  const [maquilaId, setMaquilaId] = useState('')
  const [generadoPor, setGeneradoPor] = useState('')
  const [campos, setCampos] = useState({
    folioInterno: '',
    ordenTrabajo: '',
    fechaSolicitud: '',
    fechaEntrega: '',
    direccionEnvio: '',
    conceptoSalida: '',
    observaciones: ''
  })
  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)
  const [progresoRelectura, setProgresoRelectura] = useState(null) // { hechos, total } | null

  const setCampo = (k) => (e) => setCampos({ ...campos, [k]: e.target.value })

  const onGenerar = async () => {
    setError('')
    const maquila = activas.find((m) => m.id === maquilaId)
    if (!maquila) {
      setError('Elige la maquila a la que va dirigida la salida.')
      return
    }
    const nombreGenerador = limpiarCampo(generadoPor, 80)
    if (!nombreGenerador) {
      setError('Escribe el nombre de quien genera el PDF.')
      return
    }
    if (folios.length === 0) {
      setError('No hay folios seleccionados.')
      return
    }
    if (folios.length > MAX_FOLIOS_PDF) {
      setError(`Maximo ${MAX_FOLIOS_PDF} folios por PDF (seleccionaste ${folios.length}).`)
      return
    }
    setGenerando(true)
    setProgresoRelectura({ hechos: 0, total: folios.length })
    try {
      // Releer cada folio: asi una edicion/eliminacion de ultimo segundo no
      // deja el PDF con datos viejos, y los folios tecleados de otros dias
      // tambien salen con su snapshot real. En lotes de LOTE_RELECTURA en
      // paralelo (no uno por uno) para que no tarde una eternidad con
      // muchos folios seleccionados.
      const frescos = []
      const inexistentes = []
      for (let i = 0; i < folios.length; i += LOTE_RELECTURA) {
        const lote = folios.slice(i, i + LOTE_RELECTURA)
        const resultados = await Promise.all(
          lote.map(async (folio) => ({ folio, snap: await getDoc(doc(db, 'bultos', folio)) }))
        )
        for (const { folio, snap } of resultados) {
          if (!snap.exists()) {
            inexistentes.push(folio)
          } else {
            const c = snap.data()
            frescos.push({
              folio: c.folio,
              pesoGramos: c.pesoGramos,
              producto: c.producto || null,
              cruce: c.cruce || null
            })
          }
        }
        setProgresoRelectura({ hechos: Math.min(i + LOTE_RELECTURA, folios.length), total: folios.length })
      }
      if (inexistentes.length > 0) {
        // El padre (Estacion.jsx) los quita de la seleccion/agregadas para
        // que el operador pueda reintentar sin recargar la pagina.
        if (onDepurar) onDepurar(inexistentes)
        setError(
          `Estos folios ya no existen (¿eliminados?): ${inexistentes.join(', ')}; ` +
            'ya se quitaron de la seleccion; vuelve a intentar.'
        )
        return
      }
      const encabezado = {
        folioInterno: limpiarCampo(campos.folioInterno, MAX_POR_CAMPO.folioInterno),
        ordenTrabajo: limpiarCampo(campos.ordenTrabajo, MAX_POR_CAMPO.ordenTrabajo),
        fechaSolicitud: limpiarCampo(campos.fechaSolicitud, MAX_POR_CAMPO.fechaSolicitud),
        fechaEntrega: limpiarCampo(campos.fechaEntrega, MAX_POR_CAMPO.fechaEntrega),
        // 55 chars caben en una linea del maxWidth 300 del PDF; un nombre de
        // maquila mas largo envolveria y se encimaria con la linea de abajo.
        areaRecibe: limpiarCampo(maquila.nombre, 55),
        direccionEnvio: limpiarCampo(campos.direccionEnvio, MAX_POR_CAMPO.direccionEnvio),
        conceptoSalida: limpiarCampo(campos.conceptoSalida, MAX_POR_CAMPO.conceptoSalida),
        observaciones: limpiarCampo(campos.observaciones, MAX_POR_CAMPO.observaciones)
      }
      // NOMBRE del PDF impreso = quien lo genera (el perfil del login
      // compartido no identifica a la persona real).
      // fechaTexto se calcula UNA sola vez y se usa tanto en el PDF como en
      // la bitacora: asi "Reimprimir original" (Historial.jsx) siempre
      // reproduce la misma fecha impresa en el papel original, sin depender
      // de creadoEn (que es la hora del registro en Firestore, no
      // necesariamente igual al texto que ya salio impreso).
      const fechaTexto = new Date().toLocaleDateString('es-MX')
      const { blob, nombreArchivo } = generarPdfSalida({
        capturas: frescos,
        operador: nombreGenerador,
        fecha: fechaTexto,
        encabezado
      })

      // Primero la bitacora, despues la descarga: un PDF descargado siempre
      // deja rastro en el historial. El contenido se CONGELA completo
      // (folio+peso+producto) para que "Reimprimir original" reproduzca
      // exactamente el papel emitido aunque las capturas cambien despues.
      let notaBitacora = ''
      try {
        await addDoc(collection(db, 'pdfsGenerados'), {
          generadoPor: nombreGenerador,
          maquila: { id: maquila.id, nombre: maquila.nombre },
          folios: frescos.map((c) => c.folio),
          totalFolios: frescos.length,
          pesoTotalGramos: frescos.reduce((acc, c) => acc + (c.pesoGramos || 0), 0),
          capturas: frescos,
          encabezado,
          fechaTexto,
          creadoEn: serverTimestamp(),
          operadorUid: authUser.uid
        })
      } catch (err) {
        console.error('[GenerarPdfModal] No se pudo registrar en el historial:', err)
        notaBitacora = ' AVISO: no se pudo registrar en el historial (¿sin conexion?); el PDF se descargo igual.'
      }
      descargarPdf(blob, nombreArchivo)
      onListo(`PDF generado con ${frescos.length} folios para "${maquila.nombre}" (genero: ${nombreGenerador}).${notaBitacora}`)
    } catch (err) {
      console.error('[GenerarPdfModal] Error generando PDF:', err)
      setError('No se pudo generar el PDF: ' + (err.message || err))
    } finally {
      setGenerando(false)
      setProgresoRelectura(null)
    }
  }

  const campoTexto = (etiqueta, clave, placeholder = '') => (
    <label className="campo" key={clave}>
      <span>{etiqueta}</span>
      <input
        type="text"
        value={campos[clave]}
        maxLength={MAX_POR_CAMPO[clave]}
        placeholder={placeholder || 'Vacio = queda en blanco para llenar a mano'}
        onChange={setCampo(clave)}
      />
    </label>
  )

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
      }}
    >
      <div className="tarjeta" style={{ width: 'min(540px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>Generar PDF de salida ({folios.length} folios)</h2>

        <label className="campo">
          <span>Nombre de quien genera (obligatorio)</span>
          <input
            type="text"
            value={generadoPor}
            maxLength={80}
            placeholder="Ej. America"
            onChange={(e) => setGeneradoPor(e.target.value)}
          />
        </label>

        <label className="campo">
          <span>Maquila (obligatoria)</span>
          <select
            value={maquilaId}
            onChange={(e) => {
              const idNuevo = e.target.value
              setMaquilaId(idNuevo)
              // La direccion registrada de la maquila se precarga como
              // 'Direccion Envio' (editable antes de generar).
              // Se sincroniza SIEMPRE (aunque quede vacia): si la maquila
              // elegida no tiene direccion registrada, heredar la de la
              // seleccion anterior mandaria el papel a la direccion
              // equivocada.
              const elegida = activas.find((m) => m.id === idNuevo)
              setCampos((prev) => ({
                ...prev,
                direccionEnvio: elegida?.direccion
                  ? limpiarCampo(elegida.direccion, MAX_POR_CAMPO.direccionEnvio)
                  : ''
              }))
            }}
          >
            <option value="">-- Elige la maquila --</option>
            {activas.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </label>
        {activas.length === 0 && (
          <p style={{ fontSize: 13, color: '#a00' }}>
            No hay maquilas dadas de alta: usa la tarjeta &quot;Maquilas&quot; primero.
          </p>
        )}

        {campoTexto('Folio Interno', 'folioInterno')}
        {campoTexto('Orden de Trabajo', 'ordenTrabajo')}
        {campoTexto('Fecha Solicitud', 'fechaSolicitud')}
        {campoTexto('Fecha Entrega', 'fechaEntrega')}
        {campoTexto('Direccion Envio', 'direccionEnvio')}
        {campoTexto('Concepto Salida', 'conceptoSalida')}
        {campoTexto('Observaciones', 'observaciones')}

        {error && <div className="alerta-error">{error}</div>}
        {progresoRelectura && (
          <p style={{ fontSize: 13, color: '#555' }}>
            Releyendo folios {progresoRelectura.hechos}/{progresoRelectura.total}...
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-primario" onClick={onGenerar} disabled={generando}>
            {generando ? 'Generando...' : 'Generar PDF'}
          </button>
          <button className="btn-secundario" onClick={onCerrar} disabled={generando}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
