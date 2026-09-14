// QUIEN ESTA EDITANDO UN TECH PACK, EN VIVO.
//
// Roberto, 2026-09-14: "si alguien esta modificando un tech pack, que este
// avisando, como en vivo". Dos personas del equipo de Lety pueden abrir el
// mismo tech pack y la ultima que guarda pisa a la otra. Esto no lo impide
// (el candado de version es otra cosa): AVISA, para que se pongan de acuerdo.
//
// Cada quien que abre un editor escribe techPacks/{codigo}/editando/{uid} con
// su nombre y un LATIDO cada 20 s. Al cerrar se borra. Si el navegador se
// cierra de golpe no se alcanza a borrar: por eso quien lee ignora las marcas
// con latido de hace mas de 60 s. Las reglas solo dejan escribir la marca
// propia, con el nombre del perfil y la hora del servidor.
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { codigoComoId } from './techPacks'

export const LATIDO_MS = 20000
export const VIGENCIA_MS = 60000

const aMs = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : null)

/**
 * Marca que `usuario` esta editando `codigo` y mantiene el latido.
 * Devuelve una funcion para quitar la marca (llamarla al cerrar el editor).
 * Nunca lanza: si falla (sin red, sin permiso) el editor sigue funcionando.
 */
export function marcarEdicion({ codigo, usuario, esPrueba, que = 'datos' }) {
  const id = codigoComoId(codigo)
  if (!id || !usuario?.uid) return () => {}
  const ref = doc(db, 'techPacks', id, 'editando', usuario.uid)
  let vivo = true
  setDoc(ref, { uid: usuario.uid, nombre: usuario.nombre || '', que: String(que).slice(0, 20), desde: serverTimestamp(), latido: serverTimestamp(), esPrueba: esPrueba === true })
    .catch((e) => console.warn('[editando] no se pudo marcar:', e?.code || e))
  const intervalo = setInterval(() => {
    if (!vivo) return
    updateDoc(ref, { latido: serverTimestamp() }).catch(() => {})
  }, LATIDO_MS)
  const quitar = () => {
    if (!vivo) return
    vivo = false
    clearInterval(intervalo)
    deleteDoc(ref).catch(() => {})
  }
  // Best effort al cerrar la pestana; si no alcanza, la vigencia la descarta.
  window.addEventListener('pagehide', quitar, { once: true })
  return quitar
}

/**
 * Escucha quien MAS esta editando `codigo` (sin contarte a ti ni marcas
 * viejas). alRecibir([{ uid, nombre, que, desdeMs }]).
 */
export function escucharEdiciones({ codigo, miUid, alRecibir }) {
  const id = codigoComoId(codigo)
  if (!id) return () => {}
  let docs = []
  const emitir = () => {
    const ahora = Date.now()
    alRecibir(
      docs
        .filter((d) => d.uid !== miUid)
        // Sin latido todavia (serverTimestamp pendiente) cuenta como reciente.
        .filter((d) => { const l = aMs(d.latido); return l == null || ahora - l < VIGENCIA_MS })
        .map((d) => ({ uid: d.uid, nombre: d.nombre || 'Alguien', que: d.que || 'datos', desdeMs: aMs(d.desde) }))
    )
  }
  const cancelar = onSnapshot(
    collection(db, 'techPacks', id, 'editando'),
    (snap) => { docs = snap.docs.map((d) => d.data()); emitir() },
    (err) => console.warn('[editando] no se pudo escuchar:', err?.code || err)
  )
  // Re-evalua la vigencia aunque no cambie nada en la base.
  const reloj = setInterval(emitir, LATIDO_MS)
  return () => { cancelar(); clearInterval(reloj) }
}

/** "Mónica lo está editando (hace 3 min)" */
export function textoEdiciones(lista) {
  if (!lista?.length) return ''
  const hace = (ms) => {
    if (!ms) return 'ahora'
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000))
    return min < 1 ? 'ahora' : `hace ${min} min`
  }
  const partes = lista.map((x) => `${x.nombre} (${x.que === 'contenido' ? 'el contenido' : 'los datos'}, desde ${hace(x.desdeMs)})`)
  return `${partes.join(' y ')} ${lista.length === 1 ? 'también lo está editando' : 'también lo están editando'} en este momento. Pónganse de acuerdo: si guardan los dos, se queda lo último que se guarde.`
}
