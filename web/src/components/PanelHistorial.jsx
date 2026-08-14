// Pestana Historial: capturas y PDFs generados del periodo elegido.
//  - Capturas: estado ACTUAL de bultos (una captura eliminada ya no aparece;
//    una editada muestra su peso vigente).
//  - PDFs generados: bitacora INMUTABLE con quien lo genero, maquila, folios
//    y el contenido congelado -- "Reimprimir original" reproduce exactamente
//    el papel emitido aunque las capturas hayan cambiado despues.
import { Fragment, useMemo, useState } from 'react'
import { useDatosPeriodo } from '../hooks/useDatosPeriodo'
import FiltroPeriodo from './FiltroPeriodo'
import { compararAscendente, coincide } from '../utils/texto'
import { reimprimirRegistro, ErrorReimpresion, docenasDeCaptura } from '../utils/reimprimir'
import { agruparPorOt, etiquetaOt } from '../utils/agruparOt'
import { useMaquilas } from './Maquilas'
import { useAuth } from '../context/AuthContext'
import CorregirPdfModal from './CorregirPdfModal'

export default function PanelHistorial() {
  // Corregir una remision es operacion de embarque: un rol de consulta
  // (Cielo) no debe ver el boton, porque las reglas se lo niegan.
  const { puedeEmbarcar } = useAuth()
  const [tipo, setTipo] = useState('dia')
  const [offset, setOffset] = useState(0)
  const [pdfAbierto, setPdfAbierto] = useState(null)
  // Registro de pdfsGenerados que se esta corrigiendo (anular y reemitir).
  const [corrigiendo, setCorrigiendo] = useState(null)
  const [aviso, setAviso] = useState('')
  const [errorLocal, setErrorLocal] = useState('')
  const [busqueda, setBusqueda] = useState({ folio: '', producto: '', capturo: '' })
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

  const hayBusqueda = busqueda.folio || busqueda.producto || busqueda.capturo
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
          (!busqueda.capturo || coincide(c.operadorNombre, busqueda.capturo))
      ),
    [datos.capturas, busqueda]
  )
  const gruposCapturas = useMemo(() => agruparPorOt(capturasFiltradas), [capturasFiltradas])

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

  return (
    <>
      <FiltroPeriodo
        tipo={tipo}
        setTipo={setTipo}
        offset={offset}
        setOffset={setOffset}
        etiqueta={datos.rango.etiqueta}
      />

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
          Capturas ({capturasFiltradas.length}
          {hayBusqueda ? ` de ${datos.capturas.length}` : ''}
          {datos.capturasParcial ? '+' : ''}) - {totalDocenas} docenas - {totalKg.toFixed(2)} kg
          <span style={{ fontWeight: 400, fontSize: 14, marginLeft: 10 }}>
            <span style={{ color: '#1a7a3a' }}>{enPdf}{datos.capturasParcial ? '+' : ''} en PDF</span>
            {' · '}
            <span style={{ color: sinPdf > 0 ? '#8a5300' : '#556' }}>
              {sinPdf}{datos.capturasParcial ? '+' : ''} sin mandar
            </span>
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
              {gruposCapturas.map((grupo) => {
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
                      <div className="texto-suave" style={{ fontSize: 12, marginTop: 4, maxWidth: 380 }}>
                        {[...(p.folios || [])]
                          .sort((a, b) => compararAscendente(a, b))
                          .join(', ')}
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
