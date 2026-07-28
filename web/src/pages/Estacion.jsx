// Pantalla unica de la estacion de prueba: captura folio + peso, guarda en
// Firestore, imprime etiqueta (via bridge local de Zebra) y genera el PDF de
// salida del dia -- reemplaza el paso manual de pasarselo a otra persona para
// que arme el Excel.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { normalizarFolio, canonizarFolio, validarPesoGramos } from '../utils/validacion'
import { imprimirEtiqueta } from '../utils/zebraBridge'
import { leerPesoBascula, motivoLecturaInvalida } from '../utils/basculaBridge'
import { resolverProductoEnTx, CRUCE_COMPLETO, CRUCE_SIN_RUTEO } from '../utils/cruceProducto'
import CargaRuteo from '../components/CargaRuteo'
import Maquilas from '../components/Maquilas'
import GenerarPdfModal from '../components/GenerarPdfModal'
import { getDoc } from 'firebase/firestore'

function inicioDeHoy() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Fecha local (no UTC) en formato AAAA-MM-DD, para detectar cuando cambia el
// dia sin depender de toISOString (que usa UTC y desfasaria la comparacion).
function fechaLocalTexto(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

export default function Estacion() {
  const { authUser, perfil, cerrarSesion } = useAuth()
  const [folio, setFolio] = useState('')
  const [pesoKg, setPesoKg] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [capturas, setCapturas] = useState([])
  const [datosConfirmados, setDatosConfirmados] = useState(true)
  const [imprimiendoFolio, setImprimiendoFolio] = useState(null)
  const [leyendoBascula, setLeyendoBascula] = useState(false)
  // Seleccion de folios para el PDF (Set de folios) + capturas de otros dias
  // agregadas tecleando su folio, menu ⋮ abierto y modal de edicion de peso.
  const [seleccion, setSeleccion] = useState(new Set())
  const [agregadas, setAgregadas] = useState([]) // capturas de otros dias
  const [folioAgregar, setFolioAgregar] = useState('')
  const [menuAbierto, setMenuAbierto] = useState(null)
  const [editando, setEditando] = useState(null) // captura en edicion de peso
  const [nuevoPesoKg, setNuevoPesoKg] = useState('')
  const [modalPdf, setModalPdf] = useState(false)
  const campoFolioRef = useRef(null)

  useEffect(() => {
    let cancelado = false
    let unsub = null
    let fechaSuscrita = null

    function suscribir() {
      if (unsub) unsub()
      const inicio = inicioDeHoy()
      fechaSuscrita = fechaLocalTexto(inicio)
      const q = query(
        collection(db, 'bultos'),
        where('creadoEn', '>=', Timestamp.fromDate(inicio)),
        orderBy('creadoEn', 'desc')
      )
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelado) return
          setCapturas(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          setDatosConfirmados(!snap.metadata.fromCache)
        },
        (err) => {
          if (cancelado) return
          console.error('[Estacion] Error escuchando capturas de hoy:', err)
          setError('No se pudieron cargar las capturas de hoy: ' + (err.message || err.code || err))
        }
      )
    }

    suscribir()
    // La pestana puede quedar abierta de un dia a otro: cada minuto se
    // revisa si cambio la fecha local y, si cambio, se vuelve a suscribir
    // con el nuevo limite de "hoy" (si no, "capturas de hoy" y el PDF
    // mezclarian datos de dos dias distintos).
    const intervalo = setInterval(() => {
      if (fechaLocalTexto(inicioDeHoy()) !== fechaSuscrita) {
        suscribir()
      }
    }, 60000)

    return () => {
      cancelado = true
      clearInterval(intervalo)
      if (unsub) unsub()
    }
  }, [])

  // Igual que enfocarFolio() en el app.js original: reenfoca el campo de
  // folio al volver a esta pestana/ventana, para que un lector de folios
  // (que "escribe" en el campo con foco) siga funcionando sin tener que
  // hacer clic primero.
  useEffect(() => {
    const reenfocar = () => campoFolioRef.current?.focus()
    window.addEventListener('focus', reenfocar)
    return () => window.removeEventListener('focus', reenfocar)
  }, [])

  // Higiene de seleccion/menu: si un folio deja de estar en capturas o
  // agregadas (se elimino, o cambio el dia y salio de "hoy"), se saca de la
  // seleccion y se cierra el menu si era el suyo -- si no, quedarian folios
  // "fantasma" seleccionados sin fila visible en la tabla.
  useEffect(() => {
    const foliosVisibles = new Set([
      ...capturas.map((c) => c.folio),
      ...agregadas.map((c) => c.folio)
    ])
    setSeleccion((prev) => {
      let cambio = false
      const nueva = new Set()
      prev.forEach((f) => {
        if (foliosVisibles.has(f)) nueva.add(f)
        else cambio = true
      })
      return cambio ? nueva : prev
    })
    setMenuAbierto((prev) => (prev !== null && !foliosVisibles.has(prev) ? null : prev))
  }, [capturas, agregadas])

  // Cierra el menu ⋮ al hacer clic fuera de el (o de su boton). Se marca la
  // celda de acciones con la clase 'menu-acciones' para distinguir un clic
  // "de adentro" (que ya lo maneja su propio onClick) de uno realmente
  // externo.
  useEffect(() => {
    if (menuAbierto === null) return
    const cerrar = (e) => {
      if (e.target.closest && e.target.closest('.menu-acciones')) return
      setMenuAbierto(null)
    }
    document.addEventListener('click', cerrar)
    return () => document.removeEventListener('click', cerrar)
  }, [menuAbierto])

  const totalKg = useMemo(
    () => capturas.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000,
    [capturas]
  )

  const onLeerBascula = async () => {
    setError('')
    setAviso('')
    setLeyendoBascula(true)
    try {
      const lectura = await leerPesoBascula()
      const motivo = motivoLecturaInvalida(lectura)
      if (motivo) {
        setError('Bascula: ' + motivo)
        return
      }
      setPesoKg((lectura.peso / 1000).toFixed(2))
    } catch (err) {
      setError(
        'No se pudo conectar con la bascula (bridge/bascula_bridge.py). ' +
          (err.message || err)
      )
    } finally {
      setLeyendoBascula(false)
    }
  }

  const onGuardar = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    setGuardando(true)
    try {
      const folioNormalizado = canonizarFolio(normalizarFolio(folio))
      const pesoGramos = validarPesoGramos(Math.round(Number(pesoKg) * 1000))
      const ref = doc(db, 'bultos', folioNormalizado)

      // 1) Lectura (en transaccion, para leer un snapshot consistente) que
      // solo sirve para decidir si hay que pedir confirmacion de
      // sobrescritura -- no escribe nada todavia.
      const infoInicial = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        return snap.exists()
          ? {
              existe: true,
              pesoGramos: snap.data().pesoGramos,
              actualizadoEnMillis: snap.data().actualizadoEn?.toMillis() ?? null
            }
          : { existe: false }
      })

      // 2) El dialogo de confirmacion queda FUERA de cualquier transaccion
      // (no se puede abrir un dialogo bloqueante dentro de una transaccion
      // de Firestore, que ademas puede reintentarse sola).
      if (infoInicial.existe) {
        const confirmar = window.confirm(
          `El folio ${folioNormalizado} ya fue capturado con ${(infoInicial.pesoGramos / 1000).toFixed(2)} kg. ` +
            '¿Sobrescribirlo con el nuevo peso?'
        )
        if (!confirmar) {
          setGuardando(false)
          return
        }
      }

      // 3) Segunda transaccion: vuelve a leer y solo escribe si la
      // situacion sigue siendo la misma que se le mostro al operador en el
      // paso 2 (mismo peso si ya existia, o que siga sin existir si era
      // nuevo). Si algo cambio mientras se mostraba el confirm(), aborta en
      // vez de pisar a ciegas. En la misma transaccion se resuelve el cruce
      // folio -> Excel del dia -> catalogo y se congela como snapshot en el
      // documento (el PDF usa ese snapshot, no los datos "vivos").
      const cruceResuelto = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        const { producto, cruce, catalogoVersion } = await resolverProductoEnTx(tx, folioNormalizado)
        const datosBulto = {
          folio: folioNormalizado,
          pesoGramos,
          operadorUid: authUser.uid,
          operadorNombre: perfil?.nombreCompleto || 'Estacion',
          producto,
          cruce,
          catalogoVersion,
          actualizadoEn: serverTimestamp()
        }
        if (infoInicial.existe) {
          if (!snap.exists()) {
            throw new Error(
              `El folio ${folioNormalizado} ya no existe (alguien lo elimino mientras confirmabas). Vuelve a intentarlo.`
            )
          }
          if (snap.data().pesoGramos !== infoInicial.pesoGramos) {
            throw new Error(
              `El peso de ${folioNormalizado} cambio a ${(snap.data().pesoGramos / 1000).toFixed(2)} kg mientras confirmabas la sobrescritura. Revisa el valor actual y vuelve a intentarlo.`
            )
          }
          if ((snap.data().actualizadoEn?.toMillis() ?? null) !== infoInicial.actualizadoEnMillis) {
            throw new Error(
              `El folio ${folioNormalizado} fue modificado por otra estacion mientras confirmabas. Revisa y vuelve a intentarlo.`
            )
          }
          // creadoEn se preserva: representa cuando se capturo por primera
          // vez, no la ultima edicion.
          tx.set(ref, { ...datosBulto, creadoEn: snap.data().creadoEn })
        } else {
          if (snap.exists()) {
            throw new Error(
              `El folio ${folioNormalizado} ya fue capturado por otra estacion mientras confirmabas (${(snap.data().pesoGramos / 1000).toFixed(2)} kg). Verifica antes de continuar.`
            )
          }
          tx.set(ref, { ...datosBulto, creadoEn: serverTimestamp() })
        }
        return { producto, cruce }
      })

      setFolio('')
      setPesoKg('')
      // Reenfoca el campo de folio para el siguiente escaneo (igual que el
      // app.js original: campoFolio.focus() tras guardar).
      campoFolioRef.current?.focus()

      // El folio ya quedo guardado, que es lo importante. Si falla la
      // impresion no se deshace el guardado: se avisa distinto y el
      // operador puede reintentar con el boton "Imprimir etiqueta" de la
      // tabla.
      let notaCruce = ''
      if (cruceResuelto.cruce === CRUCE_SIN_RUTEO) {
        notaCruce = ' AVISO: este folio NO viene en el Excel del dia; salio sin datos de producto.'
      } else if (cruceResuelto.cruce !== CRUCE_COMPLETO) {
        notaCruce = ` AVISO: el codigo ${cruceResuelto.producto?.codigo || '?'} no esta en el catalogo de productos.`
      } else {
        notaCruce = ` Producto: ${cruceResuelto.producto.codigo} ${cruceResuelto.producto.descripcion || ''}.`
      }

      const fecha = new Date().toLocaleDateString('es-MX')
      const resultadoImpresion = await imprimirEtiqueta({
        folio: folioNormalizado,
        pesoGramos,
        fecha,
        codigoProducto: cruceResuelto.producto?.codigo || '',
        docenas: cruceResuelto.producto?.docenas ?? '',
        pedidoId: cruceResuelto.producto?.pedido || ''
      })
      if (resultadoImpresion.enviado) {
        setAviso(`Folio ${folioNormalizado} guardado (${(pesoGramos / 1000).toFixed(2)} kg) y etiqueta enviada a la impresora.${notaCruce}`)
      } else {
        // La nota del cruce se muestra tambien aqui: aunque falle la
        // impresora, el operador necesita saber si el folio cruzo bien con
        // el Excel/catalogo o quedo sin datos de producto.
        setError(
          `Folio ${folioNormalizado} guardado, pero no se pudo imprimir la etiqueta: ${resultadoImpresion.mensaje}. ` +
            `Usa "Imprimir etiqueta" en la tabla para reintentar.${notaCruce}`
        )
      }
    } catch (err) {
      setError(err.message || 'No se pudo guardar el folio.')
    } finally {
      setGuardando(false)
    }
  }

  const onImprimir = async (captura) => {
    setError('')
    setAviso('')
    setImprimiendoFolio(captura.folio)
    try {
      const fecha = new Date().toLocaleDateString('es-MX')
      const resultado = await imprimirEtiqueta({
        folio: captura.folio,
        pesoGramos: captura.pesoGramos,
        fecha,
        codigoProducto: captura.producto?.codigo || '',
        docenas: captura.producto?.docenas ?? '',
        pedidoId: captura.producto?.pedido || ''
      })
      if (resultado.enviado) {
        setAviso(`Etiqueta de ${captura.folio} enviada a la impresora.`)
      } else {
        setError(`No se imprimio la etiqueta de ${captura.folio}: ${resultado.mensaje}`)
      }
    } finally {
      setImprimiendoFolio(null)
    }
  }

  // ---- Seleccion de folios para el PDF ----
  const toggleSeleccion = (folio) => {
    const nueva = new Set(seleccion)
    if (nueva.has(folio)) nueva.delete(folio)
    else nueva.add(folio)
    setSeleccion(nueva)
  }

  const todasHoySeleccionadas =
    capturas.length > 0 && capturas.every((c) => seleccion.has(c.folio))

  const toggleTodasHoy = () => {
    const nueva = new Set(seleccion)
    if (todasHoySeleccionadas) {
      capturas.forEach((c) => nueva.delete(c.folio))
    } else {
      capturas.forEach((c) => nueva.add(c.folio))
    }
    setSeleccion(nueva)
  }

  // Agregar un folio tecleado (puede ser de otro dia): se busca su captura
  // real en Firestore y se suma a la tabla/seleccion.
  const onAgregarFolio = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    try {
      const folioBuscado = canonizarFolio(normalizarFolio(folioAgregar))
      if (capturas.some((c) => c.folio === folioBuscado) || agregadas.some((c) => c.folio === folioBuscado)) {
        toggleSeleccion(folioBuscado)
        setFolioAgregar('')
        return
      }
      const snap = await getDoc(doc(db, 'bultos', folioBuscado))
      if (!snap.exists()) {
        setError(`El folio ${folioBuscado} no esta capturado (ni hoy ni antes).`)
        return
      }
      setAgregadas([...agregadas, { id: snap.id, ...snap.data() }])
      setSeleccion(new Set([...seleccion, folioBuscado]))
      setFolioAgregar('')
    } catch (err) {
      setError(err.message || 'Folio invalido.')
    }
  }

  // ---- Editar peso / eliminar (menu ⋮) ----
  const onEliminar = async (captura) => {
    setMenuAbierto(null)
    // Se captura ANTES del confirm (que queda abierto un rato, tiempo en el
    // que otra sesion podria editar esta misma captura): si al confirmar
    // resulta que ya no es la misma version, se aborta en vez de borrar a
    // ciegas la version nueva que el operador nunca vio.
    const actualizadoEnMillis = captura.actualizadoEn?.toMillis ? captura.actualizadoEn.toMillis() : null
    const confirmar = window.confirm(
      `¿Eliminar la captura del folio ${captura.folio} (${(captura.pesoGramos / 1000).toFixed(2)} kg)?\n\n` +
        'OJO: si su etiqueta ya se imprimio o salio en un PDF, esos papeles quedaran sin respaldo en el sistema.'
    )
    if (!confirmar) return
    setError('')
    setAviso('')
    try {
      const ref = doc(db, 'bultos', captura.folio)
      const resultado = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) return 'no_existe'
        const actualDeSnap = snap.data().actualizadoEn?.toMillis ? snap.data().actualizadoEn.toMillis() : null
        if (actualDeSnap !== actualizadoEnMillis) return 'cambio'
        tx.delete(ref)
        return 'eliminado'
      })
      const nueva = new Set(seleccion)
      nueva.delete(captura.folio)
      setSeleccion(nueva)
      setAgregadas(agregadas.filter((c) => c.folio !== captura.folio))
      if (resultado === 'eliminado') {
        setAviso(`Captura del folio ${captura.folio} eliminada.`)
      } else if (resultado === 'no_existe') {
        setAviso(`La captura del folio ${captura.folio} ya no existia (alguien mas la elimino).`)
      } else {
        setError(`La captura de ${captura.folio} cambio mientras confirmabas; revisa y vuelve a intentar.`)
      }
    } catch (err) {
      setError(`No se pudo eliminar ${captura.folio}: ` + (err.message || err))
    }
  }

  const abrirEdicion = (captura) => {
    setMenuAbierto(null)
    setEditando(captura)
    setNuevoPesoKg((captura.pesoGramos / 1000).toFixed(2))
  }

  const onGuardarPeso = async () => {
    setError('')
    setAviso('')
    try {
      const pesoGramos = validarPesoGramos(Math.round(Number(nuevoPesoKg) * 1000))
      const ref = doc(db, 'bultos', editando.folio)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) {
          throw new Error(`La captura de ${editando.folio} ya no existe (alguien la elimino).`)
        }
        // Solo cambia el peso: el snapshot de producto y creadoEn se
        // conservan tal cual estaban al capturar.
        tx.set(ref, { ...snap.data(), pesoGramos, actualizadoEn: serverTimestamp() })
      })
      // Las capturas de OTROS dias (agregadas) no tienen onSnapshot que las
      // refresque solas: sin esto, la tabla se quedaria mostrando el peso
      // viejo y reabrir "Editar peso" precargaria ese mismo valor viejo.
      setAgregadas((prev) =>
        prev.map((a) => (a.folio === editando.folio ? { ...a, pesoGramos } : a))
      )
      setAviso(
        `Peso de ${editando.folio} actualizado a ${(pesoGramos / 1000).toFixed(2)} kg. ` +
          'OJO: si su etiqueta ya se imprimio, ya no coincide — usa "Imprimir etiqueta" para reimprimirla.'
      )
      setEditando(null)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el peso.')
    }
  }

  return (
    <div className="layout">
      <div className="barra-superior">
        <div className="barra-titulo">RAGNAR - Estacion de captura</div>
        <div className="barra-usuario">
          <Link to="/historial" className="btn-secundario" style={{ textDecoration: 'none' }}>
            Historial
          </Link>
          <span className="usuario-nombre">{perfil?.nombreCompleto || 'Estacion'}</span>
          <button className="btn-salir" onClick={cerrarSesion}>Salir</button>
        </div>
      </div>

      <div className="contenido">
        <CargaRuteo />

        <form className="tarjeta" onSubmit={onGuardar} style={{ marginBottom: 18 }}>
          <h2>Capturar folio</h2>
          <label className="campo">
            <span>Folio</span>
            <input
              type="text"
              ref={campoFolioRef}
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              autoFocus
              autoComplete="off"
              required
            />
          </label>
          <label className="campo">
            <span>Peso (kg)</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={pesoKg}
                onChange={(e) => setPesoKg(e.target.value)}
                style={{ flex: 1 }}
                required
              />
              <button
                type="button"
                className="btn-secundario"
                onClick={onLeerBascula}
                disabled={leyendoBascula}
              >
                {leyendoBascula ? 'Leyendo...' : 'Leer bascula'}
              </button>
            </div>
          </label>

          {error && <div className="alerta-error">{error}</div>}
          {aviso && <div className="alerta-exito">{aviso}</div>}

          <button className="btn-primario btn-grande" type="submit" disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar y generar etiqueta'}
          </button>
        </form>

        <Maquilas />

        <div className="tarjeta">
          <h2>Capturas de hoy ({capturas.length}) - {totalKg.toFixed(2)} kg</h2>
          {!datosConfirmados && (
            <div className="alerta-error" style={{ marginBottom: 12 }}>
              Datos no confirmados, verifica tu conexion.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <form onSubmit={onAgregarFolio} style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Agregar folio al PDF (de cualquier dia)"
                value={folioAgregar}
                onChange={(e) => setFolioAgregar(e.target.value)}
                style={{ width: 240 }}
              />
              <button className="btn-secundario" type="submit" disabled={!folioAgregar.trim()}>
                Agregar
              </button>
            </form>
            <button
              className="btn-secundario"
              onClick={() => setModalPdf(true)}
              disabled={!datosConfirmados || seleccion.size === 0}
              title={seleccion.size === 0 ? 'Selecciona folios con las casillas de la tabla' : ''}
            >
              Generar PDF de salida ({seleccion.size} seleccionados)
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={todasHoySeleccionadas}
                    onChange={toggleTodasHoy}
                    disabled={capturas.length === 0}
                    title="Seleccionar todas las de hoy"
                  />
                </th>
                <th style={{ textAlign: 'left' }}>Folio</th>
                <th style={{ textAlign: 'left' }}>Codigo</th>
                <th style={{ textAlign: 'left' }}>Producto</th>
                <th style={{ textAlign: 'left' }}>Peso (kg)</th>
                <th style={{ textAlign: 'left' }}>Hora</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...capturas, ...agregadas.filter((a) => !capturas.some((c) => c.folio === a.folio))].map((c) => (
                <tr key={c.id} style={agregadas.some((a) => a.folio === c.folio) ? { background: '#f6f9ff' } : undefined}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={seleccion.has(c.folio)}
                      onChange={() => toggleSeleccion(c.folio)}
                    />
                  </td>
                  <td>{c.folio}</td>
                  <td>{c.producto?.codigo || (c.cruce === 'sin_ruteo' ? 'SIN RUTEO' : '-')}</td>
                  <td>{c.producto?.descripcion || '-'}</td>
                  <td>{(c.pesoGramos / 1000).toFixed(2)}</td>
                  <td>{c.creadoEn?.toDate ? c.creadoEn.toDate().toLocaleDateString('es-MX') === new Date().toLocaleDateString('es-MX')
                    ? c.creadoEn.toDate().toLocaleTimeString('es-MX')
                    : c.creadoEn.toDate().toLocaleDateString('es-MX')
                    : '-'}</td>
                  <td className="menu-acciones" style={{ position: 'relative', textAlign: 'right' }}>
                    <button
                      className="btn-secundario"
                      onClick={() => setMenuAbierto(menuAbierto === c.folio ? null : c.folio)}
                      aria-label={`Opciones de ${c.folio}`}
                    >
                      ⋮
                    </button>
                    {menuAbierto === c.folio && (
                      <div
                        style={{
                          position: 'absolute', right: 0, top: '100%', zIndex: 20,
                          background: '#fff', border: '1px solid #ccc', borderRadius: 6,
                          boxShadow: '0 4px 10px rgba(0,0,0,0.15)', minWidth: 170,
                          display: 'flex', flexDirection: 'column'
                        }}
                      >
                        <button
                          className="btn-menu"
                          style={{ padding: '8px 12px', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer' }}
                          disabled={imprimiendoFolio === c.folio}
                          onClick={() => { setMenuAbierto(null); onImprimir(c) }}
                        >
                          {imprimiendoFolio === c.folio ? 'Imprimiendo...' : 'Imprimir etiqueta'}
                        </button>
                        <button
                          className="btn-menu"
                          style={{ padding: '8px 12px', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer' }}
                          onClick={() => abrirEdicion(c)}
                        >
                          Editar peso
                        </button>
                        <button
                          className="btn-menu"
                          style={{ padding: '8px 12px', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', color: '#a00' }}
                          onClick={() => onEliminar(c)}
                        >
                          Eliminar
                        </button>
                      </div>
                    )}
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
          <div className="tarjeta" style={{ width: 'min(380px, 92vw)' }}>
            <h2>Editar peso — folio {editando.folio}</h2>
            <label className="campo">
              <span>Peso (kg)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={nuevoPesoKg}
                onChange={(e) => setNuevoPesoKg(e.target.value)}
                autoFocus
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-primario" onClick={onGuardarPeso}>Guardar</button>
              <button className="btn-secundario" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {modalPdf && (
        <GenerarPdfModal
          folios={[...seleccion]}
          operador={perfil?.nombreCompleto || 'Estacion'}
          onCerrar={() => setModalPdf(false)}
          onListo={(mensaje) => {
            setModalPdf(false)
            setAviso(mensaje)
          }}
          onDepurar={(foliosInexistentes) => {
            const idsInexistentes = new Set(foliosInexistentes)
            setSeleccion((prev) => {
              const nueva = new Set(prev)
              idsInexistentes.forEach((f) => nueva.delete(f))
              return nueva
            })
            setAgregadas((prev) => prev.filter((c) => !idsInexistentes.has(c.folio)))
          }}
        />
      )}
    </div>
  )
}
