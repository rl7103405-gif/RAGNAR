// TODO LO DE MAQUILAS EN UNA SOLA PESTANA.
//
// Antes esto vivia repartido en SEIS pestanas distintas — 'Maquilas', 'Tareas
// a maquilas', 'Piden material', 'Mandar material', 'Inventario maquilas' y
// 'Avios' — y Roberto lo dijo claro el 18-08: "hay que reducir la cantidad de
// pestanas, esta disperso por muchos lados". Quien trabaja con una maquila
// tenia que acordarse de en cual de las seis estaba cada cosa.
//
// Ahora es una sola pestana con secciones adentro, y el orden no es casual:
// sigue el CAMINO REAL del trabajo con una maquila.
//
//   1. Tareas      lo que se le encarga (con su tech pack)
//   2. Piden       lo que ella pide de material
//   3. Mandar      lo que se le manda
//   4. Inventario  lo que tiene hoy
//   5. Catalogo    de que material estamos hablando
//   6. Dar de alta hasta abajo, porque se hace una vez y no todos los dias
//
// Cada quien ve solo sus secciones: Alvaro las de material, Lindbergh las
// tareas, Cielo el catalogo. Si a alguien le toca una sola, ni siquiera
// aparecen los botones — seria una navegacion de un solo destino.
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Maquilas from './Maquilas'
import PanelTareasMaquila from './PanelTareasMaquila'
import PanelSolicitudesAvios from './PanelSolicitudesAvios'
import PanelEnviarAvios from './PanelEnviarAvios'
import PanelInventarioAvios from './PanelInventarioAvios'
import Avios from './Avios'

export default function PanelMaquilasTodo() {
  const { puedeCrearTareas, soloAlmacen, soloConsulta, soloCaptura, soloProduccion, esAdmin, esInterno } =
    useAuth()

  // Quien ve que. Se calcula con los mismos permisos que ya decidian las
  // pestanas viejas, para no cambiar de paso quien alcanza que cosa: esto es
  // una reorganizacion de la pantalla, no un cambio de permisos.
  const material = esAdmin || soloAlmacen
  const catalogo = esAdmin || soloAlmacen || soloConsulta
  const tareas = puedeCrearTareas
  // El alta de maquilas la tenia la pestana 'Maquilas', que SOLO veian los
  // perfiles completos (America, Diana, Lindbergh, estacion) y el admin.
  // Alvaro (almacen) nunca la tuvo: al juntar las pestanas hay que conservar
  // eso o se le estaria dando de paso un permiso que no pidio nadie.
  const alta =
    esAdmin || (esInterno && !soloAlmacen && !soloConsulta && !soloCaptura && !soloProduccion)

  const secciones = [
    tareas && { id: 'tareas', label: 'Tareas', render: () => <PanelTareasMaquila /> },
    material && { id: 'piden', label: 'Piden material', render: () => <PanelSolicitudesAvios /> },
    material && { id: 'mandar', label: 'Mandar material', render: () => <PanelEnviarAvios /> },
    material && { id: 'inventario', label: 'Inventario', render: () => <PanelInventarioAvios /> },
    catalogo && { id: 'catalogo', label: 'Catalogo de material', render: () => <Avios /> },
    // Hasta el final a proposito: dar de alta una maquila se hace una vez cada
    // varios meses, y arriba estorbaria a lo que se usa todos los dias.
    alta && { id: 'alta', label: 'Dar de alta una maquila', render: () => <Maquilas /> }
  ].filter(Boolean)

  const [activa, setActiva] = useState(secciones[0]?.id)
  const actual = secciones.find((s) => s.id === activa) || secciones[0]

  // Hoy no es alcanzable: todo rol que llega a esta pestana tiene al menos una
  // seccion (verificado rol por rol). Pero las listas de pestanas viven en
  // Estacion.jsx y las secciones aqui: el dia que alguien toque una sin la
  // otra, esto seria una pantalla en blanco sin explicacion. Mejor decirlo.
  if (!secciones.length) {
    return (
      <div className="tarjeta">
        <h2>Maquilas</h2>
        <p className="texto-suave">
          Tu cuenta no tiene ninguna seccion asignada aqui. Avisale a Roberto.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Con una sola seccion los botones sobran: seria un menu de un destino. */}
      {secciones.length > 1 && (
        <div className="tabs" style={{ marginBottom: 12 }}>
          {secciones.map((s) => (
            <button
              key={s.id}
              className={`tab ${actual?.id === s.id ? 'activo' : ''}`}
              onClick={() => setActiva(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {actual?.render()}
    </>
  )
}
