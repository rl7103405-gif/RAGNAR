// Lee el EXCEL DEL PLAN MAESTRO de Adrian.
//
// Ya no esta escrito a ciegas: el archivo real llego el 2026-08-18
// ('Planeacion pedidos calcetin Agosto 2026.xlsx', 9 hojas) y este lector se
// ajusto contra el. Lo que saca son DOS cosas:
//
//   lineas   OC + OT + codigo + cantidad  ->  el arbol de Lindbergh
//   pedidos  texto del pedido -> OT       ->  el diccionario que arregla el
//                                             24% de folios cuya OT hoy se
//                                             adivina mal (ver otResuelta.js)
//
// ⚠️ EL BUG QUE ESTE ARCHIVO REVELO. La deteccion de columnas tomaba la
// PRIMERA que coincidiera con algun sinonimo. En la hoja real conviven
// 'NoPedido' (columna 3, el texto largo del pedido) y 'NumPedido' (columna 17,
// la orden de trabajo de verdad), y las dos estaban listadas como sinonimo de
// OT: habria ganado NoPedido y el plan entero habria entrado con la OT llena
// de texto. Ahora cada campo tiene un ORDEN DE PREFERENCIA explicito, y cuando
// mas de una columna compite se dice en pantalla cual gano.
//
// Lecciones ya pagadas en este proyecto y que aqui se respetan:
//   - Los encabezados se comparan EXACTO, no con startsWith: 'solicitante'
//     (quien pidio) se colaba como 'solicita' (cuanto pidio).
//   - Un encabezado NO garantiza el contenido: la columna que decia SOLICITA
//     traia la cantidad en un archivo y la FECHA en el real de Lindbergh. Por
//     eso se valida el TIPO de la celda antes de aceptarla como cantidad.
//   - Las hojas que no cuadran se ignoran Y SE REPORTAN, nunca en silencio.
//   - Cantidad ausente NO es cero. Cero es una meta; ausente es no saber.
import {
  OC_INVALIDA,
  OC_SIN,
  OC_VALIDA,
  clasificarOc,
  normalizarCodigo,
  normalizarOt,
  normalizarPedido
  // Con extension .js a proposito: este lector tambien lo corre Node desde
  // scripts/probar_plan_maestro.mjs, y Node exige la extension. Mismo patron
  // que src/utils/catalogoClaves.js.
} from './planMaestroNucleo.js'

/** Solo se miran las primeras filas buscando los encabezados. */
const FILAS_ENCABEZADO = 12

export function normalizarTexto(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * ¿Es una formula que el Excel guardo SIN su resultado calculado?
 *
 * ⚠️ Esto no es teorico: la columna OC del archivo real es un XLOOKUP contra
 * otra hoja, y 335 de sus celdas venian asi. Excel se las muestra a Adrian en
 * pantalla porque las recalcula al abrir, pero en el ARCHIVO no hay ningun
 * valor guardado. Quien lo lea desde afuera no tiene de donde sacarlo.
 */
export function esFormulaSinResultado(v) {
  return !!v && typeof v === 'object' && !(v instanceof Date) && 'formula' in v && !('result' in v)
}

/** El texto de una celda de exceljs (que puede traer objetos de formula). */
export function textoDeCelda(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString()
    // Celda con formula: interesa el resultado, no la formula. Si la formula
    // dio error (#REF!, #N/A) exceljs deja {error:'#REF!'}: eso NO es texto,
    // y dejarlo pasar meteria '#REF!' como si fuera una orden de compra.
    if ('error' in v) return ''
    if ('result' in v) return textoDeCelda(v.result)
    // v.text puede venir como objeto anidado (celda con formato/hipervinculo
    // que exceljs no aplano). String() sobre un objeto da '[object Object]',
    // que como texto no vacio pasaria todas las validaciones. Solo se acepta
    // si ya es string o number.
    if ('text' in v) return typeof v.text === 'string' || typeof v.text === 'number' ? String(v.text) : ''
    if ('richText' in v) {
      return v.richText
        .map((r) => (typeof r.text === 'string' || typeof r.text === 'number' ? String(r.text) : ''))
        .join('')
    }
    // ⚠️ Cualquier otro objeto (empezando por la formula sin resultado) se va
    // VACIO, nunca por String(). Con String() esto devolvia '[object Object]',
    // y como es un texto no vacio pasaba todas las validaciones: el archivo
    // real produjo asi una orden de compra fantasma llamada '[OBJECTOBJECT]'
    // con 134 ordenes de trabajo colgando, mas grande que ninguna real.
    return ''
  }
  return String(v)
}

/**
 * Identificador (orden de compra, orden de trabajo, codigo) de una celda.
 *
 * ⚠️ Devuelve null si la celda trae una FECHA. Excel convierte solo, sin
 * avisar, cualquier cosa con pinta de fecha — y '24-49', que es justo como se
 * nombran las ordenes de compra aqui, es exactamente esa pinta. Si la columna
 * no viene forzada a Texto, la OC llega como 1949-24-01 y se guardaria como
 * identificador valido, dejando el arbol amarrado a una orden que no existe.
 * Vale mas rechazar el renglon y decirlo que guardar una mentira.
 */
export function identificadorDeCelda(valor) {
  if (valor instanceof Date) return null
  if (valor && typeof valor === 'object') {
    const bruto = 'result' in valor ? valor.result : null
    if (bruto instanceof Date) return null
  }
  return textoDeCelda(valor)
}

// Nombres posibles de cada columna, EN ORDEN DE PREFERENCIA: la primera de la
// lista que exista en la hoja gana, sin importar en que posicion este. La
// comparacion contra el encabezado normalizado es exacta.
//
// El orden no es cosmetico. En el archivo real 'numpedido' tiene que ganarle a
// cualquier otra candidata a OT, y 'codigo' tiene que ganarle a 'modelo' y a
// 'articulo', que en esa hoja son la familia y la descripcion.
const SINONIMOS = {
  oc: [
    'oc', 'o.c.', 'orden de compra', 'ordendecompra', 'orden compra',
    'po', 'p.o.', 'orden del cliente', 'no orden de compra',
    'num orden de compra', 'numero de orden de compra'
  ],
  ot: [
    'numpedido', 'num pedido', 'num. pedido', 'numero de pedido',
    'ot', 'o.t.', 'orden de trabajo', 'ordendetrabajo', 'orden trabajo',
    'no orden de trabajo', 'num orden', 'numero de orden'
  ],
  // El texto largo del pedido. NO es la OT: es la llave para cruzar con el
  // ruteo de America, que trae exactamente este mismo texto.
  // OJO: 'nombre pedido' NO va aqui — en el archivo real esa columna trae el
  // DESTINO ('CAT Julio', 'City club Reebok'), no el texto del pedido.
  pedido: ['nopedido', 'no pedido', 'no. pedido', 'pedido'],
  codigo: ['codigo', 'codigo quini', 'clave', 'estilo', 'modelo cliente', 'modelo', 'articulo'],
  cantidad: [
    'docenas solicitadas', 'solicitadas', 'cantidad planeada', 'planeado',
    'cantidad', 'docenas', 'piezas', 'pares', 'packs', 'meta', 'solicita'
  ],
  cliente: ['cliente', 'nombre del cliente', 'razon social'],
  // A QUIEN VA la orden: 'Modular Walmart Jun-Sep', 'City club Reebok',
  // 'Shasa RA Agosto'. En el archivo real es la columna 'Nom ped' y los 292
  // renglones con OC valida la traen; ninguna OT la cambia entre renglones.
  // Es el dato que la junta del 17-08 pidio ver por orden de trabajo
  // ('Lindbergh tiene la vision OT-OC') y el que alinea el arbol con las
  // tareas de ensamble. NO es una descripcion: tiene campo propio.
  destino: ['nom ped', 'nombre pedido', 'nombre del pedido', 'destino'],
  descripcion: ['descripcion', 'producto', 'nombre'],
  unidad: ['unidad', 'um', 'u.m.']
}

/**
 * Encuentra la fila de encabezados y mapea las columnas.
 *
 * Devuelve null si la hoja no sirve para nada. Una hoja sirve si aporta el
 * AMARRE (ot + oc) o el DICCIONARIO (ot + pedido); con solo una OT suelta no
 * hay nada que hacer, y este libro trae varias tablas dinamicas asi.
 */
function detectarFormato(hoja) {
  const tope = Math.min(hoja.rowCount, FILAS_ENCABEZADO)
  for (let n = 1; n <= tope; n++) {
    const valores = hoja.getRow(n).values
    const encabezados = []
    for (let col = 1; col < valores.length; col++) {
      const texto = normalizarTexto(textoDeCelda(valores[col]))
      if (texto) encabezados.push({ col, texto })
    }
    if (encabezados.length === 0) continue

    // Por cada campo: todas las columnas que compiten, y la ganadora segun el
    // orden de preferencia. Las competidoras se reportan — un encabezado mal
    // elegido es la falla mas silenciosa que puede tener esto.
    const columnas = {}
    const ambiguas = []
    for (const campo of Object.keys(SINONIMOS)) {
      const candidatas = encabezados.filter((e) => SINONIMOS[campo].includes(e.texto))
      if (candidatas.length === 0) {
        columnas[campo] = null
        continue
      }
      const ganadora = candidatas.reduce((mejor, e) => {
        const rango = (x) => SINONIMOS[campo].indexOf(x.texto)
        return rango(e) < rango(mejor) ? e : mejor
      })
      columnas[campo] = ganadora.col
      if (candidatas.length > 1) {
        ambiguas.push({
          campo,
          gano: ganadora.texto,
          descartadas: candidatas.filter((c) => c.col !== ganadora.col).map((c) => c.texto)
        })
      }
    }

    const sirve = columnas.ot && (columnas.oc || columnas.pedido)
    if (sirve) {
      return {
        filaEncabezados: n,
        columnas,
        ambiguas,
        encabezados: encabezados.map((e) => e.texto)
      }
    }
  }
  return null
}

/** Numero de una celda que deberia traer una cantidad. Devuelve null si lo
 *  que hay no es un numero: una fecha o un texto NO se convierten a la
 *  brava, se reportan como renglon sin meta. */
function numeroDeCelda(valor) {
  if (valor == null || valor === '') return null
  if (valor instanceof Date) return null
  const bruto = typeof valor === 'object' && 'result' in valor ? valor.result : valor
  if (bruto instanceof Date) return null
  const n = typeof bruto === 'number' ? bruto : Number(String(bruto).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Lee el libro completo.
 *
 * Devuelve { lineas, pedidos, diagnostico }. El diagnostico es tan importante
 * como los datos: con un archivo de nueve hojas de las que solo dos sirven, lo
 * que NO se reconocio es lo que dice si el plan entro completo o a medias.
 */
export async function leerPlanMaestro(archivo) {
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.Workbook || ExcelJS.default?.Workbook
  const libro = new Workbook()
  await libro.xlsx.load(await archivo.arrayBuffer())

  const lineas = []
  const pedidos = new Map() // pedidoClave -> { pedidoTexto, ot }
  // Claves que ya tuvieron un conflicto (mismo pedido, dos OT distintas) y se
  // borraron del mapa. Sin este Set, si el pedido vuelve a aparecer despues
  // con la OT que SI habia quedado registrada antes del conflicto, ya no hay
  // 'previa' que comparar y la entrada se reinserta como si nunca hubiera
  // sido descartada (A, luego B -conflicto, se borra-, luego A otra vez ->
  // reinsertada). Una clave en conflicto queda fuera para siempre en esta
  // lectura.
  const clavesEnConflicto = new Set()
  const hojasLeidas = []
  const hojasIgnoradas = []
  const renglonesIncompletos = []
  const conflictosDePedido = [] // el mismo pedido con dos OT distintas
  const ambiguedades = []
  let sinCantidad = 0
  let sinOc = 0
  let formulaSinResultado = 0
  let ocInvalida = 0
  let duplicadosDeOtraHoja = 0

  // Una OT solo puede venir de UNA hoja. Este libro trae la misma orden en la
  // hoja de detalle (por codigo: '1026-I') y en la de resumen (por familia:
  // 'GC3'); aceptar las dos duplicaria la meta y el arbol se veria a la mitad
  // de avance con la produccion completa.
  const hojaDeLaOt = new Map()

  libro.eachSheet((hoja) => {
    const formato = detectarFormato(hoja)
    if (!formato) {
      hojasIgnoradas.push({
        hoja: hoja.name,
        // Se guardan los encabezados que SI tenia: es lo que hace falta para
        // ajustar los sinonimos sin volver a pedir el archivo.
        encabezados: (() => {
          const vistos = []
          for (let n = 1; n <= Math.min(hoja.rowCount, FILAS_ENCABEZADO); n++) {
            const v = hoja.getRow(n).values
            for (let c = 1; c < v.length; c++) {
              const t = normalizarTexto(textoDeCelda(v[c]))
              if (t && !vistos.includes(t)) vistos.push(t)
            }
            if (vistos.length) break
          }
          return vistos.slice(0, 25)
        })()
      })
      return
    }

    const { columnas, filaEncabezados, ambiguas } = formato
    ambiguas.forEach((a) => ambiguedades.push({ hoja: hoja.name, ...a }))

    let deLaHoja = 0
    let pedidosDeLaHoja = 0
    for (let n = filaEncabezados + 1; n <= hoja.rowCount; n++) {
      const fila = hoja.getRow(n)
      const val = (col) => (col ? fila.getCell(col).value : null)

      const crudoOt = identificadorDeCelda(val(columnas.ot))
      // Una celda con fecha donde deberia ir un identificador: Excel la
      // convirtio sola. Se descarta el renglon Y SE DICE, en vez de guardar
      // una orden inventada.
      if (crudoOt === null) {
        renglonesIncompletos.push({
          hoja: hoja.name,
          fila: n,
          motivo: 'Excel convirtio la orden de trabajo en FECHA (formatea la columna como Texto)'
        })
        continue
      }
      const ot = normalizarOt(crudoOt)
      if (!ot) continue // renglon vacio o de subtotal
      if (ot.length > 40) {
        renglonesIncompletos.push({ hoja: hoja.name, fila: n, motivo: 'orden de trabajo demasiado larga' })
        continue
      }

      // --- El diccionario pedido -> OT (independiente de que haya OC) -------
      if (columnas.pedido) {
        const textoPedido = String(identificadorDeCelda(val(columnas.pedido)) ?? '').trim()
        const clave = normalizarPedido(textoPedido)
        if (clave && !clavesEnConflicto.has(clave)) {
          const previa = pedidos.get(clave)
          if (previa && previa.ot !== ot) {
            // El mismo texto de pedido apuntando a dos ordenes: no se puede
            // elegir por cuenta propia cual vale. Se descarta la entrada
            // entera y se reporta; el respaldo por texto sigue funcionando.
            conflictosDePedido.push({ hoja: hoja.name, fila: n, pedido: textoPedido, ots: [previa.ot, ot] })
            pedidos.delete(clave)
            clavesEnConflicto.add(clave)
          } else if (!previa) {
            const destino = columnas.destino
              ? String(identificadorDeCelda(val(columnas.destino)) ?? '').trim().slice(0, 120)
              : ''
            pedidos.set(clave, {
              pedidoClave: clave,
              pedidoTexto: textoPedido.slice(0, 200),
              ot,
              ...(destino ? { destino } : {})
            })
            pedidosDeLaHoja += 1
          }
        }
      }

      // --- La linea del plan (necesita OC valida) ---------------------------
      if (!columnas.oc) continue
      const celdaOc = val(columnas.oc)
      // La OC viene de un XLOOKUP contra otra hoja. Si Excel guardo la formula
      // sin su resultado, el dato NO esta en el archivo — y eso no se puede
      // arreglar leyendo mejor: hay que recalcular y volver a guardar. Se
      // cuenta aparte de "sin OC" porque el remedio es distinto y concreto.
      if (esFormulaSinResultado(celdaOc)) {
        formulaSinResultado += 1
        continue
      }
      const crudoOc = identificadorDeCelda(celdaOc)
      if (crudoOc === null) {
        renglonesIncompletos.push({
          hoja: hoja.name,
          fila: n,
          motivo: 'Excel convirtio la orden de compra en FECHA (formatea la columna como Texto)'
        })
        continue
      }
      const { estado, oc } = clasificarOc(crudoOc)
      // Sin OC la OT no cuelga de ninguna rama del arbol. NO es un error: es
      // el estado normal de la mayoria del archivo, porque esa columna se
      // empezo a llenar en abril. Se cuenta para poder decirlo en pantalla.
      if (estado === OC_SIN) {
        sinOc += 1
        continue
      }
      if (estado === OC_INVALIDA) {
        ocInvalida += 1
        continue
      }
      if (estado !== OC_VALIDA) continue

      // Una OT que ya aporto otra hoja no se vuelve a tomar: seria contar dos
      // veces la misma meta.
      const dueña = hojaDeLaOt.get(ot)
      if (dueña && dueña !== hoja.name) {
        duplicadosDeOtraHoja += 1
        continue
      }
      hojaDeLaOt.set(ot, hoja.name)

      const cantidad = numeroDeCelda(val(columnas.cantidad))
      if (cantidad === null) sinCantidad += 1
      // Una cantidad negativa no la acepta el servidor. Se descarta el renglon
      // en vez de tumbar la subida entera al llegar al lote.
      if (cantidad !== null && cantidad < 0) {
        renglonesIncompletos.push({ hoja: hoja.name, fila: n, motivo: `cantidad negativa (${cantidad})` })
        continue
      }

      lineas.push({
        oc,
        ot,
        codigo: normalizarCodigo(identificadorDeCelda(val(columnas.codigo)) ?? '').slice(0, 60),
        // ⚠️ null, NO cero. Sin cantidad la linea SIGUE valiendo: amarra la OT
        // a su OC, que es lo minimo que hace falta para el arbol. Lo que no se
        // puede es medir su avance — y un cero ahi se pintaria como "falta 0",
        // o sea como si ya estuviera lista.
        cantidadPlaneada: cantidad,
        hoja: hoja.name.slice(0, 60),
        ...(columnas.destino
          ? { destino: String(identificadorDeCelda(val(columnas.destino)) ?? '').trim().slice(0, 120) }
          : {}),
        ...(columnas.unidad ? { unidad: String(textoDeCelda(val(columnas.unidad))).slice(0, 20) } : {}),
        ...(columnas.cliente ? { cliente: String(textoDeCelda(val(columnas.cliente))).slice(0, 120) } : {}),
        ...(columnas.descripcion
          ? { descripcion: String(textoDeCelda(val(columnas.descripcion))).slice(0, 200) }
          : {})
      })
      deLaHoja += 1
    }
    hojasLeidas.push({ hoja: hoja.name, lineas: deLaHoja, pedidos: pedidosDeLaHoja, columnas })
  })

  const ocs = new Set(lineas.map((l) => l.oc))
  const otsConOc = new Set(lineas.map((l) => l.ot))
  const otsDelDiccionario = new Set([...pedidos.values()].map((p) => p.ot))

  return {
    lineas,
    pedidos: [...pedidos.values()],
    diagnostico: {
      hojasLeidas,
      hojasIgnoradas,
      ambiguedades,
      renglonesIncompletos: renglonesIncompletos.slice(0, 50),
      totalIncompletos: renglonesIncompletos.length,
      conflictosDePedido: conflictosDePedido.slice(0, 20),
      totalConflictosDePedido: conflictosDePedido.length,
      sinCantidad,
      sinOc,
      ocInvalida,
      formulaSinResultado,
      duplicadosDeOtraHoja,
      totalLineas: lineas.length,
      totalOcs: ocs.size,
      totalOts: otsConOc.size,
      totalPedidos: pedidos.size,
      // Cuantas OT conoce el diccionario aunque no tengan orden de compra: es
      // la medida de lo que se gana aunque el amarre venga incompleto.
      otsEnDiccionario: otsDelDiccionario.size,
      // Sin codigo el arbol llega hasta la OT, no hasta el detalle por codigo.
      sinCodigo: lineas.filter((l) => !l.codigo).length
    }
  }
}
