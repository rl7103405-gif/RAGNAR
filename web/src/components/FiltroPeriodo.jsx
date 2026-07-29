// Chips de periodo (Dia/Semana/Mes/Año) + navegacion de periodos anteriores,
// compartido por Historial e Indicadores. Mismo patron visual que el
// FiltroPeriodo de captura-mecanicos.
const TIPOS = [
  ['dia', 'Dia'],
  ['semana', 'Semana'],
  ['mes', 'Mes'],
  ['anio', 'Año']
]

export default function FiltroPeriodo({ tipo, setTipo, offset, setOffset, etiqueta }) {
  return (
    <div className="filtros">
      {TIPOS.map(([valor, texto]) => (
        <button
          key={valor}
          className={`chip-filtro ${tipo === valor ? 'activo' : ''}`}
          onClick={() => {
            setTipo(valor)
            setOffset(0)
          }}
        >
          {texto}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      <button className="chip-filtro" onClick={() => setOffset(offset - 1)} title="Periodo anterior">
        ←
      </button>
      <strong style={{ minWidth: 200, textAlign: 'center' }}>{etiqueta}</strong>
      <button
        className="chip-filtro"
        onClick={() => setOffset(offset + 1)}
        disabled={offset >= 0}
        title={offset >= 0 ? 'No hay periodos futuros' : 'Periodo siguiente'}
      >
        →
      </button>
    </div>
  )
}
