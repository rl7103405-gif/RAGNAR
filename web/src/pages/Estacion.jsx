// Pantalla unica de la estacion de prueba: captura folio + peso, guarda en
// Firestore, imprime etiqueta (via bridge local de Zebra) y genera el PDF de
// salida del dia -- reemplaza el paso manual de pasarselo a otra persona para
// que arme el Excel.
import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { normalizarFolio, canonizarFolio, validarPesoGramos } from '../utils/validacion'
import { imprimirEtiqueta } from '../utils/zebraBridge'
import { generarPdfSalida } from '../utils/pdf'

function inicioDeHoy() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Fecha local (no UTC) en formato AAAA-MM-DD, para detectar cuando cambia el
// dia sin depender de toISOString (que usa UTC y desfasaria la comparacion).
function fechaLocalTexto(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

export default function Estacion() {
  const { authUser, perfil, cerrarSesion } = useAuth()
  const [folio, setFolio] = useState('')
  const [pesoKg, setPesoKg] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [capturas, setCapturas] = useState([])
  const [datosConfirmados, setDatosConfirmados] = useState(true)
  const [imprimiendoFolio, setImprimiendoFolio] = useState(null)

  useEffect(() => {
    let cancelado = false
    let unsub = null
    let fechaSuscrita = null

    function suscribir() {
      if (unsub) unsub()
      const inicio = inicioDeHoy()
      fechaSuscrita = fechaLocalTexto(inicio)
      const q = query(
        collection(db, 'bultos'),
        where('creadoEn', '>=', Timestamp.fromDate(inicio)),
        orderBy('creadoEn', 'desc')
      )
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelado) return
          setCapturas(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          setDatosConfirmados(!snap.metadata.fromCache)
        },
        (err) => {
          if (cancelado) return
          console.error('[Estacion] Error escuchando capturas de hoy:', err)
          setError('No se pudieron cargar las capturas de hoy: ' + (err.message || err.code || err))
        }
      )
    }

    suscribir()
    // La pestana puede quedar abierta de un dia a otro: cada minuto se
    // revisa si cambio la fecha local y, si cambio, se vuelve a suscribir
    // con el nuevo limite de "hoy" (si no, "capturas de hoy" y el PDF
    // mezclarian datos de dos dias distintos).
    const intervalo = setInterval(() => {
      if (fechaLocalTexto(inicioDeHoy()) !== fechaSuscrita) {
        suscribir()
      }
    }, 60000)

    return () => {
      cancelado = true
      clearInterval(intervalo)
      if (unsub) unsub()
    }
  }, [])

  const totalKg = useMemo(
    () => capturas.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000,
    [capturas]
  )

  const onGuardar = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    setGuardando(true)
    try {
      const folioNormalizado = canonizarFolio(normalizarFolio(folio))
      const pesoGramos = validarPesoGramos(Number(pesoKg) * 1000)
      const ref = doc(db, 'bultos', folioNormalizado)

      // 1) Lectura (en transaccion, para leer un snapshot consistente) que
      // solo sirve para decidir si hay que pedir confirmacion de
      // sobrescritura -- no escribe nada todavia.
      const infoInicial = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        return snap.exists() ? { existe: true, pesoGramos: snap.data().pesoGramos } : { existe: false }
      })

      // 2) El dialogo de confirmacion queda FUERA de cualquier transaccion
      // (no se puede abrir un dialogo bloqueante dentro de una transaccion
      // de Firestore, que ademas puede reintentarse sola).
      if (infoInicial.existe) {
        const confirmar = window.confirm(
          `El folio ${folioNormalizado} ya fue capturado con ${(infoInicial.pesoGramos / 1000).toFixed(2)} kg. ` +
            '¿Sobrescribirlo con el nuevo peso?'
        )
        if (!confirmar) {
          setGuardando(false)
          return
        }
      }

      // 3) Segunda transaccion: vuelve a leer y solo escribe si la
      // situacion sigue siendo la misma que se le mostro al operador en el
      // paso 2 (mismo peso si ya existia, o que siga sin existir si era
      // nuevo). Si algo cambio mientras se mostraba el confirm(), aborta en
      // vez de pisar a ciegas.
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (infoInicial.existe) {
          if (!snap.exists()) {
            throw new Error(
              `El folio ${folioNormalizado} ya no existe (alguien lo elimino mientras confirmabas). Vuelve a intentarlo.`
            )
          }
          if (snap.data().pesoGramos !== infoInicial.pesoGramos) {
            throw new Error(
              `El peso de ${folioNormalizado} cambio a ${(snap.data().pesoGramos / 1000).toFixed(2)} kg mientras confirmabas la sobrescritura. Revisa el valor actual y vuelve a intentarlo.`
            )
          }
          tx.set(ref, {
            folio: folioNormalizado,
            pesoGramos,
            operadorUid: authUser.uid,
            operadorNombre: perfil?.nombreCompleto || 'Estacion',
            // creadoEn se preserva: representa cuando se capturo por
            // primera vez, no la ultima edicion.
            creadoEn: snap.data().creadoEn
          })
        } else {
          if (snap.exists()) {
            throw new Error(
              `El folio ${folioNormalizado} ya fue capturado por otra estacion mientras confirmabas (${(snap.data().pesoGramos / 1000).toFixed(2)} kg). Verifica antes de continuar.`
            )
          }
          tx.set(ref, {
            folio: folioNormalizado,
            pesoGramos,
            operadorUid: authUser.uid,
            operadorNombre: perfil?.nombreCompleto || 'Estacion',
            creadoEn: serverTimestamp()
          })
        }
      })

      setFolio('')
      setPesoKg('')

      // El folio ya quedo guardado, que es lo importante. Si falla la
      // impresion no se deshace el guardado: se avisa distinto y el
      // operador puede reintentar con el boton "Imprimir etiqueta" de la
      // tabla.
      const fecha = new Date().toLocaleDateString('es-MX')
      const resultadoImpresion = await imprimirEtiqueta({ folio: folioNormalizado, pesoGramos, fecha })
      if (resultadoImpresion.enviado) {
        setAviso(`Folio ${folioNormalizado} guardado (${(pesoGramos / 1000).toFixed(2)} kg) y etiqueta enviada a la impresora.`)
      } else {
        setError(
          `Folio ${folioNormalizado} guardado, pero no se pudo imprimir la etiqueta: ${resultadoImpresion.mensaje}. ` +
            'Usa "Imprimir etiqueta" en la tabla para reintentar.'
        )
      }
    } catch (err) {
      setError(err.message || 'No se pudo guardar el folio.')
    } finally {
      setGuardando(false)
    }
  }

  const onImprimir = async (captura) => {
    setError('')
    setAviso('')
    setImprimiendoFolio(captura.folio)
    try {
      const fecha = new Date().toLocaleDateString('es-MX')
      const resultado = await imprimirEtiqueta({
        folio: captura.folio,
        pesoGramos: captura.pesoGramos,
        fecha
      })
      if (resultado.enviado) {
        setAviso(`Etiqueta de ${captura.folio} enviada a la impresora.`)
      } else {
        setError(`No se imprimio la etiqueta de ${captura.folio}: ${resultado.mensaje}`)
      }
    } finally {
      setImprimiendoFolio(null)
    }
  }

  const onGenerarPdf = () => {
    if (capturas.length === 0) {
      setError('No hay folios capturados hoy todavia.')
      return
    }
    try {
      generarPdfSalida({
        capturas: capturas.map((c) => ({
          folio: c.folio,
          pesoGramos: c.pesoGramos,
          horaTexto: c.creadoEn?.toDate
            ? c.creadoEn.toDate().toLocaleTimeString('es-MX')
            : '-'
        })),
        operador: perfil?.nombreCompleto || 'Estacion',
        fecha: new Date().toLocaleDateString('es-MX')
      })
    } catch (err) {
      console.error('[Estacion] Error generando PDF:', err)
      setError('No se pudo generar el PDF: ' + (err.message || err))
    }
  }

  return (
    <div className="layout">
      <div className="barra-superior">
        <div className="barra-titulo">RAGNAR - Estacion de captura</div>
        <div className="barra-usuario">
          <span className="usuario-nombre">{perfil?.nombreCompleto || 'Estacion'}</span>
          <button className="btn-salir" onClick={cerrarSesion}>Salir</button>
        </div>
      </div>

      <div className="contenido">
        <form className="tarjeta" onSubmit={onGuardar} style={{ marginBottom: 18 }}>
          <h2>Capturar folio</h2>
          <label className="campo">
            <span>Folio</span>
            <input
              type="text"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="campo">
            <span>Peso (kg)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={pesoKg}
              onChange={(e) => setPesoKg(e.target.value)}
              required
            />
          </label>

          {error && <div className="alerta-error">{error}</div>}
          {aviso && <div className="alerta-exito">{aviso}</div>}

          <button className="btn-primario btn-grande" type="submit" disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar y generar etiqueta'}
          </button>
        </form>

        <div className="tarjeta">
          <h2>Capturas de hoy ({capturas.length}) - {totalKg.toFixed(2)} kg</h2>
          {!datosConfirmados && (
            <div className="alerta-error" style={{ marginBottom: 12 }}>
              Datos no confirmados, verifica tu conexion.
            </div>
          )}
          <button
            className="btn-secundario"
            onClick={onGenerarPdf}
            disabled={!datosConfirmados}
            style={{ marginBottom: 12 }}
          >
            Generar PDF de salida
          </button>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Folio</th>
                <th style={{ textAlign: 'left' }}>Peso (kg)</th>
                <th style={{ textAlign: 'left' }}>Hora</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {capturas.map((c) => (
                <tr key={c.id}>
                  <td>{c.folio}</td>
                  <td>{(c.pesoGramos / 1000).toFixed(2)}</td>
                  <td>{c.creadoEn?.toDate ? c.creadoEn.toDate().toLocaleTimeString('es-MX') : '-'}</td>
                  <td>
                    <button
                      className="btn-secundario"
                      onClick={() => onImprimir(c)}
                      disabled={imprimiendoFolio === c.folio}
                    >
                      {imprimiendoFolio === c.folio ? 'Imprimiendo...' : 'Imprimir etiqueta'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
