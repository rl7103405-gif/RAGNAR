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
import { clasificarSobrantes } from '../utils/sobrantesTechPack'

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

function Fotos({ urls, alAbrir, vacio, grandes = false }) {
  if (!urls.length) return <div className="tpv-sinfoto">{vacio}</div>
  return (
    <div className="tpv-fotos">
      {urls.map((u, i) => (
        <button key={u + i} type="button" className={`tpv-foto ${grandes ? 'tpv-foto-grande' : ''}`} onClick={() => alAbrir(u)} title="Ver en grande">
          <img src={u} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  )
}

export default function VistaPlantillaTechPack({ lectura, medicion, urlDe, pantallaInicial = 1 }) {
  const [grande, setGrande] = useState(null)
  // Una pantalla por apartado (Roberto, 11-sep: "si me gustarian las diferentes
  // pantallas de uno, dos, tres, cuatro, cinco y seis").
  const [activa, setActiva] = useState(Number(pantallaInicial) >= 1 && Number(pantallaInicial) <= 6 ? Number(pantallaInicial) : 1)
  const PESTANAS = [[1, 'Modelo', 'pedido'], [2, 'Códigos y ruta', 'ruta'], [3, 'Avíos', 'etiquetas'], [4, 'Empaque individual', 'individual'], [5, 'Packs en bolsa', 'bolsa'], [6, 'Caja o bulto', 'caja']]
  const c = lectura.campos || {}
  const t = lectura.tablas || {}
  const zona = (n) => (lectura.imagenesZona?.[n] || []).map((im) => urlDe(im.imageId)).filter(Boolean)
  const pedido = (t.TP_TABLA_PEDIDO || []).map((r, i) => ({ ...r, i })).filter((r) => lleno(r.codigo) || lleno(r.descripcion) || lleno(r.claveMicrosip))
  const codigos = t.TP_TABLA_CODIGOS || []
  const ruta = Object.values((t.TP_RUTA || [])[0] || {}).filter(lleno)
  const avios = (t.TP_TABLA_AVIOS || []).map((r, i) => ({ ...r, i })).filter((r) => lleno(r.clave) || lleno(r.descripcion))
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

      <div className="tpv-pestanas">
        {PESTANAS.map(([n, titulo, id]) => (
          <button key={n} type="button" className={`tpv-pestana ${activa === n ? 'activa' : ''} ${(falta[id] || []).length ? 'con-falta' : ''}`} onClick={() => setActiva(n)}>
            <span className="tpv-num">{n}</span> {titulo}
          </button>
        ))}
      </div>

      {/* ------------------------------------------- 1 DATOS DEL MODELO */}
      {activa === 1 && <section className="tpv-sec">
        <h4>1 · Datos del modelo {seccion('pedido')}</h4>
        <div className="tpv-grid">
          <Dato etiqueta="Modelo" valor={c.TP_MODELO} />
          <Dato etiqueta="Cliente" valor={c.TP_CLIENTE} />
          <Dato etiqueta="Marca" valor={c.TP_MARCA} />
          <Dato etiqueta="Prenda" valor={c.TP_PRENDA} />
          <Dato etiqueta="Tejido" valor={c.TP_TEJIDO} />
          <Dato etiqueta="Sistema de talla" valor={c.TP_SISTEMA_TALLA} />
          <Dato etiqueta="Variante / color" valor={c.TP_VARIANTE} />
          <Dato etiqueta="Fecha" valor={fecha(c.TP_FECHA)} />
          <Dato etiqueta="Elaboró" valor={c.TP_ELABORO} />
          <Dato etiqueta="Pares por pack" valor={numero(c.TP_PACK)} />
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
      </section>}

      {/* ------------------------------------------------ 2 CODIGOS Y RUTA */}
      {activa === 2 && <section className="tpv-sec">
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
      </section>}

      {/* ------------------------------------------------------- 3 AVIOS */}
      {activa === 3 && <section className="tpv-sec">
        <h4>3 · Avíos {seccion('etiquetas')}</h4>
        <div className="tabla-marco">
          <table className="tpv-tabla">
            <thead><tr><th></th><th>Clave</th><th>Avío</th><th className="num">Usa por pack</th><th>Cómo se usa</th><th>Talla</th></tr></thead>
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
                    <td>{r.comoSeUsa}</td>
                    <td>{r.talla}</td>
                  </tr>
                )
              })}
              {!avios.length && <tr><td colSpan={6} className="tpv-vacio">sin avíos</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {/* ---------------------------------------------------- 4 5 6 EMPAQUE */}
      {activa === 4 && <section className="tpv-sec">
        <h4>4 · Empaque individual {seccion('individual')}</h4>
        {lleno(c.TP_INDIVIDUAL_TEXTO) && <p className="tpv-texto">{c.TP_INDIVIDUAL_TEXTO}</p>}
        <Fotos urls={zona('FOTO_INDIVIDUAL')} alAbrir={setGrande} vacio="Sin fotos de cómo se arma el par" grandes />
      </section>}
      {activa === 5 && <section className="tpv-sec">
        <h4>5 · Packs en bolsa {seccion('bolsa')}</h4>
        <div className="tpv-grid"><Dato etiqueta="Packs por bolsa" valor={numero(c.TP_PACKS_POR_BOLSA)} /></div>
        {lleno(c.TP_BOLSA_TEXTO) && <p className="tpv-texto">{c.TP_BOLSA_TEXTO}</p>}
        <Fotos urls={zona('FOTO_BOLSA')} alAbrir={setGrande} vacio="Sin foto de la bolsa" grandes />
      </section>}
      {activa === 6 && <section className="tpv-sec">
        <h4>6 · Caja o bulto {seccion('caja')}</h4>
        <div className="tpv-grid">
          <Dato etiqueta="Se embarca en" valor={c.TP_EMBALAJE} />
          <Dato etiqueta={`Docenas por ${String(c.TP_EMBALAJE || '').toUpperCase() === 'BULTO' ? 'bulto' : String(c.TP_EMBALAJE || '').toUpperCase() === 'CAJA' ? 'caja' : 'caja o bulto'}`} valor={numero(c.TP_DOCENAS_POR_CAJA)} />
        </div>
        {/* POR QUE DICE "SIN DATO" (Lety, 18-sep, con el BARBIE RUN: "esto continua
            apareciendo"). Si el Excel que se subio no traia hoja de caja ni de
            bulto, se dice asi: el hueco esta en el archivo, no en RAGNAR. */}
        {!lleno(c.TP_EMBALAJE) && lectura.reporteMigracion?.conteo?.hojas && !lectura.reporteMigracion.conteo.hojas.some((h) => /\(caja\)$/.test(h)) && (
          <p className="tpv-texto" style={{ color: '#92400e' }}>
            El Excel que se subió no traía hoja de caja ni de bulto
            ({lectura.reporteMigracion.conteo.hojas.map((h) => h.replace(/\s*\([^)]*\)$/, '').trim()).join(', ')}).
            Por eso no se sabe en qué se embarca. Captúralo en <strong>Editar</strong>, pantalla 6, o agrega esa hoja al archivo y vuelve a subirlo.
          </p>
        )}
        {lleno(c.TP_CAJA_TEXTO) && <p className="tpv-texto">{c.TP_CAJA_TEXTO}</p>}
        <Fotos urls={zona('FOTO_CAJA')} alAbrir={setGrande} vacio="Sin foto de la caja o el bulto" grandes />
      </section>}

      {/* Datos del Excel anterior que la conversion no supo acomodar: nada se
          pierde, Lety los pone donde van (Roberto, 11-sep). */}
      {lectura.noMigrado?.length > 0 && (() => {
        // Lo que SI falta acomodar, con una pista de que parece y a donde va; el
        // ruido (encabezados, fechas, lo que ya esta en su lugar) no se borra,
        // se esconde con su motivo (Roberto, 18-sep: "no se pueden olvidar").
        const { reales, ruido } = clasificarSobrantes(lectura.noMigrado, lectura)
        const recorte = lectura.noMigrado.find((x) => x?.recortado)
        if (!reales.length && !recorte) {
          return ruido.length > 0 ? (
            <details className="tpv-sec">
              <summary className="texto-suave" style={{ fontSize: 13 }}>Del archivo anterior no quedó nada por acomodar ({ruido.length} texto{ruido.length === 1 ? '' : 's'} que no son datos)</summary>
              <ul style={{ fontSize: 12, margin: '6px 0 0' }}>{ruido.map((x, i) => <li key={i}>{x.texto} <span className="texto-suave">· {x.motivo}</span></li>)}</ul>
            </details>
          ) : null
        }
        return (
          <details className="tpv-sec tpv-sobrantes" open>
            <summary>Datos del archivo anterior sin acomodar ({reales.length}) · revisar y poner donde van</summary>
            <div className="tabla-marco">
              <table className="tpv-tabla">
                <thead><tr><th>Texto</th><th>Qué parece y a dónde va</th><th>Dónde estaba</th></tr></thead>
                <tbody>
                  {reales.map((x, i) => <tr key={i}><td><strong>{x.texto}</strong></td><td>{x.pista}</td><td className="texto-suave">{x.hoja} {x.celda}</td></tr>)}
                  {recorte && <tr><td colSpan={3} className="texto-suave">… y {recorte.faltan} texto{recorte.faltan === 1 ? '' : 's'} más del original que no cupieron; consérvalo aparte.</td></tr>}
                </tbody>
              </table>
            </div>
            {ruido.length > 0 && <p className="texto-suave" style={{ fontSize: 12, margin: '6px 0 0' }}>Además, {ruido.length} texto{ruido.length === 1 ? '' : 's'} del archivo anterior que no son datos (encabezados, fechas, lo que ya está en su lugar): se quitan en Editar.</p>}
          </details>
        )
      })()}

      {grande && (
        <div className="tpv-lightbox" onClick={() => setGrande(null)}>
          <img src={grande} alt="" />
          <span className="texto-suave">Clic para cerrar</span>
        </div>
      )}
    </div>
  )
}
