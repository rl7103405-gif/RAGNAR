// TAREAS A MAQUILAS (interno): Lindbergh (flag puedeCrearTareas) y el admin
// encargan ensambles a las maquilas, con el TECH PACK del pedido adjunto.
//
// El tech pack: la maquila SOLO LO VE mientras la tarea esta abierta, y al
// terminar la tarea (regresa el producto terminado) se BORRA. Se recomienda
// subirlo en PDF: el Excel se muestra como extraccion, no como copia fiel.
// La subida deja la tarea en 'preparando' (invisible para la maquila) hasta
// que el archivo termina de subir; si se corta, aqui mismo se reintenta con
// el archivo elegido de nuevo, o se cancela la tarea.
import { useEffect, useState } from 'react'
import { otsDeLaOc, renglonesDeLaOt } from '../utils/planMaestro'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import VisorTechPack from './VisorTechPack'
import {
  ESTADOS_TAREA_ENSAMBLE,
  ErrorTareaEnsamble,
  MAX_TECHPACK_BYTES,
  crearTareaEnsamble,
  tareaQueYaTieneLaOt,
  escucharTareasEnsambleDeVarias,
  formatoDeArchivo,
  limpiarTechPack,
  prepararCambioDeTechPack,
  subirTechPack,
  terminarTareaEnsamble,
  devolverTareaEnsamble,
  cambiarFechaRequerida,
  ESTADOS_VIVOS
} from '../utils/tareasEnsamble'

const RENGLON_VACIO = { codigo: '', descripcion: '', cantidad: '', unidad: 'packs' }

export default function PanelTareasMaquila() {
  const { authUser, perfil, puedeCrearTareas, esPrueba } = useAuth()
  const maquilas = useMaquilas()
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [progreso, setProgreso] = useState('')
  const [trabajando, setTrabajando] = useState(null)
  const [visor, setVisor] = useState(null) // { maquilaId, tareaId, techPack }
  const [mostrarCerradas, setMostrarCerradas] = useState(false)

  const [nueva, setNueva] = useState({ maquilaId: '', ot: '', fechaRequerida: '', notas: '' })
  const [renglones, setRenglones] = useState([{ ...RENGLON_VACIO }])
  const [archivo, setArchivo] = useState(null)
  const [trayendoOt, setTrayendoOt] = useState(false)
  // Lo que se sabe de la OT escrita: si el plan la conoce y si otra maquila ya
  // la tiene. Se calcula al picar "Traer del plan", no en cada tecla.
  const [avisoOt, setAvisoOt] = useState(null)
  // Las OT de una OC que se van a encargar de un jalon.
  const [otsElegidas, setOtsElegidas] = useState([])
  // La fecha que se esta tecleando, por tarea. NO se escribe en cada tecla: un
  // <input type="date"> dispara onChange en cada dedazo, y tecleando el ano
  // pasa por 0002, 0020, 0202... — serian tres escrituras basura a Firestore y
  // tres confirmaciones antes de llegar a 2026. Se guarda cuando lo piden.
  const [fechaEditada, setFechaEditada] = useState({})

  // Se escucha maquila por maquila (no collectionGroup) para que el orden por
  // fecha sea real; depende del catalogo, asi que se re-suscribe si cambia.
  const idsMaquilas = maquilas.map((m) => m.id).join(',')
  useEffect(() => {
    if (!puedeCrearTareas) return
    const ids = idsMaquilas ? idsMaquilas.split(',') : []
    const unsub = escucharTareasEnsambleDeVarias(ids, setTareas, (err) => {
      console.error('[PanelTareasMaquila] Error escuchando:', err)
      setError('No se pudieron cargar las tareas: ' + (err.message || err))
    })
    return unsub
  }, [puedeCrearTareas, idsMaquilas])

  const usuario = () => ({ uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' })
  const nombreMaquila = (id) => maquilas.find((m) => m.id === id)?.nombre || id

  const reportar = (err) => {
    console.error('[PanelTareasMaquila]', err)
    setError(err instanceof ErrorTareaEnsamble ? err.message : String(err?.message || err))
  }

  /**
   * Encarga VARIAS ordenes de trabajo de una OC a la misma maquila, de un
   * jalon. Roberto, 2026-09-02: *"cuando quiera jalar una orden de compra,
   * que pueda elegir todas las OT que va a seleccionar, para que sea mas
   * sencillo"*.
   *
   * ⚠️ Crea UNA TAREA POR OT, no una tarea revuelta con todas. Es lo que dijo
   * su papa —"una orden de trabajo ES una tarea"— y ademas es lo unico que
   * mantiene sano el resto: el candado de "una OT, una maquila" compara por
   * OT, el arbol acredita el avance por OT, y la remision de la maquila lleva
   * la OT en cada renglon. Una tarea con tres OT encima romperia los tres.
   * Lo que se ahorra es la CAPTURA, que es lo que dolia.
   */
  /** El titulo que se guarda: la orden y a donde va. */
  const tituloSugerido = () => {
    const ot = String(nueva.ot || '').trim()
    const destino = avisoOt?.destino || avisoOt?.ots?.[0]?.destino || ''
    if (!ot) return 'Tarea sin orden'
    return `OT ${ot}${destino ? ' - ' + destino : ''}`
  }

  const onEncargarVarias = async () => {
    if (trabajando) return
    setError('')
    setAviso('')
    if (!nueva.maquilaId) {
      setError('Elige primero la maquila a la que le vas a encargar estas ordenes.')
      return
    }
    if (!otsElegidas.length) {
      setError('Marca al menos una orden de trabajo.')
      return
    }
    setTrabajando('crear')
    // Fuera del try A PROPOSITO: si se cae la red en la OT 3 de 5, las dos que
    // YA se crearon son reales y estan en Firestore. El catch tiene que poder
    // decir cuales, o el usuario ve solo el error, cree que no se guardo nada
    // y vuelve a encargarlas todas.
    const hechas = []
    const saltadas = []
    try {
      const ids = (maquilas || []).map((m) => m.id)
      for (const ot of otsElegidas) {
        // El candado, OT por OT: que una este ocupada no debe tumbar a las
        // demas — se salta esa y se dice cual y por que.
        const ocupada = await tareaQueYaTieneLaOt(ot, ids)
        if (ocupada) {
          saltadas.push(`${ot} (ya esta con ${ocupada.maquilaId})`)
          continue
        }
        const delPlan = await renglonesDeLaOt(ot)
        if (!delPlan.length) {
          saltadas.push(`${ot} (el plan no la trae)`)
          continue
        }
        const conDecimales = delPlan.some((r) => r.cantidad !== Math.trunc(r.cantidad))
        if (conDecimales) {
          saltadas.push(`${ot} (trae medias unidades: encargala aparte y redondea)`)
          continue
        }
        const destino = delPlan.find((r) => r.destino)?.destino || ''
        await crearTareaEnsamble({
          maquilaId: nueva.maquilaId,
          titulo: `OT ${ot}${destino ? ' - ' + destino : ''}`,
          ot,
          fechaRequerida: nueva.fechaRequerida,
          renglones: delPlan.map((r) => ({
            codigo: r.codigo,
            cantidad: String(r.cantidad),
            unidad: 'docenas',
            descripcion: r.descripcion || ''
          })),
          notas: nueva.notas,
          // El tech pack NO se sube aqui: es un archivo por tarea y subir el
          // mismo cuatro veces sin que nadie lo pida seria decidir por el.
          // Se agrega despues a la que lo necesite.
          archivo: null,
          usuario: usuario(),
          onProgreso: setProgreso
        })
        hechas.push(ot)
      }
      setOtsElegidas([])
      setAvisoOt(null)
      setNueva((p) => ({ ...p, ot: '' }))
      setAviso(
        (hechas.length
          ? `Listo: ${hechas.length} tarea(s) encargadas a ${nombreMaquila(nueva.maquilaId)} ` +
            `(OT ${hechas.join(', ')}).`
          : 'No se encargo ninguna.') +
          (saltadas.length ? ` Se saltaron: ${saltadas.join('; ')}.` : '') +
          (hechas.length ? ' El tech pack se sube despues, tarea por tarea.' : '')
      )
    } catch (err) {
      reportar(err)
      // Lo que si alcanzo a guardarse, dicho aparte del error: son tareas que
      // la maquila ya esta viendo.
      if (hechas.length) {
        setAviso(
          `Ojo: antes de la falla si se encargaron ${hechas.length} tarea(s) ` +
            `(OT ${hechas.join(', ')}). No las vuelvas a encargar; reintenta solo las demas.`
        )
        setOtsElegidas((prev) => prev.filter((o) => !hechas.includes(o)))
      }
    } finally {
      setTrabajando(null)
      setProgreso('')
    }
  }

  const onCrear = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    setTrabajando('crear')
    try {
      // ⚠️ Que el numero escrito NO sea una ORDEN DE COMPRA. El campo acepta
      // las dos y el flujo bueno es picar "Traer del plan", pero nadie impide
      // teclear una OC, capturar los renglones a mano y mandar. Si eso pasa,
      // la OC queda guardada COMO SI FUERA una OT y contamina en silencio las
      // tres cosas que dependen de ese campo: el candado de "una OT, una
      // maquila", la agrupacion del arbol y la columna OT de la remision.
      if (String(nueva.ot || '').trim()) {
        const comoOt = await renglonesDeLaOt(nueva.ot)
        if (!comoOt.length) {
          const ots = await otsDeLaOc(nueva.ot)
          if (ots.length) {
            setAvisoOt({ esOc: String(nueva.ot).trim(), ots })
            throw new ErrorTareaEnsamble(
              `${nueva.ot} es una orden de COMPRA, no de trabajo. Abajo estan sus ` +
                'ordenes de trabajo: marca las que le encargas a esta maquila.'
            )
          }
        }
      }

      // El candado: una OT va a UNA maquila. Se revisa contra lo que hay en
      // ese momento, no contra lo que la pantalla vio hace rato.
      const ocupada = await tareaQueYaTieneLaOt(nueva.ot, (maquilas || []).map((m) => m.id))
      if (ocupada && ocupada.maquilaId !== nueva.maquilaId) {
        throw new ErrorTareaEnsamble(
          `La orden de trabajo ${nueva.ot} ya esta asignada a ${ocupada.maquilaId} ` +
            `(«${ocupada.titulo}»). Una OT va a una sola maquila; si hay que moverla, ` +
            'cancela primero esa tarea.'
        )
      }
      if (ocupada && ocupada.maquilaId === nueva.maquilaId) {
        throw new ErrorTareaEnsamble(
          `Esa maquila ya tiene una tarea viva con la OT ${nueva.ot} («${ocupada.titulo}»). ` +
            'No la dupliques: edita la que existe.'
        )
      }
      await crearTareaEnsamble({
        maquilaId: nueva.maquilaId,
        // El titulo ya no se teclea: era lo mismo que la orden. Roberto,
        // 2026-09-02: "lo del titulo pedido o cliente, al final del dia es lo
        // mismo; que nada mas se quede uno". Se arma con la orden y su
        // destino, que es como la gente la nombra de todos modos.
        titulo: tituloSugerido(),
        ot: nueva.ot,
        fechaRequerida: nueva.fechaRequerida,
        renglones,
        notas: nueva.notas,
        archivo,
        usuario: usuario(),
        onProgreso: setProgreso
      })
      setNueva({ maquilaId: '', ot: '', fechaRequerida: '', notas: '' })
      setRenglones([{ ...RENGLON_VACIO }])
      setArchivo(null)
      setAviso(
        archivo
          ? 'Tarea creada y tech pack subido: la maquila ya la ve en su portal.'
          : 'Tarea creada: la maquila ya la ve en su portal.'
      )
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  // Reintentar (o cambiar) el archivo de una tarea. Para 'preparando' sube
  // directo; para 'abierta' primero la regresa a 'preparando' (la maquila
  // deja de verla mientras) y luego sube.
  const onSubirArchivo = async (tarea, file) => {
    if (!file) return
    setError('')
    setAviso('')
    const formato = formatoDeArchivo(file.name)
    if (!formato) {
      setError('El tech pack tiene que ser .pdf o .xlsx. Mejor PDF: se ve tal cual.')
      return
    }
    // El tamano se revisa ANTES de leer el archivo: un arrayBuffer() de 100 MB
    // cuelga el navegador antes de poder decir "el tope son 15 MB".
    if (file.size > MAX_TECHPACK_BYTES) {
      setError(
        `El archivo pesa ${(file.size / 1048576).toFixed(1)} MB y el tope son 15 MB. ` +
          'Exportalo a PDF o quitale hojas que no necesite la maquila.'
      )
      return
    }
    setTrabajando(tarea.id)
    try {
      if (tarea.estado === 'abierta') await prepararCambioDeTechPack(tarea.maquilaId, tarea.id)
      await subirTechPack({
        maquilaId: tarea.maquilaId,
        tareaId: tarea.id,
        contenido: await file.arrayBuffer(),
        nombre: file.name,
        formato,
        onProgreso: setProgreso
      })
      setAviso(`Tech pack de "${tarea.titulo}" subido: la maquila ya lo puede ver.`)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  /**
   * Mover la prioridad de una tarea ya encargada. Roberto, 2026-09-02.
   *
   * Se pide confirmacion cuando la maquila YA empezo: ella tiene esa tarea en
   * pantalla y se le va a reacomodar sola: que quien la mueve sepa que del
   * otro lado hay alguien armando.
   */
  const onCambiarFecha = async (tarea, fecha) => {
    if ((tarea.fechaRequerida || '') === (fecha || '')) return
    if (['iniciada', 'declarada'].includes(tarea.estado)) {
      const comoSeVe = fecha ? `para el ${fecha.split('-').reverse().join('/')}` : 'sin fecha'
      const ok = window.confirm(
        `La maquila ya empezo esta tarea. Al dejarla ${comoSeVe} se le reacomoda la lista ` +
          'en su pantalla. El encargo (codigos y cantidades) no cambia.\n\nCambiar la prioridad?'
      )
      if (!ok) return
    }
    setError('')
    setAviso('')
    setTrabajando(tarea.id)
    try {
      await cambiarFechaRequerida({
        maquilaId: tarea.maquilaId,
        tareaId: tarea.id,
        fecha,
        usuario: usuario()
      })
      setAviso(
        fecha
          ? `Listo: la tarea queda para el ${fecha.split('-').reverse().join('/')}.`
          : 'Listo: la tarea se queda sin fecha y se le va al final de la lista.'
      )
    } catch (err) {
      reportar(err)
    } finally {
      // Se suelta la edicion local pase lo que pase: si la escritura fallo, el
      // recuadro tiene que volver a la fecha REAL del documento, no quedarse
      // mostrando una que no se guardo.
      setFechaEditada((p) => {
        const copia = { ...p }
        delete copia[tarea.id]
        return copia
      })
      setTrabajando(null)
    }
  }

  const onTerminar = async (tarea, estado) => {
    const pregunta =
      estado === 'terminada'
        ? `¿Terminar "${tarea.titulo}"? ${tarea.techPack ? 'El tech pack SE BORRA y la maquila deja de verlo.' : ''}`
        : `¿Cancelar "${tarea.titulo}"? ${tarea.techPack ? 'El tech pack SE BORRA.' : ''}`
    if (!window.confirm(pregunta)) return
    setError('')
    setAviso('')
    setTrabajando(tarea.id)
    try {
      await terminarTareaEnsamble({
        maquilaId: tarea.maquilaId,
        tarea,
        estado,
        usuario: usuario(),
        onProgreso: setProgreso
      })
      setAviso(
        estado === 'terminada'
          ? `Tarea "${tarea.titulo}" terminada${tarea.techPack ? ' y tech pack borrado' : ''}.`
          : `Tarea "${tarea.titulo}" cancelada${tarea.techPack ? ' y tech pack borrado' : ''}.`
      )
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  /** Regresarle la tarea a la maquila con el motivo escrito: no cuadro lo que
   *  entrego. Vuelve a 'iniciada' y ella ve por que. */
  const onDevolver = async (tarea) => {
    const motivo = window.prompt(
      `¿Por que le regresas "${tarea.titulo}" a ${nombreMaquila(tarea.maquilaId)}?\n\n` +
        'Esto lo va a leer la maquila en su portal.'
    )
    if (motivo === null) return
    setError('')
    setAviso('')
    setTrabajando(tarea.id)
    try {
      await devolverTareaEnsamble({
        maquilaId: tarea.maquilaId,
        tareaId: tarea.id,
        usuario: usuario(),
        motivo
      })
      setAviso(`"${tarea.titulo}" regreso a la maquila con tu motivo.`)
    } catch (err) {
      reportar(err)
    } finally {
      setTrabajando(null)
    }
  }

  const onLimpiarPendiente = async (tarea) => {
    setError('')
    setTrabajando(tarea.id)
    try {
      await limpiarTechPack({ maquilaId: tarea.maquilaId, tareaId: tarea.id, onProgreso: setProgreso })
      setAviso(`Tech pack de "${tarea.titulo}" borrado.`)
    } catch (err) {
      reportar(err)
    } finally {
      setProgreso('')
      setTrabajando(null)
    }
  }

  const fechaDe = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '-')
  // Con HORA: de la diferencia entre estas marcas sale cuanto tardo la maquila
  // en armar, y con la fecha sola no se puede medir nada.
  const fechaHora = (t) =>
    t?.toDate ? t.toDate().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'

  /** Cuanto paso entre dos marcas, en dias/horas/minutos. */
  const tiempoEntre = (desde, hasta) => {
    if (!desde?.toDate || !hasta?.toDate) return '-'
    const min = Math.max(0, Math.round((hasta.toDate() - desde.toDate()) / 60000))
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} h ${min % 60} min`
    return `${Math.floor(h / 24)} d ${h % 24} h`
  }

  if (!puedeCrearTareas) {
  return (
      <div className="tarjeta">
        <p className="texto-suave">Esta pestana es de quien encarga tareas a las maquilas.</p>
      </div>
    )
  }

    /**
   * UNA ORDEN DE TRABAJO ES UNA TAREA. Trae del plan los codigos y cantidades
   * de esa OT y llena los renglones, en vez de recapturarlos a mano.
   *
   * El papa de Roberto, 2026-09-02: "si el sistema ya tiene agrupado en que
   * ordenes de trabajo esta distribuida una orden de compra, ya tenemos ahi
   * implicita la tarea". Y Lindbergh: "yo quisiera solo asignarla, porque
   * ahorita tengo que volver a capturar todos esos numeros".
   */
  const traerDelPlan = async (otExplicita) => {
    // La OT puede venir del boton de una OC: si se leyera del estado, todavia
    // no estaria actualizada en este tick.
    const ot = String(otExplicita || nueva.ot || '').trim()
    setError('')
    setAviso('')
    setAvisoOt(null)
    if (!ot) {
      setError('Escribe la orden de trabajo y vuelve a picar "Traer del plan".')
      return
    }
    setTrayendoOt(true)
    try {
      // Las dos preguntas a la vez: que trae el plan, y si alguien ya la tiene.
      const [delPlan, yaAsignada] = await Promise.all([
        renglonesDeLaOt(ot),
        tareaQueYaTieneLaOt(ot, (maquilas || []).map((m) => m.id))
      ])
      if (!delPlan.length) {
        // Antes de rendirse: puede que ese numero sea una ORDEN DE COMPRA. En
        // el plan conviven los dos y no se parecen (las OT van del 7467 al
        // 8042; las OC son 2422, 2449...). Si lo es, se le ofrecen sus OT en
        // vez de contestarle "no existe" y dejarlo adivinando.
        const ots = await otsDeLaOc(ot)
        if (ots.length) {
          setAvisoOt({ yaAsignada, esOc: ot, ots })
          setAviso('')
          setError('')
          return
        }
        setError(
          `El numero ${ot} no esta en el plan maestro vigente, ni como orden de trabajo ` +
            'ni como orden de compra. Puedes capturar la tarea a mano, o pedirle a Adrian ' +
            'el plan actualizado.'
        )
        setAvisoOt({ yaAsignada })
        return
      }
      // Si ya habia algo capturado a mano, se pregunta: traer del plan pisa
      // TODOS los renglones y perder lo escrito en silencio seria feo.
      const hayCapturado = renglones.some((r) => (r.codigo || '').trim() || (r.cantidad || '').trim())
      if (
        hayCapturado &&
        !window.confirm('Ya tienes renglones capturados. Traer del plan los reemplaza. ¿Sigo?')
      ) {
        return
      }
      setRenglones(
        delPlan.map((r) => ({
          codigo: r.codigo,
          cantidad: String(r.cantidad || ''),
          unidad: 'docenas',
          descripcion: r.descripcion || ''
        }))
      )
      // El plan puede traer medias docenas (en esta fabrica es normal), y al
      // crear la tarea se rechazan las cantidades con decimales. Mejor decirlo
      // AQUI, con los codigos enfrente, que dejar que lo descubra hasta el
      // boton de encargar sin saber de donde salio el decimal.
      const conDecimales = delPlan.filter((r) => r.cantidad !== Math.trunc(r.cantidad))
      if (conDecimales.length) {
        setError(
          `El plan trae cantidades con decimales en ${conDecimales.length} codigo(s): ` +
            `${conDecimales.slice(0, 5).map((r) => r.codigo + ' (' + r.cantidad + ')').join(', ')}. ` +
            'Redondealas antes de encargar la tarea: no se aceptan medias unidades.'
        )
      }
      const destino = delPlan.find((r) => r.destino)?.destino || ''
      const oc = delPlan.find((r) => r.oc)?.oc || ''
      setNueva((p) => ({
        ...p,
        // El titulo se sugiere con lo que el plan sabe; se puede cambiar.
        titulo: p.titulo || `OT ${ot}${destino ? ' - ' + destino : ''}`
      }))
      setAvisoOt({ yaAsignada, codigos: delPlan.length, oc, destino })
      setAviso(
        `La OT ${ot} trae ${delPlan.length} codigo(s) del plan` +
          (oc ? ` (orden de compra ${oc})` : '') +
          '. Revisa las cantidades antes de crear la tarea.'
      )
    } catch (err) {
      console.error('[Tareas] No se pudo traer la OT del plan:', err)
      setError('No se pudo leer el plan: ' + (err?.message || err))
    } finally {
      setTrayendoOt(false)
    }
  }

  // Las que la maquila dice que ya termino van APARTE y arriba: son las que
  // esperan una decision de Quini, y si se mezclan con el resto se pierden.
  const porConfirmar = tareas.filter((t) => t.estado === 'declarada')
  const vivas = tareas.filter((t) => ESTADOS_VIVOS.includes(t.estado) && t.estado !== 'declarada')
  const cerradas = tareas.filter((t) => ['terminada', 'cancelada'].includes(t.estado))

  const tarjeta = (t) => (
    <div
      key={`${t.maquilaId}_${t.id}`}
      style={{
        border: '1px solid #d8dee6',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 10,
        background: t.estado === 'preparando' ? '#fff8e6' : '#fff',
        opacity: ['terminada', 'cancelada'].includes(t.estado) ? 0.75 : 1
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 15 }}>{t.titulo}</strong>
        <span
          style={{ fontSize: 12, background: '#e7effd', color: '#1e40af', borderRadius: 999, padding: '2px 10px' }}
        >
          {nombreMaquila(t.maquilaId)}
        </span>
        {t.ot && (
          <span
            style={{ fontSize: 12, background: '#ecfdf5', color: '#065f46', borderRadius: 999, padding: '2px 10px' }}
            title={t.destino ? `Orden de trabajo ${t.ot}, va a ${t.destino}` : `Orden de trabajo ${t.ot}`}
          >
            OT {t.ot}
            {t.destino ? ` · ${t.destino}` : ''}
          </span>
        )}

        <span className="texto-suave" style={{ fontSize: 13 }}>
          {ESTADOS_TAREA_ENSAMBLE[t.estado] || t.estado} · pedida el {fechaDe(t.creadoEn)}
          {t.fechaRequerida ? (
            <>
              {' · '}
              <strong style={{ color: '#8a5a00' }}>
                para el {t.fechaRequerida.split('-').reverse().join('/')}
              </strong>
            </>
          ) : null}
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 13 }}>
        {(t.renglones || []).map((r) => (
          <div key={r.codigo}>
            <strong>{r.codigo}</strong> · {r.cantidad} {r.unidad}
            {r.descripcion ? ` · ${r.descripcion}` : ''}
          </div>
        ))}
      </div>
      {t.notas && <p className="texto-suave" style={{ fontSize: 13, margin: '6px 0 0' }}>{t.notas}</p>}

      {/* Lo que reporto la maquila. Con hora, no solo fecha: es de donde sale
          cuanto tardo en armar, y con la fecha sola no se puede medir. */}
      {(t.iniciadaEn || t.declaradaEn || t.devueltaEn) && (
        <div className="texto-suave" style={{ fontSize: 12, marginTop: 6 }}>
          {t.iniciadaEn && <>Empezo el {fechaHora(t.iniciadaEn)}</>}
          {t.declaradaEn && (
            <>
              {' · '}
              <strong style={{ color: '#16a34a' }}>dijo que termino el {fechaHora(t.declaradaEn)}</strong>
            </>
          )}
          {t.devueltaEn && <> · se la regreso {t.devueltaPorNombre} el {fechaHora(t.devueltaEn)}</>}
          {/* El tiempo de armado es AUTORREPORTADO: la maquila decide cuando
              pica "empece". Si nunca lo pico, inicio y fin se sellaron en la
              misma escritura y la resta da cero -- que NO es una medicion de
              cero, es que no hubo medicion. Se dice aqui para que nadie meta
              ese numero en una tarifa creyendo que midio algo. */}
          {t.iniciadaEn && t.declaradaEn && (
            <>
              {' · '}
              {String(t.iniciadaEn?.seconds) === String(t.declaradaEn?.seconds) ? (
                <em>sin medicion de tiempo: no marco cuando empezo</em>
              ) : (
                <>tiempo de armado (segun ella): {tiempoEntre(t.iniciadaEn, t.declaradaEn)}</>
              )}
            </>
          )}
        </div>
      )}
      {t.notaMaquila && (
        <p style={{ fontSize: 13, margin: '4px 0 0' }}>
          <strong>Nota de la maquila:</strong> {t.notaMaquila}
        </p>
      )}
      {t.motivoDevolucion && (
        <p className="texto-suave" style={{ fontSize: 12, margin: '4px 0 0' }}>
          Motivo con el que se le regreso: {t.motivoDevolucion}
        </p>
      )}

      {/* CAMBIAR LA PRIORIDAD sin tocar el encargo. Aparece mientras la tarea
          vive, incluso si la maquila ya empezo: el caso real es "esto ahora
          corre prisa", y ahi es justo cuando pasa. Una tarea cerrada ya no se
          reprioriza (las reglas tampoco lo dejan). */}
      {ESTADOS_VIVOS.includes(t.estado) && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}
        >
          <label className="texto-suave" style={{ fontSize: 12 }}>
            Para cuando:{' '}
            <input
              type="date"
              value={fechaEditada[t.id] ?? (t.fechaRequerida || '')}
              disabled={trabajando === t.id}
              onChange={(e) => setFechaEditada((p) => ({ ...p, [t.id]: e.target.value }))}
              style={{ fontSize: 12, padding: '2px 6px' }}
            />
          </label>
          {/* El boton solo aparece cuando de verdad cambio: asi no se escribe
              en cada tecla y se ve que quedo pendiente de guardar.
              Y NO aparece cuando el recuadro quedo vacio teniendo fecha: al
              reteclear el ano el input pasa por vacio un instante, y un clic
              ahi habria quitado la prioridad en vez de moverla. Para quitarla
              esta el boton de al lado, que lo dice. */}
          {(fechaEditada[t.id] ?? (t.fechaRequerida || '')) !== (t.fechaRequerida || '') &&
            (fechaEditada[t.id] || !t.fechaRequerida) && (
            <button
              className="btn-primario"
              style={{ fontSize: 12, padding: '2px 10px' }}
              disabled={trabajando === t.id}
              onClick={() => onCambiarFecha(t, fechaEditada[t.id] || '')}
            >
              {trabajando === t.id ? 'Guardando...' : 'Guardar la prioridad'}
            </button>
          )}
          {t.fechaRequerida && (
            <button
              className="btn-secundario"
              style={{ fontSize: 12, padding: '2px 10px' }}
              disabled={trabajando === t.id}
              onClick={() => onCambiarFecha(t, '')}
              title="La tarea se va al final de la lista de la maquila"
            >
              Quitar la fecha
            </button>
          )}
          {t.fechaRequeridaCambiadaPorNombre && (
            <span className="texto-suave" style={{ fontSize: 11 }}>
              prioridad movida por {t.fechaRequeridaCambiadaPorNombre}
              {t.fechaRequeridaCambiadaEn ? ` el ${fechaHora(t.fechaRequeridaCambiadaEn)}` : ''}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
        {t.techPack && (
          <button
            className="btn-secundario"
            onClick={() => setVisor({ maquilaId: t.maquilaId, tareaId: t.id, techPack: t.techPack })}
          >
            Ver tech pack
          </button>
        )}
        {t.estado === 'preparando' && (
          <>
            <label className="btn-secundario" style={{ cursor: 'pointer' }}>
              {trabajando === t.id ? 'Subiendo...' : 'Subir el tech pack (se corto la subida)'}
              <input
                type="file"
                accept=".pdf,.xlsx"
                style={{ display: 'none' }}
                disabled={trabajando === t.id}
                onChange={(e) => {
                  onSubirArchivo(t, e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <button
              className="btn-secundario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'cancelada')}
            >
              Cancelar tarea
            </button>
          </>
        )}
        {t.estado === 'abierta' && (
          <>
            <label className="btn-secundario" style={{ cursor: 'pointer' }}>
              {t.techPack ? 'Cambiar tech pack' : 'Adjuntar tech pack'}
              <input
                type="file"
                accept=".pdf,.xlsx"
                style={{ display: 'none' }}
                disabled={trabajando === t.id}
                onChange={(e) => {
                  onSubirArchivo(t, e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <button
              className="btn-primario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'terminada')}
              title="Cuando la maquila ya regreso el producto terminado"
            >
              Terminar (regreso el PT)
            </button>
            <button
              className="btn-secundario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'cancelada')}
            >
              Cancelar
            </button>
          </>
        )}
        {/* Ya la empezo la maquila: el tech pack YA NO se cambia (seria
            cambiarle el encargo debajo de las manos a quien esta armando; las
            reglas tampoco lo permiten). Solo cerrar o cancelar. */}
        {t.estado === 'iniciada' && (
          <>
            <button
              className="btn-primario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'terminada')}
              title="Cuando la maquila ya regreso el producto terminado"
            >
              Terminar (regreso el PT)
            </button>
            <button
              className="btn-secundario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'cancelada')}
            >
              Cancelar
            </button>
          </>
        )}
        {/* La maquila dice que ya termino: aqui se decide. */}
        {t.estado === 'declarada' && (
          <>
            <button
              className="btn-primario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'terminada')}
              title="Confirmas que ya regreso el producto terminado y cierras la tarea"
              style={{ background: '#16a34a' }}
            >
              Confirmar y cerrar
            </button>
            <button
              className="btn-secundario"
              disabled={trabajando === t.id}
              onClick={() => onDevolver(t)}
              title="No cuadro lo que entrego: se la regresas con un motivo"
            >
              Regresarsela
            </button>
            <button
              className="btn-secundario"
              disabled={trabajando === t.id}
              onClick={() => onTerminar(t, 'cancelada')}
            >
              Cancelar
            </button>
          </>
        )}
        {/* La señal de "quedo basura por barrer" es techPackBorradoEn, NO el
            manifiesto: al cerrar, el manifiesto se borra en el mismo write,
            y una subida cortada deja chunks SIN manifiesto. Mirando el
            manifiesto, esos chunks no tenian forma de limpiarse nunca. */}
        {['terminada', 'cancelada'].includes(t.estado) && !t.techPackBorradoEn && (
          <button
            className="btn-secundario"
            disabled={trabajando === t.id}
            onClick={() => onLimpiarPendiente(t)}
            style={{ borderColor: '#dc2626', color: '#dc2626' }}
          >
            Borrar el tech pack pendiente
          </button>
        )}
        {['terminada', 'cancelada'].includes(t.estado) && (
          <span className="texto-suave" style={{ fontSize: 12 }}>
            {t.terminadaPorNombre ? `Cerrada por ${t.terminadaPorNombre} el ${fechaDe(t.terminadaEn)}` : ''}
            {t.techPack ? ' · el tech pack NO se ha borrado' : ' · tech pack borrado'}
          </span>
        )}
      </div>
    </div>
  )

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}
      {progreso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{progreso}</div>}

      <form className="tarjeta" onSubmit={onCrear} style={{ marginBottom: 18 }}>
        <h2>Encargar ensamble a una maquila</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          La maquila ve la tarea en su portal con el tech pack <strong>solo en pantalla</strong>{' '}
          (sin descarga), y el archivo <strong>se borra</strong> cuando la tarea termina. Subelo de
          preferencia en <strong>PDF</strong>: el Excel se muestra como extraccion, no tal cual.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <label className="campo" style={{ flex: '1 1 220px' }}>
            <span>Maquila</span>
            <select
              value={nueva.maquilaId}
              onChange={(e) => setNueva({ ...nueva, maquilaId: e.target.value })}
            >
              <option value="">Elige la maquila</option>
              {maquilas
                // Cada mundo ve solo sus maquilas: un Tech Pack de un pedido
                // real no debe poder mandarse a la maquila de pruebas.
                .filter((m) => m.activo && (m.esPrueba === true) === esPrueba)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
            </select>
          </label>
          {/* PARA CUANDO SE NECESITA. Es lo que ordena el trabajo de la
              maquila: lo de hoy le sale arriba, lo de dentro de dos semanas
              abajo. Roberto, 2026-09-02: "si necesitamos algo hoy que le
              aparezca como primera tarea, pero si tiene algo para dentro de
              dos semanas, que le de mas calma". */}
          <label className="campo" style={{ flex: '1 1 160px' }}>
            <span>Para cuando (prioridad)</span>
            <input
              type="date"
              value={nueva.fechaRequerida}
              onChange={(e) => setNueva({ ...nueva, fechaRequerida: e.target.value })}
            />
          </label>
          {/* El amarre con el plan de Adrian. Opcional a proposito: una tarea
              de una OT que el plan no trae (o sin OT) se crea igual. Si el
              plan la conoce, la tarea queda con su "a quien va" congelado y
              el arbol la puede agrupar. */}
          <label className="campo" style={{ flex: '1 1 170px' }}>
            {/* UN SOLO campo: acepta las dos. Si es una OC, la pantalla ofrece
                sus OT. Antes decia solo "orden de trabajo" y Roberto escribio
                una OC (la 2422) y la app contesto que no existia. */}
            <span>Orden de trabajo o de compra</span>
            <input
              type="text"
              placeholder="ej. 7887 o 2422"
              maxLength={40}
              value={nueva.ot}
              onChange={(e) => {
                setNueva({ ...nueva, ot: e.target.value })
                setAvisoOt(null)
                setOtsElegidas([])
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  traerDelPlan()
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn-secundario"
            style={{ alignSelf: 'flex-end', marginBottom: 2 }}
            onClick={traerDelPlan}
            disabled={trayendoOt}
          >
            {trayendoOt ? 'Buscando...' : 'Traer del plan'}
          </button>
        </div>

        {avisoOt?.esOc && (
          <div
            style={{
              marginTop: 8,
              padding: '12px 14px',
              borderRadius: 8,
              background: '#eef2f7',
              border: '1px solid #c9d6e4',
              fontSize: 14
            }}
          >
            <strong>{avisoOt.esOc} es una orden de COMPRA, no una de trabajo.</strong>{' '}
            Trae {avisoOt.ots.length} orden(es) de trabajo. Elige cual le encargas a esta
            maquila — cada una se encarga por separado:
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {avisoOt.ots.map((o) => {
                const marcada = otsElegidas.includes(o.ot)
                return (
                  <label
                    key={o.ot}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      border: '1px solid',
                      borderColor: marcada ? '#1f4b7a' : '#c9d6e4',
                      background: marcada ? '#e9eff6' : '#fff',
                      borderRadius: 8,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      minWidth: 150
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={() =>
                        setOtsElegidas((prev) =>
                          prev.includes(o.ot) ? prev.filter((x) => x !== o.ot) : [...prev, o.ot]
                        )
                      }
                    />
                    <span>
                      <strong>OT {o.ot}</strong>
                      <span className="texto-suave" style={{ fontSize: 11, display: 'block' }}>
                        {o.codigos} codigo(s) · {Math.round(o.docenas * 100) / 100} doc.
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12, alignItems: 'center' }}>
              <button
                type="button"
                className="btn-primario"
                onClick={onEncargarVarias}
                disabled={trabajando === 'crear' || !otsElegidas.length}
              >
                {trabajando === 'crear'
                  ? progreso || 'Encargando...'
                  : `Encargar ${otsElegidas.length || ''} orden(es) a esta maquila`}
              </button>
              <button
                type="button"
                className="btn-secundario"
                onClick={() =>
                  setOtsElegidas(
                    otsElegidas.length === avisoOt.ots.length ? [] : avisoOt.ots.map((o) => o.ot)
                  )
                }
              >
                {otsElegidas.length === avisoOt.ots.length ? 'Ninguna' : 'Todas'}
              </button>
              <span className="texto-suave" style={{ fontSize: 12 }}>
                Se crea una tarea por cada orden de trabajo, todas a la misma maquila.
              </span>
            </div>
            {otsElegidas.length === 1 && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-secundario"
                  onClick={() => {
                    const o = otsElegidas[0]
                    setOtsElegidas([])
                    setNueva((p) => ({ ...p, ot: o }))
                    setAvisoOt(null)
                    setTimeout(() => traerDelPlan(o), 0)
                  }}
                >
                  O llenar el formulario con la OT {otsElegidas[0]} (para revisarla antes)
                </button>
              </div>
            )}
            {avisoOt.ots[0]?.destino && (
              <div className="texto-suave" style={{ fontSize: 12, marginTop: 8 }}>
                Va a {avisoOt.ots[0].destino}
              </div>
            )}
          </div>
        )}

        {avisoOt?.yaAsignada && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 14px',
              borderRadius: 8,
              background: '#fbeeec',
              border: '1px solid #f0c9c4',
              fontSize: 14
            }}
          >
            <strong style={{ color: '#a52218' }}>
              Esa orden de trabajo ya esta con {avisoOt.yaAsignada.maquilaId}
            </strong>{' '}
            («{avisoOt.yaAsignada.titulo}», {avisoOt.yaAsignada.estado}). Una OT va a UNA
            sola maquila: lo que se reparte entre varias es la orden de compra. Si de
            verdad hay que moverla, cancela primero la tarea que ya existe.
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Modelos a ensamblar</span>
          {renglones.map((r, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              <input
                type="text"
                placeholder="Codigo / modelo"
                style={{ flex: '1 1 140px' }}
                value={r.codigo}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], codigo: e.target.value }
                  setRenglones(copia)
                }}
              />
              <input
                type="text"
                placeholder="Descripcion (opcional)"
                style={{ flex: '2 1 200px' }}
                value={r.descripcion}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], descripcion: e.target.value }
                  setRenglones(copia)
                }}
              />
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Cantidad"
                style={{ flex: '0 1 110px' }}
                value={r.cantidad}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], cantidad: e.target.value }
                  setRenglones(copia)
                }}
              />
              <select
                style={{ flex: '0 1 110px' }}
                value={r.unidad}
                onChange={(e) => {
                  const copia = [...renglones]
                  copia[i] = { ...copia[i], unidad: e.target.value }
                  setRenglones(copia)
                }}
              >
                <option value="packs">packs</option>
                <option value="docenas">docenas</option>
                <option value="piezas">piezas</option>
              </select>
              {renglones.length > 1 && (
                <button
                  type="button"
                  className="btn-secundario"
                  onClick={() => setRenglones(renglones.filter((_, j) => j !== i))}
                >
                  Quitar
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-secundario"
            style={{ marginTop: 6 }}
            onClick={() => setRenglones([...renglones, { ...RENGLON_VACIO }])}
          >
            + Otro modelo
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, alignItems: 'flex-end' }}>
          <label className="campo" style={{ flex: '2 1 260px' }}>
            <span>Notas para la maquila (opcional)</span>
            <input
              type="text"
              maxLength={300}
              value={nueva.notas}
              onChange={(e) => setNueva({ ...nueva, notas: e.target.value })}
            />
          </label>
          <label className="campo" style={{ flex: '1 1 240px' }}>
            <span>Tech pack (PDF de preferencia, o Excel) · max 15 MB</span>
            <input
              type="file"
              accept=".pdf,.xlsx"
              onChange={(e) => setArchivo(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        <button className="btn-primario" type="submit" disabled={trabajando === 'crear'}>
          {trabajando === 'crear' ? progreso || 'Creando...' : 'Encargar a la maquila'}
        </button>
      </form>

      {/* Lo que espera una decision tuya, arriba y aparte: si se mezcla con el
          resto, una maquila puede quedarse dias esperando que le confirmen. */}
      {porConfirmar.length > 0 && (
        <div className="tarjeta" style={{ borderLeft: '4px solid #16a34a' }}>
          <h2>Por confirmar ({porConfirmar.length})</h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Estas maquilas ya avisaron que terminaron. Al confirmar se cierra la tarea y{' '}
            <strong>se borra su tech pack</strong>; si no cuadro lo que entregaron, regresasela con el
            motivo.
          </p>
          {porConfirmar.map(tarjeta)}
        </div>
      )}

      <div className="tarjeta">
        <h2>Tareas de ensamble ({vivas.length})</h2>
        {vivas.length === 0 ? (
          <p className="texto-suave">No hay tareas de ensamble abiertas.</p>
        ) : (
          vivas.map(tarjeta)
        )}
        {cerradas.length > 0 && (
          <>
            <button
              className="btn-secundario"
              style={{ marginTop: 6 }}
              onClick={() => setMostrarCerradas(!mostrarCerradas)}
            >
              {mostrarCerradas ? 'Ocultar terminadas' : `Ver terminadas (${cerradas.length})`}
            </button>
            {mostrarCerradas && <div style={{ marginTop: 10 }}>{cerradas.map(tarjeta)}</div>}
          </>
        )}
      </div>

      {visor && <VisorTechPack {...visor} onCerrar={() => setVisor(null)} />}
    </>
  )
}
