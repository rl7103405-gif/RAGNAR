// Consulta de capturas (bultos) y PDFs generados dentro de un periodo
// (dia/semana/mes/año), con paginacion y guardas anti-carrera. Lo usan tanto
// el panel de Historial como el de Indicadores, para que ambos miren
// exactamente los mismos datos sin duplicar la logica de consulta.
import { useEffect, useRef, useState } from 'react'
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
import { rangoDePeriodo } from '../utils/periodos'

const PAGINA_CAPTURAS = 500
const PAGINA_PDFS = 100

export function useDatosPeriodo(tipo, offset) {
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

  const rango = rangoDePeriodo(tipo, offset)

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
          console.error('[useDatosPeriodo] Error consultando:', err)
          setError('No se pudo consultar: ' + (err.message || err))
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

  const periodoSigueVigente = (tipoAlEmpezar, offsetAlEmpezar) =>
    tipoOffsetRef.current.tipo === tipoAlEmpezar &&
    tipoOffsetRef.current.offset === offsetAlEmpezar

  const cargarMasCapturas = async () => {
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
      if (!periodoSigueVigente(tipoAlEmpezar, offsetAlEmpezar)) return
      setCapturas((prev) => [...prev, ...snap.docs.map((d) => ({ id: d.id, ...d.data() }))])
      setCapturasParcial(snap.size === PAGINA_CAPTURAS)
      setUltimaCaptura(snap.docs[snap.docs.length - 1] || null)
    } catch (err) {
      setError('No se pudieron cargar mas capturas: ' + (err.message || err))
    } finally {
      setCargandoMasCapturas(false)
    }
  }

  const cargarMasPdfs = async () => {
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
      if (!periodoSigueVigente(tipoAlEmpezar, offsetAlEmpezar)) return
      setPdfs((prev) => [...prev, ...snap.docs.map((d) => ({ id: d.id, ...d.data() }))])
      setPdfsParcial(snap.size === PAGINA_PDFS)
      setUltimoPdf(snap.docs[snap.docs.length - 1] || null)
    } catch (err) {
      setError('No se pudieron cargar mas PDFs: ' + (err.message || err))
    } finally {
      setCargandoMasPdfs(false)
    }
  }

  return {
    rango,
    capturas,
    capturasParcial,
    cargandoMasCapturas,
    cargarMasCapturas,
    pdfs,
    pdfsParcial,
    cargandoMasPdfs,
    cargarMasPdfs,
    cargando,
    error
  }
}
