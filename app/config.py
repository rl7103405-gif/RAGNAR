"""Configuracion central de la aplicacion, cargada desde .env"""
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

    # Calibracion
    BULTOS_CALIBRACION = int(os.getenv("BULTOS_CALIBRACION", "30"))

    @property
    def atalanta_configurado(self) -> bool:
        """True si hay credenciales suficientes para conectar a Atalanta."""
        return bool(self.SQL_SERVER and self.SQL_DATABASE and self.SQL_USER)

    @property
    def zebra_configurada(self) -> bool:
        return bool(self.ZEBRA_IP)


settings = Settings()
