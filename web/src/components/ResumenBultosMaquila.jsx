// LO QUE LA MAQUILA TIENE EN SUS MANOS, agrupado POR ORDEN DE TRABAJO.
//
// Pedido por Roberto el 2026-09-01: "que dentro de esa misma pestana le
// aparezcan los bultos que tiene, por OT, porque ellas trabajan por OT".
//
// La pestana "Bultos que me mandaron" muestra REMISIONES: cada envio por
// separado, que es lo correcto para revisarlo el dia que llega. Pero la
// maquila no arma por remision, arma por OT — y una OT le puede llegar
// repartida en tres envios de dias distintos. Sin esto tenia que sumarlo de
// cabeza abriendo remision por remision.
//
// SE CALCULA CON SUS PROPIOS DATOS, no hay permiso nuevo: sus remisiones
// (salidas) y sus acuses. Cuenta solo lo que ella YA CONFIRMO, y descuenta lo
// que ella misma reporto como no llegado o rechazado. Es decir: no dice lo que
// Quini cree que le mando, dice lo que ella acepto haber recibido.
//
// ⚠️ Lo que NO sabe: lo que ya devolvio. Producto Terminado registra las
// devoluciones del lado de Quini (`recepcionesPT`) y la maquila no puede leer
// esa coleccion. Por eso el titulo dice "recibido", no "pendiente": prometer
// un saldo que no puede calcular seria peor que no mostrar nada.
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
        console.error('[ResumenBultos] Error leyendo remisiones:', err)
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
      (err) => console.error('[ResumenBultos] Error leyendo acuses:', err)
    )
    return () => {
      unsubSalidas()
      unsubAcuses()
    }
  }, [maquilaId])

  const porOt = useMemo(() => {
    const mapa = new Map()
    for (const s of salidas) {
      // Una remision anulada se corrigio y se reemitio: contarla seria contar
      // dos veces la misma mercancia.
      if (s.anuladaPorRegistroId) continue
      const acuse = acuses[s.id]
      // Sin acuse todavia no la reviso: no puede afirmar que lo tiene.
      if (!acuse) continue
      const fuera = new Set([
        ...(acuse.foliosFaltantes || []),
        ...(acuse.foliosRechazados || [])
      ])
      for (const r of s.renglones || []) {
        if (fuera.has(r.folio)) continue
        const ot = r.ot || 'Sin OT'
        if (!mapa.has(ot)) {
          mapa.set(ot, { ot, bultos: 0, docenas: 0, codigos: new Map(), remisiones: new Set() })
        }
        const g = mapa.get(ot)
        g.bultos += 1
        g.docenas += Number(r.docenas) || 0
        g.remisiones.add(s.folioInterno ?? s.id)
        const clave = r.codigo || 'sin codigo'
        if (!g.codigos.has(clave)) {
          g.codigos.set(clave, { codigo: clave, descripcion: r.descripcion || '', bultos: 0, docenas: 0 })
        }
        const c = g.codigos.get(clave)
        c.bultos += 1
        c.docenas += Number(r.docenas) || 0
      }
    }
    return [...mapa.values()]
      .map((g) => ({
        ...g,
        docenas: Math.round(g.docenas * 100) / 100,
        remisiones: [...g.remisiones].sort(compararAscendente),
        codigos: [...g.codigos.values()]
          .map((c) => ({ ...c, docenas: Math.round(c.docenas * 100) / 100 }))
          .sort((a, b) => compararAscendente(a.codigo, b.codigo))
      }))
      .sort((a, b) =>
        a.ot === 'Sin OT' ? 1 : b.ot === 'Sin OT' ? -1 : compararAscendente(a.ot, b.ot)
      )
  }, [salidas, acuses])

  const totales = useMemo(
    () => ({
      ots: porOt.length,
      bultos: porOt.reduce((a, g) => a + g.bultos, 0),
      docenas: Math.round(porOt.reduce((a, g) => a + g.docenas, 0) * 100) / 100
    }),
    [porOt]
  )

  if (!maquilaId || cargando) return null
  if (!porOt.length) return null

  return (
    <div className="tarjeta" style={{ marginBottom: 14 }}>
      <h2>Lo que has recibido, por orden de trabajo</h2>
      <p className="texto-suave" style={{ marginTop: 4 }}>
        Suma de todas las remisiones que ya confirmaste, sin contar los bultos que
        marcaste como no llegados ni los que rechazaste. Una misma OT te puede
        llegar en varios envios: aqui esta junta.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 22,
          flexWrap: 'wrap',
          margin: '14px 0',
          padding: '12px 16px',
          background: '#f6f8fa',
          borderRadius: 8
        }}
      >
        <Cifra n={totales.ots} texto="ordenes de trabajo" />
        <Cifra n={totales.bultos} texto="bultos" />
        <Cifra n={totales.docenas} texto="docenas" />
      </div>

      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th>Orden de trabajo</th>
              <th>Bultos</th>
              <th>Docenas</th>
              <th>Te llego en</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {porOt.map((g) => (
              <ReactFragmentFila
                key={g.ot}
                g={g}
                abierta={abierta === g.ot}
                onAlternar={() => setAbierta(abierta === g.ot ? null : g.ot)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="texto-suave" style={{ fontSize: 13, marginTop: 12 }}>
        Esto es lo que <strong>recibiste</strong>, no lo que te falta entregar: lo
        que ya devolviste se registra del lado de Quini y no se descuenta aqui.
      </p>
    </div>
  )
}

function ReactFragmentFila({ g, abierta, onAlternar }) {
  return (
    <>
      <tr>
        <td><strong>{g.ot}</strong></td>
        <td>{g.bultos}</td>
        <td>{g.docenas}</td>
        <td className="texto-suave">
          {g.remisiones.length === 1
            ? `remision ${g.remisiones[0]}`
            : `${g.remisiones.length} remisiones`}
        </td>
        <td style={{ textAlign: 'right' }}>
          <button
            type="button"
            className="btn-secundario"
            style={{ padding: '2px 10px', fontSize: 12 }}
            onClick={onAlternar}
          >
            {abierta ? 'Ocultar' : 'Ver codigos'}
          </button>
        </td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={5} style={{ background: '#fafbfc' }}>
            <table className="tabla" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Producto</th>
                  <th>Bultos</th>
                  <th>Docenas</th>
                </tr>
              </thead>
              <tbody>
                {g.codigos.map((c) => (
                  <tr key={c.codigo}>
                    <td>{c.codigo}</td>
                    <td>{c.descripcion || '-'}</td>
                    <td>{c.bultos}</td>
                    <td>{c.docenas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
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
