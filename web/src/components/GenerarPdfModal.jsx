// Modal de generacion del PDF de salida: quien lo genera elige la maquila
// (obligatoria, una sola) y puede capturar digitalmente los campos del
// encabezado que antes salian como N/A; lo que deje vacio queda EN BLANCO en
// el papel para llenarse a mano. Los folios ya vienen seleccionados desde la
// tabla; aqui se RELEEN de Firestore justo antes de generar para que el
// documento salga con los datos vigentes (no con una foto vieja de pantalla).
import { useEffect, useState } from 'react'
import { collection, doc, getDoc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { generarPdfSalida, descargarPdf } from '../utils/pdf'
import { generarExcelSalida, descargarArchivo } from '../utils/excelSalida'
import { armarSalidaPortal } from '../utils/portalMaquila'
import { leerUltimoFolioInterno, reservarFolioInterno } from '../utils/folioInterno'
import { compararAscendente, coincide } from '../utils/texto'

const MAX_FOLIOS_PDF = 200
// Maximos por campo (antes un unico MAX_CAMPO=120 para todos): con textos
// largos en varios campos a la vez se encimaban en el PDF (ver pdf.js, cajas
// de ancho fijo). Estos topes garantizan UNA sola linea con los maxWidth
// reales que usa pdf.js: la caja de folio/fechas (derecha) mide maxWidth 100
// a fuente 9; direccion/concepto miden maxWidth 110 a fuente 10;
// observaciones mide maxWidth 310 a fuente 9. Medido con jsPDF: mas
// caracteres que esto envuelve a 2-3 lineas y se encima con el texto de abajo.
// direccionEnvio ocupa ahora una LINEA COMPLETA del encabezado (~500pt a
// fuente 10): las direcciones reales de las maquilas no caben en la media
// columna original.
const MAX_POR_CAMPO = {
  direccionEnvio: 95,
  conceptoSalida: 20,
  observaciones: 60
}

function limpiarCampo(texto, maximo) {
  let limpio = ''
  for (const ch of String(texto || '')) {
    const cp = ch.codePointAt(0)
    limpio += cp < 32 || cp === 127 ? ' ' : ch
  }
  return limpio.replace(/\s+/g, ' ').trim().slice(0, maximo)
}

const LOTE_RELECTURA = 10

// Cuenta compartida original: no identifica a una persona, asi que con ella
// SI hay que preguntar quien genera el PDF. Los usuarios individuales
// (america, diana, lindbergh...) se toman de su propio perfil.
const USUARIO_COMPARTIDO = 'estacion'

export default function GenerarPdfModal({ folios, operador, onCerrar, onListo, onDepurar }) {
  const { authUser, perfil, esPrueba, modoDatos } = useAuth()
  const maquilas = useMaquilas()
  // El selector es SIMETRICO: la cuenta de prueba solo ve la maquila ficticia,
  // y al personal real no le aparece (asi nadie le manda una remision de
  // verdad por elegir mal en la lista). Las reglas exigen lo mismo.
  const activas = maquilas.filter((m) => m.activo && (m.esPrueba === true) === esPrueba)
  // Con un usuario individual el nombre sale de su perfil (no se pregunta);
  // solo la cuenta compartida 'estacion' tiene que teclearlo.
  const nombreDelPerfil =
    perfil?.empleadoId && perfil.empleadoId !== USUARIO_COMPARTIDO
      ? perfil.nombreCompleto || perfil.empleadoId
      : ''
  const [maquilaId, setMaquilaId] = useState('')
  const [filtroMaquila, setFiltroMaquila] = useState('')
  const maquilasFiltradas = filtroMaquila.trim()
    ? activas.filter((m) => coincide(m.nombre, filtroMaquila))
    : activas
  const maquilaElegida = activas.find((m) => m.id === maquilaId) || null
  const [generadoPor, setGeneradoPor] = useState('')
  const [campos, setCampos] = useState({
    conceptoSalida: '',
    observaciones: ''
  })
  // Folio interno: consecutivo. La app propone el siguiente; solo la primera
  // vez (cuando nunca se ha generado uno) hay que teclearlo para arrancar la
  // numeracion donde va el papel.
  const [ultimoFolioInterno, setUltimoFolioInterno] = useState(null)
  const [folioInternoManual, setFolioInternoManual] = useState('')
  const [cargandoFolio, setCargandoFolio] = useState(true)
  // true cuando la CONSULTA fallo: null en ultimoFolioInterno entonces NO
  // significa "primer PDF de la historia", significa "no sabemos".
  const [folioNoConsultado, setFolioNoConsultado] = useState(false)

  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)
  const [progresoRelectura, setProgresoRelectura] = useState(null) // { hechos, total } | null

  useEffect(() => {
    let cancelado = false
    // Sin perfil cargado no se sabe en que consecutivo mirar (el oficial o el
    // de pruebas): se espera. Leer el equivocado propondria un numero que la
    // reserva luego rechazaria, y el usuario no entenderia por que.
    if (!modoDatos) return undefined
    leerUltimoFolioInterno(modoDatos)
      .then((ultimo) => {
        if (cancelado) return
        setUltimoFolioInterno(ultimo)
        // El siguiente consecutivo se PRECARGA en el campo (no solo como
        // sugerencia): asi se ve de una vez cual va a llevar el papel, y
        // sigue siendo editable por si hay que corregirlo.
        if (ultimo !== null) setFolioInternoManual(String(ultimo + 1))
      })
      .catch((err) => {
        console.error('[GenerarPdfModal] No se pudo leer el folio interno:', err)
        if (!cancelado) {
          setFolioNoConsultado(true)
          setError(
            'No se pudo consultar el ultimo folio interno (¿conexion?). Puedes teclearlo a mano ' +
              'CON CUIDADO: si el numero ya se uso, el sistema lo rechaza al generar, pero uno de ' +
              'mas adelante brincaria la numeracion.'
          )
        }
      })
      .finally(() => {
        if (!cancelado) setCargandoFolio(false)
      })
    return () => {
      cancelado = true
    }
  }, [modoDatos])

  const setCampo = (k) => (e) => setCampos({ ...campos, [k]: e.target.value })

  const onGenerar = async () => {
    // Doble clic rapido antes de que el boton se deshabilite: sin este guard
    // saldrian DOS papeles (con folios consecutivos distintos) por una sola
    // intencion de captura.
    if (generando) return
    setError('')
    // Sin perfil cargado no se sabe en que consecutivo escribir. Emitir aqui
    // podria quemar un numero del papel oficial desde una cuenta de prueba.
    if (!modoDatos) {
      setError('Todavia se esta cargando tu perfil. Espera un segundo y vuelve a intentar.')
      return
    }
    const maquila = activas.find((m) => m.id === maquilaId)
    if (!maquila) {
      setError('Elige la maquila a la que va dirigida la salida.')
      return
    }
    // Una cuenta de prueba solo le emite a la maquila ficticia. Las reglas lo
    // rechazan igual, pero ahi el mensaje seria un permission-denied seco y
    // ya se habria quemado el folio interno de pruebas.
    if (esPrueba && maquila.esPrueba !== true) {
      setError(
        `"${maquila.nombre}" es una maquila real y esta es una cuenta de prueba. ` +
          'Elige la maquila de pruebas.'
      )
      return
    }
    // La direccion ya no se captura aqui: sale de la maquila. Si esa maquila
    // no la tiene registrada, el papel saldria con el renglon en blanco y
    // nadie se enteraria hasta que el bulto se fuera sin destino.
    if (!maquila.direccion) {
      setError(
        `La maquila "${maquila.nombre}" no tiene direccion registrada. ` +
          'Agregasela en Maquilas (menu de arriba) antes de generar el PDF.'
      )
      return
    }
    const nombreGenerador = limpiarCampo(nombreDelPerfil || generadoPor, 80)
    if (!nombreGenerador) {
      setError('Escribe el nombre de quien genera el PDF.')
      return
    }
    // Folio interno: si nunca se ha generado uno, hay que teclear el de
    // arranque; si ya hay historia, la app propone el siguiente y solo se
    // acepta un valor manual valido.
    let folioInternoForzado = null
    const manualLimpio = folioInternoManual.trim()
    if (manualLimpio) {
      if (!/^\d{1,9}$/.test(manualLimpio) || Number(manualLimpio) <= 0) {
        setError('El folio interno debe ser un numero mayor que cero (sin letras ni simbolos).')
        return
      }
      const numeroTecleado = Number(manualLimpio)
      // Aviso temprano con lo que el modal alcanzo a leer (el candado REAL
      // esta en la transaccion de reservarFolioInterno, contra el contador
      // vivo del servidor).
      if (ultimoFolioInterno !== null && numeroTecleado <= ultimoFolioInterno) {
        setError(
          `El folio interno ${numeroTecleado} ya se uso (el ultimo fue ${ultimoFolioInterno}). ` +
            `Usa ${ultimoFolioInterno + 1} o uno mayor para no repetir folio en dos papeles.`
        )
        return
      }
      // El numero PRECARGADO (el consecutivo propuesto) NO se manda como
      // forzado: se deja que la transaccion asigne "el que siga" en el
      // momento real. Asi, si alguien mas genero mientras este modal estaba
      // abierto, salen 76 y 77 en vez de dos 76. Solo un numero que el
      // usuario CAMBIO a proposito viaja como forzado (para brincar la
      // numeracion hacia adelante).
      const esElPropuesto =
        ultimoFolioInterno !== null && numeroTecleado === ultimoFolioInterno + 1
      folioInternoForzado = esElPropuesto ? null : numeroTecleado
    } else if (ultimoFolioInterno === null) {
      setError(
        'Es el primer PDF: escribe el folio interno con el que arranca la numeracion. ' +
          'De ahi en adelante la app lo va poniendo sola.'
      )
      return
    }
    if (folios.length === 0) {
      setError('No hay folios seleccionados.')
      return
    }
    if (folios.length > MAX_FOLIOS_PDF) {
      setError(`Maximo ${MAX_FOLIOS_PDF} folios por PDF (seleccionaste ${folios.length}).`)
      return
    }
    // Una remision de prueba solo lleva folios de prueba. Las reglas no pueden
    // recorrer la lista (no saben mirar dentro de un array), asi que este es
    // el unico punto donde se puede exigir: sin esto, un PDF de prueba podria
    // llevar impresos los datos de bultos reales -- no los danaria (el marcado
    // "ya salio en PDF" se rechaza folio por folio), pero el papel mentiria.
    // Se comprueba ANTES de reservar el consecutivo: descubrirlo despues
    // quemaria un numero para nada.
    if (esPrueba) {
      const ajenos = folios.filter((f) => !/^ZZTEST/i.test(String(f)))
      if (ajenos.length) {
        setError(
          `Esta es una cuenta de PRUEBA: la remision solo puede llevar folios ZZTEST. ` +
            `Quita ${ajenos.length === 1 ? 'el folio' : 'los folios'} ${ajenos.slice(0, 5).join(', ')}` +
            `${ajenos.length > 5 ? ` y ${ajenos.length - 5} mas` : ''}.`
        )
        return
      }
    }
    setGenerando(true)
    setProgresoRelectura({ hechos: 0, total: folios.length })
    try {
      // Releer cada folio: asi una edicion/eliminacion de ultimo segundo no
      // deja el PDF con datos viejos, y los folios tecleados de otros dias
      // tambien salen con su snapshot real. En lotes de LOTE_RELECTURA en
      // paralelo (no uno por uno) para que no tarde una eternidad con
      // muchos folios seleccionados.
      const frescos = []
      const inexistentes = []
      const versionesRelectura = new Map()
      for (let i = 0; i < folios.length; i += LOTE_RELECTURA) {
        const lote = folios.slice(i, i + LOTE_RELECTURA)
        const resultados = await Promise.all(
          lote.map(async (folio) => ({ folio, snap: await getDoc(doc(db, 'bultos', folio)) }))
        )
        for (const { folio, snap } of resultados) {
          if (!snap.exists()) {
            inexistentes.push(folio)
          } else {
            const c = snap.data()
            frescos.push({
              folio: c.folio,
              pesoGramos: c.pesoGramos,
              producto: c.producto || null,
              cruce: c.cruce || null,
              // Fecha de CAPTURA del bulto: la vista PEPS de Reportes ordena
              // por ella (los PDFs viejos sin este campo caen a la fecha del
              // documento).
              capturadoEn: c.creadoEn ?? null
            })
            // Version del documento al momento de la relectura: el marcado
            // posterior solo se aplica si el folio NO cambio en el inter
            // (ver marcarFoliosComoEnviados). No va dentro de 'frescos'
            // para no contaminar el snapshot congelado de la bitacora.
            versionesRelectura.set(c.folio, c.actualizadoEn?.toMillis() ?? null)
          }
        }
        setProgresoRelectura({ hechos: Math.min(i + LOTE_RELECTURA, folios.length), total: folios.length })
      }
      // El orden canonico del registro es ASCENDENTE por folio: 'frescos' venia
      // en el orden en que el operador palomeo, y ese orden se congelaba en la
      // bitacora (pdfsGenerados). Ordenado aqui, el dato guardado ya sale
      // canonico y cualquier consumidor futuro lo hereda sin reordenar.
      frescos.sort((a, b) => compararAscendente(a.folio, b.folio))

      if (inexistentes.length > 0) {
        // El padre (Estacion.jsx) los quita de la seleccion/agregadas para
        // que el operador pueda reintentar sin recargar la pagina.
        if (onDepurar) onDepurar(inexistentes)
        setError(
          `Estos folios ya no existen (¿eliminados?): ${[...inexistentes].sort(compararAscendente).join(', ')}; ` +
            'ya se quitaron de la seleccion; vuelve a intentar.'
        )
        return
      }
      // NOMBRE del PDF impreso = quien lo genera (el perfil del login
      // compartido no identifica a la persona real).
      // fechaTexto se calcula UNA sola vez y se usa tanto en el PDF como en
      // la bitacora: asi "Reimprimir original" (Historial.jsx) siempre
      // reproduce la misma fecha impresa en el papel original, sin depender
      // de creadoEn (que es la hora del registro en Firestore, no
      // necesariamente igual al texto que ya salio impreso).
      const fechaTexto = new Date().toLocaleDateString('es-MX')
      // Se reserva DENTRO de una transaccion: dos personas generando a la vez
      // no pueden quedarse con el mismo consecutivo.
      let folioInternoAsignado
      try {
        folioInternoAsignado = await reservarFolioInterno(modoDatos, folioInternoForzado)
      } catch (err) {
        if (err?.codigo === 'folio-repetido') {
          // El contador avanzo mientras este modal estaba abierto: se
          // refresca la propuesta y NO se genera nada (cero papeles, cero
          // numeros quemados).
          const ultimoReal = typeof err.ultimo === 'number' ? err.ultimo : null
          if (ultimoReal !== null) {
            setUltimoFolioInterno(ultimoReal)
            setFolioInternoManual(String(ultimoReal + 1))
            // El rechazo trae el valor REAL del servidor: ya se conoce el
            // ultimo aunque la consulta inicial hubiera fallado.
            setFolioNoConsultado(false)
          }
          setError(err.message + ' Ya se actualizo el campo: revisa y vuelve a picar Generar.')
          return
        }
        throw err
      }

      // El numero ya se quemo en el contador: se refresca la propuesta para
      // que el reintento no tropiece con 'folio-repetido'.
      const refrescarPropuesta = async () => {
        try {
          const ultimoReal = await leerUltimoFolioInterno(modoDatos)
          if (ultimoReal !== null) {
            setUltimoFolioInterno(ultimoReal)
            setFolioInternoManual(String(ultimoReal + 1))
            setFolioNoConsultado(false)
          }
        } catch {
          /* sin conexion: el candado del servidor protege igual */
        }
      }

      const encabezado = {
        folioInterno: String(folioInternoAsignado),
        // La orden de trabajo NO va aqui: el PDF separa una hoja por orden y
        // cada hoja imprime la suya (ver agruparPorOrden en pdf.js). La
        // fecha de solicitud es siempre el dia en que se genera.
        fechaSolicitud: fechaTexto,
        // 55 chars caben en una linea del maxWidth 300 del PDF; un nombre de
        // maquila mas largo envolveria y se encimaria con la linea de abajo.
        areaRecibe: limpiarCampo(maquila.nombre, 55),
        // La direccion sale DIRECTO de la maquila elegida (se registra al
        // darla de alta): ya no se muestra ni se captura aqui.
        direccionEnvio: limpiarCampo(maquila.direccion || '', MAX_POR_CAMPO.direccionEnvio),
        conceptoSalida: limpiarCampo(campos.conceptoSalida, MAX_POR_CAMPO.conceptoSalida),
        observaciones: limpiarCampo(campos.observaciones, MAX_POR_CAMPO.observaciones)
      }
      let blob
      let nombreArchivo
      try {
        ;({ blob, nombreArchivo } = generarPdfSalida({
          capturas: frescos,
          operador: nombreGenerador,
          fecha: fechaTexto,
          encabezado,
          esPrueba
        }))
      } catch (err) {
        // El consecutivo ya se consumio: hay que decirlo para que quede
        // anotado como salto en la numeracion del papel.
        console.error('[GenerarPdfModal] Error armando el PDF:', err)
        await refrescarPropuesta()
        setError(
          `El folio interno ${folioInternoAsignado} quedo reservado y NO se usara: anotalo como ` +
            `salto en la numeracion. No se pudieron armar los archivos: ${err.message || err}`
        )
        return
      }

      // Primero la bitacora, despues la descarga: un PDF descargado siempre
      // deja rastro en el historial. El contenido se CONGELA completo
      // (folio+peso+producto) para que "Reimprimir original" reproduzca
      // exactamente el papel emitido aunque las capturas cambien despues.
      // El folio interno es el consecutivo OFICIAL: un papel sin registro en
      // la bitacora no se puede reimprimir ni auditar. Por eso, si el
      // registro falla, NO se descarga el PDF: el numero queda como salto
      // anotado y no existe papel fisico huerfano.
      let registroId = null
      try {
        // La bitacora Y la copia para el portal de la maquila van en el MISMO
        // lote (todo-o-nada): nunca puede existir un papel emitido que la
        // maquila no vea, ni una remision en su portal sin registro interno.
        const refRegistro = doc(collection(db, 'pdfsGenerados'))
        const lote = writeBatch(db)
        lote.set(refRegistro, {
          generadoPor: nombreGenerador,
          maquila: { id: maquila.id, nombre: maquila.nombre },
          folios: frescos.map((c) => c.folio),
          totalFolios: frescos.length,
          pesoTotalGramos: frescos.reduce((acc, c) => acc + (c.pesoGramos || 0), 0),
          capturas: frescos,
          encabezado,
          fechaTexto,
          creadoEn: serverTimestamp(),
          operadorUid: authUser.uid,
          // La marca de prueba viaja EN EL REGISTRO y solo cuando lo emite una
          // cuenta de prueba (nunca como `esPrueba: false`): asi el papel se
          // sabe de prueba para siempre, aunque lo reimprima despues otra
          // persona, y el documento que emite un usuario real queda con los
          // mismos campos de siempre.
          ...(esPrueba ? { esPrueba: true } : {})
        })
        lote.set(
          doc(db, 'portalMaquila', maquila.id, 'salidas', refRegistro.id),
          {
            ...armarSalidaPortal({
              registroId: refRegistro.id,
              maquila,
              capturas: frescos,
              folioInterno: folioInternoAsignado,
              fechaTexto,
              emitidaPorNombre: nombreGenerador
            }),
            creadoEn: serverTimestamp()
          }
        )
        await lote.commit()
        registroId = refRegistro.id
      } catch (err) {
        console.error('[GenerarPdfModal] No se pudo registrar en el historial:', err)
        await refrescarPropuesta()
        setError(
          `No se pudo registrar en el historial (¿sin conexion?) y el PDF NO se descargo: ` +
            `asi no queda papel sin registro. El folio interno ${folioInternoAsignado} quedo ` +
            'reservado sin usarse: anotalo como salto. Revisa la conexion y vuelve a intentar.'
        )
        return
      }
      // Marcar cada folio como "ya enviado a PDF" ANTES de entregar la
      // descarga: si el marcado corriera despues, cerrar la pestana en
      // cuanto baja el archivo dejaria folios en "Pendientes" aunque su PDF
      // ya existe (paso en planta, 2026-08-10). Es un update PARCIAL (solo
      // pdfGeneradoEn/pdfFolioInterno, permitido por marcadoPdfValido en las
      // reglas). Se hace por transaccion en lotes: un folio que fue EDITADO o
      // ELIMINADO mientras el PDF se generaba NO se marca (su peso ya no
      // coincide con el papel emitido, debe seguir en pendientes). Si el
      // marcado falla, el PDF SI se descarga (ya quedo en la bitacora) pero
      // se avisa con claridad que folios quedaron como pendientes.
      let notaMarcado = ''
      try {
        const LOTE_TX = 100
        const foliosOmitidos = []
        for (let i = 0; i < frescos.length; i += LOTE_TX) {
          const lote = frescos.slice(i, i + LOTE_TX)
          const omitidosDelLote = await runTransaction(db, async (tx) => {
            // En una transaccion de Firestore TODAS las lecturas van antes
            // que las escrituras.
            const lecturas = []
            for (const c of lote) {
              const ref = doc(db, 'bultos', c.folio)
              lecturas.push({ folio: c.folio, ref, snap: await tx.get(ref) })
            }
            const saltados = []
            for (const { folio, ref, snap } of lecturas) {
              const versionRelectura = versionesRelectura.get(folio)
              const versionActual = snap.exists() ? (snap.data().actualizadoEn?.toMillis() ?? null) : null
              if (!snap.exists() || versionActual !== versionRelectura) {
                saltados.push(folio)
                continue
              }
              tx.update(ref, {
                pdfGeneradoEn: serverTimestamp(),
                pdfFolioInterno: folioInternoAsignado,
                // QUE registro de la bitacora marco este bulto: es lo que
                // permite, al corregir una remision, liberar solo SUS folios
                // y no los de otra.
                ...(registroId ? { pdfRegistroId: registroId } : {})
              })
            }
            return saltados
          })
          foliosOmitidos.push(...omitidosDelLote)
        }
        if (foliosOmitidos.length > 0) {
          // CON NOMBRE Y APELLIDO: estos folios YA van impresos en el PDF
          // recien generado pero se quedaron como pendientes porque alguien
          // los cambio en el inter. Sin la lista, el aviso no sirve: America
          // no sabria cuales revisar y el siguiente PDF los reimprimiria.
          notaMarcado =
            ` OJO: ${foliosOmitidos.length} folio(s) cambiaron mientras se generaba el PDF y quedaron ` +
            `en "Pendientes" AUNQUE YA VAN IMPRESOS en el PDF ${folioInternoAsignado}: ` +
            `${[...foliosOmitidos].sort(compararAscendente).join(', ')}. ` +
            'Revisalos con Roberto antes de volverlos a mandar en otro PDF.'
        }
      } catch (err) {
        console.error('[GenerarPdfModal] No se pudieron marcar los folios como enviados a PDF:', err)
        notaMarcado =
          ' AVISO IMPORTANTE: los folios NO se movieron a "Ya enviados a PDF" (fallo de conexion) ' +
          `y van a seguir viendose en Pendientes aunque su PDF ${folioInternoAsignado} ya existe: ` +
          `${frescos.map((c) => c.folio).join(', ')}. NO los vuelvas a mandar: ` +
          'avisale a Roberto para reconciliarlos.'
      }

      descargarPdf(blob, nombreArchivo)

      // El Excel de migracion va en su PROPIO try: si su modulo no carga
      // (p.ej. una pestana vieja pidiendo un chunk que ya cambio de nombre
      // tras un deploy), NO se tira un PDF que ya salio bien ni se quema el
      // folio interno -- el Excel se puede rehacer luego desde el historial.
      let notaExcel = ''
      try {
        const excel = await generarExcelSalida({ capturas: frescos, fecha: fechaTexto })
        descargarArchivo(excel.blob, excel.nombreArchivo)
      } catch (err) {
        console.error('[GenerarPdfModal] No se pudo generar el Excel de migracion:', err)
        notaExcel =
          ' AVISO: el Excel de migracion NO se genero; sacalo con "Reimprimir original" en Historial.'
      }

      onListo(
        `PDF con folio interno ${folioInternoAsignado} y Excel de migracion generados con ` +
          `${frescos.length} folios para "${maquila.nombre}" (genero: ${nombreGenerador}).${notaMarcado}${notaExcel}`
      )
    } catch (err) {
      console.error('[GenerarPdfModal] Error generando PDF:', err)
      setError('No se pudo generar el PDF: ' + (err.message || err))
    } finally {
      setGenerando(false)
      setProgresoRelectura(null)
    }
  }

  const campoTexto = (etiqueta, clave, placeholder = '') => (
    <label className="campo" key={clave}>
      <span>{etiqueta}</span>
      <input
        type="text"
        value={campos[clave]}
        maxLength={MAX_POR_CAMPO[clave]}
        placeholder={placeholder || 'Vacio = queda en blanco para llenar a mano'}
        onChange={setCampo(clave)}
      />
    </label>
  )

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
      }}
    >
      <div className="tarjeta" style={{ width: 'min(540px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>Generar PDF de salida ({folios.length} folios)</h2>

        {nombreDelPerfil ? (
          <p style={{ marginTop: 0 }}>
            Genera: <strong>{nombreDelPerfil}</strong>
          </p>
        ) : (
          <label className="campo">
            <span>Nombre de quien genera (obligatorio)</span>
            <input
              type="text"
              value={generadoPor}
              maxLength={80}
              placeholder="Ej. America"
              onChange={(e) => setGeneradoPor(e.target.value)}
            />
          </label>
        )}

        <label className="campo">
          <span>Maquila (obligatoria) — elige de la lista</span>
          {/* Buscador + lista: la maquila NUNCA se teclea a mano, siempre se
              elige de las registradas, para que el destino del papel no salga
              con un nombre inventado o mal escrito. El buscador es para
              cuando hay muchas dadas de alta. */}
          {activas.length > 1 && (
            <input
              type="text"
              placeholder={`Buscar entre las ${activas.length} maquilas registradas...`}
              value={filtroMaquila}
              onChange={(e) => setFiltroMaquila(e.target.value)}
              style={{ marginBottom: 6 }}
            />
          )}
          <select
            value={maquilaId}
            onChange={(e) => setMaquilaId(e.target.value)}
            size={maquilasFiltradas.length > 1 ? Math.min(maquilasFiltradas.length + 1, 8) : undefined}
          >
            <option value="">-- Elige la maquila --</option>
            {maquilasFiltradas.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </label>
        {activas.length === 0 && (
          <p style={{ fontSize: 13, color: '#a00' }}>
            No hay maquilas dadas de alta: usa la pestana &quot;Maquilas&quot; primero.
          </p>
        )}
        {activas.length > 0 && maquilasFiltradas.length === 0 && (
          <p style={{ fontSize: 13, color: '#a00' }}>
            Ninguna maquila registrada coincide con &quot;{filtroMaquila}&quot;. Borra el filtro o
            dala de alta en la pestana Maquilas.
          </p>
        )}
        {maquilaElegida?.direccion && (
          <p className="texto-suave" style={{ fontSize: 13, marginTop: -6 }}>
            Direccion que saldra en el papel: {maquilaElegida.direccion}
          </p>
        )}

        <label className="campo">
          <span>
            Folio Interno{' '}
            {cargandoFolio
              ? '(consultando...)'
              : folioNoConsultado
                ? '(no se pudo consultar el ultimo: escribelo con cuidado, si ya se uso se rechaza)'
                : ultimoFolioInterno === null
                  ? '(primer PDF: escribe con cual arranca la numeracion)'
                  : '(consecutivo, se puede cambiar)'}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={folioInternoManual}
            maxLength={9}
            placeholder={ultimoFolioInterno === null ? 'Ej. 1001' : ''}
            onChange={(e) => setFolioInternoManual(e.target.value)}
          />
        </label>
        {campoTexto('Concepto Salida', 'conceptoSalida')}
        {campoTexto('Observaciones', 'observaciones')}

        {error && <div className="alerta-error">{error}</div>}
        {progresoRelectura && (
          <p style={{ fontSize: 13, color: '#555' }}>
            Releyendo folios {progresoRelectura.hechos}/{progresoRelectura.total}...
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-primario" onClick={onGenerar} disabled={generando}>
            {generando ? 'Generando...' : 'Generar PDF'}
          </button>
          <button className="btn-secundario" onClick={onCerrar} disabled={generando}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
