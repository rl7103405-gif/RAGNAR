// EL FORMULARIO DE CAMBIO DE CONTRASEÑA, en un solo lugar.
//
// Lo usan los DOS sitios donde se puede cambiar: el engrane del encabezado
// (AjustesCuenta) y la pestaña "Mi perfil". Vive aparte a proposito: tener dos
// copias de un formulario que cambia credenciales es garantizar que un dia se
// arregle una y la otra se quede con el fallo.
//
// La contrasena actual no se puede "ver": Firebase Auth no la guarda legible
// (solo un hash irreversible), asi que lo unico posible — y lo mas sano — es
// cambiarla confirmando primero la actual.
import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { auth } from '../firebase/config'

export const MIN_PASSWORD = 6

export default function CambiarContrasena({ onListo, textoBotonCerrar }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [esError, setEsError] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const avisar = (texto, error = false) => {
    setMensaje(texto)
    setEsError(error)
  }

  const onCambiar = async (e) => {
    e.preventDefault()
    avisar('')
    if (nueva.length < MIN_PASSWORD) {
      avisar(`La contrasena nueva debe tener al menos ${MIN_PASSWORD} caracteres.`, true)
      return
    }
    if (nueva !== confirmacion) {
      avisar('La confirmacion no coincide con la contrasena nueva.', true)
      return
    }
    setGuardando(true)
    try {
      // Se captura UNA vez: si la sesion expira o cambia (otra pestana) a
      // mitad del flujo, no se debe operar sobre un usuario distinto o null.
      const usuarioActual = auth.currentUser
      if (!usuarioActual?.email) {
        avisar('Tu sesion expiro. Vuelve a iniciar sesion.', true)
        return
      }
      // Reautenticar con la contrasena actual antes de cambiarla: Firebase lo
      // exige si la sesion lleva tiempo abierta, y ademas evita que alguien
      // cambie la contrasena de una sesion que encontro abierta.
      const credencial = EmailAuthProvider.credential(usuarioActual.email, actual)
      await reauthenticateWithCredential(usuarioActual, credencial)
      await updatePassword(usuarioActual, nueva)
      setActual('')
      setNueva('')
      setConfirmacion('')
      avisar('Contrasena cambiada. Usala la proxima vez que entres.')
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        avisar('La contrasena actual no es correcta.', true)
      } else if (err.code === 'auth/weak-password') {
        avisar('La contrasena nueva es demasiado debil.', true)
      } else if (err.code === 'auth/too-many-requests') {
        avisar('Demasiados intentos. Espera un momento.', true)
      } else {
        console.error('[CambiarContrasena] Error cambiando contrasena:', err)
        avisar('No se pudo cambiar la contrasena: ' + (err.message || err), true)
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={onCambiar}>
      <label className="campo">
        <span>Contrasena actual</span>
        <input
          type="password"
          autoComplete="current-password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          required
        />
      </label>
      <label className="campo">
        <span>Contrasena nueva (minimo {MIN_PASSWORD} caracteres)</span>
        <input
          type="password"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          required
        />
      </label>
      <label className="campo">
        <span>Repite la contrasena nueva</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          required
        />
      </label>

      {mensaje && <div className={esError ? 'alerta-error' : 'alerta-exito'}>{mensaje}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn-primario" type="submit" disabled={guardando}>
          {guardando ? 'Guardando...' : 'Cambiar contrasena'}
        </button>
        {/* El boton de cerrar solo tiene sentido dentro del modal del engrane;
            en la pestaña "Mi perfil" no hay nada que cerrar. */}
        {onListo && (
          <button className="btn-secundario" type="button" onClick={onListo} disabled={guardando}>
            {textoBotonCerrar || 'Cerrar'}
          </button>
        )}
      </div>
    </form>
  )
}
