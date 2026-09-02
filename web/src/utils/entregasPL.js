// EL PL (packing list): lo que SALE al cliente.
//
// Es el cuarto eslabon y el que cierra la cadena. Hasta hoy RAGNAR cubria
// tres: la bascula captura el bulto, `pdfsGenerados` documenta lo que sale a
// maquila y `recepcionesPT` registra lo que vuelve. Ahi moria la trazabilidad
// OC -> OT -> codigo -> folio. El PL es la salida al cliente.
//
// Modelado sobre los DOS PL reales de Valeria Montesinos (Logistica):
//   - `PL STYLOS02 OC16058 PO2449.xlsx` (Stylos, clave = UPC de 13 digitos)
//   - Royal County OC 11967 PO 2300 (clave = codigo alfanumerico WKD226T103)
// ⚠️ La CLAVE del cliente no tiene un solo formato: en un cliente es UPC
// numerico y en otro un codigo alfanumerico. Por eso es TEXTO libre y no se
// valida como numero. Cada renglon guarda ADEMAS `codigoQuini`: la clave es
// para el papel del cliente, el codigo es para nuestra trazabilidad — sin los
// dos, o el cliente no reconoce su PL o nosotros no podemos cruzarlo.
//
// UN PL, VARIAS ENTREGAS. El papel trae hasta seis bloques de entrega sobre
// los mismos renglones. Aqui cada entrega es un ACTA INMUTABLE aparte
// (`entregasPL`), del mismo estilo que `recepcionesPT`: se levanta, no se
// reescribe. El Excel se arma juntando las actas de esa OC.
//
// LO QUE LA APP PONE SOLA (y es el punto de todo esto):
//   - La **OT** de cada renglon, desde el plan maestro. En el PL de Valeria
//     esa columna viene VACIA en todos los renglones; llenarla es lo que
//     convierte un papel administrativo en trazabilidad hasta el cliente.
//   - Los **bultos** y las **piezas**, leidos del texto del EMPAQUE.
//
// LO QUE NO PONE, y va en blanco (no en cero) porque no es suyo: Ped. Micro,
// Rem. Micro, FACTURA y BITACORA salen de Microsip y del portal del cliente.
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { lineasDeOc, normalizarOc, versionActiva } from './planMaestro'
import { datosDeCodigos } from './datosDelCatalogo'

export class ErrorEntregaPL extends Error {}

const texto = (v, max) => String(v ?? '').trim().slice(0, max)
const entero = (v) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? n : 0
}

/**
 * Lee el texto del EMPAQUE tal como lo escribe Valeria: `2/200 1/58` son dos
 * bultos de 200 y uno de 58.
 *
 * Verificado contra el PL de Stylos: `2/200 1/58` -> 3 bultos y 458 packs, que
 * es exactamente lo que dice ese renglon en las columnas BULTO y PAQS.
 *
 * ⚠️ TODO O NADA. Si CUALQUIER pedazo del texto no se entiende, se devuelve
 * cero y `reconocido: false` — nada de lecturas parciales. Con "2/200 basura",
 * si la basura era en realidad "1/58", una lectura parcial guardaria 400 packs
 * perdiendo 58 EN SILENCIO... y este numero se factura. Es mejor obligar a
 * corregir el texto (o capturar a mano) que adivinar una cifra de dinero.
 */
export function leerEmpaque(txt) {
  const limpio = String(txt ?? '').trim()
  if (!limpio) return { bultos: 0, piezas: 0, reconocido: false }
  const partes = limpio.split(/[\s,;+]+/).filter(Boolean)
  let bultos = 0
  let piezas = 0
  for (const p of partes) {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(p)
    if (!m) return { bultos: 0, piezas: 0, reconocido: false }
    bultos += Number(m[1])
    piezas += Number(m[1]) * Number(m[2])
  }
  return { bultos, piezas, reconocido: bultos > 0 }
}

/** Pares por pack a partir del nombre del articulo: "3 PACK TIN..." o
 *  "6PACK ...". Sale del nombre en 27 de 27 renglones de los PL reales, con
 *  espacio o sin el. null si no lo dice: no se supone. */
export function paresPorPack(articulo) {
  const m = /(\d+)\s*PACK/i.exec(String(articulo || ''))
  return m ? Number(m[1]) : null
}

/** Packs que hacen una docena (12 pares). Es la conversion que le faltaba a
 *  RAGNAR: la app cuenta en DOCENAS de punta a punta y el PL en PACKS.
 *  null cuando no se sabe el tamano del pack — y entonces NO se convierte. */
export function packsPorDocena(articulo) {
  const pares = paresPorPack(articulo)
  return pares && pares > 0 ? 12 / pares : null
}

/**
 * Los renglones de una orden de compra, listos para capturar la entrega.
 *
 * Salen del PLAN MAESTRO (planMaestroLineas), que es donde vive la relacion
 * OC -> OT -> codigo. De ahi sale sola la columna OT que en el papel va vacia.
 *
 * Cada renglon trae, ademas del plan en docenas, `packsPlan`: el plan YA
 * CONVERTIDO a packs cuando se sabe el tamano del pack ("3PACK", "6 PACK"), y
 * null cuando no se sabe. El plan de Adrian esta en DOCENAS y la entrega se
 * captura en PACKS: comparar esos dos numeros sin convertir daria un
 * porcentaje sin sentido, y con null la pantalla dice la verdad ("no se
 * cuantos packs son estas docenas") en vez de inventarlo.
 *
 * ⚠️ LA DESCRIPCION SALE DEL CATALOGO, no del plan. Medido contra produccion
 * el 2026-09-02: de 370 lineas del plan vigente, CERO traen descripcion (la
 * columna es opcional en el archivo de Adrian). Sin esto el articulo salia
 * vacio en pantalla y el tamano del pack no se podia deducir NUNCA, asi que
 * el cierre siempre diria "sin convertir". El catalogo si tiene descripcion y
 * modelo por codigo, y es el mismo que usa la captura.
 */
export async function renglonesDeLaOc(oc) {
  const version = await versionActiva()
  if (!version) {
    throw new ErrorEntregaPL(
      'No hay un plan maestro cargado, y de ahi salen las OT. Pidele a Adrian que lo suba.'
    )
  }
  const lineas = await lineasDeOc(version, oc)
  if (!lineas.length) {
    throw new ErrorEntregaPL(
      `La orden ${oc} no esta en el plan maestro vigente.\n\n` +
        'OJO: aqui va el numero de PO# de tu PL (por ejemplo 2449), NO el OC# ' +
        '(16058) — el plan de Adrian usa el PO#. Si ya pusiste el PO# y sigue ' +
        'sin aparecer, es que esa orden no esta en el plan y hay que pedirlo ' +
        'actualizado.'
    )
  }
  // Un codigo puede venir en varias OT de la misma OC: se junta por codigo y
  // se conservan TODAS sus OT, porque el papel lleva una columna OT por
  // renglon y hay que poder decir de cual es.
  const porCodigo = new Map()
  for (const l of lineas) {
    const codigo = texto(l.codigo, 60)
    if (!codigo) continue
    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigo,
        descripcion: texto(l.descripcion, 200),
        ots: new Set(),
        cantidadPlan: 0
      })
    }
    const r = porCodigo.get(codigo)
    if (l.ot) r.ots.add(texto(l.ot, 40))
    // ⚠️ El campo se llama cantidadPlaneada (importarPlanMaestro.js), no
    // 'cantidad'. Con el nombre equivocado esto sumaba 0 siempre y el cierre
    // decia "sin plan" para TODAS las ordenes — lo cazo la revision.
    r.cantidadPlan += Number(l.cantidadPlaneada) || 0
  }
  // El catalogo completa lo que el plan no trae. NUNCA lanza: si falla, se
  // sigue con lo que haya (el articulo se puede teclear; el cierre dira que no
  // sabe convertir, que es la verdad).
  const delCatalogo = await datosDeCodigos([...porCodigo.keys()])

  return [...porCodigo.values()]
    .map((r) => {
      const cat = delCatalogo.get(r.codigo) || {}
      // La descripcion del plan manda si existe; si no, la del catalogo.
      const descripcion = r.descripcion || cat.descripcion || ''
      // Para el tamano del pack se miran las dos: el modelo del catalogo
      // tambien suele traerlo ("SFT106 3PACK...").
      const factor = packsPorDocena(descripcion) ?? packsPorDocena(cat.modelo)
      return {
        ...r,
        descripcion,
        modelo: cat.modelo || '',
        ots: [...r.ots].sort(),
        ot: [...r.ots].sort().join(' / '),
        packsPlan:
          factor != null && r.cantidadPlan > 0 ? Math.round(r.cantidadPlan * factor) : null
      }
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/** El ID del acta: OC + numero de entrega (+ el corral de prueba). Es el
 *  candado contra registrar dos veces la misma entrega: el segundo intento
 *  cae sobre un documento que ya existe, y como `update` esta prohibido, el
 *  servidor lo rechaza aunque el cliente tenga un bug. */
export function idDeEntrega(oc, numeroEntrega, esPrueba) {
  return normalizarOc(oc) + '__' + numeroEntrega + (esPrueba ? '__prueba' : '')
}

/**
 * Registra UNA entrega del PL. Acta inmutable, como la recepcion.
 *
 * `renglones` viene de la pantalla: { clave, codigoQuini, articulo, unidad,
 * precio, empaque, bultos, packs, piezas, ot }.
 */
export async function registrarEntregaPL({ encabezado, renglones, usuario, esPrueba }) {
  if (!usuario?.uid || !usuario?.nombre) {
    throw new ErrorEntregaPL('Tu cuenta no tiene nombre configurado.')
  }
  const oc = texto(encabezado?.oc, 40)
  if (!oc) throw new ErrorEntregaPL('Falta la orden de compra.')
  const numeroEntrega = entero(encabezado?.numeroEntrega)
  if (numeroEntrega < 1 || numeroEntrega > 6) {
    throw new ErrorEntregaPL('El numero de entrega va del 1 al 6.')
  }

  const utiles = (renglones || [])
    .map((r) => {
      const packs = entero(r.packs)
      const precio = Number(r.precio) || 0
      const lectura = leerEmpaque(r.empaque)
      return {
        clave: texto(r.clave, 60),
        codigoQuini: texto(r.codigoQuini, 60),
        articulo: texto(r.articulo, 200),
        // La OT la puso la app desde el plan maestro; se CONGELA en el acta.
        ot: texto(r.ot, 60),
        unidad: texto(r.unidad, 20) || 'PZA',
        precio,
        empaque: texto(r.empaque, 60),
        // Queda escrito si el texto del empaque se ENTENDIO o no: el que
        // revise el acta despues tiene derecho a saber que numeros salieron
        // del texto y cuales se teclearon.
        empaqueReconocido: lectura.reconocido,
        // Lo tecleado manda; la lectura del empaque solo llena el hueco
        // cuando SI se entendio. De un texto no reconocido no se toma nada.
        bultos:
          r.bultos === '' || r.bultos == null
            ? lectura.reconocido
              ? lectura.bultos
              : 0
            : entero(r.bultos),
        packs,
        // En los dos PL reales PAQS == PZAS sin una sola excepcion (50 de 50):
        // para el cliente la "pieza" ES el pack. Se guardan las dos por si
        // algun cliente las separa, pero por defecto van iguales.
        piezas: r.piezas === '' || r.piezas == null ? packs : entero(r.piezas),
        importe: Math.round(packs * precio * 100) / 100
      }
    })
    .filter((r) => r.clave && (r.packs > 0 || r.bultos > 0))

  if (!utiles.length) {
    throw new ErrorEntregaPL('Captura al menos un renglon con packs o bultos.')
  }

  // setDoc sobre un ID determinista: si esa entrega ya existe, el servidor lo
  // trata como update y lo niega. El mensaje se lo damos nosotros, porque el
  // 'permission-denied' del SDK no le dice a nadie que el problema es que ya
  // esta registrada.
  try {
    await setDoc(doc(db, 'entregasPL', idDeEntrega(oc, numeroEntrega, esPrueba === true)), {
      oc: normalizarOc(oc),
      po: texto(encabezado?.po, 40),
      pl: texto(encabezado?.pl, 40),
      subcliente: texto(encabezado?.subcliente, 120),
      numeroEntrega,
      // De Microsip y del portal del cliente: van VACIOS si ella no los tiene,
      // y en blanco es la respuesta correcta. Un cero aqui seria una factura
      // que no existe.
      factura: texto(encabezado?.factura, 40),
      bitacora: texto(encabezado?.bitacora, 40),
      pedidoMicrosip: texto(encabezado?.pedidoMicrosip, 40),
      remisionMicrosip: texto(encabezado?.remisionMicrosip, 40),
      fechaEntregaTexto: texto(encabezado?.fechaEntregaTexto, 40),
      renglones: utiles,
      totalBultos: utiles.reduce((a, r) => a + r.bultos, 0),
      totalPacks: utiles.reduce((a, r) => a + r.packs, 0),
      totalPiezas: utiles.reduce((a, r) => a + r.piezas, 0),
      totalImporte: Math.round(utiles.reduce((a, r) => a + r.importe, 0) * 100) / 100,
      nota: texto(encabezado?.nota, 300),
      creadoEn: serverTimestamp(),
      creadoPorUid: usuario.uid,
      creadoPorNombre: texto(usuario.nombre, 120),
      esPrueba: esPrueba === true
    })
  } catch (err) {
    if (err?.code === 'permission-denied') {
      throw new ErrorEntregaPL(
        `La entrega ${numeroEntrega} de la orden ${oc} ya esta registrada (o tu cuenta no ` +
          'puede registrar entregas). Si es OTRA entrega, cambia el numero.'
      )
    }
    throw err
  }
}

/** Las entregas del mundo que toca, de la mas nueva a la mas vieja. */
export function escucharEntregasPL(esPrueba, alRecibir, alFallar) {
  const q = query(
    collection(db, 'entregasPL'),
    where('esPrueba', '==', esPrueba === true),
    orderBy('creadoEn', 'desc')
  )
  return onSnapshot(
    q,
    (snap) => alRecibir(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[entregasPL] Error escuchando:', err)
      if (alFallar) alFallar(err)
    }
  )
}

/**
 * Junta las entregas de una OC en la forma del papel: un renglon por clave y
 * las entregas como columnas.
 *
 * Es lo que hace que el Excel se genere solo: el PL no es un documento que se
 * llena, es la SUMA de las actas que ya se levantaron.
 */
export function armarPlDeLaOc(entregas) {
  const porClave = new Map()
  const numeros = [...new Set(entregas.map((e) => e.numeroEntrega))].sort((a, b) => a - b)
  for (const e of entregas) {
    for (const r of e.renglones || []) {
      if (!porClave.has(r.clave)) {
        porClave.set(r.clave, {
          clave: r.clave,
          // Actas de antes del campo codigoQuini: la clave ERA el codigo.
          codigoQuini: r.codigoQuini || r.clave,
          articulo: r.articulo,
          ot: r.ot,
          unidad: r.unidad,
          precio: r.precio,
          porEntrega: {},
          packsTotal: 0,
          piezasTotal: 0,
          importeTotal: 0
        })
      }
      const f = porClave.get(r.clave)
      // La OT puede haber quedado vacia en una entrega vieja y resuelta en una
      // nueva: se conserva la que exista.
      if (!f.ot && r.ot) f.ot = r.ot
      f.porEntrega[e.numeroEntrega] = {
        empaque: r.empaque,
        bultos: r.bultos,
        packs: r.packs,
        piezas: r.piezas,
        importe: r.importe
      }
      f.packsTotal += r.packs
      f.piezasTotal += r.piezas
      f.importeTotal = Math.round((f.importeTotal + r.importe) * 100) / 100
    }
  }
  return { numeros, renglones: [...porClave.values()].sort((a, b) => a.clave.localeCompare(b.clave)) }
}

/**
 * El cierre del papel: solicitadas, entregadas, pendientes, excedidas y %.
 *
 * `packsPlan` viene YA CONVERTIDO a packs (ver renglonesDeLaOc). Tres casos y
 * los tres se dicen distinto, porque son verdades distintas:
 *   null  -> no se sabe convertir las docenas del plan ('sinEquivalencia')
 *   0     -> el plan no pide nada de este codigo (porcentaje null, 'sin plan')
 *   > 0   -> se compara de verdad
 */
export function cierreDelRenglon(packsPlan, entregadas) {
  const dadas = Number(entregadas) || 0
  if (packsPlan == null) {
    return { pedidas: null, dadas, pendientes: null, excedidas: null, porcentaje: null, sinEquivalencia: true }
  }
  const pedidas = Number(packsPlan) || 0
  return {
    pedidas,
    dadas,
    pendientes: Math.max(0, pedidas - dadas),
    excedidas: Math.max(0, dadas - pedidas),
    // Sin cantidad pedida no hay porcentaje: null, no 0. Un 0% diria que no se
    // ha entregado nada, y lo cierto es que no hay contra que comparar.
    porcentaje: pedidas > 0 ? dadas / pedidas : null,
    sinEquivalencia: false
  }
}
