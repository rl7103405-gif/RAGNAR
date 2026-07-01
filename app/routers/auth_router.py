from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Usuario
from app.auth import verificar_password, crear_cookie_sesion, leer_sesion, COOKIE_NAME

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/login", response_class=HTMLResponse)
def login_form(request: Request, error: str | None = None):
    if leer_sesion(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request, "error": error})


@router.post("/login")
def login_submit(
    request: Request,
    nombre_usuario: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    usuario = db.query(Usuario).filter(
        Usuario.nombre_usuario == nombre_usuario, Usuario.activo == True  # noqa: E712
    ).first()
    if not usuario or not verificar_password(password, usuario.password_hash):
        return RedirectResponse("/login?error=Usuario+o+contrase%C3%B1a+incorrectos", status_code=303)

    destino = {
        "produccion": "/produccion",
        "ruteadores": "/ruteadores",
        "procesos": "/procesos",
        "embarque": "/embarque",
        "admin": "/admin",
    }.get(usuario.estacion, "/")

    response = RedirectResponse(destino, status_code=303)
    response.set_cookie(COOKIE_NAME, crear_cookie_sesion(usuario), httponly=True, max_age=60 * 60 * 12)
    return response


@router.get("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE_NAME)
    return response


@router.get("/", response_class=HTMLResponse)
def raiz(request: Request):
    sesion = leer_sesion(request)
    if not sesion:
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse("inicio.html", {"request": request, "usuario": sesion})
