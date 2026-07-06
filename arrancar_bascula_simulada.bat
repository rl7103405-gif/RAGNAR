@echo off
REM ============================================
REM Deportivos Quini - Bascula SIMULADA (para pruebas)
REM Corre en la misma PC donde este abierto el navegador.
REM Devuelve pesos aleatorios de ~1500 g.
REM Cuando llegue la bascula real usa: arrancar_bascula_real.bat
REM ============================================
cd /d %~dp0
.venv\Scripts\python bridge\bascula_simulada.py
pause
