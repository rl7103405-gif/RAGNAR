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


@app.on_event("startup")
def iniciar_aplicacion():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        crear_usuarios_default(db)
    finally:
        db.close()
