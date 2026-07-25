"""
Logica de calibracion del rango de peso aceptable entre produccion y procesos finales.

El proceso de cerrado siempre quita material, asi que SIEMPRE habra una diferencia
de peso entre las dos estaciones. Eso es normal. Lo que este modulo hace es:

1. Fase de aprendizaje (primeros N bultos, configurable via BULTOS_CALIBRACION):
   solo se registra la diferencia, sin alertar.
2. Al completar el bulto N, se calcula automaticamente un rango aceptable
   (promedio +/- tolerancia) a partir de las muestras de calibracion.
3. A partir del bulto N+1: se compara cada nueva diferencia contra ese rango.
   - Verde: dentro del rango aceptable.
   - Rojo: fuera del rango -> se muestra alerta pero se permite continuar
     con confirmacion manual del operador.
"""
import statistics
import math
from datetime import datetime

from sqlalchemy.orm import Session

from app.config import settings
from app.database import flush_seguro
from app.models import Bulto, ConfigRangoPeso


def calcular_diferencia(peso_produccion: float, peso_procesos_finales: float) -> tuple[float, float]:
    if not math.isfinite(peso_produccion) or peso_produccion <= 0:
        raise ValueError("El peso de producción debe ser un número finito mayor que cero")
    if not math.isfinite(peso_procesos_finales) or peso_procesos_finales <= 0:
        raise ValueError("El peso de procesos finales debe ser un número finito mayor que cero")
    diferencia_gramos = round(peso_produccion - peso_procesos_finales, 2)
    diferencia_porcentaje = round((diferencia_gramos / peso_produccion) * 100, 3)
    return diferencia_gramos, diferencia_porcentaje


def obtener_config_activa(db: Session) -> ConfigRangoPeso | None:
    return db.query(ConfigRangoPeso).filter(ConfigRangoPeso.activo == True).first()  # noqa: E712


def _bultos_calibracion_previos(db: Session) -> list[Bulto]:
    """Bultos que ya pasaron por procesos finales, en orden cronologico (muestras de calibracion)."""
    return (
        db.query(Bulto)
        .filter(Bulto.diferencia_porcentaje.isnot(None))
        .order_by(Bulto.timestamp_procesos_finales.asc())
        .all()
    )


def evaluar_peso_final(db: Session, bulto: Bulto) -> dict:
    """
    Calcula la diferencia del bulto actual y determina si esta en fase de
    calibracion o si ya debe evaluarse contra un rango. Actualiza el bulto
    y, si corresponde, crea/activa la configuracion de rango.

    Devuelve un dict con: fase ("calibracion" | "evaluacion"),
    diferencia_gramos, diferencia_porcentaje, alerta (True/False/None),
    bultos_muestra_actual.
    """
    diferencia_gramos, diferencia_porcentaje = calcular_diferencia(
        bulto.peso_produccion, bulto.peso_procesos_finales
    )
    bulto.diferencia_gramos = diferencia_gramos

    config_activa = obtener_config_activa(db)

    if config_activa:
        bulto.diferencia_porcentaje = diferencia_porcentaje
        limite_inferior = config_activa.promedio_diferencia - config_activa.tolerancia_porcentaje
        limite_superior = config_activa.promedio_diferencia + config_activa.tolerancia_porcentaje
        fuera_de_rango = not (limite_inferior <= diferencia_porcentaje <= limite_superior)
        bulto.diferencia_alerta = fuera_de_rango
        return {
            "fase": "evaluacion",
            "diferencia_gramos": diferencia_gramos,
            "diferencia_porcentaje": diferencia_porcentaje,
            "alerta": fuera_de_rango,
            "rango_min": round(limite_inferior, 3),
            "rango_max": round(limite_superior, 3),
        }

    # Todavia no hay configuracion activa: estamos en fase de calibracion.
    bulto.diferencia_porcentaje = diferencia_porcentaje
    bulto.diferencia_alerta = None

    # El bulto actual cuenta como muestra: su diferencia aun no esta en la BD
    # (autoflush=False), asi que se agrega explicitamente. En una re-captura la
    # consulta si lo devuelve (identity map), de ahi la verificacion.
    muestras = _bultos_calibracion_previos(db)
    if bulto not in muestras:
        muestras = muestras + [bulto]
    total_muestras = len(muestras)

    if total_muestras >= settings.BULTOS_CALIBRACION:
        _calcular_y_activar_rango(db, muestras[: settings.BULTOS_CALIBRACION])
        return {
            "fase": "calibracion_completa",
            "diferencia_gramos": diferencia_gramos,
            "diferencia_porcentaje": diferencia_porcentaje,
            "alerta": None,
            "bultos_muestra_actual": total_muestras,
        }

    return {
        "fase": "calibracion",
        "diferencia_gramos": diferencia_gramos,
        "diferencia_porcentaje": diferencia_porcentaje,
        "alerta": None,
        "bultos_muestra_actual": total_muestras,
        "bultos_faltantes": settings.BULTOS_CALIBRACION - total_muestras,
    }


def _calcular_y_activar_rango(db: Session, muestras: list[Bulto]) -> ConfigRangoPeso:
    diferencias = [b.diferencia_porcentaje for b in muestras if b.diferencia_porcentaje is not None]
    promedio = statistics.mean(diferencias)
    desviacion = statistics.pstdev(diferencias) if len(diferencias) > 1 else 0.0
    max_diferencia = max(abs(d - promedio) for d in diferencias) if diferencias else 0.0

    # Tolerancia = la mayor entre 2 desviaciones estandar y la desviacion maxima observada,
    # para no generar falsas alarmas con la propia muestra de calibracion.
    tolerancia = max(desviacion * 2, max_diferencia)

    # Desactivar configuraciones previas (si las hubiera) antes de activar la nueva.
    db.query(ConfigRangoPeso).update({ConfigRangoPeso.activo: False})

    config = ConfigRangoPeso(
        bultos_muestra=len(diferencias),
        promedio_diferencia=round(promedio, 3),
        max_diferencia=round(max_diferencia, 3),
        tolerancia_porcentaje=round(tolerancia, 3),
        fecha_calculo=datetime.now(),
        activo=True,
    )
    db.add(config)
    flush_seguro(db)
    return config
