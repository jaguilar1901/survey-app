import hashlib
import os
import re

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine

load_dotenv()

DB_URI = os.environ["DATABASE_URL"]


def limpiar_nombre_columna(col, max_len=60):
    col_str = str(col).strip().lower()

    # Reemplazar espacios y guiones por guion bajo
    col_clean = re.sub(r"[\s\-]+", "_", col_str)

    # Eliminar caracteres especiales
    col_clean = re.sub(r"[^a-z0-9_]", "", col_clean)

    # Evitar que inicie con número
    if col_clean and col_clean[0].isdigit():
        col_clean = f"col_{col_clean}"

    if not col_clean:
        col_clean = "columna_vacia"

    # Si el nombre supera el límite de Postgres (63 caracteres),
    # truncamos y agregamos un hash único basado en la pregunta original
    if len(col_clean) > max_len:
        hash_suffix = hashlib.md5(col_str.encode("utf-8")).hexdigest()[:6]
        col_clean = f"{col_clean[: max_len - 7]}_{hash_suffix}"

    return col_clean


def procesar_y_subir(archivo, nombre_tabla, engine):
    print(f"\n--- Procesando '{archivo}' -> Tabla: '{nombre_tabla}' ---")

    if archivo.endswith(".csv"):
        df = pd.read_csv(archivo)
    else:
        df = pd.read_excel(archivo)

    # Limpiar encabezados
    df.columns = [limpiar_nombre_columna(c) for c in df.columns]

    # Control estricto de nombres duplicados
    columnas_unicas = []
    vistas = {}
    for c in df.columns:
        if c in vistas:
            vistas[c] += 1
            columnas_unicas.append(f"{c}_{vistas[c]}")
        else:
            vistas[c] = 0
            columnas_unicas.append(c)
    df.columns = columnas_unicas

    # Subir a Supabase
    df.to_sql(
        nombre_tabla,
        engine,
        if_exists="replace",
        index=False,
        chunksize=500,
    )
    print(f"¡Éxito! Se cargaron {len(df)} filas en la tabla '{nombre_tabla}'.")

    # if_exists="replace" dropea y recrea la tabla, lo que borra RLS y sus
    # políticas. Hay que reactivarlas después de cada carga.
    with engine.begin() as conn:
        conn.exec_driver_sql(f'ALTER TABLE public."{nombre_tabla}" ENABLE ROW LEVEL SECURITY;')
        conn.exec_driver_sql(
            f'CREATE POLICY "Public read access" ON public."{nombre_tabla}" '
            f"FOR SELECT TO anon, authenticated USING (true);"
        )
    print(f"RLS reactivado en '{nombre_tabla}'.")


def main():
    engine = create_engine(DB_URI)

    procesar_y_subir("UAM Services Survey - 2025.xlsx", "Survey_2025", engine)
    procesar_y_subir("UAM Services Survey - 2026.csv", "Survey_2026", engine)


if __name__ == "__main__":
    main()