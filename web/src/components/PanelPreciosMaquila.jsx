// PRECIOS DE ENSAMBLE: lo que se le paga a cada maquila por armar un pack.
//
// Los pone Cielo (y direccion). Es lo que va a imprimir la remision con la que
// la maquila cobra, asi que este numero es dinero: en la junta del 17-08 se
// conto que un error de tarifa costo ~50,000 pesos en una semana. Por eso ni
// Lindbergh, que encarga las tareas, ni el almacen los tocan — y por eso la
// pantalla ensena SIEMPRE quien puso cada precio y cuando.
//
// El precio va por MAQUILA + MODELO. Cada maquila cobra distinto por lo mismo
// (Roberto, 24-08), asi que el mismo modelo puede valer $6 en una y $10 en
// otra.
//
// ⚠️ POR MODELO, NO POR CODIGO. Se hizo al reves primero y estaba mal: el
// archivo real de pagos de Cielo tiene columna MODELO, y ella lo confirmo por
// correo el 24-08 -- "el precio si es el mismo para el modelo en diferentes
// tallas". Un modelo como RBFW26T412 son seis codigos de Quini (una talla y
// color cada uno) que se pagan IGUAL: con la llave por codigo habia que
// teclear seis veces el mismo precio, y en la practica el sexto se quedaba
// sin poner. El modelo lo trae el catalogo, y la tarea de ensamble ya lo
// congela en cada renglon, asi que la remision lo encuentra sola.
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useMaquilas } from './Maquilas'
import { coincide } from '../utils/texto'
import { normalizarModelo } from '../utils/planMaestro'
import { codigoDeBarras, datosDeCodigos } from '../utils/datosDelCatalogo'

const TOPE_PRECIO = 10000

export default function PanelPreciosMaquila() {
  const { perfil, authUser, esAdmin, soloConsulta } = useAuth()
  const maquilas = useMaquilas()
  const [maquilaId, setMaquilaId] = useState('')
  const [cargando, setCargando] = useState(false)
  const [precios, setPrecios] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [nuevo, setNuevo] = useState({ modelo: '', precio: '' })
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')

  const puedeEditar = esAdmin || soloConsulta

  useEffect(() => {
    if (!maquilaId) {
      setPrecios([])
      setCargando(false)
      return
    }
    // Sin este estado la pantalla AFIRMA "todavia no tiene precios" durante el
    // instante en que la suscripcion no ha respondido -- y con 50 modelos ese
    // instante se ve. Roberto lo cazo el 28-08: Hugo Martinez le salia vacio
    // teniendo sus 50 precios cargados. Una pantalla que dice algo falso
    // mientras carga es peor que una que no dice nada.
    setCargando(true)
    const unsub = onSnapshot(
      collection(db, 'portalMaquila', maquilaId, 'preciosEnsamble'),
      // Se descartan los documentos SIN modelo: son del esquema viejo (la
      // llave era el codigo) y no pueden amarrarse a ningun renglon. Pintarlos
      // seria mostrar una fila en blanco que nadie puede corregir ni borrar.
      (snap) => {
        setPrecios(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.modelo)
        )
        setCargando(false)
      },
      (err) => {
        console.error('[Precios] No se pudieron leer:', err)
        setError('No se pudieron leer los precios: ' + (err.message || err))
        setCargando(false)
      }
    )
    return unsub
  }, [maquilaId])

  const filtrados = useMemo(() => {
    const q = busqueda.trim()
    const lista = q
      ? precios.filter(
          (p) =>
            coincide(p.modelo, q) ||
            coincide(p.descripcion || '', q) ||
            coincide(p.codigoBarras || '', q)
        )
      : precios
    return [...lista].sort((a, b) => String(a.modelo).localeCompare(String(b.modelo), 'es'))
  }, [precios, busqueda])

  /**
   * Guarda el precio de un MODELO para esta maquila.
   *
   * Acepta que Cielo teclee un CODIGO de producto o un CODIGO DE BARRAS: los
   * dos se traducen al modelo antes de guardar, porque su archivo de pagos
   * viene mezclado y no tiene por que memorizar cual es cual.
   */
  const guardar = async (modelo, precio, extra = {}) => {
    let limpio = normalizarModelo(modelo)
    const valor = Number(precio)
    let vinoDe = ''
    if (!limpio) {
      setError('Escribe el modelo.')
      return false
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
      let datos = extra
      // Solo se intenta TRADUCIR lo que tiene pinta de codigo o de codigo de
      // barras -- es decir, puro numero. Un texto alfanumerico ("SFT419") se
      // respeta como modelo literal: buscarlo en el catalogo como si fuera un
      // codigo podria devolver el modelo de OTRO articulo que casualmente
      // tenga ese texto como codigo, y el precio se guardaria en el lugar
      // equivocado sin que nadie lo note.
      const pareceCodigo = /^\d{4,20}$/.test(limpio)
      if (pareceCodigo && !precios.some((p) => p.modelo === limpio)) {
        let codigo = ''
        if (limpio.length >= 8) {
          const traducido = await codigoDeBarras(limpio)
          if (traducido) { codigo = traducido; vinoDe = `el codigo de barras ${limpio}` }
        }
        const cat = await datosDeCodigos([codigo || limpio])
        const c = cat.get(codigo || limpio)
        if (c?.modelo) {
          if (!vinoDe) vinoDe = `el codigo ${limpio}`
          limpio = normalizarModelo(c.modelo)
          datos = { descripcion: c.descripcion, ...datos }
        } else {
          // Tecleo algo que parece codigo y el catalogo no lo conoce: NO se
          // guarda. Un numero suelto no es un modelo real, y guardarlo dejaria
          // el precio huerfano para siempre sin que nadie se entere.
          setError(
            `El codigo ${limpio} no esta en el catalogo, asi que no se sabe de que modelo es. ` +
            'Revisa el numero, o escribe directamente el modelo (ej. SFT419).'
          )
          return false
        }
      }
      await setDoc(
        doc(db, 'portalMaquila', maquilaId, 'preciosEnsamble', limpio),
        {
          modelo: limpio,
          maquilaId,
          precioPorPack: valor,
          ...(datos.descripcion ? { descripcion: String(datos.descripcion).slice(0, 200) } : {}),
          ...(extra.codigoBarras ? { codigoBarras: String(extra.codigoBarras).slice(0, 30) } : {}),
          actualizadoEn: serverTimestamp(),
          actualizadoPorUid: authUser.uid,
          actualizadoPorNombre: perfil?.nombreCompleto || ''
        },
        { merge: true }
      )
      setAviso(
        vinoDe
          ? `${vinoDe} es del modelo ${limpio}. Precio: $${valor.toFixed(2)} por docena.`
          : `Precio del modelo ${limpio}: $${valor.toFixed(2)} por docena.`
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
    const ok = await guardar(nuevo.modelo, nuevo.precio)
    if (ok) setNuevo({ modelo: '', precio: '' })
  }

  const nombreMaquila = maquilas.find((m) => m.id === maquilaId)?.nombre || ''
  const fecha = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-MX') : '-')

  return (
    <div className="tarjeta">
      <h2>Precios de ensamble</h2>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: 2 }}>
        Lo que se le paga a cada maquila por <strong>docena</strong> de cada modelo. Es lo que
        imprime su remision, con lo que ella cobra. Un modelo cubre todas sus tallas y colores; cada
        maquila puede tener precios distintos por el mismo modelo.
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
                <span>Modelo</span>
                <input
                  type="text"
                  value={nuevo.modelo}
                  onChange={(e) => setNuevo({ ...nuevo, modelo: e.target.value })}
                  placeholder="ej. SFT419"
                  title="Tambien puedes pegar un codigo de producto o un codigo de barras: se traduce solo al modelo"
                />
              </label>
              <label className="campo" style={{ flex: '1 1 130px', margin: 0 }}>
                <span>Precio por docena</span>
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
            placeholder="Buscar por modelo, barras o descripcion..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ width: '100%', margin: '4px 0 8px', padding: '8px 10px' }}
          />

          <p className="texto-suave" style={{ fontSize: 13 }}>
            {cargando
              ? 'Cargando precios...'
              : precios.length === 0
              ? `${nombreMaquila} todavia no tiene precios. Los modelos sin precio salen en blanco en su remision, para escribirlos a mano.`
              : `${filtrados.length} de ${precios.length} modelos con precio.`}
          </p>

          {filtrados.length > 0 && (
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Codigo de barras</th>
                  <th>Descripcion</th>
                  <th style={{ textAlign: 'right' }}>Precio por docena</th>
                  <th>Lo puso</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.modelo}</strong>
                    </td>
                    <td className="texto-suave" style={{ fontSize: 12 }}>
                      {p.codigoBarras || '-'}
                    </td>
                    <td>{p.descripcion || <span className="texto-suave">-</span>}</td>
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
                              guardar(p.modelo, v, {
                                descripcion: p.descripcion,
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
