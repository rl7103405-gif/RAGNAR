// Pestana Reportes: consulta con RANGO LIBRE de fechas (del dia X al dia Y,
// no solo periodos cerrados) y filtros por maquila / folio /
// codigo. Muestra el resumen (totales y desglose por maquila y por dia) y el
// detalle de cada documento emitido, con reimpresion del PDF original y
// exportacion del resultado a Excel.
//
// La fuente de los totales son los PDFs generados (pdfsGenerados), que traen
// su contenido CONGELADO: es lo que realmente salio en papel a cada maquila.
import { useMemo, useState } from 'react'
import { useDatosRango } from '../hooks/useDatosRango'
import { descargarArchivo } from '../utils/excelSalida'
import { generarExcelReporte } from '../utils/excelReporte'
import { ordenDeCaptura } from '../utils/pdf'
import { compararAscendente, coincide, fechaLocalISO } from '../utils/texto'
import { reimprimirRegistro, ErrorReimpresion, docenasDeCaptura } from '../utils/reimprimir'
import { useMaquilas } from './Maquilas'

const SIN_MAQUILA = '(sin maquila)'

/** Atajos de rango: llenan las dos fechas de un clic. */
function rangoAtajo(clave) {
  const hoy = new Date()
  const fin = fechaLocalISO(hoy)
  const inicio = new Date(hoy)
  if (clave === 'hoy') {
    // inicio = hoy
  } else if (clave === 'semana') {
    // Semana en curso, iniciando en LUNES (misma convencion que periodos.js).
    inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7))
  } else if (clave === 'mes') {
    inicio.setDate(1)
  } else if (clave === 'anio') {
    inicio.setMonth(0, 1)
  }
  return { desde: fechaLocalISO(inicio), hasta: fin }
}

export default function PanelReportes() {
  const hoyISO = fechaLocalISO(new Date())
  const [desde, setDesde] = useState(hoyISO)
  const [hasta, setHasta] = useState(hoyISO)
  const [filtros, setFiltros] = useState({ maquila: '', folio: '', codigo: '', ot: '', folioInterno: '' })
  // Como se despliegan los documentos: 'documentos' (uno por PDF), 'codigo'
  // (agrupado por codigo con sus folios) o 'peps' (folio por folio, el
  // capturado MAS VIEJO primero: primeras entradas, primeras salidas).
  const [vista, setVista] = useState('documentos')
  const [abierto, setAbierto] = useState(null)
  const [aviso, setAviso] = useState('')
  const [errorLocal, setErrorLocal] = useState('')
  const [exportando, setExportando] = useState(false)

  const datos = useDatosRango(desde, hasta)
  const maquilasCatalogo = useMaquilas()

  const setFiltro = (clave) => (e) => setFiltros({ ...filtros, [clave]: e.target.value })
  const hayFiltros = Boolean(
    filtros.maquila || filtros.folio || filtros.codigo || filtros.ot || filtros.folioInterno
  )

  // Filtrado en memoria sobre los PDFs del rango ya traidos.
  const pdfsFiltrados = useMemo(
    () =>
      datos.pdfs.filter(
        (p) =>
          // La maquila se elige del catalogo, asi que se compara el nombre
          // COMPLETO (no parcial): dos maquilas distintas pueden compartir
          // parte del nombre.
          (!filtros.maquila || (p.maquila?.nombre || '') === filtros.maquila) &&
          (!filtros.folio || (p.folios || []).some((f) => coincide(f, filtros.folio))) &&
          (!filtros.codigo ||
            (p.capturas || []).some(
              (c) => coincide(c.producto?.codigo, filtros.codigo) || coincide(c.producto?.descripcion, filtros.codigo)
            )) &&
          (!filtros.ot ||
            (p.capturas || []).some((c) => ordenDeCaptura(c) === filtros.ot.trim())) &&
          // Mismo mecanismo que el buscador del Historial: substring sobre el
          // folio interno como texto (en pdfsGenerados vive como string).
          (!filtros.folioInterno ||
            String(p.encabezado?.folioInterno ?? '').includes(filtros.folioInterno.trim()))
      ),
    [datos.pdfs, filtros]
  )

  const docenasDePdf = (p) => (p.capturas || []).reduce((acc, c) => acc + docenasDeCaptura(c), 0)

  const totales = useMemo(() => {
    const folios = pdfsFiltrados.reduce((acc, p) => acc + (p.totalFolios || (p.folios || []).length), 0)
    const pesoGramos = pdfsFiltrados.reduce((acc, p) => acc + (p.pesoTotalGramos || 0), 0)
    const docenas = pdfsFiltrados.reduce((acc, p) => acc + docenasDePdf(p), 0)
    return { documentos: pdfsFiltrados.length, folios, pesoGramos, docenas }
  }, [pdfsFiltrados])

  const resumenMaquilas = useMemo(() => {
    const mapa = new Map()
    pdfsFiltrados.forEach((p) => {
      const nombre = p.maquila?.nombre || SIN_MAQUILA
      if (!mapa.has(nombre)) mapa.set(nombre, { maquila: nombre, documentos: 0, folios: 0, docenas: 0, pesoGramos: 0 })
      const m = mapa.get(nombre)
      m.documentos += 1
      m.folios += p.totalFolios || (p.folios || []).length
      m.docenas += docenasDePdf(p)
      m.pesoGramos += p.pesoTotalGramos || 0
    })
    return [...mapa.values()].sort((a, b) => b.pesoGramos - a.pesoGramos)
  }, [pdfsFiltrados])

  const resumenDias = useMemo(() => {
    const mapa = new Map()
    pdfsFiltrados.forEach((p) => {
      const dia = p.creadoEn?.toDate ? p.creadoEn.toDate().toLocaleDateString('es-MX') : '-'
      if (!mapa.has(dia)) mapa.set(dia, { dia, documentos: 0, folios: 0, pesoGramos: 0 })
      const d = mapa.get(dia)
      d.documentos += 1
      d.folios += p.totalFolios || (p.folios || []).length
      d.pesoGramos += p.pesoTotalGramos || 0
    })
    return [...mapa.values()]
  }, [pdfsFiltrados])

  // Filtros a nivel RENGLON para las vistas por codigo y PEPS: el filtro de
  // PDFs deja pasar el documento completo si ALGUNA captura coincide, pero en
  // estas vistas cada renglon es una captura y solo deben verse las que
  // coinciden (si no, la OT buscada arrastra a las demas OTs de su PDF).
  const capturaPasaFiltros = (c) =>
    (!filtros.ot || ordenDeCaptura(c) === filtros.ot.trim()) &&
    (!filtros.codigo ||
      coincide(c.producto?.codigo, filtros.codigo) ||
      coincide(c.producto?.descripcion, filtros.codigo)) &&
    (!filtros.folio || coincide(c.folio, filtros.folio))

  // Vista POR CODIGO: todo lo salido en el rango, agrupado por codigo con la
  // descripcion y el desglose de folios.
  const porCodigo = useMemo(() => {
    if (vista !== 'codigo') return []
    const mapa = new Map()
    pdfsFiltrados.forEach((p) => {
      ;(p.capturas || []).filter(capturaPasaFiltros).forEach((c) => {
        const codigo = String(c.producto?.codigo || 'SIN CODIGO').toUpperCase()
        if (!mapa.has(codigo)) {
          mapa.set(codigo, {
            codigo,
            descripcion: c.producto?.descripcion || '',
            docenas: 0,
            pesoGramos: 0,
            folios: []
          })
        }
        const g = mapa.get(codigo)
        if (!g.descripcion && c.producto?.descripcion) g.descripcion = c.producto.descripcion
        g.docenas += docenasDeCaptura(c)
        g.pesoGramos += c.pesoGramos || 0
        g.folios.push(c.folio)
      })
    })
    return [...mapa.values()]
      .map((g) => ({ ...g, folios: g.folios.sort((a, b) => compararAscendente(a, b)) }))
      .sort((a, b) => compararAscendente(a.codigo, b.codigo))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfsFiltrados, vista, filtros])

  // Vista PEPS: folio por folio, ordenados por su fecha de CAPTURA ascendente
  // (lo mas viejo primero). Cada renglon sabe en que PDF salio.
  const filasPeps = useMemo(() => {
    if (vista !== 'peps') return []
    const filas = []
    pdfsFiltrados.forEach((p) => {
      ;(p.capturas || []).filter(capturaPasaFiltros).forEach((c) => {
        // Los PDFs nuevos congelan capturadoEn (fecha real de captura); los
        // de antes de ese campo caen a la fecha del documento, marcada como
        // aproximada.
        const real = c.capturadoEn?.toDate ? c.capturadoEn.toDate() : null
        const delPdf = p.creadoEn?.toDate ? p.creadoEn.toDate() : null
        filas.push({
          folio: c.folio,
          codigo: c.producto?.codigo || '-',
          descripcion: c.producto?.descripcion || '',
          docenas: docenasDeCaptura(c),
          pesoGramos: c.pesoGramos || 0,
          capturadoEn: real || delPdf,
          fechaAproximada: !real,
          folioInterno: p.encabezado?.folioInterno ?? '-',
          maquila: p.maquila?.nombre || '-'
        })
      })
    })
    return filas.sort((a, b) => {
      const ta = a.capturadoEn ? a.capturadoEn.getTime() : 0
      const tb = b.capturadoEn ? b.capturadoEn.getTime() : 0
      return ta - tb || compararAscendente(a.folio, b.folio)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfsFiltrados, vista, filtros])

  const etiquetaRango = desde === hasta ? desde : `${desde} al ${hasta}`

  const formatearFechaHora = (t) =>
    t?.toDate ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX')}` : '-'

  const onAtajo = (clave) => {
    const r = rangoAtajo(clave)
    setDesde(r.desde)
    setHasta(r.hasta)
  }

  // Un atajo se pinta como ACTIVO cuando el rango en pantalla es exactamente
  // el que produciria ese atajo: asi se ve de inmediato en que periodo estas,
  // y deja de estar activo si mueves las fechas a mano.
  const atajoActivo = (clave) => {
    const r = rangoAtajo(clave)
    return r.desde === desde && r.hasta === hasta
  }

  // Reimpresion fiel del papel original (mismo criterio que Historial: usa el
  // contenido congelado del registro, no las capturas "vivas").
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
      console.error('[PanelReportes] Error reimprimiendo:', err)
      setErrorLocal('No se pudo reimprimir: ' + (err.message || err))
    }
  }

  const onExportar = async () => {
    setErrorLocal('')
    setAviso('')
    if (pdfsFiltrados.length === 0) {
      setErrorLocal('No hay resultados que exportar con esos filtros.')
      return
    }
    setExportando(true)
    try {
      const detalle = []
      pdfsFiltrados.forEach((p) => {
        const fecha = p.creadoEn?.toDate ? p.creadoEn.toDate().toLocaleDateString('es-MX') : (p.fechaTexto || '-')
        // Detalle por folio ascendente dentro de cada documento, igual que el
        // PDF impreso.
        ;[...(p.capturas || [])]
          .filter(capturaPasaFiltros)
          .sort((a, b) => compararAscendente(a.folio, b.folio))
          .forEach((c) => {
          const d = typeof c.producto?.docenas === 'number' ? c.producto.docenas : c.producto?.total
          detalle.push({
            fecha,
            folioInterno: p.encabezado?.folioInterno ?? '',
            maquila: p.maquila?.nombre || '',
            genero: p.generadoPor || '',
            folio: c.folio,
            codigo: c.producto?.codigo || '',
            producto: c.producto?.descripcion || '',
            docenas: typeof d === 'number' ? d : null,
            pesoGramos: c.pesoGramos || 0
          })
        })
      })
      // Orden global de la hoja: por numero de PDF ascendente y, dentro de
      // cada documento, por folio ascendente. Sin esto, los documentos salian
      // del mas nuevo al mas viejo y la hoja brincaba (500, 600, 100...).
      detalle.sort(
        (a, b) =>
          compararAscendente(a.folioInterno, b.folioInterno) ||
          compararAscendente(a.folio, b.folio)
      )
      const descripcionFiltros = [
        filtros.maquila && `maquila: ${filtros.maquila}`,
        filtros.folio && `folio: ${filtros.folio}`,
        filtros.codigo && `codigo/producto: ${filtros.codigo}`,
        filtros.ot && `OT: ${filtros.ot}`,
        filtros.folioInterno && `folio interno: ${filtros.folioInterno}`
      ].filter(Boolean)
      const excel = await generarExcelReporte({
        resumenMaquilas,
        detalle,
        etiquetaRango,
        filtros: descripcionFiltros,
        desde,
        hasta
      })
      descargarArchivo(excel.blob, excel.nombreArchivo)
      setAviso(`Excel del reporte descargado (${detalle.length} renglones de detalle).`)
    } catch (err) {
      console.error('[PanelReportes] Error exportando:', err)
      setErrorLocal('No se pudo exportar el Excel: ' + (err.message || err))
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Buscar salidas</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label className="campo" style={{ flex: '0 1 170px' }}>
            <span>Del dia</span>
            <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="campo" style={{ flex: '0 1 170px' }}>
            <span>Al dia</span>
            <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <div className="filtros" style={{ marginBottom: 8 }}>
            {[
              ['hoy', 'Hoy'],
              ['semana', 'Semana'],
              ['mes', 'Mes'],
              ['anio', 'Año']
            ].map(([clave, texto]) => (
              <button
                key={clave}
                className={`chip-filtro ${atajoActivo(clave) ? 'activo' : ''}`}
                onClick={() => onAtajo(clave)}
              >
                {texto}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          <label className="campo" style={{ flex: '1 1 220px' }}>
            <span>Maquila</span>
            {/* Se ELIGE del catalogo, no se teclea: escribir el nombre a mano
                hacia que un dedazo devolviera "sin resultados" y pareciera que
                esa maquila no tuvo salidas. */}
            <select value={filtros.maquila} onChange={setFiltro('maquila')}>
              <option value="">Todas las maquilas</option>
              {maquilasCatalogo.map((m) => (
                <option key={m.id} value={m.nombre}>
                  {m.nombre}
                  {!m.activo ? ' (inactiva)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="campo" style={{ flex: '1 1 140px' }}>
            <span>Folio incluido</span>
            <input type="text" placeholder="ej. 442745" value={filtros.folio} onChange={setFiltro('folio')} />
          </label>
          <label className="campo" style={{ flex: '1 1 180px' }}>
            <span>Codigo o producto</span>
            <input type="text" placeholder="ej. 1313-I" value={filtros.codigo} onChange={setFiltro('codigo')} />
          </label>
          <label className="campo" style={{ flex: '0 1 120px' }}>
            <span>OT (4 digitos)</span>
            <input
              type="text"
              placeholder="ej. 7887"
              maxLength={4}
              value={filtros.ot}
              onChange={(e) => setFiltros({ ...filtros, ot: e.target.value.replace(/\D/g, '') })}
            />
          </label>
          <label className="campo" style={{ flex: '0 1 130px' }}>
            <span>Folio interno</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="ej. 79"
              value={filtros.folioInterno}
              onChange={setFiltro('folioInterno')}
            />
          </label>
          {hayFiltros && (
            <button
              className="btn-secundario"
              style={{ alignSelf: 'flex-end', marginBottom: 8 }}
              onClick={() => setFiltros({ maquila: '', folio: '', codigo: '', ot: '', folioInterno: '' })}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {!datos.rangoValido && (
          <div className="alerta-error" style={{ marginTop: 8 }}>
            Elige las dos fechas; la fecha final no puede ser anterior a la inicial.
          </div>
        )}
        {datos.error && <div className="alerta-error" style={{ marginTop: 8 }}>{datos.error}</div>}
        {errorLocal && <div className="alerta-error" style={{ marginTop: 8 }}>{errorLocal}</div>}
        {aviso && <div className="alerta-exito" style={{ marginTop: 8 }}>{aviso}</div>}
        {datos.cargando && <p className="texto-suave">Consultando...</p>}
      </div>

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>
          Resumen del periodo {etiquetaRango}
          {hayFiltros ? ' (filtrado)' : ''}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, margin: '10px 0 4px' }}>
          <div>
            <div className="texto-suave" style={{ fontSize: 13 }}>Documentos (PDF)</div>
            <strong style={{ fontSize: 24 }}>{totales.documentos}</strong>
          </div>
          <div>
            <div className="texto-suave" style={{ fontSize: 13 }}>Folios</div>
            <strong style={{ fontSize: 24 }}>{totales.folios}</strong>
          </div>
          <div>
            <div className="texto-suave" style={{ fontSize: 13 }}>Docenas</div>
            <strong style={{ fontSize: 24 }}>{totales.docenas.toFixed(2)}</strong>
          </div>
          <div>
            <div className="texto-suave" style={{ fontSize: 13 }}>Peso total</div>
            <strong style={{ fontSize: 24 }}>{(totales.pesoGramos / 1000).toFixed(2)} kg</strong>
          </div>
          <button
            className="btn-secundario"
            style={{ alignSelf: 'center' }}
            onClick={onExportar}
            disabled={exportando || pdfsFiltrados.length === 0}
          >
            {exportando ? 'Exportando...' : 'Exportar a Excel'}
          </button>
        </div>
        {datos.pdfsParcial && (
          <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginTop: 8 }}>
            Resultados PARCIALES (se trajeron {datos.pdfs.length} documentos): usa &quot;Cargar mas&quot;
            abajo para completar el periodo antes de tomar los totales como definitivos.
          </div>
        )}

        <h3 style={{ marginTop: 16 }}>Por maquila</h3>
        <table className="tabla-datos">
          <thead>
            <tr>
              <th>Maquila</th>
              <th>Documentos</th>
              <th>Folios</th>
              <th>Docenas</th>
              <th>Peso (kg)</th>
            </tr>
          </thead>
          <tbody>
            {resumenMaquilas.map((m) => (
              <tr key={m.maquila}>
                <td>{m.maquila}</td>
                <td>{m.documentos}</td>
                <td>{m.folios}</td>
                <td>{m.docenas.toFixed(2)}</td>
                <td>{(m.pesoGramos / 1000).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {resumenMaquilas.length === 0 && !datos.cargando && (
          <p className="texto-suave">Sin salidas en este periodo con esos filtros.</p>
        )}

        {resumenDias.length > 1 && (
          <>
            <h3 style={{ marginTop: 16 }}>Por dia</h3>
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Documentos</th>
                  <th>Folios</th>
                  <th>Peso (kg)</th>
                </tr>
              </thead>
              <tbody>
                {resumenDias.map((d) => (
                  <tr key={d.dia}>
                    <td>{d.dia}</td>
                    <td>{d.documentos}</td>
                    <td>{d.folios}</td>
                    <td>{(d.pesoGramos / 1000).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="tarjeta">
        <h2>Documentos emitidos ({pdfsFiltrados.length})</h2>
        <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
          {[
            ['documentos', 'Por documento'],
            ['codigo', 'Por codigo'],
            ['peps', 'PEPS (mas viejo primero)']
          ].map(([clave, texto]) => (
            <button
              key={clave}
              className={vista === clave ? 'btn-primario' : 'btn-secundario'}
              onClick={() => setVista(clave)}
            >
              {texto}
            </button>
          ))}
        </div>
        {vista === 'documentos' && (
        <>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Abre un documento para ver sus folios; &quot;Reimprimir original&quot; reproduce el papel tal
          como se emitio, aunque las capturas hayan cambiado despues.
        </p>
        <table className="tabla-datos">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Folio interno</th>
              <th>Maquila</th>
              <th>Genero</th>
              <th>Folios</th>
              <th>Peso (kg)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pdfsFiltrados.map((p) => (
              <tr key={p.id}>
                <td>{formatearFechaHora(p.creadoEn)}</td>
                <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {p.encabezado?.folioInterno != null && p.encabezado.folioInterno !== ''
                    ? p.encabezado.folioInterno
                    : '-'}
                </td>
                <td>{p.maquila?.nombre || '-'}</td>
                <td>{p.generadoPor}</td>
                <td>
                  <button
                    className="btn-secundario"
                    onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                  >
                    {p.totalFolios} folios {abierto === p.id ? '▾' : '▸'}
                  </button>
                  {abierto === p.id && (
                    <div className="texto-suave" style={{ fontSize: 12, marginTop: 4, maxWidth: 380 }}>
                      {[...(p.folios || [])]
                        .sort((a, b) => compararAscendente(a, b))
                        .join(', ')}
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
        </>
        )}

        {vista === 'codigo' && (
          <>
            <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
              Todo lo salido en el rango, agrupado por codigo: cuantas docenas y kilos se
              fueron de cada uno, y con que folios.
            </p>
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Producto</th>
                  <th>Folios</th>
                  <th>Docenas</th>
                  <th>Peso (kg)</th>
                </tr>
              </thead>
              <tbody>
                {porCodigo.map((g) => (
                  <tr key={g.codigo}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{g.codigo}</td>
                    <td>{g.descripcion || '-'}</td>
                    <td>
                      <button
                        className="btn-secundario"
                        onClick={() => setAbierto(abierto === `cod:${g.codigo}` ? null : `cod:${g.codigo}`)}
                      >
                        {g.folios.length} folio{g.folios.length === 1 ? '' : 's'}{' '}
                        {abierto === `cod:${g.codigo}` ? '▾' : '▸'}
                      </button>
                      {abierto === `cod:${g.codigo}` && (
                        <div className="texto-suave" style={{ fontSize: 12, marginTop: 4, maxWidth: 420 }}>
                          {g.folios.join(', ')}
                        </div>
                      )}
                    </td>
                    <td>{g.docenas ? Math.round(g.docenas * 100) / 100 : '-'}</td>
                    <td>{(g.pesoGramos / 1000).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {vista === 'peps' && (
          <>
            <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
              Folio por folio, ordenados por su fecha de captura (el mas viejo primero):
              primeras entradas, primeras salidas.
            </p>
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Capturado</th>
                  <th>Folio</th>
                  <th>Codigo</th>
                  <th>Producto</th>
                  <th>Docenas</th>
                  <th>Peso (kg)</th>
                  <th>Salio en</th>
                </tr>
              </thead>
              <tbody>
                {filasPeps.map((f) => (
                  <tr key={`${f.folioInterno}:${f.folio}`}>
                    <td style={{ whiteSpace: 'nowrap' }} title={f.fechaAproximada ? 'PDF de antes del cambio: se usa la fecha del documento' : undefined}>
                      {f.capturadoEn
                        ? `${f.capturadoEn.toLocaleDateString('es-MX')} ${f.capturadoEn.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}${f.fechaAproximada ? ' ~' : ''}`
                        : '-'}
                    </td>
                    <td style={{ fontWeight: 700 }}>{f.folio}</td>
                    <td>{f.codigo}</td>
                    <td>{f.descripcion || '-'}</td>
                    <td>{f.docenas || '-'}</td>
                    <td>{(f.pesoGramos / 1000).toFixed(2)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      folio interno {f.folioInterno} · {f.maquila}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {pdfsFiltrados.length === 0 && !datos.cargando && (
          <p className="texto-suave">
            {hayFiltros && datos.pdfs.length > 0
              ? 'Ningun documento del periodo coincide con los filtros.'
              : datos.pdfsParcial
                ? 'Sin documentos en la parte ya cargada del periodo: usa "Cargar mas" antes de concluir que no hay.'
                : 'Sin documentos emitidos en este periodo.'}
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
      </div>
    </>
  )
}
