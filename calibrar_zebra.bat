@echo off
REM ============================================
REM Deportivos Quini - Recalibrar la Zebra
REM
REM Corre esto cuando las etiquetas empiecen a salir CORTADAS o la impresora
REM de saltos largos de papel. Le vuelve a ensenar el tamano real del rollo
REM (10 x 8.2 cm) y recalibra su sensor.
REM
REM Va a expulsar 2-3 etiquetas EN BLANCO: es normal, las esta midiendo.
REM ============================================
cd /d %~dp0
.venv\Scripts\python bridge\calibrar_zebra.py
echo.
echo Si quieres comprobar el resultado, corre: comprobar_etiqueta.bat
pause
