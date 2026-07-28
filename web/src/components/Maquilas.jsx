// Administracion simple de maquilas (destinos del PDF de salida). El ID del
// documento es el nombre normalizado (NFKC, minusculas, espacios colapsados):
// asi dos altas simultaneas del mismo nombre caen en el MISMO doc y los
// duplicados son imposibles por construccion, sin transacciones.
import { useEffect, useState } from 'react'
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

export const MAX_NOMBRE_MAQUILA = 80

export function normalizarNombreMaquila(nombre) {
  return (nombre || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NOMBRE_MAQUILA)
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
  const { authUser } = useAuth()
  const maquilas = useMaquilas()
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [guardando, setGuardando] = useState(false)

  const onAlta = async (e) => {
    e.preventDefault()
    setMensaje('')
    const limpio = normalizarNombreMaquila(nombre)
    if (!limpio) return
    const id = idDeMaquila(limpio)
    if (!id) {
      setMensaje('El nombre debe traer al menos una letra o numero.')
      return
    }
    setGuardando(true)
    try {
      const existente = await getDoc(doc(db, 'maquilas', id))
      if (existente.exists()) {
        setMensaje(`Ya existe una maquila con ese nombre: "${existente.data().nombre}".`)
        return
      }
      await setDoc(doc(db, 'maquilas', id), {
        nombre: limpio,
        activo: true,
        creadoEn: serverTimestamp(),
        creadoPorUid: authUser.uid
      })
      setNombre('')
      setMensaje(`Maquila "${limpio}" dada de alta.`)
    } catch (err) {
      setMensaje('No se pudo dar de alta: ' + (err.message || err))
    } finally {
      setGuardando(false)
    }
  }

  const onToggle = async (m) => {
    try {
      await updateDoc(doc(db, 'maquilas', m.id), { activo: !m.activo })
    } catch (err) {
      setMensaje('No se pudo cambiar el estado: ' + (err.message || err))
    }
  }

  return (
    <div className="tarjeta" style={{ marginBottom: 18 }}>
      <h2 style={{ cursor: 'pointer' }} onClick={() => setAbierto(!abierto)}>
        Maquilas ({maquilas.filter((m) => m.activo).length}) {abierto ? '▾' : '▸'}
      </h2>
      {abierto && (
        <div style={{ marginTop: 8 }}>
          <form onSubmit={onAlta} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Nombre de la maquila"
              value={nombre}
              maxLength={MAX_NOMBRE_MAQUILA}
              onChange={(e) => setNombre(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn-secundario" type="submit" disabled={guardando || !nombre.trim()}>
              Dar de alta
            </button>
          </form>
          {mensaje && <p style={{ fontSize: 13, color: '#555' }}>{mensaje}</p>}
          {maquilas.length === 0 && <p style={{ fontSize: 14, color: '#777' }}>Sin maquilas todavia.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {maquilas.map((m) => (
              <li
                key={m.id}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', opacity: m.activo ? 1 : 0.5 }}
              >
                <span>{m.nombre}{!m.activo && ' (inactiva)'}</span>
                <button className="btn-secundario" onClick={() => onToggle(m)}>
                  {m.activo ? 'Desactivar' : 'Reactivar'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
