"""
Sistema de Trazabilidad - Deportivos Quini

Servidor central FastAPI. Corre en la PC que actua como servidor y es
accedido desde las demas PCs de la red local por IP (ej. http://192.168.1.50:8000).
"""
import logging

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine, SessionLocal
from app.auth import NoAutenticado, crear_usuarios_default
from app.routers import auth_router, produccion, ruteadores, procesos, embarque, admin

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

app = FastAPI(title="Deportivos Quini - Sistema de Trazabilidad")

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(auth_router.router)
app.include_router(produccion.router)
app.include_router(ruteadores.router)
app.include_router(procesos.router)
app.include_router(embarque.router)
app.include_router(admin.router)


@app.exception_handler(NoAutenticado)
def manejar_no_autenticado(request: Request, exc: NoAutenticado):
    return RedirectResponse("/login", status_code=303)


def _migraciones_ligeras():
    """Agrega columnas nuevas a bases de datos creadas con versiones anteriores."""
    from sqlalchemy import text, inspect
    inspector = inspect(engine)
    if "embarques" in inspector.get_table_names():
        columnas = {c["name"] for c in inspector.get_columns("embarques")}
        if "maquila" not in columnas:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE embarques ADD COLUMN maquila VARCHAR"))


@app.on_event("startup")
def iniciar_aplicacion():
    Base.metadata.create_all(bind=engine)
    _migraciones_ligeras()
    db = SessionLocal()
    try:
        crear_usuarios_default(db)
    finally:
        db.close()
