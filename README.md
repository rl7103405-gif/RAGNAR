# Sistema de Trazabilidad — Deportivos Quini

Aplicacion web interna para capturar y comparar pesos en dos puntos del
proceso productivo, validar folios y generar documentos de embarque
automaticamente. Corre en una PC servidor dentro de la red local y se
accede desde las demas PCs por navegador.

## Estaciones

| Ruta | Estacion | Que hace |
|---|---|---|
| `/produccion` | Produccion | Pesa el bulto recien armado y lo asocia a un folio |
| `/ruteadores` | Ruteadores | Consulta datos del pedido (Atalanta), imprime etiqueta Zebra |
| `/procesos` | America (procesos finales) | Pesa el bulto terminado y compara contra produccion |
| `/embarque` | America (embarque) | Valida folios contra el pedido y genera el PDF de salida |
| `/admin` | Administracion | Log de bultos, estatus del sistema, calibracion de peso |

## Requisitos

- Python 3.11+
- Windows con el driver ODBC "ODBC Driver 17 for SQL Server" si se va a
  conectar a Atalanta (opcional, la app funciona sin el)

## Instalacion

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env        # Windows (cp en Linux/Mac)
```

Editar `.env` con la configuracion real (SQL Atalanta, puerto de la
bascula, IP de la impresora Zebra). Todo puede quedar vacio para
arrancar en modo standalone: la app detecta automaticamente si Atalanta
o la Zebra no estan configuradas y sigue funcionando (captura manual de
datos de pedido, etiqueta solo se genera en ZPL sin enviarse).

## Arrancar el servidor central

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

La base de datos SQLite (`quini_trazabilidad.db`) y los usuarios por
defecto se crean automaticamente al primer arranque.

Desde otras PCs de la red, abrir en el navegador:
`http://<IP-del-servidor>:8000`

### Usuarios por defecto (cambiar en produccion)

| Usuario | Contrasena | Estacion |
|---|---|---|
| produccion | produccion | Produccion |
| ruteadores | ruteadores | Ruteadores |
| america | america | Procesos finales |
| embarque | embarque | Embarque |
| admin | admin | Administracion |

## Bascula (bridge local)

En cada PC que tenga una bascula TORREY EQM-400/800 conectada (Produccion
y America), correr el script independiente:

```bash
cd bridge
pip install pyserial fastapi uvicorn python-dotenv
python bascula_bridge.py
```

Expone `GET http://localhost:8001/peso` con la ultima lectura. La
pagina web de esa misma PC lo consulta directamente al presionar
"Capturar peso". Configurable via `.env` (`COM_PORT`, `BAUD_RATE`,
`BASCULA_BRIDGE_PORT`).

## Impresora Zebra

`app/zebra_print.py` genera el ZPL de la etiqueta (con codigo de barras
Code128 del folio) y lo envia por red al puerto configurado en
`ZEBRA_IP`/`ZEBRA_PORT`. Mientras `ZEBRA_IP` este vacio, el ZPL se genera
pero no se envia (la vista de Ruteadores lo indica).

## Conexion a Atalanta (SQL Server, solo lectura)

`app/atalanta.py` nunca ejecuta INSERT/UPDATE/DELETE, solo SELECT, y usa
`ApplicationIntent=ReadOnly`. Mientras `SQL_SERVER`/`SQL_DATABASE`/`SQL_USER`
esten vacios en `.env`, la app opera en modo standalone: los datos del
pedido se capturan manualmente en la vista de Ruteadores. Ajustar el
nombre de tabla/columnas en `consultar_folio()` cuando se conozca el
esquema real de Atalanta.

## Calibracion de rango de peso

Los primeros 30 bultos que pasan por procesos finales (configurable con
`BULTOS_CALIBRACION`) solo se registran, sin alertas. Al completar el
bulto 30 se calcula automaticamente un rango aceptable de diferencia de
peso. A partir de ahi cada bulto se compara contra ese rango: verde si
esta dentro, rojo si esta fuera (permite continuar con confirmacion
manual del operador). Ver el estado de la calibracion en `/admin`.

## Estructura del proyecto

```
app/
  main.py              punto de entrada FastAPI
  config.py            configuracion desde .env
  database.py          motor SQLAlchemy (SQLite, migrable a Postgres/SQL Server)
  models.py            tablas: bultos, embarques, config_rango_peso, usuarios
  auth.py              login simple por usuario (cookie de sesion)
  atalanta.py          conexion de solo lectura a Atalanta
  zebra_print.py       generacion/envio de ZPL
  routers/             endpoints de cada estacion + admin + login
  services/
    calibracion.py     logica de calibracion de rango de peso
    pdf_embarque.py     generacion del documento de salida en PDF
  templates/           vistas HTML (Jinja2)
  static/              CSS y JS vanilla
bridge/
  bascula_bridge.py    script independiente que lee la bascula por COM3
embarques_pdf/         PDFs generados (no se versiona)
```

## Migrar de SQLite a PostgreSQL/SQL Server

Solo cambiar `DATABASE_URL` en `.env` (ej.
`postgresql://usuario:pass@host/db`) e instalar el driver correspondiente
(`psycopg2-binary`). El resto del codigo usa SQLAlchemy y no depende de
SQLite.
