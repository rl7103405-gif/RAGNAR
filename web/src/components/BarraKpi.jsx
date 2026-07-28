// Lista de barras horizontales simple (sin libreria de graficas), mismo
// componente que usa captura-mecanicos en su panel de indicadores.
export default function BarraKpi({ datos, sufijo = '', color = '#1d4ed8', etiqueta }) {
  const max = Math.max(1, ...datos.map((d) => d.valor))
  if (!datos.length) return <p style={{ color: '#777' }}>Sin datos.</p>
  return (
    <div className="barras">
      {datos.map((d) => (
        <div className="barra-fila" key={d.clave}>
          <span className="barra-etq" title={d.clave}>{etiqueta ? etiqueta(d.clave) : d.clave}</span>
          <div className="barra-pista">
            <div
              className="barra-rel"
              style={{ width: `${(d.valor / max) * 100}%`, background: color }}
            />
          </div>
          <span className="barra-val">{d.valor}{sufijo}</span>
        </div>
      ))}
    </div>
  )
}
