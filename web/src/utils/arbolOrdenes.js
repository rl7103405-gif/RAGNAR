// EL ARBOL: orden de compra -> ordenes de trabajo -> codigos -> folios.
//
// Lo pidio Lindbergh en la junta del 17-08, y lo describio asi: abrir la
// 24-49, ver "llevas un avance de 92%", debajo sus OT con su porcentaje
// (100, 100, 85, 0, 93), y al abrir una, "necesito todos sus componentes".
// Textual suyo: "estan todas las ordenes descargadas pero no estan agrupadas,
// no tengo ese agrupador".
//
// DE DONDE SALE CADA MITAD
//   - Lo PLANEADO: del plan maestro que sube Adrian (OC -> OT -> codigo).
//   - Lo PRODUCIDO: de los bultos ya capturados.
//
// POR QUE NO SE SUMAN LAS REMISIONES: una remision no es produccion nueva,
// es un envio de bultos que YA se capturaron. Contar las dos cosas en el
// mismo numerador contaria doble lo mismo. "Producido" son bultos;
// "embarcado" es otro indicador y va aparte.
//
// ⚠️ LA REGLA QUE GOBIERNA ESTE ARCHIVO: un hueco de datos NO se puede ver
// igual que un cero de produccion. Un 0% dice "no han hecho nada"; un "—" dice
// "no se sabe". Confundirlos aqui hace que Lindbergh regañe a una maquila que
// si trabajo, o que se de por buena una orden que no arranco. Por eso el
// porcentaje es null (no cero) siempre que falte el denominador o falten los
// folios, y la pantalla lo pinta distinto.
import { collection, documentId, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { docenasDeCaptura } from './reimprimir'
import { MAX_IN, lineasDeOc, normalizarCodigo, normalizarOt, normalizarPedido, versionActiva } from './planMaestro'
import { ordenDeCaptura, SIN_ORDEN } from './pdf'
import { otDelTexto, resolverVarios } from './otResuelta'

/**
 * La OT de un bulto, normalizada con el mismo criterio que el plan.
 *
 * El campo congelado MANDA. Se resolvio al capturar contra el plan vigente en
 * ese momento y no se vuelve a tocar: si aqui se re-resolviera, subir el plan
 * de la semana que entra movria de rama produccion ya contada.
 *
 * Solo los bultos anteriores al campo (antes del 2026-08-17) caen al texto.
 * ⚠️ El respaldo lee el texto del pedido con el MISMO criterio que usa la
 * BUSQUEDA de folios (foliosDeLasOts / otDelTexto). Antes caia a
 * ordenDeCaptura -> otDePedido (pdf.js), que SOLO ve los primeros 4 digitos y
 * no reconoce el patron 'OT:6872': un bulto viejo con pedido
 * 'C_..._OT:6872' lo encontraba la busqueda pero se agrupaba con OT ''
 * (fueraDelPlan con la OT en blanco). Verificado con el Excel real: afecta
 * 273 de 1214 pedidos del diccionario.
 */
export function otDeBulto(bulto) {
  // Delega en ordenDeCaptura (pdf.js), que es EL punto unico donde se decide
  // la OT de un bulto: campo congelado primero, texto de respaldo despues.
  // Antes esto tenia su propia copia de esa logica y el arbol se agrupaba
  // distinto que el PDF y que el Historial.
  const ot = ordenDeCaptura(bulto)
  return ot === SIN_ORDEN ? '' : normalizarOt(ot)
}

/**
 * Bultos de unas OT consultando el campo `producto.ot` que se congela al
 * capturar.
 *
 * Es la via BUENA: no depende de 'foliosRuteo', que se purga a los 60 dias
 * mientras una orden de compra tarda semanas. Solo encuentra los bultos
 * capturados desde que existe el campo (2026-08-17); para los de antes sigue
 * haciendo falta el ruteo, que es lo que hace la otra via.
 */
async function bultosPorOtGuardada(ots) {
  const encontrados = []
  const lista = ots.filter(Boolean)
  for (let i = 0; i < lista.length; i += MAX_IN) {
    const lote = lista.slice(i, i + MAX_IN)
    try {
      const snap = await getDocs(
        query(collection(db, 'bultos'), where('producto.ot', 'in', lote))
      )
      snap.docs.forEach((d) => encontrados.push({ folio: d.id, ...d.data() }))
    } catch (err) {
      // Si Firestore pide un indice para esta consulta, no se tumba el arbol:
      // se sigue con la via del ruteo y se avisa en consola con el enlace que
      // trae el propio error para crearlo.
      console.warn('[Arbol] No se pudo consultar por producto.ot (¿falta indice?):', err?.message)
      return null
    }
  }
  return encontrados
}

/**
 * Avance PONDERADO POR CANTIDAD, no promedio de porcentajes.
 *
 * Promediar los porcentajes de cada linea da un numero que miente: una linea
 * de 10 docenas al 100% pesaria lo mismo que una de 5,000 al 0%. Se suma lo
 * cumplido y se divide entre lo planeado.
 *
 * Y cada linea se topa en su propia meta (`min`): sin ese tope, un codigo
 * sobreproducido tapa a otro que falta y la OT se ve completa cuando no lo
 * esta. Es el mismo error que ya nos costo una metrica en captura-mecanicos,
 * donde todo salia clavado en 85% pasara lo que pasara.
 *
 * ⚠️ Las lineas SIN META no entran al calculo, ni arriba ni abajo. El plan real
 * las trae (la columna de cantidad no siempre viene) y meterlas con un cero
 * inflaria el denominador, o peor, con `min(producido, 0)` haria que producir
 * mas bajara el porcentaje. Se cuentan aparte y se dicen.
 */
export function avanceDe(lineas) {
  const conMeta = lineas.filter((l) => typeof l.cantidadPlaneada === 'number')
  const planeado = conMeta.reduce((acc, l) => acc + l.cantidadPlaneada, 0)
  const cumplido = conMeta.reduce(
    (acc, l) => acc + Math.min(Number(l.producido) || 0, l.cantidadPlaneada),
    0
  )
  return {
    planeado,
    // Lo producido SI incluye las lineas sin meta: se produjo de verdad,
    // aunque no haya contra que compararlo.
    producido: lineas.reduce((acc, l) => acc + (Number(l.producido) || 0), 0),
    cumplido,
    lineasSinMeta: lineas.length - conMeta.length,
    // Sin plan no hay porcentaje: devolver 0 diria "no ha avanzado nada",
    // que es distinto de "no se sabe contra que medirlo".
    porcentaje: planeado > 0 ? Math.min(100, (cumplido / planeado) * 100) : null
  }
}

// El ruteo entero, cacheado por sesion del panel: sin esto se re-descargaba
// la coleccion en CADA clic sobre una orden, y el uso real es abrir varias
// seguidas para compararlas.
let cacheRuteo = null
export function olvidarCacheDeRuteo() {
  cacheRuteo = null
}

/**
 * Trae los folios del ruteo que pertenecen a unas OT.
 *
 * Firestore no puede filtrar por una OT que no existe como campo en
 * 'foliosRuteo' (ahi la OT vive dentro del texto del pedido), asi que se
 * descarga el ruteo vigente y se filtra en memoria. Son los folios del periodo
 * vigente: cientos, no cientos de miles.
 *
 * ⚠️ La OT de cada folio se resuelve con LA MISMA fuente que la del bulto: el
 * plan primero, el texto de respaldo. Antes esto derivaba solo del texto
 * mientras el bulto ya traia la OT del plan, y en los pedidos donde las dos no
 * coinciden — 25 renglones del plan real, del tipo '7512_REPOSICION_7551' — el
 * folio se contaba en una rama y el bulto aparecia en otra. Los dos lados de un
 * cruce se derivan igual o el cruce miente sin avisar.
 */
async function foliosDeLasOts(ots) {
  const buscadas = new Set(ots.filter(Boolean))
  if (!buscadas.size) return []
  // Se cachea la PROMESA, no el arreglo: varias OC pidiendo su avance a la vez
  // compartian el cache solo DESPUES de que la primera terminara. Antes de eso
  // cada una veia 'cacheRuteo' en null y arrancaba su propia descarga de la
  // coleccion entera (~5,000 folios, ~2 MB). Con la promesa cacheada, la
  // primera descarga la esperan todas.
  if (!cacheRuteo) {
    cacheRuteo = getDocs(collection(db, 'foliosRuteo'))
      .then((snap) => snap.docs.map((d) => ({ folio: d.id, ...d.data() })))
    // Un fallo no deja el cache envenenado con una promesa rota para siempre.
    cacheRuteo.catch(() => { cacheRuteo = null })
  }
  const ruteo = await cacheRuteo
  // Se resuelven de golpe los pedidos DISTINTOS (decenas), no folio por folio.
  const resueltas = await resolverVarios(ruteo.map((f) => f.pedido).filter(Boolean))
  return ruteo.filter((f) => {
    const resuelta = resueltas.get(normalizarPedido(f.pedido))
    const ot = resuelta?.ot || otDelTexto(f.pedido)
    return ot && buscadas.has(normalizarOt(ot))
  })
}

/** Los bultos ya capturados de una lista de folios, en lotes de 30. */
async function bultosDeFolios(folios) {
  const unicos = [...new Set(folios)]
  const encontrados = []
  for (let i = 0; i < unicos.length; i += MAX_IN) {
    const lote = unicos.slice(i, i + MAX_IN)
    const snap = await getDocs(
      query(collection(db, 'bultos'), where(documentId(), 'in', lote), orderBy(documentId()))
    )
    snap.docs.forEach((d) => encontrados.push({ folio: d.id, ...d.data() }))
  }
  return encontrados
}

/**
 * Arma el arbol de una OC: sus OT, y dentro de cada una sus codigos con
 * planeado vs producido.
 *
 * Devuelve tambien lo que NO cuadro, que es la mitad util cuando algo falla:
 * OT del plan sin un solo folio, y folios producidos que no estan en el plan.
 * Un arbol que esconde eso pasaria por completo estando incompleto.
 */
/**
 * Lo que YA SE MANDO A LAS MAQUILAS de unas OT, por (OT, codigo).
 *
 * Es el tercer estado que pidio el papa de Roberto el 24-08: de un codigo hay
 * lo que el cliente PIDE, lo que la fabrica ya TIENE capturado, y lo que ya
 * SALIO a ensamblar. Los dos primeros ya los tenia el arbol; este faltaba.
 *
 * ⚠️ NO SE SUMA NI SE RESTA CON LO PRODUCIDO. Una tarea se encarga en PACKS
 * ("300 packs de este modelo", tareasEnsamble.js) y el plan y los bultos van
 * en DOCENAS. Cuantos pares trae un pack depende del producto (un 3 PACK y un
 * 6 PACK no son lo mismo) y RAGNAR hoy no lo sabe, asi que restar packs de
 * docenas daria un numero con cara de verdad y sin serlo. Se muestran lado a
 * lado, cada uno con su unidad, y quien lee decide.
 *
 * Se consulta maquila por maquila y no con collectionGroup a proposito: la
 * regla de tareasEnsamble se apoya en el maquilaId del path, y un
 * collectionGroup exigiria abrir un match nuevo para todo el grupo.
 *
 * Nunca lanza: si una maquila falla, su parte se reporta como desconocida en
 * vez de tumbar el arbol entero.
 */
// El plan y los bultos van en DOCENAS. Una tarea encargada en docenas se
// puede comparar con el plan; una encargada en packs NO, porque cuantos pares
// trae un pack depende del producto y RAGNAR no lo sabe.
const UNIDADES_EN_DOCENAS = ['docena', 'docenas', 'doc', 'dz', 'dzs']
export const esEnDocenas = (unidad) =>
  UNIDADES_EN_DOCENAS.includes(String(unidad || '').trim().toLowerCase())

/**
 * Que tanto de lo planeado ya se mando a ensamblar, en PORCENTAJE.
 *
 * Lo pidio Roberto el 24-08: "que porcentaje has mandado de esa orden de
 * trabajo, o cuanto te falta por mandar".
 *
 * ⚠️ Solo cuenta lo encargado en DOCENAS, que es la unidad del plan. Un
 * renglon pedido en packs se reporta aparte (lineasNoComparables) en vez de
 * colarse al porcentaje: mezclar packs con docenas daria un numero que se ve
 * bien y miente. Si TODO lo enviado vino en packs, el porcentaje es null (no
 * cero), igual que hace el resto de este archivo con los huecos de datos.
 */
export function avanceDeEnvio(lineas) {
  let planeado = 0
  let enviado = 0
  let lineasNoComparables = 0
  for (const l of lineas) {
    const comparable = (l.enviado || []).filter((e) => esEnDocenas(e.unidad))
    const otras = (l.enviado || []).filter((e) => !esEnDocenas(e.unidad))
    // ⚠️ Un renglon que SOLO salio en packs se queda FUERA del denominador,
    // no dentro con enviado 0. Metiendolo, una OT con un codigo despachado
    // completo en packs (1000 docenas planeadas) y otro despachado completo
    // en docenas (10) decia "mandado 1%" estando los dos completos: el
    // numero mas enganoso posible, porque suena a que la maquila no ha hecho
    // nada. Se cuenta aparte y la pantalla dice cuantos quedaron sin medir.
    if (comparable.length === 0 && otras.length > 0) {
      lineasNoComparables++
      continue
    }
    if (typeof l.cantidadPlaneada === 'number') planeado += l.cantidadPlaneada
    enviado += comparable.reduce((a, e) => a + e.cantidad, 0)
  }
  return {
    planeado,
    enviado,
    // Sin meta medible no hay porcentaje. Ya no hace falta la condicion
    // compuesta de antes: los renglones que no se pueden medir salieron del
    // denominador arriba, asi que si 'planeado' quedo en 0 es que no habia
    // nada medible que reportar.
    porcentaje: planeado > 0 ? Math.min(100, (enviado / planeado) * 100) : null,
    faltaPorMandar: planeado > 0 ? Math.max(0, planeado - enviado) : null,
    lineasNoComparables
  }
}

// Las tareas de TODAS las maquilas, cacheadas con VIGENCIA CORTA. Sin cache,
// bajar el Excel de 14 ordenes de compra releia la coleccion completa de
// tareas de cada maquila 14 veces; con cache de sesion entera, una tarea
// creada a las 3pm no aparecia en el arbol hasta recargar la pagina. Un
// minuto cubre el uso real (abrir/bajar varias ordenes seguidas) sin
// congelar la pantalla.
const VIGENCIA_CACHE_TAREAS_MS = 60_000
let cacheTareas = null

export function olvidarCacheDeTareas() {
  cacheTareas = null
}

/** Trae (una sola vez) las tareas de las maquilas del mundo que toca. */
async function tareasDeLasMaquilas(esPrueba) {
  if (
    cacheTareas &&
    cacheTareas.esPrueba === !!esPrueba &&
    Date.now() - cacheTareas.cuando < VIGENCIA_CACHE_TAREAS_MS
  ) {
    return cacheTareas.promesa
  }

  // Se cachea la PROMESA, no el resultado ya resuelto: con el Historial
  // mostrando TODAS las ordenes, decenas de OC piden su avance a la vez y
  // todas veian el cache vacio, disparando cada una su propia lectura de
  // 'maquilas' y de las tareas de cada maquila. Mismo arreglo que el ruteo.
  const promesa = (async () => {
    let maquilas = []
    try {
      const snap = await getDocs(collection(db, 'maquilas'))
      // Cada mundo ve el suyo, con el MISMO filtro simetrico que usa la regla
      // (mismoMundoMaquila). Sin esto un usuario real preguntaria por la
      // maquila ficticia y se llevaria un permission-denied garantizado.
      maquilas = snap.docs
        .filter((d) => (d.data().esPrueba === true) === !!esPrueba)
        .map((d) => d.id)
    } catch (err) {
      console.warn('[Arbol] No se pudo listar las maquilas:', err?.message)
      return {
        porMaquila: [],
        maquilasNoLeidas: ['(no se pudo listar)'],
        sinPermiso: err?.code === 'permission-denied'
      }
    }

    // En paralelo: son N round-trips independientes y encadenarlos solo suma
    // espera. Cada maquila reporta su propio fallo sin tumbar a las demas.
    const resultados = await Promise.all(
      maquilas.map(async (maquilaId) => {
        try {
          const snap = await getDocs(collection(db, 'portalMaquila', maquilaId, 'tareasEnsamble'))
          return { maquilaId, docs: snap.docs.map((d) => d.data()) }
        } catch (err) {
          console.warn(`[Arbol] No se pudieron leer las tareas de ${maquilaId}:`, err?.message)
          return { maquilaId, error: err }
        }
      })
    )

    const valor = {
      porMaquila: resultados.filter((r) => !r.error),
      maquilasNoLeidas: resultados.filter((r) => r.error).map((r) => r.maquilaId),
      sinPermiso: resultados.some((r) => r.error?.code === 'permission-denied')
    }
    // Un resultado con maquilas fallidas NO se conserva: si se guardara, un
    // tropiezo de red de un segundo dejaria esa maquila como "no leida"
    // durante todo el minuto, sin reintento.
    if (valor.maquilasNoLeidas.length) cacheTareas = null
    return valor
  })()

  promesa.catch(() => { cacheTareas = null })
  cacheTareas = { esPrueba: !!esPrueba, cuando: Date.now(), promesa }
  return promesa
}

async function enviosDeLasOts(ots, esPrueba) {
  const salida = new Map()
  const conjunto = new Set(ots.filter(Boolean))
  if (!conjunto.size) return { envios: salida, maquilasNoLeidas: [], sinPermiso: false }

  const { porMaquila, maquilasNoLeidas, sinPermiso } = await tareasDeLasMaquilas(esPrueba)

  for (const r of porMaquila) {
    for (const t of r.docs) {
      // Una tarea CANCELADA no mando nada, y una en 'preparando' todavia no
      // la ve la maquila: contarlas diria que salio producto que no salio.
      if (t.estado === 'cancelada' || t.estado === 'preparando') continue
      const ot = normalizarOt(t.ot || '')
      if (!conjunto.has(ot)) continue
      for (const renglon of t.renglones || []) {
        const clave = `${ot}||${normalizarCodigo(renglon.codigo)}`
        if (!salida.has(clave)) salida.set(clave, new Map())
        // ⚠️ Se acumula POR UNIDAD. 'unidad' es texto libre de quien crea la
        // tarea: si una vino en packs y otra en docenas, sumarlas daria un
        // solo numero que no significa nada. Se guardan aparte y la pantalla
        // las muestra separadas.
        const porUnidad = salida.get(clave)
        const unidad = String(renglon.unidad || 'packs').trim() || 'packs'
        const acc = porUnidad.get(unidad) || { cantidad: 0, maquilas: new Set() }
        acc.cantidad += Number(renglon.cantidad) || 0
        acc.maquilas.add(r.maquilaId)
        porUnidad.set(unidad, acc)
      }
    }
  }
  return { envios: salida, maquilasNoLeidas, sinPermiso }
}

// El arbol de una OC, cacheado por sesion con la MISMA vigencia corta que las
// tareas. Dos consumidores lo comparten a proposito: los porcentajes que el
// Historial pinta junto a cada orden, y el Excel de esa orden. Asi pintar el
// porcentaje PRECALIENTA lo que la descarga necesita (ruteo, tareas, bultos),
// y el Excel de una orden que ya esta en pantalla sale casi al instante --
// Roberto reporto el 25-08 que la primera descarga "tarda un buen": era bajar
// el ruteo completo (~5,000 folios) y la libreria de Excel en ese momento.
const VIGENCIA_CACHE_ARBOL_MS = 60_000
const cacheArbol = new Map()

/**
 * Devuelve { arbol } para una OC, o { arbol: null } si la orden no tiene
 * renglones en el plan vigente (que NO es lo mismo que un arbol vacio).
 */
export async function arbolDeOcCacheado(oc, esPrueba = false) {
  const version = await versionActiva()
  if (!version) throw new Error('No hay plan maestro cargado.')
  const clave = `${version}||${oc}||${!!esPrueba}`
  const guardado = cacheArbol.get(clave)
  if (guardado && Date.now() - guardado.cuando < VIGENCIA_CACHE_ARBOL_MS) {
    return guardado.promesa
  }
  // Se cachea la PROMESA, no el resultado: asi dos consumidores que piden la
  // misma OC casi a la vez (el % de la fila y un clic en Excel, o dos pasadas
  // del efecto por un tecleo) comparten UNA consulta en vez de disparar dos
  // descargas del ruteo en paralelo con el cache todavia frio.
  const promesa = (async () => {
    const lineasDelPlan = await lineasDeOc(version, oc)
    return lineasDelPlan.length
      ? { arbol: await armarArbolDeOc({ lineasDelPlan, esPrueba }) }
      : { arbol: null }
  })()
  // Si la consulta FALLA no se deja envenenado el cache: el siguiente intento
  // vuelve a preguntar en vez de recibir el mismo error un minuto entero.
  promesa.catch(() => cacheArbol.delete(clave))
  // Poda perezosa: las entradas vencidas se van al meter una nueva, para que
  // una sesion larga no acumule arboles muertos.
  for (const [k, v] of cacheArbol) {
    if (Date.now() - v.cuando >= VIGENCIA_CACHE_ARBOL_MS) cacheArbol.delete(k)
  }
  cacheArbol.set(clave, { cuando: Date.now(), promesa })
  return promesa
}

export async function armarArbolDeOc({ lineasDelPlan, esPrueba = false }) {
  const ots = [...new Set(lineasDelPlan.map((l) => l.ot).filter(Boolean))]

  // DOS VIAS, y se usan las dos:
  //   1. Por el campo 'producto.ot' del bulto: encuentra todo lo capturado
  //      desde el 2026-08-17, sin importar cuanto tiempo haya pasado.
  //   2. Por el ruteo: es la unica que alcanza a los bultos ANTERIORES a esa
  //      fecha, pero solo mientras el folio siga en foliosRuteo (60 dias).
  // Se unen por folio para no contar dos veces el mismo bulto.
  const porCampo = await bultosPorOtGuardada(ots)
  const folios = await foliosDeLasOts(ots)
  const porRuteo = await bultosDeFolios(folios.map((f) => f.folio))
  const porFolio = new Map()
  for (const b of porCampo || []) porFolio.set(b.folio, b)
  // Un bulto que YA trae 'producto.ot' congelada lo resuelve (o lo descarta)
  // la via BUENA de arriba: si su OT congelada esta en 'ots' ya quedo en
  // porFolio, y si no esta es porque pertenece a otra OT (quiza de una
  // version VIEJA del plan) y no le toca a esta orden. Dejarlo pasar tambien
  // por el ruteo lo agruparia por esa OT vieja y a la vez lo marcaria como
  // "fueraDelPlan" (ruido: el mismo bulto contado con dos criterios
  // distintos). Solo se excluye cuando la via del campo SI funciono
  // (porCampo !== null); si fallo (modo soloRuteo) no se filtra nada, porque
  // el ruteo es lo unico que se esta viendo y ya hay aviso en pantalla.
  for (const b of porRuteo) {
    if (porCampo !== null && b.producto?.ot) continue
    porFolio.set(b.folio, b)
  }
  const bultos = [...porFolio.values()]

  // Los bultos SIN 'producto.ot' congelada (de antes del 2026-08-17) tienen
  // que agruparse con la MISMA OT que uso foliosDeLasOts() para encontrarlos:
  // plan primero, texto de respaldo. Sin esto, en los ~25 casos donde el plan
  // CONTRADICE al texto (tipo '7512_REPOSICION_7551') la busqueda encuentra
  // el folio resolviendo plan-primero pero la agrupacion lo mandaria a la OT
  // del texto, y el folio caeria en una rama distinta de la que lo encontro.
  const pedidosSinOt = bultos.filter((b) => !b.producto?.ot).map((b) => b.producto?.pedido)
  const otsResueltas = await resolverVarios(pedidosSinOt)

  // Producido por (OT, codigo). Se cuenta en DOCENAS, que es la unidad con la
  // que ya se miden las tareas en la app.
  const producido = new Map()
  const bultosPorOt = new Map()
  for (const b of bultos) {
    // Si el bulto no trae 'producto.ot', se usa la OT ya resuelta plan-primero
    // arriba; solo si el diccionario tampoco la conoce se cae al respaldo de
    // otDeBulto (que a su vez lee el texto con el mismo criterio).
    const resuelta = !b.producto?.ot
      ? otsResueltas.get(normalizarPedido(b.producto?.pedido))
      : null
    const ot = resuelta?.ot ? normalizarOt(resuelta.ot) : otDeBulto(b)
    // Se guarda LA MISMA OT con la que se agrupa aqui, para que el Excel no
    // la vuelva a resolver por su cuenta: dos copias de esta decision es
    // exactamente como un folio acaba en una rama distinta segun donde lo
    // mires. Ya paso una vez en este archivo.
    b.otResuelta = ot
    const codigo = normalizarCodigo(b.producto?.codigo)
    const clave = `${ot}||${codigo}`
    producido.set(clave, (producido.get(clave) || 0) + docenasDeCaptura(b))
    if (!bultosPorOt.has(ot)) bultosPorOt.set(ot, [])
    bultosPorOt.get(ot).push(b)
  }

  // El tercer estado: lo que ya salio a ensamblar. Se reusa la lista 'ots'
  // que ya se armo arriba en vez de recalcularla.
  const { envios, maquilasNoLeidas, sinPermiso } = await enviosDeLasOts(ots, esPrueba)

  const porOt = new Map()
  for (const l of lineasDelPlan) {
    if (!porOt.has(l.ot)) porOt.set(l.ot, [])
    const clave = `${l.ot}||${normalizarCodigo(l.codigo)}`
    const env = envios.get(clave)
    porOt.get(l.ot).push({
      ...l,
      producido: producido.get(clave) || 0,
      // Lo enviado va con su unidad y NO entra en el porcentaje de avance:
      // ese porcentaje compara docenas con docenas.
      // Una entrada por unidad: [{ unidad, cantidad, maquilas }]. Vacio si
      // este codigo todavia no se le encarga a nadie.
      enviado: env
        ? [...env.entries()].map(([unidad, v]) => ({
            unidad,
            cantidad: v.cantidad,
            maquilas: [...v.maquilas]
          }))
        : []
    })
  }

  const ramas = [...porOt.entries()]
    .map(([ot, lineas]) => {
      const conFolios = (bultosPorOt.get(ot) || []).length
      const avance = avanceDe(lineas)
      return {
        ot,
        // Cuanto de esta OT ya salio a ensamblar, en %. Va aparte del avance
        // de produccion: son dos preguntas distintas ("ya se hizo" vs "ya se
        // mando") y juntarlas en un solo numero las vuelve indistinguibles.
        envio: avanceDeEnvio(lineas),
        // A quien va esta orden de trabajo, segun el plan. Todas sus lineas
        // dicen lo mismo (medido en el archivo real: ninguna OT cambia de
        // destino entre renglones), asi que basta la primera que lo traiga.
        destino: lineas.find((l) => l.destino)?.destino || '',
        lineas: lineas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es')),
        folios: conFolios,
        ...avance,
        // ⚠️ Sin un solo folio NO se puede afirmar que no se produjo nada: puede
        // que no haya arrancado, o puede que se produjera hace mas de 60 dias y
        // el ruteo ya se purgo. Son cosas distintas y la app no puede
        // distinguirlas, asi que no finge un 0%.
        sinDatos: conFolios === 0,
        porcentaje: conFolios === 0 ? null : avance.porcentaje
      }
    })
    .sort((a, b) => String(a.ot).localeCompare(String(b.ot), 'es', { numeric: true }))

  // Lo que produjo la fabrica y el plan no menciona. No es ruido: o el plan
  // esta incompleto, o alguien capturo contra una OT que no le tocaba.
  const codigosDelPlan = new Set(lineasDelPlan.map((l) => `${l.ot}||${normalizarCodigo(l.codigo)}`))
  const fueraDelPlan = []
  for (const [clave, docenas] of producido) {
    if (!codigosDelPlan.has(clave) && docenas > 0) {
      const [ot, codigo] = clave.split('||')
      fueraDelPlan.push({ ot, codigo, docenas })
    }
  }

  // El total SOLO se calcula sobre las ramas CON datos (folios encontrados).
  // Una rama 'sinDatos' tiene meta numerica y producido 0 (no porque no se
  // haya producido, sino porque no se sabe): meterla al total infla el
  // denominador con un hueco de datos disfrazado de cero. El sintoma llegaria
  // solo: en 2-4 semanas, cuando foliosRuteo purgue los folios de una OT ya
  // completada, el % del encabezado que ve Lindbergh bajaria solo, sin que
  // nadie tocara nada.
  const conDatos = ramas.filter((r) => !r.sinDatos)

  return {
    ramas,
    total: avanceDe(conDatos.flatMap((r) => r.lineas)),
    // El total de ENVIO si sale sobre TODAS las ramas, no solo las que tienen
    // folios: lo enviado no depende de que el ruteo conserve el rastro de la
    // captura, se lee de las tareas, que no se purgan.
    totalEnvio: avanceDeEnvio(ramas.flatMap((r) => r.lineas)),
    // Cuantas OT quedaron fuera del total de arriba por no tener ni un folio.
    otsExcluidasDelTotal: ramas.length - conDatos.length,
    // OT planeadas de las que no hay ni un folio: puede ser que no arrancaron
    // o que su rastro se purgo. La pantalla lo dice con esas palabras.
    otsSinProduccion: ramas.filter((r) => r.sinDatos).map((r) => r.ot),
    // Si la consulta por 'producto.ot' fallo, el arbol solo esta viendo lo que
    // alcanza el ruteo (60 dias). Hay que decirlo o los numeros parecen
    // completos estando cortados.
    soloRuteo: porCampo === null,
    fueraDelPlan: fueraDelPlan.sort((a, b) => b.docenas - a.docenas),
    // Maquilas cuyas tareas no se pudieron leer: sin esto la columna de
    // "ya en maquila" se veria baja y pareceria que no se ha mandado nada,
    // cuando lo que pasa es que no se pudo preguntar.
    maquilasNoLeidas,
    // Si el fallo fue de PERMISO, la pantalla tiene que decir eso y no
    // "puede estar incompleta": lo segundo suena a algo pasajero cuando en
    // realidad esa cuenta no va a ver nunca esa columna.
    enviosSinPermiso: sinPermiso,
    // Los bultos ya resueltos a su OT, para que el Excel de la orden de compra
    // no tenga que repetir la resolucion (que es delicada: campo congelado
    // primero, texto de respaldo despues) y acabe agrupando distinto que el
    // arbol que se ve en pantalla.
    bultos
  }
}
