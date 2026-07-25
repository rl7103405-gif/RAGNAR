"""Generacion del documento de salida (PDF) al completar un embarque."""
import os
import re
import uuid
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from app.models import Bulto

CARPETA_PDF = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "embarques_pdf")
os.makedirs(CARPETA_PDF, exist_ok=True)


def generar_pdf_embarque(pedido_id: str, bultos: list[Bulto], operador: str, maquila: str | None = None) -> str:
    """Genera el PDF del documento de salida y devuelve la ruta del archivo."""
    fecha = datetime.now()
    pedido_archivo = re.sub(r"[^A-Za-z0-9._-]+", "_", str(pedido_id)).strip("._")[:60] or "pedido"
    nombre_archivo = f"embarque_{pedido_archivo}_{fecha.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.pdf"
    ruta = os.path.join(CARPETA_PDF, nombre_archivo)

    styles = getSampleStyleSheet()
    titulo_style = ParagraphStyle("Titulo", parent=styles["Heading1"], alignment=1)
    subtitulo_style = ParagraphStyle("Subtitulo", parent=styles["Normal"], alignment=1, fontSize=11)

    doc = SimpleDocTemplate(ruta, pagesize=letter, topMargin=1.5 * cm, bottomMargin=1.5 * cm)
    elementos = []

    elementos.append(Paragraph("DEPORTIVOS QUINI", titulo_style))
    elementos.append(Paragraph("Documento de Salida / Embarque", subtitulo_style))
    elementos.append(Spacer(1, 0.3 * cm))
    elementos.append(Paragraph(f"Pedido: {escape(str(pedido_id))}", styles["Normal"]))
    if maquila:
        elementos.append(Paragraph(f"Maquila / Destino: {escape(str(maquila))}", styles["Normal"]))
    elementos.append(Paragraph(f"Fecha y hora: {fecha.strftime('%d/%m/%Y %H:%M:%S')}", styles["Normal"]))
    elementos.append(Paragraph(f"Generado por: {escape(str(operador))}", styles["Normal"]))
    elementos.append(Spacer(1, 0.5 * cm))

    encabezados = ["Folio", "Código", "Docenas", "Peso (kg)"]
    filas = [encabezados]
    total_docenas = 0.0
    total_peso = 0.0
    for b in bultos:
        peso = b.peso_procesos_finales or b.peso_produccion or 0
        docenas = b.docenas or 0
        total_docenas += docenas
        total_peso += peso
        filas.append([
            b.folio,
            b.codigo_producto or "-",
            f"{docenas:g}",
            f"{peso / 1000:,.2f}",
        ])

    tabla = Table(filas, colWidths=[4 * cm, 5 * cm, 3 * cm, 3.5 * cm])
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f2f2")]),
        ("ALIGN", (2, 0), (-1, -1), "CENTER"),
    ]))
    elementos.append(tabla)
    elementos.append(Spacer(1, 0.5 * cm))

    resumen = [
        ["Total de bultos", str(len(bultos))],
        ["Total de docenas", f"{total_docenas:g}"],
        ["Total de peso (kg)", f"{total_peso / 1000:,.2f}"],
    ]
    tabla_resumen = Table(resumen, colWidths=[8 * cm, 5 * cm])
    tabla_resumen.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
    ]))
    elementos.append(tabla_resumen)
    elementos.append(Spacer(1, 2 * cm))

    firmas = [["_" * 30, "_" * 30, "_" * 30], ["Entrega", "Transporte", "Recibe"]]
    tabla_firmas = Table(firmas, colWidths=[6 * cm, 6 * cm, 6 * cm])
    tabla_firmas.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
    ]))
    elementos.append(tabla_firmas)

    try:
        doc.build(elementos)
    except Exception:
        try:
            os.remove(ruta)
        except OSError:
            pass
        raise
    return ruta
