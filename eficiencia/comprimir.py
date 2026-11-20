"""Comprime mensajes con Headroom dentro del proceso, sin proxy ni red.

Lee de stdin {"messages": [...]} y escribe en stdout
{"messages": [...], "tokens_before": n, "tokens_after": n}.

correr.mjs lo lanza con HEADROOM_OFFLINE=1 y SIN la clave de NVIDIA en el
entorno: Headroom nunca ve la clave ni habla con ningún servidor.
"""
import json
import os
import sys

if os.environ.get("HEADROOM_OFFLINE") != "1" or "NVIDIA_API_KEY" in os.environ:
    sys.exit("Se esperaba HEADROOM_OFFLINE=1 y ninguna clave de NVIDIA en el entorno.")

from headroom import compress  # noqa: E402

entrada = json.load(sys.stdin)
r = compress(entrada["messages"], model="gpt-4o")
json.dump(
    {"messages": r.messages, "tokens_before": r.tokens_before, "tokens_after": r.tokens_after},
    sys.stdout,
    ensure_ascii=False,
)
