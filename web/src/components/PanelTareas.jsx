// Pestana Tareas: metas de produccion por ORDEN DE TRABAJO o por CODIGO
// ("100 docenas de la OT 7887"). El avance se calcula SOLO conforme se
// capturan bultos: no hay que reportar nada a mano. Al alcanzar la meta la
// tarea SE CIERRA SOLA (decision de Roberto 2026-08-13: nadie tiene que
// picar "ya termine"); si una meta estimada corta la cerro antes de tiempo,
// quien asigna puede REABRIRLA.
//
// QUIEN HACE QUE (decision de Roberto, 2026-08-11):
//   - Lindbergh y Roberto (admin) ENCARGAN tareas y las asignan a alguien.
//   - America solo RECIBE: ve unicamente las suyas y solo puede cerrarlas
//     (las reglas le impiden cambiar meta/objetivo, no solo la UI).
//   - Los pesadores (Angel, Juan) no entran aqui: solo Captura.
//
// La meta se mide en DOCENAS (decision de Roberto, 2026-08-06): es la unidad
// con la que se piden los pedidos, no la cantidad de bultos.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  documentId,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  Timestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { ordenDeCaptura } from '../utils/pdf'
import { docenasDeCaptura } from '../utils/reimprimir'
import { ubicarOts } from '../utils/ubicacionEnPlan'
import { normalizarOt, planVigente } from '../utils/planMaestro'
import { coincide } from '../utils/texto'
import { leerExcelTareas, tituloYNotas, ErrorImportacionTareas } from '../utils/importarTareas'
import { rellenarMetasDesdeRuteo } from '../utils/metasDelRuteo'

// Ventana de capturas que se considera para el avance. Una tarea vive dias,
// no meses; con esto la consulta se mantiene acotada.
const DIAS_AVANCE = 60
// Mismo tope que exige tareaValida() en firestore.rules.
const META_MAXIMA = 1000000

export default function PanelTareas() {
  const { authUser, perfil, puedeCrearTareas, esPrueba } = useAuth()
  const [tareas, setTareas] = useState([])
  const [capturas, setCapturas] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(null)
  const [mostrarCerradas, setMostrarCerradas] = useState(false)
  const [nueva, setNueva] = useState({
    titulo: '',
    objetivoTipo: 'ot',
    objetivoValor: '',
    metaDocenas: '',
    notas: '',
    asignadoAUid: ''
  })
  // Usuarios a los que se les puede encargar una tarea (los que ven la pestana
  // Tareas: rol distinto de 'captura'). Solo quien puede crear tareas los
  // consulta; las reglas permiten esa lectura.
  const [destinatarios, setDestinatarios] = useState([])
  // Destinatario del lote que se importa desde Excel.
  const [asignadoImport, setAsignadoImport] = useState('')
  // Vista previa de la importacion desde Excel: nada se guarda hasta que se
  // pica "Crear". { tareas, duplicadas, hojasLeidas, hojasIgnoradas,
  // renglonesDescartados, nombreArchivo }
  const [importacion, setImportacion] = useState(null)

  // El avance de las tareas se calcula en el NAVEGADOR cruzando tareas contra
  // capturas, y al llegar a la meta la tarea se cierra sola. Por eso los dos
  // lados tienen que filtrarse por mundo ANTES de cruzarse: si no, una captura
  // ZZTEST de prueba le sumaria avance a una tarea REAL de America, y el
  // navegador de America -- que es un usuario legitimo escribiendo sobre una
  // tarea legitima -- la cerraria solo. Ninguna regla de Firestore puede
  // cazar eso: para el servidor es una escritura perfectamente valida.
  const esDePrueba = (doc) => doc?.esPrueba === true
  const esFolioDePrueba = (folio) => /^ZZTEST/i.test(String(folio || ''))

  useEffect(() => {
    const unsubTareas = onSnapshot(
      query(collection(db, 'tareas'), orderBy('creadoEn', 'desc')),
      (snap) =>
        setTareas(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((t) => esDePrueba(t) === esPrueba)
        ),
      (err) => {
        console.error('[PanelTareas] Error escuchando tareas:', err)
        setError('No se pudieron cargar las tareas: ' + (err.message || err))
      }
    )
    const desde = new Date()
    desde.setHours(0, 0, 0, 0)
    desde.setDate(desde.getDate() - DIAS_AVANCE)
    const unsubCapturas = onSnapshot(
      query(
        collection(db, 'bultos'),
        where('creadoEn', '>=', Timestamp.fromDate(desde)),
        orderBy('creadoEn', 'desc')
      ),
      (snap) =>
        setCapturas(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((c) => esFolioDePrueba(c.folio || c.id) === esPrueba)
        ),
      (err) => {
        console.error('[PanelTareas] Error escuchando capturas:', err)
        setError('No se pudo calcular el avance: ' + (err.message || err))
      }
    )
    return () => {
      unsubTareas()
      unsubCapturas()
    }
    // esPrueba en las dependencias: al cambiar de cuenta hay que rearmar las
    // dos suscripciones, o la sesion nueva sigue calculando avances con los
    // datos del mundo anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esPrueba])

  // Lista de destinatarios: se carga una vez si el usuario puede asignar.
  useEffect(() => {
    if (!puedeCrearTareas) return
    let cancelado = false
    getDocs(collection(db, 'usuarios'))
      .then((snap) => {
        if (cancelado) return
        // Solo INTERNOS que ven la pestana Tareas. Excluir nada mas 'captura'
        // dejaba asignables a las cuentas de maquila, que jamas podrian leer
        // la tarea (las reglas exigen esInterno): quedaba en un limbo.
        const ROLES_ASIGNABLES = ['completo', 'consulta', 'almacen', 'admin']
        const gente = snap.docs
          .map((d) => ({ uid: d.id, ...d.data() }))
          // Cada quien ve destinatarios de SU mundo: una cuenta de prueba solo
          // puede encargarle a otra cuenta de prueba (las reglas lo exigen), y
          // al personal real no le aparecen las cuentas demo en la lista, que
          // solo servirian para equivocarse.
          .filter((u) => (u.esPrueba === true) === esPrueba)
          .filter((u) => u.activo !== false && ROLES_ASIGNABLES.includes(u.rol) && !u.maquilaId)
          .sort((a, b) => String(a.nombreCompleto || '').localeCompare(String(b.nombreCompleto || ''), 'es'))
        setDestinatarios(gente)
      })
      .catch((err) => console.error('[PanelTareas] No se pudo cargar destinatarios:', err))
    return () => {
      cancelado = true
    }
    // esPrueba tiene que estar aqui: al pasar de Lindbergh real a la cuenta de
    // prueba (o al reves) puedeCrearTareas no cambia de valor, el efecto no se
    // volveria a correr y la lista quedaria con los destinatarios del mundo
    // anterior -- justo la lista con la que se elige a quien encargarle algo.
  }, [puedeCrearTareas, esPrueba])

  // Avance por tarea: se suman las DOCENAS de las capturas hechas DESPUES de
  // que la tarea se creo y que corresponden a su OT o codigo.
  const avanceDe = (tarea) => {
    const creadaEn = tarea.creadoEn?.toDate ? tarea.creadoEn.toDate() : null
    const objetivo = String(tarea.objetivoValor || '').trim().toUpperCase()
    const propias = capturas.filter((c) => {
      const fecha = c.creadoEn?.toDate ? c.creadoEn.toDate() : null
      // Una captura sin fecha resuelta aun (serverTimestamp pendiente en
      // cache local) se EXCLUYE hasta confirmarla: incluirla podria inflar el
      // avance con bultos que en realidad son anteriores a la tarea.
      if (creadaEn && (!fecha || fecha < creadaEn)) return false
      if (tarea.objetivoTipo === 'ot') return ordenDeCaptura(c) === objetivo
      if (String(c.producto?.codigo || '').trim().toUpperCase() !== objetivo) return false
      // Tarea del formato especial: solo cuentan las capturas de SUS OTs.
      const ots = Array.isArray(tarea.ots) ? tarea.ots : []
      return ots.length === 0 || ots.includes(ordenDeCaptura(c))
    })
    const docenas = propias.reduce((acc, c) => acc + docenasDeCaptura(c), 0)

    // ⚠️ LA TAREA SE COMPLETA EN DOS ETAPAS, y esto es lo que la cierra.
    //
    // Capturar el folio es la PRIMERA mitad: el bulto ya existe y se peso.
    // Pero la finalidad de la tarea es la REMISION — que el material salga
    // hacia donde tiene que ir. Textual del dueno en la junta del 17-08: "el
    // avance tiene que estar determinado por las notas de remision... como le
    // voy restando esa tarea con las notas de remision que ellos hagan hacia
    // aca". Un bulto capturado que nunca se remisiono no completo nada: sigue
    // en la planta.
    //
    // Un bulto trae `pdfGeneradoEn` en cuanto sale en una remision, asi que la
    // segunda etapa se mide sin consultar nada mas.
    const remisionadas = propias.filter((c) => c.pdfGeneradoEn)
    const docenasRemisionadas = remisionadas.reduce((acc, c) => acc + docenasDeCaptura(c), 0)

    return {
      // Lo capturado: la primera mitad, util para ver que si se esta
      // trabajando aunque todavia no salga.
      docenas,
      bultos: propias.length,
      kg: propias.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000,
      porcentajeCapturado:
        tarea.metaDocenas > 0 ? Math.min(100, (docenas / tarea.metaDocenas) * 100) : 0,

      // Lo REMISIONADO: es lo que de verdad cumple la tarea y lo que la cierra.
      docenasRemisionadas,
      bultosRemisionados: remisionadas.length,
      enPlanta: Math.max(0, docenas - docenasRemisionadas),
      porcentaje:
        tarea.metaDocenas > 0
          ? Math.min(100, (docenasRemisionadas / tarea.metaDocenas) * 100)
          : 0
    }
  }

  const conAvance = useMemo(
    () => tareas.map((t) => ({ ...t, avance: avanceDe(t) })),
    // avanceDe depende de capturas; tareas y capturas son las fuentes reales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tareas, capturas]
  )

  // Cada quien ve lo que le toca: quien puede crear tareas ve TODAS (para dar
  // seguimiento); los demas (America) solo las que se les asignaron.
  // Con useMemo para que 'listas' conserve su referencia entre renders: es
  // dependencia del efecto de auto-cierre, y recalcularla en cada render lo
  // haria re-ejecutarse aunque no hayan cambiado los datos.
  const misTareas = useMemo(
    () =>
      puedeCrearTareas ? conAvance : conAvance.filter((t) => t.asignadoAUid === authUser?.uid),
    [conAvance, puedeCrearTareas, authUser?.uid]
  )
  // Se ubican las OT de todas las tareas en una sola tanda (la pantalla llega a
  // tener 124 tarjetas; una consulta por tarjeta seria absurdo). Las tareas por
  // codigo tambien cuentan: su lista `ots` dice a que ordenes pertenecen.
  // DONDE CAE CADA TAREA EN EL PLAN. Lindbergh pide por orden de trabajo pero
  // tiene que cumplir ordenes de compra: sin esto, la pantalla le da 124
  // tarjetas sueltas y el agrupador se lo tiene que saber de memoria — que es
  // exactamente lo que la junta del 17-08 pidio quitarle.
  const [ubicaciones, setUbicaciones] = useState(new Map())
  // Un solo buscador que entiende folio, codigo, orden de trabajo, orden de
  // compra y destino: cada quien busca por lo que ya trae en la cabeza.
  const [busqueda, setBusqueda] = useState('')
  // Que ordenes y que OT estan desplegadas. Arrancan cerradas: la gracia de
  // agrupar es no ver 123 tarjetas de golpe.
  const [ocsAbiertas, setOcsAbiertas] = useState(new Set())
  const [otsAbiertas, setOtsAbiertas] = useState(new Set())

  const otsDeLasTareas = useMemo(() => {
    const set = new Set()
    misTareas.forEach((t) => {
      if (t.objetivoTipo === 'ot' && t.objetivoValor) set.add(String(t.objetivoValor))
      ;(Array.isArray(t.ots) ? t.ots : []).forEach((o) => set.add(String(o)))
    })
    return [...set]
  }, [misTareas])

  useEffect(() => {
    let cancelado = false
    if (!otsDeLasTareas.length) return
    ubicarOts(otsDeLasTareas).then((mapa) => {
      if (!cancelado) setUbicaciones(mapa)
    })
    return () => {
      cancelado = true
    }
  }, [otsDeLasTareas.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  /** La orden de compra y el destino de una tarea, si el plan los conoce. */
  const enElPlan = (t) => {
    const ots = t.objetivoTipo === 'ot' ? [t.objetivoValor] : Array.isArray(t.ots) ? t.ots : []
    for (const ot of ots) {
      // normalizarOt y no una copia a mano: ubicarOts indexa el Map con esa
      // misma funcion, y dos criterios distintos harian que el cruce falle sin
      // dar ningun error (regla dura que ya nos mordio).
      const u = ubicaciones.get(normalizarOt(ot))
      if (u) return { ...u, ot: String(ot) }
    }
    return null
  }

  // Un solo buscador para todos los niveles: America teclea un folio o un
  // codigo, Lindbergh una orden de trabajo o una de compra, y el papa el
  // nombre del cliente. Cada quien busca por lo que ya trae en la cabeza en
  // vez de aprenderse el vocabulario de otro.
  const filtradas = useMemo(() => {
    const q = busqueda.trim()
    if (!q) return misTareas
    return misTareas.filter((t) => {
      const u = enElPlan(t)
      return (
        coincide(t.titulo, q) ||
        coincide(t.objetivoValor, q) ||
        coincide(t.notas || '', q) ||
        coincide(t.asignadoANombre || '', q) ||
        (Array.isArray(t.ots) && t.ots.some((o) => coincide(String(o), q))) ||
        (u && (coincide(u.oc, q) || coincide(u.destino, q)))
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [misTareas, busqueda, ubicaciones])

  // COMO VA CADA ORDEN DE COMPRA, sumando sus tareas. Es lo que Lindbergh
  // necesita y no tenia: el pide por orden de TRABAJO, pero a el le exigen la
  // orden de COMPRA. Aqui las dos cosas viven en la misma pantalla.
  const abiertas = useMemo(() => filtradas.filter((t) => t.estado === 'abierta'), [filtradas])
  const cerradas = useMemo(() => filtradas.filter((t) => t.estado !== 'abierta'), [filtradas])

  const SIN_OC = '__sin_oc__'
  const SIN_OT = '__sin_ot__'

  /**
   * EL ARBOL DE LAS TAREAS: orden de compra -> orden de trabajo -> tareas.
   *
   * Es la misma forma que ya tiene el Historial (picas una OT y se abren sus
   * folios) porque Lindbergh no deberia aprender dos navegaciones distintas
   * para la misma jerarquia. Con 123 tarjetas sueltas se confundia igual que
   * antes de la app, que es justo lo que la junta pidio quitarle.
   *
   * Lo que no cuadra NO se esconde: las tareas que el plan todavia no ubica
   * caen en su propio grupo al final, contadas, en vez de desaparecer.
   */
  const arbolTareas = useMemo(() => {
    const porOc = new Map()
    abiertas.forEach((t) => {
      const u = enElPlan(t)
      const claveOc = u?.oc || SIN_OC
      const claveOt =
        u?.ot || (t.objetivoTipo === 'ot' ? normalizarOt(t.objetivoValor) : '') || SIN_OT
      if (!porOc.has(claveOc)) {
        porOc.set(claveOc, { oc: claveOc, destino: u?.destino || '', ots: new Map(), tareas: 0 })
      }
      const g = porOc.get(claveOc)
      g.tareas += 1
      if (!g.destino && u?.destino) g.destino = u.destino
      if (!g.ots.has(claveOt)) g.ots.set(claveOt, { ot: claveOt, lista: [] })
      g.ots.get(claveOt).lista.push(t)
    })

    // Avance de un grupo: ponderado por meta y topando cada tarea en la suya,
    // igual que el arbol de ordenes. Sin ese tope una tarea sobrecumplida tapa
    // a otra que no arranco y el grupo se ve listo sin estarlo.
    const avance = (tareas) => {
      const meta = tareas.reduce((a, t) => a + (Number(t.metaDocenas) || 0), 0)
      // Lo REMISIONADO, igual que en cada tarjeta: el grupo no puede ir mas
      // adelantado que las tareas que lo componen.
      const hecho = tareas.reduce(
        (a, t) => a + Math.min(t.avance?.docenasRemisionadas || 0, Number(t.metaDocenas) || 0),
        0
      )
      const capturado = tareas.reduce(
        (a, t) => a + Math.min(t.avance?.docenas || 0, Number(t.metaDocenas) || 0),
        0
      )
      return {
        meta,
        hecho,
        enPlanta: Math.max(0, capturado - hecho),
        porcentaje: meta > 0 ? Math.min(100, (hecho / meta) * 100) : null
      }
    }

    return [...porOc.values()]
      .map((g) => ({
        ...g,
        ...avance([...g.ots.values()].flatMap((o) => o.lista)),
        ots: [...g.ots.values()]
          .map((o) => ({ ...o, ...avance(o.lista) }))
          .sort((a, b) => {
            if (a.ot === SIN_OT) return 1
            if (b.ot === SIN_OT) return -1
            return String(a.ot).localeCompare(String(b.ot), 'es', { numeric: true })
          })
      }))
      .sort((a, b) => {
        // Lo que el plan no ubica va al final: es lo que hay que arreglar, no
        // lo primero que Lindbergh tiene que ver cada manana.
        if (a.oc === SIN_OC) return 1
        if (b.oc === SIN_OC) return -1
        return String(a.oc).localeCompare(String(b.oc), 'es', { numeric: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abiertas, ubicaciones])

  const listas = useMemo(
    () => abiertas.filter((t) => t.avance.docenas >= t.metaDocenas),
    [abiertas]
  )

  // CIERRE AUTOMATICO (Roberto 2026-08-13): al llegar a la meta la tarea se
  // marca cumplida sola, nadie tiene que picarle. Corre en el navegador de
  // quien tenga permiso de cerrarla (quien asigna, o el destinatario). Se
  // cierra en TRANSACCION releyendo la tarea: si otro cliente ya la cerro, o
  // alguien le subio la meta mientras tanto, este intento se descarta sin
  // ruido. Las capturas con serverTimestamp pendiente ya estan excluidas del
  // avance (avanceDe las filtra), asi que una captura local sin confirmar no
  // dispara el cierre.
  const cierresIntentados = useRef(new Set())
  useEffect(() => {
    for (const t of listas) {
      if (!(t.metaDocenas > 0)) continue
      if (!(puedeCrearTareas || t.asignadoAUid === authUser?.uid)) continue
      if (cierresIntentados.current.has(t.id)) continue
      cierresIntentados.current.add(t.id)
      // El avance EXACTO decide si se cierra; el redondeo es solo para el dato
      // que se guarda. Comparar el redondeado adelantaria el cierre en casos
      // como 99.995 -> 100.00 contra una meta de 100.
      // Lo REMISIONADO, no lo capturado: la tarea la cierra la remision.
      const avanceExacto = t.avance.docenasRemisionadas
      const avanceDocenas = Number(avanceExacto.toFixed(2))
      runTransaction(db, async (tx) => {
        const vivo = await tx.get(doc(db, 'tareas', t.id))
        if (!vivo.exists()) return
        const datos = vivo.data()
        // Releer antes de cerrar: si ya no esta abierta, o la meta vigente
        // subio por encima del avance con el que se disparo, no se cierra.
        if (datos.estado !== 'abierta') return
        if (!(datos.metaDocenas > 0) || avanceExacto < datos.metaDocenas) return
        tx.update(doc(db, 'tareas', t.id), {
          estado: 'cumplida',
          cumplidaEn: serverTimestamp(),
          avanceAlCumplir: avanceDocenas
        })
      })
        .then(() => {
          setAviso(
            `Tarea "${t.titulo}" CUMPLIDA sola al llegar a la meta (${avanceDocenas} docenas).`
          )
        })
        .catch((err) => {
          // Sin banner de error: si fallo por permisos o carrera, otro
          // cliente la va a cerrar; el estado real llega por el snapshot.
          console.warn('[PanelTareas] No se pudo auto-cerrar', t.id, err?.message || err)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listas, puedeCrearTareas, authUser?.uid])

  const alternar = (conjunto, poner, clave) => {
    const copia = new Set(conjunto)
    if (copia.has(clave)) copia.delete(clave)
    else copia.add(clave)
    poner(copia)
  }

  /** Barra + porcentaje, con '—' cuando no hay meta contra que medir. */
  const barraAvance = (porcentaje) => (
    <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
      <div style={{ background: '#e5e7eb', borderRadius: 999, height: 8, width: 110, overflow: 'hidden' }}>
        <div
          style={{
            width: `${porcentaje === null ? 0 : Math.max(2, porcentaje)}%`,
            height: '100%',
            background:
              porcentaje === null
                ? '#94a3b8'
                : porcentaje >= 99
                  ? '#16a34a'
                  : porcentaje >= 50
                    ? '#d97706'
                    : '#dc2626'
          }}
        />
      </div>
      <strong style={{ minWidth: 44, textAlign: 'right' }}>
        {porcentaje === null ? '—' : `${porcentaje.toFixed(0)}%`}
      </strong>
    </span>
  )

  const usuarioActual = () => ({
    uid: authUser?.uid,
    nombre: perfil?.nombreCompleto || 'Estacion'
  })

  // Folios que faltan por tarea (se consultan al abrir): del ruteo VIGENTE
  // se toman los folios del codigo (acotados a las OTs de la tarea si trae),
  // y se les resta lo ya capturado. { [tareaId]: { cargando, folios, error } }
  const [faltantes, setFaltantes] = useState({})


  const consultarFaltantes = async (tarea) => {
    if (tarea.objetivoTipo !== 'codigo') return
    setFaltantes((prev) => ({ ...prev, [tarea.id]: { cargando: true, folios: null, error: '' } }))
    try {
      const codigo = String(tarea.objetivoValor || '').trim().toUpperCase()
      const snapRuteo = await getDocs(
        query(collection(db, 'foliosRuteo'), where('codigo', '==', codigo))
      )
      const ots = Array.isArray(tarea.ots) ? tarea.ots : []
      const delCodigo = snapRuteo.docs
        .map((d) => {
          const datos = d.data()
          const m = /^\d{4}/.exec(String(datos.pedido || '').trim())
          return { folio: d.id, ...datos, otRuteo: m ? m[0] : null }
        })
        .filter((f) => {
          if (ots.length === 0) return true
          // Un folio del codigo SIN OT identificable no se descarta: se
          // muestra marcado, porque bien puede ser de esta tarea y America
          // debe verlo (ocultarlo subreportaria faltantes).
          return f.otRuteo === null || ots.includes(f.otRuteo)
        })

      // ¿Cuales de esos folios ya estan capturados? Consulta por ID en
      // lotes de 30 (tope del operador 'in' con documentId). Se guarda el
      // bulto completo, no solo el ID: America quiere VER lo ya capturado
      // (quien lo peso y cuando), no nada mas restarlo (Roberto 2026-08-13).
      const capturados = new Map()
      for (let i = 0; i < delCodigo.length; i += 30) {
        const lote = delCodigo.slice(i, i + 30).map((f) => f.folio)
        const snap = await getDocs(
          query(collection(db, 'bultos'), where(documentId(), 'in', lote))
        )
        snap.docs.forEach((d) => capturados.set(d.id, d.data()))
      }

      const porFolioAscendente = (a, b) =>
        String(a.folio).localeCompare(String(b.folio), 'es', { numeric: true })
      const pendientes = delCodigo
        .filter((f) => !capturados.has(f.folio))
        .sort(porFolioAscendente)
      const yaCapturados = delCodigo
        .filter((f) => capturados.has(f.folio))
        .map((f) => {
          const bulto = capturados.get(f.folio)
          return {
            ...f,
            capturadoEn: bulto.creadoEn || null,
            capturadoPor: bulto.operadorNombre || '',
            pesoGramos: bulto.pesoGramos || 0
          }
        })
        .sort(porFolioAscendente)
      setFaltantes((prev) => ({
        ...prev,
        [tarea.id]: {
          cargando: false,
          folios: pendientes,
          foliosCapturados: yaCapturados,
          enRuteo: delCodigo.length,
          capturados: capturados.size,
          error: ''
        }
      }))
    } catch (err) {
      console.error('[PanelTareas] Error consultando folios faltantes:', err)
      setFaltantes((prev) => ({
        ...prev,
        [tarea.id]: { cargando: false, folios: null, error: err.message || String(err) }
      }))
    }
  }

  const onArchivoTareas = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!archivo) return
    setError('')
    setAviso('')
    setImportacion(null)
    setTrabajando('importar')
    try {
      const leido = await leerExcelTareas(await archivo.arrayBuffer())
      // Las tareas que no traen cantidad se completan con el RUTEO ya cargado
      // (suma de docenas de los folios de ese codigo en esas OTs). Lo que no
      // se pueda derivar queda para teclear a mano en la vista previa.
      // Si el ruteo no se puede consultar, el archivo SI se leyo: se sigue con
      // las metas sin derivar en vez de decir que fallo la lectura.
      let conMetas = { tareas: leido.tareas, derivadas: 0, sinRuteo: 0 }
      try {
        conMetas = await rellenarMetasDesdeRuteo(leido.tareas)
      } catch (err) {
        console.error('[PanelTareas] No se pudo consultar el ruteo para estimar metas:', err)
        setAviso(
          'El archivo se leyo bien, pero no se pudo consultar el ruteo para calcular las metas ' +
            'que faltaban: escribelas a mano abajo.'
        )
      }
      const resultado = { ...leido, tareas: conMetas.tareas }
      // Un codigo que YA tiene tarea abierta no se duplica: se reporta y el
      // que decide es quien importa (cerrando la vieja o dejandola).
      const abiertosAhora = new Set(
        tareas
          .filter((t) => t.estado === 'abierta' && t.objetivoTipo === 'codigo')
          .map((t) => String(t.objetivoValor).trim().toUpperCase())
      )
      const duplicadas = resultado.tareas.filter((t) => abiertosAhora.has(t.codigo))
      const nuevas = resultado.tareas.filter((t) => !abiertosAhora.has(t.codigo))

      // ⚠️ AVISAR ANTES DE CREAR, no despues. Una tarea cuya orden de trabajo
      // no esta en el plan maestro se crea igual, pero cae en el grupo
      // "Todavia sin orden de compra" y no suma al avance de ninguna orden.
      // Lindbergh lo pidio el 21-08: que no se ignore en silencio, que salga
      // una leyenda de aguas mientras todavia se puede cancelar.
      let avisoPlan = null
      try {
        const todasLasOts = [...new Set(nuevas.flatMap((t) => t.otsInfo || []))]
        const ubic = await ubicarOts(todasLasOts)
        const sinPlan = todasLasOts.filter((o) => !ubic.get(normalizarOt(o)))
        // Las ordenes de compra que venia en el ARCHIVO (casi ningun archivo
        // las trae, pero si vienen hay que contrastarlas).
        const ocsArchivo = [...new Set(nuevas.flatMap((t) => t.ocsDelArchivo || []))]
        const ocsDelPlan = new Set([...ubic.values()].map((u) => u.oc).filter(Boolean))
        const ocsSinPlan = ocsArchivo.filter((oc) => !ocsDelPlan.has(oc))
        // Lo mas delicado: el archivo dice una orden de compra y el plan dice
        // OTRA para esa misma orden de trabajo. Alguno de los dos esta mal.
        const contradicciones = []
        nuevas.forEach((t) => {
          ;(t.ocsDelArchivo || []).forEach((ocArchivo) => {
            ;(t.otsInfo || []).forEach((ot) => {
              const u = ubic.get(normalizarOt(ot))
              if (u?.oc && u.oc !== ocArchivo) {
                contradicciones.push(`OT ${ot}: el archivo dice ${ocArchivo}, el plan dice ${u.oc}`)
              }
            })
          })
        })
        if (sinPlan.length || ocsSinPlan.length || contradicciones.length) {
          // Que plan esta vigente AHORA. Es el dato que convierte el aviso en
          // algo que se puede accionar: si el plan cargado es de hace un mes,
          // ya se sabe a quien hay que buscar y para que.
          let vigente = null
          try {
            vigente = await planVigente()
          } catch {
            // Si no se puede leer, el aviso sale igual pero sin esa linea.
          }
          avisoPlan = {
            sinPlan,
            ocsSinPlan,
            contradicciones: [...new Set(contradicciones)],
            planArchivo: vigente?.archivo || null,
            planFecha: vigente?.activadaEn?.toDate ? vigente.activadaEn.toDate() : null
          }
        }
      } catch (err) {
        // Si no se puede consultar el plan, el archivo SI se leyo: se sigue sin
        // el aviso en vez de bloquear la importacion.
        console.error('[PanelTareas] No se pudo contrastar contra el plan maestro:', err)
      }

      setImportacion({
        avisoPlan,
        nombreArchivo: archivo.name,
        tareas: nuevas,
        duplicadas,
        hojasLeidas: resultado.hojasLeidas,
        hojasIgnoradas: resultado.hojasIgnoradas,
        renglonesDescartados: resultado.renglonesDescartados,
        sinMeta: resultado.sinMeta || [],
        derivadas: conMetas.derivadas,
        sinRuteo: conMetas.sinRuteo
      })
    } catch (err) {
      console.error('[PanelTareas] Error leyendo el Excel de tareas:', err)
      setError(
        err instanceof ErrorImportacionTareas
          ? err.message
          : 'No se pudo leer el archivo: ' + (err.message || err)
      )
    } finally {
      setTrabajando(null)
    }
  }

  // Lotes de escritura: las reglas exigen creadoEn == request.time, que
  // serverTimestamp() cumple tambien dentro de un writeBatch. Cada lote es
  // todo-o-nada; 400 por lote respeta el tope de 500 operaciones.
  // Teclear a mano la meta de una tarea de la vista previa (las que no venian
  // en el Excel ni se pudieron derivar del ruteo).
  const cambiarMetaImportada = (codigo, texto) => {
    const valor = texto.trim() === '' ? null : Number(texto)
    // Tope que exigen las reglas de Firestore: sin validarlo aqui, un cero de
    // mas tumbaria el lote entero con un permission-denied sin explicacion.
    const valido = Number.isFinite(valor) && valor > 0 && valor <= META_MAXIMA
    setImportacion((prev) =>
      prev
        ? {
            ...prev,
            tareas: prev.tareas.map((t) =>
              t.codigo === codigo
                ? {
                    ...t,
                    metaTexto: texto,
                    metaDocenas: valido ? valor : null,
                    origenMeta: valido ? 'manual' : 'falta'
                  }
                : t
            )
          }
        : prev
    )
  }

  const onCrearImportadas = async () => {
    if (!importacion || importacion.tareas.length === 0) return
    setError('')
    setAviso('')
    const vacias = importacion.tareas.filter((t) => !(t.metaDocenas > 0))
    const pasadas = importacion.tareas.filter((t) => t.metaDocenas > META_MAXIMA)
    if (vacias.length > 0 || pasadas.length > 0) {
      const partes = []
      if (vacias.length > 0) {
        partes.push(
          `faltan ${vacias.length} meta(s) por llenar (${vacias.slice(0, 6).map((t) => t.codigo).join(', ')}${
            vacias.length > 6 ? '...' : ''
          })`
        )
      }
      if (pasadas.length > 0) {
        partes.push(
          `${pasadas.length} meta(s) pasan del maximo de ${META_MAXIMA.toLocaleString('es-MX')} docenas ` +
            `(${pasadas.slice(0, 6).map((t) => `${t.codigo}: ${t.metaDocenas}`).join(', ')})`
        )
      }
      setError(`No se pueden crear: ${partes.join(' y ')}. Revisa la columna "Meta" de abajo.`)
      return
    }
    setTrabajando('importar')
    let creadas = 0
    const creadasHastaAhora = () => creadas
    try {
      const u = usuarioActual()
      const destinoImport = destinatarios.find((d) => d.uid === asignadoImport)
      const LOTE = 400
      for (let i = 0; i < importacion.tareas.length; i += LOTE) {
        const lote = importacion.tareas.slice(i, i + LOTE)
        const batch = writeBatch(db)
        for (const t of lote) {
          const { titulo, notas } = tituloYNotas(t)
          batch.set(doc(collection(db, 'tareas')), {
            titulo,
            objetivoTipo: 'codigo',
            objetivoValor: t.codigo,
            metaDocenas: t.metaDocenas,
            estado: 'abierta',
            creadoPorUid: u.uid,
            creadoPorNombre: u.nombre,
            creadoEn: serverTimestamp(),
            notas: notas || null,
            cumplidaEn: null,
            avanceAlCumplir: null,
            // Solo se escribe en las cuentas de prueba: para el personal real
            // el documento queda con los mismos campos de siempre.
            ...(esPrueba ? { esPrueba: true } : {}),
            // Las OTs del formato especial acotan que folios del ruteo
            // cuentan para esta tarea (vacio = cualquier OT del codigo).
            ots: t.ots || [],
            asignadoAUid: destinoImport?.uid || '',
            asignadoANombre: destinoImport?.nombreCompleto || ''
          })
        }
        await batch.commit()
        creadas += lote.length
      }
      setAviso(
        `${importacion.tareas.length} tareas creadas desde "${importacion.nombreArchivo}". ` +
          (importacion.duplicadas.length > 0
            ? `${importacion.duplicadas.length} codigos ya tenian tarea abierta y NO se duplicaron.`
            : 'El avance se cuenta con lo que se capture desde ahora.')
      )
      setImportacion(null)
    } catch (err) {
      console.error('[PanelTareas] Error creando tareas importadas:', err)
      // Los lotes ya escritos son atomicos: la vista previa se recorta a lo
      // que FALTA, para que reintentar no duplique lo que si entro.
      setImportacion((prev) =>
        prev ? { ...prev, tareas: prev.tareas.slice(creadasHastaAhora()) } : prev
      )
      setError(
        `Se crearon ${creadasHastaAhora()} tareas y fallo el resto: ${err.message || err}. ` +
          'La lista de abajo ya solo trae las pendientes: vuelve a picar Crear.'
      )
    } finally {
      setTrabajando(null)
    }
  }

  const onCrear = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    const meta = Number(nueva.metaDocenas)
    const objetivo = nueva.objetivoValor.trim().toUpperCase()
    if (!nueva.titulo.trim()) {
      setError('Ponle un titulo a la tarea (ej. "Pedido Walmart agosto").')
      return
    }
    if (!objetivo) {
      setError(nueva.objetivoTipo === 'ot' ? 'Escribe la OT (ej. 7887).' : 'Escribe el codigo de producto.')
      return
    }
    if (!Number.isFinite(meta) || meta <= 0) {
      setError('La meta debe ser un numero de docenas mayor a cero.')
      return
    }
    setTrabajando('nueva')
    try {
      const u = usuarioActual()
      const destino = destinatarios.find((d) => d.uid === nueva.asignadoAUid)
      await addDoc(collection(db, 'tareas'), {
        titulo: nueva.titulo.trim(),
        objetivoTipo: nueva.objetivoTipo,
        objetivoValor: objetivo,
        metaDocenas: meta,
        estado: 'abierta',
        creadoPorUid: u.uid,
        creadoPorNombre: u.nombre,
        creadoEn: serverTimestamp(),
        notas: nueva.notas.trim() || null,
        cumplidaEn: null,
        avanceAlCumplir: null,
        ...(esPrueba ? { esPrueba: true } : {}),
        asignadoAUid: destino?.uid || '',
        asignadoANombre: destino?.nombreCompleto || ''
      })
      setNueva({ titulo: '', objetivoTipo: 'ot', objetivoValor: '', metaDocenas: '', notas: '', asignadoAUid: '' })
      setAviso(
        `Tarea creada: ${meta} docenas de ${nueva.objetivoTipo === 'ot' ? 'la OT' : 'el codigo'} ${objetivo}` +
          (destino ? ` para ${destino.nombreCompleto}` : '') +
          '. El avance se cuenta solo conforme se capturen bultos.'
      )
    } catch (err) {
      console.error('[PanelTareas] Error creando la tarea:', err)
      setError('No se pudo crear la tarea: ' + (err.message || err))
    } finally {
      setTrabajando(null)
    }
  }

  const cerrarTarea = async (tarea, estado) => {
    setError('')
    setAviso('')
    setTrabajando(tarea.id)
    try {
      // Solo se tocan los 3 campos del cierre: asi el update satisface tanto
      // la rama del creador como la del destinatario (cuyas reglas exigen
      // affectedKeys().hasOnly(['estado','cumplidaEn','avanceAlCumplir'])).
      // Los demas campos quedan intactos por ser un update parcial.
      await updateDoc(doc(db, 'tareas', tarea.id), {
        estado,
        cumplidaEn: serverTimestamp(),
        // Lo REMISIONADO: es el criterio con el que la tarea se da por
        // cumplida, asi que es lo que hay que dejar grabado.
        avanceAlCumplir: Number(tarea.avance.docenasRemisionadas.toFixed(2))
      })
      setAviso(
        estado === 'cumplida'
          ? `Tarea "${tarea.titulo}" marcada como CUMPLIDA con ${tarea.avance.docenas.toFixed(2)} docenas.`
          : `Tarea "${tarea.titulo}" cancelada.`
      )
    } catch (err) {
      console.error('[PanelTareas] Error cerrando la tarea:', err)
      setError('No se pudo actualizar la tarea: ' + (err.message || err))
    } finally {
      setTrabajando(null)
    }
  }

  // Red de seguridad del cierre automatico: si una meta estimada corta cerro
  // la tarea antes de tiempo, quien asigna la regresa a 'abierta'. OJO: NO se
  // limpia cierresIntentados a proposito -- si se limpiara, el auto-cierre la
  // volveria a cerrar en el mismo instante (el avance sigue arriba de la meta
  // vieja) y el boton no serviria de nada. Con el set intacto, Lindbergh
  // tiene esta sesion para corregir la meta con calma; en otros navegadores
  // (o al recargar) la tarea se vuelve a cerrar sola si de verdad ya cumplio.
  const reabrirTarea = async (tarea) => {
    setError('')
    setAviso('')
    if (!window.confirm(`¿Reabrir la tarea "${tarea.titulo}"? Vuelve a contar como pendiente.`)) return
    setTrabajando(tarea.id)
    try {
      await updateDoc(doc(db, 'tareas', tarea.id), {
        estado: 'abierta',
        cumplidaEn: null,
        avanceAlCumplir: null
      })
      cierresIntentados.current.add(tarea.id)
      setAviso(
        `Tarea "${tarea.titulo}" reabierta. Corrige su meta ahora: si sigue alcanzada, ` +
          'se volvera a cerrar sola en cuanto alguien mas abra Tareas.'
      )
    } catch (err) {
      console.error('[PanelTareas] Error reabriendo la tarea:', err)
      setError('No se pudo reabrir: ' + (err.message || err))
    } finally {
      setTrabajando(null)
    }
  }

  const fechaHora = (t) =>
    t?.toDate ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX')}` : '-'

  const tarjetaTarea = (t) => {
    // ⚠️ Una tarea CERRADA no se recalcula. Su avance se congelo el dia que se
    // cumplio (avanceAlCumplir); recalcularlo hoy contra la ventana movil de
    // los ultimos 60 dias da numeros absurdos — se vieron en produccion cosas
    // como "0.00 / 12 docenas (0%)" en una tarea que abajo decia "cumplida con
    // 84 docenas", y "21.00 / 1 (100%)". Lo cerrado se lee como quedo.
    const cerrada = t.estado !== 'abierta'
    // En una tarea cerrada manda lo que quedo grabado al cumplirla; en una
    // abierta, lo remisionado de hoy.
    const hecho = cerrada && t.avanceAlCumplir != null
      ? t.avanceAlCumplir
      : t.avance.docenasRemisionadas
    const pctHecho =
      t.metaDocenas > 0 ? Math.min(100, (hecho / t.metaDocenas) * 100) : 0
    const cumplida = hecho >= t.metaDocenas
    // Contra lo REMISIONADO: es lo que falta para cerrar la tarea de verdad,
    // no lo que falta por capturar.
    const faltan = Math.max(0, t.metaDocenas - hecho)
    return (
      <div
        key={t.id}
        style={{
          border: '1px solid',
          borderColor: cumplida ? '#9fd3b1' : '#d8dee6',
          background: cumplida ? '#e8f5ec' : '#fff',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 10
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
          <strong style={{ fontSize: 16 }}>{t.titulo}</strong>
          <span className="texto-suave" style={{ fontSize: 13 }}>
            {t.objetivoTipo === 'ot' ? `OT ${t.objetivoValor}` : `Codigo ${t.objetivoValor}`} · meta{' '}
            {t.metaDocenas} docenas
          </span>
          {t.asignadoANombre && (
            <span
              style={{
                fontSize: 12,
                background: '#e7effd',
                color: '#1e40af',
                borderRadius: 999,
                padding: '2px 10px'
              }}
            >
              Para {t.asignadoANombre}
            </span>
          )}
          {/* De que orden de compra es y a quien va. Sale del plan de Adrian:
              sin esto la tarjeta es un numero suelto y el agrupador se lo
              tiene que saber alguien de memoria. */}
          {(() => {
            const u = enElPlan(t)
            if (!u?.oc) return null
            return (
              <span
                style={{
                  fontSize: 12,
                  background: '#ecfdf5',
                  color: '#065f46',
                  borderRadius: 999,
                  padding: '2px 10px'
                }}
                title={`Orden de compra ${u.oc}${u.destino ? `, va a ${u.destino}` : ''}`}
              >
                OC {u.oc}
                {u.destino ? ` · ${u.destino}` : ''}
              </span>
            )
          })()}
        </div>

        <div style={{ margin: '10px 0 6px' }}>
          <div
            style={{
              height: 14,
              borderRadius: 999,
              background: '#e7ebf0',
              overflow: 'hidden'
            }}
          >
            {/* DOS ETAPAS EN UNA BARRA. El tono claro es lo capturado (ya se
                peso, sigue en planta) y el fuerte lo REMISIONADO, que es lo
                que de verdad cumple la tarea. Verlas juntas contesta de un
                vistazo la pregunta real: "¿esta parado, o esta hecho y solo
                falta sacarlo?". */}
            <div style={{ position: 'relative', height: '100%' }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${cerrada ? pctHecho : t.avance.porcentajeCapturado}%`,
                  background: '#bfdbfe',
                  transition: 'width .3s'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${pctHecho}%`,
                  background: cumplida ? '#2e7d4f' : '#2563eb',
                  transition: 'width .3s'
                }}
              />
            </div>
          </div>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            <strong>
              {hecho.toFixed(2)} / {t.metaDocenas} docenas remisionadas
            </strong>{' '}
            ({pctHecho.toFixed(0)}%)
            {/* El detalle de bultos solo tiene sentido en una tarea viva: en
                una cerrada esos bultos ya salieron del periodo que se consulta. */}
            {!cerrada && (
              <>
                {' '}
                · {t.avance.bultosRemisionados} de {t.avance.bultos} bulto
                {t.avance.bultos === 1 ? '' : 's'}
              </>
            )}
            {!cumplida && faltan > 0 && (
              <span className="texto-suave"> · faltan {faltan.toFixed(2)} docenas</span>
            )}
          </div>
          {/* Lo capturado que todavia no sale. No es un error ni un pendiente
              de captura: es material HECHO esperando su remision, y quien lee
              la tarjeta necesita distinguirlo de "no se ha trabajado". */}
          {!cerrada && t.avance.enPlanta > 0.001 && (
            <div style={{ marginTop: 2, fontSize: 13, color: '#1d4ed8' }}>
              {t.avance.enPlanta.toFixed(2)} docenas capturadas <strong>esperando remision</strong>{' '}
              ({t.avance.bultos - t.avance.bultosRemisionados} bultos en planta) ·{' '}
              {t.avance.kg.toFixed(2)} kg capturados
            </div>
          )}
        </div>

        {cumplida && t.estado === 'abierta' && (
          <div className="alerta-exito" style={{ marginTop: 6 }}>
            <strong>¡META ALCANZADA!</strong> Ya se remisionaron {t.avance.docenasRemisionadas.toFixed(2)} docenas de{' '}
            {t.objetivoTipo === 'ot' ? `la OT ${t.objetivoValor}` : `el codigo ${t.objetivoValor}`}.
            La tarea se marca cumplida sola: no hay que hacer nada.
          </div>
        )}

        {t.objetivoTipo === 'codigo' && t.estado === 'abierta' && (
          <div style={{ marginTop: 8 }}>
            <button
              className="btn-secundario"
              disabled={faltantes[t.id]?.cargando}
              onClick={() => consultarFaltantes(t)}
            >
              {faltantes[t.id]?.cargando
                ? 'Buscando en el ruteo...'
                : faltantes[t.id]?.folios
                  ? 'Actualizar folios de la tarea'
                  : 'Ver folios de la tarea'}
            </button>
            {faltantes[t.id]?.error && (
              <p style={{ color: '#a00', fontSize: 13, marginTop: 4 }}>
                No se pudo consultar: {faltantes[t.id].error}
              </p>
            )}
            {faltantes[t.id]?.folios && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <p style={{ margin: '0 0 4px' }}>
                  En el ruteo vigente hay <strong>{faltantes[t.id].enRuteo}</strong> folio
                  {faltantes[t.id].enRuteo === 1 ? '' : 's'} de este codigo
                  {Array.isArray(t.ots) && t.ots.length > 0 ? ` (OT ${t.ots.join(', ')})` : ''}:{' '}
                  <span style={{ color: '#1a7a3a' }}>{faltantes[t.id].capturados} ya capturado{faltantes[t.id].capturados === 1 ? '' : 's'}</span>
                  {' · '}
                  <strong style={{ color: faltantes[t.id].folios.length > 0 ? '#8a5300' : '#1a7a3a' }}>
                    {faltantes[t.id].folios.length} falta{faltantes[t.id].folios.length === 1 ? '' : 'n'}
                  </strong>
                </p>
                {faltantes[t.id].folios.length > 0 ? (
                  <div
                    style={{
                      maxHeight: 180,
                      overflowY: 'auto',
                      background: '#f7f9fb',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      padding: '6px 8px'
                    }}
                  >
                    {faltantes[t.id].folios.map((f) => (
                      <div key={f.folio} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <strong>{f.folio}</strong>
                        <span className="texto-suave">
                          {typeof f.docenas === 'number' ? `${f.docenas} doc` : ''}
                          {f.pedido ? ` · ${f.pedido}` : ''}
                          {Array.isArray(t.ots) && t.ots.length > 0 && f.otRuteo === null
                            ? ' · OT desconocida, revisar a mano'
                            : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="texto-suave" style={{ margin: 0 }}>
                    Todos los folios del ruteo vigente de este codigo ya estan capturados. Si la
                    meta aun no se alcanza, faltan folios en ruteos que todavia no se suben.
                  </p>
                )}
                {faltantes[t.id].foliosCapturados?.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', color: '#1a7a3a' }}>
                      Ya capturados ({faltantes[t.id].foliosCapturados.length})
                    </summary>
                    <div
                      style={{
                        maxHeight: 180,
                        overflowY: 'auto',
                        background: '#f2faf4',
                        border: '1px solid #cde8d5',
                        borderRadius: 6,
                        padding: '6px 8px',
                        marginTop: 4
                      }}
                    >
                      {faltantes[t.id].foliosCapturados.map((f) => (
                        <div key={f.folio} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <strong>{f.folio}</strong>
                          <span className="texto-suave">
                            {typeof f.docenas === 'number' ? `${f.docenas} doc` : ''}
                            {f.pedido ? ` · ${f.pedido}` : ''}
                            {f.capturadoPor ? ` · pesado por ${f.capturadoPor}` : ''}
                            {f.capturadoEn?.toDate
                              ? ` · ${f.capturadoEn.toDate().toLocaleDateString('es-MX')} ${f.capturadoEn
                                  .toDate()
                                  .toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
                              : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <p className="texto-suave" style={{ margin: '4px 0 0', fontSize: 12 }}>
                  Solo se ven folios del ruteo VIGENTE (los Excel de los ultimos dias): con esta
                  lista America puede ubicar los bultos en planta y ver que ya se peso.
                </p>
              </div>
            )}
          </div>
        )}

        {t.notas && (
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 6 }}>
            {t.notas}
          </p>
        )}
        <p className="texto-suave" style={{ fontSize: 12, marginTop: 6 }}>
          Pedida por {t.creadoPorNombre} el {fechaHora(t.creadoEn)}
          {t.estado !== 'abierta' && (
            <>
              {' '}· {t.estado === 'cumplida' ? 'cumplida' : 'cancelada'} el {fechaHora(t.cumplidaEn)}
              {t.avanceAlCumplir != null && ` con ${t.avanceAlCumplir} docenas`}
            </>
          )}
        </p>

        {t.estado === 'abierta' && (puedeCrearTareas || t.asignadoAUid === authUser?.uid) && !cumplida && (
          <button
            className="btn-secundario"
            disabled={trabajando === t.id}
            onClick={() => cerrarTarea(t, 'cancelada')}
          >
            Cancelar tarea
          </button>
        )}
        {t.estado !== 'abierta' && puedeCrearTareas && (
          <button
            className="btn-secundario"
            disabled={trabajando === t.id}
            onClick={() => reabrirTarea(t)}
            title="Si el cierre automatico se adelanto (meta estimada corta), la tarea regresa a abierta"
          >
            Reabrir tarea
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}

      {listas.length > 0 && (
        <div className="alerta-exito" style={{ marginBottom: 18 }}>
          <strong>
            {listas.length} tarea{listas.length === 1 ? '' : 's'} ya alcanzo su meta:
          </strong>{' '}
          {listas.map((t) => t.titulo).join(', ')}.
        </div>
      )}

      {puedeCrearTareas && (
        <div className="tarjeta" style={{ marginBottom: 18 }}>
          <h2>Importar tareas desde Excel</h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Lo unico obligatorio es <strong>CODIGO</strong> y <strong>OT / NumPedido</strong>.
            Si el Excel trae la cantidad de docenas se usa; si no, la app la calcula del{' '}
            <strong>ruteo cargado</strong> y la marca como estimada; y lo que no se pueda
            calcular se escribe a mano aqui mismo. Detecta el formato solo, ignora las hojas
            que no son de tareas y combina en una sola tarea los codigos repetidos (metas
            sumadas, OTs juntadas). Nada se guarda hasta que revises la vista previa.
          </p>
          <input
            type="file"
            accept=".xlsx"
            onChange={onArchivoTareas}
            disabled={trabajando === 'importar'}
            style={{ margin: '8px 0' }}
          />
          {trabajando === 'importar' && !importacion && (
            <p className="texto-suave">Leyendo el archivo...</p>
          )}

          {importacion && (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, marginTop: 6 }}>
              <p style={{ margin: '0 0 6px' }}>
                <strong>{importacion.nombreArchivo}</strong>:{' '}
                {importacion.hojasLeidas
                  .map((h) => `${h.nombre} (${h.tipo}, ${h.renglones} renglones)`)
                  .join(' · ')}
                {importacion.hojasIgnoradas.length > 0 &&
                  ` · hojas ignoradas: ${importacion.hojasIgnoradas.join(', ')}`}
                {importacion.renglonesDescartados > 0 &&
                  ` · ${importacion.renglonesDescartados} renglon(es) sin codigo se descartaron`}
              </p>
              {/* AGUAS: lo que este archivo NO va a poder amarrar al plan.
                  Va arriba de todo y en ambar porque todavia se puede
                  cancelar; enterarse despues de crear 18 tareas no sirve. */}
              {importacion.avisoPlan && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    fontSize: 13,
                    marginBottom: 10
                  }}
                >
                  <strong>Revisa esto antes de crear las tareas</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {importacion.avisoPlan.sinPlan.length > 0 && (
                      <li>
                        <strong>
                          {importacion.avisoPlan.sinPlan.length} orden
                          {importacion.avisoPlan.sinPlan.length === 1 ? '' : 'es'} de trabajo no
                          {importacion.avisoPlan.sinPlan.length === 1 ? ' esta' : ' estan'} en el
                          plan
                        </strong>{' '}
                        ({importacion.avisoPlan.sinPlan.slice(0, 12).join(', ')}
                        {importacion.avisoPlan.sinPlan.length > 12 &&
                          ` y ${importacion.avisoPlan.sinPlan.length - 12} mas`}
                        ). Sus tareas se crean igual, pero van a quedar en{' '}
                        <strong>&quot;Todavia sin orden de compra&quot;</strong> hasta que Adrian
                        suba un plan que las incluya.
                      </li>
                    )}
                    {importacion.avisoPlan.ocsSinPlan.length > 0 && (
                      <li>
                        La orden de compra que trae el archivo (
                        {importacion.avisoPlan.ocsSinPlan.join(', ')}){' '}
                        <strong>no esta en el plan maestro</strong>.
                      </li>
                    )}
                    {importacion.avisoPlan.contradicciones.length > 0 && (
                      <li style={{ color: '#8a5300' }}>
                        <strong>El archivo y el plan no coinciden:</strong>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {importacion.avisoPlan.contradicciones.slice(0, 8).map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                        Revisa cual de los dos esta bien antes de crear las tareas.
                      </li>
                    )}
                  </ul>
                  {/* La accion concreta. Sin esto el aviso solo informa; con
                      esto dice a quien buscar y con que dato en la mano. */}
                  <p style={{ margin: '8px 0 0' }}>
                    <strong>Confirmalo con Adrian:</strong> puede que todavia no haya subido el
                    plan donde vienen estas ordenes.
                    {importacion.avisoPlan.planArchivo ? (
                      <>
                        {' '}
                        Ahora mismo el plan vigente es{' '}
                        <strong>{importacion.avisoPlan.planArchivo}</strong>
                        {importacion.avisoPlan.planFecha
                          ? `, subido el ${importacion.avisoPlan.planFecha.toLocaleDateString('es-MX')}`
                          : ''}
                        .
                      </>
                    ) : (
                      <> Ahora mismo no hay ningun plan maestro cargado.</>
                    )}
                  </p>
                </div>
              )}

              {importacion.sinMeta?.length > 0 && (
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  El archivo no traia la cantidad en{' '}
                  {importacion.sinMeta.map((x) => x.cuantos + ' renglon(es) porque ' + x.razon).join(', ')}.
                  {importacion.derivadas > 0 && (
                    <>
                      {' '}
                      <strong style={{ color: '#1a7a3a' }}>
                        {importacion.derivadas} meta(s) se calcularon del ruteo cargado
                      </strong>{' '}
                      (revisalas: valen lo que valga el Excel de ruteo de hoy).
                    </>
                  )}
                  {importacion.sinRuteo > 0 && (
                    <>
                      {' '}
                      <strong style={{ color: '#8a5300' }}>
                        {importacion.sinRuteo} no se pudieron calcular
                      </strong>
                      : escribelas a mano abajo.
                    </>
                  )}
                </div>
              )}
              {importacion.duplicadas.length > 0 && (
                <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 8 }}>
                  {importacion.duplicadas.length} codigo(s) ya tienen tarea abierta y NO se
                  volveran a crear: {importacion.duplicadas.map((t) => t.codigo).join(', ')}
                </div>
              )}
              {importacion.tareas.length === 0 ? (
                <p className="texto-suave">No hay tareas nuevas que crear con este archivo.</p>
              ) : (
                <>
                  <div style={{ maxHeight: 260, overflowY: 'auto', margin: '6px 0' }}>
                    <table className="tabla-datos" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>Codigo</th>
                          <th>Meta (docenas)</th>
                          <th>De donde sale</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importacion.tareas.map((t) => {
                          const excede = t.metaDocenas > META_MAXIMA
                          const falta = !(t.metaDocenas > 0) || excede
                          return (
                            <tr key={t.codigo} style={falta ? { background: '#fff4e0' } : undefined}>
                              <td style={{ fontWeight: falta ? 700 : 400 }}>{t.codigo}</td>
                              <td>
                                {/* Editable SIEMPRE: la del ruteo es estimacion
                                    y la del Excel tambien puede venir mal. */}
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  max={META_MAXIMA}
                                  disabled={trabajando === 'importar'}
                                  style={{ width: 90 }}
                                  placeholder="docenas"
                                  value={t.metaTexto ?? (t.metaDocenas ?? '')}
                                  onChange={(e) => cambiarMetaImportada(t.codigo, e.target.value)}
                                />
                              </td>
                              <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                                {t.origenMeta === 'excel' && (
                                  <span style={{ color: '#1a7a3a' }}>del Excel</span>
                                )}
                                {t.origenMeta === 'ruteo' && (
                                  <span style={{ color: '#1e40af' }}>
                                    estimada del ruteo ({t.foliosRespaldo} folios)
                                    {t.otsSinRuteo?.length > 0 && (
                                      <div style={{ color: '#8a5300' }}>
                                        falta el ruteo de la OT {t.otsSinRuteo.join(', ')}
                                      </div>
                                    )}
                                  </span>
                                )}
                                {t.origenMeta === 'manual' && (
                                  <span style={{ color: '#1a7a3a' }}>a mano</span>
                                )}
                                {t.origenMeta === 'falta' && !excede && (
                                  <strong style={{ color: '#8a5300' }}>
                                    ESCRIBELA
                                    {t.motivoSinMeta ? ' (' + t.motivoSinMeta + ')' : ''}
                                  </strong>
                                )}
                                {excede && (
                                  <strong style={{ color: '#a00' }}>
                                    PASADA DEL MAXIMO ({META_MAXIMA.toLocaleString('es-MX')}):
                                    corrigela
                                  </strong>
                                )}
                                {t.demasiadasOts && (
                                  <div style={{ color: '#a00' }}>
                                    trae mas de 30 OTs: el avance contara el codigo completo
                                  </div>
                                )}
                              </td>
                              <td className="texto-suave">{tituloYNotas(t).notas}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <label className="campo" style={{ maxWidth: 260, marginBottom: 8 }}>
                    <span>Encargar todas a</span>
                    <select value={asignadoImport} onChange={(e) => setAsignadoImport(e.target.value)}>
                      <option value="">Sin asignar</option>
                      {destinatarios.map((d) => (
                        <option key={d.uid} value={d.uid}>
                          {d.nombreCompleto || d.empleadoId || d.uid}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn-primario"
                      disabled={
                        trabajando === 'importar' ||
                        importacion.tareas.some(
                          (t) => !(t.metaDocenas > 0) || t.metaDocenas > META_MAXIMA
                        )
                      }
                      onClick={onCrearImportadas}
                    >
                      {(() => {
                        const vacias = importacion.tareas.filter((t) => !(t.metaDocenas > 0)).length
                        const pasadas = importacion.tareas.filter((t) => t.metaDocenas > META_MAXIMA).length
                        if (trabajando === 'importar') return 'Creando...'
                        if (pasadas > 0) return 'Corrige ' + pasadas + ' meta(s) pasada(s) del maximo'
                        if (vacias > 0) return 'Faltan ' + vacias + ' meta(s) por llenar'
                        return 'Crear ' + importacion.tareas.length + ' tarea' + (importacion.tareas.length === 1 ? '' : 's')
                      })()}
                    </button>
                    <button
                      className="btn-secundario"
                      disabled={trabajando === 'importar'}
                      onClick={() => setImportacion(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {puedeCrearTareas && (
        <form className="tarjeta" onSubmit={onCrear} style={{ marginBottom: 18 }}>
          <h2>Pedir una tarea</h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Ej. &quot;100 docenas de la OT 7887&quot;. El avance se cuenta solo con lo que se vaya
            capturando desde este momento.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label className="campo" style={{ flex: '2 1 220px' }}>
              <span>Titulo</span>
              <input
                type="text"
                placeholder="ej. Pedido Walmart agosto"
                value={nueva.titulo}
                maxLength={120}
                onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '0 1 160px' }}>
              <span>Contar por</span>
              <select
                value={nueva.objetivoTipo}
                onChange={(e) => setNueva({ ...nueva, objetivoTipo: e.target.value })}
              >
                <option value="ot">Orden de trabajo</option>
                <option value="codigo">Codigo de producto</option>
              </select>
            </label>
            <label className="campo" style={{ flex: '1 1 140px' }}>
              <span>{nueva.objetivoTipo === 'ot' ? 'OT (4 digitos)' : 'Codigo'}</span>
              <input
                type="text"
                placeholder={nueva.objetivoTipo === 'ot' ? 'ej. 7887' : 'ej. 1313-I'}
                value={nueva.objetivoValor}
                maxLength={60}
                onChange={(e) => setNueva({ ...nueva, objetivoValor: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '1 1 140px' }}>
              <span>Meta (docenas)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="ej. 100"
                value={nueva.metaDocenas}
                onChange={(e) => setNueva({ ...nueva, metaDocenas: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '1 1 170px' }}>
              <span>Encargar a</span>
              <select
                value={nueva.asignadoAUid}
                onChange={(e) => setNueva({ ...nueva, asignadoAUid: e.target.value })}
              >
                <option value="">Sin asignar</option>
                {destinatarios.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.nombreCompleto || d.empleadoId || d.uid}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo" style={{ flex: '2 1 220px' }}>
              <span>Notas (opcional)</span>
              <input
                type="text"
                placeholder="ej. urgente, sale el viernes"
                value={nueva.notas}
                maxLength={300}
                onChange={(e) => setNueva({ ...nueva, notas: e.target.value })}
              />
            </label>
          </div>
          <button className="btn-primario" type="submit" disabled={trabajando === 'nueva'}>
            {trabajando === 'nueva' ? 'Creando...' : 'Crear tarea'}
          </button>
        </form>
      )}

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Tareas por completar ({abiertas.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Aqui aparecen las tareas encargadas. La barra se llena SOLA conforme se capturan
          bultos (no hay que reportar nada) y &quot;Ver folios que faltan&quot; te dice exactamente
          que folios buscar en planta para completar cada una.
        </p>

        <input
          type="search"
          placeholder="Buscar por folio, codigo, orden de trabajo, orden de compra o cliente..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ width: '100%', margin: '8px 0 4px', padding: '8px 10px' }}
        />
        {busqueda.trim() && (
          <p className="texto-suave" style={{ fontSize: 12, marginTop: 0 }}>
            {filtradas.length} de {misTareas.length} tareas coinciden.
          </p>
        )}

        {/* EL ARBOL: orden de compra -> orden de trabajo -> tareas.
            Misma navegacion que el Historial (picas y se abre), porque es la
            misma jerarquia y Lindbergh no tiene por que aprenderse dos. */}
        {abiertas.length === 0 ? (
          <p className="texto-suave">
            {busqueda.trim() ? 'Ninguna tarea abierta coincide con la busqueda.' : 'Sin tareas abiertas.'}
          </p>
        ) : (
          arbolTareas.map((g) => {
            const sinOc = g.oc === SIN_OC
            const abiertaOc = ocsAbiertas.has(g.oc)
            return (
              <div
                key={g.oc}
                style={{
                  border: '1px solid #d8dee6',
                  borderRadius: 8,
                  marginBottom: 10,
                  background: sinOc ? '#fffbeb' : '#fff'
                }}
              >
                <button
                  onClick={() => alternar(ocsAbiertas, setOcsAbiertas, g.oc)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <strong style={{ fontSize: 15 }}>
                    {sinOc ? 'Todavia sin orden de compra' : g.oc}
                  </strong>
                  {g.destino && (
                    <span
                      style={{
                        fontSize: 12,
                        background: '#ecfdf5',
                        color: '#065f46',
                        borderRadius: 999,
                        padding: '2px 10px'
                      }}
                    >
                      {g.destino}
                    </span>
                  )}
                  <span className="texto-suave" style={{ fontSize: 13 }}>
                    {g.tareas} {g.tareas === 1 ? 'tarea' : 'tareas'} · {g.ots.length}{' '}
                    {g.ots.length === 1 ? 'orden de trabajo' : 'ordenes de trabajo'}
                  </span>
                  {barraAvance(g.porcentaje)}
                  <span className="texto-suave">{abiertaOc ? '▲' : '▼'}</span>
                </button>

                {sinOc && abiertaOc && (
                  <p className="texto-suave" style={{ fontSize: 12, padding: '0 12px' }}>
                    El plan maestro todavia no dice de que orden de compra cuelgan estas ordenes de
                    trabajo. En cuanto Adrian suba una version que las incluya, se acomodan solas.
                  </p>
                )}

                {abiertaOc &&
                  g.ots.map((o) => {
                    const claveOt = `${g.oc}||${o.ot}`
                    const abiertaOt = otsAbiertas.has(claveOt)
                    const sinOt = o.ot === SIN_OT
                    return (
                      <div key={claveOt} style={{ borderTop: '1px solid #eef2f7' }}>
                        <button
                          onClick={() => alternar(otsAbiertas, setOtsAbiertas, claveOt)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 10,
                            alignItems: 'center',
                            padding: '8px 12px 8px 26px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: 14
                          }}
                        >
                          <span style={{ minWidth: 90 }}>
                            {sinOt ? 'Sin orden de trabajo' : `OT ${o.ot}`}
                          </span>
                          <span className="texto-suave" style={{ fontSize: 12 }}>
                            {o.lista.length} {o.lista.length === 1 ? 'tarea' : 'tareas'}
                          </span>
                          {barraAvance(o.porcentaje)}
                          <span className="texto-suave">{abiertaOt ? '▲' : '▼'}</span>
                        </button>
                        {abiertaOt && (
                          <div style={{ padding: '0 12px 8px 26px' }}>
                            {o.lista.map(tarjetaTarea)}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>

      <div className="tarjeta">
        <h2
          onClick={() => setMostrarCerradas((v) => !v)}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ display: 'inline-block', width: 22 }}>{mostrarCerradas ? '▾' : '▸'}</span>
          Tareas cerradas ({cerradas.length})
        </h2>
        {mostrarCerradas &&
          (cerradas.length === 0 ? (
            <p className="texto-suave">Sin tareas cerradas.</p>
          ) : (
            cerradas.map(tarjetaTarea)
          ))}
      </div>
    </>
  )
}
