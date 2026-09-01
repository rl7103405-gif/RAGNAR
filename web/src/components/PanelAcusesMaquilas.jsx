// LO QUE REPORTARON LAS MAQUILAS al recibir sus remisiones.
//
// Por que existe esta pantalla (2026-09-01): la maquila ya podia marcar
// faltantes, rechazar un bulto por peso y anotar sobrantes... y **nadie de
// Quini lo veia**. El acuse se guardaba en portalMaquila/{mid}/acuses y el
// UNICO codigo que lo leia era el portal de la propia maquila. Es decir: ella
// rechazaba, sentia que aviso, y de este lado no se enteraba nadie. Justo el
// "yo si te avise" que RAGNAR existe para acabar, pero al reves.
//
// Las reglas YA permitian leerlo (`allow read: if esInterno() || ...`); lo que
// faltaba era la pantalla. Aqui esta.
//
// Se lee maquila por maquila en vez de con un collectionGroup: son cinco o
// seis, la coleccion 'acuses' comparte nombre con otras del portal, y un
// collectionGroup exigiria su propia regla y su indice para no ganar nada.
import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { compararAscendente } from '../utils/texto'

// Cuantos acuses se traen por maquila. Lo que importa es lo reciente: un
// rechazo de hace tres meses ya se resolvio por telefono o ya no se va a
// resolver.
const TOPE_POR_MAQUILA = 50

export default function PanelAcusesMaquilas() {
  const [maquilas, setMaquilas] = useState([])
  const [acusesPorMaquila, setAcusesPorMaquila] = useState({})
  const [salidas, setSalidas] = useState({})
  const [error, setError] = useState('')
  const [soloDiferencias, setSoloDiferencias] = useState(true)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'maquilas'), orderBy('nombre')),
      (snap) => {
        setMaquilas(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setCargando(false)
      },
      (err) => {
        console.error('[AcusesMaquilas] No se pudieron leer las maquilas:', err)
        setError('No se pudieron cargar las maquilas: ' + (err.message || err))
        setCargando(false)
      }
    )
    return unsub
  }, [])

  useEffect(() => {
    if (!maquilas.length) return
    const unsubs = maquilas.map((m) =>
      onSnapshot(
        query(
          collection(db, 'portalMaquila', m.id, 'acuses'),
          orderBy('creadoEn', 'desc'),
          limit(TOPE_POR_MAQUILA)
        ),
        (snap) => {
          setAcusesPorMaquila((prev) => ({
            ...prev,
            [m.id]: snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          }))
        },
        (err) => {
          // Una maquila sin acuses todavia no es un error; un permiso negado
          // si, y hay que decirlo en vez de mostrar una lista corta y falsa.
          console.error('[AcusesMaquilas] Error leyendo acuses de ' + m.id + ':', err)
          if (err?.code === 'permission-denied') {
            setError('Tu cuenta no tiene permiso para ver lo que reportan las maquilas.')
          }
        }
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [maquilas])

  /** Todos los acuses de todas las maquilas, el mas reciente primero. */
  const filas = useMemo(() => {
    const nombre = Object.fromEntries(maquilas.map((m) => [m.id, m.nombre || m.id]))
    const todas = []
    for (const [maquilaId, lista] of Object.entries(acusesPorMaquila)) {
      for (const a of lista) {
        const faltantes = a.foliosFaltantes || []
        const rechazados = a.foliosRechazados || []
        const sobrantes = a.foliosSobrantes || []
        // Los pesos que la maquila midio y NO cuadraron con los nuestros. El
        // 2% es la misma tolerancia que ve ella en su pantalla: si aqui se
        // usara otra, los dos lados verian cosas distintas del mismo bulto.
        const desviados = (a.pesados || []).filter((p) => {
          const suyo = Number(p.pesoGramos) || 0
          const nuestro = Number(p.pesoQuiniGramos) || 0
          // MISMA cuenta que ve la maquila en su pantalla, incluido el borde:
          // si nuestro peso es 0 (un renglon que se guardo sin pesar), alla se
          // pinta como "no cuadra" — aqui tiene que salir igual. Descartarlo
          // haria que ella lo viera en rojo y nosotros ni nos enterasemos, que
          // es justo lo que esta pantalla vino a arreglar.
          const desvio = nuestro > 0 ? Math.abs(suyo - nuestro) / nuestro : 1
          return desvio > 0.02
        })
        todas.push({
          ...a,
          maquilaId,
          maquilaNombre: nombre[maquilaId] || maquilaId,
          faltantes,
          rechazados,
          sobrantes,
          desviados,
          hayAlgo:
            faltantes.length > 0 ||
            rechazados.length > 0 ||
            sobrantes.length > 0 ||
            desviados.length > 0 ||
            !!(a.comentario || '').trim()
        })
      }
    }
    return todas.sort((x, y) => {
      const fx = x.creadoEn?.toMillis ? x.creadoEn.toMillis() : 0
      const fy = y.creadoEn?.toMillis ? y.creadoEn.toMillis() : 0
      return fy - fx
    })
  }, [acusesPorMaquila, maquilas])

  const visibles = useMemo(
    () => (soloDiferencias ? filas.filter((f) => f.hayAlgo) : filas),
    [filas, soloDiferencias]
  )

  // El folio interno de la remision vive en la SALIDA, no en el acuse. Se trae
  // solo el de lo que se esta mostrando: sin esto habria que leer todas las
  // remisiones de la historia para pintar una lista de cinco.
  useEffect(() => {
    let vivo = true
    const faltan = visibles
      .filter((f) => salidas[f.maquilaId + '/' + f.id] === undefined)
      .slice(0, 40)
    if (!faltan.length) return
    Promise.all(
      faltan.map(async (f) => {
        const clave = f.maquilaId + '/' + f.id
        try {
          const s = await getDoc(doc(db, 'portalMaquila', f.maquilaId, 'salidas', f.id))
          return [clave, s.exists() ? s.data() : null]
        } catch (err) {
          console.warn('[AcusesMaquilas] No se pudo leer la remision ' + clave + ':', err?.message)
          return [clave, null]
        }
      })
    ).then((pares) => {
      if (!vivo) return
      setSalidas((prev) => ({ ...prev, ...Object.fromEntries(pares) }))
    })
    return () => {
      vivo = false
    }
  }, [visibles, salidas])

  const totales = useMemo(() => {
    const conAlgo = filas.filter((f) => f.hayAlgo)
    return {
      remisiones: conAlgo.length,
      rechazados: conAlgo.reduce((a, f) => a + f.rechazados.length, 0),
      faltantes: conAlgo.reduce((a, f) => a + f.faltantes.length, 0),
      sobrantes: conAlgo.reduce((a, f) => a + f.sobrantes.length, 0)
    }
  }, [filas])

  const fechaHora = (t) =>
    t?.toDate
      ? `${t.toDate().toLocaleDateString('es-MX')} ${t
          .toDate()
          .toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
      : '-'

  const listaFolios = (folios) => [...folios].sort(compararAscendente).join(', ')

  if (cargando) {
    return (
      <div className="tarjeta">
        <h2>Lo que reportaron las maquilas</h2>
        <p className="texto-suave">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="tarjeta">
      <h2>Lo que reportaron las maquilas</h2>
      <p className="texto-suave" style={{ marginTop: 4 }}>
        Cada vez que una maquila confirma una remision, firma lo que recibio. Aqui
        aparece lo que <strong>no cuadro</strong>: bultos que no le llegaron, los que
        rechazo por peso y los que le llegaron de mas.
      </p>

      {error && <div className="alerta-error" style={{ marginTop: 10 }}>{error}</div>}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          margin: '14px 0',
          padding: '12px 16px',
          background: '#f6f8fa',
          borderRadius: 8
        }}
      >
        <Dato n={totales.remisiones} texto="remisiones con algo que revisar" />
        <Dato n={totales.rechazados} texto="bultos rechazados" alerta={totales.rechazados > 0} />
        <Dato n={totales.faltantes} texto="bultos que no llegaron" alerta={totales.faltantes > 0} />
        <Dato n={totales.sobrantes} texto="bultos de mas" />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}>
        <input
          type="checkbox"
          checked={soloDiferencias}
          onChange={(e) => setSoloDiferencias(e.target.checked)}
        />
        Ver solo las que tienen algo que revisar
      </label>

      {visibles.length === 0 && (
        <p className="texto-suave">
          {soloDiferencias
            ? 'Ninguna maquila ha reportado diferencias. Todo lo que confirmaron llego completo.'
            : 'Todavia no hay remisiones confirmadas por las maquilas.'}
        </p>
      )}

      {visibles.map((f) => {
        const salida = salidas[f.maquilaId + '/' + f.id]
        return (
          <div
            key={f.maquilaId + '/' + f.id}
            style={{
              border: '1px solid',
              borderColor: f.hayAlgo ? '#f0c9c4' : '#e2e6ea',
              background: f.hayAlgo ? '#fdf7f6' : '#fff',
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 10
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
              <strong style={{ fontSize: 15 }}>{f.maquilaNombre}</strong>
              {salida?.folioInterno != null && (
                <span
                  style={{
                    fontSize: 12,
                    background: '#eef2f7',
                    borderRadius: 999,
                    padding: '2px 10px'
                  }}
                >
                  Remision {salida.folioInterno}
                </span>
              )}
              {salida?.ots?.length > 0 && (
                <span className="texto-suave" style={{ fontSize: 13 }}>
                  OT {salida.ots.join(', ')}
                </span>
              )}
              <span className="texto-suave" style={{ fontSize: 13, marginLeft: 'auto' }}>
                {f.recibidoPorNombre || 'la maquila'} · {fechaHora(f.creadoEn)}
              </span>
            </div>

            {!f.hayAlgo && (
              <p className="texto-suave" style={{ margin: '6px 0 0', fontSize: 14 }}>
                Recibida completa
                {salida ? `: ${salida.totalFolios} bultos, ${salida.totalDocenas} docenas.` : '.'}
              </p>
            )}

            {f.rechazados.length > 0 && (
              <Renglon
                titulo={`RECHAZO ${f.rechazados.length} por peso`}
                color="#a52218"
                detalle={listaFolios(f.rechazados)}
              />
            )}
            {f.faltantes.length > 0 && (
              <Renglon
                titulo={`No le llegaron ${f.faltantes.length}`}
                color="#a52218"
                detalle={listaFolios(f.faltantes)}
              />
            )}
            {f.sobrantes.length > 0 && (
              <Renglon
                titulo={`Le llegaron ${f.sobrantes.length} de mas`}
                color="#8a5a00"
                detalle={listaFolios(f.sobrantes)}
              />
            )}
            {f.desviados.length > 0 && (
              <Renglon
                titulo={`${f.desviados.length} con el peso fuera del 2%`}
                color="#8a5a00"
                detalle={f.desviados
                  .map(
                    (p) =>
                      `${p.folio}: ella ${(p.pesoGramos / 1000).toFixed(2)} kg vs ` +
                      `${(p.pesoQuiniGramos / 1000).toFixed(2)} kg nuestros`
                  )
                  .join(' · ')}
              />
            )}
            {(f.comentario || '').trim() && (
              <Renglon titulo="Nota de la maquila" color="#3d4550" detalle={f.comentario} />
            )}
          </div>
        )
      })}

      <p className="texto-suave" style={{ fontSize: 13, marginTop: 14 }}>
        El acuse lo firma la maquila una sola vez y no se puede editar, ni de su
        lado ni del nuestro: es su declaracion de lo que recibio.
        <strong> Lo que aparezca aqui hay que resolverlo por fuera</strong> — todavia
        no existe la devolucion del bulto rechazado dentro de la app.
      </p>
    </div>
  )
}

function Dato({ n, texto, alerta }) {
  return (
    <div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: alerta ? '#a52218' : '#14181d',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {n}
      </div>
      <div className="texto-suave" style={{ fontSize: 13 }}>
        {texto}
      </div>
    </div>
  )
}

function Renglon({ titulo, color, detalle }) {
  return (
    <div style={{ marginTop: 8, fontSize: 14 }}>
      <strong style={{ color }}>{titulo}:</strong>{' '}
      <span style={{ wordBreak: 'break-word' }}>{detalle}</span>
    </div>
  )
}
