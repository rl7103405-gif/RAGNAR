# Ideas pendientes de RAGNAR

Cosas que salieron a media sesión y NO se implementaron ahí mismo. Una tanda
por sesión: esto es la cola, no el backlog oficial (ese vive en el vault, en
`02-Apps/app-ragnar.md`).

---

## ✅ HECHO — La maquila inicia y termina su tarea de ensamble

Salió el 2026-08-14 probando el portal; se implementó el mismo día.

Quedó con el esquema de **dos pasos**: la maquila DECLARA y Quini CONFIRMA.
Estados `abierta` → `iniciada` → `declarada` → `terminada`, más la devolución
(`declarada` → `iniciada` con motivo escrito) para cuando no cuadra lo
entregado. El cierre —y con él el borrado del tech pack— sigue siendo de
Quini, así que un dedazo de la maquila ya no le quita el documento con el que
arma. Se conservó el cierre directo desde `abierta`/`iniciada` para cuando la
maquila no reporta nada.

---

## Bitácora de eventos de la tarea de ensamble

**Salió el 2026-08-14, del debate de diseño con Codex. No se hizo.**

El documento de la tarea guarda **el estado actual**, no la historia. Si una
tarea se declara y se devuelve tres veces, solo sobrevive la última
declaración y la última devolución: los intentos anteriores se pierden.

Para medir de verdad (y para discutir con una maquila qué pasó) haría falta
una subcolección append-only de eventos, escrita en la misma operación que
mueve el estado y con las mismas reglas por transición. Es el mismo patrón que
`cambios_codigo/{id}/eventos` en captura-mecánicos.

**Cuándo hacerlo:** cuando los tiempos empiecen a alimentar tarifas o el pago
por maquila (etapa 3 del ciclo de retorno). Antes de eso, con el estado actual
alcanza.

---

## Cerrar el corral de las cuentas de prueba también en LECTURA

**Decisión pendiente de Roberto desde el 2026-08-14.**

El aislamiento de las cuentas de prueba es de ESCRITURA. En lectura siguen
viendo toda la operación real: `demo_tareas` ve los Tech Packs de pedidos
reales y `demo_almacen` los inventarios de todas las maquilas. Cerrarlo no
cuesta lecturas extra (`esCuentaDePrueba()` reutiliza el perfil que la regla ya
leyó), pero deja esas pantallas vacías en la demo y le quita realismo a la
prueba.

---

## Inventario de las maquilas en la pestaña Maquilas (para Lindbergh)

**Lo pidió Roberto el 2026-08-18, a media sesión del plan maestro. No se hizo
ahí mismo (una tanda por sesión); es lo siguiente en la cola.**

Lindbergh necesita ver el inventario de cada maquila desde la pestaña
Maquilas: hoy esa pestaña solo da de alta y lista. La referencia de qué datos
son es el corte semanal que hace Cielo a mano — está en
`datos/maquilas/INVENTARIOS MAQUILAS.zip`: un Excel por maquilero con dos
hojas (`producto` en docenas por código, `avíos` por clave con presentación) y
un resumen de cajas que cruza quién tiene qué. Ocho cortes desde el 15 de
junio; el del 17-08 ya incluye a Araceli.

Decisiones de diseño pendientes (para el debate con Codex antes de codear):
- ¿Quién lo alimenta? (a) Cielo sube el Excel semanal, (b) la maquila lo
  reporta desde su portal, o (c) RAGNAR lo deriva de lo enviado menos lo
  devuelto/remitido. La (c) es la buena a largo plazo pero necesita que las
  remisiones descuenten tareas (pendiente 27 del vault); la (a) arranca hoy.
- Si es (a): mismo patrón versionado del plan maestro (subida → borrador →
  puntero), y el lector ya sabe leer ese formato (se analizó el 18-08).
- Avíos y producto son dos inventarios distintos y no se mezclan.

---

## Reporte por tarea: los tres estados de un codigo (para el papa de Roberto)

**Lo pidio Roberto el 2026-08-24 a partir de una platica con su papa. No se
hizo en esa sesion (estaba abierto el tema de precios de maquila).**

Un codigo pasa por tres estados dentro de una orden de compra, y hoy no hay
donde verlos juntos:

1. **Lo que piden** — las docenas que el cliente pidio de ese codigo.
2. **Lo que ya esta capturado y todavia NO se mando a la maquila** — es
   producto que existe en la fabrica y que se puede armar con lo que hay.
3. **Lo que ya se mando a la maquila.**

El modelo a copiar es `OC_2249 Chedraui 13AGO26.xlsx`, que Cielo lleva a mano.
Su hoja **CONCENTRADO** es exactamente ese reporte, un renglon por
pedido+codigo+color+talla: `NoPedido` (7951_SFT419_4/6_3 PACK), `Codigo`
(7934-J), `NumPedido` (= la OT), `MAQUILA`, `ARTICULO`, `No.` (= el MODELO),
`COLOR2`, `TALLA2`, y luego los estados: `SOLICITA` (piden), `TEJIDS`
(tejido), `SOBRAN`, `DOC. A ENVIAR 1ER PARC`, `DOC. ENVIADAS` (ya en maquila),
`DOC. X ENVIO` (falta), `STATUS` ("OK MAQUILA").

Su hoja **ENVIOS** es el detalle folio por folio de lo enviado: `FOLIO`,
`PESO`, `Codigo`, `Descripcion`, `Modelo`, `Color`, `DOCENAS`, `OT`,
`REMISION`, `MAQUILERO`, `FECHA`. RAGNAR ya tiene casi todo eso capturado
(folio, peso, codigo, OT); lo que le falta es el amarre con la remision y el
maquilero, que es justo lo que empezo a existir el 24-08.

⚠️ Ojo antes de codear: el `SOLICITA` viene del pedido del cliente, que hoy
RAGNAR **no tiene** — llega en el archivo de tarea que manda Lindbergh. Sin
esa cifra el reporte solo puede contestar dos de los tres estados.

---

## Poder BORRAR ordenes de compra viejas del historial

**Lo pidio el papa de Roberto el 2026-08-25, en el mismo audio en que pidio
quitar el filtro de dia/semana/mes/año: "tener la orden de compra de todo el
tiempo, y despues que los podamos ir borrando".**

Quitar el filtro ya esta hecho. El borrado NO, a proposito: es destructivo y
antes hay que decidir QUE se borra, porque "la orden de compra" no es un
documento en RAGNAR, es un agrupador que sale del plan maestro.

Lo que cuelga de una OC y habria que decidir uno por uno:

- **Los BULTOS capturados** (peso, folio, docenas). Son el registro de lo que
  la fabrica produjo. Borrarlos cambia los INDICADORES hacia atras.
- **Los PDFs / remisiones** ya emitidos. Un folio consecutivo que existio
  explica un embarque que ya se cobro.
- **Las lineas del PLAN MAESTRO** de esa OC.
- **Las tareas de ensamble** de sus OT, con su tech pack.

⚠️ Tres preguntas antes de codear:

1. ¿Borrar de verdad, o **archivar** (marcarla como cerrada y sacarla de la
   vista, conservando el dato)? Archivar cubre el problema real —que la lista
   crezca sin fin— sin perder historia. **Esta es la que hay que preguntarle.**
2. Si es borrado real: ¿los indicadores deben seguir contando lo borrado?
3. ¿Quien puede? Es la accion mas destructiva de la app: minimo `admin`, con
   confirmacion escribiendo el numero de la OC, y bitacora de quien y cuando.

Mientras tanto el volumen esta lejos de ser problema: 2,341 bultos y ~1 MB
para todo el historico (medido el 25-08), con el tope del hook en 300,000
capturas.

---

# ⭐ RECEPCION EN PT: la maquila imprime un codigo de barras y PT lo lee

**Lo pidio Roberto el 2026-08-27**, corrigiendo el supuesto anterior:

> "PT no va a pesar, pero si van a verificar/corroborar manualmente lo que les
> llega, pero que tengan un apartado de recepcion para que ellos lean el codigo
> de barras (nueva cosa que la remision de las maquilas van a tener que
> generar) y ya les va a aparecer todo lo que mando la maquila y ellos van a
> tener que verificar."

Queda descartada la idea de la **bascula para PT** y del cruce por peso contra
lo que peso America. PT **verifica contra el papel**, no pesa.

## El hallazgo que manda sobre todo lo demas

**Hoy lo que la maquila declara NO SE GUARDA.** En
`TareasEnsambleMaquila.jsx`, la captura de entrega (packs, docenas, caja,
observaciones) vive en el estado de React, se imprime en el PDF y **se pierde**:
`declararTareaEnsambleTerminada()` (`utils/tareasEnsamble.js:344`) solo cambia
el estado de la tarea a `declarada` y guarda quien y cuando. La remision
tampoco se persiste, y sale con **`folio: ''`** (`TareasEnsambleMaquila.jsx:154`).

Consecuencia: **las cifras con las que la maquila cobra existen solo en papel.**
Y sin ellas guardadas, un codigo de barras no tiene a que apuntar: PT lo leeria
y no habria nada que mostrarle.

## El orden en que hay que construirlo

1. **Persistir la entrega declarada** — el primer ladrillo, y vale por si solo
   aunque PT tarde. Al declarar, se escribe un documento de **remision** con
   su **folio consecutivo** y sus renglones congelados (codigo, descripcion,
   modelo, talla, packs, docenas, caja, precio unitario y total). Congelado,
   como `pdfsGenerados.capturas[]`: es el papel con el que se cobra, y no debe
   cambiar si manana cambia una tarifa o el catalogo.
2. **El codigo de barras en la remision** — Code128 con el folio de esa
   remision. `jspdf` ya esta; **no hay libreria de barras** en `package.json`,
   hay que meter una o dibujar Code128 a mano.
3. **La pantalla de Recepcion de PT** — lee el folio, trae la remision,
   muestra sus renglones y PT palomea uno por uno: **llego completo /
   faltante / sobrante**, con cantidad y nota. Firma con nombre y hora.
4. **El acta y el reclamo** — lo que no cuadra es lo que se le regresa a la
   maquila. Conecta con la devolucion de tareas que YA existe
   (`devolverTareaEnsamble`).
5. **El inventario de PT** — lo que ingresa, lo que se entrega en cada
   parcialidad y lo que queda.

## Preguntas antes de codear

- **¿El folio de la remision lo pone la maquila o Quini?** Si lo pone la
  maquila desde su portal, dos maquilas podrian chocar en el consecutivo. Lo
  seguro es un consecutivo **por maquila** (`E-658` de Munguia ya tiene esa
  forma) o uno global emitido por Quini al declarar.
- **¿PT puede corregir cantidades, o solo palomear?** Cambia quien es el dueño
  del dato. Lo mas limpio: PT **no** edita lo que dice la maquila; declara
  **lo que el conto**, y la diferencia es el hallazgo.
- **¿Una remision por tarea, o puede una entrega traer varias tareas?** La
  remision de papel de Munguia traia tres OT en un viaje.
- **Reglas de Firestore:** PT (rol `consulta`) hoy no escribe nada. La
  recepcion es su primera escritura y hay que abrirle exactamente eso, sin
  darle acceso al resto del portal de maquilas.

---

# LIBERAR LA REMISION ANTES DE QUE CUENTE COMO COBRO

**Lo pidio Roberto el 2026-08-27:** *"cuando se genere la remision es que se
mande la remision pero que Lindbergh, Cielo y mi papa lo liberen"*. Lo quiere
**semiautomatico a proposito**: el sistema calcula y propone, pero el cobro no
queda en firme hasta que tres personas lo aprueban. Es para que no haya
malentendidos **de los dos lados** — ni la maquila cobra de mas, ni Quini le
regatea despues de que ya entrego.

Los tres que liberan miran cosas distintas, y por eso son tres y no uno:

- **Lindbergh** — ¿esto es lo que yo le encargue?
- **Cielo** — ¿la tarifa aplicada es la correcta?
- **Direccion** — el visto bueno del dinero.

Depende de que **la entrega declarada se guarde primero** (ver la idea de
Recepcion en PT): sin la remision persistida no hay nada que liberar.

Ojo con el diseño: si la remision solo cuenta cuando esta liberada, hay que
decidir **que ve la maquila mientras tanto** — lo peor seria que entregue
mercancia y su papel quede en un limbo sin que ella sepa quien falta de
firmar. Deberia ver el avance de las tres firmas, como ya ve el estado de sus
tareas. Existe `PanelAutorizaciones.jsx`, que ya resuelve aprobaciones en la
app; conviene revisarlo antes de inventar otro mecanismo.

---

## Una tarea de ensamble con VARIAS OTs (o un cacho de una OC)

Salio el 2026-09-01, viendo el perfil de Lindbergh despues de la platica con
Hugo. **Hoy una tarea = UNA orden de trabajo**: `nueva.ot` es un campo de texto
suelto en `PanelTareasMaquila.jsx:42` y se guarda como un string en la tarea
(`tareasEnsamble.js:155`). Lindbergh necesita encargar **varias OTs de un
jalon**, o **un pedazo de una orden de compra** — que en la practica son varias
OTs.

**El cambio que de verdad importa no es el formulario, es donde vive la OT.**
Hoy cuelga de la TAREA; tiene que colgar del RENGLON. Si una tarea cubre tres
OTs y los renglones no dicen de cual vienen:

- La remision imprime la misma OT en todos los renglones
  (`TareasEnsambleMaquila.jsx`, `ot: t.ot` para todo) — y ese papel es con el
  que la maquila cobra.
- El arbol OC -> OT -> codigo no puede acreditar el avance a la OT que toca, y
  el porcentaje de "mandado" por OT deja de cuadrar.

**Lo que hay que decidir antes de picar codigo:**

1. **El destino.** Hoy sale del plan maestro VIA la OT, y la regla de Firestore
   exige que si hay `destino` haya `ot` (`tareasEnsamble.js:214`). Con varias
   OTs puede haber varios subclientes. ¿Se permite mezclar destinos en una
   tarea, o se obliga a que sean del mismo? Lo segundo es mas sano y mas facil
   de explicarle a la maquila.
2. **Las tareas viejas.** Quedan con `ot` escalar. Hay que leer las dos formas
   por un buen rato, no migrar de golpe.
3. **De donde escoge Lindbergh.** No inventar un selector nuevo: ya existe el
   arbol OC -> OT -> codigo (`PanelArbolOrdenes.jsx`, `utils/arbolOrdenes.js`).
   Lo natural es elegir ahi y que la tarea se arme sola con lo seleccionado, en
   vez de teclear las OTs a mano.

⚠️ **Ojo con el precio congelado:** cada renglon ya guarda su precio al crearse.
Si un mismo modelo aparece en dos OTs de la misma tarea, hay que decidir si son
dos renglones o uno sumado — y si se suman, cual OT se lleva el credito.

Lo demas del flujo (el tech pack, iniciar, declarar) **Roberto lo dio por bueno
tal como esta**; esto es lo unico que pidio ampliar.

---

# Tanda del 2026-09-01 — despues de la junta con Lindbergh y Hugo

Transcripcion en
`OneDrive/Videos-para-Claude/transcripciones/2026-09-01_junta-lindbergh-hugo_maquilas-ragnar.txt`
(Roberto grabo solo un tercio de la sesion).

## 🔴 El folio RECHAZADO no lo ve nadie de Quini — verificado en codigo

Esta es la pregunta que Roberto hizo en la junta ("el tema es no depender de
Lindbergh, ¿que pasa con esa nota?") y **la respuesta es peor de lo que
parecia**: cuando la maquila rechaza un folio por peso, se guarda en
`portalMaquila/{mid}/acuses/{id}.foliosRechazados`, y **el unico codigo de toda
la app que lee esa coleccion es el propio portal de la maquila**
(`PortalMaquila.jsx:63`). Ni Roberto, ni el papa, ni Lindbergh, ni America
tienen una sola pantalla donde aparezca. Ademas **el bulto no se mueve**: el
folio sigue figurando como enviado a esa maquila.

O sea: hoy la maquila rechaza, siente que aviso, y del otro lado no se entera
nadie. Es justo el "yo si te avise" que RAGNAR existe para evitar.

**Lo que Roberto pidio:** que el rechazo aparezca en **Registros** para Hugo, su
papa, Lindbergh y America; y que el folio **vuelva** — que no se quede colgado.
Su idea: algo como una "remision chiquita" de retorno, para que todo cuadre.

**Lo que hay que decidir antes de picar codigo:**
1. ¿El folio rechazado **regresa al inventario de Quini** (queda como si no se
   hubiera mandado) o queda en un tercer estado "rechazado, en transito de
   vuelta"? Lo segundo es mas honesto: la mercancia fisicamente esta con la
   maquila hasta que alguien la trae.
2. ¿Quien lo cierra? Si nadie confirma la devolucion fisica, el folio se queda
   en el limbo — el mismo problema, de reversa.
3. La regla de Firestore ya limita `foliosRechazados` a folios que estaban en
   la salida (`firestore.rules:1548`), eso ya esta bien.

## Lindbergh: subir tareas de ensamble DESDE EXCEL

Como ya importa tareas para America. ⏳ **Roberto va a pasar el Excel de
ejemplo**; sin el no se puede definir el parseo. Ya existe
`utils/importarTareas.js` — el punto de partida es ese, no uno nuevo.

Va de la mano con [[la idea de varias OTs por tarea]] de mas arriba: un Excel
con varias OTs es justo el caso que hoy no cabe en el modelo.

## Sustituciones: la maquila propone cambiar un codigo

En la junta salio que al armar una caja de packs **a veces falta un codigo** y
se sustituye por otro para completar. Hoy la maquila no tiene forma de decirlo:
solo puede declarar lo que entrega, no proponer un cambio.

Roberto quiere **darle mas permiso a la maquila**: que al recibir la tarea pueda
decir "esto no me ha llegado, quiero cambiarlo por esto otro".

⚠️ **Ojo con el precio:** el renglon lleva el precio congelado POR MODELO. Si se
sustituye el codigo, el modelo puede cambiar y con el, lo que se paga. Una
sustitucion no puede ser un cambio libre de texto: tiene que ser una
**propuesta que Quini aprueba**, y al aprobarse se recongela el precio. Si no,
se abre justo el hueco que el precio congelado vino a cerrar.

## Maquila: editar su inventario y subirlo por Excel

Que puedan **editar** su material y **cargar un Excel** con lo que tienen, para
no capturarlo a mano. Roberto lo marca como **temporal**: cuando el flujo de
pedir/recibir este completo, el inventario se actualizara solo.

⚠️ Hoy el inventario de la maquila **se deriva de los acuses de envio** — es un
saldo calculado, no capturado. Dejar que se edite a mano significa que el saldo
y su historia pueden dejar de cuadrar. Si se hace, el ajuste manual tiene que
quedar como **un movimiento mas** (con quien, cuando y por que), no como una
sobreescritura silenciosa del saldo. `movimientosAvios` ya existe para eso.

## Maquila: ver sus bultos / OTs en la misma pestaña del material

En "Material recibido", ademas de cajas y avios, que aparezca **lo que tiene por
OT**. La maquila trabaja por OT y hoy esa vista no existe de su lado.

## Futuro (no ahora): recepcion de folios como la hace America

Cuando la maquila tenga modulo propio. Roberto lo deja explicitamente para
despues: "ahorita que no tienen un modulo, pues asi se va a tener que ir
llevando".

## Lo que Roberto dio por bueno tal como esta

Recibir bultos, el tech pack, iniciar/declarar la tarea, y pedir material. No
tocarlos.

