// PRECIOS DE ENSAMBLE: lo que se le paga a cada maquila por armar un pack.
//
// Los pone Cielo (y direccion). Es lo que va a imprimir la remision con la que
// la maquila cobra, asi que este numero es dinero: en la junta del 17-08 se
// conto que un error de tarifa costo ~50,000 pesos en una semana. Por eso ni
// Lindbergh, que encarga las tareas, ni el almacen los tocan — y por eso la
// pantalla ensena SIEMPRE quien puso cada precio y cuando.
//
// El precio va por MAQUILA + CODIGO. Cada maquila cobra distinto por lo mismo
// (Roberto, 24-08), asi que el mismo codigo puede valer $6 en una y $10 en
// otra. Se guarda por codigo y no por modelo porque el codigo es inequivoco:
// un modelo como "REEBOK" agrupa cosas que no necesariamente se pagan igual.
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { coincide } from '../utils/texto'
import { codigoDeBarras, datosDeCodigos } from '../utils/datosDelCatalogo'

const TOPE_PRECIO = 10000

export default function PanelPreciosMaquila() {
  const { perfil, authUser, esAdmin, soloConsulta } = useAuth()
  const maquilas = useMaquilas()
  const [maquilaId, setMaquilaId] = useState('')
  const [precios, setPrecios] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [nuevo, setNuevo] = useState({ codigo: '', precio: '' })
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')

  const puedeEditar = esAdmin || soloConsulta

  useEffect(() => {
    if (!maquilaId) {
      setPrecios([])
      return
    }
    const unsub = onSnapshot(
      collection(db, 'portalMaquila', maquilaId, 'preciosEnsamble'),
      (snap) => setPrecios(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error('[Precios] No se pudieron leer:', err)
        setError('No se pudieron leer los precios: ' + (err.message || err))
      }
    )
    return unsub
  }, [maquilaId])

  const filtrados = useMemo(() => {
    const q = busqueda.trim()
    const lista = q
      ? precios.filter(
          (p) =>
            coincide(p.codigo, q) ||
            coincide(p.descripcion || '', q) ||
            coincide(p.modelo || '', q) ||
            coincide(p.codigoBarras || '', q)
        )
      : precios
    return [...lista].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es'))
  }, [precios, busqueda])

  const guardar = async (codigo, precio, extra = {}) => {
    let limpio = String(codigo || '').trim().toUpperCase()
    const valor = Number(precio)
    let barras = ''
    if (!limpio) {
      setError('Escribe el codigo.')
      return false
    }
    // Cielo trabaja con el archivo de pagos, que identifica el producto por
    // CODIGO DE BARRAS, no por el codigo de Quini. Si lo que tecleo parece un
    // codigo de barras, la app lo traduce sola en vez de hacerla buscarlo.
    // Solo se intenta cuando NO existe ya un precio con ese texto como codigo,
    // ni el texto es ya un codigo valido del catalogo: hay codigos de Quini
    // que son puro numero, y no hay que secuestrarlos.
    if (/^\d{8,20}$/.test(limpio) && !precios.some((p) => p.codigo === limpio)) {
      const cat = await datosDeCodigos([limpio])
      if (!cat.has(limpio)) {
        const traducido = await codigoDeBarras(limpio)
        if (traducido) {
          barras = limpio
          limpio = traducido
        }
      }
    }
    // Las mismas cotas que exige el servidor, dichas aqui para que el error
    // llegue antes y con palabras, no como un permission-denied.
    if (!Number.isFinite(valor) || valor <= 0) {
      setError(`El precio de ${limpio} tiene que ser mayor que cero.`)
      return false
    }
    if (valor > TOPE_PRECIO) {
      setError(`El precio de ${limpio} (${valor}) se ve demasiado alto. Revisalo.`)
      return false
    }
    setError('')
    setGuardando(true)
    try {
      // Se completa con el catalogo para que la tabla se lea: quien revise los
      // precios necesita ver QUE es cada codigo, no solo el numero.
      let datos = extra
      if (!datos.descripcion) {
        const cat = await datosDeCodigos([limpio])
        const c = cat.get(limpio)
        if (c) datos = { descripcion: c.descripcion, modelo: c.modelo }
      }
      await setDoc(
        doc(db, 'portalMaquila', maquilaId, 'preciosEnsamble', limpio),
        {
          codigo: limpio,
          maquilaId,
          precioPorPack: valor,
          ...(datos.descripcion ? { descripcion: String(datos.descripcion).slice(0, 200) } : {}),
          ...(datos.modelo ? { modelo: String(datos.modelo).slice(0, 60) } : {}),
          ...(barras || extra.codigoBarras
            ? { codigoBarras: String(barras || extra.codigoBarras).slice(0, 30) }
            : {}),
          actualizadoEn: serverTimestamp(),
          actualizadoPorUid: authUser.uid,
          actualizadoPorNombre: perfil?.nombreCompleto || ''
        },
        { merge: true }
      )
      setAviso(
        barras
          ? `El codigo de barras ${barras} es el codigo ${limpio}. Precio: $${valor.toFixed(2)} por pack.`
          : `Precio de ${limpio}: $${valor.toFixed(2)} por pack.`
      )
      return true
    } catch (err) {
      console.error('[Precios] No se pudo guardar:', err)
      setError('No se pudo guardar: ' + (err.message || err))
      return false
    } finally {
      setGuardando(false)
    }
  }

  const onAgregar = async (e) => {
    e.preventDefault()
    const ok = await guardar(nuevo.codigo, nuevo.precio)
    if (ok) setNuevo({ codigo: '', precio: '' })
  }

  const nombreMaquila = maquilas.find((m) => m.id === maquilaId)?.nombre || ''
  const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '-')

  return (
    <div className="tarjeta">
      <h2>Precios de ensamble</h2>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
        Lo que se le paga a cada maquila por armar <strong>un pack</strong> de cada codigo. Es lo que
        imprime su remision, con lo que ella cobra. Cada maquila puede tener precios distintos por el
        mismo codigo.
      </p>

      {error && <div className="alerta-error" style={{ marginBottom: 8 }}>{error}</div>}
      {aviso && <div className="alerta-exito" style={{ marginBottom: 8 }}>{aviso}</div>}

      <label className="campo" style={{ maxWidth: 340 }}>
        <span>Maquila</span>
        <select value={maquilaId} onChange={(e) => setMaquilaId(e.target.value)}>
          <option value="">Elige la maquila</option>
          {maquilas
            .filter((m) => m.activo !== false)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
        </select>
      </label>

      {!maquilaId && (
        <p className="texto-suave">Elige una maquila para ver y poner sus precios.</p>
      )}

      {maquilaId && (
        <>
          {puedeEditar && (
            <form
              onSubmit={onAgregar}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', margin: '12px 0' }}
            >
              <label className="campo" style={{ flex: '1 1 160px', margin: 0 }}>
                <span>Codigo o codigo de barras</span>
                <input
                  type="text"
                  value={nuevo.codigo}
                  onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
                  placeholder="ej. 1066 o 7506097258490"
                />
              </label>
              <label className="campo" style={{ flex: '1 1 130px', margin: 0 }}>
                <span>Precio por pack</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={nuevo.precio}
                  onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })}
                  placeholder="ej. 10.00"
                />
              </label>
              <button className="btn-primario" type="submit" disabled={guardando}>
                {guardando ? 'Guardando...' : 'Poner precio'}
              </button>
            </form>
          )}

          <input
            type="search"
            placeholder="Buscar por codigo, barras, descripcion o modelo..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ width: '100%', margin: '4px 0 8px', padding: '8px 10px' }}
          />

          <p className="texto-suave" style={{ fontSize: 13 }}>
            {precios.length === 0
              ? `${nombreMaquila} todavia no tiene precios. Los codigos sin precio salen en blanco en su remision, para escribirlos a mano.`
              : `${filtrados.length} de ${precios.length} codigos con precio.`}
          </p>

          {filtrados.length > 0 && (
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Codigo de barras</th>
                  <th>Descripcion</th>
                  <th>Modelo</th>
                  <th style={{ textAlign: 'right' }}>Precio por pack</th>
                  <th>Lo puso</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.codigo}</strong>
                    </td>
                    <td className="texto-suave" style={{ fontSize: 12 }}>
                      {p.codigoBarras || '-'}
                    </td>
                    <td>{p.descripcion || <span className="texto-suave">-</span>}</td>
                    <td>{p.modelo || <span className="texto-suave">-</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {puedeEditar ? (
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          defaultValue={p.precioPorPack}
                          style={{ width: 90, textAlign: 'right' }}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== p.precioPorPack) {
                              guardar(p.codigo, v, {
                                descripcion: p.descripcion,
                                modelo: p.modelo,
                                codigoBarras: p.codigoBarras
                              })
                            }
                          }}
                        />
                      ) : (
                        '$ ' + Number(p.precioPorPack).toFixed(2)
                      )}
                    </td>
                    {/* Quien y cuando, siempre a la vista: es dinero, y saber
                        de quien fue el ultimo cambio evita discusiones. */}
                    <td className="texto-suave" style={{ fontSize: 12 }}>
                      {p.actualizadoPorNombre || '-'} · {fecha(p.actualizadoEn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
