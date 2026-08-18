# -*- coding: utf-8 -*-
"""
validacion_entradas.py — Valida que los folios generados en SCQ hayan ingresado
a Procesos Iniciales en Microsip (Entrada por Producción) con la cantidad correcta.
Proyecto RAGNAR · Deportivos Quini · 1 docena = 24 piezas

ARCHIVOS DE ENTRADA (CONFIG):
  1. FOLIOS_GENERADOS.xlsx  (Folio, Fecha, Código, Docenas, Pares, Total, ..., Descripción)
  2. COMPULSA_LOTES.xlsx    (kardex 'Lotes con actividad' de Microsip)
  3. BASE_REMISIONES.xlsx   (opcional: cruza los faltantes contra remisiones)

SALIDA: Validacion_Entrada_ProcesosIniciales.xlsx
USO:    python validacion_entradas.py
"""
import pandas as pd
import openpyxl
from quini_lib import (PZAS_POR_DOCENA, cargar_kardex_lotes, agregar_kardex_por_lote,
                       cargar_remisiones, agrupar_remisiones,
                       escribir_encabezado, escribir_fila)

# ============ CONFIG ============
ARCHIVO_FOLIOS     = "FOLIOS_GENERADOS.xlsx"
ARCHIVO_MICROSIP   = "COMPULSA_LOTES.xlsx"
ARCHIVO_REMISIONES = "BASE_REMISIONES.xlsx"   # None si no aplica
ARCHIVO_SALIDA     = "Validacion_Entrada_ProcesosIniciales.xlsx"
TOLERANCIA_DOC     = 0.04                      # < 1 pieza
# ================================

print("Cargando folios generados...")
df_fg = pd.read_excel(ARCHIVO_FOLIOS, engine='calamine', header=0)
df_fg.columns = ['FOLIO','Fecha','Codigo','Docenas','Pares','Total',
                 'FechaCaptura','FechaActualizacion','Descripcion'][:len(df_fg.columns)]
df_fg['FOLIO'] = pd.to_numeric(df_fg['FOLIO'], errors='coerce')
df_fg = df_fg.dropna(subset=['FOLIO'])
df_fg['FOLIO'] = df_fg['FOLIO'].astype(int)
df_fg['Doc_SCQ'] = pd.to_numeric(df_fg['Total'], errors='coerce').fillna(0)
df_fg['Pzas_SCQ'] = df_fg['Doc_SCQ'] * PZAS_POR_DOCENA

print("Cargando kardex Microsip...")
dfk = cargar_kardex_lotes(ARCHIVO_MICROSIP)
df_micro = agregar_kardex_por_lote(dfk)

m = df_fg.merge(df_micro[['FOLIO','Pzas_EP','Doc_EP','Doc_Exist_Final']], on='FOLIO', how='left')
for c in ['Pzas_EP','Doc_EP','Doc_Exist_Final']:
    m[c] = pd.to_numeric(m[c], errors='coerce').fillna(0)
m['En_Microsip'] = m['Pzas_EP'] > 0
m['Dif_Doc'] = m['Doc_SCQ'] - m['Doc_EP']

def sem(r):
    if not r['En_Microsip']: return ('NO ingresó a Microsip','rojo')
    if abs(r['Dif_Doc']) <= TOLERANCIA_DOC: return ('OK: Cantidad correcta','verde')
    if r['Dif_Doc'] > 0: return ('Microsip registró MENOS que SCQ','amarillo')
    return ('Microsip registró MÁS que SCQ','naranja')

m[['Semaforo','ColorSem']] = m.apply(lambda r: pd.Series(sem(r)), axis=1)
print(m['Semaforo'].value_counts().to_string())
print(f"Doc SCQ: {m['Doc_SCQ'].sum():,.2f} | Doc Micro EP: {m['Doc_EP'].sum():,.2f} | Dif: {m['Dif_Doc'].sum():,.2f}")

# Cruce de faltantes contra remisiones
df_cruce = None
if ARCHIVO_REMISIONES:
    try:
        df_rem = cargar_remisiones(ARCHIVO_REMISIONES)
        agg = agrupar_remisiones(df_rem)
        faltantes = m[~m['En_Microsip']].merge(agg, on='FOLIO', how='left')
        faltantes['En_Remision'] = faltantes['Remisiones'].notna()
        df_cruce = faltantes
        graves = faltantes[faltantes['En_Remision']]
        print(f"\nFaltantes en Microsip: {len(faltantes)} | GRAVES (ya enviados a maquilero): {len(graves)} "
              f"({graves['Doc_SCQ'].sum():,.0f} doc)")
    except Exception as e:
        print(f"(Sin cruce de remisiones: {e})")

# ---------- Excel ----------
wb = openpyxl.Workbook()
ws1 = wb.active; ws1.title = "Detalle"
H = ['FOLIO','FECHA','CODIGO','DESCRIPCION','DOC SCQ','PZAS SCQ','DOC EP MICRO','PZAS EP MICRO',
     'DIF DOC','EXIST MICRO (doc)','SEMAFORO']
W = [10,14,12,30,10,12,12,14,10,14,36]
escribir_encabezado(ws1, H, W)
m_o = m.sort_values(['ColorSem','Codigo','FOLIO'])
for i,row in enumerate(m_o.itertuples(),2):
    escribir_fila(ws1, i, [row.FOLIO, str(row.Fecha), row.Codigo,
        str(row.Descripcion) if pd.notna(row.Descripcion) else '',
        round(row.Doc_SCQ,4), int(row.Pzas_SCQ), round(row.Doc_EP,4), int(row.Pzas_EP),
        round(row.Dif_Doc,4), round(row.Doc_Exist_Final,2), row.Semaforo], row.ColorSem)
ws1.auto_filter.ref = f"A1:K{len(m_o)+1}"

if df_cruce is not None and len(df_cruce):
    ws2 = wb.create_sheet("Faltantes_vs_Remisiones")
    H2 = ['FOLIO','FECHA','CODIGO','DOC SCQ','EN REMISION','REMISION(ES)','MAQUILERO','DOC REM','ACCION']
    W2 = [10,14,12,10,12,18,12,10,42]
    escribir_encabezado(ws2, H2, W2)
    for i,row in enumerate(df_cruce.sort_values(['En_Remision','FOLIO'],ascending=[False,True]).itertuples(),2):
        color = 'rojo' if row.En_Remision else 'naranja'
        accion = 'Capturar Entrada por Producción retroactiva' if row.En_Remision else 'Verificar WIP o capturar'
        escribir_fila(ws2, i, [row.FOLIO, str(row.Fecha), row.Codigo, round(row.Doc_SCQ,2),
            'SÍ' if row.En_Remision else 'NO', row.Remisiones if pd.notna(row.Remisiones) else '',
            row.Maquilero if pd.notna(row.Maquilero) else '',
            round(row.Doc_REM,2) if pd.notna(row.Doc_REM) else '', accion], color)

wb.save(ARCHIVO_SALIDA)
print(f"\nGuardado: {ARCHIVO_SALIDA}")
