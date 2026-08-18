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
