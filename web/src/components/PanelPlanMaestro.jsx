// Pestana de ADRIAN (rol 'produccion'): sube el plan maestro de produccion.
//
// Es el archivo con el que hoy agrupa las ordenes de trabajo bajo la orden de
// compra del cliente. Subirlo aqui es lo que le permite a Lindbergh dejar de
// saberselo de memoria (junta del 2026-08-17).
//
// La pantalla ensena SIEMPRE lo que entendio del archivo antes de guardar:
// que hojas leyo, que columnas reconocio, y sobre todo lo que NO. Con un
// formato que nadie habia visto, eso es lo que evita subir un plan a medias
// creyendo que entro completo.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { leerPlanMaestro } from '../utils/importarPlanMaestro'
import { ErrorPlanMaestro, REF_ACTIVA, guardarPlanMaestro } from '../utils/planMaestro'
import { olvidarCacheDelPlan } from '../utils/otResuelta'
import HistorialPlanes from './HistorialPlanes'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

export default function PanelPlanMaestro() {
  const { authUser, perfil, puedeSubirPlanMaestro } = useAuth()
  const [archivo, setArchivo] = useState(null)
  const [lectura, setLectura] = useState(null) // { lineas, diagnostico }
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [progreso, setProgreso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [vigente, setVigente] = useState(null)
  // Lo que cambio en la ultima subida, para ensenarlo despues de guardar.
  const [cambios, setCambios] = useState(null)
  // Guard sincrono contra el doble clic en "Guardar y activar": el estado
  // 'trabajando' no se propaga hasta el siguiente render, asi que un segundo
  // clic entre el primer clic y ese render alcanzaria a leer 'trabajando'
  // todavia en false y dispararia guardarPlanMaestro() dos veces en paralelo.
  const guardandoRef = useRef(false)

  useEffect(() => {
    getDoc(REF_ACTIVA())
      .then((s) => setVigente(s.exists() ? s.data() : null))
      .catch((err) => console.error('[PlanMaestro] No se pudo leer el plan vigente:', err))
  }, [aviso])

  if (!puedeSubirPlanMaestro) {
    return (
      <div className="tarjeta">
        <h2>Plan maestro</h2>
        <p className="texto-suave">Esta pestana es de produccion.</p>
      </div>
    )
  }

  const onElegir = async (file) => {
    setError('')
    setAviso('')
    setCambios(null)
    setLectura(null)
    setArchivo(file || null)
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) {
      setError('El plan maestro tiene que ser un .xlsx (Excel).')
      return
    }
    setTrabajando(true)
    try {
      const res = await leerPlanMaestro(file)
      setLectura(res)
      if (res.lineas.length === 0) {
        setError(
          'No se reconocio ninguna linea. Abajo estan las columnas que traia el archivo: ' +
            'con eso se ajusta el lector en un momento.'
        )
      }
    } catch (err) {
      console.error('[PlanMaestro] Error leyendo el archivo:', err)
      setError('No se pudo leer el archivo: ' + (err.message || err))
    } finally {
      setTrabajando(false)
    }
  }

  const onGuardar = async () => {
    if (!lectura?.lineas?.length) return
    if (trabajando || guardandoRef.current) return
    guardandoRef.current = true
    setError('')
    setTrabajando(true)
    try {
      const res = await guardarPlanMaestro({
        lineas: lectura.lineas,
        pedidos: lectura.pedidos,
        archivo: archivo?.name,
        usuario: { uid: authUser?.uid, nombre: perfil?.nombreCompleto || '' },
        onProgreso: setProgreso
      })
      // Si el Excel traia renglones repetidos del mismo codigo se fundieron
      // en uno sumando cantidades: decirlo, o el numero final parece que
      // perdio renglones.
      // res.lineas ahora incluye lo HEREDADO del plan anterior, asi que hay que
      // restarlo para volver a comparar contra los renglones de ESTE archivo. Sin
      // eso el resultado sale negativo desde la segunda subida y el aviso de
      // 'renglones fusionados' no vuelve a aparecer nunca.
      const fundidos = res.leidasDelExcel - (res.lineas - (res.heredadas || 0))
      setAviso(
        `Plan maestro subido: ${res.lineas} lineas del arbol` +
          (fundidos > 0
            ? ` (se leyeron ${res.leidasDelExcel} renglones del Excel; ${fundidos} eran del mismo codigo en la misma orden y se sumaron)`
            : '') +
          ` y ${res.pedidos} pedidos en el diccionario. Ya es el plan vigente: Lindbergh lo ve ` +
          'agrupado, y a partir de ahora los folios nuevos toman su orden de trabajo de aqui.'
      )
      // Que cambio de verdad con esta subida. Sin esto, subir un plan es un
      // acto ciego: no se sabe si aporto algo, si piso lo que ya estaba, ni si
      // una orden de trabajo se cambio de orden de compra.
      setCambios(res.cambios || null)
      // La sesion tenia cacheada la version anterior: si no se olvida, los
      // folios que se capturen enseguida se resolverian contra el plan viejo.
      olvidarCacheDelPlan()
      setLectura(null)
      setArchivo(null)
    } catch (err) {
      console.error('[PlanMaestro] Error guardando:', err)
      setError(
        err instanceof ErrorPlanMaestro ? err.message : 'No se pudo guardar: ' + (err.message || err)
      )
    } finally {
      setProgreso('')
      setTrabajando(false)
      guardandoRef.current = false
    }
  }

  const d = lectura?.diagnostico

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}

      {/* QUE CAMBIO CON ESTA SUBIDA. Mismo vocabulario que la carga de folios
          que sube America a diario: nuevas, actualizadas, y lo que se
          conservo. Un plan es un documento vivo que se sube mes con mes, y sin
          esto no hay manera de darle seguimiento. */}
      {cambios && (
        <div className="tarjeta" style={{ marginBottom: 12 }}>
          <h2>Que cambio con esta subida</h2>
          <div className="detalle-kpis" style={{ marginTop: 8 }}>
            <div className="kpi">
              <div className="kpi-num">{cambios.ocsNuevas.length}</div>
              <div className="kpi-lbl">ordenes de compra NUEVAS</div>
            </div>
            <div className="kpi">
              <div className="kpi-num">{cambios.ocsActualizadas.length}</div>
              <div className="kpi-lbl">ordenes que ya existian</div>
            </div>
            <div className="kpi">
              <div className="kpi-num">{cambios.otsNuevas}</div>
              <div className="kpi-lbl">ordenes de trabajo nuevas</div>
            </div>
            <div className="kpi">
              <div className="kpi-num">{cambios.conservadas}</div>
              <div className="kpi-lbl">lineas conservadas del plan anterior</div>
            </div>
          </div>

          {cambios.ocsNuevas.length > 0 && (
            <p style={{ fontSize: 13, marginTop: 10 }}>
              <strong>Nuevas:</strong> {cambios.ocsNuevas.join(' · ')}
            </p>
          )}

          <p className="texto-suave" style={{ fontSize: 13 }}>
            El plan es <strong>acumulativo</strong>: este archivo agrego o corrigio lo suyo, y lo que
            no menciona se conservo tal cual. Subir el mes que falta ya no borra el mes que estaba.
          </p>

          {/* Lo mas delicado que puede traer un archivo: una orden de trabajo
              que se muda de orden de compra mueve produccion ya contada de una
              a otra. Va destacado. */}
          {cambios.otsQueCambiaronDeOc.length > 0 && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                borderRadius: 6,
                background: '#fffbeb',
                border: '1px solid #fde68a',
                fontSize: 13
              }}
            >
              <strong>
                {cambios.otsQueCambiaronDeOc.length} ordenes de trabajo cambiaron de orden de compra:
              </strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {cambios.otsQueCambiaronDeOc.slice(0, 15).map((c) => (
                  <li key={c.ot}>
                    OT {c.ot}: estaba en {c.antes}, ahora en {c.ahora}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      )}

      <div className="tarjeta">
        <h2>Plan maestro de produccion</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          El archivo que dice <strong>que ordenes de trabajo cuelgan de cada orden de compra</strong>.
          Con eso la app puede agrupar el avance por orden de compra en vez de tener que sabersela de
          memoria.
        </p>

        {vigente && (
          <p className="texto-suave" style={{ fontSize: 13 }}>
            Plan vigente: <strong>{vigente.archivo || '(sin nombre)'}</strong> ·{' '}
            {vigente.totalLineas} lineas · lo subio {vigente.activadaPorNombre || '?'}
          </p>
        )}

        <label className="btn-secundario" style={{ cursor: 'pointer', display: 'inline-block' }}>
          {archivo ? `Archivo: ${archivo.name}` : 'Elegir el Excel del plan'}
          <input
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            disabled={trabajando}
            onChange={(e) => {
              onElegir(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>

        {trabajando && <p className="texto-suave">{progreso || 'Leyendo el archivo...'}</p>}
      </div>

      {d && (
        <div className="tarjeta" style={{ marginTop: 18 }}>
          <h2>Esto es lo que entendi del archivo</h2>
          <p className="texto-suave" style={{ fontSize: 13 }}>
            Revisalo antes de guardar. Si algo no cuadra, no lo subas: dime que columna es y lo
            ajusto.
          </p>

          <div className="detalle-kpis" style={{ marginTop: 10 }}>
            <div className="kpi">
              <div className="kpi-num">{d.totalOcs}</div>
              <div className="kpi-lbl">ordenes de compra</div>
            </div>
            <div className="kpi">
              <div className="kpi-num">{d.totalOts}</div>
              <div className="kpi-lbl">ordenes de trabajo</div>
            </div>
            <div className="kpi">
              <div className="kpi-num">{d.totalLineas}</div>
              <div className="kpi-lbl">renglones</div>
            </div>
            <div className="kpi">
              <div className="kpi-num">{d.totalPedidos}</div>
              <div className="kpi-lbl">pedidos en el diccionario</div>
            </div>
          </div>

          {d.hojasLeidas.map((h) => (
            <p key={h.hoja} style={{ fontSize: 13, margin: '8px 0 0' }}>
              Hoja <strong>{h.hoja}</strong>: {h.lineas} renglones. Columnas reconocidas:{' '}
              {Object.entries(h.columnas)
                .filter(([, v]) => v)
                .map(([k]) => k)
                .join(', ') || 'ninguna'}
            </p>
          ))}

          {d.ambiguedades.length > 0 && (
            <p className="texto-suave" style={{ fontSize: 12, marginTop: 8 }}>
              Habia mas de una columna posible para lo mismo.{' '}
              {d.ambiguedades.map((a, i) => (
                <span key={`${a.hoja}-${a.campo}-${i}`}>
                  En <strong>{a.hoja}</strong> se tomo &quot;{a.gano}&quot; como {a.campo} y se
                  ignoro {a.descartadas.map((x) => `"${x}"`).join(', ')}.{' '}
                </span>
              ))}
            </p>
          )}

          {/* Lo que NO cuadro. Va destacado a proposito: es lo unico que puede
              hacer que el plan entre incompleto sin que nadie se entere. */}
          {(d.hojasIgnoradas.length > 0 ||
            d.totalIncompletos > 0 ||
            d.sinCantidad > 0 ||
            d.sinCodigo > 0 ||
            d.sinOc > 0 ||
            d.ocInvalida > 0 ||
            d.formulaSinResultado > 0 ||
            d.duplicadosDeOtraHoja > 0 ||
            d.totalConflictosDePedido > 0) && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 6,
                background: '#fffbeb',
                border: '1px solid #fde68a',
                fontSize: 13
              }}
            >
              <strong>Ojo con esto:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {/* Este es el unico con arreglo concreto, por eso va primero y
                    con el remedio escrito: la columna de orden de compra del
                    archivo es una formula, y si Excel la guardo sin calcular,
                    el dato NO viene en el archivo aunque el lo vea en pantalla. */}
                {d.formulaSinResultado > 0 && (
                  <li>
                    <strong>{d.formulaSinResultado} renglones perdieron su orden de compra</strong>{' '}
                    porque esa celda es una formula y Excel la guardo sin calcular. Se arregla asi:
                    abre el archivo, pulsa <strong>Ctrl + Alt + F9</strong>, guarda y vuelve a
                    subirlo.
                  </li>
                )}
                {d.sinOc > 0 && (
                  <li>
                    {d.sinOc} renglones <strong>sin orden de compra</strong>. No es un error: esos
                    quedan fuera del arbol hasta que se les asigne una, pero su orden de trabajo si
                    entra al diccionario.
                  </li>
                )}
                {d.ocInvalida > 0 && (
                  <li>
                    {d.ocInvalida} renglones con algo que <strong>no es una orden de compra</strong>{' '}
                    en esa columna (un <code>0</code>, un <code>FCST</code>). Se dejan fuera para que
                    no aparezca una orden inventada con ese nombre.
                  </li>
                )}
                {d.sinCantidad > 0 && (
                  <li>
                    {d.sinCantidad} renglones <strong>sin cantidad</strong>. Amarran la orden de
                    trabajo con su orden de compra, pero de esos no se puede medir avance: salen
                    con guion, no con cero.
                  </li>
                )}
                {d.sinCodigo > 0 && (
                  <li>
                    {d.sinCodigo} renglones <strong>sin codigo</strong>: el arbol llega hasta la orden
                    de trabajo, no al detalle por codigo.
                  </li>
                )}
                {d.duplicadosDeOtraHoja > 0 && (
                  <li>
                    {d.duplicadosDeOtraHoja} renglones descartados porque{' '}
                    <strong>esa orden ya la trajo otra hoja</strong>. Tomarlos de las dos duplicaria
                    la meta y el avance se veria a la mitad.
                  </li>
                )}
                {d.totalConflictosDePedido > 0 && (
                  <li>
                    <strong>{d.totalConflictosDePedido} pedidos apuntan a dos ordenes distintas.</strong>{' '}
                    Se dejaron fuera del diccionario: la app no puede elegir cual vale.
                  </li>
                )}
                {d.totalIncompletos > 0 && (
                  <li>
                    {d.totalIncompletos} renglones <strong>rechazados</strong>. El mas comun es que
                    Excel convirtiera el identificador en fecha: formatea esa columna como Texto.
                  </li>
                )}
                {d.hojasIgnoradas.map((h) => (
                  <li key={h.hoja}>
                    Hoja <strong>{h.hoja}</strong> ignorada (no trae orden de trabajo con orden de
                    compra ni con pedido). Traia: {h.encabezados.slice(0, 10).join(' · ') || '(vacia)'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            className="btn-primario"
            style={{ marginTop: 14 }}
            disabled={trabajando || !lectura.lineas.length}
            onClick={onGuardar}
          >
            {trabajando ? progreso || 'Guardando...' : `Guardar y activar (${d.totalLineas} renglones)`}
          </button>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <HistorialPlanes />
      </div>
    </>
  )
}
