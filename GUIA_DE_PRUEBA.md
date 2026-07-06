# Guía de prueba — Sistema de Trazabilidad Deportivos Quini

Esta guía es para probar el sistema en una PC con Windows **sin necesidad
de báscula, impresora ni Atalanta**. Todo funciona en modo de prueba.

## 1. Instalar (una sola vez)

1. Instala Python 3.11 o más nuevo desde https://www.python.org/downloads/
   - **IMPORTANTE:** marca la casilla **"Add Python to PATH"** al instalar.
2. Copia esta carpeta completa a la PC (por ejemplo a `C:\Quini`).
3. Doble clic en **`instalar.bat`** y espera a que termine.

## 2. Arrancar el sistema de prueba

Abre estos dos archivos (quedan dos ventanas negras abiertas — no las cierres):

1. **`arrancar_servidor.bat`** — el servidor central.
2. **`arrancar_bascula_simulada.bat`** — simula la báscula (da pesos de ~1500 g).

Luego abre el navegador en: **http://localhost:8000**

## 3. Usuarios de prueba

| Usuario | Contraseña | Estación |
|---|---|---|
| produccion | produccion | Producción |
| ruteadores | ruteadores | Ruteadores |
| america | america | Procesos finales |
| embarque | embarque | Embarque |
| admin | admin | Administración |

## 4. Flujo de prueba sugerido (10 minutos)

1. **Producción** (usuario `produccion`):
   - Escribe un folio (o escanéalo con el lector): ej. `PRUEBA-001` y presiona nada más — el campo ya está enfocado.
   - Clic en **Capturar peso** → aparece el peso simulado.
   - Clic en **Guardar**.
2. **Ruteadores** (usuario `ruteadores`):
   - Escanea/escribe `PRUEBA-001` y presiona **Enter**.
   - Como Atalanta no está conectado, captura a mano: código, docenas, pedido (ej. `PED-1`) y cliente.
   - Clic en **Confirmar e imprimir etiqueta** (dirá que la impresora no está configurada — es normal).
3. **Procesos Finales** (usuario `america`):
   - Escanea `PRUEBA-001` + **Enter** → muestra el peso de producción.
   - Clic en **Capturar peso actual** → muestra la diferencia.
   - Clic en **Guardar** (los primeros 30 bultos son fase de calibración, sin alertas).
4. **Embarque** (usuario `embarque`):
   - Selecciona el pedido `PED-1`.
   - Escanea `PRUEBA-001` + **Enter** → lo valida y marca como embarcado.
   - Cuando todos los folios del pedido estén escaneados se activa el botón
     **Generar documento de salida** → descarga el PDF.
5. **Administración** (usuario `admin`):
   - Revisa el log de bultos, el estatus del sistema y la calibración.

## 5. Probar el lector de código de barras

El lector TZBESC3 funciona como teclado: conéctalo por USB, pon el cursor
en el campo de folio (ya se enfoca solo) y escanea — el número aparece y
se procesa como si lo hubieras tecleado con Enter al final.

## 6. Cuando llegue el hardware real

- **Báscula TORREY:** conecta por USB, verifica en el Administrador de
  dispositivos qué puerto COM le asignó Windows, ponlo en el archivo `.env`
  (`COM_PORT=COM3`) y usa `arrancar_bascula_real.bat` en lugar de la simulada.
- **Impresora Zebra:** pon su IP en `.env` (`ZEBRA_IP=192.168.x.x`) y
  reinicia el servidor. Las etiquetas saldrán solas al confirmar en Ruteadores.
- **Atalanta:** llena `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`
  en `.env` y reinicia. Los datos del pedido se llenarán solos al escanear.

## 7. Acceder desde otras PCs

En la ventana del servidor aparece la IP de la PC (ej. `192.168.1.50`).
Desde cualquier otra PC de la red abre: `http://192.168.1.50:8000`

> Si no abre, revisa que el Firewall de Windows permita conexiones
> entrantes al puerto 8000 (la primera vez Windows pregunta — clic en
> "Permitir acceso").
