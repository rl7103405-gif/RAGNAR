// EDITAR UN TECH PACK DE LA PLANTILLA TP-QUINI DENTRO DE RAGNAR.
//
// Roberto, 2026-09-11: "poder editar todos los datos, cambiar una foto,
// corregir la OT, la OC... dale canita". Como todo tech pack en la plantilla
// sale del generador, se puede editar en pantalla y VOLVER A ARMAR el Excel
// con generarPlantillaTechPack sin perder nada: se lee por nombres
// (leerPlantilla), se edita aqui, y al guardar se sube como version nueva
// (guardarEnBiblioteca, la misma ruta que "Reemplazar"). El archivo anterior
// queda en el historial de versiones.
//
// Las fotos se conservan como bytes (de libro.model.media) y se pueden quitar
// o agregar (PNG/JPG). Los textos "sin acomodar" de la migracion se conservan.
import { useEffect, useState } from 'react'
import { LISTAS, ZONAS_FOTO } from '../utils/plantillaTechPack'
import { descargarDeBiblioteca, ErrorBiblioteca, guardarEnBiblioteca } from '../utils/techPacks'
import { cargarWorkbook, ErrorLibreriaExcel } from '../utils/excelJs'
import { esPlantilla, leerPlantilla } from '../utils/leerPlantillaTechPack'
import { generarPlantillaTechPack } from '../utils/generarPlantillaTechPack'
import { nombreDeArchivo } from '../utils/plantillaTechPack'

const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const RENGLON = { talla: '', ot: '', codigo: '', claveMicrosip: '', descripcion: '', upc: '', docenas: '' }
const AVIO = { clave: '', descripcion: '', usa: '', comoSeUsa: '', talla: 'TODAS', imagen: null }
const ZONAS = ['FOTO_REFERENCIA', 'FOTO_INDIVIDUAL', 'FOTO_BOLSA', 'FOTO_CAJA']
const PANTALLAS = [[1, 'Pedido'], [2, 'Códigos y ruta'], [3, 'Avíos'], [4, 'Empaque individual'], [5, 'Packs en bolsa'], [6, 'Caja']]

const aFechaInput = (v) => {
  const d = v instanceof Date ? v : lleno(v) ? new Date(v) : null
  return d && !isNaN(d) ? d.toISOString().slice(0, 10) : ''
}
const liberar = (im) => { if (im?.url) { URL.revokeObjectURL(im.url); im.url = null } }
const urlDe = (im) => (im?.url ? im.url : im?.bytes ? (im.url = URL.createObjectURL(new Blob([im.bytes], { type: `image/${im.extension === 'jpg' ? 'jpeg' : im.extension}` }))) : null)

async function archivoAImagen(file) {
  if (!file) return null
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const extension = ext === 'jpg' ? 'jpeg' : ext
  if (!['png', 'jpeg', 'gif'].includes(extension)) throw new ErrorBiblioteca('La foto tiene que ser PNG o JPG.')
  if (file.size > 4 * 1024 * 1024) throw new ErrorBiblioteca('La foto pesa mas de 4 MB: reducela antes.')
  return { bytes: new Uint8Array(await file.arrayBuffer()), extension }
}

function Campo({ etiqueta, valor, onChange, tipo = 'text', lista, ancho }) {
  return (
    <label className="tp-campo" style={ancho ? { gridColumn: `span ${ancho}` } : undefined}>
      <span>{etiqueta}</span>
      {lista ? (
        <select className="tp-input" value={valor ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {[...new Set([...(lleno(valor) && !lista.includes(valor) ? [valor] : []), ...lista])].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      ) : (
        <input className="tp-input" type={tipo} value={valor ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  )
}

function Fotos({ lista, onCambiar, titulo }) {
  const [error, setError] = useState('')
  return (
    <div className="tp-campo">
      <span>{titulo}</span>
      <div className="tpe-fotos">
        {lista.map((im, i) => (
          <div key={i} className="tpe-foto">
            <img src={urlDe(im)} alt="" />
            <button type="button" className="tp-quitar" onClick={() => { liberar(im); onCambiar(lista.filter((_, j) => j !== i)) }}>quitar</button>
          </div>
        ))}
        <label className="btn-secundario tp-btn-chico" style={{ cursor: 'pointer', alignSelf: 'center' }}>
          + Agregar foto
          <input type="file" accept="image/png,image/jpeg,image/gif" style={{ display: 'none' }} onChange={async (e) => { setError(''); try { const im = await archivoAImagen(e.target.files[0]); if (im) onCambiar([...lista, im]) } catch (err) { setError(err.message) } e.target.value = '' }} />
        </label>
      </div>
      {error && <small className="alerta-error">{error}</small>}
    </div>
  )
}

export default function EditorPlantillaTechPack({ item, usuario, esPrueba, onCerrar, onGuardado }) {
  const [estado, setEstado] = useState('cargando')
  const [mensaje, setMensaje] = useState('Bajando el tech pack...')
  const [d, setD] = useState(null)
  const [pantalla, setPantalla] = useState(1)
  const [guardando, setGuardando] = useState(false)
  const [progreso, setProgreso] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const buffer = await descargarDeBiblioteca({ codigo: item.codigo, tipo: 'tp', manifiesto: item.techPack })
        const Workbook = await cargarWorkbook()
        const libro = new Workbook()
        await libro.xlsx.load(buffer)
        if (!vivo) return
        if (!esPlantilla(libro)) throw new ErrorBiblioteca('Este tech pack no esta en la plantilla TP-Quini: se edita en Excel y se sube con "Reemplazar".')
        const l = leerPlantilla(libro)
        const media = (id) => { const m = libro.model.media?.[id] || libro.getImage?.(id); return m?.buffer ? { bytes: new Uint8Array(m.buffer), extension: String(m.extension || 'png').toLowerCase() === 'jpg' ? 'jpeg' : String(m.extension || 'png').toLowerCase() } : null }
        const c = l.campos || {}
        const t = l.tablas || {}
        const pedido = (t.TP_TABLA_PEDIDO || []).map((r, i) => ({ ...RENGLON, ...r, i })).filter((r) => lleno(r.codigo) || lleno(r.ot) || lleno(r.claveMicrosip) || lleno(r.descripcion))
        const codigos = t.TP_TABLA_CODIGOS || []
        setD({
          modelo: c.TP_MODELO || '', oc: c.TP_OC || '', cliente: c.TP_CLIENTE || '', marca: c.TP_MARCA || '', elaboro: c.TP_ELABORO || '',
          prenda: c.TP_PRENDA || '', tejido: c.TP_TEJIDO || '', sistemaTalla: c.TP_SISTEMA_TALLA || '', variante: c.TP_VARIANTE || '',
          fecha: aFechaInput(c.TP_FECHA), paresPorPack: c.TP_PACK ?? '', packs: c.TP_PACKS ?? '',
          renglones: pedido.map(({ i, ...r }) => ({ ...r, docenas: r.docenas ?? '' })),
          codigosRuta: pedido.map((r) => ({ colorCuerpo: codigos[r.i]?.colorCuerpo || '', bordado: codigos[r.i]?.bordado || '', hilo: codigos[r.i]?.hilo || '' })),
          ruta: Object.values((t.TP_RUTA || [])[0] || {}).filter(lleno),
          avios: (t.TP_TABLA_AVIOS || []).map((r, i) => ({ ...AVIO, ...r, usa: r.usa ?? '', talla: r.talla || 'TODAS', imagen: media(l.imagenesAvios?.[i]) })).filter((r) => lleno(r.clave) || lleno(r.descripcion)),
          textos: { individual: c.TP_INDIVIDUAL_TEXTO || '', bolsa: c.TP_BOLSA_TEXTO || '', caja: c.TP_CAJA_TEXTO || '' },
          packsPorBolsa: c.TP_PACKS_POR_BOLSA ?? '', docenasPorCaja: c.TP_DOCENAS_POR_CAJA ?? '',
          fotos: Object.fromEntries(ZONAS.map((z) => [z, (l.imagenesZona?.[z] || []).map((im) => media(im.imageId)).filter(Boolean)])),
          sobrantes: l.noMigrado || []
        })
        setEstado('listo')
      } catch (err) {
        console.error('[EditorPlantilla]', err)
        if (!vivo) return
        setEstado('error')
        setMensaje(err instanceof ErrorBiblioteca || err instanceof ErrorLibreriaExcel ? err.message : 'No se pudo abrir: ' + (err?.message || err))
      }
    })()
    return () => { vivo = false }
  }, [item.codigo, item.techPack?.sha256])

  // Al cerrar se liberan todos los blob: URLs de las fotos.
  useEffect(() => () => {
    if (!d) return
    for (const l of Object.values(d.fotos || {})) for (const im of l) liberar(im)
    for (const a of d.avios || []) liberar(a.imagen)
  }, [d])

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }))
  const setRenglon = (i, k, v) => setD((x) => ({ ...x, renglones: x.renglones.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
  const setCodigo = (i, k, v) => setD((x) => ({ ...x, codigosRuta: x.codigosRuta.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
  const setAvio = (i, k, v) => setD((x) => ({ ...x, avios: x.avios.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))

  const guardar = async () => {
    setError('')
    if (!lleno(d.modelo)) { setError('El modelo no puede quedar vacio.'); return }
    if (!window.confirm(`¿Guardar los cambios de ${item.codigo}? Se arma el Excel de nuevo y sube como version ${(item.techPack?.version || 1) + 1}.`)) return
    setGuardando(true)
    try {
      const Workbook = await cargarWorkbook()
      const { LOGO_QUINI_PNG_BASE64 } = await import('../assets/logoQuini.js')
      const num = (v) => (lleno(v) && Number.isFinite(Number(v)) ? Number(v) : undefined)
      const libro = generarPlantillaTechPack({
        Workbook,
        logoBase64: LOGO_QUINI_PNG_BASE64,
        datos: {
          ...d,
          ot: d.renglones.find((r) => lleno(r.ot))?.ot || '',
          fecha: d.fecha ? new Date(d.fecha + 'T12:00:00') : undefined,
          paresPorPack: num(d.paresPorPack), packs: num(d.packs), packsPorBolsa: num(d.packsPorBolsa), docenasPorCaja: num(d.docenasPorCaja),
          renglones: d.renglones.map((r) => ({ ...r, docenas: num(r.docenas) ?? '' })),
          avios: d.avios.map((a) => ({ ...a, usa: num(a.usa) ?? null })),
          generadoPorUid: usuario.uid, generadoPorNombre: usuario.nombre
        }
      })
      const contenido = await libro.xlsx.writeBuffer()
      await guardarEnBiblioteca({ codigo: item.codigo, tipo: 'tp', contenido, nombre: nombreDeArchivo(item.codigo), formato: 'xlsx', usuario, esPrueba, onProgreso: setProgreso })
      onGuardado(`Tech pack de ${item.codigo} guardado (version ${(item.techPack?.version || 1) + 1}). La calificacion se actualiza en la siguiente medicion.`)
    } catch (err) {
      console.error('[EditorPlantilla] guardar', err)
      setError(err instanceof ErrorBiblioteca ? err.message : 'No se pudo guardar: ' + (err?.message || err))
    } finally {
      setProgreso('')
      setGuardando(false)
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal tp-modal-editar tpe" onClick={(e) => e.stopPropagation()}>
        <div className="tp-fila" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Editar el contenido de <span className="tp-codigo">{item.codigo}</span></h3>
          <button className="btn-secundario tp-btn-chico" onClick={onCerrar} disabled={guardando}>Cerrar</button>
        </div>
        {estado === 'cargando' && <p className="texto-suave">{mensaje}</p>}
        {estado === 'error' && <div className="alerta-error">{mensaje}</div>}
        {estado === 'listo' && d && (
          <>
            <fieldset disabled={guardando} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
            <div className="tpv-pestanas">
              {PANTALLAS.map(([n, tit]) => (
                <button key={n} type="button" className={`tpv-pestana ${pantalla === n ? 'activa' : ''}`} onClick={() => setPantalla(n)}><span className="tpv-num">{n}</span> {tit}</button>
              ))}
            </div>

            {pantalla === 1 && (
              <>
                <div className="tpe-grid">
                  <Campo etiqueta="Modelo" valor={d.modelo} onChange={(v) => set('modelo', v)} />
                  <Campo etiqueta="Orden de compra" valor={d.oc} onChange={(v) => set('oc', v)} />
                  <Campo etiqueta="Cliente" valor={d.cliente} onChange={(v) => set('cliente', v)} />
                  <Campo etiqueta="Marca" valor={d.marca} onChange={(v) => set('marca', v)} />
                  <Campo etiqueta="Prenda" valor={d.prenda} onChange={(v) => set('prenda', v)} />
                  <Campo etiqueta="Tejido" valor={d.tejido} onChange={(v) => set('tejido', v)} lista={LISTAS.tejido} />
                  <Campo etiqueta="Sistema de talla" valor={d.sistemaTalla} onChange={(v) => set('sistemaTalla', v)} lista={LISTAS.sistemaTalla} />
                  <Campo etiqueta="Variante / color" valor={d.variante} onChange={(v) => set('variante', v)} />
                  <Campo etiqueta="Fecha" valor={d.fecha} onChange={(v) => set('fecha', v)} tipo="date" />
                  <Campo etiqueta="Elaboró" valor={d.elaboro} onChange={(v) => set('elaboro', v)} />
                  <Campo etiqueta="Pares por pack" valor={d.paresPorPack} onChange={(v) => set('paresPorPack', v)} tipo="number" />
                  <Campo etiqueta="Packs del pedido" valor={d.packs} onChange={(v) => set('packs', v)} tipo="number" />
                </div>
                <div className="tp-campo">
                  <span>Códigos del pedido</span>
                  <div className="tabla-marco">
                    <table className="tpe-tabla">
                      <thead><tr><th>Talla</th><th>OT</th><th>Código</th><th>Clave Microsip</th><th>Descripción</th><th>UPC</th><th>Docenas</th><th></th></tr></thead>
                      <tbody>
                        {d.renglones.map((r, i) => (
                          <tr key={i}>
                            {['talla', 'ot', 'codigo', 'claveMicrosip', 'descripcion', 'upc', 'docenas'].map((k) => (
                              <td key={k}><input className="tp-input tpe-in" type={k === 'docenas' ? 'number' : 'text'} value={r[k] ?? ''} onChange={(e) => setRenglon(i, k, e.target.value)} /></td>
                            ))}
                            <td><button type="button" className="tp-quitar" onClick={() => setD((x) => ({ ...x, renglones: x.renglones.filter((_, j) => j !== i), codigosRuta: x.codigosRuta.filter((_, j) => j !== i) }))}>quitar</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" className="btn-secundario tp-btn-chico" style={{ alignSelf: 'flex-start' }} onClick={() => setD((x) => ({ ...x, renglones: [...x.renglones, { ...RENGLON, ot: x.renglones[0]?.ot || '', talla: x.renglones[0]?.talla || '' }], codigosRuta: [...x.codigosRuta, { colorCuerpo: '', bordado: '', hilo: '' }] }))}>+ Agregar código</button>
                </div>
                <Fotos titulo="Foto de referencia" lista={d.fotos.FOTO_REFERENCIA} onCambiar={(l) => set('fotos', { ...d.fotos, FOTO_REFERENCIA: l })} />
              </>
            )}

            {pantalla === 2 && (
              <>
                <div className="tp-campo">
                  <span>Color, bordado e hilo de cada código</span>
                  <div className="tabla-marco">
                    <table className="tpe-tabla">
                      <thead><tr><th>Código</th><th>Talla</th><th>Color / cuerpo</th><th>Bordado</th><th>Hilo / lechuga</th></tr></thead>
                      <tbody>
                        {d.renglones.map((r, i) => (
                          <tr key={i}>
                            <td><strong>{r.codigo || <span className="tpv-vacio">sin código</span>}</strong></td>
                            <td>{r.talla}</td>
                            {['colorCuerpo', 'bordado', 'hilo'].map((k) => <td key={k}><input className="tp-input tpe-in" value={d.codigosRuta[i]?.[k] ?? ''} onChange={(e) => setCodigo(i, k, e.target.value)} /></td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <small className="texto-suave">Los códigos se agregan o quitan en la pantalla 1.</small>
                </div>
                <div className="tp-campo">
                  <span>Ruta de proceso (hasta 7 pasos)</span>
                  <div className="tpe-grid">
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                      <select key={i} className="tp-input" value={d.ruta[i] || ''} onChange={(e) => { const r = [...d.ruta]; r[i] = e.target.value; set('ruta', r.filter((x, j) => lleno(x) || j < r.length - 1).slice(0, 7)) }}>
                        <option value="">{i + 1}. —</option>
                        {LISTAS.procesos.map((p) => <option key={p} value={p}>{i + 1}. {p}</option>)}
                      </select>
                    ))}
                  </div>
                </div>
              </>
            )}

            {pantalla === 3 && (
              <div className="tp-campo">
                <span>Avíos (USA = cuántos lleva cada pack; ENVIAR se calcula solo)</span>
                <div className="tabla-marco">
                  <table className="tpe-tabla">
                    <thead><tr><th>Foto</th><th>Clave</th><th>Descripción</th><th>Usa por pack</th><th>Cómo se usa</th><th>Talla</th><th></th></tr></thead>
                    <tbody>
                      {d.avios.map((a, i) => (
                        <tr key={i}>
                          <td className="tpe-mini">
                            {a.imagen ? <img src={urlDe(a.imagen)} alt="" /> : null}
                            <label className="tp-desplegar" style={{ fontSize: 11, cursor: 'pointer' }}>{a.imagen ? 'cambiar' : '+ foto'}<input type="file" accept="image/png,image/jpeg,image/gif" style={{ display: 'none' }} onChange={async (e) => { try { const im = await archivoAImagen(e.target.files[0]); if (im) { liberar(a.imagen); setAvio(i, 'imagen', im) } } catch (err) { setError(err.message) } e.target.value = '' }} /></label>
                          </td>
                          <td><input className="tp-input tpe-in" value={a.clave} onChange={(e) => setAvio(i, 'clave', e.target.value.toUpperCase())} /></td>
                          <td><input className="tp-input tpe-in" value={a.descripcion} onChange={(e) => setAvio(i, 'descripcion', e.target.value)} /></td>
                          <td><input className="tp-input tpe-in" type="number" step="any" min="0" value={a.usa} onChange={(e) => setAvio(i, 'usa', e.target.value)} /></td>
                          <td><input className="tp-input tpe-in" value={a.comoSeUsa} onChange={(e) => setAvio(i, 'comoSeUsa', e.target.value)} /></td>
                          <td><select className="tp-input tpe-in" value={a.talla} onChange={(e) => setAvio(i, 'talla', e.target.value)}>{[...new Set([a.talla, ...LISTAS.tallaAvio])].filter(lleno).map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                          <td><button type="button" className="tp-quitar" onClick={() => { liberar(a.imagen); set('avios', d.avios.filter((_, j) => j !== i)) }}>quitar</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn-secundario tp-btn-chico" style={{ alignSelf: 'flex-start' }} onClick={() => set('avios', [...d.avios, { ...AVIO }])}>+ Agregar avío</button>
              </div>
            )}

            {pantalla === 4 && (
              <>
                <label className="tp-campo"><span>Cómo se arma el par</span><textarea className="tp-input" rows={3} value={d.textos.individual} onChange={(e) => set('textos', { ...d.textos, individual: e.target.value })} /></label>
                <Fotos titulo="Fotos de cómo se arma el par" lista={d.fotos.FOTO_INDIVIDUAL} onCambiar={(l) => set('fotos', { ...d.fotos, FOTO_INDIVIDUAL: l })} />
              </>
            )}
            {pantalla === 5 && (
              <>
                <div className="tpe-grid"><Campo etiqueta="Packs por bolsa" valor={d.packsPorBolsa} onChange={(v) => set('packsPorBolsa', v)} tipo="number" /></div>
                <label className="tp-campo"><span>Cómo se acomodan en la bolsa</span><textarea className="tp-input" rows={3} value={d.textos.bolsa} onChange={(e) => set('textos', { ...d.textos, bolsa: e.target.value })} /></label>
                <Fotos titulo="Fotos de la bolsa" lista={d.fotos.FOTO_BOLSA} onCambiar={(l) => set('fotos', { ...d.fotos, FOTO_BOLSA: l })} />
              </>
            )}
            {pantalla === 6 && (
              <>
                <div className="tpe-grid"><Campo etiqueta="Docenas por caja o bulto" valor={d.docenasPorCaja} onChange={(v) => set('docenasPorCaja', v)} tipo="number" /></div>
                <label className="tp-campo"><span>Cómo se acomoda en la caja</span><textarea className="tp-input" rows={3} value={d.textos.caja} onChange={(e) => set('textos', { ...d.textos, caja: e.target.value })} /></label>
                <Fotos titulo="Fotos de la caja" lista={d.fotos.FOTO_CAJA} onCambiar={(l) => set('fotos', { ...d.fotos, FOTO_CAJA: l })} />
              </>
            )}

            {d.sobrantes.length > 0 && (
              <details className="tpv-sobrantes">
                <summary>Datos del archivo anterior sin acomodar ({d.sobrantes.length}): cópialos donde van y quítalos</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {d.sobrantes.map((x, i) => <li key={i}>{x.texto} <span className="texto-suave">({x.hoja} {x.celda})</span> <button type="button" className="tp-quitar" onClick={() => set('sobrantes', d.sobrantes.filter((_, j) => j !== i))}>quitar</button></li>)}
                </ul>
              </details>
            )}

            </fieldset>
            {error && <p className="alerta-error">{error}</p>}
            {progreso && <p className="texto-suave">{progreso}</p>}
            <div className="tp-fila" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn-secundario" onClick={onCerrar} disabled={guardando}>Cancelar</button>
              <button className="btn-primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar y subir como versión nueva'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
