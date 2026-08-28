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
