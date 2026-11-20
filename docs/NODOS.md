# Sumarte como nodo

Un nodo es una persona que corre IA Lab Abierto en su propio PC, con sus propias claves, y comparte resultados.

## Qué compartes
- `nodos/<tu-alias>/*.json`: los resultados que genera `eficiencia/correr.mjs` (solo contadores, aprobadas y tiempos; nunca el texto de las respuestas).
- Casos sintéticos nuevos para el banco, con su comprobación.
- Propuestas de skills con su medición.

## Qué no compartes nunca
- Claves, tokens o sesiones (NVIDIA, Cloudflare, OpenAI/ChatGPT, GitHub).
- Peticiones hechas por otra persona con tu clave, ni tu clave para que otros la usen.
- Datos personales, clínicos, financieros o de trabajo.

## Cómo mandar tus resultados
1. `node eficiencia/correr.mjs --variante base` (y la variante que quieras probar).
2. Copia los JSON a `nodos/<tu-alias>/`.
3. `node scripts/escanear-secretos.mjs nodos/` debe decir "Sin hallazgos".
4. Abre un pull request.

## Cuándo se promueve una skill
Solo si gana con el criterio congelado (tokens totales, misma o mejor tasa de aprobadas) en al menos 3 nodos distintos.
