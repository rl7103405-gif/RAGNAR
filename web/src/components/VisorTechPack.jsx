// VISOR del tech pack: lo muestra EN PANTALLA, sin boton de descarga.
//
// El candado es de friccion, no criptografico (quien ve una pantalla puede
// fotografiarla; Roberto esta avisado): lo que si garantiza es que la app
// nunca le entrega el archivo a la maquila como archivo, y que al cerrar la
// tarea el contenido deja de existir.
//
// Dos formatos:
//   - PDF: se renderiza FIEL, pagina por pagina, con pdfjs (import dinamico:
//     no pesa en el bundle de quien nunca abre un tech pack).
//   - XLSX: se muestra una EXTRACCION (tablas de celdas + las fotos de cada
//     hoja debajo). NO es una copia fiel del Excel -- celdas combinadas,
//     posiciones de imagen y formatos se pierden -- y el visor lo advierte.
//     Por eso la UI de subida recomienda PDF.
import { cargarWorkbook } from '../utils/excelJs.js'
import { useEffect, useRef, useState } from 'react'
import { descargarTechPack, ErrorTareaEnsamble } from '../utils/tareasEnsamble'
import { ErrorBiblioteca } from '../utils/techPacks'

// Topes del render de XLSX: un Excel chico puede descomprimirse enorme y
// congelar la pestana. Lo que pase del tope se avisa, no se truena.
const MAX_FILAS_POR_HOJA = 400
const MAX_COLS = 40
const MAX_IMAGENES_POR_HOJA = 30

function celdaATexto(valor) {
  if (valor == null) return ''
  if (typeof valor === 'object') {
    if (valor.richText) return valor.richText.map((r) => r.text).join('')
    if (valor.text) return String(valor.text)
    if (valor.result != null) return celdaATexto(valor.result)
    if (valor instanceof Date) return valor.toLocaleDateString('es-MX')
    if (valor.error) return String(valor.error)
    return ''
  }
  return String(valor)
}

// `cargar` (opcional): quien tenga el archivo en otro lado (la biblioteca de
// tech packs) pasa su propia funcion que devuelve el ArrayBuffer ya validado.
export default function VisorTechPack({ maquilaId, tareaId, techPack, onCerrar, cargar }) {
  const [estado, setEstado] = useState('cargando') // cargando | listo | error
  const [mensaje, setMensaje] = useState('Bajando el tech pack...')
  const [hojas, setHojas] = useState([]) // xlsx: [{nombre, filas, imagenes, recortada}]
  const [hojaActiva, setHojaActiva] = useState(0)
  const [paginasPdf, setPaginasPdf] = useState(0)
  const contenedorPdf = useRef(null)
  // Los blob: URLs de las imagenes se liberan al desmontar.
  const urlsCreadas = useRef([])
  // pdfjs levanta un WORKER por documento: si no se destruye, cada tech pack
  // abierto en la sesion deja un worker y sus paginas decodificadas vivos.
  const documentoPdf = useRef(null)

  useEffect(() => {
    let cancelado = false
    // OJO: no se llama 'cargar' porque ese es el PROP (la biblioteca pasa su
    // propio lector); con el mismo nombre la funcion se llamaba a si misma.
    const cargarArchivo = async () => {
      try {
        setEstado('cargando')
        setMensaje('Bajando el tech pack...')
        const buffer = cargar ? await cargar() : await descargarTechPack({ maquilaId, tareaId, techPack })
        if (cancelado) return
        if (techPack.formato === 'pdf') {
          await renderPdf(buffer)
        } else {
          await extraerXlsx(buffer)
        }
        if (!cancelado) setEstado('listo')
      } catch (err) {
        console.error('[VisorTechPack] Error:', err)
        if (cancelado) return
        setEstado('error')
        setMensaje(
          err instanceof ErrorTareaEnsamble || err instanceof ErrorBiblioteca
            ? err.message
            : 'No se pudo abrir el tech pack: ' + (err.message || err)
        )
      }
    }

    const renderPdf = async (buffer) => {
      setMensaje('Preparando el documento...')
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      const documento = await pdfjs.getDocument({ data: buffer }).promise
      documentoPdf.current = documento
      if (cancelado) return
      setPaginasPdf(documento.numPages)
      // Se renderiza pagina por pagina a canvas dentro del contenedor.
      const cont = contenedorPdf.current
      if (!cont) return
      cont.innerHTML = ''
      for (let n = 1; n <= documento.numPages; n++) {
        if (cancelado) return
        setMensaje(`Dibujando pagina ${n} de ${documento.numPages}...`)
        const pagina = await documento.getPage(n)
        const escala = Math.min(1.5, 1100 / pagina.getViewport({ scale: 1 }).width)
        const viewport = pagina.getViewport({ scale: escala })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.maxWidth = '100%'
        canvas.style.display = 'block'
        canvas.style.margin = '0 auto 12px'
        canvas.style.boxShadow = '0 1px 6px rgba(0,0,0,.25)'
        cont.appendChild(canvas)
        await pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      }
    }

    const extraerXlsx = async (buffer) => {
      setMensaje('Leyendo las hojas del Excel...')
      // Ver excelJs.js: si la app se actualizo con la pestaña abierta, el
      // mensaje dice que hay que recargar, no que el tech pack este dañado.
      const Workbook = await cargarWorkbook()
      const libro = new Workbook()
      await libro.xlsx.load(buffer)
      if (cancelado) return
      const resultado = []
      for (const hoja of libro.worksheets) {
        const filas = []
        let recortada = false
        hoja.eachRow({ includeEmpty: false }, (fila, n) => {
          if (n > MAX_FILAS_POR_HOJA) {
            recortada = true
            return
          }
          const celdas = []
          for (let c = 1; c <= Math.min(hoja.columnCount || 1, MAX_COLS); c++) {
            celdas.push(celdaATexto(fila.getCell(c).value))
          }
          // Las filas totalmente vacias no aportan nada en pantalla.
          if (celdas.some((x) => x !== '')) filas.push({ n, celdas })
        })
        // Las fotos de la hoja (acomodo, empaque...): se listan debajo de la
        // tabla con la fila aproximada donde estaban ancladas.
        const imagenes = []
        try {
          for (const img of hoja.getImages().slice(0, MAX_IMAGENES_POR_HOJA)) {
            const media = libro.model.media?.[img.imageId] || libro.getImage?.(img.imageId)
            if (!media?.buffer) continue
            const blob = new Blob([media.buffer], { type: `image/${media.extension || 'png'}` })
            const url = URL.createObjectURL(blob)
            urlsCreadas.current.push(url)
            imagenes.push({ url, fila: Math.round(img.range?.tl?.nativeRow ?? 0) + 1 })
          }
        } catch (e) {
          console.warn('[VisorTechPack] No se pudieron extraer imagenes de', hoja.name, e)
        }
        if (filas.length > 0 || imagenes.length > 0) {
          resultado.push({ nombre: hoja.name, filas, imagenes, recortada })
        }
      }
      setHojas(resultado)
      setHojaActiva(0)
    }

    cargarArchivo()
    return () => {
      cancelado = true
      urlsCreadas.current.forEach((u) => URL.revokeObjectURL(u))
      urlsCreadas.current = []
      // Cierra el worker de pdfjs y libera las paginas: sin esto, abrir varios
      // tech packs en la misma sesion va dejando workers vivos.
      documentoPdf.current?.destroy?.()
      documentoPdf.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maquilaId, tareaId, techPack?.sha256])

  const hoja = hojas[hojaActiva]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,.75)',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        padding: 12
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid #e2e8f0'
          }}
        >
          <strong style={{ fontSize: 15 }}>{techPack?.nombre || 'Tech pack'}</strong>
          <span className="texto-suave" style={{ fontSize: 12 }}>
            Solo lectura en pantalla · no se puede descargar
            {techPack?.formato === 'pdf' && paginasPdf > 0 ? ` · ${paginasPdf} pagina${paginasPdf === 1 ? '' : 's'}` : ''}
          </span>
          <button className="btn-secundario" style={{ marginLeft: 'auto' }} onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        {estado === 'cargando' && (
          <p className="texto-suave" style={{ padding: 20 }}>{mensaje}</p>
        )}
        {estado === 'error' && (
          <div className="alerta-error" style={{ margin: 16 }}>{mensaje}</div>
        )}

        {techPack?.formato === 'pdf' && (
          <div
            ref={contenedorPdf}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              background: '#475569',
              padding: 14,
              display: estado === 'error' ? 'none' : 'block'
            }}
          />
        )}

        {techPack?.formato === 'xlsx' && estado === 'listo' && (
          <>
            <div className="alerta-error" style={{ margin: '10px 14px 0', fontSize: 13 }}>
              Esto es una <strong>extraccion</strong> del Excel, no una copia fiel: las fotos van
              debajo de cada hoja y algunos formatos se pierden. Si algo no se entiende, pide el
              tech pack en PDF.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 14px 0' }}>
              {hojas.map((h, i) => (
                <button
                  key={h.nombre}
                  className={`chip-filtro ${i === hojaActiva ? 'activo' : ''}`}
                  onClick={() => setHojaActiva(i)}
                >
                  {h.nombre}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
              {hoja && (
                <>
                  {hoja.filas.length > 0 && (
                    <table className="tabla-datos" style={{ fontSize: 12 }}>
                      <tbody>
                        {hoja.filas.map((f) => (
                          <tr key={f.n}>
                            {f.celdas.map((c, i) => (
                              <td key={i} style={{ whiteSpace: 'pre-wrap' }}>{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {hoja.recortada && (
                    <p className="texto-suave" style={{ fontSize: 12 }}>
                      La hoja sigue, pero solo se muestran las primeras {MAX_FILAS_POR_HOJA} filas.
                    </p>
                  )}
                  {hoja.imagenes.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <strong style={{ fontSize: 13 }}>Fotos de esta hoja</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                        {hoja.imagenes.map((img, i) => (
                          <figure key={i} style={{ margin: 0, maxWidth: 420 }}>
                            <img
                              src={img.url}
                              alt={`Foto cerca de la fila ${img.fila}`}
                              style={{ maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: 6 }}
                              draggable={false}
                            />
                            <figcaption className="texto-suave" style={{ fontSize: 11 }}>
                              cerca de la fila {img.fila}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
