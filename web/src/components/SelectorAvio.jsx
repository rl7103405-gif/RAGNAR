// Selector de material buscable, para las pantallas donde se arma una lista
// de avios (Alvaro mandando material, la maquila pidiendo).
//
// Por que no un <select> pelon: el catalogo real trae 158 claves de Microsip
// (y va a crecer), asi que bajar la lista y buscar a ojo es lento. Aqui se
// teclea y filtra por CODIGO, DESCRIPCION, TIPO o UNIDAD (Roberto,
// 2026-08-14) — tambien por la clave de Microsip cuando difiere del codigo,
// que es el caso de los 59 SRFID.
//
// Se hizo con <input> + lista propia y no con <datalist> porque datalist no
// deja controlar que se ve por renglon, y en Firefox/Safari filtra distinto:
// aqui el filtrado es el mismo en todos los navegadores.
import { useEffect, useMemo, useRef, useState } from 'react'
import { TIPOS_AVIO, UNIDADES_AVIO } from './Avios'
import { coincide } from '../utils/texto'

const nombreTipo = (id) => TIPOS_AVIO.find((t) => t.id === id)?.nombre || id || ''
const nombreUnidad = (id) => UNIDADES_AVIO.find((u) => u.id === id)?.nombre || id || ''

/** Cuantos resultados se pintan a la vez: con 158 claves y una busqueda vacia
 *  no tiene caso montar la lista entera en el DOM. */
const MAX_VISIBLES = 40

export default function SelectorAvio({ avios, valor, onElegir, autoFocus = false }) {
  const elegido = useMemo(() => avios.find((a) => a.codigo === valor) || null, [avios, valor])
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [resaltado, setResaltado] = useState(0)
  const contenedor = useRef(null)

  // Si el renglon ya trae material (o se limpia desde fuera), el texto sigue.
  useEffect(() => {
    setTexto(elegido ? `${elegido.codigo} — ${elegido.descripcion}` : '')
  }, [elegido])

  // Click fuera: se cierra y se restaura lo que estaba elegido, para no dejar
  // el campo con un texto a medias que no corresponde a ningun material.
  useEffect(() => {
    if (!abierto) return
    const alClick = (e) => {
      if (contenedor.current && !contenedor.current.contains(e.target)) {
        setAbierto(false)
        setTexto(elegido ? `${elegido.codigo} — ${elegido.descripcion}` : '')
      }
    }
    document.addEventListener('mousedown', alClick)
    return () => document.removeEventListener('mousedown', alClick)
  }, [abierto, elegido])

  // Se busca en todo lo que el usuario ve del material. `coincide` ya ignora
  // acentos y mayusculas (utils/texto.js).
  const filtrados = useMemo(() => {
    const q = texto.trim()
    // Con el material ya elegido, el texto ES su descripcion completa: al
    // abrir la lista se muestra todo, no solo ese renglon.
    if (!q || (elegido && q === `${elegido.codigo} — ${elegido.descripcion}`)) return avios
    // Varias palabras: todas tienen que aparecer en algun lado del material
    // ("caja 3" encuentra CAJ003, "fajilla george" encuentra las de George).
    const palabras = q.split(/\s+/).filter(Boolean)
    return avios.filter((a) =>
      palabras.every(
        (p) =>
          coincide(a.codigo, p) ||
          coincide(a.descripcion, p) ||
          coincide(a.claveMicrosip, p) ||
          coincide(nombreTipo(a.tipo), p) ||
          coincide(nombreUnidad(a.unidad), p)
      )
    )
  }, [avios, texto, elegido])

  const visibles = filtrados.slice(0, MAX_VISIBLES)

  const elegir = (avio) => {
    onElegir(avio.codigo)
    setTexto(`${avio.codigo} — ${avio.descripcion}`)
    setAbierto(false)
  }

  const alTeclear = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAbierto(true)
      setResaltado((n) => Math.min(n + 1, visibles.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((n) => Math.max(n - 1, 0))
    } else if (e.key === 'Enter') {
      // Enter elige lo resaltado; nunca manda el formulario desde aqui.
      if (abierto && visibles[resaltado]) {
        e.preventDefault()
        elegir(visibles[resaltado])
      }
    } else if (e.key === 'Escape') {
      setAbierto(false)
      setTexto(elegido ? `${elegido.codigo} — ${elegido.descripcion}` : '')
    }
  }

  return (
    <div ref={contenedor} style={{ position: 'relative' }}>
      <input
        type="text"
        autoFocus={autoFocus}
        value={texto}
        placeholder="Escribe codigo, descripcion, tipo o unidad"
        onChange={(e) => {
          setTexto(e.target.value)
          setAbierto(true)
          setResaltado(0)
          // Si borra el texto, se limpia el material del renglon: si no, el
          // campo se veria vacio pero seguiria mandando el anterior.
          if (!e.target.value.trim() && valor) onElegir('')
        }}
        onFocus={() => {
          setAbierto(true)
          setResaltado(0)
        }}
        onKeyDown={alTeclear}
      />
      {abierto && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 30,
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            marginTop: 2,
            maxHeight: 280,
            overflowY: 'auto',
            boxShadow: '0 6px 18px rgba(15,23,42,.15)'
          }}
        >
          {visibles.length === 0 ? (
            <div className="texto-suave" style={{ padding: '10px 12px', fontSize: 13 }}>
              Ningun material coincide con "{texto.trim()}".
            </div>
          ) : (
            visibles.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onMouseEnter={() => setResaltado(i)}
                onClick={() => elegir(a)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderBottom: '1px solid #f1f5f9',
                  background: i === resaltado ? '#eef2ff' : '#fff',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  font: 'inherit'
                }}
              >
                <strong>{a.codigo}</strong>
                <span className="texto-suave" style={{ fontSize: 12 }}>
                  {' '}
                  · {nombreTipo(a.tipo)} · {nombreUnidad(a.unidad)}
                </span>
                <div style={{ fontSize: 13 }}>{a.descripcion}</div>
                {a.claveMicrosip && a.claveMicrosip !== a.codigo && (
                  <div className="texto-suave" style={{ fontSize: 11 }}>
                    Microsip: {a.claveMicrosip}
                  </div>
                )}
              </button>
            ))
          )}
          {filtrados.length > visibles.length && (
            <div className="texto-suave" style={{ padding: '8px 12px', fontSize: 12 }}>
              y {filtrados.length - visibles.length} mas — sigue escribiendo para acotar.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
