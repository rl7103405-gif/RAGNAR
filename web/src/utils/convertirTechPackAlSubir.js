// TODO TECH PACK QUE ENTRA A LA BIBLIOTECA ENTRA EN LA PLANTILLA TP-QUINI v2.
//
// Roberto, 2026-09-17: "estos tech packs se tienen que pasar al formato
// automáticamente cuando se sube el Excel... aquí todavía aparece la OT, la
// OC; no deberíamos tener nada de eso en los tech packs. Es muy importante."
//
// Lo que entra puede ser tres cosas, y cada una tiene su camino:
//   - la plantilla v2 tal cual        -> se verifica y pasa sin tocarla
//   - la plantilla v1 (con pedido)    -> convertirLibroAV2, lo del pedido queda
//                                        oculto en _RAGNAR
//   - el formato viejo de Lety        -> extraerTechPackViejo + el generador,
//                                        igual que la migracion de los 120
//   - cualquier otro Excel            -> se RECHAZA con mensaje; no se sube
//
// Politica fijada con Codex (17-sep, dos rondas):
//   1. Si la conversion falla, NO se publica el formato viejo: se rechaza la
//      subida y el archivo vigente no se toca. Publicar lo que se quiere
//      eliminar "por si acaso" era contradecir el requisito.
//   2. Una plantilla DANADA (faltan hojas o nombres definidos) se rechaza
//      tambien: todas salen del generador, asi que danada quiere decir que
//      alguien le borro algo a mano.
//   3. Un USA por pack ADIVINADO del texto de CANTIDAD (confianza baja) no se
//      escribe como dato: se deja vacio, la calificacion lo marca y Lety lo
//      captura en Editar. Una cantidad del pedido leida como consumo por
//      pack multiplicaria los avios que se piden a la maquila.
//   4. El original NO se guarda en RAGNAR (decision pendiente de Roberto: ver
//      bitacora 2026-09-17). Su huella, nombre y tamano quedan en
//      _RAGNAR.migradoDe, y el aviso le pide al usuario conservar su archivo.
//
// Funcion pura sobre la clase Workbook de ExcelJS: sirve en el navegador
// (cargarWorkbook) y en Node (para probarla con archivos reales).
import { esPlantilla, leerPlantilla, medirPlantilla } from './leerPlantillaTechPack.js'
import { convertirLibroAV2 } from './convertirPlantillaV2.js'
import { extraerTechPackViejo } from './migrarTechPackViejo.js'
import { generarPlantillaTechPack } from './generarPlantillaTechPack.js'
import { nombreDeArchivo } from './plantillaTechPack.js'

export class ErrorConversion extends Error {}

// Lo del pedido (OC, OT, cantidades) NO es un faltante del tech pack v2: es
// historia. No se le pide al usuario que lo "corrija" (Codex, 17-sep).
const DEL_PEDIDO = /orden de compra|\bOC\b|\bOT\b|cantidad del pedido|packs del pedido|docenas (del pedido|por codigo)|\bpedido\b/i

const soloDelTechPack = (lista) => (lista || []).filter((t) => !DEL_PEDIDO.test(String(t)))

/**
 * @param {object} p
 * @param {ArrayBuffer|Uint8Array} p.contenido   el Excel tal como lo eligio el usuario
 * @param {string}  p.codigo          el codigo con el que se guarda (ya normalizado)
 * @param {string}  p.nombre          nombre del archivo original
 * @param {string}  p.sha256Original  huella del original (para _RAGNAR.migradoDe)
 * @param {string}  p.usuarioNombre
 * @param {Function} p.Workbook       clase Workbook de ExcelJS ya cargada
 * @param {string}  [p.logoBase64]
 * @returns {Promise<{contenido: Uint8Array, nombre: string, como: 'v2'|'v1'|'viejo', lectura: object, medicion: object, hojas: number, reporte: null|{conflictos: string[], faltantes: string[], fotosSaltadas: number, usaPorConfirmar: number, sobrantes: number}}>}
 * @throws {ErrorConversion} con un mensaje para la pantalla
 */
export async function pasarAlFormatoTPQuini({ contenido, codigo, nombre, sha256Original, usuarioNombre, Workbook, logoBase64 = null }) {
  const libro = new Workbook()
  try {
    await libro.xlsx.load(contenido)
  } catch (err) {
    throw new ErrorConversion(`No se pudo abrir "${nombre}" como Excel: ${err?.message || err}`)
  }

  // ---------------------------------------------------------- ya es plantilla
  if (esPlantilla(libro)) {
    const lectura = leerPlantilla(libro)
    if ((lectura.faltaEstructura || []).length) {
      throw new ErrorConversion(
        `La plantilla de "${nombre}" esta danada: falta ${lectura.faltaEstructura.slice(0, 4).join(', ')}. ` +
          'Vuelve a generarla desde RAGNAR (Editar o "Generar plantilla") en vez de borrarle hojas o nombres a mano.'
      )
    }
    if (lectura.version >= 2) {
      const medicion = medirPlantilla(lectura)
      return { contenido: aBytes(contenido), nombre, como: 'v2', lectura, medicion, hojas: libro.worksheets.length, reporte: null }
    }
    // v1: lo del pedido se esconde en _RAGNAR y se limpia la vista.
    let cambios
    try {
      cambios = convertirLibroAV2(libro)
    } catch (err) {
      throw new ErrorConversion(`No se pudo actualizar "${nombre}" de la plantilla v1 a v2: ${err?.message || err}`)
    }
    const salida = await verificar(await libro.xlsx.writeBuffer(), Workbook, nombre)
    return {
      contenido: salida.bytes,
      nombre,
      como: 'v1',
      lectura: salida.lectura,
      medicion: medirPlantilla(salida.lectura),
      hojas: salida.hojas,
      reporte: { conflictos: cambios?.cambios || [], faltantes: [], fotosSaltadas: 0, usaPorConfirmar: 0, sobrantes: 0 }
    }
  }

  // ------------------------------------------------------------ formato viejo
  let extraido
  try {
    extraido = extraerTechPackViejo(libro, { codigo })
  } catch (err) {
    throw new ErrorConversion(`No se pudo leer "${nombre}" como tech pack: ${err?.message || err}`)
  }
  const { datos, reporte } = extraido
  // Puerta minima de reconocimiento: el extractor "encuentra" algo en
  // cualquier Excel (Codex lo probo con una hoja de ventas). Un tech pack
  // trae CLIENTE y MODELO en su bloque de encabezado; sin eso, no es uno.
  const trae = (n) => reporte.campos?.[n]?.valor != null && String(reporte.campos[n].valor).trim() !== ''
  const hojaInfo = (reporte.conteo?.hojas || []).some((h) => /\((informacion|codigos|etiquetas)\)$/.test(h))
  if (!trae('TP_CLIENTE') || !trae('TP_MODELO') || !hojaInfo) {
    // Una plantilla a la que le borraron la hoja _RAGNAR entera deja de
    // reconocerse como plantilla y cae aqui: se dice, para que nadie persiga
    // un fantasma (code-reviewer, 17-sep).
    const pareciaPlantilla = libro.worksheets.some((h) => /^1 PEDIDO$/i.test(h.name))
    throw new ErrorConversion(
      pareciaPlantilla
        ? `"${nombre}" parece una plantilla TP-Quini a la que le falta la hoja oculta _RAGNAR: no se puede leer. Vuelve a generarla desde RAGNAR (Editar o "Generar plantilla").`
        : `"${nombre}" no se reconoce como tech pack: no trae el bloque de CLIENTE y MODELO ni las hojas de pedido, codigos o etiquetas. ` +
          'Si es un tech pack, armalo en la plantilla TP-Quini (boton "Generar plantilla") y subelo asi.'
    )
  }

  // Contencion: un USA adivinado no es un dato. Se deja vacio con el texto
  // original al lado (comoSeUsa) para que Lety lo capture con el archivo enfrente.
  let usaPorConfirmar = 0
  const avios = (datos.avios || []).map((a) => {
    if (a.confianza === 'baja' && a.usa != null) { usaPorConfirmar++; return { ...a, usa: null } }
    return a
  })
  // El extractor ya avisa 'USA sacado del texto de CANTIDAD': aqui se reemplaza
  // por la instruccion concreta (capturarlo), para no decirlo dos veces.
  const conflictos = soloDelTechPack(reporte.conflictos).filter((t) => !/USA sacado del texto/i.test(t))
  if (usaPorConfirmar) conflictos.push(`${usaPorConfirmar} avio(s) traian la cantidad como texto: captura su USA por pack en Editar`)
  if ((reporte.conteo?.codigosInternos || 0) !== (reporte.conteo?.microsip || 0)) {
    conflictos.push(`${reporte.conteo.codigosInternos} codigo(s) interno(s) contra ${reporte.conteo.microsip} clave(s) Microsip: revisa que cada codigo tenga la clave que le toca`)
  }
  const traiaPedido = datos.oc || datos.packs || (datos.renglones || []).some((r) => r.ot || r.docenas)

  let libroNuevo
  try {
    libroNuevo = generarPlantillaTechPack({
      Workbook,
      logoBase64,
      datos: {
        ...datos,
        // El formato viejo no trae ruta ni fecha en el sitio que la plantilla
        // espera: sin sinRellenos, generarPlantillaTechPack los inventaba
        // (los 7 procesos por default, "hoy") y la calificacion los daba por
        // buenos (Codex, 17-sep).
        sinRellenos: true,
        avios,
        // OC, OT, packs y docenas no van a la vista: quedan ocultos en _RAGNAR.
        pedidoAnterior: traiaPedido
          ? { oc: datos.oc || '', packs: datos.packs ?? null, renglones: (datos.renglones || []).map((r) => ({ codigo: r.codigo || '', talla: r.talla || '', ot: r.ot || '', docenas: r.docenas ?? null })) }
          : null,
        generadoPorNombre: `${usuarioNombre} (convertido al subir)`,
        migradoDe: { archivo: nombre, sha256: sha256Original, tamano: aBytes(contenido).length, en: new Date().toISOString() },
        reporteMigracion: { campos: reporte.campos, conflictos, faltantes: reporte.faltantes, conteo: reporte.conteo }
      }
    })
  } catch (err) {
    throw new ErrorConversion(`No se pudo armar la plantilla a partir de "${nombre}": ${err?.message || err}`)
  }
  const salida = await verificar(await libroNuevo.xlsx.writeBuffer(), Workbook, nombre)
  const modelo = String(datos.modelo || codigo)
  return {
    contenido: salida.bytes,
    nombre: nombreDeArchivo(modelo),
    como: 'viejo',
    lectura: salida.lectura,
    medicion: medirPlantilla(salida.lectura),
    hojas: salida.hojas,
    reporte: {
      conflictos,
      faltantes: soloDelTechPack(reporte.faltantes),
      fotosSaltadas: reporte.conteo?.fotosSaltadas || 0,
      usaPorConfirmar,
      sobrantes: reporte.sobrantes || 0
    }
  }
}

// Se reabre lo que se acaba de escribir: si no se puede leer como plantilla
// sana, no se sube nada (Codex, 17-sep: "valida writeBuffer y vuelve a abrir").
async function verificar(buffer, Workbook, nombre) {
  const bytes = aBytes(buffer)
  const libro = new Workbook()
  try {
    await libro.xlsx.load(bytes)
  } catch (err) {
    throw new ErrorConversion(`El archivo convertido de "${nombre}" no se pudo volver a abrir: ${err?.message || err}`)
  }
  if (!esPlantilla(libro)) throw new ErrorConversion(`El archivo convertido de "${nombre}" no salio como plantilla TP-Quini.`)
  const lectura = leerPlantilla(libro)
  if ((lectura.faltaEstructura || []).length) {
    throw new ErrorConversion(`El archivo convertido de "${nombre}" salio incompleto (falta ${lectura.faltaEstructura.slice(0, 4).join(', ')}).`)
  }
  return { bytes, lectura, hojas: libro.worksheets.length }
}

const aBytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b))

/** El aviso para la pantalla, en una sola cadena, o '' si no hubo conversion. */
export function resumenDeConversion(r) {
  if (!r || r.como === 'v2') return ''
  if (r.como === 'v1') return ' Se actualizo de la plantilla v1 a la v2 (lo del pedido quedo guardado, fuera de la vista).'
  const partes = [`Se paso al formato TP-Quini: ${r.medicion?.porcentaje ?? 0}% completo.`]
  // Lo que falta sale de la MISMA medicion que pinta el porcentaje de al lado
  // (rubro por rubro), no del reporte del extractor: asi el aviso y la
  // calificacion de la bandeja dicen lo mismo.
  const faltan = Object.values(r.medicion?.detalle || {}).flat()
  if (faltan.length) partes.push(`Falta: ${faltan.slice(0, 6).join(', ')}${faltan.length > 6 ? '…' : ''}.`)
  const rev = r.reporte?.conflictos || []
  if (rev.length) partes.push(`Revisa: ${rev.slice(0, 4).join('; ')}${rev.length > 4 ? '…' : ''}.`)
  if (r.reporte?.fotosSaltadas) partes.push(`${r.reporte.fotosSaltadas} imagen(es) del original no se pudieron acomodar.`)
  partes.push('Conserva tu archivo original: RAGNAR guarda solo la version en la plantilla.')
  return ' ' + partes.join(' ')
}
