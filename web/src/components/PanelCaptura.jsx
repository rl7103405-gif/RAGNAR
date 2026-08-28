// Pestana Captura: captura folio + peso, guarda en Firestore, imprime la
// etiqueta (via bridge local de Zebra) y arma el PDF de salida -- reemplaza
// el paso manual de pasarselo a otra persona para que arme el Excel.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
import { agruparPorOt, etiquetaOt } from '../utils/agruparOt'
import { mapaOtAOc } from '../utils/planMaestro'
import { docenasDeCaptura } from '../utils/reimprimir'
import {
  registrarCambio,
  autorizacionVigente,
  consumirAutorizacion,
  pedirCorreccion
} from '../utils/auditoria'
import GenerarPdfModal from './GenerarPdfModal'
import { getDoc } from 'firebase/firestore'
import { bultoEsDePrueba, normalizarPrefijoPrueba, soloDeMiMundo } from '../utils/mundoDatos'

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

export default function PanelCaptura() {
  const { authUser, perfil, esAdmin, puedeEmbarcar, esPrueba } = useAuth()
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
  // Vista previa del folio que se esta escribiendo/escaneando: se consulta el
  // ruteo del dia para que el operador VEA el producto antes de guardar y
  // detecte al instante un folio tecleado mal.
  const [vistaPrevia, setVistaPrevia] = useState(null) // { estado, folio, producto, yaCapturado }
  const campoFolioRef = useRef(null)

  // Ventana de la suscripcion: se escuchan los bultos de los ultimos
  // DIAS_VENTANA dias (no solo los de hoy). Antes la consulta arrancaba en
  // "inicio de hoy" y los folios capturados ayer que aun NO habian salido en
  // un PDF desaparecian de Captura al cambiar el dia: America se quedaba sin
  // poder generarles el PDF. Ahora los PENDIENTES siguen aqui, agrupados por
  // dia, hasta que salgan en un documento.
  const DIAS_VENTANA = 30

  useEffect(() => {
    let cancelado = false
    let unsub = null
    let fechaSuscrita = null

    function suscribir() {
      if (unsub) unsub()
      const inicio = inicioDeHoy()
      fechaSuscrita = fechaLocalTexto(inicio)
      const desde = new Date(inicio)
      desde.setDate(desde.getDate() - (DIAS_VENTANA - 1))
      const q = query(
        // (el filtro por mundo va abajo, sobre el resultado)
        collection(db, 'bultos'),
        where('creadoEn', '>=', Timestamp.fromDate(desde)),
        orderBy('creadoEn', 'desc')
      )
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelado) return
          // Cada quien ve las capturas de SU mundo. Sin esto, los folios
          // ZZTEST de una prueba le aparecen a America en la tabla de hoy
          // como un bulto mas: los puede palomear y meter en una remision
          // REAL -- las reglas la dejan, porque para un usuario real un
          // ZZTEST es un folio como cualquier otro. Y cuando despues se corra
          // el limpiador, ese bulto desaparece y el papel queda apuntando a
          // un folio que ya no existe (se arregla solo con el circuito de
          // correccion: solicitud, permiso de Roberto y reemision).
          setCapturas(
            soloDeMiMundo(
              snap.docs.map((d) => ({ id: d.id, ...d.data() })),
              esPrueba,
              bultoEsDePrueba
            )
          )
          setDatosConfirmados(!snap.metadata.fromCache)
        },
        (err) => {
          if (cancelado) return
          console.error('[Estacion] Error escuchando capturas:', err)
          setError('No se pudieron cargar las capturas: ' + (err.message || err.code || err))
        }
      )
    }

    suscribir()
    // La pestana puede quedar abierta de un dia a otro: cada minuto se revisa
    // si cambio la fecha local y, si cambio, se vuelve a suscribir para que la
    // ventana de dias avance y el agrupado por dia muestre el dia correcto.
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
    // esPrueba: al cambiar de cuenta hay que rearmar la suscripcion, o la
    // sesion nueva sigue viendo la tabla del mundo anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esPrueba])

  // Vista previa del folio escrito/escaneado: consulta el ruteo del dia (y el
  // bulto, para avisar si ya se capturo) con un pequeno retraso para no
  // disparar una lectura por cada tecla. Solo lee; no escribe nada.
  useEffect(() => {
    const folioLimpio = folio.trim()
    if (!folioLimpio) {
      setVistaPrevia(null)
      return
    }
    let cancelado = false
    setVistaPrevia({ estado: 'consultando', folio: folioLimpio })
    const temporizador = setTimeout(async () => {
      let folioCanonico
      try {
        folioCanonico = canonizarFolio(normalizarFolio(folioLimpio))
      } catch {
        if (!cancelado) setVistaPrevia({ estado: 'invalido', folio: folioLimpio })
        return
      }
      try {
        const [ruteoSnap, bultoSnap] = await Promise.all([
          getDoc(doc(db, 'foliosRuteo', folioCanonico)),
          getDoc(doc(db, 'bultos', folioCanonico))
        ])
        if (cancelado) return
        const yaCapturado = bultoSnap.exists() ? bultoSnap.data() : null
        if (!ruteoSnap.exists()) {
          setVistaPrevia({ estado: 'sin_ruteo', folio: folioCanonico, yaCapturado })
          return
        }
        setVistaPrevia({
          estado: 'ok',
          folio: folioCanonico,
          producto: ruteoSnap.data(),
          yaCapturado
        })
      } catch (err) {
        if (cancelado) return
        console.error('[PanelCaptura] Error consultando la vista previa:', err)
        setVistaPrevia({ estado: 'error', folio: folioCanonico })
      }
    }, 250)
    return () => {
      cancelado = true
      clearTimeout(temporizador)
    }
  }, [folio])

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

  // Las capturas visibles (hoy + agregadas de otro dia, sin duplicar) se
  // dividen en DOS secciones: las que todavia no salen en ningun PDF de
  // salida y las que ya se enviaron (marcador pdfGeneradoEn, puesto por
  // GenerarPdfModal). Recapturar o editar el peso borra el marcador y el
  // folio regresa solo a "pendientes".
  const visibles = useMemo(
    () => [...capturas, ...agregadas.filter((a) => !capturas.some((c) => c.folio === a.folio))],
    [capturas, agregadas]
  )
  const pendientes = useMemo(() => visibles.filter((c) => !c.pdfGeneradoEn), [visibles])
  // Los "ya enviados" se limitan a los PDF generados HOY: son referencia de lo
  // que acaba de salir. Se filtra por la fecha del PDF (no la de captura):
  // un folio capturado ayer pero mandado a PDF hoy tambien "acaba de salir",
  // y filtrarlo por creadoEn lo desapareceria de las dos secciones.
  const hoyTexto = fechaLocalTexto(new Date())
  const enviados = useMemo(
    () =>
      visibles.filter(
        (c) => c.pdfGeneradoEn?.toDate && fechaLocalTexto(c.pdfGeneradoEn.toDate()) === hoyTexto
      ),
    [visibles, hoyTexto]
  )

  const kgDe = (lista) => lista.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000
  // La ORDEN DE COMPRA de cada OT, del plan vigente. Roberto la pidio el
  // 28-08: "en los pendientes, dividirlo por OC, para ver si los que estan
  // capturando estan ligados a una OC o no". Una sola lectura, y si no hay
  // plan se enseña "sin OC", que es justo el dato que hay que ver.
  const [otAOc, setOtAOc] = useState(() => new Map())
  useEffect(() => {
    let vivo = true
    mapaOtAOc().then((m) => vivo && setOtAOc(m))
    return () => {
      vivo = false
    }
  }, [])
  const ocDeOt = (ot) => otAOc.get(String(ot || '').trim()) || ''

  const gruposPendientes = useMemo(() => agruparPorOt(pendientes), [pendientes])
  const gruposEnviados = useMemo(() => agruparPorOt(enviados), [enviados])

  // Colapsado de OT: las de "ya enviados" arrancan cerradas (se acumulan sin
  // parar) y se abren bajo demanda; las pendientes arrancan abiertas y se
  // pueden cerrar. Por eso dos conjuntos con semantica inversa.
  const [otsAbiertas, setOtsAbiertas] = useState(new Set())
  const [otsCerradas, setOtsCerradas] = useState(new Set())

  const toggleOt = (clave, esEnviados) => {
    const setter = esEnviados ? setOtsAbiertas : setOtsCerradas
    setter((prev) => {
      const nueva = new Set(prev)
      if (nueva.has(clave)) nueva.delete(clave)
      else nueva.add(clave)
      return nueva
    })
  }

  // Dia de la captura, corto y con "Hoy"/"Ayer" cuando aplica: los pendientes
  // ya no se agrupan por dia, asi que este dato tiene que leerse de un vistazo
  // en el renglon.
  const fechaCortaDeCaptura = (c) => {
    const fecha = c.creadoEn?.toDate ? c.creadoEn.toDate() : null
    if (!fecha) return '-'
    const clave = fechaLocalTexto(fecha)
    if (clave === hoyTexto) return 'Hoy'
    const ayer = new Date()
    ayer.setDate(ayer.getDate() - 1)
    if (clave === fechaLocalTexto(ayer)) return 'Ayer'
    return fecha.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
  }

  const horaDeCaptura = (c) => {
    const fecha = c.creadoEn?.toDate ? c.creadoEn.toDate() : null
    if (!fecha) return '-'
    return fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  const infoPdfDeCaptura = (c) => {
    const fecha = c.pdfGeneradoEn?.toDate ? c.pdfGeneradoEn.toDate().toLocaleDateString('es-MX') : '-'
    const interno = c.pdfFolioInterno != null ? `#${c.pdfFolioInterno}` : '-'
    return `${interno} · ${fecha}`
  }

  // Fila de una captura en la tabla (se renderiza dentro de su grupo de OT).
  const renderFilaCaptura = (c, conColumnaPdf = false) => (
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
      <td>{docenasDeCaptura(c) || '-'}</td>
      <td>{c.operadorNombre || '-'}</td>
      {/* Dia y hora SIEMPRE separados y siempre visibles: ahora que los
          pendientes se agrupan por OT (no por dia), el renglon es el unico
          lugar donde queda constancia de CUANDO se capturo. */}
      <td style={{ whiteSpace: 'nowrap' }}>{fechaCortaDeCaptura(c)}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{horaDeCaptura(c)}</td>
      {conColumnaPdf && (
        <td style={{ whiteSpace: 'nowrap', color: '#556', fontSize: 13 }}>{infoPdfDeCaptura(c)}</td>
      )}
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
  )

  // Tabla agrupada por OT, compartida por las dos secciones (pendientes y
  // ya enviados). conColumnaPdf agrega la columna con el folio interno y la
  // fecha del PDF en que salio cada folio.
  // Recibe los grupos YA armados (memoizados arriba): agrupar + ordenar en
  // cada render se sentiria en el tecleo del campo de folio con listas largas.
  const renderTablaAgrupada = (grupos, { conColumnaPdf = false, textoVacio }) => {
    const columnas = conColumnaPdf ? 11 : 10
    if (grupos.length === 0) {
      return <p className="texto-suave">{textoVacio}</p>
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th></th>
            <th style={{ textAlign: 'left' }}>Folio</th>
            <th style={{ textAlign: 'left' }}>Codigo</th>
            <th style={{ textAlign: 'left' }}>Producto</th>
            <th style={{ textAlign: 'left' }}>Peso (kg)</th>
            <th style={{ textAlign: 'left' }}>Docenas</th>
            <th style={{ textAlign: 'left' }}>Capturo</th>
            <th style={{ textAlign: 'left' }}>Dia</th>
            <th style={{ textAlign: 'left' }}>Hora</th>
            {conColumnaPdf && <th style={{ textAlign: 'left' }}>PDF</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {grupos.map(({ ot, filas, kg }) => {
            const otCompleta = filas.every((f) => seleccion.has(f.folio))
            const conAgregadas = filas.some((f) => agregadas.some((a) => a.folio === f.folio))
            const sufijoTitulo = conAgregadas ? ' (incluye folios agregados de otro día)' : ''
            const docenasOt = filas.reduce((acc, f) => acc + docenasDeCaptura(f), 0)
            // Con la agrupacion por OT, una misma OT puede juntar capturas de
            // hoy y de dias anteriores: se avisa en el encabezado para que no
            // pase desapercibido lo rezagado.
            const conDiasAnteriores =
              !conColumnaPdf &&
              filas.some(
                (f) => f.creadoEn?.toDate && fechaLocalTexto(f.creadoEn.toDate()) !== hoyTexto
              )
            // Las OT de la seccion "ya enviados" arrancan CERRADAS (son las
            // que crecen sin parar); las pendientes, abiertas, porque son el
            // trabajo del momento.
            const claveOt = `${conColumnaPdf ? 'env' : 'pend'}:${ot}`
            const abierta = conColumnaPdf ? otsAbiertas.has(claveOt) : !otsCerradas.has(claveOt)
            return (
              <Fragment key={ot}>
                <tr style={{ background: '#eef2f7', borderTop: '2px solid #c6d0dc' }}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={otCompleta}
                      onChange={() =>
                        setSeleccion((prev) => {
                          const nueva = new Set(prev)
                          filas.forEach((f) =>
                            otCompleta ? nueva.delete(f.folio) : nueva.add(f.folio)
                          )
                          return nueva
                        })
                      }
                      title={(otCompleta ? `Quitar toda la OT ${ot}` : `Seleccionar toda la OT ${ot}`) + sufijoTitulo}
                    />
                  </td>
                  <td
                    colSpan={columnas - 1}
                    onClick={() => toggleOt(claveOt, conColumnaPdf)}
                    style={{ fontWeight: 700, padding: '8px 4px', cursor: 'pointer' }}
                    title={abierta ? 'Cerrar esta OT' : 'Abrir esta OT'}
                  >
                    <span style={{ display: 'inline-block', width: 18 }}>{abierta ? '▾' : '▸'}</span>
                    {etiquetaOt(ot)}
                    {/* La ORDEN DE COMPRA de esta OT. Cuando falta se dice en
                        ambar y con todas sus letras: no es un adorno, quiere
                        decir que esa OT no esta en el plan vigente y hay que
                        subirlo. */}
                    {ocDeOt(ot) ? (
                      <span style={{ fontWeight: 400, color: '#334155', marginLeft: 10, fontSize: 13 }}>
                        · OC {ocDeOt(ot)}
                      </span>
                    ) : (
                      <span style={{ fontWeight: 600, color: '#d97706', marginLeft: 10, fontSize: 13 }}>
                        · sin orden de compra
                      </span>
                    )}
                    <span style={{ fontWeight: 400, color: '#556', marginLeft: 10, fontSize: 13 }}>
                      {filas.length} folio{filas.length === 1 ? '' : 's'}
                      {docenasOt > 0 ? ` - ${docenasOt} docenas` : ''} - {kg.toFixed(2)} kg
                      {conAgregadas ? ' - incluye folios de otro día' : ''}
                    </span>
                    {conDiasAnteriores && (
                      <span style={{ color: '#8a5300', marginLeft: 10, fontSize: 13, fontWeight: 400 }}>
                        incluye pendientes de dias anteriores
                      </span>
                    )}
                  </td>
                </tr>
                {abierta && filas.map((c) => renderFilaCaptura(c, conColumnaPdf))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    )
  }

  // ¿Se puede corregir este folio? Un folio que todavia NO salio en PDF se
  // corrige libre (queda en bitacora). Uno que YA salio necesita ser admin o
  // tener una autorizacion aprobada por Roberto; si no la hay, se ofrece
  // mandar la solicitud.
  const verificarPermisoCorreccion = async (captura, tipo) => {
    if (!captura.pdfGeneradoEn) {
      return { puede: true, motivo: null, autorizacionId: null, solicitudId: null }
    }
    if (esAdmin) {
      const motivo = window.prompt(
        `El folio ${captura.folio} ya salio en un PDF. Como administrador puedes corregirlo.\n\n` +
          'Escribe el motivo (queda en la bitacora):'
      )
      if (motivo === null) return { puede: false }
      if (!motivo.trim()) {
        setError('Hace falta el motivo para dejarlo registrado.')
        return { puede: false }
      }
      return { puede: true, motivo: motivo.trim(), autorizacionId: null, solicitudId: null }
    }
    try {
      const auth = await autorizacionVigente(captura.folio, tipo)
      if (auth) {
        return {
          puede: true,
          motivo: `autorizado por ${auth.otorgadaPorNombre || 'administracion'}`,
          autorizacionId: auth.id,
          solicitudId: auth.solicitudId || null
        }
      }
      const accionTexto = tipo === 'eliminar' ? 'eliminar' : 'corregir el peso de'
      const motivo = window.prompt(
        `El folio ${captura.folio} YA salio en un PDF: para ${accionTexto} hace falta permiso de Roberto.\n\n` +
          'Escribe el motivo y se le manda la solicitud (aparecera en su pestana de Autorizaciones):'
      )
      if (motivo === null) return { puede: false }
      if (!motivo.trim()) {
        setError('Hace falta el motivo para pedir el permiso.')
        return { puede: false }
      }
      await pedirCorreccion({
        folio: captura.folio,
        tipo,
        motivo: motivo.trim(),
        usuario: { uid: authUser.uid, nombre: perfil?.nombreCompleto || 'Estacion' }
      })
      setAviso(
        `Solicitud enviada a Roberto para ${accionTexto} el folio ${captura.folio}. ` +
          'Cuando la apruebe, vuelve a intentarlo.'
      )
      return { puede: false }
    } catch (err) {
      console.error('[PanelCaptura] Error verificando el permiso:', err)
      setError('No se pudo verificar el permiso: ' + (err.message || err))
      return { puede: false }
    }
  }

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
      // Sin perfil cargado no se sabe si esta cuenta es de prueba, y el aviso
      // de abajo no podria darse (el servidor si la frena, pero con un
      // permission-denied que no explica nada).
      if (!perfil) {
        setError('Todavia se esta cargando tu perfil. Espera un segundo y vuelve a intentar.')
        setGuardando(false)
        return
      }
      // El prefijo va en mayusculas: la regla del servidor distingue, y
      // "zztest001" pasaria el aviso de abajo para morir con un
      // permission-denied que no explica nada.
      const folioNormalizado = normalizarPrefijoPrueba(canonizarFolio(normalizarFolio(folio)))
      // Una cuenta de prueba solo captura folios ZZTEST: es lo que despues
      // permite barrer las pruebas sin tocar un bulto real. Las reglas lo
      // rechazan igual, pero ahi el mensaje seria un permission-denied seco
      // -- y con un bulto real en pantalla, ese error se leeria como "la app
      // no sirve" en vez de "esta cuenta no es para esto".
      if (esPrueba && !/^ZZTEST/i.test(folioNormalizado)) {
        setError(
          `Esta es una cuenta de PRUEBA: el folio tiene que empezar con ZZTEST ` +
            `(escribiste "${folioNormalizado}"). Asi la captura se puede borrar despues sin tocar nada real.`
        )
        setGuardando(false)
        return
      }
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
              operadorNombre: snap.data().operadorNombre || null,
              creadoEn: snap.data().creadoEn?.toDate?.() || null,
              actualizadoEnMillis: snap.data().actualizadoEn?.toMillis() ?? null
            }
          : { existe: false }
      })

      // 2) El dialogo de confirmacion queda FUERA de cualquier transaccion
      // (no se puede abrir un dialogo bloqueante dentro de una transaccion
      // de Firestore, que ademas puede reintentarse sola).
      if (infoInicial.existe) {
        // Quien y cuando lo capturo: con varios usuarios en turnos distintos,
        // saber que "lo capturo America a las 12:40" evita rehacer un bulto
        // que ya estaba pesado.
        const quien = infoInicial.operadorNombre ? ` por ${infoInicial.operadorNombre}` : ''
        const cuando = infoInicial.creadoEn
          ? ` el ${infoInicial.creadoEn.toLocaleDateString('es-MX')} a las ${infoInicial.creadoEn.toLocaleTimeString('es-MX')}`
          : ''
        const confirmar = window.confirm(
          `El folio ${folioNormalizado} YA fue capturado${quien}${cuando} con ` +
            `${(infoInicial.pesoGramos / 1000).toFixed(2)} kg.\n\n¿Sobrescribirlo con el nuevo peso?`
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

  // La seleccion masiva vive ahora en el encabezado de cada DIA (y en cada
  // OT); el checkbox global del thead se quito porque seleccionar "todo" de
  // varios dias a la vez no corresponde a como se arman los PDF.

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
    setError('')
    setAviso('')
    // Un folio que ya salio en PDF necesita permiso de Roberto (o serlo).
    const permiso = await verificarPermisoCorreccion(captura, 'eliminar')
    if (!permiso.puede) return
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
        await registrarCambio({
          folio: captura.folio,
          accion: 'eliminar',
          antes: {
            pesoGramos: captura.pesoGramos ?? null,
            docenas: docenasDeCaptura(captura) || null,
            codigo: captura.producto?.codigo ?? null,
            pdfFolioInterno: captura.pdfFolioInterno ?? null
          },
          despues: {},
          motivo: permiso.motivo,
          autorizacionId: permiso.autorizacionId,
          usuario: { uid: authUser.uid, nombre: perfil?.nombreCompleto || 'Estacion' }
        })
        if (permiso.autorizacionId) {
          await consumirAutorizacion(captura.folio, 'eliminar', permiso.solicitudId)
        }
        setAviso(`Captura del folio ${captura.folio} eliminada (queda registrada en la bitacora de cambios).`)
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
      const permiso = await verificarPermisoCorreccion(editando, 'editar_peso')
      if (!permiso.puede) {
        setEditando(null)
        return
      }
      const pesoAnterior = editando.pesoGramos ?? null
      const ref = doc(db, 'bultos', editando.folio)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) {
          throw new Error(`La captura de ${editando.folio} ya no existe (alguien la elimino).`)
        }
        // Cambia el peso conservando el snapshot de producto y creadoEn.
        // operadorUid/operadorNombre pasan a ser los de QUIEN EDITA: con
        // usuarios individuales, firestore.rules exige que toda escritura
        // vaya firmada por el usuario de la sesion (operadorUid ==
        // request.auth.uid) -- conservar el autor original haria que editar
        // la captura de otro usuario fallara con permission-denied.
        // El marcador de PDF (pdfGeneradoEn/pdfFolioInterno) se QUITA a
        // proposito: el peso nuevo ya no coincide con el PDF emitido, asi el
        // folio regresa a "Pendientes de PDF" (ademas bultoValido() en las
        // reglas rechaza esos campos en una reescritura completa).
        const { pdfGeneradoEn: _pdfGeneradoEn, pdfFolioInterno: _pdfFolioInterno, ...datosPrevios } = snap.data()
        tx.set(ref, {
          ...datosPrevios,
          pesoGramos,
          operadorUid: authUser.uid,
          operadorNombre: perfil?.nombreCompleto || 'Estacion',
          actualizadoEn: serverTimestamp()
        })
      })
      // Las capturas de OTROS dias (agregadas) no tienen onSnapshot que las
      // refresque solas: sin esto, la tabla se quedaria mostrando el peso
      // viejo y reabrir "Editar peso" precargaria ese mismo valor viejo.
      // Tambien se les quita el marcador local para que regresen a
      // "Pendientes", igual que hace el servidor.
      setAgregadas((prev) =>
        prev.map((a) => {
          if (a.folio !== editando.folio) return a
          const { pdfGeneradoEn: _p1, pdfFolioInterno: _p2, ...resto } = a
          return { ...resto, pesoGramos }
        })
      )
      await registrarCambio({
        folio: editando.folio,
        accion: 'editar_peso',
        antes: { pesoGramos: pesoAnterior, docenas: docenasDeCaptura(editando) || null },
        despues: { pesoGramos, docenas: docenasDeCaptura(editando) || null },
        motivo: permiso.motivo,
        autorizacionId: permiso.autorizacionId,
        usuario: { uid: authUser.uid, nombre: perfil?.nombreCompleto || 'Estacion' }
      })
      if (permiso.autorizacionId) {
        await consumirAutorizacion(editando.folio, 'editar_peso', permiso.solicitudId)
      }
      setAviso(
        `Peso de ${editando.folio} actualizado a ${(pesoGramos / 1000).toFixed(2)} kg ` +
          '(queda registrado en la bitacora de cambios). ' +
          'OJO: si su etiqueta ya se imprimio, ya no coincide — usa "Imprimir etiqueta" para reimprimirla.'
      )
      setEditando(null)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el peso.')
    }
  }

  return (
    <>
      <div>
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
          {vistaPrevia && (
            <div
              style={{
                margin: '-4px 0 12px',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 14,
                border: '1px solid',
                ...(vistaPrevia.estado === 'ok'
                  ? { background: '#e8f5ec', borderColor: '#9fd3b1', color: '#1e5c34' }
                  : vistaPrevia.estado === 'consultando'
                    ? { background: '#f2f4f7', borderColor: '#d8dee6', color: '#556' }
                    : { background: '#fdecea', borderColor: '#f0b4ae', color: '#8a2620' })
              }}
            >
              {vistaPrevia.estado === 'consultando' && <>Buscando el folio {vistaPrevia.folio}...</>}
              {vistaPrevia.estado === 'invalido' && (
                <>Folio invalido: usa solo letras, numeros, punto, guion o guion bajo.</>
              )}
              {vistaPrevia.estado === 'error' && (
                <>No se pudo consultar el folio {vistaPrevia.folio} (revisa la conexion).</>
              )}
              {vistaPrevia.estado === 'sin_ruteo' && (
                <>
                  <strong>Folio {vistaPrevia.folio}: NO esta en el ruteo del dia.</strong> Verifica
                  que lo hayas escrito bien; si es correcto, avisa para subir el Excel del dia.
                </>
              )}
              {vistaPrevia.estado === 'ok' && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {vistaPrevia.producto.codigo || 'sin codigo'} ·{' '}
                    {vistaPrevia.producto.descripcion || 'sin descripcion'}
                  </div>
                  <div style={{ marginTop: 2 }}>
                    {vistaPrevia.producto.docenas != null && <>Docenas: {vistaPrevia.producto.docenas} · </>}
                    {vistaPrevia.producto.pedido && <>Pedido: {vistaPrevia.producto.pedido}</>}
                  </div>
                  {(vistaPrevia.producto.modelo || vistaPrevia.producto.color) && (
                    <div style={{ marginTop: 2 }}>
                      {vistaPrevia.producto.modelo && <>Modelo: {vistaPrevia.producto.modelo} </>}
                      {vistaPrevia.producto.color && <>· Color: {vistaPrevia.producto.color}</>}
                    </div>
                  )}
                </>
              )}
              {vistaPrevia.yaCapturado && (
                <div style={{ marginTop: 6, fontWeight: 700, color: '#8a5300' }}>
                  ⚠ Este folio YA fue capturado con{' '}
                  {((vistaPrevia.yaCapturado.pesoGramos || 0) / 1000).toFixed(2)} kg
                  {vistaPrevia.yaCapturado.operadorNombre
                    ? ` por ${vistaPrevia.yaCapturado.operadorNombre}`
                    : ''}
                  {vistaPrevia.yaCapturado.pdfGeneradoEn ? ' y ya salio en un PDF' : ''}.
                </div>
              )}
            </div>
          )}

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

        <div className="tarjeta">
          <h2>
            Pendientes de PDF ({pendientes.length}) -{' '}
            {pendientes.reduce((a, c) => a + docenasDeCaptura(c), 0)} docenas -{' '}
            {kgDe(pendientes).toFixed(2)} kg
          </h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Folios capturados que todavia NO han salido en ningun PDF de salida, agrupados por
            OT. <strong>Los de dias anteriores se quedan aqui</strong> hasta que se les genere su
            documento; la columna &quot;Dia&quot; dice cuando se capturo cada uno.
          </p>
          {/* Cuantas OT pendientes no estan amarradas a una orden de compra.
              Roberto lo pidio el 28-08 para ver de un golpe si lo que se esta
              capturando cuelga de una OC o no. Cuando falta, el que hay que
              actualizar es el PLAN MAESTRO, no la captura. */}
          {gruposPendientes.length > 0 &&
            (() => {
              const sinOc = gruposPendientes.filter((g) => !ocDeOt(g.ot))
              const foliosSinOc = sinOc.reduce((a, g) => a + g.filas.length, 0)
              if (sinOc.length === 0) {
                return (
                  <p className="texto-suave" style={{ fontSize: 13, color: '#16a34a' }}>
                    Todas las OT pendientes estan amarradas a una orden de compra.
                  </p>
                )
              }
              return (
                <p style={{ fontSize: 13, color: '#8a5300', margin: '4px 0 0' }}>
                  <strong>
                    {sinOc.length} de {gruposPendientes.length} OT sin orden de compra
                  </strong>{' '}
                  ({foliosSinOc} folio{foliosSinOc === 1 ? '' : 's'}): esas OT no estan en el
                  plan maestro vigente. Hay que subir el plan actualizado.
                </p>
              )
            })()}
          {!datosConfirmados && (
            <div className="alerta-error" style={{ marginBottom: 12 }}>
              Datos no confirmados, verifica tu conexion.
            </div>
          )}

          {/* Emitir la remision es trabajo de EMBARQUES: un pesador no puede
              (las reglas se lo niegan) y mostrarle el boton solo le daria un
              error crudo de Firestore. */}
          {puedeEmbarcar && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <form onSubmit={onAgregarFolio} style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="Agregar folio de mas de 30 dias"
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
          )}

          {pendientes.length === 0 && (
            <p className="texto-suave">
              No hay folios pendientes de PDF. Los que captures apareceran aqui.
            </p>
          )}
          {/* Pendientes agrupados por OT directamente (sin dividir por dia):
              una OT con folios de hoy Y de ayer se ve como UN solo grupo. El
              dia de cada captura queda a la vista en su columna "Dia". */}
          {pendientes.length > 0 &&
            renderTablaAgrupada(gruposPendientes, {
              textoVacio: 'No hay folios pendientes de PDF.'
            })}
        </div>

        <div className="tarjeta" style={{ marginTop: 18 }}>
          <h2>
            Ya enviados a PDF ({enviados.length}) -{' '}
            {enviados.reduce((a, c) => a + docenasDeCaptura(c), 0)} docenas -{' '}
            {kgDe(enviados).toFixed(2)} kg
          </h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Estos folios ya salieron en un PDF de salida (la columna PDF indica el folio interno y la
            fecha). Si necesitas regenerar un PDF, seleccionalos aqui; si editas el peso de uno,
            regresa solo a pendientes.
          </p>
          {renderTablaAgrupada(gruposEnviados, {
            conColumnaPdf: true,
            textoVacio: 'Ningun folio de hoy ha salido en PDF todavia.'
          })}
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
          onListo={async (mensaje) => {
            setModalPdf(false)
            setAviso(mensaje)
            // Los folios "agregados" (de mas de 30 dias) no tienen onSnapshot
            // que los refresque solo: sin esto, uno recien enviado al PDF se
            // quedaria en el estado local viejo (sin pdfGeneradoEn), asi que
            // seguiria viendose en "Pendientes de PDF" hasta recargar la
            // pagina, y verificarPermisoCorreccion decidiria con ese dato
            // stale (dejaria editar/eliminar sin el prompt de motivo). Se
            // releen de Firestore los que participaron en este PDF.
            const foliosDelPdf = new Set(seleccion)
            const agregadasTocadas = agregadas.filter((a) => foliosDelPdf.has(a.folio))
            if (agregadasTocadas.length > 0) {
              try {
                const frescas = await Promise.all(
                  agregadasTocadas.map((a) => getDoc(doc(db, 'bultos', a.folio)))
                )
                const porFolio = new Map()
                frescas.forEach((snap) => {
                  if (snap.exists()) porFolio.set(snap.id, { id: snap.id, ...snap.data() })
                })
                setAgregadas((prev) =>
                  prev
                    .filter((a) => !foliosDelPdf.has(a.folio) || porFolio.has(a.folio))
                    .map((a) => porFolio.get(a.folio) || a)
                )
              } catch (err) {
                // Sin conexion no se puede refrescar: como minimo se quitan
                // de "agregadas" para que no se queden como pendientes
                // fantasma (el marcador real ya quedo en Firestore).
                console.error('[PanelCaptura] No se pudo refrescar folios agregados tras el PDF:', err)
                setAgregadas((prev) => prev.filter((a) => !foliosDelPdf.has(a.folio)))
              }
            }
            // Limpiar la seleccion: sin esto, los folios recien enviados
            // seguirian palomeados en "Ya enviados" y el SIGUIENTE PDF los
            // volveria a incluir sin que nadie lo pidiera.
            setSeleccion(new Set())
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
    </>
  )
}
