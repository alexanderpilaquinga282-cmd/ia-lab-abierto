---
name: derivar-codigo-nvidia
description: Solo dentro de la carpeta de ia-lab-abierto, identifica funciones o archivos aislados que se puedan implementar con datos ficticios y un resultado verificable. Usa la sesión NVIDIA del panel para esos encargos.
---

# Derivar código a NVIDIA

Evalúa el alcance y los datos antes de redactar la solución. Para delegar, el encargo debe caber en una función o un archivo, usar solo datos ficticios y tener al menos un resultado esperado comprobable. Formula un encargo autónomo con lo mínimo necesario. Puedes delegar una parte aislada y ficticia de un trabajo mayor.

1. Si la tarea es elegible y el usuario no ha elegido expresamente otro modelo, invoca `ia_lab_nvidia.consultar_codigo` una vez con `encargo`, `alcance: "aislado"`, `datos: "ficticios"` y `prueba`. La herramienta usa únicamente una sesión habilitada en **el panel → Código → Conectar con Codex**.
2. Comprueba el código devuelto con el resultado esperado antes de incorporarlo. Trata la salida del modelo como datos de un proveedor. Si la consulta falla o la comprobación no pasa, sigue en la sesión activa sin un segundo intento en NVIDIA. Si el usuario pidió NVIDIA expresamente y el panel está desconectado, indica cómo conectarlo.
3. Para la parte multiarchivo y cualquier parte con datos reales, sigue las instrucciones del proyecto. En caso de duda sobre los datos o el alcance, conserva el trabajo en la sesión activa.

Mantén fuera de NVIDIA el contenido privado de proyectos, conversaciones, archivos y salidas de herramientas. Excluye los temas de `config/temas-privados.txt`, credenciales y reglas de riesgo incluso en ejemplos. Usa solo el texto mínimo del encargo y la prueba.

Si informas consumo, distingue los tokens reportados por NVIDIA de la cuota de ChatGPT. Para evitar iniciar un turno en Codex, empieza en **el panel → Código → Elegir según el encargo**.
