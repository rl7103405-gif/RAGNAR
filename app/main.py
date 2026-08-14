"""
Sistema de Trazabilidad - Deportivos Quini

Servidor central FastAPI. Corre en la PC que actua como servidor y es
accedido desde las demas PCs de la red local por IP (ej. http://192.168.1.50:8000).
"""
import logging

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine, SessionLocal
from app.auth import (
    NoAutenticado, AccesoDenegado, RUTA_POR_ESTACION,
    crear_usuarios_default, ensure_usuario_validacion,
)
from app.routers import auth_router, produccion, ruteadores, validacion, procesos, embarque, admin, historial

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("app")

# Swagger/OpenAPI quedan apagados salvo que DOCS_ENABLED=true en .env: exponen
# el mapa completo de la API (rutas, modelos) sin pasar por autenticacion.
app = FastAPI(
    title="Deportivos Quini - Sistema de Trazabilidad",
    docs_url="/docs" if settings.DOCS_ENABLED else None,
    redoc_url="/redoc" if settings.DOCS_ENABLED else None,
    openapi_url="/openapi.json" if settings.DOCS_ENABLED else None,
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(auth_router.router)
app.include_router(produccion.router)
app.include_router(ruteadores.router)
app.include_router(validacion.router)
app.include_router(procesos.router)
app.include_router(embarque.router)
app.include_router(admin.router)
app.include_router(historial.router)


@app.exception_handler(NoAutenticado)
def manejar_no_autenticado(request: Request, exc: NoAutenticado):
    return RedirectResponse("/login", status_code=303)


@app.exception_handler(AccesoDenegado)
def manejar_acceso_denegado(request: Request, exc: AccesoDenegado):
    # Usuario con sesion valida pero de otra estacion: se le manda a la suya.
    return RedirectResponse(RUTA_POR_ESTACION.get(exc.estacion_usuario, "/"), status_code=303)


@app.exception_handler(Exception)
def manejar_error_no_controlado(request: Request, exc: Exception):
    logger.exception("Error no controlado en %s %s", request.method, request.url.path)
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})
    # Rutas de vista (/produccion, /admin, etc.): un operador de piso vería
    # JSON crudo en el navegador ante un error no controlado.
    return HTMLResponse(
        status_code=500,
        content=(
            "<html><body style='font-family:sans-serif; text-align:center; padding:40px;'>"
            "<h2>Ocurrió un error interno</h2>"
            "<p>Intenta de nuevo. Si el problema sigue, avisa a Administración.</p>"
            "</body></html>"
        ),
    )


def _migraciones_ligeras():
    """Agrega columnas nuevas a bases de datos creadas con versiones anteriores."""
    from sqlalchemy import text, inspect
    inspector = inspect(engine)
    if "embarques" in inspector.get_table_names():
        columnas = {c["name"] for c in inspector.get_columns("embarques")}
        if "maquila" not in columnas:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE embarques ADD COLUMN maquila VARCHAR"))
    if "bultos" in inspector.get_table_names():
        columnas = {c["name"] for c in inspector.get_columns("bultos")}
        nuevas = {
            "peso_validacion": "FLOAT",
            "peso_teorico": "FLOAT",
            "diferencia_validacion_porcentaje": "FLOAT",
            "multiplicador_aplicado": "FLOAT",
            "tolerancia_aplicada": "FLOAT",
            "timestamp_validacion": "DATETIME",
            "operador_validacion": "VARCHAR",
        }
        pendientes = {nombre: tipo for nombre, tipo in nuevas.items() if nombre not in columnas}
        if pendientes:
            with engine.begin() as conn:
                for nombre, tipo in pendientes.items():
                    conn.execute(text(f"ALTER TABLE bultos ADD COLUMN {nombre} {tipo}"))


@app.on_event("startup")
def iniciar_aplicacion():
    Base.metadata.create_all(bind=engine)
    _migraciones_ligeras()
    db = SessionLocal()
    try:
        crear_usuarios_default(db)
        ensure_usuario_validacion(db)
    finally:
        db.close()
