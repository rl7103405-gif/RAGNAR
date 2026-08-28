// Campana de NOVEDADES en la barra superior: que se corrigio o se agrego en
// la app, contado para la gente de planta.
//
// El contenido es estatico (src/constants/novedades.js): acompaña al deploy,
// no cuesta lecturas de Firebase. Lo unico que se guarda por persona es hasta
// donde ya leyo, y va en localStorage POR USUARIO — en planta varias personas
// comparten la misma tablet, asi que la marca de leido de uno no puede
// apagarle el aviso al siguiente.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { NOVEDADES, TIPO_NOVEDAD, DIAS_NOVEDAD_INICIAL } from '../constants/novedades'

const PREFIJO = 'novedades:visto:'

// Inyectadas por vite.config.js en cada build. Los `typeof` son la red por si
// se renderiza fuera de Vite (una prueba suelta): sin ellos, el identificador
// sin definir tumbaria la barra superior entera.
const VERSION_FECHA = typeof __VERSION_FECHA__ === 'string' ? __VERSION_FECHA__ : '—'
const VERSION_COMMIT = typeof __VERSION_COMMIT__ === 'string' ? __VERSION_COMMIT__ : ''

// localStorage puede no existir o estar bloqueado (modo privado, politica del
// navegador de la tablet). Nunca debe tumbar la barra superior: si falla, se
// trabaja como si no hubiera nada guardado.
function leerVisto(clave) {
  try {
    return window.localStorage.getItem(clave)
  } catch {
    return null
  }
}
function guardarVisto(clave, valor) {
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    /* sin persistencia: el globo reaparecera en la proxima carga */
  }
}

// Los ids son 'YYYY-MM-DD-NN', asi que comparar como texto equivale a
// comparar por fecha. Es mas confiable que guardar la fecha suelta: distingue
// dos novedades del mismo dia.
// Se calcula como el maximo real (no NOVEDADES[0]): el orden del array es
// solo una convencion documentada, nada la obliga. Si alguien agrega una
// entrada al final por error o un merge revuelve el orden, tomar la primera
// posicion guardaria como "visto" un id que no es el mayor, y el globo de
// sin leer se quedaria pegado sin explicacion.
const ID_MAS_NUEVO = NOVEDADES.reduce((max, n) => (n.id > max ? n.id : max), '')

// Solo en desarrollo: avisa si el array se desordeno, hay ids repetidos o el
// formato del id no es el esperado. Barato y no corre en produccion.
//
// El formato importa de verdad: al comparar como TEXTO, un sufijo de un solo
// digito se ordena mal ('2026-08-27-9' sale mayor que '2026-08-27-10') y esa
// novedad se leeria como la mas nueva sin serlo.
const FORMATO_ID = /^\d{4}-\d{2}-\d{2}-\d{2}$/

if (import.meta.env.DEV) {
  const vistos = new Set()
  for (let i = 0; i < NOVEDADES.length; i++) {
    const id = NOVEDADES[i].id
    if (!FORMATO_ID.test(id)) {
      console.error(`Novedades: el id "${id}" no tiene el formato YYYY-MM-DD-NN (NN de DOS digitos)`)
    }
    if (vistos.has(id)) {
      console.error(`Novedades: id duplicado "${id}" en novedades.js`)
    }
    vistos.add(id)
    if (i > 0 && id > NOVEDADES[i - 1].id) {
      console.error(
        `Novedades: novedades.js no esta ordenado de mas nuevo a mas viejo (id "${id}" deberia ir antes de "${NOVEDADES[i - 1].id}")`
      )
    }
  }
}

// Primera vez en esta tablet con este usuario: se marcan como nuevas solo las
// recientes, para no recibir a alguien con un globo de 30 avisos que no va a
// leer (y que le enseña a ignorar el globo).
function idInicial() {
  const corte = new Date()
  corte.setDate(corte.getDate() - DIAS_NOVEDAD_INICIAL)
  const y = corte.getFullYear()
  const m = String(corte.getMonth() + 1).padStart(2, '0')
  const d = String(corte.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}-00`
}

function fechaLegible(iso) {
  // 'YYYY-MM-DD' se parsea como UTC y en Mexico cae un dia antes: se arma
  // la fecha con sus partes (regla dura del proyecto).
  const [a, m, d] = (iso ?? '').split('-').map(Number)
  if (!a || !m || !d) return iso ?? ''
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

export default function Novedades() {
  const { authUser } = useAuth()
  const uid = authUser?.uid ?? 'anon'
  const clave = PREFIJO + uid

  const [abierto, setAbierto] = useState(false)
  const botonRef = useRef(null)
  const cerrarRef = useRef(null)
  const [visto, setVisto] = useState(() => leerVisto(PREFIJO + uid) ?? idInicial())

  // Al cambiar de usuario en la misma tablet se relee SU marca, no la del
  // anterior.
  useEffect(() => {
    setVisto(leerVisto(clave) ?? idInicial())
  }, [clave])

  const sinLeer = useMemo(() => NOVEDADES.filter((n) => n.id > visto).length, [visto])

  const abrir = () => {
    setAbierto(true)
    if (ID_MAS_NUEVO && ID_MAS_NUEVO > visto) {
      guardarVisto(clave, ID_MAS_NUEVO)
      setVisto(ID_MAS_NUEVO)
    }
  }

  // Escape cierra (como el resto de los modales), el foco entra al dialogo y
  // vuelve a la campana al salir, y el fondo no se desplaza mientras esta
  // abierto — en tablet, deslizar sobre el modal arrastraba la pagina de
  // atras.
  useEffect(() => {
    if (!abierto) return
    const alTeclear = (e) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('keydown', alTeclear)
    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cerrarRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = overflowPrevio
      botonRef.current?.focus()
    }
  }, [abierto])

  if (!NOVEDADES.length) return null

  return (
    <>
      <button
        type="button"
        ref={botonRef}
        className="btn-novedades"
        onClick={abrir}
        aria-label={sinLeer ? `Novedades: ${sinLeer} sin leer` : 'Novedades'}
        title="Novedades de la app"
      >
        <span aria-hidden="true">🔔</span>
        {sinLeer > 0 && <span className="globo-novedades">{sinLeer > 9 ? '9+' : sinLeer}</span>}
      </button>

      {abierto && (
        <div className="modal-fondo" onClick={() => setAbierto(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Novedades de la app"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-cabecera">
              <h2>Novedades</h2>
              <button
                type="button"
                ref={cerrarRef}
                className="btn-cerrar"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <p className="texto-suave" style={{ marginTop: 0 }}>
              Lo que hemos corregido o agregado a la app.
            </p>

            {/* La version del build (Roberto 2026-08-28). Sirve para una cosa
                muy concreta: abrir la campana y saber si la tablet ya tiene lo
                nuevo o se quedo con el bundle de ayer. La fecha es la del
                build, no la de hoy, asi que si no coincide con el ultimo
                cambio anunciado es que falta recargar. */}
            <p className="version-app">
              Version <strong>{VERSION_FECHA}</strong>
              {VERSION_COMMIT ? <span className="texto-suave"> · {VERSION_COMMIT}</span> : null}
            </p>

            <ul className="lista-novedades">
              {NOVEDADES.map((n) => {
                const tipo = TIPO_NOVEDAD[n.tipo] ?? TIPO_NOVEDAD.mejorado
                return (
                  <li key={n.id} className="novedad">
                    <div className="novedad-cabecera">
                      <span className="novedad-tipo" style={{ background: tipo.color }}>
                        {tipo.etiqueta}
                      </span>
                      <span className="texto-suave novedad-fecha">{fechaLegible(n.fecha)}</span>
                    </div>
                    <strong className="novedad-titulo">{n.titulo}</strong>
                    <p className="novedad-detalle">{n.detalle}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
