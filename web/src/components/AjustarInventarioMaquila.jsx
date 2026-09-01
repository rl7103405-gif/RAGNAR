// LA MAQUILA CORRIGE SU PROPIO INVENTARIO de avios.
//
// Pedido por Roberto el 2026-09-01: "que ellos puedan actualizar inventario o
// editarlo, y que puedan subir un Excel del material que tienen, para que no
// les cueste". Lo marco como TEMPORAL: cuando el ciclo de pedir/recibir este
// completo, el saldo se movera solo y esto dejara de hacer falta.
//
// ⚠️ EL CANDADO QUE HACE QUE ESTO NO ROMPA EL INVENTARIO
//
// El saldo de avios NO es un numero que se sobreescribe: es el final de una
// cadena. Cada movimiento graba `saldoAntes` y `saldoDespues`, y las reglas
// exigen que el saldo se escriba en el MISMO lote que el movimiento que lo
// explica. Si aqui dejaramos "poner 950 y ya", el saldo y su historia
// quedarian contando cosas distintas, y eso no se nota hasta el dia que
// alguien quiere reconstruir que paso — cuando ya no se puede.
//
// Por eso lo que se captura es "cuanto TENGO", y la app calcula la
// DIFERENCIA contra el saldo actual y la escribe como un movimiento de tipo
// 'ajuste_maquila' con motivo obligatorio. El numero final es el que ella
// dice; la diferencia queda explicada y firmada.
import { useMemo, useState } from 'react'
import { writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { useAvios } from './Avios'
import {
  ErrorInventario,
  agregarMovimientosAlLote,
  esChoqueDeSaldo,
  leerSaldos
} from '../utils/inventarioAvios'
import { abrirLibro, cargarWorkbook } from '../utils/excelJs.js'
import { descargarArchivo } from '../utils/excelSalida'

// Las reglas piden 10 caracteres de motivo. Se avisa antes de intentar, para
// no gastarle un viaje al servidor ni darle un 'permission-denied' cuando lo
// que falta es una frase.
const MOTIVO_MINIMO = 10

// El salto de linea de los avisos, en una constante: escribirlo inline se ha
// roto ya una vez al generar este archivo desde un script.
const SALTO = String.fromCharCode(10)

export default function AjustarInventarioMaquila({ saldos, onListo }) {
  const { authUser, perfil } = useAuth()
  const maquilaId = perfil?.maquilaId || ''
  const avios = useAvios()

  const [abierto, setAbierto] = useState(false)
  const [conteo, setConteo] = useState({}) // { codigo: '950' }
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)

  const catalogo = useMemo(() => {
    const m = new Map()
    avios.filter((a) => a.activo !== false).forEach((a) => m.set(a.codigo, a))
    return m
  }, [avios])

  // Lo que se puede ajustar: lo que ya tiene con saldo, mas cualquier avio del
  // catalogo (puede tener algo que nunca se le mando por aqui).
  const renglones = useMemo(() => {
    const porCodigo = new Map()
    for (const s of saldos || []) {
      porCodigo.set(s.codigo, {
        codigo: s.codigo,
        descripcion: s.descripcion || catalogo.get(s.codigo)?.descripcion || '',
        unidad: s.unidad || catalogo.get(s.codigo)?.unidad || 'piezas',
        actual: Number(s.cantidad) || 0
      })
    }
    for (const [codigo, a] of catalogo) {
      if (porCodigo.has(codigo)) continue
      porCodigo.set(codigo, {
        codigo,
        descripcion: a.descripcion || '',
        unidad: a.unidad || 'piezas',
        actual: 0
      })
    }
    return [...porCodigo.values()].sort((x, y) => x.codigo.localeCompare(y.codigo))
  }, [saldos, catalogo])

  /** Solo lo que de verdad cambia: capturar el mismo numero no es un ajuste. */
  const cambios = useMemo(
    () =>
      renglones
        .map((r) => {
          const crudo = String(conteo[r.codigo] ?? '').trim()
          if (crudo === '') return null
          const n = Number(crudo)
          if (!Number.isFinite(n) || n < 0) return { ...r, invalido: crudo }
          // Los avios se cuentan en piezas enteras y las reglas exigen enteros.
          // Truncar '120.5' a 120 en silencio le cambiaria el numero a alguien
          // que creia haber capturado otra cosa: mejor marcarlo y que corrija.
          if (n !== Math.trunc(n)) return { ...r, invalido: crudo, decimal: true }
          const tengo = Math.trunc(n)
          const diferencia = tengo - r.actual
          if (diferencia === 0) return null
          return { ...r, tengo, diferencia }
        })
        .filter(Boolean),
    [renglones, conteo]
  )

  const invalidos = cambios.filter((c) => c.invalido)

  const onArchivo = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo tras corregirlo
    if (!archivo) return
    setError('')
    setAviso('')
    try {
      const libro = await abrirLibro(await archivo.arrayBuffer())
      const hoja = libro.worksheets[0]
      if (!hoja) throw new Error('El archivo no tiene ninguna hoja.')

      // Formato a proposito minimo: CODIGO y CANTIDAD. Se busca el encabezado
      // en las primeras filas en vez de exigir que este en la 1, porque los
      // archivos reales suelen traer un titulo arriba.
      let colCodigo = null
      let colCantidad = null
      let filaEncabezado = 0
      hoja.eachRow((fila, n) => {
        if (colCodigo !== null || n > 10) return
        fila.eachCell((celda, c) => {
          const t = String(celda.text || '').trim().toLowerCase()
          if (t === 'codigo' || t === 'código') colCodigo = c
          if (t === 'cantidad' || t === 'tengo') colCantidad = c
        })
        if (colCodigo !== null && colCantidad !== null) filaEncabezado = n
        else {
          colCodigo = null
          colCantidad = null
        }
      })
      if (colCodigo === null || colCantidad === null) {
        throw new Error(
          'No encontre las columnas. El archivo necesita un renglon con CODIGO y CANTIDAD. ' +
            'Descarga la plantilla de aqui abajo y llena esa.'
        )
      }

      const leidos = {}
      const desconocidos = []
      hoja.eachRow((fila, n) => {
        if (n <= filaEncabezado) return
        const codigo = String(fila.getCell(colCodigo).text || '').trim()
        const cantidadTexto = String(fila.getCell(colCantidad).text || '').trim()
        if (!codigo || cantidadTexto === '') return
        if (!renglones.some((r) => r.codigo === codigo)) {
          if (desconocidos.length < 10) desconocidos.push(codigo)
          return
        }
        leidos[codigo] = cantidadTexto
      })

      const cuantos = Object.keys(leidos).length
      if (!cuantos) {
        throw new Error('No pude leer ningun renglon con codigo y cantidad.')
      }
      setConteo((prev) => ({ ...prev, ...leidos }))
      setAviso(
        `Lei ${cuantos} renglon(es) del archivo.` +
          (desconocidos.length
            ? ` No reconoci estos codigos y los deje fuera: ${desconocidos.join(', ')}.`
            : '') +
          ' Revisa los numeros abajo antes de guardar.'
      )
    } catch (err) {
      console.error('[AjustarInventario] Excel:', err)
      setError('No pude leer el archivo: ' + (err.message || err))
    }
  }

  const descargarPlantilla = async () => {
    try {
      const Workbook = await cargarWorkbook()
      const libro = new Workbook()
      const hoja = libro.addWorksheet('Inventario')
      hoja.columns = [
        { header: 'CODIGO', key: 'codigo', width: 18 },
        { header: 'DESCRIPCION', key: 'descripcion', width: 42 },
        { header: 'UNIDAD', key: 'unidad', width: 12 },
        { header: 'CANTIDAD', key: 'cantidad', width: 14 }
      ]
      hoja.getRow(1).font = { bold: true }
      renglones.forEach((r) => {
        hoja.addRow({
          codigo: r.codigo,
          descripcion: r.descripcion,
          unidad: r.unidad,
          cantidad: r.actual
        })
      })
      const buffer = await libro.xlsx.writeBuffer()
      descargarArchivo(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }),
        'Mi inventario.xlsx'
      )
    } catch (err) {
      console.error('[AjustarInventario] plantilla:', err)
      setError('No se pudo generar la plantilla: ' + (err.message || err))
    }
  }

  const onGuardar = async () => {
    setError('')
    setAviso('')
    if (invalidos.length) {
      const conPunto = invalidos.filter((c) => c.decimal)
      setError(
        conPunto.length
          ? 'Los avios se cuentan en piezas enteras, sin decimales. Corrige: ' +
              conPunto.map((c) => `${c.codigo} (${c.invalido})`).join(', ')
          : 'Hay cantidades que no son numeros validos: ' + invalidos.map((c) => c.codigo).join(', ')
      )
      return
    }
    if (!cambios.length) {
      setError('No cambiaste ninguna cantidad.')
      return
    }
    // Las dos condiciones que pide el servidor, comprobadas ANTES de intentar:
    // largo y que traiga palabras de verdad. La clase de letras es la MISMA
    // que la de la regla (sin acentos, que CEL no maneja): si aqui fuera mas
    // permisiva, un motivo con puras enes podria pasar el cliente y morir en
    // el servidor. Si no, el guardado moriria con un
    // 'permission-denied' que no le dice a nadie que lo que falta es una frase.
    if (motivo.trim().length < MOTIVO_MINIMO || !/[A-Za-z]{4}/.test(motivo)) {
      setError(
        `Escribe por que estas corrigiendo, con palabras (al menos ${MOTIVO_MINIMO} letras). ` +
          'Ejemplo: "conteo fisico del lunes" o "se mojo una caja de etiquetas".'
      )
      return
    }
    // Freno al dedazo: escribir 100000 donde iban 1000 pasa, y las reglas no
    // acotan la magnitud (solo exigen entero y saldo final >= 0). No se
    // prohibe — puede ser real — pero se pregunta aparte, con el numero
    // enfrente, en vez de colarlo dentro del resumen largo.
    const desmedidos = cambios.filter(
      (c) => Math.abs(c.diferencia) > Math.max(1000, c.actual * 10)
    )
    if (desmedidos.length) {
      const detalle = desmedidos
        .map((c) => `${c.codigo}: de ${c.actual} a ${c.tengo}`)
        .join(SALTO)
      if (
        !window.confirm(
          'OJO, estos cambios son muy grandes comparados con lo que tenias:' +
            SALTO + SALTO + detalle + SALTO + SALTO + '¿Son correctos?'
        )
      ) {
        return
      }
    }

    const resumen = cambios
      .slice(0, 12)
      .map((c) => `${c.codigo}: ${c.actual} → ${c.tengo}`)
      .join('\n')
    if (
      !window.confirm(
        `Vas a corregir ${cambios.length} material(es):\n\n${resumen}` +
          (cambios.length > 12 ? `\n...y ${cambios.length - 12} mas` : '') +
          '\n\nQueda registrado con tu nombre y la hora. ¿Confirmas?'
      )
    ) {
      return
    }

    setGuardando(true)
    try {
      // Los saldos se releen JUSTO antes de escribir: entre que se abrio la
      // pantalla y ahora, un envio de Alvaro pudo mover alguno. Las reglas
      // rechazan la cadena si el saldoAntes no es el vigente, asi que sin esto
      // el guardado fallaria en el peor momento en vez de partir del real.
      const codigos = cambios.map((c) => c.codigo)
      const saldosPrevios = await leerSaldos(maquilaId, codigos)

      const renglonesLote = cambios.map((c) => ({
        codigo: c.codigo,
        descripcion: c.descripcion,
        unidad: c.unidad,
        // FIRMADA: la diferencia contra el saldo REAL de este momento, no
        // contra el que se pinto en pantalla hace rato.
        cantidad: Math.trunc(c.tengo) - Math.trunc(Number(saldosPrevios[c.codigo] ?? 0))
      }))
      const utiles = renglonesLote.filter((r) => r.cantidad !== 0)
      if (!utiles.length) {
        setError('Los saldos ya coincidian con lo que capturaste: no habia nada que corregir.')
        setGuardando(false)
        return
      }

      const lote = writeBatch(db)
      const sello = Date.now()
      agregarMovimientosAlLote({
        lote,
        maquilaId,
        renglones: utiles,
        saldosPrevios,
        tipo: 'ajuste_maquila',
        origenTipo: 'conteo',
        motivo: motivo.trim().slice(0, 300),
        movIdDe: (codigo) => `ajm_${sello}_${codigo}`,
        usuario: { uid: authUser.uid, nombre: perfil?.nombreCompleto || '' }
      })
      await lote.commit()

      setAviso(`Listo: corregiste ${utiles.length} material(es). Tu inventario ya quedo actualizado.`)
      setConteo({})
      setMotivo('')
      setAbierto(false)
      if (onListo) onListo()
    } catch (err) {
      console.error('[AjustarInventario] No se pudo guardar:', err)
      if (err instanceof ErrorInventario) {
        setError(err.message)
      } else if (esChoqueDeSaldo(err)) {
        setError(
          'El servidor no acepto la correccion. Puede que alguien haya movido tu inventario ' +
            'en este momento: vuelve a abrir esta pantalla y captura de nuevo.'
        )
      } else {
        setError('No se pudo guardar: ' + (err?.message || err))
      }
    } finally {
      setGuardando(false)
    }
  }

  if (!maquilaId) return null

  if (!abierto) {
    return (
      <div style={{ marginTop: 12 }}>
        <button className="btn-secundario" onClick={() => setAbierto(true)}>
          Corregir mi inventario
        </button>
        <p className="texto-suave" style={{ fontSize: 13, marginTop: 6 }}>
          Si lo que tienes en tu bodega no coincide con lo que dice aqui, corrigelo tu
          mismo. Queda anotado con tu nombre.
        </p>
      </div>
    )
  }

  return (
    <div className="tarjeta" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Corregir mi inventario</h3>
      <p className="texto-suave">
        Escribe <strong>cuanto tienes de verdad</strong> en la ultima columna. Lo que
        dejes en blanco no se toca. La app anota la diferencia con tu nombre y la hora.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '12px 0' }}>
        <button className="btn-secundario" type="button" onClick={descargarPlantilla}>
          Descargar plantilla en Excel
        </button>
        <label className="btn-secundario" style={{ cursor: 'pointer', margin: 0 }}>
          Subir Excel lleno
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={onArchivo}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {error && <div className="alerta-error">{error}</div>}
      {aviso && <div className="alerta-ok">{aviso}</div>}

      <div className="tabla-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="tabla">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Material</th>
              <th>Dice la app</th>
              <th>Tengo de verdad</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {renglones.map((r) => {
              const c = cambios.find((x) => x.codigo === r.codigo)
              return (
                <tr key={r.codigo}>
                  <td>{r.codigo}</td>
                  <td>
                    {r.descripcion || '-'}
                    <span className="texto-suave"> ({r.unidad})</span>
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.actual}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      style={{ width: 100 }}
                      value={conteo[r.codigo] ?? ''}
                      placeholder={String(r.actual)}
                      onChange={(e) =>
                        setConteo((prev) => ({ ...prev, [r.codigo]: e.target.value }))
                      }
                    />
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      color: !c ? '#78838f' : c.invalido ? '#a52218' : c.diferencia > 0 ? '#1a7a3a' : '#a52218'
                    }}
                  >
                    {!c
                      ? '—'
                      : c.decimal
                      ? 'sin decimales'
                      : c.invalido
                      ? 'no es un numero'
                      : c.diferencia > 0
                      ? `+${c.diferencia}`
                      : c.diferencia}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <label className="campo" style={{ marginTop: 12 }}>
        <span>¿Por que lo estas corrigiendo? (obligatorio)</span>
        <input
          type="text"
          value={motivo}
          maxLength={300}
          placeholder="ej. conteo fisico del lunes"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn-primario" onClick={onGuardar} disabled={guardando || !cambios.length}>
          {guardando ? 'Guardando...' : `Guardar ${cambios.length || ''} correccion(es)`}
        </button>
        <button
          className="btn-secundario"
          disabled={guardando}
          onClick={() => {
            setAbierto(false)
            setConteo({})
            setMotivo('')
            setError('')
            setAviso('')
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
