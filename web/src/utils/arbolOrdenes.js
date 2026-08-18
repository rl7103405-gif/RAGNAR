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
import { MAX_IN, normalizarCodigo, normalizarOt, normalizarPedido } from './planMaestro'
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
  const guardada = bulto?.producto?.ot
  if (guardada) return normalizarOt(guardada)
  const ot = otDelTexto(bulto?.producto?.pedido)
  return ot ? normalizarOt(ot) : ''
}

/**
 * Bultos de unas OT consultando el campo `producto.ot` que se congela al
 * capturar.
 *
 * Es la via BUENA: no depende de 'foliosRuteo', que se purga a los 15 dias
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
  if (!cacheRuteo) {
    const snap = await getDocs(collection(db, 'foliosRuteo'))
    cacheRuteo = snap.docs.map((d) => ({ folio: d.id, ...d.data() }))
  }
  // Se resuelven de golpe los pedidos DISTINTOS (decenas), no folio por folio.
  const resueltas = await resolverVarios(cacheRuteo.map((f) => f.pedido).filter(Boolean))
  return cacheRuteo.filter((f) => {
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
export async function armarArbolDeOc({ lineasDelPlan }) {
  const ots = [...new Set(lineasDelPlan.map((l) => l.ot).filter(Boolean))]

  // DOS VIAS, y se usan las dos:
  //   1. Por el campo 'producto.ot' del bulto: encuentra todo lo capturado
  //      desde el 2026-08-17, sin importar cuanto tiempo haya pasado.
  //   2. Por el ruteo: es la unica que alcanza a los bultos ANTERIORES a esa
  //      fecha, pero solo mientras el folio siga en foliosRuteo (15 dias).
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
    const codigo = normalizarCodigo(b.producto?.codigo)
    const clave = `${ot}||${codigo}`
    producido.set(clave, (producido.get(clave) || 0) + docenasDeCaptura(b))
    if (!bultosPorOt.has(ot)) bultosPorOt.set(ot, [])
    bultosPorOt.get(ot).push(b)
  }

  const porOt = new Map()
  for (const l of lineasDelPlan) {
    if (!porOt.has(l.ot)) porOt.set(l.ot, [])
    porOt.get(l.ot).push({
      ...l,
      producido: producido.get(`${l.ot}||${normalizarCodigo(l.codigo)}`) || 0
    })
  }

  const ramas = [...porOt.entries()]
    .map(([ot, lineas]) => {
      const conFolios = (bultosPorOt.get(ot) || []).length
      const avance = avanceDe(lineas)
      return {
        ot,
        // A quien va esta orden de trabajo, segun el plan. Todas sus lineas
        // dicen lo mismo (medido en el archivo real: ninguna OT cambia de
        // destino entre renglones), asi que basta la primera que lo traiga.
        destino: lineas.find((l) => l.destino)?.destino || '',
        lineas: lineas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es')),
        folios: conFolios,
        ...avance,
        // ⚠️ Sin un solo folio NO se puede afirmar que no se produjo nada: puede
        // que no haya arrancado, o puede que se produjera hace mas de 15 dias y
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
    // Cuantas OT quedaron fuera del total de arriba por no tener ni un folio.
    otsExcluidasDelTotal: ramas.length - conDatos.length,
    // OT planeadas de las que no hay ni un folio: puede ser que no arrancaron
    // o que su rastro se purgo. La pantalla lo dice con esas palabras.
    otsSinProduccion: ramas.filter((r) => r.sinDatos).map((r) => r.ot),
    // Si la consulta por 'producto.ot' fallo, el arbol solo esta viendo lo que
    // alcanza el ruteo (15 dias). Hay que decirlo o los numeros parecen
    // completos estando cortados.
    soloRuteo: porCampo === null,
    fueraDelPlan: fueraDelPlan.sort((a, b) => b.docenas - a.docenas)
  }
}
