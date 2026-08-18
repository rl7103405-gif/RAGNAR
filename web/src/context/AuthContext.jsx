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
      // El perfil ANTERIOR se limpia de inmediato, antes de ir por el nuevo.
      // Si no, durante el viaje a Firestore la app sigue mostrando (y usando)
      // el perfil de quien acaba de salir: en tablets compartidas eso significa
      // que la cuenta que entra hereda por un instante los permisos y el modo
      // -- real o de prueba -- de la anterior.
      setPerfil(null)
      setCargando(true)
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

  // Roles. El perfil de Firestore trae 'rol'.
  // Sin fallback: un perfil SIN rol no entra (antes caia a 'completo').
  //   captura  -> solo la pestana Captura (los pesadores: Angel, Juan)
  //   consulta -> SOLO LECTURA: historial, reportes, indicadores y registros
  //               (Cielo, que pasa las remisiones a Microsip pero no opera)
  //   completo -> todo menos autorizar correcciones (America, Lindbergh, Diana)
  //   almacen  -> avios (Alvaro; reservado, aun sin usar)
  //   admin    -> todo + autoriza correcciones de folios ya enviados (Roberto)
  //   maquila  -> EXTERNO: solo su portal (perfil.maquilaId dice cual)
  // Sin default permisivo, igual que las reglas: un perfil sin rol no entra.
  // Si algun dia se crea un perfil sin rol, la persona ve un mensaje claro en
  // vez de una app que se ve completa y truena en cada boton.
  //   produccion -> Adrian (jefe de produccion): sube el plan maestro que
  //                 agrupa las OT bajo su orden de compra. No opera embarques.
  const ROLES_INTERNOS = ['captura', 'completo', 'consulta', 'almacen', 'admin', 'produccion']
  const rol = perfil?.rol || ''
  // Mismo criterio que las reglas: un perfil con maquilaId NUNCA es interno,
  // aunque traiga un rol interno. Sin esto, un perfil hibrido veria la UI
  // interna mientras las reglas le rechazan todo (o peor: pasaria los gates
  // del cliente que las reglas si validan).
  const esInterno = ROLES_INTERNOS.includes(rol) && !perfil?.maquilaId
  // ¿Es una cuenta de PRUEBA? (web/scripts/crear_usuarios_prueba.mjs)
  // No es un permiso, es un MUNDO: decide en que consecutivo de folio interno
  // escribe y con que marca nacen sus documentos. Las reglas de Firestore lo
  // exigen igual, asi que esto es para que la app haga lo correcto sola, no
  // para impedir nada.
  const esPrueba = perfil?.esPrueba === true
  // 'real' | 'prueba' | null. NULL mientras no hay perfil cargado: quien vaya
  // a emitir tiene que esperar, en vez de asumir 'real' y quemar un folio del
  // consecutivo oficial con una cuenta de prueba (o al reves).
  const modoDatos = perfil ? (esPrueba ? 'prueba' : 'real') : null
  const value = {
    authUser,
    perfil,
    activo: perfil?.activo === true,
    rol,
    esInterno,
    esPrueba,
    modoDatos,
    // Operaciones de embarque (cargar Excel, emitir remisiones, folio interno,
    // catalogo de maquilas): no es trabajo de un pesador.
    // 'almacen' (Alvaro) no embarca producto: maneja avios.
    puedeEmbarcar: esInterno && ['completo', 'admin'].includes(rol),
    // Alvaro (almacen) y el admin: envios de avios a las maquilas, solicitudes
    // e inventario. El CATALOGO ya no es suyo: lo administra Cielo (abajo).
    puedeManejarAvios: esInterno && ['almacen', 'admin'].includes(rol),
    soloAlmacen: rol === 'almacen',
    // Usuario EXTERNO de una maquila: solo ve su portal.
    esMaquila: rol === 'maquila',
    maquilaId: perfil?.maquilaId || '',
    esAdmin: rol === 'admin',
    soloCaptura: rol === 'captura',
    // Capturar/editar bultos: ni consulta (Cielo) ni almacen (Alvaro).
    puedeOperar: esInterno && ['captura', 'completo', 'admin'].includes(rol),
    // Cielo: ve para llevar el control, pero no captura ni emite nada.
    soloConsulta: rol === 'consulta',
    // Adrian (produccion): sube el PLAN MAESTRO que dice que ordenes de
    // trabajo cuelgan de cada orden de compra del cliente. Es el dato que le
    // falta a Lindbergh para ver su avance agrupado, y hoy Adrian lo lleva en
    // un Excel aparte.
    puedeSubirPlanMaestro: esInterno && ['produccion', 'admin'].includes(rol),
    soloProduccion: rol === 'produccion',
    // Crear/asignar tareas: el admin siempre; los demas solo con el flag
    // puedeCrearTareas en su perfil (Lindbergh). America queda en false.
    puedeCrearTareas: esInterno && (rol === 'admin' || perfil?.puedeCrearTareas === true),
    // El CATALOGO de avios lo administra quien tenga este flag (Cielo) y el
    // admin. Decision de Roberto 2026-08-13: Alvaro manda material, pero las
    // claves del catalogo las controla Cielo.
    administraCatalogoAvios:
      esInterno && (rol === 'admin' || perfil?.administraCatalogoAvios === true),
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
