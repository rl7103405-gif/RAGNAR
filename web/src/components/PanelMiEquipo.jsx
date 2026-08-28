// MI EQUIPO: quién es quién en RAGNAR, agrupado por lo que hace cada uno.
//
// Lo pidió Roberto el 19-08 copiando lo que ya existe en captura-mecanicos
// (pestañas "Mi perfil" y "Mi equipo"). Aquí sirve para algo muy concreto: al
// encargar una tarea o al ver quién capturó un folio aparecen nombres sueltos,
// y no todos saben quién es quién ni qué alcance tiene cada quien.
//
// ⚠️ SIN FOTOS todavía. En captura-mecanicos las fotos viven en Firebase
// Storage; RAGNAR no tiene Storage montado (no hay storage.rules) porque hasta
// hoy nada lo necesitaba — los tech packs viajan en Firestore por chunks.
// Montarlo es superficie de seguridad nueva y va en su propia tanda. Mientras,
// cada quien sale con la inicial de su nombre, que es lo mismo que se ve en
// mecanicos para quien todavía no subió foto.
import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'

// El orden es el del flujo de trabajo, no alfabético: primero quien planea,
// luego quien captura, luego quien embarca y al final quien consulta.
const GRUPOS = [
  { rol: 'admin', titulo: 'Direccion', que: 'Ve todo y administra las cuentas' },
  { rol: 'produccion', titulo: 'Produccion', que: 'Sube el plan maestro' },
  { rol: 'completo', titulo: 'Embarques', que: 'Captura, embarca y encarga tareas' },
  { rol: 'captura', titulo: 'Pesadores', que: 'Capturan folios en la bascula' },
  { rol: 'almacen', titulo: 'Almacen de avios', que: 'Manda material a las maquilas' },
  { rol: 'consulta', titulo: 'Consulta', que: 'Ve reportes y el catalogo de avios' },
  { rol: 'pt', titulo: 'Producto Terminado', que: 'Recibe lo que devuelven las maquilas' }
]

/** Circulito con la inicial. Mismo hueco donde un dia ira la foto. */
function Avatar({ nombre, activo }) {
  const inicial = String(nombre || '?').trim().charAt(0).toUpperCase()
  return (
    <div
      style={{
        width: 56,
        height: 56,
        margin: '0 auto',
        borderRadius: '50%',
        background: activo ? '#e7effd' : '#e5e7eb',
        color: activo ? '#1e40af' : '#94a3b8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        fontWeight: 700
      }}
    >
      {inicial}
    </div>
  )
}

export default function PanelMiEquipo() {
  const { authUser, esInterno } = useAuth()
  const [gente, setGente] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // Se cancela al desmontar: en una tablet compartida alguien puede cambiar
    // de pestaña o cerrar sesion con la lectura en vuelo, y entonces esto
    // escribiria datos de la sesion anterior sobre un componente que ya no
    // existe. Mismo cuidado que tiene PanelTareas.
    let cancelado = false
    getDocs(collection(db, 'usuarios'))
      .then((snap) => {
        if (cancelado) return
        setGente(snap.docs.map((d) => ({ uid: d.id, ...d.data() })))
      })
      .catch((err) => {
        if (cancelado) return
        console.error('[MiEquipo] No se pudo leer el equipo:', err)
        setError('No se pudo cargar el equipo: ' + (err.message || err))
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  if (!esInterno) return null

  // Las cuentas de PRUEBA y las de maquila no son el equipo: unas son un
  // corral de pruebas y las otras gente de fuera. Verlas aqui confundiria a
  // quien busca a un companero.
  const equipo = gente.filter((u) => !u.maquilaId && !u.esPrueba)

  return (
    <div className="tarjeta">
      <h2>Mi equipo ({equipo.length})</h2>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
        Quien es quien en RAGNAR y que alcance tiene cada quien. Las cuentas de prueba y las de las
        maquilas no aparecen aqui.
      </p>

      {error && <div className="alerta-error">{error}</div>}
      {cargando && <p className="texto-suave">Cargando...</p>}

      {!cargando &&
        GRUPOS.map((g) => {
          const suyos = equipo
            .filter((u) => u.rol === g.rol)
            .sort((a, b) => String(a.nombreCompleto || '').localeCompare(String(b.nombreCompleto || ''), 'es'))
          if (!suyos.length) return null
          return (
            <div key={g.rol} style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>{g.titulo}</strong>
                <span className="texto-suave" style={{ fontSize: 13 }}>
                  {suyos.length} · {g.que}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
                {suyos.map((u) => {
                  const activo = u.activo !== false
                  const soyYo = u.uid === authUser?.uid
                  return (
                    <div key={u.uid} style={{ width: 104, textAlign: 'center' }}>
                      <Avatar nombre={u.nombreCompleto} activo={activo} />
                      <div style={{ fontSize: 13, marginTop: 4, fontWeight: soyYo ? 700 : 400 }}>
                        {u.nombreCompleto || '(sin nombre)'}
                      </div>
                      {soyYo && (
                        <div className="texto-suave" style={{ fontSize: 11 }}>
                          eres tu
                        </div>
                      )}
                      {/* Una cuenta apagada sigue existiendo pero ya no entra:
                          decirlo evita que alguien la busque para asignarle
                          algo y no entienda por que no aparece. */}
                      {!activo && (
                        <div style={{ fontSize: 11, color: '#8a5300' }}>desactivada</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
    </div>
  )
}
