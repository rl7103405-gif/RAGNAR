// Home de la estacion de embarques, con pestanas (mismo patron que el
// SupervisorHome de captura-mecanicos):
//  - Captura         folio + peso, etiqueta Zebra y armado del PDF de salida
//  - Folios del dia  carga del Excel que sube America
//  - Historial       capturas y PDFs generados por periodo
//  - Reportes        busqueda por rango libre de fechas + maquila, con Excel
//  - Indicadores     KPIs automaticos del periodo
//  - Maquilas        alta y direcciones de los destinos del PDF
//  - Registros       bitacora de cambios y (solo admin) autorizaciones
//
// Las pestanas se filtran por ROL. Desde el 2026-08-13 'completo' ya NO ve
// nada de avios (America y Lindbergh no los tocan: son de Alvaro y el
// catalogo de Cielo); el admin sigue viendo todo.
import { useState } from 'react'
import Layout from '../components/Layout'
import PanelCaptura from '../components/PanelCaptura'
import CargaRuteo from '../components/CargaRuteo'
import PanelHistorial from '../components/PanelHistorial'
import PanelReportes from '../components/PanelReportes'
import PanelIndicadores from '../components/PanelIndicadores'
import PanelAutorizaciones from '../components/PanelAutorizaciones'
import PanelTareas from '../components/PanelTareas'
import PanelPlanMaestro from '../components/PanelPlanMaestro'
import PanelArbolOrdenes from '../components/PanelArbolOrdenes'
import PortalMaquila from '../components/PortalMaquila'
import PedirAviosMaquila from '../components/PedirAviosMaquila'
import RecibirAviosMaquila from '../components/RecibirAviosMaquila'
import TareasEnsambleMaquila from '../components/TareasEnsambleMaquila'
import PanelMaquilasTodo from '../components/PanelMaquilasTodo'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { id: 'captura', label: 'Captura' },
  { id: 'tareas', label: 'Tareas' },
  { id: 'folios', label: 'Folios del dia' },
  { id: 'historial', label: 'Historial' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'indicadores', label: 'Indicadores' },
  // UNA sola pestana para todo lo de maquilas (Roberto, 18-08: "hay que
  // reducir la cantidad de pestanas, esta disperso por muchos lados"). Antes
  // eran seis: Maquilas, Tareas a maquilas, Piden material, Mandar material,
  // Inventario maquilas y Avios. Adentro viven como secciones, en el orden
  // del trabajo real. Ver PanelMaquilasTodo.jsx.
  { id: 'maquilas', label: 'Maquilas' },
  // El arbol OC -> OT -> codigo que pidio Lindbergh (junta 17-08). Va con
  // nombre de negocio, no tecnico: el vocabulario en pantalla es parte del
  // sistema.
  { id: 'ordenes', label: 'Ordenes de compra' },
  { id: 'plan-maestro', label: 'Plan maestro' },
  { id: 'registros', label: 'Registros' }
]

// Un pesador (Angel, Juan) SOLO captura: no ve tareas, maquilas, Excel ni
// registros (decision de Roberto, 2026-08-11).
const TABS_CAPTURA = ['captura']

// Cielo (rol 'consulta') lleva el control, pasa las remisiones a Microsip y
// desde el 2026-08-13 ADMINISTRA EL CATALOGO DE AVIOS (pestana Avios; el alta
// se gatea con su flag administraCatalogoAvios). Sigue sin capturar, sin
// cargar el Excel del dia y sin crear tareas.
const TABS_CONSULTA = ['ordenes', 'historial', 'reportes', 'indicadores', 'registros', 'maquilas']

// Alvaro (rol 'almacen') maneja los AVIOS que se mandan: solicitudes, envios
// e inventario de las maquilas (SOLO avios: bultos y embarques no son suyos).
// El catalogo lo consulta pero ya no lo administra (es de Cielo).
const TABS_ALMACEN = ['maquilas', 'tareas']

// Adrian (rol 'produccion'): sube el plan maestro y comprueba en el arbol que
// quedo bien amarrado. No captura, no embarca, no toca avios.
const TABS_PRODUCCION = ['plan-maestro', 'ordenes']

// 'completo' (America, Diana, Lindbergh, estacion): todo lo de embarques,
// SIN avios (recorte de Roberto 2026-08-13: inventario de maquilas, mandar
// material y el catalogo salen de su perfil). 'Tareas a maquilas' no va en
// esta lista fija: se agrega dinamico solo a quien puede crear tareas.
const TABS_COMPLETO = [
  'captura',
  'tareas',
  'folios',
  'ordenes',
  'historial',
  'reportes',
  'indicadores',
  'maquilas',
  'registros'
]

export default function Estacion() {
  const {
    soloCaptura,
    soloConsulta,
    soloAlmacen,
    esAdmin,
    esInterno,
    esMaquila,
    puedeCrearTareas,
    puedeSubirPlanMaestro,
    soloProduccion,
    rol,
    perfil
  } = useAuth()
  const [tab, setTab] = useState('captura')

  // Usuario EXTERNO de una maquila: ve SOLO su portal, sin pestanas de la
  // operacion interna. Va antes que el chequeo de esInterno porque una maquila
  // no es interna a proposito.
  if (esMaquila) {
    // Lo que hace una maquila hoy: confirmar lo que recibe (pesando bulto por
    // bulto), sus tareas de ensamble con el tech pack, su material y pedir lo
    // que le falta.
    const TABS_MAQUILA = [
      { id: 'recibir', label: 'Bultos que me mandaron' },
      { id: 'ensamble', label: 'Tareas de ensamble' },
      { id: 'material', label: 'Material recibido' },
      { id: 'pedir', label: 'Pedir material' }
    ]
    const activaMaquila = TABS_MAQUILA.some((t) => t.id === tab) ? tab : 'recibir'
    return (
      <Layout titulo={`RAGNAR - ${perfil?.nombreCompleto || 'Maquila'}`}>
        <div className="tabs">
          {TABS_MAQUILA.map((t) => (
            <button
              key={t.id}
              className={`tab ${activaMaquila === t.id ? 'activo' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activaMaquila === 'recibir' && <PortalMaquila />}
        {activaMaquila === 'ensamble' && <TareasEnsambleMaquila />}
        {activaMaquila === 'material' && <RecibirAviosMaquila />}
        {activaMaquila === 'pedir' && <PedirAviosMaquila />}
      </Layout>
    )
  }

  // Un rol que no esta en la lista blanca (perfil sin rol, o una cuenta
  // externa) NO debe ver la app "completa y rota": las reglas le niegan todo,
  // asi que se le dice con claridad en vez de dejarlo picando botones que
  // truenan con "Missing or insufficient permissions".
  if (!esInterno) {
    return (
      <Layout titulo="RAGNAR - Embarques">
        <div className="tarjeta">
          <h2>Tu cuenta no tiene acceso a esta app</h2>
          <p>
            El perfil no tiene un rol valido{rol ? ` (dice "${rol}")` : ' asignado'}. Avisale a
            Roberto para que lo revise: no es un problema de tu contrasena.
          </p>
        </div>
      </Layout>
    )
  }

  // Lista blanca de pestanas por rol. Solo el ADMIN sigue viendo todo;
  // 'completo' ya tiene la suya (sin avios). 'Tareas a maquilas' es la unica
  // dinamica: la ve quien puede crear tareas (Lindbergh y el admin), no todo
  // el rol.
  const base = soloCaptura
    ? TABS_CAPTURA
    : soloProduccion
      ? TABS_PRODUCCION
    : soloConsulta
      ? TABS_CONSULTA
      : soloAlmacen
        ? TABS_ALMACEN
        : esAdmin
          ? TABS.map((t) => t.id)
          : TABS_COMPLETO
  // Quien puede encargar tareas a maquilas entra por la pestana de Maquilas,
  // donde 'Tareas' es la primera seccion.
  const conTareas = puedeCrearTareas && !base.includes('maquilas') ? [...base, 'maquilas'] : base
  // El plan maestro solo lo ve quien lo sube: es de produccion, no de
  // embarques.
  const permitidas = puedeSubirPlanMaestro ? conTareas : conTareas.filter((t) => t !== 'plan-maestro')
  const visibles = TABS.filter((t) => permitidas.includes(t.id))
  // La pestana inicial no puede ser 'captura' para quien no la tiene.
  const tabActiva = visibles.some((t) => t.id === tab) ? tab : visibles[0]?.id

  return (
    <Layout titulo="RAGNAR - Embarques">
      {visibles.length > 1 && (
        <div className="tabs">
          {visibles.map((t) => (
            <button
              key={t.id}
              className={`tab ${tabActiva === t.id ? 'activo' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tabActiva === 'captura' && <PanelCaptura />}
      {tabActiva === 'tareas' && <PanelTareas />}
      {tabActiva === 'folios' && <CargaRuteo />}
      {tabActiva === 'historial' && <PanelHistorial />}
      {tabActiva === 'reportes' && <PanelReportes />}
      {tabActiva === 'indicadores' && <PanelIndicadores />}
      {tabActiva === 'maquilas' && <PanelMaquilasTodo />}
      {tabActiva === 'ordenes' && <PanelArbolOrdenes />}
      {tabActiva === 'plan-maestro' && <PanelPlanMaestro />}
      {tabActiva === 'registros' && <PanelAutorizaciones />}
    </Layout>
  )
}
