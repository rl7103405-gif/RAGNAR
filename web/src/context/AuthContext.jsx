// Contexto de autenticacion. Maneja el usuario de Firebase Auth y carga su
// perfil (activo, nombreCompleto) desde la coleccion `usuarios` de Firestore.
import { createContext, useContext, useEffect, useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase/config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (usuario) => {
      // Si el usuario cambia de cuenta rapido, este callback (async) puede
      // resolver fuera de orden. Se guarda el uid con el que arranco y se
      // valida contra el usuario actual antes de aplicar el perfil cargado.
      const uidDeEsteCallback = usuario?.uid ?? null
      setAuthUser(usuario)
      if (usuario) {
        try {
          const snap = await getDoc(doc(db, 'usuarios', usuario.uid))
          if (auth.currentUser?.uid !== uidDeEsteCallback) return
          setPerfil(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        } catch (e) {
          if (auth.currentUser?.uid !== uidDeEsteCallback) return
          console.error('[Auth] No se pudo cargar el perfil:', e)
          setPerfil(null)
        }
      } else {
        setPerfil(null)
      }
      setCargando(false)
    })
    return unsub
  }, [])

  const iniciarSesion = (email, password) =>
    signInWithEmailAndPassword(auth, email, password)

  const cerrarSesion = () => fbSignOut(auth)

  const value = {
    authUser,
    perfil,
    activo: perfil?.activo === true,
    cargando,
    iniciarSesion,
    cerrarSesion
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
