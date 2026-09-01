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
import PanelPreciosMaquila from './PanelPreciosMaquila'
import PanelTareasMaquila from './PanelTareasMaquila'
import PanelSolicitudesAvios from './PanelSolicitudesAvios'
import PanelEnviarAvios from './PanelEnviarAvios'
import PanelInventarioAvios from './PanelInventarioAvios'
import PanelAcusesMaquilas from './PanelAcusesMaquilas'
import Avios from './Avios'

export default function PanelMaquilasTodo() {
  const {
    puedeCrearTareas,
    soloAlmacen,
    soloConsulta,
    soloCaptura,
    soloProduccion,
    soloPT,
    esAdmin,
    esInterno
  } = useAuth()

  // QUIEN VE CADA SECCION. Cada perfil atiende lo suyo y nada mas -- Roberto,
  // 2026-08-28: "hay que limpiar los perfiles de la gente para que cada quien
  // atienda a lo suyo".
  //
  //   Alvaro (almacen) ...... mueve el material: lo ve TODO y con botones.
  //   Lindbergh ............. encarga las tareas: ve todo, sin mover material.
  //   Cielo (consulta) ...... lleva el control y los pagos: ve todo, sin mover.
  //   Valeria (pt) .......... recibe: inventario, catalogo y precios. NO el
  //                           flujo de pedir/mandar material, que no es suyo.
  //   Direccion (admin) ..... todo.

  // Quien MUEVE el material. Son los unicos que ven botones de accion; a los
  // demas se les esconden, porque un boton que el servidor va a negar es peor
  // que no tenerlo.
  const mueveMaterial = esAdmin || soloAlmacen

  // El FLUJO de material (quien lo pide y a quien se le manda). Es de quien lo
  // surte (Alvaro) y de quien encarga las tareas (Lindbergh). NO de Cielo ni
  // de Valeria: Cielo lleva los pagos y Valeria recibe, y ninguna de las dos
  // atiende una peticion de plastiflecha. Roberto lo acoto el 28-08.
  const flujoMaterial = mueveMaterial || puedeCrearTareas

  // El ESTADO del material: que tiene hoy cada maquila. Esto si lo necesita
  // Producto Terminado para saber con que estan trabajando.
  const inventario = flujoMaterial || soloPT || soloConsulta

  const catalogo = esAdmin || soloAlmacen || soloConsulta || soloPT || puedeCrearTareas

  // Los precios los PONEN Cielo y direccion (puedeEditarPrecios en las reglas
  // y puedeEditar en el panel). Aqui solo se decide quien los MIRA.
  const precios = esAdmin || soloConsulta || soloPT || puedeCrearTareas

  const tareas = puedeCrearTareas

  // LO QUE REPORTARON las maquilas al recibir. Lo ve todo el interno que
  // trabaja con maquilas: si un bulto se rechazo o no llego, le importa a
  // quien embarca (America), a quien encarga (Lindbergh), a quien paga
  // (Cielo), a quien recibe de vuelta (Valeria) y a direccion. Antes no lo
  // veia NADIE -- ver PanelAcusesMaquilas.jsx.
  const reportes = esInterno && !soloCaptura && !soloProduccion

  // El alta de maquilas la tenia la pestana 'Maquilas', que SOLO veian los
  // perfiles completos (America, Diana, Lindbergh, estacion) y el admin.
  // Alvaro (almacen) nunca la tuvo: al juntar las pestanas hay que conservar
  // eso o se le estaria dando de paso un permiso que no pidio nadie.
  const alta =
    esAdmin ||
    (esInterno && !soloAlmacen && !soloConsulta && !soloCaptura && !soloProduccion && !soloPT)

  const secciones = [
    tareas && { id: 'tareas', label: 'Tareas', render: () => <PanelTareasMaquila /> },
    // Va arriba de todo el material a proposito: un bulto rechazado es lo
    // primero que hay que atender del dia, no algo que se busca al final.
    reportes && {
      id: 'reportes',
      label: 'Lo que reportaron',
      render: () => <PanelAcusesMaquilas />
    },
    flujoMaterial && { id: 'piden', label: 'Piden material', render: () => <PanelSolicitudesAvios /> },
    flujoMaterial && { id: 'mandar', label: 'Mandar material', render: () => <PanelEnviarAvios /> },
    inventario && { id: 'inventario', label: 'Inventario', render: () => <PanelInventarioAvios /> },
    catalogo && { id: 'catalogo', label: 'Catalogo de material', render: () => <Avios /> },
    precios && { id: 'precios', label: 'Precios de ensamble', render: () => <PanelPreciosMaquila /> },
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
