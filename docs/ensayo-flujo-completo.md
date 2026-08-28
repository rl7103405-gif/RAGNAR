# Ensayo del flujo completo — guion para la demostración

*Actualizado el 2026-08-28. Los archivos están en `datos\pruebas\`.*

El recorrido va **desde que América sube los folios del día hasta que la
maquila cobra**. Nada de esto toca la operación real.

---

## Antes de empezar

**Los dos archivos**, en `datos\pruebas\`:

1. `1-RUTEO-del-dia-PRUEBA.xlsx` — los 12 folios del día.
2. `2-TAREA-para-la-maquila-PRUEBA.xlsx` — la tarea de Lindbergh.

Los dos **ya se pasaron por los parsers de verdad de RAGNAR**: 12 registros y
0 errores el primero, 6 renglones el segundo. No van a tronar al subirlos.

**Las cuentas** (contraseñas en `RAGNAR-CUENTAS.xlsx`):

| Cuenta | Quién es | Qué hace |
|---|---|---|
| **la tuya (real)** | Roberto | **sube el ruteo** — ver abajo por qué |
| `demo_pesador` | Ángel o Juan | pesa los bultos |
| `demo_embarques` | embarques | genera la salida a la maquila |
| `demo_tareas` | Lindbergh | encarga la tarea |
| `demo_maquila` | la maquila | recibe, arma y cobra |
| `demo_pt` | Valeria | Producto Terminado |

Lo más cómodo: cada cuenta en una ventana de incógnito distinta.

## ⚠️ Por qué el ruteo lo subes TÚ y no una cuenta de prueba

No es un descuido: **el servidor se lo prohíbe a las cuentas de prueba**
(`soloCuentaReal()`, `firestore.rules:724`). El razonamiento está escrito en la
propia regla — el ruteo del día es de toda la planta y es acumulativo, así que
una carga de prueba pisaría folios buenos sin manera de distinguirla después.

Y al revés: **una cuenta de prueba solo puede capturar folios que empiecen con
`ZZTEST`** (`firestore.rules:143`). Por eso los 12 folios se llaman `ZZTEST-01`
… `ZZTEST-12`. Como ningún folio de la planta empieza así, **subir este archivo
no puede pisar nada**.

> Esto de por sí ya es algo que enseñar: los candados no son buenas
> intenciones ni disciplina del que captura. **Están en el servidor**, y valen
> aunque alguien se equivoque de cuenta.

---

## El recorrido

### 1 · América sube los folios del día *(con tu cuenta real)*

**Carga de ruteo → sube `1-RUTEO-del-dia-PRUEBA.xlsx`.**

Deben entrar **12 folios, 72 docenas, 3 órdenes de trabajo** (9901, 9902,
9903).

> **Qué hacer notar:** el archivo **acumula, no reemplaza**. Subir el del día
> no borra lo de ayer; cada folio se actualiza si ya existía. Eso es lo que
> permite subirlo varias veces al día sin miedo.

### 2 · Se pesan los bultos (`demo_pesador`)

**Captura.** Teclea `ZZTEST-01`, pesa, y repite con los que quieras — con 4 o
5 basta para la demostración.

Al teclear el folio, **antes de pesar**, la pantalla ya enseña el código, la
descripción y las docenas. Ahí es donde se ve que el cruce funciona.

> **Qué hacer notar, y es de lo más fuerte que hay:** si un folio **todavía no
> está en el ruteo**, el bulto se guarda igual y dice *SIN RUTEO* — no se
> pierde. En cuanto se sube el Excel, el sistema lo cruza solo y recupera su
> código, sus docenas y su orden. **Ya pasó 101 veces**, y esta semana se
> recuperaron 447 folios de una sentada.
>
> Para enseñarlo en vivo: captura un `ZZTEST-99` que no está en la lista, y
> déjalo ahí como ejemplo de que no se perdió.

### 3 · Sale a la maquila (`demo_embarques`)

Genera el **PDF de salida** hacia la maquila de pruebas con los folios
capturados. Ahí nace el **folio interno** del documento.

> **Qué hacer notar:** lo que sale en ese PDF queda **congelado**. Si mañana
> se corrige un dato, el papel que se reimprima sigue cuadrando con el que
> recibió la maquila, porque se guarda copia de lo que decía.

### 4 · Lindbergh encarga la tarea (`demo_tareas`)

**Tareas → nueva tarea**, elige la **maquila de pruebas** y sube
`2-TAREA-para-la-maquila-PRUEBA.xlsx`.

> ⚠️ Va a decir que son tareas **"especiales" / fuera del plan maestro**. Es
> correcto y conviene adelantarlo: las OT 9901-9903 son inventadas y no están
> en la planeación de Adrián. En la operación real sí cuadran.

> **Qué hacer notar:** al crear la tarea, RAGNAR **congela** descripción,
> modelo y talla de cada código, sacándolos del catálogo. La maquila es
> externa y no puede leerlo — si no se congelara ahí, su remisión saldría en
> blanco.

### 5 · La maquila recibe (`demo_maquila`)

Entra al portal. Ve **solo lo suyo**: sus remisiones agrupadas por orden de
trabajo y sus tareas. Pica **"Confirmo que recibí todo"**, o marca faltantes.

> **Qué hacer notar:** todas las maquilas entran a la misma dirección. Que
> cada una vea solo lo suyo **no es que la pantalla lo esconda**: el servidor
> le niega el resto. Ni siquiera puede ver que existen las demás.

### 6 · ⭐ La maquila declara y cobra — el corazón de la demostración

En la tarea, **"Ya terminé"**. Captura lo entregado:

| Código | Packs | Docenas |
|---|---|---|
| 1506-I | 12 | 12 |
| 1508-I | 12 | 12 |
| 1527-I | 10 | 10 |
| 1528-I | 10 | 10 |
| 7934-J | 14 | 14 |
| 7935-J | 14 | 14 |

Se descarga la remisión. **El total debe dar $464.00:**

| Modelo | Códigos que agrupa | Docenas | Precio | Importe |
|---|---|---|---|---|
| SFT106 | 1506-I, 1508-I | 24 | $6.50 | $156.00 |
| SFT113 | 1527-I, 1528-I | 20 | $7.00 | $140.00 |
| SFT419 | 7934-J, 7935-J | 28 | $6.00 | $168.00 |
| | | | **TOTAL** | **$464.00** |

> **Lo que hay que hacer notar:**
>
> **El precio va por MODELO, no por código.** 1506-I y 1508-I son códigos
> distintos —otra talla u otro color— pero **el mismo modelo**, y se pagan
> igual. Cielo lo confirmó por escrito, y es lo que hace viable capturar
> precios: **123 en vez de miles**.
>
> **Nadie tecleó un precio.** La maquila solo dice cuánto armó.
>
> **Y es por DOCENA, no por pack.** Comprobado contra 2,229 renglones del
> histórico de pagos y contra una remisión de papel de Munguía.

### 7 · Producto Terminado (`demo_pt`) — lo que sigue

Enseña lo que ya ve: órdenes de compra con su avance, Historial, y el
desglose de cada documento emitido.

> **Aquí se plantea lo que falta. PT no va a pesar: va a verificar.**
>
> - La remisión de la maquila va a traer un **código de barras** (hoy no).
> - PT lo lee y le aparece **todo lo que mandó la maquila**.
> - Palomea renglón por renglón: completo, faltante, sobrante.
> - Lo que no cuadre queda con nombre y hora, y es lo que se le reclama.
> - De ahí sale el **inventario de PT**.
>
> PT no teclea nada para traer la información: solo verifica.

---

## Los números que resumen dónde está RAGNAR hoy

- **2,498 bultos** con su código, orden y docenas — solo 5 sin cruzar.
- **123 precios** de maquila cargados y verificados contra el histórico real.
- **145 packs** amarrados a sus 433 códigos de Quini, sin uno solo faltante.

## Lo que falta para cerrar el ciclo del dinero

1. **Guardar lo que la maquila declara.** Hoy los packs, las docenas y las
   cajas con las que cobra se imprimen en el papel y **no se guardan**. Es el
   primer ladrillo: sin eso no hay nada que enseñarle a quien lea el código de
   barras.
2. **La remisión con código de barras** y la **pantalla de Recepción de PT**.
3. **Congelar el precio en la tarea al crearla**, para que una tarifa nueva no
   cambie lo ya encargado.
4. **La liberación de la remisión**: que la aprueben Lindbergh, Cielo y
   dirección antes de que cuente como cobro.
5. **El inventario de Producto Terminado.**

---

## Si algo falla

**El Excel de ruteo no lo acepta** → revisa que lo subas con tu cuenta real.
Con una de prueba el servidor lo rechaza, y es a propósito.

**No deja capturar el folio** → con `demo_pesador` solo entran los `ZZTEST-*`.

**El precio sale en blanco** → ese modelo no tiene precio para esa maquila. Es
lo correcto: el sistema **nunca inventa un precio** ni pone cero.

**Quiero repetir el ensayo desde cero** →
`cd web && EJECUTAR=1 node scripts/limpiar_ensayo.mjs` borra los `ZZTEST-*` y
deja todo listo para volver a empezar.
