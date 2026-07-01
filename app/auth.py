"""Autenticacion simple por usuario, basada en sesion de cookie firmada."""
from itsdangerous import URLSafeSerializer, BadSignature
from fastapi import Request, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Usuario

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
serializer = URLSafeSerializer(settings.SECRET_KEY, salt="quini-sesion")

COOKIE_NAME = "quini_sesion"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verificar_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def crear_cookie_sesion(usuario: Usuario) -> str:
    return serializer.dumps({"id": usuario.id, "nombre_usuario": usuario.nombre_usuario,
                              "nombre_completo": usuario.nombre_completo})


def leer_sesion(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        return serializer.loads(token)
    except BadSignature:
        return None


class NoAutenticado(Exception):
    """Se lanza cuando una vista requiere sesion y no hay ninguna activa."""


def usuario_actual(request: Request) -> dict:
    """Dependencia para vistas HTML: redirige a /login si no hay sesion."""
    sesion = leer_sesion(request)
    if not sesion:
        raise NoAutenticado()
    return sesion


def usuario_actual_api(request: Request) -> dict:
    """Dependencia para endpoints JSON: responde 401 si no hay sesion."""
    sesion = leer_sesion(request)
    if not sesion:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")
    return sesion


def crear_usuarios_default(db: Session):
    """Crea usuarios de ejemplo si la tabla esta vacia, para poder arrancar el MVP."""
    if db.query(Usuario).count() > 0:
        return
    usuarios_default = [
        ("produccion", "Operador Produccion", "produccion", "produccion"),
        ("ruteadores", "Personal Ruteadores", "ruteadores", "ruteadores"),
        ("america", "America", "america", "procesos"),
        ("embarque", "America Embarque", "embarque", "embarque"),
        ("admin", "Administrador", "admin", "admin"),
    ]
    for nombre_usuario, nombre_completo, password, estacion in usuarios_default:
        db.add(Usuario(
            nombre_usuario=nombre_usuario,
            nombre_completo=nombre_completo,
            password_hash=hash_password(password),
            estacion=estacion,
            activo=True,
        ))
    db.commit()
