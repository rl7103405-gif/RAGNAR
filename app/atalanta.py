"""
Conexion de SOLO LECTURA al SQL Server del sistema Atalanta.

IMPORTANTE: este modulo nunca debe ejecutar INSERT/UPDATE/DELETE.
Solo se usa para consultar datos de folios y pedidos ya existentes.

Mientras no lleguen las credenciales (SQL_SERVER/SQL_DATABASE/SQL_USER vacios
en el .env), la app funciona en "modo standalone": las consultas devuelven
None y las vistas muestran los campos como pendientes de captura manual.

Esquema real confirmado con Deportivos Quini (julio 2026):
- El folio nace en la etapa de tejido y vive en `Produccion`/`ProduccionDetalles`.
  `ProduccionDetalles` ya trae folio + codigo de producto + docenas + pedido en
  un solo renglon, y es la fuente que usa Atalanta en el proceso de ruteo.
- `Folio` siempre es numerico (se guarda como int en Atalanta), aunque el
  escaner lo entrega como texto — por eso se castea antes de consultar.
- `Papeleta` es un concepto distinto a `Folio`: agrupa varios folios que un
  mismo operador proceso en una sesion/turno. Esta app siempre trabaja a
  nivel Folio (un bulto = un folio); Papeleta no se usa aqui.
- `Pedidos.NombreCliente` ya trae el nombre del cliente directo, no hace
  falta unir con CatClientes.
- `Pedidos.Embarcado` es un campo propio de Atalanta que esta app NUNCA
  escribe (conexion de solo lectura) — el control de embarque de esta app
  vive en su propia base SQLite, independiente de ese campo.
- Nota para el futuro: Quini tambien usa Microsip (ERP) y hojas de Excel en
  paralelo a Atalanta para ciertos procesos (hay tablas como PedidosMicrosip,
  tblOrdenesCompraMicrosip, etc.). Por ahora el folio/pedido/producto se
  resuelve completo dentro de Atalanta y no se necesita tocar Microsip, pero
  si mas adelante falta un dato que solo vive en Microsip o Excel, hay que
  agregar esa fuente por separado.
"""
import logging

from app.config import settings

logger = logging.getLogger("atalanta")

try:
    import pyodbc
except ImportError:  # pyodbc puede no estar instalado en algunos entornos de desarrollo
    pyodbc = None


def atalanta_disponible() -> bool:
    return settings.atalanta_configurado and pyodbc is not None


def _get_connection():
    if not atalanta_disponible():
        return None
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={settings.SQL_SERVER},{settings.SQL_PORT};"
        f"DATABASE={settings.SQL_DATABASE};"
        f"UID={settings.SQL_USER};"
        f"PWD={settings.SQL_PASSWORD};"
        f"TrustServerCertificate=yes;"
    )
    try:
        # ApplicationIntent=ReadOnly como medida adicional de seguridad
        return pyodbc.connect(conn_str + "ApplicationIntent=ReadOnly;", timeout=5)
    except Exception as exc:
        logger.warning("No se pudo conectar a Atalanta: %s", exc)
        return None


def consultar_folio(folio: str) -> dict | None:
    """
    Consulta los datos de un folio en Atalanta: producto, docenas, pedido, cliente,
    fecha de entrega requerida.

    Une ProduccionDetalles (folio -> codigo de producto, docenas, pedido) con
    Pedidos (pedido -> cliente, fecha de entrega). El folio es numerico en
    Atalanta, asi que se castea antes de comparar.

    Devuelve None si Atalanta no esta configurada, no responde, el folio no
    es numerico, o el folio no existe.
    """
    try:
        folio_num = int(str(folio).strip())
    except ValueError:
        logger.warning("Folio no numerico recibido para Atalanta: %r", folio)
        return None

    conn = _get_connection()
    if conn is None:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT TOP 1
                pd.FOLIO AS folio,
                pd.CODIGOPRODUCTO AS codigo_producto,
                pd.DOCENAS AS docenas,
                pd.NOPEDIDO AS pedido_id,
                p.NombreCliente AS cliente,
                p.FechaEntrega AS fecha_entrega
            FROM dbo.ProduccionDetalles pd
            LEFT JOIN dbo.Pedidos p ON p.NoPedido = pd.NOPEDIDO
            WHERE pd.FOLIO = ?
            """,
            folio_num,
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "folio": str(row.folio),
            "codigo_producto": row.codigo_producto,
            "docenas": row.docenas,
            "pedido_id": row.pedido_id,
            "cliente": row.cliente,
            "fecha_entrega": str(row.fecha_entrega) if row.fecha_entrega else None,
        }
    except Exception as exc:
        logger.warning("Error consultando folio %s en Atalanta: %s", folio, exc)
        return None
    finally:
        conn.close()


def consultar_folios_de_pedido(pedido_id: str) -> list[str]:
    """Devuelve la lista de folios asignados a un pedido segun Atalanta."""
    conn = _get_connection()
    if conn is None:
        return []
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT FOLIO FROM dbo.ProduccionDetalles WHERE NOPEDIDO = ?",
            pedido_id,
        )
        return [str(row.FOLIO) for row in cursor.fetchall()]
    except Exception as exc:
        logger.warning("Error consultando folios del pedido %s en Atalanta: %s", pedido_id, exc)
        return []
    finally:
        conn.close()
