// LO QUE LA MAQUILA TIENE, en dos sub-pestanas.
//
// Roberto, 2026-09-01: "divide en dos sub-pestanas lo del material recibido:
// un inventario de material y un inventario de los calcetines".
//
// Son dos cosas que no se parecen y estaban revueltas en la misma pantalla:
//
//   CALCETINES (producto) ... los bultos que Quini le manda para trabajar.
//                             Se cuentan por ORDEN DE TRABAJO y se devuelven
//                             armados.
//   MATERIAL (avios) ........ plastiflecha, etiquetas, cajas, cinta. Se
//                             consume, se pide a Alvaro y se cuenta por pieza.
//
// El producto va PRIMERO porque es el trabajo; el material es el apoyo.
import { useState } from 'react'
import ResumenBultosMaquila from './ResumenBultosMaquila'
import RecibirAviosMaquila from './RecibirAviosMaquila'

const SUB = [
  { id: 'producto', label: 'Calcetines que tengo' },
  { id: 'material', label: 'Material (avios)' }
]

export default function InventarioMaquila() {
  const [sub, setSub] = useState('producto')

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {SUB.map((s) => (
          <button
            key={s.id}
            className={`tab ${sub === s.id ? 'activo' : ''}`}
            onClick={() => setSub(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sub === 'producto' && <ResumenBultosMaquila />}
      {sub === 'material' && <RecibirAviosMaquila />}
    </>
  )
}
