"""Compresor Headroom para el panel: una línea JSON por pedido por stdin/stdout.

No abre puertos ni recibe la clave de NVIDIA (servidor.mjs la quita del entorno).
"""
import json
import os
import sys

if os.environ.get("HEADROOM_OFFLINE") != "1" or "NVIDIA_API_KEY" in os.environ:
    sys.exit("Se esperaba HEADROOM_OFFLINE=1 y ninguna clave de NVIDIA en el entorno.")

from headroom import compress  # noqa: E402

for linea in sys.stdin:
    try:
        r = compress(json.loads(linea)["messages"], model="gpt-4o", compress_user_messages=True)
        salida = {"messages": r.messages, "antes": r.tokens_before, "despues": r.tokens_after}
    except Exception as e:  # el panel sigue sin comprimir
        salida = {"error": type(e).__name__}
    sys.stdout.write(json.dumps(salida, ensure_ascii=False) + "\n")
    sys.stdout.flush()
