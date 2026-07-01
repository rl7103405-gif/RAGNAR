"""Modelos de la base de datos propia (SQLite para MVP)."""
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean, ForeignKey
)
from sqlalchemy.orm import relationship

from app.database import Base


class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nombre_usuario = Column(String, unique=True, nullable=False, index=True)
    nombre_completo = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    estacion = Column(String, nullable=True)  # produccion / ruteadores / procesos / embarque / admin
    activo = Column(Boolean, default=True)


class Bulto(Base):
    __tablename__ = "bultos"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, unique=True, nullable=False, index=True)

    peso_produccion = Column(Float, nullable=True)
    peso_procesos_finales = Column(Float, nullable=True)

    timestamp_produccion = Column(DateTime, nullable=True)
    timestamp_ruteo = Column(DateTime, nullable=True)
    timestamp_procesos_finales = Column(DateTime, nullable=True)
    timestamp_embarque = Column(DateTime, nullable=True)

    operador_produccion = Column(String, nullable=True)
    operador_ruteo = Column(String, nullable=True)
    operador_procesos_finales = Column(String, nullable=True)
    operador_embarque = Column(String, nullable=True)

    # produccion / ruteado / procesos_finales / embarcado
    estatus = Column(String, nullable=False, default="produccion")

    # Referencia al SQL de Atalanta - solo guardamos el ID / datos de consulta cacheados
    pedido_id = Column(String, nullable=True, index=True)
    cliente = Column(String, nullable=True)
    codigo_producto = Column(String, nullable=True)
    docenas = Column(Float, nullable=True)
    fecha_entrega = Column(String, nullable=True)

    diferencia_gramos = Column(Float, nullable=True)
    diferencia_porcentaje = Column(Float, nullable=True)
    diferencia_alerta = Column(Boolean, nullable=True)  # True = fuera de rango (rojo)
    confirmacion_manual = Column(Boolean, default=False)

    etiqueta_impresa = Column(Boolean, default=False)


class Embarque(Base):
    __tablename__ = "embarques"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(String, nullable=False, index=True)
    fecha_embarque = Column(DateTime, nullable=True)
    total_bultos = Column(Integer, default=0)
    total_docenas = Column(Float, default=0)
    total_peso = Column(Float, default=0)
    documento_generado = Column(Boolean, default=False)
    ruta_documento = Column(String, nullable=True)
    operador = Column(String, nullable=True)


class ConfigRangoPeso(Base):
    __tablename__ = "config_rango_peso"

    id = Column(Integer, primary_key=True, index=True)
    bultos_muestra = Column(Integer, default=0)
    promedio_diferencia = Column(Float, nullable=True)
    max_diferencia = Column(Float, nullable=True)
    tolerancia_porcentaje = Column(Float, nullable=True)
    fecha_calculo = Column(DateTime, nullable=True)
    activo = Column(Boolean, default=False)
