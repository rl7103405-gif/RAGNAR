// Pestana Historial: capturas y PDFs generados del periodo elegido.
//  - Capturas: estado ACTUAL de bultos (una captura eliminada ya no aparece;
//    una editada muestra su peso vigente).
//  - PDFs generados: bitacora INMUTABLE con quien lo genero, maquila, folios
//    y el contenido congelado -- "Reimprimir original" reproduce exactamente
//    el papel emitido aunque las capturas hayan cambiado despues.
import { useState } from 'react'
import { useDatosPeriodo } from '../hooks/useDatosPeriodo'
import FiltroPeriodo from './FiltroPeriodo'
import { generarPdfSalida, descargarPdf } from '../utils/pdf'
import { generarExcelSalida, descargarArchivo } from '../utils/excelSalida'

export default function PanelHistorial() {
  const [tipo, setTipo] = useState('dia')
  const [offset, setOffset] = useState(0)
  const [pdfAbierto, setPdfAbierto] = useState(null)
  const [aviso, setAviso] = useState('')
  const [errorLocal, setErrorLocal] = useState('')
  const datos = useDatosPeriodo(tipo, offset)

  const totalKg = datos.capturas.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000

  const formatearFechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX')}`
      : '-'

  const onReimprimir = async (registro) => {
    setErrorLocal('')
    setAviso('')
    if (!registro.capturas || registro.capturas.length === 0) {
      setErrorLocal('Este registro no tiene contenido congelado; no se puede reimprimir.')
      return
    }
    if (registro.capturas.some((c) => typeof c.pesoGramos !== 'number')) {
      setErrorLocal('Este registro no tiene contenido congelado; no se puede reimprimir.')
      return
    }
    try {
      // fechaTexto (congelado al generar) reproduce la fecha EXACTA que ya
      // salio impresa en el papel original; solo los registros de antes de
      // ese campo caen al respaldo con creadoEn/hoy.
      const fechaOriginal =
        registro.fechaTexto ||
        (registro.creadoEn?.toDate
          ? registro.creadoEn.toDate().toLocaleDateString('es-MX')
          : new Date().toLocaleDateString('es-MX'))
      const { blob, nombreArchivo } = generarPdfSalida({
        capturas: registro.capturas,
        operador: registro.generadoPor,
        fecha: fechaOriginal,
        encabezado: registro.encabezado || {}
      })
      descargarPdf(blob, nombreArchivo.replace('.pdf', '_copia.pdf'))
      // El Excel de migracion se rehace con el MISMO contenido congelado: si
      // la carga al sistema fallo o se perdio el archivo, se recupera igual
      // al original.
      const excel = await generarExcelSalida({
        capturas: registro.capturas,
        fecha: fechaOriginal
      })
      descargarArchivo(excel.blob, excel.nombreArchivo.replace('.xlsx', '_copia.xlsx'))
      setAviso(
        `Copia del PDF y del Excel de ${registro.generadoPor} (${registro.totalFolios} folios) descargada.`
      )
    } catch (err) {
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
        <h2>
          Capturas ({datos.capturas.length}{datos.capturasParcial ? '+' : ''}) - {totalKg.toFixed(2)} kg
        </h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Estado actual de las capturas: las eliminadas ya no aparecen y las editadas muestran su
          peso vigente.
        </p>
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
              <th>Peso (kg)</th>
              <th>Capturo</th>
              <th>Fecha y hora</th>
            </tr>
          </thead>
          <tbody>
            {datos.capturas.map((c) => (
              <tr key={c.id}>
                <td>{c.folio}</td>
                <td>{c.producto?.codigo || (c.cruce === 'sin_ruteo' ? 'SIN RUTEO' : '-')}</td>
                <td>{c.producto?.descripcion || '-'}</td>
                <td>{(c.pesoGramos / 1000).toFixed(2)}</td>
                <td>{c.operadorNombre || '-'}</td>
                <td>{formatearFechaHora(c.creadoEn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {datos.capturas.length === 0 && !datos.cargando && (
          <p className="texto-suave">Sin capturas en este periodo.</p>
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
      </div>

      <div className="tarjeta">
        <h2>PDFs generados ({datos.pdfs.length}{datos.pdfsParcial ? '+' : ''})</h2>
        <table className="tabla-datos">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Genero</th>
              <th>Maquila</th>
              <th>Folios</th>
              <th>Peso (kg)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {datos.pdfs.map((p) => (
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
                    <div className="texto-suave" style={{ fontSize: 12, marginTop: 4, maxWidth: 380 }}>
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
        {datos.pdfs.length === 0 && !datos.cargando && (
          <p className="texto-suave">Sin PDFs generados en este periodo.</p>
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
