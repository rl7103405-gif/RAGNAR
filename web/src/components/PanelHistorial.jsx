// Pestana Historial: capturas y PDFs generados del periodo elegido.
//  - Capturas: estado ACTUAL de bultos (una captura eliminada ya no aparece;
//    una editada muestra su peso vigente).
//  - PDFs generados: bitacora INMUTABLE con quien lo genero, maquila, folios
//    y el contenido congelado -- "Reimprimir original" reproduce exactamente
//    el papel emitido aunque las capturas hayan cambiado despues.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useDatosPeriodo } from '../hooks/useDatosPeriodo'
import { porcentajeHonesto } from '../utils/porcentajes'
import { compararAscendente, coincide } from '../utils/texto'
import { reimprimirRegistro, ErrorReimpresion, docenasDeCaptura } from '../utils/reimprimir'
import { agruparPorOt, etiquetaOt } from '../utils/agruparOt'
import { ordenDeCaptura } from '../utils/pdf'
import { ubicarOts } from '../utils/ubicacionEnPlan'
import { normalizarOt } from '../utils/planMaestro'
import { useMaquilas } from './Maquilas'
import { useAuth } from '../context/AuthContext'
import { arbolDeOcCacheado } from '../utils/arbolOrdenes'
import { resumenDeOcs, versionActiva } from '../utils/planMaestro'
import { generarExcelOrdenCompra, nombreDelExcel } from '../utils/excelOrdenCompra'
import { descargarArchivo } from '../utils/excelSalida'
import CorregirPdfModal from './CorregirPdfModal'

export default function PanelHistorial() {
  // Corregir una remision es operacion de embarque: un rol de consulta
  // (Cielo) no debe ver el boton, porque las reglas se lo niegan.
  const { puedeEmbarcar, esAdmin, nivelDeVista, esPrueba, authUser, perfil } = useAuth()
  // El Historial ya NO se divide por dia/semana/mes/año (Roberto y su papa,
  // 25-08): una orden de compra vive semanas, y partirla obligaba a brincar
  // entre periodos para verla completa. Los INDICADORES conservan el suyo.
  const tipo = 'todo'
  const offset = 0
  const [pdfAbierto, setPdfAbierto] = useState(null)
  // Registro de pdfsGenerados que se esta corrigiendo (anular y reemitir).
  const [corrigiendo, setCorrigiendo] = useState(null)
  const [aviso, setAviso] = useState('')
  const [errorLocal, setErrorLocal] = useState('')
  const [busqueda, setBusqueda] = useState({ folio: '', producto: '', capturo: '', orden: '' })
  // De que orden de compra cuelga cada OT, segun el plan maestro.
  const [ubicaciones, setUbicaciones] = useState(new Map())
  const [ocsAbiertas, setOcsAbiertas] = useState(new Set())
  // OC marcadas para bajar a Excel. Lo pidio el papa de Roberto el 24-08:
  // una orden, o varias marcadas, en un solo archivo.
  const [ocsMarcadas, setOcsMarcadas] = useState(new Set())
  // Las ordenes ya terminadas arrancan CERRADAS: son las que ya no piden
  // atencion. Se abren con un clic cuando alguien quiere consultarlas.
  const [terminadasAbiertas, setTerminadasAbiertas] = useState(false)
  // Ordenes CERRADAS A MANO (Roberto, 25-08): las que en la practica ya
  // quedaron aunque no lleguen al 100% contra el plan, porque al arrancar la
  // app hubo capturas que no se registraron. Map oc -> {quien, cuando}.
  const [cerradasManual, setCerradasManual] = useState(new Map())
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'ordenesCompraCerradas'),
      (snap) => {
        const m = new Map()
        snap.docs.forEach((d) => {
          const x = d.data()
          // Cada mundo ve sus cierres: un cierre de prueba no manda a
          // terminadas una orden del mundo real, ni al reves.
          if ((x.esPrueba === true) === !!esPrueba) m.set(d.id, x)
        })
        setCerradasManual(m)
      },
      (err) => console.warn('[Historial] No se pudieron leer los cierres:', err?.message)
    )
    return unsub
  }, [esPrueba])

  const cerrarOrden = async (oc) => {
    // confirm nativo: cerrar una orden es afirmar "lo que falte no va a
    // llegar", y un clic accidental la desapareceria de la vista de trabajo.
    if (!window.confirm(`¿Cerrar la orden ${oc}? Se ira a "terminadas". Puedes reabrirla cuando quieras.`)) return
    try {
      await setDoc(doc(db, 'ordenesCompraCerradas', String(oc)), {
        oc: String(oc),
        cerradaPorUid: authUser.uid,
        cerradaPorNombre: perfil?.nombreCompleto || '',
        cerradaEn: serverTimestamp(),
        ...(esPrueba ? { esPrueba: true } : {})
      })
      setAviso(`Orden ${oc} cerrada. Esta en "Ordenes de compra terminadas"; ahi la puedes reabrir.`)
    } catch (err) {
      setErrorLocal('No se pudo cerrar la orden: ' + (err.message || err))
    }
  }

  const reabrirOrden = async (oc) => {
    try {
      await deleteDoc(doc(db, 'ordenesCompraCerradas', String(oc)))
      setAviso(`Orden ${oc} reabierta: vuelve a "sin terminar".`)
    } catch (err) {
      setErrorLocal('No se pudo reabrir: ' + (err.message || err))
    }
  }
  const [bajando, setBajando] = useState('')
  const [busquedaPdf, setBusquedaPdf] = useState({ maquila: '', folio: '', genero: '', numero: '' })
  // Con cientos de folios por periodo, las OT arrancan CERRADAS: se ve el
  // resumen de cada una y se abre solo la que interesa, sin scrollear todo.
  const [otsAbiertas, setOtsAbiertas] = useState(new Set())
  // Las dos tarjetas grandes tambien se pueden cerrar: con cientos de folios
  // por periodo, poder colapsar "Capturas" deja los PDFs a la vista sin
  // scrollear (y viceversa).
  const [seccionesAbiertas, setSeccionesAbiertas] = useState({ capturas: true, pdfs: true })
  const toggleSeccion = (clave) =>
    setSeccionesAbiertas((prev) => ({ ...prev, [clave]: !prev[clave] }))
  const datos = useDatosPeriodo(tipo, offset)
  const maquilasCatalogo = useMaquilas()

  const toggleOt = (ot) =>
    setOtsAbiertas((prev) => {
      const nueva = new Set(prev)
      if (nueva.has(ot)) nueva.delete(ot)
      else nueva.add(ot)
      return nueva
    })

  const hayBusqueda = busqueda.folio || busqueda.producto || busqueda.capturo || busqueda.orden
  // Filtrado y agrupado memoizados: con periodos grandes (miles de capturas)
  // agrupar + ordenar en cada tecleo del buscador se sentiria lento.
  const capturasFiltradas = useMemo(
    () =>
      datos.capturas.filter(
        (c) =>
          (!busqueda.folio || coincide(c.folio, busqueda.folio)) &&
          (!busqueda.producto ||
            coincide(c.producto?.codigo, busqueda.producto) ||
            coincide(c.producto?.descripcion, busqueda.producto)) &&
          (!busqueda.capturo || coincide(c.operadorNombre, busqueda.capturo)) &&
          // Por orden: sirve tanto la de TRABAJO como la de COMPRA. Lindbergh
          // teclea una OT, el dueno una OC, y ninguno tiene que saber en cual
          // de los dos campos va lo suyo.
          (!busqueda.orden ||
            coincide(ordenDeCaptura(c), busqueda.orden) ||
            coincide(ubicaciones.get(normalizarOt(ordenDeCaptura(c)))?.oc || '', busqueda.orden) ||
            coincide(ubicaciones.get(normalizarOt(ordenDeCaptura(c)))?.destino || '', busqueda.orden))
      ),
    [datos.capturas, busqueda, ubicaciones]
  )
  const gruposCapturas = useMemo(() => agruparPorOt(capturasFiltradas), [capturasFiltradas])

  // Se ubican las OT del periodo en el plan, en una sola tanda.
  useEffect(() => {
    const ots = gruposCapturas.map((g) => g.ot).filter(Boolean)
    if (!ots.length) return
    let cancelado = false
    ubicarOts(ots).then((m) => !cancelado && setUbicaciones(m))
    return () => {
      cancelado = true
    }
  }, [gruposCapturas.map((g) => g.ot).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const SIN_OC = '__sin_oc__'

  /**
   * EL HISTORIAL EN TRES NIVELES: orden de compra -> orden de trabajo -> folios.
   *
   * De la junta: el dueno solo mira ordenes de compra ("su labor no debe estar
   * en los folios"), Lindbergh OT y OC, America folio y OT. Antes esta pantalla
   * arrancaba SIEMPRE en OT, asi que el dueno tenia que saberse de memoria que
   * ordenes de trabajo eran de cual orden de compra — justo lo que la app venia
   * a quitarle.
   */
  const arbolCapturas = useMemo(() => {
    const porOc = new Map()
    gruposCapturas.forEach((g) => {
      const u = ubicaciones.get(normalizarOt(g.ot))
      const clave = u?.oc || SIN_OC
      if (!porOc.has(clave)) {
        porOc.set(clave, { oc: clave, destino: u?.destino || '', ots: [], folios: 0, docenas: 0, docenasMandadas: 0, kg: 0, pendientes: 0 })
      }
      const grupo = porOc.get(clave)
      if (!grupo.destino && u?.destino) grupo.destino = u.destino
      grupo.ots.push(g)
      grupo.folios += g.folios
      grupo.docenas += g.filas.reduce((a, f) => a + docenasDeCaptura(f), 0)
      // MANDADO = lo que ya salio en una remision (tiene su PDF generado).
      // Es lo que la fabrica llama "ya se mando", y es distinto de lo que se
      // encarga a una maquila para ensamblar.
      grupo.docenasMandadas += g.filas
        .filter((f) => f.pdfGeneradoEn)
        .reduce((a, f) => a + docenasDeCaptura(f), 0)
      grupo.kg += g.kg
      grupo.pendientes += g.filas.filter((f) => !f.pdfGeneradoEn).length
    })
    return [...porOc.values()].sort((a, b) => {
      // Lo que el plan no ubica, al final: es lo que hay que arreglar.
      if (a.oc === SIN_OC) return 1
      if (b.oc === SIN_OC) return -1
      return String(a.oc).localeCompare(String(b.oc), 'es', { numeric: true })
    })
  }, [gruposCapturas, ubicaciones])


  /**
   * LO PLANEADO POR ORDEN DE COMPRA, en UNA sola lectura.
   *
   * ⚠️ Antes esto armaba el arbol completo de CADA orden visible (una consulta
   * de plan + los bultos + las tareas de todas las maquilas, por orden). Con
   * el Historial mostrando TODAS las ordenes eso eran decenas de consultas
   * cada vez que alguien abria la pestaña -- justo lo que Roberto senalo el
   * 25-08: "si estamos pidiendo esto cada rato, se va a llenar rapidisimo".
   *
   * El resumen del plan vigente ya trae lo planeado de todas las ordenes en un
   * solo documento, y lo producido y lo mandado salen de los bultos que esta
   * pantalla YA tiene cargados. Cero consultas por orden.
   */
  const [planeadoPorOc, setPlaneadoPorOc] = useState(null)
  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const version = await versionActiva()
        if (!version) { if (vigente) setPlaneadoPorOc(new Map()); return }
        const resumen = await resumenDeOcs(version)
        if (!vigente) return
        setPlaneadoPorOc(new Map(resumen.map((o) => [o.oc, o.planeado])))
      } catch (err) {
        console.warn('[Historial] No se pudo leer el plan:', err?.message)
        if (vigente) setPlaneadoPorOc(new Map())
      }
    })()
    return () => { vigente = false }
  }, [])

  /**
   * hecho / mandado por orden, en porcentaje.
   *
   * hecho   = docenas capturadas contra lo que pide el plan.
   * mandado = docenas que YA SALIERON en una remision (su folio tiene PDF).
   *
   * Los dos comparten denominador, asi que "mandado" nunca puede pasar a
   * "hecho": no se puede embarcar lo que no se capturo.
   */
  const avancesPorOc = useMemo(() => {
    const salida = new Map()
    if (!planeadoPorOc) return salida
    for (const g of arbolCapturas) {
      if (g.oc === SIN_OC) continue
      const meta = planeadoPorOc.get(g.oc)
      if (typeof meta !== 'number' || meta <= 0) {
        // Sin meta en el plan no hay porcentaje posible. Se distingue de un
        // 0% real: uno dice "no se sabe", el otro "no se ha hecho nada".
        salida.set(g.oc, { sinMeta: true })
        continue
      }
      // ⚠️ "MANDADO 100%" SOLO si de verdad no falta nada por mandar.
      //
      // El porcentaje mide contra el PLAN, y una orden puede capturarse DE
      // MAS: la 2449 lleva 5,782 docenas contra 5,562 planeadas, asi que lo
      // mandado ya rebasa la meta y el numero se topaba en 100 con 5 folios
      // todavia sin PDF. Roberto, 26-08: "aunque sea el 99.99999%, no le
      // pongas que es el cien, se van a confundir".
      //
      // Con folios pendientes el mandado se tope en 99.9: sigue siendo la
      // verdad (falta algo) y no puede leerse como terminado. HECHO si puede
      // llegar a 100 -- capturar todo lo que pide el plan es un hecho, y no
      // es lo que decide si la orden termino.
      const pctMandado = (g.docenasMandadas / meta) * 100
      salida.set(g.oc, {
        hecho: Math.min(100, (g.docenas / meta) * 100),
        mandado: g.pendientes > 0 ? Math.min(99.9, pctMandado) : Math.min(100, pctMandado)
      })
    }
    return salida
  }, [arbolCapturas, planeadoPorOc])

  /**
   * Las ordenes ABIERTAS primero; las que ya se mandaron completas, al final.
   *
   * Lo pidio Roberto el 25-08: "orden de compra terminada o mandado al cien
   * por ciento, dividelo". Lo que ocupa la atencion todos los dias es lo que
   * falta por cerrar; una orden entregada al 100% ya solo se consulta.
   *
   * No se ESCONDE ninguna: se ordena y se marca. Esconderla haria que quien
   * busca un folio viejo crea que se perdio.
   */
  const capturasOrdenadas = useMemo(() => {
    // TERMINADA SOLA = 100% contra el plan Y NI UN folio sin mandar a PDF.
    // Las dos condiciones, no una (Roberto, 26-08): la 2449 se capturo DE MAS
    // (5,782 contra 5,562 del plan), las docenas mandadas ya superaban la
    // meta y el % llego a 100 con 5 folios sin mandar -- y se fue a
    // terminadas. Una orden con pendientes NO esta terminada aunque el
    // porcentaje diga 100: el porcentaje mide contra el plan, los pendientes
    // miden contra lo capturado, y terminar exige las dos cosas.
    const completa = (g) =>
      ((avancesPorOc.get(g.oc)?.mandado ?? 0) >= 100 && g.pendientes === 0) ||
      cerradasManual.has(g.oc)
    const abiertas = arbolCapturas.filter((g) => !completa(g))
    const cerradas = arbolCapturas.filter((g) => completa(g))
    // El avance de UN GRUPO de ordenes: se suman docenas contra docenas, no se
    // promedian porcentajes. Promediarlos daria el mismo peso a una orden de
    // 50 docenas que a una de 5,000, y el numero de arriba dejaria de cuadrar
    // con las ordenes de abajo.
    const totalDe = (grupo) => {
      let meta = 0
      let hechas = 0
      let mandadas = 0
      let sinMeta = 0
      for (const g of grupo) {
        if (g.oc === SIN_OC) continue
        const a = avancesPorOc.get(g.oc)
        if (!a || a.sinMeta) { sinMeta += 1; continue }
        meta += planeadoPorOc?.get(g.oc) || 0
        hechas += g.docenas
        mandadas += g.docenasMandadas
      }
      return {
        ordenes: grupo.filter((g) => g.oc !== SIN_OC).length,
        hecho: meta > 0 ? Math.min(100, (hechas / meta) * 100) : null,
        mandado: meta > 0 ? Math.min(100, (mandadas / meta) * 100) : null,
        sinMeta
      }
    }
    return {
      abiertas,
      cerradas,
      totalAbiertas: totalDe(abiertas),
      totalCerradas: totalDe(cerradas)
    }
  }, [arbolCapturas, avancesPorOc, planeadoPorOc, cerradasManual])

  // Precalienta la libreria de Excel en cuanto la pantalla respira: pesa como
  // 1 MB y bajarla al momento del clic era parte del "tarda un buen".
  useEffect(() => {
    const t = setTimeout(() => {
      import('../utils/excelJs.js').then((m) => m.cargarWorkbook()).catch(() => {})
    }, 3000)
    return () => clearTimeout(t)
  }, [])

  const marcarOc = (oc) =>
    setOcsMarcadas((prev) => {
      const nueva = new Set(prev)
      if (nueva.has(oc)) nueva.delete(oc)
      else nueva.add(oc)
      return nueva
    })

  /**
   * Baja el Excel de las ordenes marcadas (o de una sola).
   *
   * ⚠️ NO usa lo que hay en pantalla: el Historial esta filtrado por dia o
   * semana, y el papel que lleva direccion es de la ORDEN COMPLETA. Se vuelve
   * a consultar el plan y los folios de cada OC, igual que hace el arbol, o el
   * archivo saldria con lo de hoy y pareceria que la orden apenas arranco.
   */
  const bajarExcel = async (ocs) => {
    if (!ocs.length) return
    setErrorLocal('')
    setBajando(ocs.length === 1 ? ocs[0] : 'varias')
    try {
      // Si una orden falla, NO se tira el trabajo de las demas: se arma el
      // archivo con las que si salieron y se dice cuales no. Con 14 ordenes
      // seguidas un tropiezo de red es normal, y perder las 13 buenas por la
      // decimocuarta es peor que entregar 13 con su aviso.
      const ordenes = []
      const fallaron = []
      for (const oc of ocs) {
        try {
          // El MISMO arbol (cacheado 1 min) que pinto el porcentaje de la
          // fila: si la OC esta en pantalla, esto ya no consulta nada.
          const { arbol } = await arbolDeOcCacheado(oc, esPrueba)
          // Sin renglones en el plan vigente no hay que exportar: un archivo
          // con las hojas vacias se lee como "no hay nada que reportar",
          // cuando la verdad es que esta orden ya no esta en el plan.
          if (!arbol) {
            throw new Error('no esta en el plan maestro vigente')
          }
          ordenes.push({ oc, arbol })
        } catch (err) {
          console.error(`[Historial] Fallo la orden ${oc}:`, err)
          fallaron.push(`${oc}: ${err.message || err}`)
        }
      }
      if (!ordenes.length) {
        throw new Error('Ninguna orden se pudo armar. ' + fallaron.join(' | '))
      }
      const blob = await generarExcelOrdenCompra(ordenes, fallaron)
      // La MISMA utilidad que ya baja los otros Excel de la app, en vez de
      // otra copia del truco del <a> (esa hace appendChild/remove, que es lo
      // que aguanta en todos los navegadores).
      descargarArchivo(blob, nombreDelExcel(ordenes))
      setAviso(
        fallaron.length
          ? `Excel con ${ordenes.length} orden${ordenes.length === 1 ? '' : 'es'} descargado. NO se pudieron armar ${fallaron.length}: ${fallaron.join(' | ')}`
          : ordenes.length === 1
            ? `Excel de la orden ${ordenes[0].oc} descargado.`
            : `Excel con ${ordenes.length} ordenes descargado.`
      )
    } catch (err) {
      console.error('[Historial] No se pudo armar el Excel:', err)
      setErrorLocal('No se pudo armar el Excel: ' + (err.message || err))
    } finally {
      setBajando('')
    }
  }

  const toggleOc = (oc) =>
    setOcsAbiertas((prev) => {
      const nueva = new Set(prev)
      if (nueva.has(oc)) nueva.delete(oc)
      else nueva.add(oc)
      return nueva
    })

  // Con que nivel arranca cada perfil (ver nivelDeVista en AuthContext): el
  // dueno ve solo ordenes de compra cerradas; los demas ya con sus OT a la
  // vista. Buscar SIEMPRE abre todo, o no se veria lo que se busco.
  useEffect(() => {
    if (hayBusqueda) {
      setOcsAbiertas(new Set(arbolCapturas.map((g) => g.oc)))
      return
    }
    if (nivelDeVista !== 'oc') setOcsAbiertas(new Set(arbolCapturas.map((g) => g.oc)))
  }, [nivelDeVista, hayBusqueda, arbolCapturas.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const hayBusquedaPdf =
    busquedaPdf.maquila || busquedaPdf.folio || busquedaPdf.genero || busquedaPdf.numero
  const pdfsFiltrados = datos.pdfs.filter(
    (p) =>
      (!busquedaPdf.maquila || (p.maquila?.nombre || '') === busquedaPdf.maquila) &&
      (!busquedaPdf.genero || coincide(p.generadoPor, busquedaPdf.genero)) &&
      (!busquedaPdf.folio || (p.folios || []).some((f) => coincide(f, busquedaPdf.folio))) &&
      (!busquedaPdf.numero ||
        String(p.encabezado?.folioInterno ?? '').includes(busquedaPdf.numero.trim()))
  )

  // Rango de numeros de PDF del listado (para el titulo): "del #68 al #79".
  const numerosPdf = pdfsFiltrados
    .map((p) => Number(p.encabezado?.folioInterno))
    .filter((n) => Number.isFinite(n))
  const rangoPdfs =
    numerosPdf.length > 0
      ? { menor: Math.min(...numerosPdf), mayor: Math.max(...numerosPdf) }
      : null

  const totalKg = capturasFiltradas.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000
  const totalDocenas = capturasFiltradas.reduce((acc, c) => acc + docenasDeCaptura(c), 0)
  // Corte de estatus sobre lo filtrado: cuantas capturas ya salieron en un
  // PDF y cuantas siguen pendientes de mandarse.
  const enPdf = capturasFiltradas.filter((c) => c.pdfGeneradoEn).length
  const sinPdf = capturasFiltradas.length - enPdf

  const formatearFechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX')}`
      : '-'

  const onReimprimir = async (registro) => {
    setErrorLocal('')
    setAviso('')
    try {
      setAviso(await reimprimirRegistro(registro))
    } catch (err) {
      if (err instanceof ErrorReimpresion) {
        setErrorLocal(err.message)
        return
      }
      console.error('[PanelHistorial] Error reimprimiendo:', err)
      setErrorLocal('No se pudo reimprimir: ' + (err.message || err))
    }
  }

  /**
   * Una orden de compra con sus OT y folios adentro (tres niveles).
   *
   * Es funcion y no un map inline porque las MISMAS filas viven en DOS
   * tarjetas: las ordenes sin terminar y las terminadas. Duplicar 300
   * lineas de JSX garantiza que un dia se arregle una tabla y no la otra.
   *
   * conAvance=false en las terminadas: ya se mando todo (o se cerro a
   * mano, y eso lo dice su etiqueta); repetir porcentajes ahi es ruido.
   */
  const filaDeOrden = (grupoOc, conAvance = true) => {
                const ocAbierta = hayBusqueda || ocsAbiertas.has(grupoOc.oc)
                const sinOc = grupoOc.oc === SIN_OC
                return (
                  <Fragment key={grupoOc.oc}>
                    <tr
                      onClick={() => toggleOc(grupoOc.oc)}
                      style={{
                        background: sinOc ? '#fffbeb' : '#dde6f2',
                        borderTop: '3px solid #9db4cd',
                        cursor: 'pointer'
                      }}
                      title={ocAbierta ? 'Cerrar esta orden de compra' : 'Abrir esta orden de compra'}
                    >
                      <td colSpan={8} style={{ fontWeight: 700, padding: '9px 4px', fontSize: 15 }}>
                        {/* La casilla NO abre la orden: se para el clic para
                            que marcar no colapse lo que estabas viendo. */}
                        {!sinOc && (
                          <input
                            type="checkbox"
                            checked={ocsMarcadas.has(grupoOc.oc)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => marcarOc(grupoOc.oc)}
                            title="Marcar esta orden para bajarla a Excel"
                            style={{ marginRight: 8, cursor: 'pointer' }}
                          />
                        )}
                        <span style={{ display: 'inline-block', width: 18 }}>
                          {ocAbierta ? '▾' : '▸'}
                        </span>
                        {sinOc ? 'Sin orden de compra en el plan' : `Orden de compra ${grupoOc.oc}`}
                        {grupoOc.destino && (
                          <span
                            style={{
                              fontWeight: 400,
                              marginLeft: 10,
                              fontSize: 12,
                              background: '#ecfdf5',
                              color: '#065f46',
                              borderRadius: 999,
                              padding: '2px 10px'
                            }}
                          >
                            {grupoOc.destino}
                          </span>
                        )}
                        {!sinOc && (
                          <button
                            onClick={(e) => { e.stopPropagation(); bajarExcel([grupoOc.oc]) }}
                            disabled={!!bajando}
                            title="Bajar el Excel de esta orden completa (no solo lo del periodo que estas viendo)"
                            style={{
                              marginLeft: 10,
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '3px 10px',
                              borderRadius: 6,
                              border: '1px solid #94a3b8',
                              background: '#fff',
                              cursor: bajando ? 'wait' : 'pointer'
                            }}
                          >
                            {bajando === grupoOc.oc ? 'Armando...' : 'Excel'}
                          </button>
                        )}
                        {/* CERRAR A MANO (Roberto, 25-08): una orden que ya
                            quedo aunque no llegue al 100% contra el plan.
                            SOLO admin -- "solo mi papa podria cerrar una OC
                            manualmente" --; reversible. */}
                        {!sinOc && esAdmin && (() => {
                          const cierre = cerradasManual.get(grupoOc.oc)
                          if (cierre) {
                            return (
                              <>
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 12,
                                    background: '#fef9c3',
                                    color: '#854d0e',
                                    borderRadius: 999,
                                    padding: '2px 8px'
                                  }}
                                  title={`La cerro ${cierre.cerradaPorNombre || 'alguien'} a mano: el avance no llego al 100% pero se dio por terminada`}
                                >
                                  cerrada a mano
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); reabrirOrden(grupoOc.oc) }}
                                  style={{
                                    marginLeft: 6,
                                    fontSize: 12,
                                    padding: '3px 10px',
                                    borderRadius: 6,
                                    border: '1px solid #94a3b8',
                                    background: '#fff',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Reabrir
                                </button>
                              </>
                            )
                          }
                          // Solo tiene sentido ofrecer el cierre en una orden
                          // que NO llego sola al 100%: esa ya esta terminada.
                          if (
                            (avancesPorOc.get(grupoOc.oc)?.mandado ?? 0) >= 100 &&
                            grupoOc.pendientes === 0
                          ) return null
                          return (
                            <button
                              onClick={(e) => { e.stopPropagation(); cerrarOrden(grupoOc.oc) }}
                              title="Dar por terminada esta orden aunque no llegue al 100%: se va a la seccion de terminadas. Se puede reabrir."
                              style={{
                                marginLeft: 8,
                                fontSize: 12,
                                padding: '3px 10px',
                                borderRadius: 6,
                                border: '1px solid #16a34a',
                                color: '#166534',
                                background: '#fff',
                                cursor: 'pointer'
                              }}
                            >
                              Cerrar orden
                            </button>
                          )
                        })()}
                        {/* hecho = produccion capturada de la ORDEN COMPLETA
                            (no solo el periodo en pantalla); mandado = lo
                            encargado a maquila en docenas. Mismos numeros que
                            la pestaña Ordenes, mismo arbol. Aparecen cuando
                            terminan de calcularse. */}
                        {/* El espacio esta SIEMPRE (Roberto, 25-08): mientras
                            se calcula dice "calculando...", no desaparece. Un
                            dato que aparece de la nada hace dudar de si va a
                            llegar o si la fila no lo tiene. */}
                        {!sinOc && conAvance && (() => {
                          const a = avancesPorOc.get(grupoOc.oc)
                          const base = { fontWeight: 600, marginLeft: 10, fontSize: 13 }
                          if (!a) {
                            return (
                              <span style={{ ...base, fontWeight: 400, color: '#94a3b8' }}>
                                calculando avance...
                              </span>
                            )
                          }
                          if (a.sinMeta) {
                            return (
                              <span
                                style={{ ...base, fontWeight: 400, color: '#94a3b8' }}
                                title="El plan maestro no trae cantidades para esta orden, asi que no hay contra que medir el avance"
                              >
                                sin meta en el plan
                              </span>
                            )
                          }
                          // Honesto: 99.97% se ve "99.9%", no "100%". Un
                          // folio sin mandar no puede esconderse en redondeo.
                          const pinta = porcentajeHonesto
                          // El chip verde exige lo MISMO que la seccion de
                          // terminadas: 100% y cero folios sin PDF. Dos
                          // criterios distintos pondrian el chip en una orden
                          // que sigue arriba, o al reves.
                          const completa = a.mandado >= 100 && grupoOc.pendientes === 0
                          return (
                            <span style={base}>
                              <span style={{ color: '#16a34a' }} title={`${grupoOc.docenas} docenas capturadas`}>
                                hecho {pinta(a.hecho)}
                              </span>
                              <span
                                style={{ color: '#1e40af', marginLeft: 8 }}
                                title={`${grupoOc.docenasMandadas} docenas ya salieron en una remision`}
                              >
                                mandado {pinta(a.mandado)}
                              </span>
                              {/* Una orden mandada al 100% ya no pide atencion:
                                  se marca para poder distinguirla de un golpe
                                  de las que siguen abiertas. */}
                              {completa && (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 12,
                                    background: '#dcfce7',
                                    color: '#166534',
                                    borderRadius: 999,
                                    padding: '2px 8px'
                                  }}
                                  title="Todo lo que pide el plan ya salio en remision"
                                >
                                  completa
                                </span>
                              )}
                            </span>
                          )
                        })()}
                        <span style={{ fontWeight: 400, color: '#556', marginLeft: 10, fontSize: 13 }}>
                          {grupoOc.ots.length} OT - {grupoOc.folios} folio
                          {grupoOc.folios === 1 ? '' : 's'} - {grupoOc.docenas} docenas -{' '}
                          {grupoOc.kg.toFixed(2)} kg
                        </span>
                        {grupoOc.pendientes > 0 && (
                          <span style={{ fontWeight: 400, color: '#8a5300', marginLeft: 10, fontSize: 13 }}>
                            {grupoOc.pendientes} sin mandar a PDF
                          </span>
                        )}
                      </td>
                    </tr>
                    {ocAbierta &&
                      grupoOc.ots.map((grupo) => {
                // Con una busqueda activa se abren todas: el operador ya
                // acoto que quiere ver, no tiene sentido esconderselo.
                const abierta = hayBusqueda || otsAbiertas.has(grupo.ot)
                return (
                  <Fragment key={grupo.ot}>
                    <tr
                      onClick={() => toggleOt(grupo.ot)}
                      style={{
                        background: '#eef2f7',
                        borderTop: '2px solid #c6d0dc',
                        cursor: 'pointer'
                      }}
                      title={abierta ? 'Cerrar esta OT' : 'Abrir esta OT'}
                    >
                      <td colSpan={8} style={{ fontWeight: 700, padding: '8px 4px' }}>
                        <span style={{ display: 'inline-block', width: 18 }}>{abierta ? '▾' : '▸'}</span>
                        {etiquetaOt(grupo.ot)}
                        <span style={{ fontWeight: 400, color: '#556', marginLeft: 10, fontSize: 13 }}>
                          {grupo.folios} folio{grupo.folios === 1 ? '' : 's'} -{' '}
                          {grupo.filas.reduce((a, f) => a + docenasDeCaptura(f), 0)} docenas -{' '}
                          {grupo.kg.toFixed(2)} kg
                        </span>
                        {(() => {
                          const pendientesOt = grupo.filas.filter((f) => !f.pdfGeneradoEn).length
                          return pendientesOt > 0 ? (
                            <span style={{ fontWeight: 400, color: '#8a5300', marginLeft: 10, fontSize: 13 }}>
                              {pendientesOt} sin mandar a PDF
                            </span>
                          ) : (
                            <span style={{ fontWeight: 400, color: '#1a7a3a', marginLeft: 10, fontSize: 13 }}>
                              todo en PDF
                            </span>
                          )
                        })()}
                      </td>
                    </tr>
                    {abierta &&
                      grupo.filas.map((c) => (
                        <tr key={c.id}>
                          <td>{c.folio}</td>
                          <td>{c.producto?.codigo || (c.cruce === 'sin_ruteo' ? 'SIN RUTEO' : '-')}</td>
                          <td>{c.producto?.descripcion || '-'}</td>
                          <td>{docenasDeCaptura(c) || '-'}</td>
                          <td>{(c.pesoGramos / 1000).toFixed(2)}</td>
                          <td>{c.operadorNombre || '-'}</td>
                          <td>{formatearFechaHora(c.creadoEn)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {c.pdfGeneradoEn ? (
                              <span style={{ color: '#1a7a3a', fontSize: 13 }}>
                                {c.pdfFolioInterno != null ? `#${c.pdfFolioInterno}` : 'Enviado'}
                                {c.pdfGeneradoEn?.toDate
                                  ? ` · ${c.pdfGeneradoEn.toDate().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })}`
                                  : ''}
                              </span>
                            ) : (
                              <span style={{ color: '#8a5300', fontSize: 13, fontWeight: 600 }}>
                                Sin mandar
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                )
              })}
                  </Fragment>
                )
  }

  return (
    <>
      {datos.error && <div className="alerta-error" style={{ marginBottom: 12 }}>{datos.error}</div>}
      {errorLocal && <div className="alerta-error" style={{ marginBottom: 12 }}>{errorLocal}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}
      {datos.cargando && <p className="texto-suave">Consultando...</p>}

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2
          onClick={() => toggleSeccion('capturas')}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          title={seccionesAbiertas.capturas ? 'Cerrar esta seccion' : 'Abrir esta seccion'}
        >
          <span style={{ display: 'inline-block', width: 22 }}>
            {seccionesAbiertas.capturas ? '▾' : '▸'}
          </span>
          {/* El encabezado habla de ORDENES DE COMPRA, no de capturas sueltas
              (Roberto, 25-08): "nada mas tienes orden de compras, cuantas hay,
              y en total cuanto vamos de todas esas". El conteo de folios y
              docenas sigue estando, dentro de cada orden. */}
          Ordenes de compra sin terminar ({capturasOrdenadas.totalAbiertas.ordenes})
          <span style={{ fontWeight: 400, fontSize: 14, marginLeft: 10 }}>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>
              hecho {porcentajeHonesto(capturasOrdenadas.totalAbiertas.hecho)}
            </span>
            <span style={{ color: '#1e40af', fontWeight: 600, marginLeft: 8 }}>
              mandado {porcentajeHonesto(capturasOrdenadas.totalAbiertas.mandado)}
            </span>
          </span>
          <span className="texto-suave" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
            (todas, sin filtro de fecha)
          </span>
        </h2>
        {seccionesAbiertas.capturas && (
          <>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Estado actual de las capturas: las eliminadas ya no aparecen y las editadas muestran su
            peso vigente.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '10px 0' }}>
            <label className="campo" style={{ flex: '1 1 130px' }}>
              <span>Folio</span>
              <input
                type="text"
                placeholder="ej. 442745"
                value={busqueda.folio}
                onChange={(e) => setBusqueda({ ...busqueda, folio: e.target.value })}
              />
            </label>
            {/* Un solo campo para las dos ordenes: el dueno teclea una de
                compra, Lindbergh una de trabajo, y ninguno tiene que saber en
                cual de los dos campos va lo suyo. Tambien acepta el cliente. */}
            <label className="campo" style={{ flex: '1 1 190px' }}>
              <span>Orden de compra o de trabajo</span>
              <input
                type="text"
                placeholder="ej. 2449, 7887 o Chedraui"
                value={busqueda.orden}
                onChange={(e) => setBusqueda({ ...busqueda, orden: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '1 1 170px' }}>
              <span>Codigo o producto</span>
              <input
                type="text"
                placeholder="ej. 1313-I o calceta"
                value={busqueda.producto}
                onChange={(e) => setBusqueda({ ...busqueda, producto: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '1 1 150px' }}>
              <span>Quien capturo</span>
              <input
                type="text"
                placeholder="nombre"
                value={busqueda.capturo}
                onChange={(e) => setBusqueda({ ...busqueda, capturo: e.target.value })}
              />
            </label>
            {hayBusqueda && (
              <button
                className="btn-secundario"
                style={{ alignSelf: 'end' }}
                onClick={() => setBusqueda({ folio: '', producto: '', capturo: '' })}
              >
                Limpiar
              </button>
            )}
          </div>
          {capturasFiltradas.length > 0 && !hayBusqueda && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                className="btn-secundario"
                onClick={() => setOtsAbiertas(new Set(gruposCapturas.map((g) => g.ot)))}
              >
                Abrir todas las OT
              </button>
              <button className="btn-secundario" onClick={() => setOtsAbiertas(new Set())}>
                Cerrar todas
              </button>
              {/* SIEMPRE visible (Roberto, 25-08): sin marcas va apagado en
                  gris, y se enciende azul cuando eliges que bajar. Un boton
                  que aparece y desaparece hace dudar de donde estaba. */}
              <button
                className="btn-primario"
                onClick={() => bajarExcel([...ocsMarcadas])}
                disabled={ocsMarcadas.size === 0 || !!bajando}
                title={
                  ocsMarcadas.size === 0
                    ? 'Marca una o varias ordenes con su casilla para bajarlas en un Excel'
                    : undefined
                }
                style={{
                  marginLeft: 'auto',
                  ...(ocsMarcadas.size === 0 && !bajando
                    ? { background: '#e5e7eb', color: '#6b7280', cursor: 'not-allowed', border: '1px solid #d1d5db', opacity: 1 }
                    : {})
                }}
              >
                {bajando === 'varias'
                  ? 'Armando el Excel...'
                  : ocsMarcadas.size === 0
                    ? 'Bajar Excel (marca las ordenes)'
                    : `Bajar Excel de ${ocsMarcadas.size} orden${ocsMarcadas.size === 1 ? '' : 'es'}`}
              </button>
              {ocsMarcadas.size > 0 && (
                <button className="btn-secundario" onClick={() => setOcsMarcadas(new Set())}>
                  Desmarcar
                </button>
              )}
            </div>
          )}
          {hayBusqueda && datos.capturasParcial && (
            <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 8 }}>
              La busqueda solo revisa lo ya cargado: usa &quot;Cargar mas&quot; abajo para traer el
              resto del periodo.
            </div>
          )}
          {datos.capturasParcial && (
            <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 8 }}>
              Resultados y totales PARCIALES (se muestran {datos.capturas.length}); usa &quot;Cargar
              mas&quot; para completar.
            </div>
          )}
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Codigo</th>
                <th>Producto</th>
                <th>Docenas</th>
                <th>Peso (kg)</th>
                <th>Capturo</th>
                <th>Fecha y hora</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {/* NIVEL 1: la orden de compra. Dentro van sus ordenes de trabajo,
                  y dentro de esas los folios. El dueno se queda en este
                  renglon; Lindbergh abre una OT; America llega al folio. */}
              {/* Abiertas primero, completas al final (ver capturasOrdenadas). */}
              {/* Solo las SIN TERMINAR: las terminadas tienen su propia
                  tarjeta abajo (Roberto, 25-08: 'no quiero que esten en el
                  mismo cuadro'). */}
              {capturasOrdenadas.abiertas.map((g) => filaDeOrden(g))}
            </tbody>
          </table>
          {capturasFiltradas.length === 0 && !datos.cargando && (
            <p className="texto-suave">
              {hayBusqueda && datos.capturas.length > 0
                ? 'Ninguna captura del periodo coincide con la busqueda.'
                : 'Sin capturas en este periodo.'}
            </p>
          )}
          {datos.capturasParcial && (
            <button
              className="btn-secundario"
              style={{ marginTop: 8 }}
              onClick={datos.cargarMasCapturas}
              disabled={datos.cargandoMasCapturas}
            >
              {datos.cargandoMasCapturas ? 'Cargando...' : 'Cargar mas'}
            </button>
          )}
          </>
        )}
      </div>

      {/* LA TARJETA DE LAS TERMINADAS: su propio recuadro, no un renglon
          dentro de la tabla de arriba (Roberto, 25-08: "no quiero que esten
          en el mismo cuadro"). Arranca cerrada -- ya no piden atencion -- y
          una busqueda la abre sola, porque quien busca un folio viejo tiene
          que poder encontrarlo aunque su orden ya este cerrada. */}
      {capturasOrdenadas.cerradas.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 18 }}>
          <h2
            onClick={() => setTerminadasAbiertas((v) => !v)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title={terminadasAbiertas ? 'Cerrar esta seccion' : 'Ver las ordenes terminadas'}
          >
            <span style={{ display: 'inline-block', width: 22 }}>
              {terminadasAbiertas || hayBusqueda ? '▾' : '▸'}
            </span>
            Ordenes de compra terminadas ({capturasOrdenadas.cerradas.length})
            <span className="texto-suave" style={{ fontWeight: 400, fontSize: 13, marginLeft: 10 }}>
              mandadas al 100%, o cerradas a mano
            </span>
          </h2>
          {(terminadasAbiertas || hayBusqueda) && (
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Codigo</th>
                  <th>Producto</th>
                  <th>Docenas</th>
                  <th>Peso (kg)</th>
                  <th>Capturo</th>
                  <th>Fecha y hora</th>
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>
                {/* Sin porcentajes por fila (conAvance=false): ya se mando
                    todo, o la etiqueta "cerrada a mano" dice lo que paso. */}
                {capturasOrdenadas.cerradas.map((g) => filaDeOrden(g, false))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="tarjeta">
        <h2
          onClick={() => toggleSeccion('pdfs')}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          title={seccionesAbiertas.pdfs ? 'Cerrar esta seccion' : 'Abrir esta seccion'}
        >
          <span style={{ display: 'inline-block', width: 22 }}>
            {seccionesAbiertas.pdfs ? '▾' : '▸'}
          </span>
          PDFs generados ({pdfsFiltrados.length}
          {hayBusquedaPdf ? ` de ${datos.pdfs.length}` : ''}
          {datos.pdfsParcial ? '+' : ''})
          {rangoPdfs && (
            <span style={{ fontWeight: 400, fontSize: 14, marginLeft: 10, color: '#556' }}>
              {rangoPdfs.menor === rangoPdfs.mayor
                ? `folio interno ${rangoPdfs.mayor}`
                : `folios internos ${rangoPdfs.menor} al ${rangoPdfs.mayor}`}
            </span>
          )}
        </h2>
        {seccionesAbiertas.pdfs && (
          <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '10px 0' }}>
            <label className="campo" style={{ flex: '1 1 110px' }}>
              <span>Folio interno</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="ej. 79"
                value={busquedaPdf.numero}
                onChange={(e) => setBusquedaPdf({ ...busquedaPdf, numero: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '1 1 150px' }}>
              <span>Maquila / destino</span>
              {/* Se elige del catalogo (igual que en Reportes): asi un dedazo
                  no hace parecer que esa maquila no tuvo salidas. */}
              <select
                value={busquedaPdf.maquila}
                onChange={(e) => setBusquedaPdf({ ...busquedaPdf, maquila: e.target.value })}
              >
                <option value="">Todas las maquilas</option>
                {maquilasCatalogo.map((m) => (
                  <option key={m.id} value={m.nombre}>
                    {m.nombre}
                    {!m.activo ? ' (inactiva)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo" style={{ flex: '1 1 130px' }}>
              <span>Folio incluido</span>
              <input
                type="text"
                placeholder="ej. 442745"
                value={busquedaPdf.folio}
                onChange={(e) => setBusquedaPdf({ ...busquedaPdf, folio: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '1 1 150px' }}>
              <span>Quien lo genero</span>
              <input
                type="text"
                placeholder="nombre"
                value={busquedaPdf.genero}
                onChange={(e) => setBusquedaPdf({ ...busquedaPdf, genero: e.target.value })}
              />
            </label>
            {hayBusquedaPdf && (
              <button
                className="btn-secundario"
                style={{ alignSelf: 'end' }}
                onClick={() => setBusquedaPdf({ maquila: '', folio: '', genero: '', numero: '' })}
              >
                Limpiar
              </button>
            )}
          </div>
          {hayBusquedaPdf && datos.pdfsParcial && (
            <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 8 }}>
              La busqueda solo revisa lo ya cargado: usa &quot;Cargar mas&quot; abajo para traer el
              resto del periodo.
            </div>
          )}
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Folio interno</th>
                <th>Fecha</th>
                <th>Genero</th>
                <th>Maquila</th>
                <th>Folios</th>
                <th>Docenas</th>
                <th>Peso (kg)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pdfsFiltrados.map((p) => (
                <tr key={p.id}>
                  {/* El folio interno con el que salio el papel: la referencia
                      oficial de cada documento. NO confundir ni renombrar: es
                      el consecutivo de siempre, aqui solo se MUESTRA. */}
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {p.encabezado?.folioInterno != null && p.encabezado.folioInterno !== ''
                      ? p.encabezado.folioInterno
                      : '-'}
                    {p.anuladaPorRegistroId && (
                      <div style={{ fontWeight: 400, fontSize: 11, color: '#a00' }}>
                        ANULADA · la sustituye la {p.anuladaFolioInterno}
                      </div>
                    )}
                    {p.reemision && (
                      <div style={{ fontWeight: 400, fontSize: 11, color: '#1e40af' }}>
                        corrige a la {p.reemision.anulaFolioInterno} (rev. {p.reemision.revision})
                      </div>
                    )}
                  </td>
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
                      /* EL DESGLOSE DEL DOCUMENTO (Roberto, 27-08): lo mismo
                         que trae el papel -- codigo, producto, docenas y OT --
                         sin tener que reimprimirlo para verlo. Sale de
                         'capturas', la copia CONGELADA que se guardo al
                         emitir, asi que es lo que dice ese documento. */
                      <div style={{ fontSize: 12, marginTop: 6, maxWidth: 560 }}>
                        {(p.capturas || []).length === 0 ? (
                          <div className="texto-suave">
                            {[...(p.folios || [])].sort((a, b) => compararAscendente(a, b)).join(', ')}
                          </div>
                        ) : (
                          <table className="tabla-datos" style={{ fontSize: 12 }}>
                            <thead>
                              <tr className="texto-suave">
                                <th style={{ textAlign: 'left' }}>Folio</th>
                                <th style={{ textAlign: 'left' }}>Codigo</th>
                                <th style={{ textAlign: 'left' }}>Producto</th>
                                <th style={{ textAlign: 'right' }}>Docenas</th>
                                <th style={{ textAlign: 'right' }}>Peso</th>
                                <th style={{ textAlign: 'left' }}>OT</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...(p.capturas || [])]
                                .sort((a, b) => compararAscendente(a.folio, b.folio))
                                .map((c) => {
                                  const pr = c.producto || {}
                                  const doc = docenasDeCaptura(c)
                                  return (
                                    <tr key={c.folio}>
                                      <td>{c.folio}</td>
                                      <td>{pr.codigo || <span className="texto-suave">SIN RUTEO</span>}</td>
                                      <td>
                                        {pr.descripcion || <span className="texto-suave">-</span>}
                                        {pr.modelo && (
                                          <span className="texto-suave"> · {pr.modelo}</span>
                                        )}
                                        {pr.color && <span className="texto-suave"> · {pr.color}</span>}
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        {doc ? doc.toFixed(2) : <span className="texto-suave">-</span>}
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        {((c.pesoGramos || 0) / 1000).toFixed(2)}
                                      </td>
                                      <td>{pr.ot || <span className="texto-suave">-</span>}</td>
                                    </tr>
                                  )
                                })}
                            </tbody>
                          </table>
                        )}
                        {p.capturasOriginales && (
                          /* Si el documento se re-cruzo despues de emitirse, se
                             dice: lo de arriba es el dato corregido, no
                             literalmente lo que se imprimio aquel dia. */
                          <p className="texto-suave" style={{ fontSize: 11, marginTop: 4 }}>
                            Este documento se completo despues de emitirse (re-cruce): arriba van los
                            datos corregidos. El papel original se conserva registrado.
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td>{(p.capturas || []).reduce((a, c) => a + docenasDeCaptura(c), 0) || '-'}</td>
                  <td>{((p.pesoTotalGramos || 0) / 1000).toFixed(2)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-secundario" onClick={() => onReimprimir(p)}>
                      Reimprimir original
                    </button>
                    {!p.anuladaPorRegistroId && puedeEmbarcar && (
                      <button
                        className="btn-secundario"
                        style={{ marginLeft: 6 }}
                        onClick={() => setCorrigiendo(p)}
                        title="Anular esta remision y emitir una corregida (necesita permiso de Roberto)"
                      >
                        Corregir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pdfsFiltrados.length === 0 && !datos.cargando && (
            <p className="texto-suave">
              {hayBusquedaPdf && datos.pdfs.length > 0
                ? 'Ningun PDF del periodo coincide con la busqueda.'
                : 'Sin PDFs generados en este periodo.'}
            </p>
          )}
          {datos.pdfsParcial && (
            <button
              className="btn-secundario"
              style={{ marginTop: 8 }}
              onClick={datos.cargarMasPdfs}
              disabled={datos.cargandoMasPdfs}
            >
              {datos.cargandoMasPdfs ? 'Cargando...' : 'Cargar mas'}
            </button>
          )}
          </>
        )}
      </div>

      {corrigiendo && (
        <CorregirPdfModal
          registro={corrigiendo}
          onCerrar={() => setCorrigiendo(null)}
          onListo={(mensaje) => {
            setAviso(mensaje)
            setErrorLocal('')
          }}
        />
      )}
    </>
  )
}
