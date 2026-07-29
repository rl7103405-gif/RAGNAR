// Home de la estacion de embarques, con pestanas (mismo patron que el
// SupervisorHome de captura-mecanicos):
//  - Captura         folio + peso, etiqueta Zebra y armado del PDF de salida
//  - Folios del dia  carga del Excel que sube America
//  - Historial       capturas y PDFs generados por periodo
//  - Indicadores     KPIs automaticos del periodo
//  - Maquilas        alta y direcciones de los destinos del PDF
import { useState } from 'react'
import Layout from '../components/Layout'
import PanelCaptura from '../components/PanelCaptura'
import CargaRuteo from '../components/CargaRuteo'
import PanelHistorial from '../components/PanelHistorial'
import PanelIndicadores from '../components/PanelIndicadores'
import Maquilas from '../components/Maquilas'

const TABS = [
  { id: 'captura', label: 'Captura' },
  { id: 'folios', label: 'Folios del dia' },
  { id: 'historial', label: 'Historial' },
  { id: 'indicadores', label: 'Indicadores' },
  { id: 'maquilas', label: 'Maquilas' }
]

export default function Estacion() {
  const [tab, setTab] = useState('captura')

  return (
    <Layout titulo="RAGNAR - Embarques">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'activo' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'captura' && <PanelCaptura />}
      {tab === 'folios' && <CargaRuteo />}
      {tab === 'historial' && <PanelHistorial />}
      {tab === 'indicadores' && <PanelIndicadores />}
      {tab === 'maquilas' && <Maquilas />}
    </Layout>
  )
}
