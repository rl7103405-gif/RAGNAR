"""
Conexion de SOLO LECTURA al SQL Server del sistema Atalanta.

IMPORTANTE: este modulo nunca debe ejecutar INSERT/UPDATE/DELETE.
Solo se usa para consultar datos de folios y pedidos ya existentes.

Mientras no lleguen las credenciales (SQL_SERVER/SQL_DATABASE/SQL_USER vacios
en el .env), la app funciona en "modo standalone": las consultas devuelven
None y las vistas muestran los campos como pendientes de captura manual.
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

    Devuelve None si Atalanta no esta configurada, no responde, o el folio no existe.
    Ajustar el nombre de tablas/columnas reales cuando se tenga acceso al esquema.
    """
    conn = _get_connection()
    if conn is None:
        return None
    try:
        cursor = conn.cursor()
        # NOTA: ajustar nombres de tabla/columnas al esquema real de Atalanta.
        cursor.execute(
            """
            SELECT TOP 1
                folio, codigo_producto, docenas, pedido_id, cliente, fecha_entrega
            FROM dbo.vw_folios_pedido
            WHERE folio = ?
            """,
            folio,
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "folio": row.folio,
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
            "SELECT folio FROM dbo.vw_folios_pedido WHERE pedido_id = ?",
            pedido_id,
        )
        return [row.folio for row in cursor.fetchall()]
    except Exception as exc:
        logger.warning("Error consultando folios del pedido %s en Atalanta: %s", pedido_id, exc)
        return []
    finally:
        conn.close()
