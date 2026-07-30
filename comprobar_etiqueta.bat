@echo off
REM ============================================
REM Deportivos Quini - Comprobar el area util de la etiqueta
REM
REM Imprime una etiqueta de diagnostico con una regla (y=50, y=100...) y un
REM marco. Sirve para ver de un vistazo si la impresora esta usando TODA la
REM etiqueta o si esta cortando contenido.
REM
REM Con el rollo de 10 x 8.2 cm la regla debe llegar hasta y=600 y el marco
REM debe verse completo en UNA sola etiqueta.
REM ============================================
cd /d %~dp0
.venv\Scripts\python bridge\diagnostico_etiqueta.py
pause
