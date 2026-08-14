// Consulta de capturas (bultos) y PDFs generados dentro de un rango LIBRE de
// fechas (del dia X al dia Y), a diferencia de useDatosPeriodo que solo
// maneja periodos cerrados (dia/semana/mes/año). Lo usa el panel de Reportes.
//
// Se consulta por rango en el servidor (where creadoEn) y el filtrado fino
// (maquila, quien genero, folio, codigo) se hace en memoria sobre lo ya
// traido: son volumenes de decenas/cientos de documentos por rango, y asi no
// hace falta un indice compuesto por cada combinacion de filtros.
import { useEffect, useRef, useState } from 'react'
import { collection, getDocs, limit, orderBy, query, startAfter, Timestamp, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { bultoEsDePrueba, documentoEsDePrueba, soloDeMiMundo } from '../utils/mundoDatos'

const PAGINA_CAPTURAS = 500
const PAGINA_PDFS = 200
// Tope de seguridad: paginas que se encadenan solas antes de marcar parcial.
// Un reporte anual debe traer el periodo COMPLETO, no la primera pagina.
const MAX_PAGINAS = 100

/** Rango [inicio, fin) en hora LOCAL a partir de dos fechas 'AAAA-MM-DD'.
 *  'fin' es exclusivo: se le suma un dia para que el ultimo dia entre completo. */
export function rangoDeFechas(desdeTexto, hastaTexto) {
  const [ay, am, ad] = String(desdeTexto || '').split('-').map(Number)
  const [by, bm, bd] = String(hastaTexto || '').split('-').map(Number)
  if (!ay || !am || !ad || !by || !bm || !bd) return null
  const inicio = new Date(ay, am - 1, ad, 0, 0, 0, 0)
  const fin = new Date(by, bm - 1, bd, 0, 0, 0, 0)
  fin.setDate(fin.getDate() + 1)
  if (fin <= inicio) return null
  return { inicio, fin }
}

/** opciones.incluirCapturas: por defecto NO se consultan los bultos del rango
 *  (el panel de Reportes solo necesita los PDFs emitidos; traer hasta 500
 *  capturas por rango serian lecturas de Firestore desperdiciadas). */
export function useDatosRango(desdeTexto, hastaTexto, opciones = {}) {
  // El mundo de quien mira (ver utils/mundoDatos.js).
  const { esPrueba } = useAuth()
  const incluirCapturas = opciones.incluirCapturas === true
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

  const rango = rangoDeFechas(desdeTexto, hastaTexto)
  const claveRango = rango ? `${rango.inicio.getTime()}-${rango.fin.getTime()}` : ''

  // Espejo del rango vigente: si cambia mientras un "Cargar mas" esta en
  // vuelo, la respuesta vieja se descarta en vez de mezclarse.
  const claveRef = useRef(claveRango)
  useEffect(() => {
    claveRef.current = claveRango
  }, [claveRango, esPrueba])

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCapturas([])
      setPdfs([])
      setCapturasParcial(false)
      setPdfsParcial(false)
      setUltimaCaptura(null)
      setUltimoPdf(null)
      setError('')
      if (!rango) {
        // Rango invalido (fechas vacias o fin antes del inicio): no se
        // consulta nada; el panel muestra su propio aviso. Se apaga 'cargando'
        // explicitamente: si venimos de un rango valido cuya carga quedo
        // cancelada, su finally no corrio y el spinner se quedaria pegado.
        setCargando(false)
        return
      }
      setCargando(true)
      // Si una pagina intermedia truena, lo ya pintado NO es el total: el
      // catch lo marca como parcial en vez de darlo por definitivo.
      let capturasCompletas = false
      let pdfsCompletos = false
      try {
        const inicio = Timestamp.fromDate(rango.inicio)
        const fin = Timestamp.fromDate(rango.fin)

        if (incluirCapturas) {
          const capturasTodas = []
          let cursorCapturas = null
          let paginasCapturas = 0
          let hayMasCapturas = true
          while (hayMasCapturas && paginasCapturas < MAX_PAGINAS) {
            const restricciones = [
              collection(db, 'bultos'),
              where('creadoEn', '>=', inicio),
              where('creadoEn', '<', fin),
              orderBy('creadoEn', 'desc')
            ]
            const snap = await getDocs(
              cursorCapturas
                ? query(...restricciones, startAfter(cursorCapturas), limit(PAGINA_CAPTURAS))
                : query(...restricciones, limit(PAGINA_CAPTURAS))
            )
            if (cancelado) return
            capturasTodas.push(
            ...soloDeMiMundo(
              snap.docs.map((d) => ({ id: d.id, ...d.data() })),
              esPrueba,
              bultoEsDePrueba
            )
          )
            cursorCapturas = snap.docs[snap.docs.length - 1] || null
            hayMasCapturas = snap.size === PAGINA_CAPTURAS
            paginasCapturas += 1
            setCapturas([...capturasTodas])
          }
          setCapturasParcial(hayMasCapturas)
          setUltimaCaptura(cursorCapturas)
        }
        capturasCompletas = true

        // Se encadenan TODAS las paginas del rango: los totales del reporte
        // (folios, docenas, kilos por maquila) tienen que ser del periodo
        // completo, no de la primera pagina.
        const pdfsTodos = []
        let cursorPdfs = null
        let paginasPdfs = 0
        let hayMasPdfs = true
        while (hayMasPdfs && paginasPdfs < MAX_PAGINAS) {
          const restricciones = [
            collection(db, 'pdfsGenerados'),
            where('creadoEn', '>=', inicio),
            where('creadoEn', '<', fin),
            orderBy('creadoEn', 'desc')
          ]
          const snap = await getDocs(
            cursorPdfs
              ? query(...restricciones, startAfter(cursorPdfs), limit(PAGINA_PDFS))
              : query(...restricciones, limit(PAGINA_PDFS))
          )
          if (cancelado) return
          pdfsTodos.push(
            ...soloDeMiMundo(
              snap.docs.map((d) => ({ id: d.id, ...d.data() })),
              esPrueba,
              documentoEsDePrueba
            )
          )
          cursorPdfs = snap.docs[snap.docs.length - 1] || null
          hayMasPdfs = snap.size === PAGINA_PDFS
          paginasPdfs += 1
          setPdfs([...pdfsTodos])
        }
        pdfsCompletos = true
        setPdfsParcial(hayMasPdfs)
        setUltimoPdf(cursorPdfs)
      } catch (err) {
        if (!cancelado) {
          console.error('[useDatosRango] Error consultando:', err)
          setError('No se pudo consultar: ' + (err.message || err))
          if (incluirCapturas && !capturasCompletas) setCapturasParcial(true)
          if (!pdfsCompletos) setPdfsParcial(true)
        }
      } finally {
        if (!cancelado) setCargando(false)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
    // claveRango resume inicio+fin: con eso basta como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveRango, incluirCapturas, esPrueba])

  const rangoSigueVigente = (claveAlEmpezar) => claveRef.current === claveAlEmpezar

  const cargarMasCapturas = async () => {
    if (!ultimaCaptura || cargandoMasCapturas || !rango) return
    const claveAlEmpezar = claveRango
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
      if (!rangoSigueVigente(claveAlEmpezar)) return
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
    if (!ultimoPdf || cargandoMasPdfs || !rango) return
    const claveAlEmpezar = claveRango
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
      if (!rangoSigueVigente(claveAlEmpezar)) return
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
    rangoValido: rango !== null,
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
