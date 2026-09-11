// VISTA DE UN TECH PACK EN LA PLANTILLA TP-QUINI: compacta, vertical y con
// las fotos en su lugar.
//
// Roberto, 2026-09-11, viendo la plantilla en el visor de tablas: "esta muy
// grande todo... que se vea vertical, poder ver mas cosas al mismo tiempo,
// cuando le pico a la plastiflecha que se me abra la foto, mas interactivo".
// El visor generico (VisorTechPack) sigue sirviendo para los Excel de formato
// libre; para la plantilla se lee por nombres (leerPlantillaTechPack) y se
// pinta asi. La hoja _RAGNAR no se muestra: es del sistema.
import { useState } from 'react'
import { CAMPOS, TABLAS, ZONAS_FOTO } from '../utils/plantillaTechPack'
import { RUBROS_TECH_PACK } from '../utils/completadoTechPack'

const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const fecha = (v) => {
  if (v instanceof Date) return v.toLocaleDateString('es-MX')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '')
}
const numero = (v) => (lleno(v) && Number.isFinite(Number(v)) ? Number(v).toLocaleString('es-MX', { maximumFractionDigits: 4 }) : v)

function Dato({ etiqueta, valor, ancho }) {
  return (
    <div className="tpv-dato" style={ancho ? { gridColumn: `span ${ancho}` } : undefined}>
      <span className="tpv-etq">{etiqueta}</span>
      <span className={`tpv-val ${lleno(valor) ? '' : 'tpv-vacio'}`}>{lleno(valor) ? valor : 'sin dato'}</span>
    </div>
  )
}

function Fotos({ urls, alAbrir, vacio }) {
  if (!urls.length) return <div className="tpv-sinfoto">{vacio}</div>
  return (
    <div className="tpv-fotos">
      {urls.map((u, i) => (
        <button key={u + i} type="button" className="tpv-foto" onClick={() => alAbrir(u)} title="Ver en grande">
          <img src={u} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  )
}

export default function VistaPlantillaTechPack({ lectura, medicion, urlDe }) {
  const [grande, setGrande] = useState(null)
  const c = lectura.campos || {}
  const t = lectura.tablas || {}
  const zona = (n) => (lectura.imagenesZona?.[n] || []).map((im) => urlDe(im.imageId)).filter(Boolean)
  const pedido = (t.TP_TABLA_PEDIDO || []).map((r, i) => ({ ...r, i })).filter((r) => lleno(r.codigo) || lleno(r.ot) || lleno(r.claveMicrosip))
  const codigos = t.TP_TABLA_CODIGOS || []
  const ruta = Object.values((t.TP_RUTA || [])[0] || {}).filter(lleno)
  const avios = (t.TP_TABLA_AVIOS || []).map((r, i) => ({ ...r, i })).filter((r) => lleno(r.clave) || lleno(r.descripcion))
  const packs = Number(c.TP_PACKS) || 0
  const falta = medicion?.detalle || {}
  const seccion = (id) => {
    const f = falta[id] || []
    const r = RUBROS_TECH_PACK.find((x) => x.id === id)
    return (
      <span className={`tpv-estado ${f.length ? 'falta' : 'ok'}`} title={f.length ? f.join(' · ') : 'Completo'}>
        {f.length ? `falta: ${f.join(', ')}` : 'completo'}{r ? '' : ''}
      </span>
    )
  }

  return (
    <div className="tpv">
      {lectura.faltaEstructura?.length > 0 && (
        <div className="alerta-error" style={{ fontSize: 13 }}>
          Plantilla dañada: falta {lectura.faltaEstructura.slice(0, 6).join(', ')}. Se muestra lo que se pudo leer.
        </div>
      )}

      {/* ---------------------------------------------------- 1 PEDIDO */}
      <section className="tpv-sec">
        <h4>1 · Pedido {seccion('pedido')}</h4>
        <div className="tpv-grid">
          <Dato etiqueta="Modelo" valor={c.TP_MODELO} />
          <Dato etiqueta="Orden de compra" valor={c.TP_OC} />
          <Dato etiqueta="Cliente" valor={c.TP_CLIENTE} />
          <Dato etiqueta="Marca" valor={c.TP_MARCA} />
          <Dato etiqueta="Prenda" valor={c.TP_PRENDA} />
          <Dato etiqueta="Tejido" valor={c.TP_TEJIDO} />
          <Dato etiqueta="Sistema de talla" valor={c.TP_SISTEMA_TALLA} />
          <Dato etiqueta="Variante / color" valor={c.TP_VARIANTE} />
          <Dato etiqueta="Fecha" valor={fecha(c.TP_FECHA)} />
          <Dato etiqueta="Elaboró" valor={c.TP_ELABORO} />
          <Dato etiqueta="Pares por pack" valor={numero(c.TP_PACK)} />
          <Dato etiqueta="Packs" valor={numero(c.TP_PACKS)} />
          <Dato etiqueta="Pares" valor={c.TP_PACK && c.TP_PACKS ? numero(Number(c.TP_PACK) * Number(c.TP_PACKS)) : ''} />
          <Dato etiqueta="Docenas" valor={c.TP_PACK && c.TP_PACKS ? numero((Number(c.TP_PACK) * Number(c.TP_PACKS)) / 12) : ''} />
        </div>
        <div className="tabla-marco">
          <table className="tpv-tabla">
            <thead><tr>{TABLAS.TP_TABLA_PEDIDO.columnas.map((col) => <th key={col.clave}>{col.etiqueta}</th>)}</tr></thead>
            <tbody>
              {pedido.map((r) => (
                <tr key={r.i}>{TABLAS.TP_TABLA_PEDIDO.columnas.map((col) => <td key={col.clave} className={col.tipo === 'decimal' ? 'num' : ''}>{col.tipo === 'decimal' ? numero(r[col.clave]) : r[col.clave]}</td>)}</tr>
              ))}
              {!pedido.length && <tr><td colSpan={TABLAS.TP_TABLA_PEDIDO.columnas.length} className="tpv-vacio">sin códigos</td></tr>}
            </tbody>
          </table>
        </div>
        <Fotos urls={zona('FOTO_REFERENCIA')} alAbrir={setGrande} vacio="Sin foto de referencia" />
      </section>

      {/* ------------------------------------------------ 2 CODIGOS Y RUTA */}
      <section className="tpv-sec">
        <h4>2 · Códigos y ruta {seccion('ruta')}</h4>
        <div className="tabla-marco">
          <table className="tpv-tabla">
            <thead><tr><th>Código</th><th>Talla</th><th>Color / cuerpo</th><th>Bordado</th><th>Hilo / lechuga</th></tr></thead>
            <tbody>
              {pedido.map((r) => {
                const k = codigos[r.i] || {}
                return (
                  <tr key={r.i}><td><strong>{r.codigo}</strong></td><td>{r.talla}</td><td className={lleno(k.colorCuerpo) ? '' : 'tpv-vacio'}>{lleno(k.colorCuerpo) ? k.colorCuerpo : 'sin color'}</td><td>{k.bordado}</td><td>{k.hilo}</td></tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="tpv-ruta">
          {ruta.length ? ruta.map((p, i) => <span key={i} className="tpv-paso">{i + 1}. {p}</span>) : <span className="tpv-vacio">sin ruta de proceso</span>}
        </div>
      </section>

      {/* ------------------------------------------------------- 3 AVIOS */}
      <section className="tpv-sec">
        <h4>3 · Avíos {seccion('etiquetas')}</h4>
        <div className="tabla-marco">
          <table className="tpv-tabla">
            <thead><tr><th></th><th>Clave</th><th>Avío</th><th className="num">Usa por pack</th><th className="num">Enviar{packs ? ` (${numero(packs)} packs)` : ''}</th><th>Cómo se usa</th><th>Talla</th></tr></thead>
            <tbody>
              {avios.map((r) => {
                const u = urlDe(lectura.imagenesAvios?.[r.i])
                const usa = Number(r.usa)
                return (
                  <tr key={r.i}>
                    <td className="tpv-mini">
                      {u ? <button type="button" className="tpv-foto tpv-foto-mini" onClick={() => setGrande(u)} title="Ver en grande"><img src={u} alt="" loading="lazy" /></button> : <span className="tpv-vacio">—</span>}
                    </td>
                    <td><strong className={lleno(r.clave) ? '' : 'tpv-vacio'}>{lleno(r.clave) ? r.clave : 'sin clave'}</strong></td>
                    <td>{r.descripcion}</td>
                    <td className={`num ${Number.isFinite(usa) && lleno(r.usa) ? '' : 'tpv-vacio'}`}>{Number.isFinite(usa) && lleno(r.usa) ? numero(usa) : 'sin número'}</td>
                    <td className="num">{Number.isFinite(usa) && lleno(r.usa) && packs ? numero(Math.ceil(usa * packs - 1e-9)) : ''}</td>
                    <td>{r.comoSeUsa}</td>
                    <td>{r.talla}</td>
                  </tr>
                )
              })}
              {!avios.length && <tr><td colSpan={7} className="tpv-vacio">sin avíos</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------- 4 5 6 EMPAQUE */}
      <section className="tpv-sec">
        <h4>4 · Empaque individual {seccion('individual')}</h4>
        {lleno(c.TP_INDIVIDUAL_TEXTO) && <p className="tpv-texto">{c.TP_INDIVIDUAL_TEXTO}</p>}
        <Fotos urls={zona('FOTO_INDIVIDUAL')} alAbrir={setGrande} vacio="Sin fotos de cómo se arma el par" />
      </section>
      <section className="tpv-sec">
        <h4>5 · Packs en bolsa {seccion('bolsa')}</h4>
        <div className="tpv-grid"><Dato etiqueta="Packs por bolsa" valor={numero(c.TP_PACKS_POR_BOLSA)} /></div>
        {lleno(c.TP_BOLSA_TEXTO) && <p className="tpv-texto">{c.TP_BOLSA_TEXTO}</p>}
        <Fotos urls={zona('FOTO_BOLSA')} alAbrir={setGrande} vacio="Sin foto de la bolsa" />
      </section>
      <section className="tpv-sec">
        <h4>6 · Caja {seccion('caja')}</h4>
        <div className="tpv-grid"><Dato etiqueta="Docenas por caja" valor={numero(c.TP_DOCENAS_POR_CAJA)} /></div>
        {lleno(c.TP_CAJA_TEXTO) && <p className="tpv-texto">{c.TP_CAJA_TEXTO}</p>}
        <Fotos urls={zona('FOTO_CAJA')} alAbrir={setGrande} vacio="Sin foto de la caja" />
      </section>

      {grande && (
        <div className="tpv-lightbox" onClick={() => setGrande(null)}>
          <img src={grande} alt="" />
          <span className="texto-suave">Clic para cerrar</span>
        </div>
      )}
    </div>
  )
}
