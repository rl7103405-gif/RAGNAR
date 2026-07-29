// Pestana Indicadores: KPIs automaticos del periodo elegido (mismo patron
// que el panel de indicadores de captura-mecanicos). Se calculan sobre lo
// cargado en pantalla: si hay resultados parciales, el titulo lo marca y
// "Cargar mas" del Historial los completa.
import { useMemo, useState } from 'react'
import { useDatosPeriodo } from '../hooks/useDatosPeriodo'
import FiltroPeriodo from './FiltroPeriodo'
import BarraKpi from './BarraKpi'
import { CRUCE_SIN_RUTEO } from '../utils/cruceProducto'

export default function PanelIndicadores() {
  const [tipo, setTipo] = useState('dia')
  const [offset, setOffset] = useState(0)
  const { rango, capturas, capturasParcial, pdfs, pdfsParcial, cargando, error } =
    useDatosPeriodo(tipo, offset)

  const totalKg = capturas.reduce((acc, c) => acc + (c.pesoGramos || 0), 0) / 1000

  const ind = useMemo(() => {
    const docenasTotales = capturas.reduce((acc, c) => {
      const d = c.producto?.docenas ?? c.producto?.total
      return acc + (typeof d === 'number' ? d : 0)
    }, 0)
    const sinRuteo = capturas.filter((c) => c.cruce === CRUCE_SIN_RUTEO).length
    const kgEnPdfs = pdfs.reduce((acc, p) => acc + (p.pesoTotalGramos || 0), 0) / 1000
    const foliosEnPdfs = pdfs.reduce((acc, p) => acc + (p.totalFolios || 0), 0)

    const porDia = new Map()
    capturas.forEach((c) => {
      if (!c.creadoEn?.toDate) return
      const d = c.creadoEn.toDate()
      const clave = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
      porDia.set(clave, (porDia.get(clave) || 0) + 1)
    })
    const capturasPorDia = [...porDia.entries()]
      .map(([clave, valor]) => ({ clave, valor }))
      .reverse()
      .slice(-31)

    const porCodigo = new Map()
    capturas.forEach((c) => {
      const codigo = c.producto?.codigo || 'SIN RUTEO'
      porCodigo.set(codigo, (porCodigo.get(codigo) || 0) + 1)
    })
    const topCodigos = [...porCodigo.entries()]
      .map(([clave, valor]) => ({ clave, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)

    const porOperador = new Map()
    capturas.forEach((c) => {
      const quien = c.operadorNombre || '-'
      porOperador.set(quien, (porOperador.get(quien) || 0) + 1)
    })
    const capturasPorOperador = [...porOperador.entries()]
      .map(([clave, valor]) => ({ clave, valor }))
      .sort((a, b) => b.valor - a.valor)

    const porMaquila = new Map()
    pdfs.forEach((p) => {
      const nombre = p.maquila?.nombre || '-'
      // Se acumulan GRAMOS crudos y se redondea una sola vez al final:
      // redondear cada PDF antes de sumar hace que muchos envios chicos
      // (0.4 kg -> 0) desaparezcan del total.
      porMaquila.set(nombre, (porMaquila.get(nombre) || 0) + (p.pesoTotalGramos || 0))
    })
    const kgPorMaquila = [...porMaquila.entries()]
      .map(([clave, gramos]) => ({ clave, valor: Math.round(gramos / 1000) }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)

    return {
      docenasTotales,
      sinRuteo,
      kgEnPdfs,
      foliosEnPdfs,
      capturasPorDia,
      topCodigos,
      capturasPorOperador,
      kgPorMaquila
    }
  }, [capturas, pdfs])

  const parcial = capturasParcial || pdfsParcial
  const marca = parcial ? '+' : ''

  return (
    <>
      <FiltroPeriodo
        tipo={tipo}
        setTipo={setTipo}
        offset={offset}
        setOffset={setOffset}
        etiqueta={rango.etiqueta}
      />

      {error && <div className="alerta-error" style={{ marginBottom: 12 }}>{error}</div>}
      {cargando && <p className="texto-suave">Consultando...</p>}
      {parcial && (
        <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 12 }}>
          Hay mas datos de los que caben en una consulta: estos indicadores son PARCIALES.
        </div>
      )}

      <div className="detalle-kpis">
        <div className="kpi">
          <span className="kpi-num">{capturas.length}{marca}</span>
          <span className="kpi-lbl">Bultos capturados</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{totalKg.toFixed(2)}{marca}</span>
          <span className="kpi-lbl">Kg capturados</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">
            {capturas.length > 0 ? (totalKg / capturas.length).toFixed(2) : '-'}
          </span>
          <span className="kpi-lbl">Kg promedio / bulto</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{ind.docenasTotales}{marca}</span>
          <span className="kpi-lbl">Docenas capturadas</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{pdfs.length}{marca}</span>
          <span className="kpi-lbl">PDFs generados</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{ind.foliosEnPdfs}{marca}</span>
          <span className="kpi-lbl">Folios en PDFs</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{ind.kgEnPdfs.toFixed(2)}{marca}</span>
          <span className="kpi-lbl">Kg salidos en PDFs</span>
        </div>
        <div className="kpi">
          <span className="kpi-num">{ind.sinRuteo}{marca}</span>
          <span className="kpi-lbl">Capturas sin ruteo</span>
        </div>
      </div>

      <div className="grid-paneles">
        <div className="tarjeta">
          <h2>Capturas por dia</h2>
          <BarraKpi datos={ind.capturasPorDia} color="#1d4ed8" />
        </div>
        <div className="tarjeta">
          <h2>Capturas por persona</h2>
          <BarraKpi datos={ind.capturasPorOperador} color="#059669" />
        </div>
        <div className="tarjeta">
          <h2>Codigos mas capturados</h2>
          <BarraKpi datos={ind.topCodigos} color="#0e7490" />
        </div>
        <div className="tarjeta">
          <h2>Kg salidos por maquila</h2>
          <BarraKpi datos={ind.kgPorMaquila} sufijo=" kg" color="#7c3aed" />
        </div>
      </div>
    </>
  )
}
