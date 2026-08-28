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
    // RITMO Y PROYECCION. Roberto lo pidio el 2026-08-28: "cuantos bultos en
    // promedio capturamos al dia, cual ha sido el maximo, cuando el minimo...
    // para sacar cuantas etiquetas necesitamos en un mes".
    //
    // ⚠️ El promedio se saca sobre los DIAS QUE SE TRABAJO, no sobre los dias
    // del calendario. Dividir entre 31 metería los domingos y los dias de paro
    // en el divisor y bajaria el promedio sin que nadie hubiera trabajado
    // menos: el numero serviria para un reporte, no para pedir material.
    const diasOrdenados = [...porDia.entries()].sort(([a], [b]) => {
      const [da, ma] = a.split('/')
      const [dbb, mb] = b.split('/')
      return ma === mb ? Number(da) - Number(dbb) : Number(ma) - Number(mb)
    })
    const valores = diasOrdenados.map(([, v]) => v)
    const diasWork = valores.length
    const promedioDia = diasWork ? capturas.length / diasWork : 0
    const maximo = diasWork ? diasOrdenados[valores.indexOf(Math.max(...valores))] : null
    const minimo = diasWork ? diasOrdenados[valores.indexOf(Math.min(...valores))] : null
    const docenasPorDia = diasWork ? docenasTotales / diasWork : 0
    // Un mes de trabajo se toma como 24 dias (lunes a sabado, cuatro semanas).
    // Es un supuesto, y por eso se dice en pantalla: quien lo lea tiene que
    // poder discutir el numero, no solo creerselo.
    const DIAS_MES = 24
    const ritmo = {
      diasWork,
      promedioDia,
      docenasPorDia,
      maximo: maximo ? { dia: maximo[0], valor: maximo[1] } : null,
      minimo: minimo ? { dia: minimo[0], valor: minimo[1] } : null,
      etiquetasMes: Math.round(promedioDia * DIAS_MES),
      diasMes: DIAS_MES
    }

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
      ritmo,
      capturasPorOperador,
      kgPorMaquila
    }
  }, [capturas, pdfs])

  const parcial = capturasParcial || pdfsParcial
  // El '+' solo se pone mientras el conteo NO es definitivo: durante la carga
  // (que va encadenando paginas y pintando el avance) o si de plano se topo el
  // techo de paginas. Ya terminada la consulta, los numeros son del periodo
  // completo y se muestran limpios.
  const marca = parcial || cargando ? '+' : ''

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
      {cargando && (
        <p className="texto-suave">
          Consultando el periodo completo... {capturas.length} bultos y {pdfs.length} PDFs hasta ahora.
        </p>
      )}
      {!cargando && parcial && (
        <div className="alerta-error" style={{ background: '#fff4e0', color: '#8a5300', marginBottom: 12 }}>
          El periodo tiene mas datos de los que se pueden traer de una sola vez: estos indicadores son PARCIALES.
        </div>
      )}

      {ind.ritmo.diasWork > 0 && (
        <div className="tarjeta" style={{ marginBottom: 12 }}>
          <h2 style={{ marginBottom: 2 }}>Ritmo</h2>
          <p className="texto-suave" style={{ marginTop: 0, fontSize: 13 }}>
            Los promedios se sacan sobre los <strong>{ind.ritmo.diasWork} dias que se
            trabajo</strong> en este periodo, no sobre los dias del calendario: meter
            domingos y paros en el divisor bajaria el promedio sin que nadie hubiera
            trabajado menos.
          </p>
          <div className="detalle-kpis">
            <div className="kpi">
              <span className="kpi-num">{ind.ritmo.promedioDia.toFixed(0)}</span>
              <span className="kpi-lbl">Bultos por dia trabajado</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{ind.ritmo.docenasPorDia.toFixed(0)}</span>
              <span className="kpi-lbl">Docenas por dia trabajado</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{ind.ritmo.maximo?.valor ?? '-'}</span>
              <span className="kpi-lbl">Dia mas alto ({ind.ritmo.maximo?.dia ?? '-'})</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{ind.ritmo.minimo?.valor ?? '-'}</span>
              <span className="kpi-lbl">Dia mas bajo ({ind.ritmo.minimo?.dia ?? '-'})</span>
            </div>
          </div>
          <p style={{ marginTop: 10, marginBottom: 0 }}>
            A este ritmo, en un mes de <strong>{ind.ritmo.diasMes} dias de trabajo</strong>{' '}
            se necesitan <strong>~{ind.ritmo.etiquetasMes.toLocaleString('es-MX')} etiquetas</strong>.
          </p>
          <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 2 }}>
            Es un <strong>piso, no un pedido</strong>: cuenta una etiqueta por bulto y no
            incluye reimpresiones, pruebas ni las que se echan a perder. Los 24 dias son un
            supuesto (lunes a sabado, cuatro semanas) — si el mes trae mas o menos, el numero
            se mueve igual. Para pedir material, mirar tambien el periodo de tres meses.
          </p>
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

      {/* Se quitaron "Capturas por dia" y "Codigos mas capturados" el 28-08.
          La primera era una lista de 31 barras que nadie leia: lo que de esa
          serie importa —el promedio, el dia mas alto y el mas bajo— ya lo dice
          la tarjeta de Ritmo en dos numeros. La segunda contaba BULTOS por
          codigo, que no es produccion ni dinero: un codigo que viaja en bultos
          chicos salia arriba de otro que mueve el triple de docenas.
          Roberto: "no tiene sentido tenerlo, .de que nos sirve?". */}
      <div className="grid-paneles">
        <div className="tarjeta">
          <h2>Capturas por persona</h2>
          <BarraKpi datos={ind.capturasPorOperador} color="#059669" />
        </div>
        <div className="tarjeta">
          <h2>Kg salidos por maquila</h2>
          <BarraKpi datos={ind.kgPorMaquila} sufijo=" kg" color="#7c3aed" />
        </div>
      </div>
    </>
  )
}
