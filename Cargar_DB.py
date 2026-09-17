import json
import os
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# Credenciales de tu proyecto de Supabase (definidas en .env, nunca en el código)
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SECRET_KEY"]

# Ruta del archivo JSON en tu proyecto
ruta_archivo = 'consolidated_survey_full.json'

# 1. Cargar el archivo JSON
try:
    with open(ruta_archivo, 'r', encoding='utf-8') as f:
        datos = json.load(f)
    print("¡Archivo JSON cargado exitosamente!")
except FileNotFoundError:
    print(f"Error: No se encontró el archivo en la ruta: {ruta_archivo}")
    exit()

# 2. Inicializar el cliente de Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

if isinstance(datos, dict):
    registros = [datos]
else:
    registros = datos

print(f"Obteniendo esquema de la tabla 'uam_services_survey'...")

# Obtener dinámicamente las columnas válidas consultando un registro vacío o la estructura
try:
    # Hacemos una consulta limit 0 para ver qué columnas reconoce la API
    res = supabase.table('uam_services_survey').select("*").limit(1).execute()
    if res.data:
        columnas_validas = set(res.data[0].keys())
    else:
        # Si la tabla está totalmente vacía, consultamos la definición mediante una inserción de prueba o definimos una lista de respaldo
        columnas_validas = set()
    print(f"Columnas válidas detectadas en Supabase: {len(columnas_validas)}")
except Exception as e:
    print(f"No se pudo consultar el esquema automáticamente: {e}")
    columnas_validas = set()

# Si logramos obtener las columnas válidas, filtramos los registros automáticamente
if columnas_validas:
    print("Filtrando registros para enviar solo columnas coincidentes...")
    registros_limpios = []
    for reg in registros:
        # Solo conservamos las llaves que existan en Supabase
        reg_filtrado = {k: v for k, v in reg.items() if k in columnas_validas}
        registros_limpios.append(reg_filtrado)
    registros = registros_limpios
else:
    # Respaldo manual si la tabla está vacía y no devuelve llaves
    columnas_a_remover = [
        'have_you_been_part_of_any_recognition_initiative_in_the__d01a3e',
        'have_you_participated_in_any_engagement_fun_activities_i_4ae7d4',
        'have_you_participated_in_any_incaf_courses_within_the_la_69367f',
        'ac',
        'customer_service_provided_by_l_d'
    ]
    for reg in registros:
        if isinstance(reg, dict):
            for col in columnas_a_remover:
                reg.pop(col, None)

print(f"Iniciando carga de {len(registros)} registros a la tabla 'uam_services_survey'...")

# 3. Insertar por lotes
tamano_lote = 50
for i in range(0, len(registros), tamano_lote):
    lote = registros[i:i + tamano_lote]
    try:
        response = supabase.table('uam_services_survey').insert(lote).execute()
        print(f"Lote {i // tamano_lote + 1} cargado exitosamente.")
    except Exception as e:
        print(f"Error en el lote que inicia en la fila {i + 1}: {e}")
        break

print("¡Proceso de carga finalizado!")