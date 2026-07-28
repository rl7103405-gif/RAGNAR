@echo off
REM ============================================
REM Deportivos Quini - Arranca los DOS bridges (bascula + Zebra)
REM en ventanas minimizadas. Este archivo tambien esta copiado en la
REM carpeta de Inicio de Windows para que corran solos al prender la PC.
REM Ruta ABSOLUTA a proposito: la copia que vive en la carpeta Startup
REM se ejecuta desde alli, y una ruta relativa (%~dp0) apuntaria a la
REM carpeta equivocada.
REM Cada bridge escribe su salida en logs\ : si uno truena al arrancar
REM (puerto ocupado, dependencia faltante), queda el rastro ahi en vez
REM de una ventana que se cierra sin decir nada.
REM ============================================
set RAGNAR_DIR=C:\Users\elita\Desktop\RAGNAR
if not exist "%RAGNAR_DIR%\logs" mkdir "%RAGNAR_DIR%\logs"
start "Bascula RAGNAR" /min cmd /c "cd /d %RAGNAR_DIR% && .venv\Scripts\python bridge\bascula_bridge.py >> logs\bascula_bridge.log 2>&1"
start "Zebra RAGNAR" /min cmd /c "cd /d %RAGNAR_DIR% && .venv\Scripts\python bridge\zebra_bridge.py >> logs\zebra_bridge.log 2>&1"
