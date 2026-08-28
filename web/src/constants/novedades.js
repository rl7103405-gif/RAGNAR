// NOVEDADES DE LA APP — lo que la gente ve en la campana de la barra superior.
//
// Portado de captura-mecanicos el 2026-08-28, a peticion de Roberto: "que
// tambien venga la ultima version para corroborar, y que yo no me meta a ver
// todos los perfiles; que los dos estemos en la version correcta y corroborar
// que hayas hecho el push de manera correcta".
//
// Vive en el CODIGO, no en Firestore, a proposito: una novedad describe la
// version que la persona tiene cargada, asi que se escribe en el MISMO commit
// del cambio que anuncia. Ademas no cuesta lecturas de Firebase, no necesita
// reglas de seguridad ni pantalla de captura.
//
// COMO AGREGAR UNA (hazlo en el commit del cambio, no despues):
//   1. Agrega la entrada ARRIBA del todo (el array va del mas nuevo al mas
//      viejo; el orden del archivo es el orden en pantalla).
//   2. El `id` es `YYYY-MM-DD-NN`, con NN de dos digitos para separar varias
//      del mismo dia. NUNCA reuses ni reescribas un id ya publicado: es lo
//      que marca "hasta aqui ya lei" en cada navegador.
//   3. Escribelo para America, Valeria o Cielo, no para un programador: que
//      cambio en SU pantalla y que tiene que hacer distinto. Nada de nombres
//      de archivos, colecciones ni terminos tecnicos.
//
// `tipo`: 'nuevo' (funcion que antes no existia) · 'corregido' (algo que
// estaba mal y ya no) · 'mejorado' (ya existia y ahora funciona mejor).

export const TIPO_NOVEDAD = {
  nuevo: { etiqueta: 'Nuevo', color: '#16a34a' },
  corregido: { etiqueta: 'Corregido', color: '#d97706' },
  mejorado: { etiqueta: 'Mejorado', color: '#7c3aed' }
}

// Al entrar por primera vez no se marcan como nuevas TODAS las entradas
// historicas (seria un globo con 30 y nadie lo lee): solo las de los ultimos
// dias.
export const DIAS_NOVEDAD_INICIAL = 30

export const NOVEDADES = [
  {
    id: '2026-08-28-09',
    fecha: '2026-08-28',
    tipo: 'corregido',
    titulo: 'Cada quien ve lo suyo otra vez',
    detalle:
      'La pestana Maquilas se abria en blanco, y la pantalla de recibir le aparecia a quien no recibe. Ya quedo: recibir es de Producto Terminado, y Maquilas vuelve a abrir para todos los que la tienen.'
  },
  {
    id: '2026-08-28-08',
    fecha: '2026-08-28',
    tipo: 'mejorado',
    titulo: 'Cada quien entra donde trabaja',
    detalle:
      'La primera pestana que abre la app ya no es la misma para todos: es la del trabajo de cada quien. Producto Terminado entra directo a "Recibir". La pestana que antes se llamaba "Por llegar" ahora se llama asi, porque ahi mismo se registra lo que llega.'
  },
  {
    id: '2026-08-28-07',
    fecha: '2026-08-28',
    tipo: 'nuevo',
    titulo: 'Producto Terminado ya puede registrar lo que recibe',
    detalle:
      'En "Por llegar", cada entrega que la maquila ya declaro trae el boton "Registrar lo que llego". Se escribe lo que se conto de cada codigo y la pantalla dice sola si llego completo, falto o llego de mas. Queda con tu nombre y la hora, y no se puede editar: si te equivocas, levanta otra y explicalo en la nota.'
  },
  {
    id: '2026-08-28-06',
    fecha: '2026-08-28',
    tipo: 'mejorado',
    titulo: 'Cielo ya ve el inventario de las maquilas',
    detalle:
      'Se agrego a la pestana de Maquilas para poder darle seguimiento sin preguntarle a nadie.'
  },
  {
    id: '2026-08-28-05',
    fecha: '2026-08-28',
    tipo: 'nuevo',
    titulo: 'Novedades de la app, aqui mismo',
    detalle:
      'Esta campana. Cada vez que corrijamos algo o agreguemos una funcion, aqui aparece que cambio y en que version estas, sin que tengas que preguntarle a nadie. El punto rojo se va cuando lo abres.'
  },
  {
    id: '2026-08-28-04',
    fecha: '2026-08-28',
    tipo: 'nuevo',
    titulo: 'Producto Terminado ya sabe que le va a llegar',
    detalle:
      'Nueva pestana "Por llegar": muestra lo que las maquilas ya avisaron que terminaron, lo que estan armando y lo que se les encargo sin empezar, con la fecha desde cuando. Sirve para preparar el espacio antes de que llegue el camion.'
  },
  {
    id: '2026-08-28-03',
    fecha: '2026-08-28',
    tipo: 'corregido',
    titulo: 'Ya no dice "no tiene precios" mientras carga',
    detalle:
      'En Precios de ensamble, al elegir una maquila con muchos modelos la pantalla alcanzaba a decir que no tenia precios antes de terminar de cargarlos. Ahora dice "Cargando precios..." y solo afirma que no hay cuando de verdad no hay.'
  },
  {
    id: '2026-08-28-02',
    fecha: '2026-08-28',
    tipo: 'mejorado',
    titulo: 'Ya estan los precios de las seis maquilas',
    detalle:
      'Son 152 precios por docena, sacados del historico de pagos. Faltaban tres maquilas porque se estaba tomando un solo proceso como el normal para todas; ahora se toma el que cada maquila de verdad hace. Los que ya estaban cargados no cambiaron.'
  },
  {
    id: '2026-08-28-01',
    fecha: '2026-08-28',
    tipo: 'corregido',
    titulo: 'Las cuentas de prueba ya no ven datos reales',
    detalle:
      'Una cuenta de prueba alcanzaba a ver el historial de subidas del Excel del dia y del plan, que son de la operacion real. Ya no: el candado esta en el servidor, no en la pantalla.'
  },
  {
    id: '2026-08-26-01',
    fecha: '2026-08-26',
    tipo: 'corregido',
    titulo: 'Una orden solo pasa a "terminadas" cuando no falta nada',
    detalle:
      'Antes una orden podia salir como terminada con folios sin mandar a PDF, porque se habia capturado de mas. Ahora exige el 100% mandado Y cero folios pendientes, y mientras falte uno el avance se topa en 99.9%.'
  },
  {
    id: '2026-08-25-02',
    fecha: '2026-08-25',
    tipo: 'nuevo',
    titulo: 'La remision de la maquila ya trae su total',
    detalle:
      'Cuando la maquila declara lo que armo, su remision calcula sola el importe: docenas por el precio de ese modelo. El precio va por MODELO, asi que cubre todas sus tallas y colores. Si un modelo no tiene precio, la columna sale en blanco para escribirla a mano, nunca en cero.'
  },
  {
    id: '2026-08-25-01',
    fecha: '2026-08-25',
    tipo: 'nuevo',
    titulo: 'Excel de una orden de compra completa',
    detalle:
      'Desde Historial se baja el Excel de una orden con dos hojas: el concentrado y el detalle folio por folio, con subtotales por orden de trabajo y su total general.'
  }
]
