// CATALOGO DE AVIOS: el material que se manda a las maquilas para que puedan
// ensamblar — plastiflechas (hay varios tipos), etiquetas, cajas, cinta
// canela, bolsas, displays y fajillas.
//
// El catalogo lo ADMINISTRA CIELO (flag administraCatalogoAvios en su perfil)
// y el admin; Alvaro (almacen) lo consulta para armar envios pero no lo toca
// (decision de Roberto, 2026-08-13). Es una coleccion aparte del catalogo de
// productos a proposito: un producto se vende, un avio se CONSUME al armar.
// Cada avio tiene su propia unidad (piezas, rollos, millares, kg...) porque
// el inventario se cuenta en esa unidad y una vez que hay movimientos
// contados asi, la unidad ya no se puede cambiar.
import { useEffect, useState } from 'react'
import { collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { coincide } from '../utils/texto'

export const TIPOS_AVIO = [
  { id: 'plastiflecha', nombre: 'Plastiflecha' },
  { id: 'etiqueta', nombre: 'Etiqueta' },
  { id: 'caja', nombre: 'Caja' },
  { id: 'cinta', nombre: 'Cinta canela' },
  { id: 'bolsa', nombre: 'Bolsa' },
  { id: 'otro', nombre: 'Otro' }
]

export const UNIDADES_AVIO = [
  { id: 'piezas', nombre: 'Piezas' },
  { id: 'rollos', nombre: 'Rollos' },
  { id: 'millares', nombre: 'Millares' },
  { id: 'metros', nombre: 'Metros' },
  { id: 'cajas', nombre: 'Cajas' },
  // El inventario cuenta ENTEROS: un avio en kg se mueve por kg completos.
  { id: 'kg', nombre: 'Kilogramos (enteros)' }
]

const MAX_CODIGO = 60
const MAX_DESCRIPCION = 200

/** Hook: catalogo reactivo de avios (todos; filtra activo quien lo use). */
export function useAvios() {
  const [avios, setAvios] = useState([])
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'avios'), orderBy('codigo')),
      (snap) => setAvios(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('[Avios] Error escuchando avios:', err)
    )
    return unsub
  }, [])
  return avios
}

/** Normaliza el codigo: el ID del documento ES el codigo, asi que los
 *  duplicados son imposibles por construccion (igual que en maquilas). */
export function normalizarCodigoAvio(texto) {
  return String(texto || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9._-]/g, '')
    .slice(0, MAX_CODIGO)
}

export default function Avios() {
  const { authUser, perfil, administraCatalogoAvios } = useAuth()
  const avios = useAvios()
  const [codigo, setCodigo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [tipo, setTipo] = useState('plastiflecha')
  const [unidad, setUnidad] = useState('piezas')
  const [busqueda, setBusqueda] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [esError, setEsError] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const visibles = busqueda.trim()
    ? avios.filter(
        (a) =>
          coincide(a.codigo, busqueda) ||
          coincide(a.descripcion, busqueda) ||
          coincide(a.claveMicrosip, busqueda)
      )
    : avios

  const avisar = (texto, error = false) => {
    setMensaje(texto)
    setEsError(error)
  }

  const onAlta = async (e) => {
    e.preventDefault()
    avisar('')
    const codigoCrudo = codigo.trim()
    const codigoLimpio = normalizarCodigoAvio(codigo)
    const descripcionLimpia = descripcion.trim().slice(0, MAX_DESCRIPCION)
    if (!codigoLimpio) {
      avisar('El codigo debe traer al menos una letra o numero.', true)
      return
    }
    if (!descripcionLimpia) {
      avisar('La descripcion es obligatoria: es lo que la maquila va a leer al pedirlo.', true)
      return
    }
    setGuardando(true)
    try {
      const existente = await getDoc(doc(db, 'avios', codigoLimpio))
      if (existente.exists()) {
        avisar(`Ya existe el avio "${codigoLimpio}": ${existente.data().descripcion}.`, true)
        return
      }
      await setDoc(doc(db, 'avios', codigoLimpio), {
        codigo: codigoLimpio,
        descripcion: descripcionLimpia,
        tipo,
        unidad,
        activo: true,
        creadoEn: serverTimestamp(),
        creadoPorUid: authUser.uid,
        // Si la clave tal como se tecleo no sobrevive la normalizacion (los
        // SRFID de Microsip llevan espacio y el ID no puede), se conserva la
        // original: es la que entiende Microsip al exportar.
        ...(codigoCrudo.toUpperCase() !== codigoLimpio
          ? { claveMicrosip: codigoCrudo.toUpperCase().slice(0, MAX_CODIGO) }
          : {})
      })
      setCodigo('')
      setDescripcion('')
      avisar(`Avio "${codigoLimpio}" dado de alta (${descripcionLimpia}).`)
    } catch (err) {
      console.error('[Avios] Error dando de alta:', err)
      avisar('No se pudo dar de alta: ' + (err.message || err), true)
    } finally {
      setGuardando(false)
    }
  }

  const onCambiarActivo = async (avio) => {
    avisar('')
    try {
      await updateDoc(doc(db, 'avios', avio.id), {
        descripcion: avio.descripcion,
        activo: !avio.activo,
        actualizadoEn: serverTimestamp(),
        // Toda edicion del catalogo queda firmada: cambio de dueno (Cielo) y
        // conviene saber quien movio que.
        actualizadoPorUid: authUser.uid,
        actualizadoPorNombre: perfil?.nombreCompleto || ''
      })
      avisar(`"${avio.codigo}" ${avio.activo ? 'dado de baja' : 'reactivado'}.`)
    } catch (err) {
      avisar('No se pudo cambiar: ' + (err.message || err), true)
    }
  }

  const nombreTipo = (id) => TIPOS_AVIO.find((t) => t.id === id)?.nombre || id
  const nombreUnidad = (id) => UNIDADES_AVIO.find((u) => u.id === id)?.nombre || id

  return (
    <>
      {mensaje && (
        <div className={esError ? 'alerta-error' : 'alerta-exito'} style={{ marginBottom: 12 }}>
          {mensaje}
        </div>
      )}

      {administraCatalogoAvios && (
        <form className="tarjeta" onSubmit={onAlta} style={{ marginBottom: 18 }}>
          <h2>Dar de alta un avio</h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            El material que las maquilas necesitan para ensamblar. Usa la{' '}
            <strong>clave de Microsip</strong> como codigo. La <strong>unidad</strong> no se puede
            cambiar despues: el inventario se cuenta en ella, siempre en cantidades enteras.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label className="campo" style={{ flex: '1 1 150px' }}>
              <span>Codigo (clave Microsip)</span>
              <input
                type="text"
                placeholder="ej. CDF594"
                value={codigo}
                maxLength={MAX_CODIGO}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </label>
            <label className="campo" style={{ flex: '2 1 240px' }}>
              <span>Descripcion</span>
              <input
                type="text"
                placeholder="ej. FAJILLA 5PACK GEORGE TIN CORTO"
                value={descripcion}
                maxLength={MAX_DESCRIPCION}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            </label>
            <label className="campo" style={{ flex: '0 1 160px' }}>
              <span>Tipo</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS_AVIO.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo" style={{ flex: '0 1 150px' }}>
              <span>Unidad</span>
              <select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                {UNIDADES_AVIO.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn-primario" type="submit" disabled={guardando}>
            {guardando ? 'Guardando...' : 'Dar de alta'}
          </button>
        </form>
      )}

      <div className="tarjeta">
        <h2>Avios registrados ({avios.length})</h2>
        {avios.length > 6 && (
          <label className="campo" style={{ maxWidth: 320 }}>
            <span>Buscar</span>
            <input
              type="text"
              placeholder="codigo o descripcion"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </label>
        )}
        {avios.length === 0 ? (
          <p className="texto-suave">
            Todavia no hay avios dados de alta.
            {administraCatalogoAvios ? ' Usa el formulario de arriba.' : ' Cielo los da de alta.'}
          </p>
        ) : (
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descripcion</th>
                <th>Tipo</th>
                <th>Unidad</th>
                <th>Estado</th>
                {administraCatalogoAvios && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) => (
                <tr key={a.id} style={a.activo ? undefined : { color: '#8a8a8a' }}>
                  <td style={{ fontWeight: 700 }}>
                    {a.codigo}
                    {a.claveMicrosip && a.claveMicrosip !== a.codigo && (
                      <div className="texto-suave" style={{ fontWeight: 400, fontSize: 12 }}>
                        Microsip: {a.claveMicrosip}
                      </div>
                    )}
                  </td>
                  <td>{a.descripcion}</td>
                  <td>{nombreTipo(a.tipo)}</td>
                  <td>{nombreUnidad(a.unidad)}</td>
                  <td>{a.activo ? 'Activo' : 'De baja'}</td>
                  {administraCatalogoAvios && (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-secundario" onClick={() => onCambiarActivo(a)}>
                        {a.activo ? 'Dar de baja' : 'Reactivar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {visibles.length === 0 && avios.length > 0 && (
          <p className="texto-suave">Ningun avio coincide con la busqueda.</p>
        )}
      </div>
    </>
  )
}
