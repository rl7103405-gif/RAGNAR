// ORDENES DE COMPRA Y PLAN MAESTRO EN UNA SOLA PESTANA.
//
// Eran dos pestanas separadas y no tenia sentido: el plan es de DONDE SALE el
// arbol, no otra cosa. Adrian sube el archivo y en el mismo lugar comprueba
// que quedo bien amarrado, sin cambiar de pantalla para verificar su propio
// trabajo (Roberto, 18-08).
//
// El orden es el del uso: primero el arbol, que lo miran todos los dias
// Lindbergh, America y el papa; despues el plan, que se sube una vez por
// semana y solo lo toca Adrian.
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import PanelArbolOrdenes from './PanelArbolOrdenes'
import PanelPlanMaestro from './PanelPlanMaestro'

export default function PanelOrdenesYPlan() {
  const { puedeSubirPlanMaestro } = useAuth()
  const [seccion, setSeccion] = useState('arbol')

  // Quien no sube el plan no tiene por que ver ni el boton: para el esta
  // pestana es, tal cual, las ordenes de compra.
  if (!puedeSubirPlanMaestro) return <PanelArbolOrdenes />

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button
          className={`tab ${seccion === 'arbol' ? 'activo' : ''}`}
          onClick={() => setSeccion('arbol')}
        >
          Ordenes de compra
        </button>
        <button
          className={`tab ${seccion === 'plan' ? 'activo' : ''}`}
          onClick={() => setSeccion('plan')}
        >
          Subir el plan maestro
        </button>
      </div>
      {seccion === 'arbol' ? <PanelArbolOrdenes /> : <PanelPlanMaestro />}
    </>
  )
}
