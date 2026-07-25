"""Modelos de la base de datos propia (SQLite para MVP)."""
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean
)

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

    # produccion / ruteado / validado / retenido / procesos_finales / embarcado
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

    # ---- Estacion de Validacion (contra Excel de ruteo + catalogo de pesos) ----
    # peso_validacion es la fuente de verdad del primer peso en el flujo nuevo;
    # peso_produccion se llena con el mismo valor por compatibilidad con
    # procesos finales, calibracion, embarque y reportes existentes.
    peso_validacion = Column(Float, nullable=True)
    peso_teorico = Column(Float, nullable=True)
    diferencia_validacion_porcentaje = Column(Float, nullable=True)
    multiplicador_aplicado = Column(Float, nullable=True)
    tolerancia_aplicada = Column(Float, nullable=True)
    timestamp_validacion = Column(DateTime, nullable=True)
    operador_validacion = Column(String, nullable=True)


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
    maquila = Column(String, nullable=True)


class Maquila(Base):
    """Destinos de maquila. Catalogo administrable desde la propia app."""
    __tablename__ = "maquilas"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, unique=True, nullable=False)
    activo = Column(Boolean, default=True)


class AuditoriaRecaptura(Base):
    """Registro de sobrescrituras confirmadas (re-capturas de peso, re-ruteos).

    No se borra nada: cada vez que un operador confirma sobrescribir datos ya
    capturados, aqui queda quien lo hizo, cuando y cuales eran los valores
    anteriores.
    """
    __tablename__ = "auditoria_recapturas"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, nullable=False, index=True)
    estacion = Column(String, nullable=False)  # procesos / ruteadores
    descripcion = Column(String, nullable=False)  # valores anteriores -> nuevos
    operador = Column(String, nullable=True)
    timestamp = Column(DateTime, nullable=True)


class FolioRuteo(Base):
    """Folios esperados, importados a diario desde el Excel 'Folios ruteo'.

    Es la fuente local de folios validos mientras no hay acceso SQL al ERP:
    la estacion de Validacion solo acepta folios presentes aqui, y Embarque
    los usa como universo esperado por pedido. Acumulativo entre dias
    (upsert por folio).
    """
    __tablename__ = "folios_ruteo"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, unique=True, nullable=False, index=True)
    codigo = Column(String, nullable=False, index=True)  # normalizado a mayusculas
    docenas = Column(Float, nullable=True)
    pares = Column(Float, nullable=True)
    total = Column(Float, nullable=True)  # unidades del bulto (columna Total del Excel)
    pedido_id = Column(String, nullable=True, index=True)
    nombre_guia = Column(String, nullable=True)
    fecha = Column(DateTime, nullable=True)
    fecha_actualizacion = Column(DateTime, nullable=True)  # para no revertir con un Excel viejo
    archivo_origen = Column(String, nullable=True)
    fecha_importacion = Column(DateTime, nullable=True)


class CatalogoPeso(Base):
    """Peso teorico unitario por codigo de producto (suma de materiales del BOM).

    Snapshot diario: cada importacion del Excel de codigos REEMPLAZA el
    catalogo completo (previa validacion total del archivo).
    """
    __tablename__ = "catalogo_pesos"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, unique=True, nullable=False, index=True)  # normalizado a mayusculas
    peso_unitario_gramos = Column(Float, nullable=False)
    num_materiales = Column(Integer, nullable=True)
    archivo_origen = Column(String, nullable=True)
    fecha_importacion = Column(DateTime, nullable=True)


class ConfigRangoPeso(Base):
    __tablename__ = "config_rango_peso"

    id = Column(Integer, primary_key=True, index=True)
    bultos_muestra = Column(Integer, default=0)
    promedio_diferencia = Column(Float, nullable=True)
    max_diferencia = Column(Float, nullable=True)
    tolerancia_porcentaje = Column(Float, nullable=True)
    fecha_calculo = Column(DateTime, nullable=True)
    activo = Column(Boolean, default=False)
