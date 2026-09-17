import re
import pandas as pd

# Coloca esto justo ARRIBA de def es_comentario_accionable(texto):
NOISY_PATTERNS = re.compile(
    r'^\s*('
    r'[\.\,\-\_\s\*\/\#\+]+|'
    r'n/?a|na|no\s+aplica|no\s+aplicable|none|null|'
    r'no|nada|ninguno|ninguna|sin\s+comentarios|no\s+comment(s)?|'
    r'todo\s+bien|todo\s+excelente|excelente|all\s+good|all\s+great|all\s+ok|'
    r'everything\s+is?\s+(good|fine|ok|great)|so\s+far\s+so\s+good|'
    r'so\s+far\,?\s+i\s+have\s+generally\s+had\s+a\s+good\s+experience.*|'
    r'i(\')?m\s+okay|i(\')?m\s+good|'
    r'nothing|nothing\s+else|nothing\s+to\s+add|not?\s+at\s+the\s+moment|'
    r'no\s+ideas(\s+to\s+give)?|no\s+ideas\s+at\s+the\s+moment|'
    r'no\s+recommendations(\s+at\s+this\s+moment)?|'
    r'no\s+tengo\s+(sugerencias?|comentarios?|ideas?|quejas?|observaciones?)(s)?(\s+al\s+respecto)?|'
    r'no\s+(ideas?|recommendations?|suggestions?|complaints?|issues?)|'
    r'i\s+have\s+no\s+(ideas?|suggestions?|complaints?|comments?)|'
    r'i\s+don(\')?t\s+have\s+(any\s+)?(ideas?|suggestions?|complaints?|comments?)|'
    r'no\,\s+i\s+do\s+not|'
    r'i\s+haven(\')?t\s+used\s+it.*|no\s+(uso|utilizo|visito).+|(haven\'?t|don\'?t)\s+use.+|'
    r'i\s+don(\')?t\s+know|idk|i(\')?m\s+not\s+sure|neutral|enough|it(\')?s?\s+enough'
    r')\s*[\.\!\?]*$',
    re.IGNORECASE
)


def es_comentario_accionable(texto):
    if not isinstance(texto, str) or not texto.strip():
        return False
        
    clean_text = texto.strip()

    # 1. Descartar si coincide con el patrón Regex de ruido
    if NOISY_PATTERNS.match(clean_text):
        return False

    # 2. Descartar textos de 1-2 palabras genéricas
    words = [w for w in re.findall(r'\b\w+\b', clean_text) if len(w) > 1]
    if len(words) < 2 and clean_text.lower() not in ["orden", "airflow"]:
        return False

    return True


# Aplicación al DataFrame de pandas
def filtrar_dataset(df, columna_comentarios='comments'):
    mask = df[columna_comentarios].apply(es_comentario_accionable)
    return df[mask].copy()