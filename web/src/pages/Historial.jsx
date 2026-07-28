// Historial consultable por dia/semana/mes/año:
//  - Capturas: estado ACTUAL de bultos en el periodo (una captura eliminada
//    ya no aparece; una editada muestra su peso vigente).
//  - PDFs generados: bitacora INMUTABLE (pdfsGenerados) con quien lo genero,
//    maquila, folios y el contenido congelado -- "Reimprimir original"
//    reproduce exactamente el papel emitido aunque las capturas hayan
//    cambiado despues.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { rangoDePeriodo } from '../utils/periodos'
import { generarPdfSalida, descargarPdf } from '../utils/pdf'

const PAGINA_CAPTURAS = 500
const PAGINA_PDFS = 100

const TIPOS = [
  ['dia', 'Dia'],
  ['semana', 'Semana'],
  ['mes', 'Mes'],
  ['anio', 'Año']
]

export default function Historial() {
  const { perfil, cerrarSesion } = useAuth()
  const [tipo, setTipo] = useState('dia')
  const [offset, setOffset] = useState(0)
  const [capturas, setCapturas] = useState([])
  const [capturasParcial, setCapturasParcial] = useState(false)
  const [ultimaCaptura, setUltimaCaptura] = useState(null)
  const [cargandoMasCapturas, setCargandoMasCapturas] = useState(false)
  const [pdfs, setPdfs] = useState([])
  const [pdfsParcial, setPdfsParcial] = useState(false)
  const [ultimoPdf, setUltimoPdf] = useState(null)
  const [cargandoMasPdfs, setCargandoMasPdfs] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [pdfAbierto, setPdfAbierto] = useState(null) // id del registro expandido

  const rango = rangoDePeriodo(tipo === 'anio' ? 'anio' : tipo, offset)

  // Espejo de tipo/offset accesible dentro de las cargas "Cargar mas" ya en
  // vuelo: si el periodo cambia mientras esperan la respuesta de Firestore,
  // se detecta comparando contra este ref y la respuesta vieja se descarta
  // en vez de mezclarse con el periodo nuevo.
  const tipoOffsetRef = useRef({ tipo, offset })
  useEffect(() => {
    tipoOffsetRef.current = { tipo, offset }
  }, [tipo, offset])

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setError('')
      setCapturas([])
      setPdfs([])
      setCapturasParcial(false)
      setPdfsParcial(false)
      setUltimaCaptura(null)
      setUltimoPdf(null)
      try {
        const inicio = Timestamp.fromDate(rango.inicio)
        const fin = Timestamp.fromDate(rango.fin)

        const snapCapturas = await getDocs(
          query(
            collection(db, 'bultos'),
            where('creadoEn', '>=', inicio),
            where('creadoEn', '<', fin),
            orderBy('creadoEn', 'desc'),
            limit(PAGINA_CAPTURAS)
          )
        )
        if (cancelado) return
        setCapturas(snapCapturas.docs.map((d) => ({ id: d.id, ...d.data() })))
        setCapturasParcial(snapCapturas.size === PAGINA_CAPTURAS)
        setUltimaCaptura(snapCapturas.docs[snapCapturas.docs.length - 1] || null)

        const snapPdfs = await getDocs(
          query(
            collection(db, 'pdfsGenerados'),
            where('creadoEn', '>=', inicio),
            where('creadoEn', '<', fin),
            orderBy('creadoEn', 'desc'),
            limit(PAGINA_PDFS)
          )
        )
        if (cancelado) return
        setPdfs(snapPdfs.docs.map((d) => ({ id: d.id, ...d.data() })))
        setPdfsParcial(snapPdfs.size === PAGINA_PDFS)
        setUltimoPdf(snapPdfs.docs[snapPdfs.docs.length - 1] || null)
      } catch (err) {
        if (!cancelado) {
          console.error('[Historial] Error consultando:', err)
          setError('No se pudo consultar el historial: ' + (err.message || err))
        }
      } finally {
        if (!cancelado) setCargando(false)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
    // rango.inicio/fin derivan de tipo+offset; con estos dos basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, offset])

  const onCargarMasCapturas = async () => {
    if (!ultimaCaptura || cargandoMasCapturas) return
    const tipoAlEmpezar = tipo
    const offsetAlEmpezar = offset
    setCargandoMasCapturas(true)
    try {
      const snap = await getDocs(
        query(
          collection(db, 'bultos'),
          where('creadoEn', '>=', Timestamp.fromDate(rango.inicio)),
          where('creadoEn', '<', Timestamp.fromDate(rango.fin)),
          orderBy('creadoEn', 'desc'),
          startAfter(ultimaCaptura),
          limit(PAGINA_CAPTURAS)
        )
      )
      if (
        tipoOffsetRef.current.tipo !== tipoAlEmpezar ||
        tipoOffsetRef.current.offset !== offsetAlEmpezar
      ) {
        // El periodo cambio mientras esperabamos esta respuesta: se descarta
        // para no mezclar capturas de un periodo con las de otro.
        return
      }
      setCapturas((prev) => [...prev, ...snap.docs.map((d) => ({ id: d.id, ...d.data() }))])
      setCapturasParcial(snap.size === PAGINA_CAPTURAS)
      setUltimaCaptura(snap.docs[snap.docs.length - 1] || null)
    } catch (err) {
      setError('No se pudieron cargar mas capturas: ' + (err.message || err))
    } finally {
      setCargandoMasCapturas(false)
    }
  }

  const onCargarMasPdfs = async () => {
    if (!ultimoPdf || cargandoMasPdfs) return
    const tipoAlEmpezar = tipo
    const offsetAlEmpezar = offset
    setCargandoMasPdfs(true)
    try {
      const snap = await getDocs(
        query(
          collection(db, 'pdfsGenerados'),
          where('creadoEn', '>=', Timestamp.fromDate(rango.inicio)),
          where('creadoEn', '<', Timestamp.fromDate(rango.fin)),
          orderBy('creadoEn', 'desc'),
          startAfter(ultimoPdf),
          limit(PAGINA_PDFS)
        )
      )
      if (
        tipoOffsetRef.current.tipo !== tipoAlEmpezar ||
        tipoOffsetRef.current.offset !== offsetAlEmpezar
      ) {
        // El periodo cambio mientras esperabamos esta respuesta: se descarta
        // para no mezclar PDFs de un periodo con los de otro.
        return
      }
      setPdfs((prev) => [...prev, ...snap.docs.map((d) => ({ id: d.id, ...d.data() }))])
      setPdfsParcial(snap.size === PAGINA_PDFS)
      setUltimoPdf(snap.docs[snap.docs.length - 1] || null)
    } catch (err) {
      setError('No se pudieron cargar mas PDFs: ' + (err.message || err))
    } finally {
      setCargandoMasPdfs(false)
    }
  }

  const onReimprimir = (registro) => {
    setError('')
    setAviso('')
    if (!registro.capturas || registro.capturas.length === 0) {
      setError('Este registro no tiene contenido congelado; no se puede reimprimir.')
      return
    }
    const conPesoInvalido = registro.capturas.some((c) => typeof c.pesoGramos !== 'number')
    if (conPesoInvalido) {
      setError('Este registro no tiene contenido congelado; no se puede reimprimir.')
      return
    }
    try {
      // fechaTexto (congelado al generar) reproduce la fecha EXACTA que ya
      // salio impresa en el papel original; solo los registros de antes de
      // este campo caen al fallback con creadoEn/hoy.
      const { blob, nombreArchivo } = generarPdfSalida({
        capturas: registro.capturas,
        operador: registro.generadoPor,
        fecha:
          registro.fechaTexto ||
          (registro.creadoEn?.toDate
            ? registro.creadoEn.toDate().toLocaleDateString('es-MX')
            : new Date().toLocaleDateString('es-MX')),
        encabezado: registro.encabezado || {}
      })
      descargarPdf(blob, nombreArchivo.replace('.pdf', '_copia.pdf'))
      setAviso(
        `Copia del PDF original de ${registro.generadoPor} (${registro.totalFolios} folios) descargada.`
      )
    } catch (err) {
      console.error('[Historial] Error reimprimiendo:', err)
      setError('No se pudo reimprimir: ' + (err.message || err))
    }
  }

  const totalKg = capturas.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000

  const formatearFechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX')}`
      : '-'

  return (
    <div className="layout">
      <div className="barra-superior">
        <div className="barra-titulo">RAGNAR - Historial</div>
        <div className="barra-usuario">
          <Link to="/" className="btn-secundario" style={{ textDecoration: 'none' }}>
            Volver a la estacion
          </Link>
          <span className="usuario-nombre">{perfil?.nombreCompleto || 'Estacion'}</span>
          <button className="btn-salir" onClick={cerrarSesion}>Salir</button>
        </div>
      </div>

      <div className="contenido">
        <div className="tarjeta" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {TIPOS.map(([valor, etiqueta]) => (
              <button
                key={valor}
                className={valor === tipo ? 'btn-primario' : 'btn-secundario'}
                onClick={() => {
                  setTipo(valor)
                  setOffset(0)
                }}
              >
                {etiqueta}
              </button>
            ))}
            <span style={{ marginLeft: 12 }}>
              <button className="btn-secundario" onClick={() => setOffset(offset - 1)}>←</button>
              <strong style={{ margin: '0 10px' }}>{rango.etiqueta}</strong>
              <button
                className="btn-secundario"
                onClick={() => setOffset(offset + 1)}
                disabled={offset >= 0}
                title={offset >= 0 ? 'No hay periodos futuros' : ''}
              >
                →
              </button>
            </span>
          </div>
        </div>

        {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
        {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}
        {cargando && <p>Consultando...</p>}

        <div className="tarjeta" style={{ marginBottom: 18 }}>
          <h2>
            Capturas ({capturas.length}{capturasParcial ? '+' : ''}) - {totalKg.toFixed(2)} kg
            {capturasParcial ? ' (parcial)' : ''}
          </h2>
          <p style={{ fontSize: 13, color: '#777', marginTop: 2 }}>
            Estado actual de las capturas: las eliminadas ya no aparecen y las editadas muestran su
            peso vigente.
          </p>
          {capturasParcial && (
            <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 8 }}>
              Resultados y totales PARCIALES (se muestran {capturas.length}); usa &quot;Cargar
              mas&quot; para completar.
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Folio</th>
                <th style={{ textAlign: 'left' }}>Codigo</th>
                <th style={{ textAlign: 'left' }}>Producto</th>
                <th style={{ textAlign: 'left' }}>Peso (kg)</th>
                <th style={{ textAlign: 'left' }}>Capturado</th>
              </tr>
            </thead>
            <tbody>
              {capturas.map((c) => (
                <tr key={c.id}>
                  <td>{c.folio}</td>
                  <td>{c.producto?.codigo || (c.cruce === 'sin_ruteo' ? 'SIN RUTEO' : '-')}</td>
                  <td>{c.producto?.descripcion || '-'}</td>
                  <td>{(c.pesoGramos / 1000).toFixed(2)}</td>
                  <td>{formatearFechaHora(c.creadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {capturas.length === 0 && !cargando && (
            <p style={{ color: '#777' }}>Sin capturas en este periodo.</p>
          )}
          {capturasParcial && (
            <button
              className="btn-secundario"
              style={{ marginTop: 8 }}
              onClick={onCargarMasCapturas}
              disabled={cargandoMasCapturas}
            >
              {cargandoMasCapturas ? 'Cargando...' : 'Cargar mas'}
            </button>
          )}
        </div>

        <div className="tarjeta">
          <h2>PDFs generados ({pdfs.length}{pdfsParcial ? '+' : ''})</h2>
          {pdfsParcial && (
            <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 8 }}>
              Se muestran solo los {pdfs.length} mas recientes del periodo.
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Fecha</th>
                <th style={{ textAlign: 'left' }}>Genero</th>
                <th style={{ textAlign: 'left' }}>Maquila</th>
                <th style={{ textAlign: 'left' }}>Folios</th>
                <th style={{ textAlign: 'left' }}>Peso (kg)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pdfs.map((p) => (
                <tr key={p.id}>
                  <td>{formatearFechaHora(p.creadoEn)}</td>
                  <td>{p.generadoPor}</td>
                  <td>{p.maquila?.nombre || '-'}</td>
                  <td>
                    <button
                      className="btn-secundario"
                      onClick={() => setPdfAbierto(pdfAbierto === p.id ? null : p.id)}
                    >
                      {p.totalFolios} folios {pdfAbierto === p.id ? '▾' : '▸'}
                    </button>
                    {pdfAbierto === p.id && (
                      <div style={{ fontSize: 12, color: '#555', marginTop: 4, maxWidth: 380 }}>
                        {(p.folios || []).join(', ')}
                      </div>
                    )}
                  </td>
                  <td>{((p.pesoTotalGramos || 0) / 1000).toFixed(2)}</td>
                  <td>
                    <button className="btn-secundario" onClick={() => onReimprimir(p)}>
                      Reimprimir original
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pdfs.length === 0 && !cargando && (
            <p style={{ color: '#777' }}>Sin PDFs generados en este periodo.</p>
          )}
          {pdfsParcial && (
            <button
              className="btn-secundario"
              style={{ marginTop: 8 }}
              onClick={onCargarMasPdfs}
              disabled={cargandoMasPdfs}
            >
              {cargandoMasPdfs ? 'Cargando...' : 'Cargar mas'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
