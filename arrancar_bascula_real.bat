@echo off
REM ============================================
REM Deportivos Quini - Bascula REAL (TORREY EQM en COM3)
REM Corre en cada PC que tenga la bascula conectada por USB.
REM El puerto COM se configura en el archivo .env (COM_PORT=COM3)
REM ============================================
cd /d %~dp0
.venv\Scripts\python bridge\bascula_bridge.py
pause
