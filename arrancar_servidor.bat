@echo off
REM ============================================
REM Deportivos Quini - Arrancar servidor central
REM Las demas PCs entran desde el navegador con:
REM http://IP-DE-ESTA-PC:8000
REM ============================================
cd /d %~dp0

echo.
echo Direcciones IP de esta PC (usa una de estas desde las otras PCs):
ipconfig | findstr /i "IPv4"
echo.
echo Servidor corriendo en http://localhost:8000
echo Para detenerlo: cierra esta ventana o presiona Ctrl+C
echo.

.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
