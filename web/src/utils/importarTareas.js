// Importacion de TAREAS desde Excel. Acepta los dos formatos que manda el
// papa de Beto (ejemplos del 2026-08-10) y detecta solo el formato por los
// encabezados de cada hoja, en cualquier hoja del archivo:
//
//  - RESURTIDO: columnas fecha / CODIGO / DOCENAS FALTANTES (pocas columnas).
//    Una tarea por codigo con meta = docenas faltantes.
//  - ESPECIAL: columnas FechaEntrega / NoPedido / Codigo / NumPedido /
//    ARTICULO / COLOR2 / TALLA2 / SOLICITA. Una tarea por codigo con meta =
//    SOLICITA; la OT sale de NumPedido. Trae renglon de totales al final
//    (sin codigo) que se ignora.
//
// Si el mismo codigo aparece varias veces en el archivo (varias OTs), se
// COMBINA en una sola tarea: las metas se suman y las OTs se juntan --
// Roberto definio que una tarea es por CODIGO y puede abarcar varias OTs.
//
// Las hojas que no coinciden con ningun formato se ignoran y se reportan
// (el Excel real trae tambien la hoja grande de forecast, que no es tarea).

const MAX_FILAS_POR_HOJA = 5000
// Una hoja de resurtido es CHICA (fecha/codigo/docenas). La hoja grande de
// forecast tambien trae una columna "DOCENAS FALTANTES", pero con decenas de
// encabezados: este tope evita confundirla con un resurtido.
const MAX_ENCABEZADOS_RESURTIDO = 6
// El formato especial real trae ~8 columnas (FechaEntrega/NoPedido/Codigo/
// NumPedido/ARTICULO/COLOR2/TALLA2/SOLICITA). Sin este tope, una hoja de 45
// columnas con 'Codigo' + 'NumPedido' se clasificaria como tarea y crearia
// cientos de renglones basura (lo cazo code-reviewer, 2026-08-12).
const MAX_ENCABEZADOS_ESPECIAL = 12

export class ErrorImportacionTareas extends Error {}

/** minusculas, sin acentos, espacios colapsados */
function normalizarTexto(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Celda de exceljs a texto plano (respeta richText y formulas con result). */
function textoDeCelda(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('')
    if (v.result != null) return textoDeCelda(v.result)
    if (v.text != null) return String(v.text)
    if (v instanceof Date) return v.toISOString()
    return ''
  }
  return String(v)
}

/** Codigo de producto como texto: 4727 (numero) -> '4727'; '1154-I' tal cual. */
function codigoDeCelda(v) {
  if (v == null) return ''
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : String(v).trim()
  }
  const crudo = typeof v === 'object' && v.result != null ? v.result : v
  if (typeof crudo === 'number') return Number.isInteger(crudo) ? String(crudo) : String(crudo)
  return textoDeCelda(v).trim()
}

function numeroDeCelda(v) {
  if (v == null) return null
  const crudo = typeof v === 'object' && v.result != null ? v.result : v
  if (typeof crudo === 'number') return Number.isFinite(crudo) ? crudo : null
  // richText y demas objetos pasan por el mismo extractor que el resto de
  // celdas; '841,5' (coma decimal) se distingue de '1,234' (coma de miles).
  let texto = (typeof crudo === 'object' ? textoDeCelda(crudo) : String(crudo)).trim()
  if (/^\d+,\d{1,2}$/.test(texto)) texto = texto.replace(',', '.')
  else texto = texto.replace(/,/g, '')
  const n = Number(texto)
  return Number.isFinite(n) ? n : null
}

/** ¿La celda trae una FECHA? Sirve para diagnosticar el caso real de
 *  Lindbergh (2026-08-12): un Excel donde la columna 'SOLICITA' traia la fecha
 *  de solicitud en vez de la cantidad, asi que TODOS los renglones se
 *  descartaban con un mensaje vago. */
function pareceFecha(v) {
  const crudo = v != null && typeof v === 'object' && v.result != null ? v.result : v
  return crudo instanceof Date && !Number.isNaN(crudo.getTime())
}

function fechaDeCelda(v) {
  const crudo = v != null && typeof v === 'object' && v.result != null ? v.result : v
  if (crudo instanceof Date && !Number.isNaN(crudo.getTime())) return crudo
  return null
}

function fechaCorta(fecha) {
  // exceljs entrega las fechas del Excel como medianoche UTC: con getters
  // locales (Mexico, UTC-6) se recorren un dia hacia atras. Getters UTC.
  return fecha
    ? `${String(fecha.getUTCDate()).padStart(2, '0')}/${String(fecha.getUTCMonth() + 1).padStart(2, '0')}/${fecha.getUTCFullYear()}`
    : null
}

/** Busca la fila de encabezados en las primeras filas de la hoja y clasifica
 *  el formato. Devuelve null si la hoja no es de tareas. */
function detectarFormato(hoja) {
  const tope = Math.min(hoja.rowCount, 10)
  for (let n = 1; n <= tope; n++) {
    const valores = hoja.getRow(n).values // 1-based, indice 0 vacio
    const encabezados = []
    for (let col = 1; col < valores.length; col++) {
      const texto = normalizarTexto(textoDeCelda(valores[col]))
      if (texto) encabezados.push({ col, texto })
    }
    if (encabezados.length === 0) continue

    const buscar = (pred) => encabezados.find((e) => pred(e.texto))?.col ?? null

    const colCodigo = buscar((t) => t === 'codigo' || t.startsWith('codigo '))
    if (!colCodigo) continue

    // ESPECIAL: codigo + (solicita u OT). Lo UNICO obligatorio es codigo y
    // OT/NumPedido (decision de Roberto, 2026-08-12): la cantidad puede no
    // venir en el archivo y resolverse despues (del ruteo o a mano).
    // Coincidencia EXACTA: 'solicitante' (quien pidio) no es la cantidad
    // solicitada, y con startsWith se colaba.
    const colSolicita = buscar((t) => t === 'solicita' || t === 'solicitadas')
    const colOt = buscar((t) => t === 'numpedido' || t === 'num pedido')
    const colPedido = buscar((t) => t === 'nopedido' || t === 'no pedido')
    // Cantidad explicita con otros nombres posibles, por si el archivo la trae
    // con encabezado propio en vez de reusar SOLICITA.
    const colCantidad = buscar(
      (t) =>
        t === 'cantidad' ||
        t === 'meta' ||
        t.startsWith('docenas solicitadas') ||
        t.startsWith('docenas a') ||
        t === 'docenas'
    )
    if ((colSolicita || colOt || colPedido) && encabezados.length <= MAX_ENCABEZADOS_ESPECIAL) {
      return {
        tipo: 'especial',
        filaEncabezados: n,
        columnas: {
          codigo: colCodigo,
          // Si hay una columna de cantidad explicita, esa manda sobre SOLICITA
          // (que en el archivo real de Lindbergh traia una FECHA).
          meta: colCantidad || colSolicita || null,
          ot: colOt,
          pedido: colPedido,
          fecha: buscar((t) => t.startsWith('fechaentrega') || t.startsWith('fecha entrega')),
          articulo: buscar((t) => t === 'articulo'),
          color: buscar((t) => t.startsWith('color')),
          talla: buscar((t) => t.startsWith('talla'))
        }
      }
    }

    // RESURTIDO: codigo + docenas, en una hoja CHICA.
    const colDocenas = buscar((t) => t.includes('docenas'))
    if (colDocenas && encabezados.length <= MAX_ENCABEZADOS_RESURTIDO) {
      return {
        tipo: 'resurtido',
        filaEncabezados: n,
        columnas: {
          codigo: colCodigo,
          meta: colDocenas,
          fecha: buscar((t) => t === 'fecha' || t.startsWith('fecha '))
        }
      }
    }
  }
  return null
}

/** OT de 4 digitos a partir de NumPedido (7878) o del prefijo de NoPedido
 *  ('7878_2507..._AGOSTO'). */
function otDeFila(valores, columnas) {
  if (columnas.ot) {
    const bruto = codigoDeCelda(valores[columnas.ot])
    const m = /^\d{4}/.exec(bruto)
    if (m) return m[0]
  }
  if (columnas.pedido) {
    const m = /^\d{4}/.exec(textoDeCelda(valores[columnas.pedido]).trim())
    if (m) return m[0]
  }
  return null
}

/**
 * Lee el archivo (ArrayBuffer) y devuelve:
 *   {
 *     tareas: [{ codigo, metaDocenas, tipo, ots, fechas, detalles, renglones }],
 *     hojasLeidas:   [{ nombre, tipo, renglones }],
 *     hojasIgnoradas: [nombre, ...],
 *     renglonesDescartados  // solo los que no traen codigo
 *   }
 * Las tareas ya vienen COMBINADAS por codigo.
 */
export async function leerExcelTareas(buffer) {
  let libro
  try {
    // En Vite, Workbook llega como export con nombre; en Node (los scripts de
    // prueba) viene dentro de default. Se aceptan ambos.
    const mod = await import('exceljs')
    const Workbook = mod.Workbook || mod.default?.Workbook
    libro = new Workbook()
    await libro.xlsx.load(buffer)
  } catch (err) {
    console.error('[importarTareas] No se pudo abrir el archivo:', err)
    throw new ErrorImportacionTareas(
      'No se pudo abrir el archivo. Debe ser un .xlsx (Excel moderno) sin contraseña.'
    )
  }

  const porCodigo = new Map()
  const hojasLeidas = []
  const hojasIgnoradas = []
  const motivosDescarte = new Map()
  const motivosSinMeta = new Map()
  let renglonesDescartados = 0

  for (const hoja of libro.worksheets) {
    const formato = detectarFormato(hoja)
    if (!formato) {
      hojasIgnoradas.push(hoja.name.trim())
      continue
    }
    if (hoja.rowCount > MAX_FILAS_POR_HOJA + formato.filaEncabezados) {
      throw new ErrorImportacionTareas(
        `La hoja "${hoja.name.trim()}" excede el maximo de ${MAX_FILAS_POR_HOJA} renglones.`
      )
    }
    const { columnas } = formato
    let renglones = 0
    for (let n = formato.filaEncabezados + 1; n <= hoja.rowCount; n++) {
      const valores = hoja.getRow(n).values
      const codigo = codigoDeCelda(valores[columnas.codigo]).toUpperCase()
      const celdaMeta = columnas.meta ? valores[columnas.meta] : null
      // Una celda de meta con FECHA no es una cantidad: se ignora como meta
      // (paso de verdad con el Excel de Lindbergh) pero NO tira el renglon.
      const metaCruda = pareceFecha(celdaMeta) ? null : numeroDeCelda(celdaMeta)
      const meta = metaCruda != null && metaCruda > 0 ? metaCruda : null
      const otFila = otDeFila(valores, columnas)
      // Fila realmente vacia (separadores en blanco del formato resurtido).
      if (!codigo && meta == null && !otFila) continue
      // Lo UNICO que invalida el renglon es no tener codigo: la meta se puede
      // resolver despues (del ruteo o a mano en la app).
      if (!codigo || codigo.length > 60) {
        renglonesDescartados += 1
        motivosDescarte.set(
          !codigo ? 'sin codigo (¿renglon de totales?)' : 'codigo demasiado largo',
          (motivosDescarte.get(!codigo ? 'sin codigo (¿renglon de totales?)' : 'codigo demasiado largo') || 0) + 1
        )
        continue
      }
      if (meta == null) {
        const razon = pareceFecha(celdaMeta)
          ? 'la columna de la cantidad trae una FECHA'
          : !columnas.meta
            ? 'el archivo no trae columna de cantidad'
            : 'la cantidad viene vacia o en cero'
        motivosSinMeta.set(razon, (motivosSinMeta.get(razon) || 0) + 1)
      }
      renglones += 1
      const fecha = columnas.fecha ? fechaDeCelda(valores[columnas.fecha]) : null
      const ot = formato.tipo === 'especial' ? otFila : null
      const detalle =
        formato.tipo === 'especial'
          ? [
              columnas.articulo ? textoDeCelda(valores[columnas.articulo]).trim() : '',
              columnas.color ? textoDeCelda(valores[columnas.color]).trim() : '',
              columnas.talla ? textoDeCelda(valores[columnas.talla]).trim() : ''
            ]
              .filter(Boolean)
              .join(' ')
          : ''

      if (!porCodigo.has(codigo)) {
        porCodigo.set(codigo, {
          codigo,
          metaDocenas: 0,
          tipos: new Set(),
          metaDelExcel: false,
          renglonesSinMeta: 0,
          ots: new Set(),
          renglonesSinOt: 0,
          fechas: new Set(),
          detalles: new Set(),
          renglones: 0
        })
      }
      const acumulado = porCodigo.get(codigo)
      if (meta != null) {
        acumulado.metaDocenas += meta
        acumulado.metaDelExcel = true
      } else {
        acumulado.renglonesSinMeta += 1
      }
      acumulado.tipos.add(formato.tipo)
      if (ot) acumulado.ots.add(ot)
      else if (formato.tipo === 'especial') acumulado.renglonesSinOt += 1
      const fechaTexto = fechaCorta(fecha)
      if (fechaTexto) acumulado.fechas.add(fechaTexto)
      if (detalle) acumulado.detalles.add(detalle)
      acumulado.renglones += 1
    }
    hojasLeidas.push({ nombre: hoja.name.trim(), tipo: formato.tipo, renglones })
  }

  if (hojasLeidas.length === 0) {
    throw new ErrorImportacionTareas(
      'Ninguna hoja del archivo trae el formato de tareas: se esperaba ' +
        '"fecha / CODIGO / DOCENAS FALTANTES" (resurtido) o ' +
        '"Codigo / NumPedido / SOLICITA" (especial).'
    )
  }
  // El formato se reconocio pero no habia NI UN codigo: eso si es un archivo
  // inservible (los renglones sin meta ya no cuentan como descarte).
  if (porCodigo.size === 0) {
    const detalle = [...motivosDescarte.entries()].map(([m, c]) => `${c} ${m}`).join(', ')
    throw new ErrorImportacionTareas(
      `El archivo se leyo bien pero no trae ningun codigo de producto valido${
        detalle ? ` (${detalle})` : ''
      }. Revisa que la columna "Codigo" tenga los codigos.`
    )
  }

  const tareas = [...porCodigo.values()].map((t) => {
    const otsVistas = [...t.ots].sort()
    // Las OTs solo ACOTAN el avance cuando TODA la meta del codigo viene del
    // formato especial con OT en cada renglon (y son pocas). Si el codigo
    // mezcla resurtido+especial, o algun renglon especial no trajo OT, la
    // restriccion dejaria meta imposible de cumplir: se cuenta por codigo
    // completo y las OTs quedan solo informativas en las notas.
    const metaCompleta = t.metaDelExcel && t.renglonesSinMeta === 0
    const acotaPorOt =
      t.tipos.size === 1 &&
      t.tipos.has('especial') &&
      t.renglonesSinOt === 0 &&
      otsVistas.length > 0 &&
      otsVistas.length <= 30
    return {
      codigo: t.codigo,
      // Redondeo a 2 decimales: las metas traen medios (841.5) y la suma de
      // flotantes puede arrastrar colas binarias.
      // La suma del Excel solo se da por buena si TODOS los renglones de ese
      // codigo trajeron cantidad; si alguno venia sin ella, la suma esta
      // incompleta y se trata como falta (se deriva o se teclea).
      metaDocenas: metaCompleta ? Math.round(t.metaDocenas * 100) / 100 : null,
      origenMeta: metaCompleta ? 'excel' : 'falta',
      metaParcialDelExcel: t.metaDelExcel && t.renglonesSinMeta > 0
        ? Math.round(t.metaDocenas * 100) / 100
        : null,
      tipo: [...t.tipos].sort().join('+'),
      ots: acotaPorOt ? otsVistas : [],
      otsInfo: otsVistas,
      // Si el codigo trae MAS de 30 OTs, 'ots' queda vacio (tope de las
      // reglas) y el avance contaria el codigo completo: hay que avisarlo en
      // vez de dejarlo pasar en silencio.
      demasiadasOts: otsVistas.length > 30,
      fechas: [...t.fechas],
      detalle: [...t.detalles].join(' / '),
      renglones: t.renglones
    }
  })

  // Diagnostico legible: por que se descarto lo que se descarto, de mayor a
  // menor. Sin esto, un archivo con la columna equivocada solo decia "N
  // renglones se descartaron" y nadie sabia que arreglar.
  const diagnostico = [...motivosDescarte.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, cuantos]) => ({ motivo, cuantos }))

  const sinMeta = [...motivosSinMeta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([razon, cuantos]) => ({ razon, cuantos }))

  return { tareas, hojasLeidas, hojasIgnoradas, renglonesDescartados, diagnostico, sinMeta }
}

/** Titulo y notas de la tarea que se creara (respetando los topes de las
 *  reglas: titulo <= 120, notas <= 300). */
export function tituloYNotas(t) {
  const otsTexto = (t.otsInfo || t.ots || []).join(', ')
  const base = t.detalle
    ? `${t.codigo} ${t.detalle}`
    : otsTexto
      ? `${t.codigo} (OT ${otsTexto})`
      : `Resurtido ${t.codigo}`
  const titulo = base.length > 120 ? base.slice(0, 117) + '...' : base
  const partes = [
    `Importada de Excel (${t.tipo})`,
    (t.otsInfo || t.ots).length > 0 ? `OT ${(t.otsInfo || t.ots).join(', ')}` : null,
    t.fechas.length > 0 ? `fecha ${t.fechas.join(', ')}` : null,
    t.renglones > 1 ? `${t.renglones} renglones combinados` : null
  ].filter(Boolean)
  let notas = partes.join(' · ')
  if (notas.length > 300) notas = notas.slice(0, 297) + '...'
  return { titulo, notas }
}
