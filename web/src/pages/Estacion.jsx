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
import PanelPorLlegar from '../components/PanelPorLlegar'
import PanelReportes from '../components/PanelReportes'
import PanelIndicadores from '../components/PanelIndicadores'
import PanelAutorizaciones from '../components/PanelAutorizaciones'
import PanelTareas from '../components/PanelTareas'
import PortalMaquila from '../components/PortalMaquila'
import PedirAviosMaquila from '../components/PedirAviosMaquila'
import RecibirAviosMaquila from '../components/RecibirAviosMaquila'
import TareasEnsambleMaquila from '../components/TareasEnsambleMaquila'
import PanelMaquilasTodo from '../components/PanelMaquilasTodo'
import PanelOrdenesYPlan from '../components/PanelOrdenesYPlan'
import PanelMiEquipo from '../components/PanelMiEquipo'
import PanelMiPerfil from '../components/PanelMiPerfil'
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
  { id: 'porllegar', label: 'Por llegar' },
  { id: 'registros', label: 'Registros' },
  // Copiadas de captura-mecanicos, que ya las tenia (Roberto, 19-08). Van al
  // final: se consultan de vez en cuando, no son trabajo diario.
  { id: 'miequipo', label: 'Mi equipo' },
  { id: 'miperfil', label: 'Mi perfil' }
]

// Un pesador (Angel, Juan) SOLO captura: no ve tareas, maquilas, Excel ni
// registros (decision de Roberto, 2026-08-11).
const TABS_CAPTURA = ['captura']

// Cielo (rol 'consulta') lleva el control, pasa las remisiones a Microsip y
// desde el 2026-08-13 ADMINISTRA EL CATALOGO DE AVIOS (pestana Avios; el alta
// se gatea con su flag administraCatalogoAvios). Sigue sin capturar, sin
// cargar el Excel del dia y sin crear tareas.
// 'porllegar' es el aviso para PRODUCTO TERMINADO: que le va a caer y cuando.
// Va en 'consulta' porque es el rol de Valeria (PT) -- y de paso lo ve Cielo,
// que es justo lo que Roberto pidio el 28-08 ("que ella le pueda estar dando
// seguimiento a todo lo demas"). No abre ningun permiso nuevo: las tareas de
// ensamble ya eran legibles para este rol desde el 24-08.
const TABS_CONSULTA = ['ordenes', 'porllegar', 'historial', 'reportes', 'indicadores', 'registros', 'maquilas']

// Alvaro (rol 'almacen') maneja los AVIOS que se mandan: solicitudes, envios
// e inventario de las maquilas (SOLO avios: bultos y embarques no son suyos).
// El catalogo lo consulta pero ya no lo administra (es de Cielo).
const TABS_ALMACEN = ['maquilas', 'tareas']

// Adrian (rol 'produccion'): sube el plan maestro y comprueba en el arbol que
// quedo bien amarrado. No captura, no embarca, no toca avios.
// Adrian entra a 'Ordenes de compra': ahi sube el plan y comprueba en el
// mismo lugar que quedo bien amarrado.
const TABS_PRODUCCION = ['ordenes']

// 'Mi equipo' (la plantilla) es para direccion y embarques. 'Mi perfil' lo ve
// TODO el mundo — Roberto fue explicito el 19-08: "Juan, Angel, todos, todos
// pueden tener lo de mi perfil". Ahi cada quien cambia su contrasena sin
// depender del engrane.
const TABS_EQUIPO = ['miequipo']

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
  // 'Mi equipo' y 'Mi perfil' solo para admin y completo (el papa, Lindbergh y
  // America). esAdmin ya las trae por TABS.map, asi que solo hay que
  // agregarselas a 'completo'.
  // 'Mi equipo' solo para embarques (admin ya la trae por TABS.map);
  // 'Mi perfil' para cualquiera que haya entrado.
  const conEquipo = rol === 'completo' ? [...conTareas, ...TABS_EQUIPO] : conTareas
  const permitidas = conEquipo.includes('miperfil') ? conEquipo : [...conEquipo, 'miperfil']
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
      {tabActiva === 'porllegar' && <PanelPorLlegar />}
      {tabActiva === 'historial' && <PanelHistorial />}
      {tabActiva === 'reportes' && <PanelReportes />}
      {tabActiva === 'indicadores' && <PanelIndicadores />}
      {tabActiva === 'maquilas' && <PanelMaquilasTodo />}
      {tabActiva === 'ordenes' && <PanelOrdenesYPlan />}
      {tabActiva === 'miequipo' && <PanelMiEquipo />}
      {tabActiva === 'miperfil' && <PanelMiPerfil />}
      {tabActiva === 'registros' && <PanelAutorizaciones />}
    </Layout>
  )
}
