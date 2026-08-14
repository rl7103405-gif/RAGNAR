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
import { useAuth } from '../context/AuthContext'
import { bultoEsDePrueba, documentoEsDePrueba, soloDeMiMundo } from '../utils/mundoDatos'
import { rangoDePeriodo } from '../utils/periodos'

const PAGINA_CAPTURAS = 500
const PAGINA_PDFS = 100
// Tope de seguridad: cuantas paginas se encadenan solas antes de rendirse y
// marcar el resultado como parcial. Con 500 por pagina esto cubre 50,000
// capturas (mas de un ano de operacion) sin que el usuario tenga que picarle
// a "Cargar mas": un indicador anual que dice "500+" no sirve para nada.
const MAX_PAGINAS = 100

export function useDatosPeriodo(tipo, offset) {
  // El mundo de quien mira: una cuenta real no ve las pruebas y una de
  // prueba solo ve las suyas (ver utils/mundoDatos.js).
  const { esPrueba } = useAuth()
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
  }, [tipo, offset, esPrueba])

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
      // Si una pagina intermedia truena, lo ya pintado NO es el total: estas
      // banderas dejan que el catch lo marque como parcial en vez de dejar
      // pasar un numero incompleto como definitivo.
      let capturasCompletas = false
      let pdfsCompletos = false
      try {
        const inicio = Timestamp.fromDate(rango.inicio)
        const fin = Timestamp.fromDate(rango.fin)

        // Se encadenan TODAS las paginas del periodo (no solo la primera):
        // los indicadores y los totales deben ser del periodo completo. El
        // parcial solo queda si se topa MAX_PAGINAS o si truena una pagina
        // intermedia (ver el catch: lo ya pintado no puede pasar por total).
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
          // Se va pintando lo que ya llego: con periodos grandes el usuario ve
          // avanzar los numeros en vez de una pantalla vacia.
          setCapturas([...capturasTodas])
        }
        capturasCompletas = true
        setCapturasParcial(hayMasCapturas)
        setUltimaCaptura(cursorCapturas)

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
          console.error('[useDatosPeriodo] Error consultando:', err)
          setError('No se pudo consultar: ' + (err.message || err))
          // Lo que alcanzo a llegar antes del error ya esta pintado: se marca
          // parcial para que no se lea como el total del periodo.
          if (!capturasCompletas) setCapturasParcial(true)
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
    // rango.inicio/fin derivan de tipo+offset; con estos dos basta.
    // esPrueba tambien: al cambiar de cuenta hay que releer, o la sesion nueva
    // se queda mirando los datos del mundo anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, offset, esPrueba])

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
