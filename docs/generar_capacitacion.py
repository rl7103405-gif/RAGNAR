# -*- coding: utf-8 -*-
"""Genera el manual de capacitación imprimible (una hoja por estación)."""
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
)

SALIDA = os.path.join(os.path.dirname(__file__), "capacitacion_quini.pdf")

AZUL = colors.HexColor("#1c2833")
VERDE = colors.HexColor("#27ae60")
ROJO = colors.HexColor("#c0392b")
AMBAR = colors.HexColor("#b9770e")
GRIS = colors.HexColor("#eaeded")

ss = getSampleStyleSheet()
st_titulo = ParagraphStyle("t", parent=ss["Title"], fontSize=24, spaceAfter=2)
st_sub = ParagraphStyle("s", parent=ss["Normal"], fontSize=13, textColor=colors.HexColor("#566573"),
                        alignment=1, spaceAfter=14)
st_h = ParagraphStyle("h", parent=ss["Heading2"], fontSize=15, textColor=AZUL, spaceBefore=10, spaceAfter=6)
st_paso = ParagraphStyle("p", parent=ss["Normal"], fontSize=12.5, leading=19, spaceAfter=7)
st_nota = ParagraphStyle("n", parent=ss["Normal"], fontSize=11, leading=15, textColor=colors.HexColor("#566573"))
st_est = ParagraphStyle("e", parent=ss["Normal"], fontSize=12, leading=16)


def encabezado(el, estacion, quien, objetivo, usuario):
    el.append(Paragraph("DEPORTIVOS QUINI", st_titulo))
    el.append(Paragraph("Sistema de Trazabilidad — Guía de la estación", st_sub))
    tabla = Table(
        [[Paragraph(f"<b>ESTACIÓN: {estacion}</b>", ParagraphStyle("x", parent=st_paso, textColor=colors.white, fontSize=15))],
         [Paragraph(f"<b>¿Quién la usa?</b> {quien}", st_est)],
         [Paragraph(f"<b>¿Para qué sirve?</b> {objetivo}", st_est)],
         [Paragraph(f"<b>Usuario del sistema:</b> {usuario}", st_est)]],
        colWidths=[17.2 * cm])
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), AZUL),
        ("BACKGROUND", (0, 1), (0, -1), GRIS),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    el.append(tabla)
    el.append(Spacer(1, 0.35 * cm))


def pasos(el, lista):
    el.append(Paragraph("Pasos a seguir", st_h))
    for i, texto in enumerate(lista, 1):
        el.append(Paragraph(f"<b>{i}.</b> {texto}", st_paso))


def mensajes(el, filas):
    el.append(Paragraph("Qué significan los mensajes", st_h))
    data = []
    for color, titulo, texto in filas:
        data.append([
            Paragraph(f"<b>{titulo}</b>", ParagraphStyle("m", parent=st_est, textColor=color)),
            Paragraph(texto, st_est),
        ])
    t = Table(data, colWidths=[4.2 * cm, 13 * cm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    el.append(t)


def regla_oro(el, texto):
    el.append(Spacer(1, 0.4 * cm))
    t = Table([[Paragraph(f"<b>REGLA DE ORO:</b> {texto}",
                          ParagraphStyle("r", parent=st_est, textColor=colors.white, fontSize=12.5, leading=17))]],
              colWidths=[17.2 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), AMBAR),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    el.append(t)


doc = SimpleDocTemplate(SALIDA, pagesize=letter, topMargin=1.4 * cm, bottomMargin=1.4 * cm,
                        leftMargin=1.6 * cm, rightMargin=1.6 * cm)
el = []

# ============ 1. PRODUCCIÓN ============
encabezado(el, "PRODUCCIÓN", "Operador de producción",
           "Pesar cada bulto de calcetines recién tejido y registrarlo en el sistema con su folio.",
           "produccion")
pasos(el, [
    "Entra al sistema con tu usuario y contraseña.",
    "Coloca el bulto terminado <b>encima de la báscula</b> y espera a que el peso se estabilice.",
    "Con la pistola, <b>escanea el código de barras del folio</b> (el cursor ya está listo en el campo, no necesitas tocar nada).",
    "Presiona el botón azul <b>“Capturar peso”</b>. El peso aparece en grande en la pantalla.",
    "Revisa que el peso se vea correcto (parecido a lo que marca la báscula).",
    "Presiona el botón verde <b>“Guardar”</b>.",
    "Verifica que salga el <b>mensaje verde</b> de confirmación y que el folio aparezca en la lista de abajo.",
    "Baja el bulto y continúa con el siguiente.",
])
mensajes(el, [
    (VERDE, "Mensaje verde", "Todo bien. El folio quedó registrado con su peso. Sigue con el siguiente bulto."),
    (ROJO, "“El folio ya fue pesado”", "Ese folio ya se registró antes. NO lo vuelvas a pesar. Si crees que es un error, avisa a tu supervisor."),
    (ROJO, "“No se pudo conectar con la báscula”", "La ventana negra de la báscula está cerrada en esta computadora. Avisa a tu supervisor para que la vuelva a abrir."),
])
regla_oro(el, "Un bulto = un folio = una pesada. Nunca guardes un peso si el bulto no está arriba de la báscula.")
el.append(PageBreak())

# ============ 2. RUTEADORES ============
encabezado(el, "RUTEADORES", "Personal de ruteadores",
           "Confirmar los datos del pedido de cada bulto e imprimir la etiqueta que se le pega.",
           "ruteadores")
pasos(el, [
    "Entra al sistema con tu usuario y contraseña.",
    "<b>Escanea el folio</b> del bulto con la pistola y presiona <b>Enter</b> (la pistola normalmente lo manda sola).",
    "El sistema muestra los datos del bulto: peso de producción, código, docenas, pedido y cliente.",
    "<b>Revisa que los datos estén correctos.</b> Si algún campo está vacío, captúralo a mano (código, docenas, pedido, cliente).",
    "Presiona el botón verde <b>“Confirmar e imprimir etiqueta”</b>.",
    "Toma la etiqueta que sale de la impresora Zebra y <b>pégala al bulto</b> en un lugar visible y parejo.",
    "Continúa con el siguiente bulto.",
])
mensajes(el, [
    (VERDE, "Mensaje verde", "El folio quedó ruteado y la etiqueta se imprimió."),
    (ROJO, "“El folio no ha sido pesado en producción”", "Ese bulto se saltó la báscula de Producción. Regrésalo a Producción; no se puede rutear sin peso."),
    (ROJO, "“Ya avanzó y no puede regresarse”", "Ese folio ya está en procesos finales o embarcado. No hay nada que hacer aquí; si necesitas otra etiqueta, avisa a tu supervisor."),
    (AMBAR, "“Ya fue ruteado anteriormente”", "El folio ya tenía etiqueta. Puedes confirmar de nuevo SOLO si necesitas reimprimirla."),
])
regla_oro(el, "La etiqueta es la identidad del bulto en toda la fábrica. Sin etiqueta pegada, el bulto no avanza.")
el.append(PageBreak())

# ============ 3. PROCESOS FINALES ============
encabezado(el, "PROCESOS FINALES (AMÉRICA)", "Personal de América",
           "Pesar el bulto ya terminado (después de cerrado, volteado, hormado, pareado y empaquetado) y comparar contra su peso original.",
           "america")
pasos(el, [
    "Entra al sistema con tu usuario y contraseña.",
    "Coloca el bulto terminado <b>encima de la báscula</b>.",
    "<b>Escanea el folio</b> de la etiqueta del bulto y presiona <b>Enter</b>.",
    "El sistema muestra el peso que tuvo en Producción.",
    "Presiona <b>“Capturar peso actual”</b>. Aparece el peso de ahora y la <b>diferencia</b> en gramos y porcentaje.",
    "Presiona <b>“Guardar”</b>.",
    "Si sale <b>verde</b>: todo normal, sigue con el siguiente bulto.",
    "Si sale <b>alerta roja/naranja</b> (diferencia fuera de rango): <b>NO confirmes de inmediato</b>. Revisa el bulto y avisa a tu supervisor; solo confirma si él lo autoriza.",
])
mensajes(el, [
    (VERDE, "Diferencia normal", "La merma del proceso está dentro de lo esperado. El bulto queda listo para embarque."),
    (AMBAR, "“Fase de calibración”", "El sistema está aprendiendo con los primeros 30 bultos. Es normal, no es un error. Solo registra y continúa."),
    (ROJO, "“Fuera del rango esperado”", "El bulto perdió o ganó más peso del normal. Puede faltar o sobrar producto. Revisa el bulto y avisa al supervisor antes de confirmar."),
    (ROJO, "“Todavía no ha sido ruteado”", "El bulto se saltó la estación de Ruteadores. Mándalo primero allá."),
])
regla_oro(el, "El proceso de cerrado siempre quita un poco de material: una diferencia pequeña es NORMAL. La alerta roja es para diferencias fuera de lo común.")
el.append(PageBreak())

# ============ 4. EMBARQUE ============
encabezado(el, "EMBARQUE (AMÉRICA)", "Personal de América",
           "Validar folio por folio lo que sube al camión y generar el documento de salida del pedido.",
           "embarque")
pasos(el, [
    "Entra al sistema con tu usuario y contraseña.",
    "En el menú <b>“Pedido activo a embarcar”</b>, selecciona el pedido que se va a cargar al camión.",
    "El sistema muestra la lista completa de folios de ese pedido con su estatus.",
    "Al subir cada bulto al camión, <b>escanea su folio</b> y presiona <b>Enter</b>.",
    "Verifica que salga el <b>mensaje verde</b> y que el contador avance (ejemplo: “Escaneados: 5 / 20”).",
    "Si sale <b>mensaje rojo</b>, ese bulto NO debe subirse al camión. Bájalo y revisa el motivo del mensaje.",
    "Cuando el contador llegue al total, se activa el botón <b>“Generar documento de salida”</b>. Presiónalo.",
    "Descarga e imprime el PDF. Recoge las <b>tres firmas</b>: quien entrega, el transportista y quien recibe.",
])
mensajes(el, [
    (VERDE, "“Folio validado y embarcado”", "El bulto es de este pedido y ya pasó todo el proceso. Puede subir al camión."),
    (ROJO, "“NO pertenece al pedido”", "Ese bulto es de OTRO pedido. Bájalo del camión y colócalo aparte."),
    (ROJO, "“No ha completado procesos finales”", "Al bulto le falta la pesada final. Mándalo a Procesos Finales antes de embarcarlo."),
    (ROJO, "“Ya fue embarcado”", "Ese folio ya se escaneó antes. Puede ser un escaneo doble (normal si fue accidente) o un bulto duplicado: revisa."),
])
regla_oro(el, "Nada sube al camión sin escanearse, y nada rojo sube al camión. El documento de salida solo se genera cuando el pedido está COMPLETO.")
el.append(PageBreak())

# ============ 5. PROBLEMAS COMUNES ============
el.append(Paragraph("DEPORTIVOS QUINI", st_titulo))
el.append(Paragraph("Problemas comunes y qué hacer (todas las estaciones)", st_sub))
data = [
    [Paragraph("<b>Problema</b>", st_est), Paragraph("<b>Qué hacer</b>", st_est)],
    [Paragraph("La página no abre / “No se puede acceder a este sitio”", st_est),
     Paragraph("El servidor central está apagado o la PC servidor se reinició. Avisa al responsable del sistema para que ejecute <b>arrancar_servidor.bat</b> en la PC servidor.", st_est)],
    [Paragraph("“No se pudo conectar con la báscula”", st_est),
     Paragraph("En ESTA computadora debe estar abierta la ventana negra de la báscula. Ejecuta <b>arrancar_bascula_real.bat</b> (o avisa al responsable). Verifica también que el cable USB de la báscula esté conectado.", st_est)],
    [Paragraph("El escáner no escribe nada al disparar", st_est),
     Paragraph("Haz clic en el campo de folio de la pantalla y vuelve a escanear. Si sigue sin escribir, desconecta y reconecta el USB del escáner.", st_est)],
    [Paragraph("La etiqueta no se imprime", st_est),
     Paragraph("Revisa que la Zebra esté encendida, con rollo de etiquetas y ribbon, y sin foco rojo de ERROR. Si el sistema dice “Impresora no configurada”, avisa al responsable.", st_est)],
    [Paragraph("Me equivoqué de usuario", st_est),
     Paragraph("Da clic en <b>“Cerrar sesión”</b> (arriba a la derecha) y entra con el usuario correcto de tu estación.", st_est)],
    [Paragraph("Escaneé un folio equivocado", st_est),
     Paragraph("Si NO le diste “Guardar” o “Confirmar”, simplemente escanea el folio correcto. Si YA guardaste, avisa a tu supervisor; no intentes corregirlo tú.", st_est)],
    [Paragraph("El peso se ve raro (0 g, negativo o gigante)", st_est),
     Paragraph("Baja el bulto, verifica que la báscula marque cero sin nada encima, vuelve a subir el bulto y captura de nuevo. Si sigue mal, la báscula necesita calibración: avisa al supervisor.", st_est)],
]
t = Table(data, colWidths=[6.4 * cm, 10.8 * cm])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), AZUL),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, GRIS]),
]))
el.append(t)
el.append(Spacer(1, 0.5 * cm))
el.append(Paragraph(
    "Responsable del sistema: ______________________________ &nbsp;&nbsp; Teléfono/extensión: ______________",
    st_paso))

doc.build(el)
print("PDF generado:", SALIDA)
