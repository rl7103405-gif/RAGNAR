"""Validaciones compartidas para datos capturados por los operadores."""
import math
import re
import unicodedata

from fastapi import HTTPException


PATRON_FOLIO = re.compile(r"^[A-Za-z0-9._-]+$")
# Los pedidos reales del ERP traen espacios, diagonales y acentos
# (ej. "7880_CALCETA DEPORTIVA SPARTAN_TALLA S/M_JULIO"): se acepta cualquier
# texto imprimible sin caracteres de control.
PATRON_PEDIDO = re.compile(r"^[^\x00-\x1F\x7F]+$")
# Categorías Unicode que el patrón de arriba no cubre pero que tampoco deben
# aparecer en un pedido: controles C1, formato invisible (zero-width, RTL
# override) y separadores de línea/párrafo. El espacio normal es Zs y sigue
# permitido.
_CATEGORIAS_PEDIDO_PROHIBIDAS = ("Cc", "Cf", "Zl", "Zp")


def pedido_es_valido(texto: str) -> bool:
    """True si `texto` es un pedido aceptable: sin controles ASCII/Unicode
    invisibles ni de dirección de texto, y dentro del tope de longitud."""
    if not texto or len(texto) > 100:
        return False
    if not PATRON_PEDIDO.fullmatch(texto):
        return False
    return not any(unicodedata.category(c) in _CATEGORIAS_PEDIDO_PROHIBIDAS for c in texto)


def normalizar_folio(valor: str) -> str:
    folio = str(valor).strip()
    if not folio:
        raise HTTPException(status_code=400, detail="Folio vacío")
    if len(folio) > 50 or not PATRON_FOLIO.fullmatch(folio):
        raise HTTPException(
            status_code=400,
            detail="Folio inválido: usa sólo letras, números, punto, guion o guion bajo (máximo 50 caracteres)",
        )
    return folio


def canonizar_folio(valor) -> str:
    """Forma canónica de un folio para comparar/almacenar sin ambigüedad.

    El Excel de ruteo trae folios como enteros (442745) y el escáner puede
    mandar '442745' o '0442745': los folios numéricos se canonizan sin ceros
    a la izquierda; los alfanuméricos solo se recortan de espacios.
    """
    folio = str(valor).strip()
    return str(int(folio)) if folio.isdigit() else folio


def normalizar_pedido(valor: str | None) -> str:
    pedido = (valor or "").strip()
    if not pedido:
        raise HTTPException(status_code=400, detail="Pedido vacío")
    if not pedido_es_valido(pedido):
        raise HTTPException(
            status_code=400,
            detail="Pedido inválido: no puede contener caracteres de control y su máximo es de 100 caracteres",
        )
    return pedido


def normalizar_texto(
    valor: str | None,
    campo: str,
    *,
    maximo: int,
    requerido: bool = False,
) -> str | None:
    texto = (valor or "").strip()
    if not texto:
        if requerido:
            raise HTTPException(status_code=400, detail=f"{campo} vacío")
        return None
    if len(texto) > maximo:
        raise HTTPException(status_code=400, detail=f"{campo} excede el máximo de {maximo} caracteres")
    if any(ord(caracter) < 32 or ord(caracter) == 127 for caracter in texto):
        raise HTTPException(status_code=400, detail=f"{campo} contiene caracteres de control inválidos")
    return texto


def validar_peso(peso: float, peso_maximo: float) -> float:
    if not math.isfinite(peso) or peso <= 0:
        raise HTTPException(status_code=400, detail="Peso inválido")
    if peso > peso_maximo:
        raise HTTPException(
            status_code=400,
            detail=f"Peso de {peso / 1000:.2f} kg fuera de rango (máximo {peso_maximo / 1000:.0f} kg). Revisa la báscula.",
        )
    return peso


def validar_docenas(docenas: float | None) -> float | None:
    if docenas is None:
        return None
    if not math.isfinite(docenas) or docenas <= 0:
        raise HTTPException(status_code=400, detail="Docenas inválidas")
    return docenas
