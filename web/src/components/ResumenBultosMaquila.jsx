// LOS CALCETINES QUE LA MAQUILA TIENE, ordenados por ORDEN DE TRABAJO.
//
// Roberto, 2026-09-01: "que aparezca cuantos bultos y cuantos codigos, de que
// OT, y de que remision venia; ordenalo para que quede todo mas limpio".
//
// La pestana "Bultos que me mandaron" muestra REMISIONES: cada envio por
// separado, que es lo correcto el dia que llega el camion. Esta muestra lo
// contrario: el ACUMULADO por orden de trabajo, que es como ella trabaja. Una
// OT le puede llegar repartida en tres envios de dias distintos, y antes tenia
// que sumarlo de cabeza abriendo remision por remision.
//
// SE CALCULA CON SUS PROPIOS DATOS, sin permisos nuevos: sus remisiones
// (salidas) y sus acuses. Cuenta solo lo que ella YA CONFIRMO y descuenta lo
// que ella misma reporto como no llegado o rechazado. No dice lo que Quini
// cree haberle mandado: dice lo que ella acepto recibir.
//
// ⚠️ Lo que NO puede saber: de que ORDEN DE COMPRA cuelga cada OT (eso vive en
// el plan maestro, que es interno) ni lo que ya devolvio (lo registra Producto
// Terminado del lado de Quini). Por eso el titulo dice "tengo", no "me falta
// entregar": prometer un saldo que no puede calcular seria peor que no
// mostrarlo.
import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { compararAscendente } from '../utils/texto'

export default function ResumenBultosMaquila() {
  const { perfil } = useAuth()
  const maquilaId = perfil?.maquilaId || ''

  const [salidas, setSalidas] = useState([])
  const [acuses, setAcuses] = useState({})
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    if (!maquilaId) {
      setCargando(false)
      return
    }
    const unsubSalidas = onSnapshot(
      collection(db, 'portalMaquila', maquilaId, 'salidas'),
      (snap) => {
        setSalidas(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setCargando(false)
      },
      (err) => {
        console.error('[Calcetines] Error leyendo remisiones:', err)
        setCargando(false)
      }
    )
    const unsubAcuses = onSnapshot(
      collection(db, 'portalMaquila', maquilaId, 'acuses'),
      (snap) => {
        const m = {}
        snap.docs.forEach((d) => {
          m[d.id] = d.data()
        })
        setAcuses(m)
      },
      (err) => console.error('[Calcetines] Error leyendo acuses:', err)
    )
    return () => {
      unsubSalidas()
      unsubAcuses()
    }
  }, [maquilaId])

  /** Agrupado por OT, y dentro por codigo. Cada codigo recuerda de que
   *  remisiones vino, que es la pregunta que sigue siempre: "¿y esto cuando
   *  me llego?". */
  const porOt = useMemo(() => {
    const mapa = new Map()
    for (const s of salidas) {
      // Una remision anulada se corrigio y se reemitio: contarla seria contar
      // dos veces la misma mercancia.
      if (s.anuladaPorRegistroId) continue
      const acuse = acuses[s.id]
      if (!acuse) continue // todavia no la reviso: no puede afirmar que la tiene
      const fuera = new Set([
        ...(acuse.foliosFaltantes || []),
        ...(acuse.foliosRechazados || [])
      ])
      const etiquetaRemision = s.folioInterno != null ? String(s.folioInterno) : s.id.slice(0, 6)
      for (const r of s.renglones || []) {
        if (fuera.has(r.folio)) continue
        const ot = r.ot || 'Sin OT'
        if (!mapa.has(ot)) {
          mapa.set(ot, {
            ot,
            bultos: 0,
            docenas: 0,
            codigos: new Map(),
            remisiones: new Map()
          })
        }
        const g = mapa.get(ot)
        g.bultos += 1
        g.docenas += Number(r.docenas) || 0
        g.remisiones.set(etiquetaRemision, (g.remisiones.get(etiquetaRemision) || 0) + 1)

        const clave = r.codigo || 'sin codigo'
        if (!g.codigos.has(clave)) {
          g.codigos.set(clave, {
            codigo: clave,
            descripcion: r.descripcion || '',
            bultos: 0,
            docenas: 0,
            folios: [],
            remisiones: new Set()
          })
        }
        const c = g.codigos.get(clave)
        c.bultos += 1
        c.docenas += Number(r.docenas) || 0
        if (c.folios.length < 60) c.folios.push(r.folio)
        c.remisiones.add(etiquetaRemision)
      }
    }
    return [...mapa.values()]
      .map((g) => ({
        ...g,
        docenas: Math.round(g.docenas * 100) / 100,
        remisiones: [...g.remisiones.entries()]
          .map(([folio, bultos]) => ({ folio, bultos }))
          .sort((a, b) => compararAscendente(a.folio, b.folio)),
        codigos: [...g.codigos.values()]
          .map((c) => ({
            ...c,
            docenas: Math.round(c.docenas * 100) / 100,
            remisiones: [...c.remisiones].sort(compararAscendente)
          }))
          .sort((a, b) => compararAscendente(a.codigo, b.codigo))
      }))
      .sort((a, b) =>
        a.ot === 'Sin OT' ? 1 : b.ot === 'Sin OT' ? -1 : compararAscendente(a.ot, b.ot)
      )
  }, [salidas, acuses])

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return porOt
    return porOt.filter(
      (g) =>
        g.ot.toLowerCase().includes(q) ||
        g.codigos.some(
          (c) =>
            c.codigo.toLowerCase().includes(q) ||
            (c.descripcion || '').toLowerCase().includes(q) ||
            c.folios.some((f) => String(f).includes(q))
        )
    )
  }, [porOt, busca])

  const totales = useMemo(
    () => ({
      ots: porOt.length,
      codigos: new Set(porOt.flatMap((g) => g.codigos.map((c) => c.codigo))).size,
      bultos: porOt.reduce((a, g) => a + g.bultos, 0),
      docenas: Math.round(porOt.reduce((a, g) => a + g.docenas, 0) * 100) / 100
    }),
    [porOt]
  )

  if (!maquilaId) return null

  if (cargando) {
    return (
      <div className="tarjeta">
        <h2>Calcetines que tengo</h2>
        <p className="texto-suave">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="tarjeta">
      <h2>Calcetines que tengo</h2>
      <p className="texto-suave" style={{ marginTop: 4 }}>
        Todo lo que ya confirmaste recibir, junto por <strong>orden de trabajo</strong>,
        sin los bultos que marcaste como no llegados ni los que rechazaste. Una misma OT
        te puede llegar en varias remisiones: aqui esta sumada.
      </p>

      {porOt.length === 0 ? (
        <p className="texto-suave" style={{ marginTop: 14 }}>
          Todavia no has confirmado ninguna remision. En cuanto confirmes la primera en
          «Bultos que me mandaron», aqui vas a ver lo que tienes por orden de trabajo.
        </p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
              margin: '14px 0',
              padding: '12px 16px',
              background: '#f6f8fa',
              borderRadius: 8
            }}
          >
            <Cifra n={totales.ots} texto="ordenes de trabajo" />
            <Cifra n={totales.codigos} texto="codigos distintos" />
            <Cifra n={totales.bultos} texto="bultos" />
            <Cifra n={totales.docenas} texto="docenas" />
          </div>

          <label className="campo" style={{ maxWidth: 340 }}>
            <span>Buscar por OT, codigo o folio</span>
            <input
              type="search"
              value={busca}
              placeholder="ej. 7934, SFT106 o 445210"
              onChange={(e) => setBusca(e.target.value)}
            />
          </label>

          {visibles.length === 0 && (
            <p className="texto-suave" style={{ marginTop: 12 }}>
              Nada coincide con «{busca}».
            </p>
          )}

          <div style={{ marginTop: 12 }}>
            {visibles.map((g) => {
              const abierto = abierta === g.ot
              return (
                <div
                  key={g.ot}
                  style={{
                    border: '1px solid #dde3ea',
                    borderRadius: 8,
                    marginBottom: 10,
                    overflow: 'hidden'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setAbierta(abierto ? null : g.ot)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      alignItems: 'baseline',
                      padding: '12px 14px',
                      background: abierto ? '#eef2f7' : '#fff',
                      border: 0,
                      borderRadius: 0,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <strong style={{ fontSize: 16 }}>
                      {g.ot === 'Sin OT' ? 'Sin orden de trabajo' : `OT ${g.ot}`}
                    </strong>
                    <span style={{ fontSize: 14 }}>
                      {g.bultos} bulto{g.bultos === 1 ? '' : 's'} · {g.codigos.length} codigo
                      {g.codigos.length === 1 ? '' : 's'} · {g.docenas} docenas
                    </span>
                    <span className="texto-suave" style={{ fontSize: 13, marginLeft: 'auto' }}>
                      {g.remisiones.length === 1
                        ? `remision ${g.remisiones[0].folio}`
                        : `${g.remisiones.length} remisiones`}
                      {'  '}
                      {abierto ? '▲' : '▼'}
                    </span>
                  </button>

                  {abierto && (
                    <div style={{ padding: '0 14px 14px' }}>
                      <p className="texto-suave" style={{ fontSize: 13, margin: '10px 0' }}>
                        Te llego en:{' '}
                        {g.remisiones
                          .map((r) => `remision ${r.folio} (${r.bultos})`)
                          .join(' · ')}
                      </p>
                      <div className="tabla-scroll">
                        <table className="tabla">
                          <thead>
                            <tr>
                              <th>Codigo</th>
                              <th>Producto</th>
                              <th>Bultos</th>
                              <th>Docenas</th>
                              <th>Folios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.codigos.map((c) => (
                              <tr key={c.codigo}>
                                <td><strong>{c.codigo}</strong></td>
                                <td>{c.descripcion || '-'}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.bultos}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.docenas}</td>
                                <td className="texto-suave" style={{ fontSize: 12 }}>
                                  {c.folios.join(', ')}
                                  {c.bultos > c.folios.length ? ` y ${c.bultos - c.folios.length} mas` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <p className="texto-suave" style={{ fontSize: 13, marginTop: 14 }}>
        Esto es lo que <strong>recibiste</strong>, no lo que te falta entregar: lo que ya
        devolviste se registra del lado de Quini y todavia no se descuenta aqui.
      </p>
    </div>
  )
}

function Cifra({ n, texto }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div className="texto-suave" style={{ fontSize: 13 }}>
        {texto}
      </div>
    </div>
  )
}
