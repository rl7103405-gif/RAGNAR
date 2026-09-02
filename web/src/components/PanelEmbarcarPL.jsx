// EMBARCA: Valeria registra una ENTREGA al cliente, y el PL sale de ahi.
//
// El PL (packing list) es un reporte de entregas que hoy no se capturan en
// ningun lado. Primero se registra la entrega contra una OC del plan maestro
// —como acta inmutable— y el Excel se arma juntando las actas de esa OC. Al
// reves seria un generador sin datos que llenar.
//
// Lo que la app pone SOLA y ella no teclea:
//   - la OT de cada renglon, desde el plan maestro (en el papel va vacia);
//   - los bultos y las piezas, leidos del texto del EMPAQUE ("2/200 1/58").
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  ErrorEntregaPL,
  armarPlDeLaOc,
  cierreDelRenglon,
  escucharEntregasPL,
  leerEmpaque,
  registrarEntregaPL,
  renglonesDeLaOc
} from '../utils/entregasPL'
import { normalizarOc } from '../utils/planMaestro'
import { generarExcelPL } from '../utils/excelPL'
import { generarPdfPL } from '../utils/pdfPL'
import { descargarPdf } from '../utils/pdf'
import { descargarArchivo } from '../utils/excelSalida'

export default function PanelEmbarcarPL() {
  const { authUser, perfil, esPrueba } = useAuth()

  const [oc, setOc] = useState('')
  const [enc, setEnc] = useState({ po: '', pl: '', subcliente: '', numeroEntrega: 1, factura: '', bitacora: '', fechaEntregaTexto: '', pedidoMicrosip: '', remisionMicrosip: '', nota: '' })
  const [renglones, setRenglones] = useState([]) // del plan maestro
  const [captura, setCaptura] = useState({}) // { codigo: { empaque, packs, precio } }
  const [entregas, setEntregas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  // El fallo al LEER las entregas ya registradas va aparte del error de la
  // pantalla: que no se puedan listar no impide capturar una entrega nueva,
  // y mezclarlos hacia que un aviso tapara al otro.
  const [avisoLectura, setAvisoLectura] = useState('')

  useEffect(() => {
    const unsub = escucharEntregasPL(
      esPrueba,
      (lista) => {
        setEntregas(lista)
        setAvisoLectura('')
      },
      (err) => {
        // Firestore pide un indice compuesto para filtrar por el corral de
        // prueba y ordenar por fecha. Recien desplegado tarda unos minutos en
        // construirse, y durante ese rato la consulta falla. El mensaje crudo
        // del SDK (con su URL de consola) no le dice nada a Valeria.
        const m = String(err?.message || err)
        setAvisoLectura(
          m.includes('currently building')
            ? 'La lista de entregas ya registradas todavia se esta preparando (tarda unos ' +
              'minutos la primera vez). Mientras, ya puedes traer una orden y capturar: se ' +
              'guarda igual.'
            : m.includes('requires an index')
            ? 'Falta preparar la lista de entregas ya registradas. Avisale a Roberto. ' +
              'Mientras, ya puedes traer una orden y capturar: se guarda igual.'
            : 'No se pudo leer la lista de entregas ya registradas: ' + m
        )
      }
    )
    return unsub
  }, [esPrueba])

  const buscarOc = async () => {
    setError('')
    setAviso('')
    const limpia = oc.trim()
    if (!limpia) {
      // Antes esto era un `return` mudo: se picaba el boton y no pasaba nada,
      // ni resultado ni error. Un boton que no contesta parece descompuesto.
      setError('Escribe el numero de la orden de compra y vuelve a picar "Traer del plan".')
      return
    }
    setCargando(true)
    try {
      const r = await renglonesDeLaOc(limpia)
      setRenglones(r)
      setAviso(`La orden ${limpia} tiene ${r.length} codigo(s) en el plan. Captura lo que va en esta entrega.`)
    } catch (err) {
      setRenglones([])
      setError(err instanceof ErrorEntregaPL ? err.message : 'No se pudo leer la orden: ' + (err.message || err))
    } finally {
      setCargando(false)
    }
  }

  const pon = (codigo, campo, valor) =>
    setCaptura((prev) => ({ ...prev, [codigo]: { ...(prev[codigo] || {}), [campo]: valor } }))

  // Lo entregado ANTES en esta OC, por codigo: para el cierre (pendientes /
  // excedidas) hay que sumar lo de las actas ya levantadas.
  const yaEntregado = useMemo(() => {
    const m = {}
    for (const e of entregas) {
      // La MISMA normalizacion con la que se guarda (quita espacios internos):
      // compararlo "a mano" hacia que una OC con espacio nunca cruzara con sus
      // propias actas y el cierre mostrara menos entregado de lo real.
      if (e.oc !== normalizarOc(oc)) continue
      // Se suma por el CODIGO DE QUINI, no por la clave del cliente: el plan
      // maestro habla en codigos, y el cierre se compara contra el plan. Las
      // actas viejas no traian codigoQuini: ahi la clave ERA el codigo.
      for (const r of e.renglones || []) {
        const k = r.codigoQuini || r.clave
        m[k] = (m[k] || 0) + (r.packs || 0)
      }
    }
    return m
  }, [entregas, oc])

  const filas = useMemo(
    () =>
      renglones.map((r) => {
        const c = captura[r.codigo] || {}
        const empaque = c.empaque ?? ''
        const lectura = leerEmpaque(empaque)
        // La lectura del empaque solo llena el hueco cuando el texto SI se
        // entendio; si no, mandan los campos tecleados. De un texto a medias
        // no se toma nada — se factura con esto.
        const packs =
          c.packs === '' || c.packs == null
            ? lectura.reconocido
              ? lectura.piezas
              : 0
            : Math.trunc(Number(c.packs)) || 0
        const bultos =
          c.bultos === '' || c.bultos == null
            ? lectura.reconocido
              ? lectura.bultos
              : 0
            : Math.trunc(Number(c.bultos)) || 0
        // La CLAVE que imprime el papel es la del cliente (UPC en Stylos,
        // WKD... en Royal County). Por defecto va el codigo interno, pero
        // Valeria la corrige aqui — sin esto el cliente no reconoce su PL.
        const clave = (c.clave ?? '').trim() || r.codigo
        const previo = yaEntregado[r.codigo] || 0
        const cierre = cierreDelRenglon(r.packsPlan, previo + packs)
        return { ...r, empaque, lectura, packs, bultos, clave, precio: Number(c.precio) || 0, cierre }
      }),
    [renglones, captura, yaEntregado]
  )

  const totales = useMemo(
    () => ({
      bultos: filas.reduce((a, f) => a + f.bultos, 0),
      packs: filas.reduce((a, f) => a + f.packs, 0),
      // Redondeado POR RENGLON y sumado, igual que al guardar: si aqui se
      // redondeara al final, lo que ella ve podria diferir en centavos de lo
      // que queda en el acta.
      importe:
        Math.round(filas.reduce((a, f) => a + Math.round(f.packs * f.precio * 100) / 100, 0) * 100) / 100
    }),
    [filas]
  )

  const onGuardar = async () => {
    // El disabled del boton no basta: dos clics en el mismo tick (antes del
    // re-render) dispararian dos escrituras. Este documento se factura.
    if (guardando) return
    setError('')
    setAviso('')
    const conAlgo = filas.filter((f) => f.packs > 0 || f.bultos > 0)
    if (!conAlgo.length) {
      setError('Captura el empaque o los packs de al menos un codigo.')
      return
    }
    // El candado del servidor (ID determinista) rechaza el duplicado de todos
    // modos, pero avisarlo AQUI, con la lista de entregas ya en memoria, es un
    // mensaje claro en vez de un viaje que va a fallar.
    if (plDeLaOc && plDeLaOc.numeros.includes(Number(enc.numeroEntrega))) {
      setError(
        `La entrega ${enc.numeroEntrega} de esta orden ya esta registrada. ` +
          'Si es otra entrega, cambia el numero.'
      )
      return
    }
    const sinReconocer = conAlgo.filter((f) => f.empaque.trim() && !f.lectura.reconocido)
    if (
      sinReconocer.length &&
      !window.confirm(
        `No entendi el texto del empaque de ${sinReconocer.length} renglon(es) ` +
          `(${sinReconocer.slice(0, 4).map((f) => f.codigo).join(', ')}). ` +
          'De esos NO voy a tomar nada del texto: se guardan los bultos y packs que ' +
          'hayas tecleado en sus columnas (si estan en cero, ese renglon no se guarda). ¿Sigo?'
      )
    ) {
      return
    }
    // Sin precio el importe sale en $0 — y con esto se factura. No se prohibe
    // (Microsip puede poner el dinero despues), pero se pregunta aparte y con
    // los codigos enfrente, nunca en silencio.
    const sinPrecio = conAlgo.filter((f) => f.packs > 0 && !(f.precio > 0))
    if (
      sinPrecio.length &&
      !window.confirm(
        `${sinPrecio.length} renglon(es) van SIN PRECIO y su importe saldra en $0: ` +
          `${sinPrecio.slice(0, 6).map((f) => f.codigo).join(', ')}. ` +
          'El PL se factura con esto. ¿Seguro que van asi?'
      )
    ) {
      return
    }
    setGuardando(true)
    try {
      await registrarEntregaPL({
        encabezado: { ...enc, oc: oc.trim() },
        renglones: conAlgo.map((f) => ({
          clave: f.clave,
          codigoQuini: f.codigo,
          articulo: f.descripcion,
          ot: f.ot,
          unidad: 'PZA',
          precio: f.precio,
          empaque: f.empaque,
          bultos: f.bultos,
          packs: f.packs,
          piezas: f.packs
        })),
        usuario: { uid: authUser.uid, nombre: perfil?.nombreCompleto || '' },
        esPrueba
      })
      setAviso(`Entrega ${enc.numeroEntrega} de la orden ${oc.trim()} registrada. Ya cuenta para el PL.`)
      setCaptura({})
      // La siguiente entrega es casi siempre la que sigue: se sugiere sola
      // para que no se quede el numero viejo y truene contra el candado.
      setEnc((p) => ({ ...p, numeroEntrega: Math.min(6, Number(p.numeroEntrega) + 1) }))
    } catch (err) {
      setError(err instanceof ErrorEntregaPL ? err.message : 'No se pudo guardar: ' + (err?.message || err))
    } finally {
      setGuardando(false)
    }
  }

  const onDescargar = async () => {
    setError('')
    try {
      const deEsta = entregas.filter((e) => e.oc === normalizarOc(oc))
      const excel = await generarExcelPL({
        oc: normalizarOc(oc),
        entregas: deEsta,
        // El cierre necesita lo PEDIDO, y eso vive en el plan maestro — YA
        // CONVERTIDO a packs (packsPlan), porque el papel cuenta en packs. Si
        // no hay equivalencia, ese renglon no viaja y sus columnas de cierre
        // salen vacias: es la verdad, mejor que un 0% que diria que no se
        // entrego nada.
        plan: renglones
          .filter((r) => r.packsPlan != null)
          .map((r) => ({ codigo: r.codigo, cantidadPlan: r.packsPlan }))
      })
      descargarArchivo(excel.blob, excel.nombreArchivo)
    } catch (err) {
      console.error('[PL] No se pudo generar el Excel:', err)
      setError('No se pudo generar el Excel: ' + (err?.message || err))
    }
  }

  /** El PAPEL de una entrega: el que se imprime, viaja con la mercancia y
   *  donde firman la salida y el recibido. Es de UNA entrega a proposito — el
   *  Excel es el que lleva todas juntas para Microsip. */
  const onDescargarPdf = (entrega) => {
    setError('')
    try {
      const blob = generarPdfPL({
        entrega,
        elaboro: perfil?.nombreCompleto || '',
        esPrueba
      })
      descargarPdf(
        blob,
        `PL ${entrega.pl || ''} OC${entrega.oc} entrega ${entrega.numeroEntrega}.pdf`
          .replace(/\s+/g, ' ')
          .trim()
      )
    } catch (err) {
      console.error('[PL] No se pudo generar el PDF:', err)
      setError('No se pudo generar el PDF: ' + (err?.message || err))
    }
  }

  const entregasDeLaOc = useMemo(
    () => entregas.filter((e) => e.oc === normalizarOc(oc)).sort((a, b) => a.numeroEntrega - b.numeroEntrega),
    [entregas, oc]
  )

  const plDeLaOc = useMemo(() => {
    const deEsta = entregas.filter((e) => e.oc === normalizarOc(oc))
    return deEsta.length ? armarPlDeLaOc(deEsta) : null
  }, [entregas, oc])

  // Al ver que entregas ya tiene la OC, el numero se sugiere solo: la que
  // sigue despues de la mas alta. Dejarlo en 1 invitaba a duplicar (el
  // candado del servidor lo rechazaria, pero mejor no chocar con el).
  useEffect(() => {
    if (!plDeLaOc) return
    const siguiente = Math.min(6, Math.max(...plDeLaOc.numeros) + 1)
    setEnc((p) => (Number(p.numeroEntrega) === siguiente ? p : { ...p, numeroEntrega: siguiente }))
    // Solo cuando cambia la OC o llega una entrega nueva: si dependiera de
    // plDeLaOc entero, pisaria un numero que Valeria acaba de elegir a mano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oc, entregas.length])

  const campo = (k, etiqueta, ancho = 130) => (
    <label className="campo" style={{ margin: 0, flex: `1 1 ${ancho}px` }}>
      <span style={{ fontSize: 11 }}>{etiqueta}</span>
      <input
        type="text"
        value={enc[k]}
        onChange={(e) => setEnc((p) => ({ ...p, [k]: e.target.value }))}
      />
    </label>
  )

  return (
    <div className="tarjeta">
      <h2>Embarcar al cliente (PL)</h2>
      <p className="texto-suave" style={{ marginTop: 4 }}>
        Registra una entrega contra su orden de compra. La app le pone la orden de
        trabajo a cada codigo y lee los bultos del empaque; el packing list se arma
        solo con lo que vayas registrando.
        <br />
        <strong>Usa el PO# de tu PL</strong> (el 2449 del ejemplo), que es como viene
        la orden en el plan maestro — no el OC#.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '14px 0' }}>
        <label className="campo" style={{ margin: 0, maxWidth: 260 }}>
          {/* ⚠️ El plan maestro llama "OC" a lo que el PL llama "PO#". En el
              papel de Stylos: PO# 2449 y OC# 16058 — el plan tiene la 2449.
              El ejemplo decia 16058 y mandaba a buscar el numero equivocado. */}
          <span>Orden de compra (el PO# de tu PL)</span>
          <input
            type="text"
            value={oc}
            placeholder="ej. 2449"
            onChange={(e) => setOc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && buscarOc()}
          />
        </label>
        <button className="btn-secundario" onClick={buscarOc} disabled={cargando}>
          {cargando ? 'Buscando...' : 'Traer del plan'}
        </button>
      </div>

      {error && <div className="alerta-error">{error}</div>}
      {aviso && <div className="alerta-ok">{aviso}</div>}
      {avisoLectura && (
        <div
          style={{
            background: '#fff8e6',
            border: '1px solid #f0d9a0',
            borderRadius: 8,
            padding: '10px 14px',
            margin: '8px 0',
            fontSize: 14
          }}
        >
          {avisoLectura}
        </div>
      )}

      {renglones.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0' }}>
            {campo('subcliente', 'Subcliente', 200)}
            {campo('po', 'PO#')}
            {campo('pl', 'PL')}
            <label className="campo" style={{ margin: 0, flex: '1 1 90px' }}>
              <span style={{ fontSize: 11 }}>Entrega #</span>
              <input
                type="number"
                min="1"
                max="6"
                value={enc.numeroEntrega}
                onChange={(e) => setEnc((p) => ({ ...p, numeroEntrega: Number(e.target.value) }))}
              />
            </label>
            {campo('factura', 'Factura (Microsip)')}
            {campo('bitacora', 'Bitacora')}
          </div>

          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>OT</th>
                  <th>Codigo</th>
                  <th title="La clave con la que el CLIENTE conoce este producto (su UPC o su codigo). Es la que se imprime en el PL.">Clave cliente</th>
                  <th>Articulo</th>
                  <th title="ej. 2/200 1/58">Empaque</th>
                  <th>Bultos</th>
                  <th>Packs</th>
                  <th>Precio</th>
                  <th title="Pedidas en el plan (convertidas a packs) / entregadas contando esta">Cierre</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.codigo}>
                    <td style={{ color: f.ot ? '#1a7a3a' : '#a52218', fontWeight: 600 }}>
                      {f.ot || 'sin OT'}
                    </td>
                    <td>{f.codigo}</td>
                    <td>
                      <input
                        type="text"
                        style={{ width: 120 }}
                        placeholder={f.codigo}
                        value={captura[f.codigo]?.clave ?? ''}
                        onChange={(e) => pon(f.codigo, 'clave', e.target.value)}
                      />
                    </td>
                    <td style={{ fontSize: 13 }}>{f.descripcion || '-'}</td>
                    <td>
                      <input
                        type="text"
                        style={{ width: 100 }}
                        placeholder="2/200 1/58"
                        value={f.empaque}
                        onChange={(e) => pon(f.codigo, 'empaque', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        style={{
                          width: 60,
                          borderColor: f.empaque.trim() && !f.lectura.reconocido ? '#a52218' : undefined
                        }}
                        placeholder={f.lectura.reconocido ? String(f.lectura.bultos) : '?'}
                        title={
                          f.empaque.trim() && !f.lectura.reconocido
                            ? 'No entendi el texto del empaque: escribe aqui los bultos'
                            : ''
                        }
                        value={captura[f.codigo]?.bultos ?? ''}
                        onChange={(e) => pon(f.codigo, 'bultos', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        style={{ width: 80 }}
                        placeholder={f.lectura.reconocido ? String(f.lectura.piezas) : '0'}
                        value={captura[f.codigo]?.packs ?? ''}
                        onChange={(e) => pon(f.codigo, 'packs', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        style={{
                          width: 70,
                          // Con packs y sin precio el importe sale en $0 — y
                          // con esto se factura: que se vea ANTES del confirm.
                          borderColor: f.packs > 0 && !(f.precio > 0) ? '#a52218' : undefined,
                          background: f.packs > 0 && !(f.precio > 0) ? '#fdf2f1' : undefined
                        }}
                        value={captura[f.codigo]?.precio ?? ''}
                        onChange={(e) => pon(f.codigo, 'precio', e.target.value)}
                      />
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {f.cierre.sinEquivalencia ? (
                        <span
                          className="texto-suave"
                          title="El plan esta en docenas y la descripcion no dice de cuantos pares es el pack: convertirlo seria inventarlo"
                        >
                          {f.cantidadPlan > 0 ? f.cantidadPlan + ' doc. sin convertir' : 'sin plan'}
                        </span>
                      ) : f.cierre.porcentaje == null ? (
                        <span className="texto-suave">sin plan</span>
                      ) : (
                        <span style={{ color: f.cierre.porcentaje >= 1 ? '#1a7a3a' : '#8a5a00' }}>
                          {f.cierre.dadas}/{f.cierre.pedidas} ({Math.round(f.cierre.porcentaje * 100)}%)
                          {f.cierre.pendientes > 0 ? ` · faltan ${f.cierre.pendientes}` : ''}
                          {f.cierre.excedidas > 0 ? ` · +${f.cierre.excedidas}` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="texto-suave" style={{ fontSize: 13, marginTop: 8 }}>
            Esta entrega: <strong>{totales.bultos}</strong> bultos ·{' '}
            <strong>{totales.packs}</strong> packs
            {totales.importe > 0 ? <> · <strong>${totales.importe.toLocaleString('es-MX')}</strong></> : null}
          </p>

          <div style={{ marginTop: 10 }}>
            <button className="btn-primario" onClick={onGuardar} disabled={guardando}>
              {guardando ? 'Guardando...' : `Registrar entrega ${enc.numeroEntrega}`}
            </button>
          </div>
        </>
      )}

      {plDeLaOc && (
        <div style={{ marginTop: 24, borderTop: '1px solid #dde3ea', paddingTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            Packing list de la orden {oc.trim()} — {plDeLaOc.numeros.length} entrega(s)
          </h3>
          <p className="texto-suave" style={{ fontSize: 13 }}>
            Esto es lo que ya llevas registrado. Se arma solo con las entregas de arriba.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
              marginBottom: 12
            }}
          >
            <button className="btn-secundario" onClick={onDescargar}>
              Excel de toda la orden
            </button>
            <span className="texto-suave" style={{ fontSize: 12 }}>
              para subir a Microsip
            </span>
          </div>
          {/* El PAPEL va por ENTREGA: quien firma esta recibiendo lo de hoy, y
              darle una hoja con lo de semanas pasadas lo invita a firmar por
              mercancia que no esta viendo. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {entregasDeLaOc.map((e) => (
              <button
                key={e.numeroEntrega}
                className="btn-primario"
                onClick={() => onDescargarPdf(e)}
              >
                PDF de la entrega {e.numeroEntrega}
              </button>
            ))}
            <span className="texto-suave" style={{ fontSize: 12, alignSelf: 'center' }}>
              el papel que se imprime y se firma
            </span>
          </div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>OT</th>
                  <th>Codigo</th>
                  {plDeLaOc.numeros.map((n) => (
                    <th key={n}>Entrega {n}</th>
                  ))}
                  <th>Total packs</th>
                </tr>
              </thead>
              <tbody>
                {plDeLaOc.renglones.map((r) => (
                  <tr key={r.clave}>
                    <td>{r.ot || '-'}</td>
                    <td>{r.clave}</td>
                    {plDeLaOc.numeros.map((n) => (
                      <td key={n} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {r.porEntrega[n] ? r.porEntrega[n].packs : '-'}
                      </td>
                    ))}
                    <td style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.packsTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
