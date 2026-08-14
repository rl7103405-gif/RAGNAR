// PORTAL DE LA MAQUILA (usuario EXTERNO).
//
// Lo unico que ve una maquila. Lee SOLO de su propia ruta
// (portalMaquila/{suId}/salidas y /acuses): no tiene permiso sobre las
// colecciones de Quini, asi que aqui no hay forma de asomarse a las
// remisiones de otra maquila ni al catalogo.
//
// Que puede hacer:
//   - Ver lo que Quini le mando, agrupado POR OT.
//   - PESAR cada bulto: lee el folio y captura el peso. La app lo compara con
//     el peso que registro Quini y marca la diferencia. Si no cuadra, RECHAZA
//     ese bulto (decision de Roberto, 2026-08-12).
//   - Marcar los que no llegaron y los que llegaron de mas.
// El acuse se guarda UNA vez y no se edita: es su declaracion, y el peso que
// ella midio queda como evidencia de que verifico.
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { compararAscendente } from '../utils/texto'

export default function PortalMaquila() {
  const { authUser, perfil } = useAuth()
  const maquilaId = perfil?.maquilaId || ''
  // SIN fallback: la regla exige recibidoPorNombre == perfil.nombreCompleto.
  // Un '|| Maquila' aqui haria que el acuse se rechazara si el perfil no trae
  // nombre, en vez de guardarlo mal.
  const nombreMaquila = perfil?.nombreCompleto || ''

  const [salidas, setSalidas] = useState([])
  const [acuses, setAcuses] = useState({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [abierta, setAbierta] = useState(null)
  // Borrador del acuse de la remision abierta: { faltantes:Set, sobrantes:'', nota:'' }
  const [borrador, setBorrador] = useState(null)
  const [guardando, setGuardando] = useState(false)
  // Campo del escaner: al leer el folio se salta al peso de ese renglon.
  const [folioEscaneado, setFolioEscaneado] = useState('')
  // Ultimo folio leido: se muestra en grande para confirmar en voz alta que
  // fue el correcto, y da el atajo para pesarlo.
  const [ultimoLeido, setUltimoLeido] = useState(null)

  useEffect(() => {
    if (!maquilaId) {
      setCargando(false)
      return
    }
    const unsubSalidas = onSnapshot(
      query(collection(db, 'portalMaquila', maquilaId, 'salidas'), orderBy('creadoEn', 'desc')),
      (snap) => {
        setSalidas(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setCargando(false)
      },
      (err) => {
        console.error('[PortalMaquila] Error leyendo salidas:', err)
        setError('No se pudieron cargar las remisiones: ' + (err.message || err))
        setCargando(false)
      }
    )
    const unsubAcuses = onSnapshot(
      collection(db, 'portalMaquila', maquilaId, 'acuses'),
      (snap) => {
        const mapa = {}
        snap.docs.forEach((d) => {
          mapa[d.id] = { id: d.id, ...d.data() }
        })
        setAcuses(mapa)
      },
      (err) => console.error('[PortalMaquila] Error leyendo acuses:', err)
    )
    return () => {
      unsubSalidas()
      unsubAcuses()
    }
  }, [maquilaId])

  // Una remision ANULADA (Quini la corrigio y emitio otra) no se confirma:
  // sale aparte para que la maquila no la busque en su lista de pendientes.
  const pendientes = useMemo(
    () => salidas.filter((s) => !acuses[s.id] && !s.anuladaPorRegistroId),
    [salidas, acuses]
  )
  const anuladas = useMemo(() => salidas.filter((s) => s.anuladaPorRegistroId), [salidas])
  const recibidas = useMemo(
    () => salidas.filter((s) => acuses[s.id] && !s.anuladaPorRegistroId),
    [salidas, acuses]
  )

  const fechaHora = (t) =>
    t?.toDate ? `${t.toDate().toLocaleDateString('es-MX')} ${t.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : '-'

  // El avance de la revision se guarda en ESTA computadora mientras se hace:
  // revisar 30 bultos toma rato y cerrar la pestana (o que se vaya la luz) no
  // debe borrar lo que ya se contó. Se limpia al confirmar la remision.
  const claveBorrador = (salidaId) => `ragnar_recepcion_${maquilaId}_${salidaId}`

  const borradorVacio = () => ({
    verificados: new Set(),
    faltantes: new Set(),
    rechazados: new Set(),
    pesos: {},
    sobrantes: '',
    nota: ''
  })

  const leerBorradorGuardado = (salidaId) => {
    try {
      const crudo = localStorage.getItem(claveBorrador(salidaId))
      if (!crudo) return null
      const d = JSON.parse(crudo)
      return {
        verificados: new Set(d.verificados || []),
        faltantes: new Set(d.faltantes || []),
        rechazados: new Set(d.rechazados || []),
        pesos: d.pesos || {},
        sobrantes: d.sobrantes || '',
        nota: d.nota || ''
      }
    } catch {
      // Un borrador ilegible no vale la pena: se arranca de cero.
      return null
    }
  }

  const guardarBorrador = (salidaId, b) => {
    try {
      localStorage.setItem(
        claveBorrador(salidaId),
        JSON.stringify({
          verificados: [...b.verificados],
          faltantes: [...b.faltantes],
          rechazados: [...b.rechazados],
          pesos: b.pesos,
          sobrantes: b.sobrantes,
          nota: b.nota
        })
      )
    } catch (e) {
      // Sin localStorage (modo privado, disco lleno) se sigue trabajando: solo
      // se pierde el avance si cierran la pestana.
      console.warn('[PortalMaquila] No se pudo guardar el avance local:', e)
    }
  }

  // Todo cambio del borrador pasa por aqui, para que el avance quede guardado
  // sin tener que acordarse en cada handler.
  const cambiarBorrador = (salidaId, fn) =>
    setBorrador((prev) => {
      const siguiente = fn(prev)
      guardarBorrador(salidaId, siguiente)
      return siguiente
    })

  const abrir = (salida) => {
    if (abierta === salida.id) {
      setAbierta(null)
      setBorrador(null)
      return
    }
    setAbierta(salida.id)
    setError('')
    setBorrador(leerBorradorGuardado(salida.id) || borradorVacio())
    setFolioEscaneado('')
  }

  const onAcusar = async (salida) => {
    setError('')
    setAviso('')
    const faltantes = [...(borrador?.faltantes || [])].sort(compararAscendente)
    const rechazados = [...(borrador?.rechazados || [])].sort(compararAscendente)
    const sobrantes = String(borrador?.sobrantes || '')
      .split(/[\s,;]+/)
      .map((f) => f.trim())
      .filter(Boolean)
      .sort(compararAscendente)
    const nota = String(borrador?.nota || '').trim()
    // Los pesos que la maquila midio, folio por folio. Solo los que capturo.
    const pesados = (salida.renglones || [])
      .filter((r) => String(borrador?.pesos?.[r.folio] ?? '').trim() !== '')
      .map((r) => ({
        folio: r.folio,
        pesoGramos: Math.round(Number(borrador.pesos[r.folio]) * 1000),
        pesoQuiniGramos: Math.round(Number(r.pesoGramos) || 0)
      }))
    const hayDiferencias =
      faltantes.length > 0 || rechazados.length > 0 || sobrantes.length > 0 || nota.length > 0
    const resultado = hayDiferencias ? 'con_diferencias' : 'completo'

    // Aviso extra si quedaron bultos sin revisar: confirmar "completa" sin
    // haberlos contado es justo el error que este modulo quiere evitar.
    const sinRevisar = (salida.renglones || []).filter(
      (r) => !borrador?.verificados?.has(r.folio) && !borrador?.faltantes?.has(r.folio)
    )
    const avisoSinRevisar =
      sinRevisar.length > 0
        ? `OJO: ${sinRevisar.length} de ${(salida.renglones || []).length} bultos no los revisaste ` +
          `uno por uno (${sinRevisar.slice(0, 8).map((r) => r.folio).join(', ')}` +
          `${sinRevisar.length > 8 ? '...' : ''}).\nSi los diste por buenos a simple vista, adelante.\n\n`
        : ''

    const texto = avisoSinRevisar + (hayDiferencias
      ? `Vas a reportar que la remision ${salida.folioInterno} llego CON DIFERENCIAS:\n\n` +
        (faltantes.length > 0 ? `Faltaron ${faltantes.length}: ${faltantes.slice(0, 12).join(', ')}\n` : '') +
        (rechazados.length > 0
          ? `RECHAZAS ${rechazados.length} por peso: ${rechazados.slice(0, 12).join(', ')}\n`
          : '') +
        (sobrantes.length > 0 ? `Llegaron de mas ${sobrantes.length}: ${sobrantes.slice(0, 12).join(', ')}\n` : '') +
        (nota ? `Nota: ${nota}\n` : '') +
        '\nEsto NO rechaza la remision: queda el aviso para que Quini lo revise.\n\n¿Confirmas?'
      : `Vas a confirmar que recibiste COMPLETA la remision ${salida.folioInterno}: ` +
        `${salida.totalFolios} bultos, ${salida.totalDocenas} docenas.\n\n` +
        'Esto no se puede editar despues. ¿Confirmas?')
    if (!window.confirm(texto)) return

    setGuardando(true)
    try {
      // ID determinista = el de la remision: una remision, un acuse. Las
      // reglas ademas prohiben editarlo o borrarlo.
      await setDoc(doc(db, 'portalMaquila', maquilaId, 'acuses', salida.id), {
        registroId: salida.id,
        maquilaId,
        resultado,
        foliosFaltantes: faltantes,
        foliosSobrantes: sobrantes,
        foliosRechazados: rechazados,
        pesados,
        comentario: nota.slice(0, 300),
        recibidoPorUid: authUser.uid,
        recibidoPorNombre: nombreMaquila,
        creadoEn: serverTimestamp()
      })
      setAviso(
        hayDiferencias
          ? `Reportaste la remision ${salida.folioInterno} con diferencias. Quini ya lo ve.`
          : `Confirmaste la remision ${salida.folioInterno} completa. Gracias.`
      )
      // El avance local ya no sirve: el acuse quedo firmado y no se edita.
      try {
        localStorage.removeItem(claveBorrador(salida.id))
      } catch {
        // Da igual: el borrador viejo se ignora si la remision ya tiene acuse.
      }
      setAbierta(null)
      setBorrador(null)
      setUltimoLeido(null)
    } catch (err) {
      console.error('[PortalMaquila] No se pudo guardar el acuse:', err)
      setError('No se pudo guardar: ' + (err.message || err))
    } finally {
      setGuardando(false)
    }
  }

  if (!maquilaId) {
    return (
      <div className="tarjeta">
        <h2>Tu cuenta no tiene una maquila asignada</h2>
        <p>Avisale a Roberto para que la configure. No es un problema de tu contrasena.</p>
      </div>
    )
  }

  // La regla exige que el acuse se firme con el nombre EXACTO del perfil: sin
  // nombre no se puede firmar, y es mejor decirlo que dejar que truene.
  if (!nombreMaquila) {
    return (
      <div className="tarjeta">
        <h2>Falta el nombre en tu perfil</h2>
        <p>
          Tu cuenta no tiene nombre configurado y sin eso no se puede firmar la recepcion.
          Avisale a Roberto.
        </p>
      </div>
    )
  }

  const renglonesPorOt = (salida) => {
    const mapa = new Map()
    ;(salida.renglones || []).forEach((r) => {
      const ot = r.ot || 'SIN OT'
      if (!mapa.has(ot)) mapa.set(ot, [])
      mapa.get(ot).push(r)
    })
    return [...mapa.entries()]
      .sort(([a], [b]) => (a === 'SIN OT' ? 1 : b === 'SIN OT' ? -1 : compararAscendente(a, b)))
      .map(([ot, filas]) => ({
        ot,
        filas: filas.sort((x, y) => compararAscendente(x.folio, y.folio)),
        docenas: Math.round(filas.reduce((a, f) => a + (f.docenas || 0), 0) * 100) / 100
      }))
  }

  const tarjetaSalida = (salida, yaAcusada) => {
    const acuse = acuses[salida.id]
    const estaAbierta = abierta === salida.id
    const grupos = renglonesPorOt(salida)
    // Contadores del modulo de recepcion: un bulto cuenta como revisado si se
    // leyo/palomeo, o si ya se dijo que NO llego (tambien es una decision
    // tomada). Asi el "vas X de Y" no se queda corto por los faltantes.
    const totalBultos = (salida.renglones || []).length
    const revisados = (salida.renglones || []).filter(
      (r) => borrador?.verificados?.has(r.folio) || borrador?.faltantes?.has(r.folio)
    ).length
    const faltanPorRevisar = Math.max(0, totalBultos - revisados)
    return (
      <div
        key={salida.id}
        style={{
          border: '1px solid',
          borderColor: yaAcusada ? '#d8dee6' : '#f0c98a',
          background: yaAcusada ? '#fff' : '#fffdf7',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 12
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
          <strong style={{ fontSize: 17 }}>Remision {salida.folioInterno}</strong>
          <span className="texto-suave" style={{ fontSize: 13 }}>
            {salida.fechaTexto} · {salida.totalFolios} bultos · {salida.totalDocenas} docenas ·{' '}
            {(salida.pesoTotalGramos / 1000).toFixed(2)} kg
          </span>
          <span style={{ fontSize: 12, background: '#eef2f7', borderRadius: 999, padding: '2px 10px' }}>
            OT {(salida.ots || []).join(', ') || '-'}
          </span>
          {acuse && (
            <span
              style={{
                fontSize: 12,
                borderRadius: 999,
                padding: '2px 10px',
                background: acuse.resultado === 'completo' ? '#e8f5ec' : '#fff4e0',
                color: acuse.resultado === 'completo' ? '#1a7a3a' : '#8a5300'
              }}
            >
              {acuse.resultado === 'completo' ? 'Recibida completa' : 'Recibida con diferencias'} ·{' '}
              {fechaHora(acuse.creadoEn)}
            </span>
          )}
        </div>

        {acuse && acuse.resultado !== 'completo' && (
          <p className="texto-suave" style={{ fontSize: 13, margin: '6px 0 0' }}>
            {acuse.foliosFaltantes?.length > 0 && (
              <>Faltaron: {acuse.foliosFaltantes.join(', ')}. </>
            )}
            {acuse.foliosSobrantes?.length > 0 && (
              <>De mas: {acuse.foliosSobrantes.join(', ')}. </>
            )}
            {acuse.foliosRechazados?.length > 0 && (
              <>
                <strong style={{ color: '#a00' }}>
                  Rechazados por peso: {acuse.foliosRechazados.join(', ')}.
                </strong>{' '}
              </>
            )}
            {acuse.comentario}
          </p>
        )}

        <button className="btn-secundario" style={{ marginTop: 8 }} onClick={() => abrir(salida)}>
          {estaAbierta ? 'Cerrar' : yaAcusada ? 'Ver los bultos' : 'Revisar y confirmar'}
        </button>

        {estaAbierta && (
          <div style={{ marginTop: 10 }}>
            {!yaAcusada && (
              <div
                style={{
                  background: '#eef2f7',
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 10
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
                  <label className="campo" style={{ marginBottom: 0, flex: '1 1 260px', maxWidth: 340 }}>
                    <span>Escanea el folio del bulto</span>
                    <input
                      type="text"
                      autoFocus
                      placeholder="escanea o teclea el folio"
                      style={{ fontSize: 18 }}
                      value={folioEscaneado}
                      onChange={(e) => setFolioEscaneado(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        const folio = folioEscaneado.trim()
                        if (!folio) return
                        const existe = (salida.renglones || []).some((x) => x.folio === folio)
                        if (!existe) {
                          setError(
                            `El folio ${folio} NO viene en esta remision. Si te llego de mas, ` +
                              'anotalo abajo en "bultos que no vienen en la lista".'
                          )
                          setUltimoLeido(null)
                          setFolioEscaneado('')
                          return
                        }
                        setError('')
                        setFolioEscaneado('')
                        // Contarlo: eso es "ya lo tengo". El peso es aparte y
                        // opcional -- hay quien revisa a simple vista.
                        cambiarBorrador(salida.id, (prev) => {
                          const verificados = new Set(prev.verificados)
                          verificados.add(folio)
                          // Si estaba marcado como faltante y aparecio, deja
                          // de faltar: si no, el acuse se contradiria solo.
                          const faltantes = new Set(prev.faltantes)
                          faltantes.delete(folio)
                          return { ...prev, verificados, faltantes }
                        })
                        setUltimoLeido(folio)
                      }}
                    />
                  </label>
                  <div style={{ flex: '1 1 200px' }}>
                    <div style={{ fontSize: 15 }}>
                      Vas{' '}
                      <strong style={{ fontSize: 22 }}>
                        {revisados} de {totalBultos}
                      </strong>{' '}
                      bultos
                    </div>
                    <div
                      style={{
                        height: 12,
                        borderRadius: 999,
                        background: '#dbe3ec',
                        overflow: 'hidden',
                        marginTop: 4
                      }}
                    >
                      <div
                        style={{
                          width: `${totalBultos ? (revisados / totalBultos) * 100 : 0}%`,
                          height: '100%',
                          background: revisados >= totalBultos ? '#2e7d4f' : '#2563eb',
                          transition: 'width .25s'
                        }}
                      />
                    </div>
                    {faltanPorRevisar > 0 && (
                      <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
                        faltan {faltanPorRevisar} por revisar
                      </div>
                    )}
                  </div>
                </div>

                {ultimoLeido && (
                  <div
                    className="alerta-exito"
                    style={{ marginTop: 8, marginBottom: 0, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
                  >
                    <span>
                      <strong>{ultimoLeido}</strong> contado
                      {(() => {
                        const r = (salida.renglones || []).find((x) => x.folio === ultimoLeido)
                        return r ? ` · ${r.codigo || 's/codigo'} · ${r.docenas || '?'} doc` : ''
                      })()}
                    </span>
                    <button
                      type="button"
                      className="btn-secundario"
                      onClick={() => {
                        const campo = document.getElementById(`peso-${ultimoLeido}`)
                        if (campo) {
                          campo.focus()
                          campo.select()
                          campo.scrollIntoView({ block: 'center', behavior: 'smooth' })
                        }
                      }}
                    >
                      Pesarlo (opcional)
                    </button>
                  </div>
                )}

                <p className="texto-suave" style={{ fontSize: 12, margin: '6px 0 0' }}>
                  Con leer el folio ya cuenta como revisado. <strong>Pesarlo es opcional</strong>: si
                  lo pesas y no cuadra con el peso de Quini, te sale la diferencia y puedes marcar{' '}
                  <strong>¿Rechazas?</strong> en ese renglon. Si prefieres, palomea a mano con el
                  boton <strong>Ya lo tengo</strong> de cada bulto.
                </p>
              </div>
            )}
            {grupos.map((g) => (
              <div key={g.ot} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, background: '#eef2f7', padding: '4px 8px', borderRadius: 4 }}>
                  {g.ot === 'SIN OT' ? 'SIN ORDEN DE TRABAJO' : `OT ${g.ot}`}
                  <span style={{ fontWeight: 400, fontSize: 13, marginLeft: 8, color: '#556' }}>
                    {g.filas.length} bultos · {g.docenas} docenas
                  </span>
                </div>
                <table className="tabla-datos" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      {!yaAcusada && <th title="Palomea el bulto que ya tienes enfrente">Revisado</th>}
                      {!yaAcusada && <th title="Marca los que NO llegaron">¿Falto?</th>}
                      <th>Folio</th>
                      <th>Codigo</th>
                      <th>Producto</th>
                      <th>Docenas</th>
                      <th>Peso Quini (kg)</th>
                      {!yaAcusada && <th>Tu peso (kg)</th>}
                      {!yaAcusada && <th title="Si el peso no cuadra">¿Rechazas?</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.filas.map((r) => {
                      const yaLoTengo = borrador?.verificados?.has(r.folio) || false
                      const noLlego = borrador?.faltantes?.has(r.folio) || false
                      return (
                      <tr
                        key={r.folio}
                        style={{
                          background: noLlego ? '#fff1f1' : yaLoTengo ? '#f2faf4' : undefined
                        }}
                      >
                        {!yaAcusada && (
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              className={yaLoTengo ? 'btn-primario' : 'btn-secundario'}
                              style={{ padding: '2px 10px', fontSize: 12 }}
                              onClick={() =>
                                cambiarBorrador(salida.id, (prev) => {
                                  const verificados = new Set(prev.verificados)
                                  const faltantes = new Set(prev.faltantes)
                                  if (verificados.has(r.folio)) {
                                    verificados.delete(r.folio)
                                  } else {
                                    verificados.add(r.folio)
                                    // Palomearlo lo saca de faltantes: no puede
                                    // estar y no estar al mismo tiempo.
                                    faltantes.delete(r.folio)
                                  }
                                  return { ...prev, verificados, faltantes }
                                })
                              }
                            >
                              {yaLoTengo ? '✓ lo tengo' : 'Ya lo tengo'}
                            </button>
                          </td>
                        )}
                        {!yaAcusada && (
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={noLlego}
                              onChange={() =>
                                cambiarBorrador(salida.id, (prev) => {
                                  const faltantes = new Set(prev.faltantes)
                                  const verificados = new Set(prev.verificados)
                                  if (faltantes.has(r.folio)) {
                                    faltantes.delete(r.folio)
                                  } else {
                                    faltantes.add(r.folio)
                                    // Decir que no llego lo quita de contados.
                                    verificados.delete(r.folio)
                                  }
                                  return { ...prev, faltantes, verificados }
                                })
                              }
                            />
                          </td>
                        )}
                        <td id={`folio-${r.folio}`}>{r.folio}</td>
                        <td>{r.codigo || '-'}</td>
                        <td>{r.descripcion || '-'}</td>
                        <td>{r.docenas || '-'}</td>
                        <td>{((r.pesoGramos || 0) / 1000).toFixed(2)}</td>
                        {!yaAcusada && (
                          <td>
                            <input
                              id={`peso-${r.folio}`}
                              type="number"
                              min="0"
                              step="0.01"
                              style={{ width: 90 }}
                              placeholder="pesa"
                              value={borrador?.pesos?.[r.folio] ?? ''}
                              onChange={(e) =>
                                cambiarBorrador(salida.id, (prev) => {
                                  // Pesarlo tambien cuenta como revisado: si
                                  // se molesto en subirlo a la bascula, ya lo
                                  // tiene enfrente.
                                  const verificados = new Set(prev.verificados)
                                  const faltantes = new Set(prev.faltantes)
                                  if (String(e.target.value).trim()) {
                                    verificados.add(r.folio)
                                    faltantes.delete(r.folio)
                                  }
                                  return {
                                    ...prev,
                                    verificados,
                                    faltantes,
                                    pesos: { ...prev.pesos, [r.folio]: e.target.value }
                                  }
                                })
                              }
                            />
                            {(() => {
                              const capturado = Number(borrador?.pesos?.[r.folio])
                              if (!Number.isFinite(capturado) || capturado <= 0) return null
                              const quini = (Number(r.pesoGramos) || 0) / 1000
                              const dif = capturado - quini
                              const pct = quini > 0 ? Math.abs(dif / quini) * 100 : 100
                              // 2% de tolerancia: por debajo es basculas
                              // distintas, por arriba hay que verlo.
                              const ok = pct <= 2
                              return (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: ok ? '#1a7a3a' : '#a00',
                                    fontWeight: ok ? 400 : 700
                                  }}
                                >
                                  {ok
                                    ? 'cuadra'
                                    : `${dif > 0 ? '+' : ''}${dif.toFixed(2)} kg (${pct.toFixed(1)}%)`}
                                </div>
                              )
                            })()}
                          </td>
                        )}
                        {!yaAcusada && (
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={borrador?.rechazados?.has(r.folio) || false}
                              onChange={() =>
                                cambiarBorrador(salida.id, (prev) => {
                                  const nueva = new Set(prev.rechazados)
                                  if (nueva.has(r.folio)) nueva.delete(r.folio)
                                  else nueva.add(r.folio)
                                  return { ...prev, rechazados: nueva }
                                })
                              }
                            />
                          </td>
                        )}
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}

            {!yaAcusada && (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                <label className="campo">
                  <span>¿Llego algun bulto que NO viene en la lista? (folios separados por coma)</span>
                  <input
                    type="text"
                    placeholder="ej. 445300, 445301"
                    value={borrador?.sobrantes || ''}
                    onChange={(e) =>
                      cambiarBorrador(salida.id, (p) => ({ ...p, sobrantes: e.target.value }))
                    }
                  />
                </label>
                <label className="campo">
                  <span>Nota (opcional): algo dañado, mojado, mal contado...</span>
                  <input
                    type="text"
                    maxLength={300}
                    placeholder="ej. el folio 445210 llego con 2 pares menos"
                    value={borrador?.nota || ''}
                    onChange={(e) => cambiarBorrador(salida.id, (p) => ({ ...p, nota: e.target.value }))}
                  />
                </label>
                {faltanPorRevisar > 0 && (
                  <p style={{ fontSize: 13, color: '#8a5300', margin: '4px 0' }}>
                    Te faltan <strong>{faltanPorRevisar}</strong> bulto
                    {faltanPorRevisar === 1 ? '' : 's'} por revisar de {totalBultos}. Puedes
                    confirmar de todos modos si ya los diste por buenos a simple vista.
                  </p>
                )}
                <p className="texto-suave" style={{ fontSize: 13 }}>
                  {borrador?.faltantes?.size > 0 ||
                  borrador?.rechazados?.size > 0 ||
                  borrador?.sobrantes?.trim() ||
                  borrador?.nota?.trim() ? (
                    <strong style={{ color: '#8a5300' }}>
                      Se va a reportar CON DIFERENCIAS. La remision no se rechaza: queda el aviso.
                    </strong>
                  ) : (
                    <>Si todo llego bien, solo pica el boton verde.</>
                  )}
                </p>
                <button
                  className="btn-primario"
                  disabled={guardando}
                  onClick={() => onAcusar(salida)}
                >
                  {guardando
                    ? 'Guardando...'
                    : borrador?.faltantes?.size > 0 ||
                        borrador?.rechazados?.size > 0 ||
                        borrador?.sobrantes?.trim() ||
                        borrador?.nota?.trim()
                      ? 'Reportar diferencias y confirmar recepcion'
                      : 'Confirmo que recibi todo'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 12 }}>{aviso}</div>}
      {cargando && <p className="texto-suave">Cargando...</p>}

      <div className="tarjeta" style={{ marginBottom: 18 }}>
        <h2>Por recibir ({pendientes.length})</h2>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
          Estas remisiones van en camino o ya llegaron y falta confirmarlas. Abre cada una y ve
          leyendo el folio de cada bulto: la pantalla te lleva la cuenta (<strong>vas 5 de 30</strong>).
          Pesarlos es opcional, tu decides si lo verificas con bascula o a simple vista. Si falta
          algo, marcalo: no se rechaza nada, solo queda el aviso para Quini.{' '}
          <strong>El avance no se pierde</strong> si cierras la pagina a media revision.
        </p>
        {!cargando && pendientes.length === 0 ? (
          <p className="texto-suave">No tienes remisiones pendientes de confirmar.</p>
        ) : (
          pendientes.map((s) => tarjetaSalida(s, false))
        )}
      </div>

      {anuladas.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 18 }}>
          <h2>Canceladas por Quini ({anuladas.length})</h2>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
            Estas remisiones se corrigieron: <strong>ya no van</strong>. Busca la remision nueva
            que las sustituye en la lista de arriba. No hay que confirmarlas.
          </p>
          {anuladas.map((s) => (
            <div
              key={s.id}
              style={{
                border: '1px solid #e2c9c9',
                background: '#fdf6f6',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 8
              }}
            >
              <strong style={{ textDecoration: 'line-through' }}>Remision {s.folioInterno}</strong>{' '}
              <span className="texto-suave" style={{ fontSize: 13 }}>
                {s.fechaTexto} · {s.totalFolios} bultos · CANCELADA
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="tarjeta">
        <h2>Ya confirmadas ({recibidas.length})</h2>
        {!cargando && recibidas.length === 0 ? (
          <p className="texto-suave">Aun no has confirmado ninguna remision.</p>
        ) : (
          recibidas.map((s) => tarjetaSalida(s, true))
        )}
      </div>
    </>
  )
}
