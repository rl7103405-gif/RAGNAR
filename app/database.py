"""Motor de base de datos propia (SQLite para MVP, migrable a PostgreSQL/SQL Server)."""
import threading

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

# Candado global de escritura: serializa el patron "leer estado -> decidir ->
# escribir" en los endpoints que crean/actualizan registros (embarque,
# ruteo, procesos finales). Es valido porque uvicorn corre en un solo
# proceso (ver arrancar_servidor.bat, sin --workers) y todos los endpoints
# sync comparten el mismo threadpool: un Lock de threading alcanza para
# evitar que dos peticiones concurrentes vean el mismo estado "sin registro"
# y ambas decidan crearlo. Si se migra a multi-worker (varios procesos
# uvicorn) o a Postgres/SQL Server, este Lock ya no sirve entre procesos:
# hay que sustituirlo por bloqueo a nivel de base de datos (SELECT ... FOR
# UPDATE o restricciones UNIQUE que rechacen el duplicado).
candado_escritura = threading.Lock()

es_sqlite = settings.DATABASE_URL.startswith("sqlite")

connect_args = {}
if es_sqlite:
    # timeout: espera hasta 15s si otra escritura tiene bloqueada la base,
    # en lugar de fallar de inmediato con "database is locked".
    connect_args = {"check_same_thread": False, "timeout": 15}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)

if es_sqlite:
    @event.listens_for(engine, "connect")
    def _configurar_sqlite(dbapi_conn, _):
        # WAL permite lecturas concurrentes mientras alguien escribe: necesario
        # porque varias PCs escriben a la vez a traves del mismo servidor.
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=15000")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def commit_seguro(db):
    """Commit con manejo de los errores tipicos de concurrencia en SQLite.

    Convierte errores crudos de base de datos en respuestas HTTP claras para
    el operador, en lugar de un 500 generico que no dice si el dato se guardo.
    """
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Otro equipo guardó este mismo registro al mismo tiempo. Vuelve a escanear el folio para ver su estado actual.",
        )
    except OperationalError:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="La base de datos está ocupada en este momento. Espera un segundo e intenta de nuevo.",
        )


def flush_seguro(db):
    """Flush con el mismo manejo de errores de concurrencia que commit_seguro."""
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Otro equipo guardó este mismo registro al mismo tiempo. Vuelve a escanear el folio para ver su estado actual.",
        )
    except OperationalError:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="La base de datos está ocupada en este momento. Espera un segundo e intenta de nuevo.",
        )
