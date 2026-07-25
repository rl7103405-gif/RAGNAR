"""Configuracion central de la aplicacion, cargada desde .env"""
import math
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # SQL Atalanta (solo lectura) - puede estar vacio (modo standalone)
    SQL_SERVER = os.getenv("SQL_SERVER", "")
    SQL_DATABASE = os.getenv("SQL_DATABASE", "")
    SQL_USER = os.getenv("SQL_USER", "")
    SQL_PASSWORD = os.getenv("SQL_PASSWORD", "")
    SQL_PORT = os.getenv("SQL_PORT", "1433")

    # Bascula
    COM_PORT = os.getenv("COM_PORT", "COM3")
    BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
    BASCULA_BRIDGE_PORT = int(os.getenv("BASCULA_BRIDGE_PORT", "8001"))

    # Impresora Zebra
    ZEBRA_IP = os.getenv("ZEBRA_IP", "")
    ZEBRA_PORT = int(os.getenv("ZEBRA_PORT", "9100"))

    # Base de datos propia
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./quini_trazabilidad.db")

    # App
    APP_PORT = int(os.getenv("APP_PORT", "8000"))
    SECRET_KEY = os.getenv("SECRET_KEY", "cambia-esta-clave-en-produccion")
    # Swagger/OpenAPI (/docs, /redoc, /openapi.json) expone el mapa completo de
    # la API sin autenticacion: apagado por defecto, se activa solo para
    # desarrollo local vía .env.
    DOCS_ENABLED = os.getenv("DOCS_ENABLED", "false").strip().lower() in ("true", "1", "si", "sí")

    # Calibracion
    BULTOS_CALIBRACION = int(os.getenv("BULTOS_CALIBRACION", "30"))

    # Peso maximo aceptado por captura, en gramos. Una lectura por encima de
    # esto casi seguro es un error de bascula, no un bulto real.
    PESO_MAX_GRAMOS = float(os.getenv("PESO_MAX_GRAMOS", "100000"))

    # ---- Estacion de Validacion (puente mientras no hay acceso SQL al ERP) ----
    # Mientras este activa, Produccion y Ruteadores quedan bloqueados (la
    # validacion los reemplaza) y se ocultan del menu.
    VALIDACION_ACTIVA = os.getenv("VALIDACION_ACTIVA", "true").strip().lower() in ("true", "1", "si", "sí")
    # Peso teorico del bulto = peso_unitario_del_codigo (suma de materiales del
    # catalogo, gramos) x total de docenas x este multiplicador. El valor real
    # se deducira en la prueba de 30 bultos (admin muestra la sugerencia).
    MULTIPLICADOR_VALIDACION = float(os.getenv("MULTIPLICADOR_VALIDACION", "12"))
    # Diferencia porcentual (absoluta) contra el peso teorico a partir de la
    # cual el bulto se retiene.
    TOLERANCIA_VALIDACION_PORCENTAJE = float(os.getenv("TOLERANCIA_VALIDACION_PORCENTAJE", "10"))
    # observacion: registra la diferencia pero NUNCA retiene (fase de prueba /
    # deduccion del multiplicador). enforcement: retiene fuera de tolerancia.
    VALIDACION_MODO = os.getenv("VALIDACION_MODO", "observacion").strip().lower()

    @property
    def atalanta_configurado(self) -> bool:
        """True si hay credenciales suficientes para conectar a Atalanta."""
        return bool(self.SQL_SERVER and self.SQL_DATABASE and self.SQL_USER and self.SQL_PASSWORD)

    @property
    def zebra_configurada(self) -> bool:
        return bool(self.ZEBRA_IP)


settings = Settings()

# La clave por defecto es publica (esta en el repositorio): con ella cualquiera
# puede falsificar cookies de sesion de admin. La app se niega a arrancar
# hasta que .env tenga una clave unica y con suficiente entropía (una clave
# corta tipo "x" se fuerza por fuerza bruta en segundos).
if (
    not settings.SECRET_KEY
    or settings.SECRET_KEY == "cambia-esta-clave-en-produccion"
    or len(settings.SECRET_KEY) < 32
):
    raise RuntimeError(
        "SECRET_KEY sin configurar o demasiado corta en .env (mínimo 32 caracteres).\n"
        "Genera una clave única con:\n"
        '  python -c "import secrets; print(secrets.token_hex(32))"\n'
        "y pégala en .env como SECRET_KEY=<clave>"
    )

# Un multiplicador o tolerancia mal configurados (0, negativos, o texto que
# terminó en NaN/inf) dejarían pasar cualquier peso como "válido" en
# silencio: la app se niega a arrancar en vez de fallar abierto.
if not math.isfinite(settings.MULTIPLICADOR_VALIDACION) or settings.MULTIPLICADOR_VALIDACION <= 0:
    raise RuntimeError(
        f"MULTIPLICADOR_VALIDACION inválido en .env: {settings.MULTIPLICADOR_VALIDACION!r}. "
        "Debe ser un número finito mayor a 0."
    )
if not math.isfinite(settings.TOLERANCIA_VALIDACION_PORCENTAJE) or settings.TOLERANCIA_VALIDACION_PORCENTAJE <= 0:
    raise RuntimeError(
        f"TOLERANCIA_VALIDACION_PORCENTAJE inválida en .env: {settings.TOLERANCIA_VALIDACION_PORCENTAJE!r}. "
        "Debe ser un número finito mayor a 0."
    )

# VALIDACION_MODO con un typo fallaria "abierto": ni observa ni retiene lo que
# el operador cree que esta reteniendo. Se rechaza en el arranque.
if settings.VALIDACION_MODO not in ("observacion", "enforcement"):
    raise RuntimeError(
        f"VALIDACION_MODO inválido en .env: '{settings.VALIDACION_MODO}'. "
        "Valores válidos: 'observacion' o 'enforcement'."
    )

# BULTOS_CALIBRACION=0 (o negativo) rompería el cálculo estadístico de
# calibración sobre una lista vacía; PESO_MAX_GRAMOS mal configurado
# (texto que terminó en NaN/inf, 0 o negativo) desactivaría en silencio el
# límite de peso plausible de la báscula.
if not isinstance(settings.BULTOS_CALIBRACION, int) or settings.BULTOS_CALIBRACION <= 0:
    raise RuntimeError(
        f"BULTOS_CALIBRACION inválido en .env: {settings.BULTOS_CALIBRACION!r}. "
        "Debe ser un entero mayor a 0."
    )
if not math.isfinite(settings.PESO_MAX_GRAMOS) or settings.PESO_MAX_GRAMOS <= 0:
    raise RuntimeError(
        f"PESO_MAX_GRAMOS inválido en .env: {settings.PESO_MAX_GRAMOS!r}. "
        "Debe ser un número finito mayor a 0."
    )
