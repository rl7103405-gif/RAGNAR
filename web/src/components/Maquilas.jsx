// Maquilas (destinos del PDF de salida): ahora es una PAGINA propia (ruta
// /maquilas, como el Historial), ya no una tarjeta dentro de la Estacion.
// El alta exige nombre Y direccion; la direccion se precarga despues como
// 'Direccion Envio' al generar el PDF. El ID del documento es el nombre
// normalizado y transliterado: dos altas del mismo nombre caen en el MISMO
// doc y los duplicados son imposibles por construccion, sin transacciones.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  getDoc
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import AjustesCuenta from './AjustesCuenta'

export const MAX_NOMBRE_MAQUILA = 80
// Mismo tope que el campo 'Direccion Envio' del PDF (una linea a lo ancho):
// asi una direccion registrada NUNCA se trunca en silencio al precargarse.
export const MAX_DIRECCION_MAQUILA = 95

function limpiarTexto(texto, maximo) {
  let limpio = ''
  for (const ch of String(texto || '')) {
    const cp = ch.codePointAt(0)
    limpio += cp < 32 || cp === 127 ? ' ' : ch
  }
  return limpio.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maximo)
}

export function normalizarNombreMaquila(nombre) {
  return limpiarTexto(nombre, MAX_NOMBRE_MAQUILA)
}

function idDeMaquila(nombre) {
  // Documento con ID derivado del nombre: solo minusculas y sin caracteres
  // problematicos para un ID de Firestore. Se translitera quitando
  // diacriticos ANTES de mapear a [a-z0-9]: sin esto "PEÑA" daria "pe_a"
  // (la Ñ mapeada a '_'), que colisionaria con cualquier otra palabra de esa
  // forma. NFD separa la letra base de su marca combinante (p.ej. n + ~), y
  // U+0300-U+036F cubre esas marcas combinantes Unicode (diacritic marks).
  const base = normalizarNombreMaquila(nombre)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  let id = ''
  for (const ch of base) {
    id += /[a-z0-9]/.test(ch) ? ch : '_'
  }
  id = id.replace(/_+/g, '_').replace(/^_|_$/g, '')
  return id
}

/** Hook: lista reactiva de maquilas (todas; filtra activo quien la use). */
export function useMaquilas() {
  const [maquilas, setMaquilas] = useState([])
  useEffect(() => {
    const q = query(collection(db, 'maquilas'), orderBy('nombre'))
    const unsub = onSnapshot(q, (snap) => {
      setMaquilas(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    }, (err) => console.error('[Maquilas] Error escuchando maquilas:', err))
    return unsub
  }, [])
  return maquilas
}

export default function Maquilas() {
  const { authUser, perfil, cerrarSesion } = useAuth()
  const maquilas = useMaquilas()
  const [nombre, setNombre] = useState('')
  const [direccion, setDireccion] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [esError, setEsError] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [editando, setEditando] = useState(null) // maquila en edicion de direccion
  const [nuevaDireccion, setNuevaDireccion] = useState('')

  const avisar = (texto, error = false) => {
    setMensaje(texto)
    setEsError(error)
  }

  const onAlta = async (e) => {
    e.preventDefault()
    avisar('')
    const nombreLimpio = normalizarNombreMaquila(nombre)
    const direccionLimpia = limpiarTexto(direccion, MAX_DIRECCION_MAQUILA)
    if (!nombreLimpio) return
    if (!direccionLimpia) {
      avisar('La direccion es obligatoria para dar de alta la maquila.', true)
      return
    }
    const id = idDeMaquila(nombreLimpio)
    if (!id) {
      avisar('El nombre debe traer al menos una letra o numero.', true)
      return
    }
    setGuardando(true)
    try {
      const existente = await getDoc(doc(db, 'maquilas', id))
      if (existente.exists()) {
        avisar(`Ya existe una maquila con ese nombre: "${existente.data().nombre}".`, true)
        return
      }
      await setDoc(doc(db, 'maquilas', id), {
        nombre: nombreLimpio,
        direccion: direccionLimpia,
        activo: true,
        creadoEn: serverTimestamp(),
        creadoPorUid: authUser.uid
      })
      setNombre('')
      setDireccion('')
      avisar(`Maquila "${nombreLimpio}" dada de alta.`)
    } catch (err) {
      avisar('No se pudo dar de alta: ' + (err.message || err), true)
    } finally {
      setGuardando(false)
    }
  }

  const onToggle = async (m) => {
    avisar('')
    try {
      await updateDoc(doc(db, 'maquilas', m.id), { activo: !m.activo })
    } catch (err) {
      avisar('No se pudo cambiar el estado: ' + (err.message || err), true)
    }
  }

  const abrirEdicion = (m) => {
    setEditando(m)
    setNuevaDireccion(m.direccion || '')
  }

  const onGuardarDireccion = async () => {
    const limpia = limpiarTexto(nuevaDireccion, MAX_DIRECCION_MAQUILA)
    if (!limpia) {
      avisar('La direccion no puede quedar vacia.', true)
      return
    }
    try {
      await updateDoc(doc(db, 'maquilas', editando.id), { direccion: limpia })
      avisar(`Direccion de "${editando.nombre}" actualizada.`)
      setEditando(null)
    } catch (err) {
      avisar('No se pudo actualizar la direccion: ' + (err.message || err), true)
    }
  }

  return (
    <div className="layout">
      <div className="barra-superior">
        <div className="barra-titulo">RAGNAR - Maquilas</div>
        <div className="barra-usuario">
          <Link to="/" className="btn-secundario" style={{ textDecoration: 'none' }}>
            Volver a la estacion
          </Link>
          <span className="usuario-nombre">{perfil?.nombreCompleto || 'Estacion'}</span>
          <AjustesCuenta />
          <button className="btn-salir" onClick={cerrarSesion}>Salir</button>
        </div>
      </div>

      <div className="contenido">
        <div className="tarjeta" style={{ marginBottom: 18 }}>
          <h2>Dar de alta una maquila</h2>
          <form onSubmit={onAlta}>
            <label className="campo">
              <span>Nombre</span>
              <input
                type="text"
                placeholder="Nombre de la maquila"
                value={nombre}
                maxLength={MAX_NOMBRE_MAQUILA}
                onChange={(e) => setNombre(e.target.value)}
              />
            </label>
            <label className="campo">
              <span>Direccion (obligatoria; se usa como Direccion Envio en el PDF)</span>
              <input
                type="text"
                placeholder="Calle, numero, colonia, ciudad"
                value={direccion}
                maxLength={MAX_DIRECCION_MAQUILA}
                onChange={(e) => setDireccion(e.target.value)}
              />
            </label>
            <button
              className="btn-primario"
              type="submit"
              disabled={guardando || !nombre.trim() || !direccion.trim()}
            >
              Dar de alta
            </button>
          </form>
          {mensaje && (
            <div className={esError ? 'alerta-error' : 'alerta-exito'} style={{ marginTop: 10 }}>
              {mensaje}
            </div>
          )}
        </div>

        <div className="tarjeta">
          <h2>Maquilas registradas ({maquilas.filter((m) => m.activo).length} activas)</h2>
          {maquilas.length === 0 && <p style={{ color: '#777' }}>Sin maquilas todavia.</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Nombre</th>
                <th style={{ textAlign: 'left' }}>Direccion</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {maquilas.map((m) => (
                <tr key={m.id} style={{ opacity: m.activo ? 1 : 0.5 }}>
                  <td>{m.nombre}{!m.activo && ' (inactiva)'}</td>
                  <td>{m.direccion || '-'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn-secundario" onClick={() => abrirEdicion(m)} style={{ marginRight: 6 }}>
                      Editar direccion
                    </button>
                    <button className="btn-secundario" onClick={() => onToggle(m)}>
                      {m.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
          }}
        >
          <div className="tarjeta" style={{ width: 'min(440px, 92vw)' }}>
            <h2>Direccion de {editando.nombre}</h2>
            <label className="campo">
              <span>Direccion</span>
              <input
                type="text"
                value={nuevaDireccion}
                maxLength={MAX_DIRECCION_MAQUILA}
                onChange={(e) => setNuevaDireccion(e.target.value)}
                autoFocus
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-primario" onClick={onGuardarDireccion}>Guardar</button>
              <button className="btn-secundario" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
