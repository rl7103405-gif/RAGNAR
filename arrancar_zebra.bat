@echo off
REM ============================================
REM Deportivos Quini - Impresora Zebra (etiquetas)
REM Corre en la PC donde esta conectada la Zebra (USB o red).
REM  - USB: no hay que configurar nada, detecta el driver ZDesigner solo.
REM  - Red: configura ZEBRA_IP en el archivo .env.
REM ============================================
cd /d %~dp0
.venv\Scripts\python bridge\zebra_bridge.py
pause
