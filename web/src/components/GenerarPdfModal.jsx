// Modal de generacion del PDF de salida: quien lo genera elige la maquila
// (obligatoria, una sola) y puede capturar digitalmente los campos del
// encabezado que antes salian como N/A; lo que deje vacio queda EN BLANCO en
// el papel para llenarse a mano. Los folios ya vienen seleccionados desde la
// tabla; aqui se RELEEN de Firestore justo antes de generar para que el
// documento salga con los datos vigentes (no con una foto vieja de pantalla).
import { useEffect, useState } from 'react'
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { generarPdfSalida, descargarPdf } from '../utils/pdf'
import { generarExcelSalida, descargarArchivo } from '../utils/excelSalida'
import { leerUltimoFolioInterno, reservarFolioInterno } from '../utils/folioInterno'

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

// Cuenta compartida original: no identifica a una persona, asi que con ella
// SI hay que preguntar quien genera el PDF. Los usuarios individuales
// (america, diana, lindbergh...) se toman de su propio perfil.
const USUARIO_COMPARTIDO = 'estacion'

export default function GenerarPdfModal({ folios, operador, onCerrar, onListo, onDepurar }) {
  const { authUser, perfil } = useAuth()
  const maquilas = useMaquilas()
  const activas = maquilas.filter((m) => m.activo)
  // Con un usuario individual el nombre sale de su perfil (no se pregunta);
  // solo la cuenta compartida 'estacion' tiene que teclearlo.
  const nombreDelPerfil =
    perfil?.empleadoId && perfil.empleadoId !== USUARIO_COMPARTIDO
      ? perfil.nombreCompleto || perfil.empleadoId
      : ''
  const [maquilaId, setMaquilaId] = useState('')
  const [generadoPor, setGeneradoPor] = useState('')
  const [campos, setCampos] = useState({
    conceptoSalida: '',
    observaciones: ''
  })
  // Folio interno: consecutivo. La app propone el siguiente; solo la primera
  // vez (cuando nunca se ha generado uno) hay que teclearlo para arrancar la
  // numeracion donde va el papel.
  const [ultimoFolioInterno, setUltimoFolioInterno] = useState(null)
  const [folioInternoManual, setFolioInternoManual] = useState('')
  const [cargandoFolio, setCargandoFolio] = useState(true)

  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)
  const [progresoRelectura, setProgresoRelectura] = useState(null) // { hechos, total } | null

  useEffect(() => {
    let cancelado = false
    leerUltimoFolioInterno()
      .then((ultimo) => {
        if (cancelado) return
        setUltimoFolioInterno(ultimo)
        // El siguiente consecutivo se PRECARGA en el campo (no solo como
        // sugerencia): asi se ve de una vez cual va a llevar el papel, y
        // sigue siendo editable por si hay que corregirlo.
        if (ultimo !== null) setFolioInternoManual(String(ultimo + 1))
      })
      .catch((err) => console.error('[GenerarPdfModal] No se pudo leer el folio interno:', err))
      .finally(() => {
        if (!cancelado) setCargandoFolio(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  const setCampo = (k) => (e) => setCampos({ ...campos, [k]: e.target.value })

  const onGenerar = async () => {
    setError('')
    const maquila = activas.find((m) => m.id === maquilaId)
    if (!maquila) {
      setError('Elige la maquila a la que va dirigida la salida.')
      return
    }
    // La direccion ya no se captura aqui: sale de la maquila. Si esa maquila
    // no la tiene registrada, el papel saldria con el renglon en blanco y
    // nadie se enteraria hasta que el bulto se fuera sin destino.
    if (!maquila.direccion) {
      setError(
        `La maquila "${maquila.nombre}" no tiene direccion registrada. ` +
          'Agregasela en Maquilas (menu de arriba) antes de generar el PDF.'
      )
      return
    }
    const nombreGenerador = limpiarCampo(nombreDelPerfil || generadoPor, 80)
    if (!nombreGenerador) {
      setError('Escribe el nombre de quien genera el PDF.')
      return
    }
    // Folio interno: si nunca se ha generado uno, hay que teclear el de
    // arranque; si ya hay historia, la app propone el siguiente y solo se
    // acepta un valor manual valido.
    let folioInternoForzado = null
    const manualLimpio = folioInternoManual.trim()
    if (manualLimpio) {
      if (!/^\d{1,9}$/.test(manualLimpio)) {
        setError('El folio interno debe ser un numero (sin letras ni simbolos).')
        return
      }
      folioInternoForzado = Number(manualLimpio)
      // Sin esto, teclear un numero ya usado imprimiria DOS papeles con el
      // mismo folio interno (el contador no retrocede, pero el PDF si sale
      // con el numero repetido): justo lo que el consecutivo debe evitar.
      if (ultimoFolioInterno !== null && folioInternoForzado <= ultimoFolioInterno) {
        setError(
          `El folio interno ${folioInternoForzado} ya se uso (el ultimo fue ${ultimoFolioInterno}). ` +
            `Usa ${ultimoFolioInterno + 1} o uno mayor para no repetir folio en dos papeles.`
        )
        return
      }
    } else if (ultimoFolioInterno === null) {
      setError(
        'Es el primer PDF: escribe el folio interno con el que arranca la numeracion. ' +
          'De ahi en adelante la app lo va poniendo sola.'
      )
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
      // NOMBRE del PDF impreso = quien lo genera (el perfil del login
      // compartido no identifica a la persona real).
      // fechaTexto se calcula UNA sola vez y se usa tanto en el PDF como en
      // la bitacora: asi "Reimprimir original" (Historial.jsx) siempre
      // reproduce la misma fecha impresa en el papel original, sin depender
      // de creadoEn (que es la hora del registro en Firestore, no
      // necesariamente igual al texto que ya salio impreso).
      const fechaTexto = new Date().toLocaleDateString('es-MX')
      // Se reserva DENTRO de una transaccion: dos personas generando a la vez
      // no pueden quedarse con el mismo consecutivo.
      const folioInternoAsignado = await reservarFolioInterno(folioInternoForzado)
      const encabezado = {
        folioInterno: String(folioInternoAsignado),
        // La orden de trabajo NO va aqui: el PDF separa una hoja por orden y
        // cada hoja imprime la suya (ver agruparPorOrden en pdf.js). La
        // fecha de solicitud es siempre el dia en que se genera.
        fechaSolicitud: fechaTexto,
        // 55 chars caben en una linea del maxWidth 300 del PDF; un nombre de
        // maquila mas largo envolveria y se encimaria con la linea de abajo.
        areaRecibe: limpiarCampo(maquila.nombre, 55),
        // La direccion sale DIRECTO de la maquila elegida (se registra al
        // darla de alta): ya no se muestra ni se captura aqui.
        direccionEnvio: limpiarCampo(maquila.direccion || '', MAX_POR_CAMPO.direccionEnvio),
        conceptoSalida: limpiarCampo(campos.conceptoSalida, MAX_POR_CAMPO.conceptoSalida),
        observaciones: limpiarCampo(campos.observaciones, MAX_POR_CAMPO.observaciones)
      }
      let blob
      let nombreArchivo
      try {
        ;({ blob, nombreArchivo } = generarPdfSalida({
          capturas: frescos,
          operador: nombreGenerador,
          fecha: fechaTexto,
          encabezado
        }))
      } catch (err) {
        // El consecutivo ya se consumio: hay que decirlo para que quede
        // anotado como salto en la numeracion del papel.
        console.error('[GenerarPdfModal] Error armando el PDF:', err)
        setError(
          `El folio interno ${folioInternoAsignado} quedo reservado y NO se usara: anotalo como ` +
            `salto en la numeracion. No se pudieron armar los archivos: ${err.message || err}`
        )
        return
      }

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

      // El Excel de migracion va en su PROPIO try: si su modulo no carga
      // (p.ej. una pestana vieja pidiendo un chunk que ya cambio de nombre
      // tras un deploy), NO se tira un PDF que ya salio bien ni se quema el
      // folio interno -- el Excel se puede rehacer luego desde el historial.
      let notaExcel = ''
      try {
        const excel = await generarExcelSalida({ capturas: frescos, fecha: fechaTexto })
        descargarArchivo(excel.blob, excel.nombreArchivo)
      } catch (err) {
        console.error('[GenerarPdfModal] No se pudo generar el Excel de migracion:', err)
        notaExcel =
          ' AVISO: el Excel de migracion NO se genero; sacalo con "Reimprimir original" en Historial.'
      }

      onListo(
        `PDF y Excel de migracion generados con ${frescos.length} folios para "${maquila.nombre}" ` +
          `(folio interno ${folioInternoAsignado}, genero: ${nombreGenerador}).${notaBitacora}${notaExcel}`
      )
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

        {nombreDelPerfil ? (
          <p style={{ marginTop: 0 }}>
            Genera: <strong>{nombreDelPerfil}</strong>
          </p>
        ) : (
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
        )}

        <label className="campo">
          <span>Maquila (obligatoria)</span>
          <select value={maquilaId} onChange={(e) => setMaquilaId(e.target.value)}>
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

        <label className="campo">
          <span>
            Folio Interno{' '}
            {cargandoFolio
              ? '(consultando...)'
              : ultimoFolioInterno === null
                ? '(primer PDF: escribe con cual arranca la numeracion)'
                : '(consecutivo, se puede cambiar)'}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={folioInternoManual}
            maxLength={9}
            placeholder={ultimoFolioInterno === null ? 'Ej. 1001' : ''}
            onChange={(e) => setFolioInternoManual(e.target.value)}
          />
        </label>
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
