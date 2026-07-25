"""
Genera contrasenas aleatorias nuevas para todos los usuarios activos y las
imprime UNA sola vez en pantalla. Correr desde la raiz del proyecto:

    .venv\\Scripts\\python.exe generar_credenciales.py

Anotar las contrasenas y repartirlas: no quedan guardadas en ningun lado en
texto plano (solo el hash en la base de datos).
"""
import secrets

from app.database import SessionLocal
from app.auth import hash_password, crear_usuarios_default
from app.models import Usuario


def main():
    db = SessionLocal()
    try:
        # Si la base esta recien creada, primero se crean los usuarios base.
        crear_usuarios_default(db)

        usuarios = db.query(Usuario).filter(Usuario.activo == True).order_by(Usuario.id).all()  # noqa: E712
        if not usuarios:
            print("No hay usuarios activos en la base de datos.")
            return

        print("\nContraseñas nuevas (anótalas, no se vuelven a mostrar):\n")
        print(f"{'Usuario':<15} {'Estación':<12} Contraseña")
        print("-" * 45)
        for usuario in usuarios:
            password = secrets.token_urlsafe(9)
            usuario.password_hash = hash_password(password)
            print(f"{usuario.nombre_usuario:<15} {usuario.estacion or '-':<12} {password}")
        db.commit()
        print("\nListo: las contraseñas anteriores dejaron de funcionar.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
