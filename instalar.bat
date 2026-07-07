@echo off
REM ============================================
REM Deportivos Quini - Instalador (ejecutar una sola vez)
REM Requiere Python 3.11+ instalado (python.org)
REM ============================================
cd /d %~dp0

echo Creando entorno virtual...
python -m venv .venv
if errorlevel 1 (
    echo ERROR: No se encontro Python. Instalalo desde https://www.python.org/downloads/
    echo IMPORTANTE: marca la casilla "Add Python to PATH" durante la instalacion.
    pause
    exit /b 1
)

echo Instalando dependencias (puede tardar unos minutos)...
.venv\Scripts\pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: Fallo la instalacion de dependencias principales.
    echo Revisa el mensaje de error de arriba y avisa al soporte.
    pause
    exit /b 1
)

echo.
echo Instalando conector opcional a SQL Server (Atalanta)...
echo Si esto falla NO es grave: el sistema funciona sin el hasta
echo que se conecte a Atalanta (requiere Microsoft C++ Build Tools).
.venv\Scripts\pip install -r requirements-atalanta.txt

if not exist .env (
    copy .env.example .env
    echo Archivo .env creado con configuracion por defecto.
)

echo.
echo ============================================
echo Instalacion completada.
echo Para arrancar el sistema ejecuta: arrancar_servidor.bat
echo ============================================
pause
