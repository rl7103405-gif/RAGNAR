// LO QUE VIENE PARA PRODUCTO TERMINADO.
//
// Lo pidio Roberto el 2026-08-28 con estas palabras: "es importante que ella
// tenga como un aviso de que, oye, ya estan haciendo esto, tal vez preparate
// en x dias para recibir esto, o hoy te va a llegar esto y vete preparando".
//
// El problema real que resuelve: hoy PT se entera de que llega mercancia
// cuando el camion ya esta afuera. Todo lo que hace falta para avisarle YA
// EXISTE en las tareas de ensamble -- solo que nadie se lo estaba enseñando.
//
// ⚠️ Esta pantalla NO es la recepcion. PT todavia no puede recibir ni llevar
// inventario, porque lo que la maquila declara (packs, docenas, cajas) no se
// guarda en ningun lado: se imprime en su remision y se pierde. Mientras eso
// no se persista, aqui solo se AVISA. Ver la idea "Recepcion en PT" de
// IDEAS.md, que tambien depende de ese mismo ladrillo.
//
// No hizo falta abrir ningun permiso: el rol 'consulta' (Valeria, Cielo) ya
// podia leer las tareas de ensamble de SUS maquilas desde el 24-08, con el
// corral de mundo incluido (firestore.rules, match tareasEnsamble).
import { useEffect, useMemo, useState } from 'react'
import { useMaquilas } from './Maquilas'
import { escucharTareasEnsambleDeVarias } from '../utils/tareasEnsamble'

// Los tres avisos, en el orden en que le importan a PT: primero lo que esta a
// punto de llegar. 'preparando' no aparece: es un borrador que la maquila ni
// siquiera ha visto, avisarlo seria anunciar algo que todavia puede cancelarse.
const GRUPOS = [
  {
    estado: 'declarada',
    titulo: 'Por llegar',
    detalle: 'La maquila ya avisó que terminó. Esto es lo próximo en entrar.',
    clase: 'alerta-exito',
    fecha: 'declaradaEn'
  },
  {
    estado: 'iniciada',
    titulo: 'La maquila lo está armando',
    detalle: 'Ya empezaron. Falta que avisen que terminaron.',
    clase: 'alerta-aviso',
    fecha: 'iniciadaEn'
  },
  {
    estado: 'abierta',
    titulo: 'Encargado, sin empezar',
    detalle: 'La tarea ya se le mandó a la maquila, pero todavía no la inicia.',
    clase: '',
    fecha: 'publicadaEn'
  }
]

const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '—')

/** Cuantos dias han pasado desde ese timestamp. Sirve para "lleva 3 dias". */
function diasDesde(t) {
  if (!t?.toDate) return null
  const ms = Date.now() - t.toDate().getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

export default function PanelPorLlegar() {
  const maquilas = useMaquilas()
  const [tareas, setTareas] = useState([])
  const [error, setError] = useState('')

  // Se escucha maquila por maquila, igual que PanelTareasMaquila: useMaquilas
  // ya viene filtrado por mundo, asi que una cuenta de prueba solo se suscribe
  // a la maquila ficticia y una real nunca ve lo de prueba.
  const idsMaquilas = maquilas.map((m) => m.id).join(',')
  useEffect(() => {
    const ids = idsMaquilas ? idsMaquilas.split(',') : []
    return escucharTareasEnsambleDeVarias(ids, setTareas, (err) => {
      console.error('[PorLlegar] Error escuchando tareas:', err)
      setError('No se pudieron cargar los avisos: ' + (err.message || err))
    })
  }, [idsMaquilas])

  const nombreMaquila = (id) => maquilas.find((m) => m.id === id)?.nombre || id

  const porGrupo = useMemo(() => {
    const m = new Map(GRUPOS.map((g) => [g.estado, []]))
    tareas.forEach((t) => {
      if (m.has(t.estado)) m.get(t.estado).push(t)
    })
    return m
  }, [tareas])

  const porLlegar = porGrupo.get('declarada') || []

  /** Lo encargado en esa tarea, sumado por unidad (packs y docenas conviven). */
  const resumenCantidades = (t) => {
    const porUnidad = new Map()
    ;(t.renglones || []).forEach((r) => {
      const u = String(r.unidad || 'packs')
      porUnidad.set(u, (porUnidad.get(u) || 0) + (Number(r.cantidad) || 0))
    })
    return [...porUnidad.entries()].map(([u, n]) => `${n} ${u}`).join(' · ') || '—'
  }

  return (
    <div className="tarjeta">
      <h2>Lo que viene para Producto Terminado</h2>

      {error && <div className="alerta-error">{error}</div>}

      {porLlegar.length > 0 && (
        <div className="alerta-exito">
          <strong>
            {porLlegar.length === 1
              ? 'Hay 1 entrega por llegar.'
              : `Hay ${porLlegar.length} entregas por llegar.`}
          </strong>{' '}
          Las maquilas ya avisaron que terminaron.
        </div>
      )}

      {GRUPOS.map((g) => {
        const lista = porGrupo.get(g.estado) || []
        return (
          <div key={g.estado} style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 2 }}>
              {g.titulo} {lista.length > 0 && <span className="texto-suave">({lista.length})</span>}
            </h3>
            <p className="texto-suave" style={{ marginTop: 0 }}>
              {g.detalle}
            </p>

            {lista.length === 0 ? (
              <p className="texto-suave">Nada por ahora.</p>
            ) : (
              <table className="tabla-datos">
                <thead>
                  <tr>
                    <th>Maquila</th>
                    <th>Pedido / cliente</th>
                    <th>OT</th>
                    <th>Códigos</th>
                    <th>Cantidad encargada</th>
                    <th>Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((t) => {
                    const dias = diasDesde(t[g.fecha])
                    return (
                      <tr key={`${t.maquilaId || ''}-${t.id}`}>
                        <td>{nombreMaquila(t.maquilaId)}</td>
                        <td>{t.titulo || '—'}</td>
                        <td>{t.ot || '—'}</td>
                        <td>{(t.renglones || []).length}</td>
                        <td>{resumenCantidades(t)}</td>
                        <td>
                          {fecha(t[g.fecha])}
                          {dias !== null && (
                            <span className="texto-suave">
                              {' '}
                              {dias === 0 ? '(hoy)' : dias === 1 ? '(ayer)' : `(hace ${dias} días)`}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      <p className="texto-suave" style={{ marginTop: 22 }}>
        Esto es un <strong>aviso</strong>, no la recepción. Cuando la mercancía
        llegue físicamente todavía se revisa a mano: la pantalla para leer el
        código de barras de la remisión y palomear lo que llegó está por
        construirse.
      </p>
    </div>
  )
}
