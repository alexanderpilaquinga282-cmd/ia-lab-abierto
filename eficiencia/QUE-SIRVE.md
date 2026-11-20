---
tipo: conclusiones
fecha: 2026-11-19
fuente: PROTOCOLO.md (corridas del 18 y 19/11 con Nemotron)
---
# Eficiencia: qué sirve y qué no

Todo medido con datos sintéticos, 3 repeticiones, criterios congelados antes de correr.

## Sirve (se queda)

| Pieza | Qué aporta | Evidencia |
|---|---|---|
| **Headroom en el panel** | Comprime entradas largas (logs, JSON) antes de mandarlas a NVIDIA | Banco: entrada −84 % (25.894 → 4.107) con la misma calidad. Panel en vivo: 20.033 → 649 tokens (−97 %) |
| **Banco** (`correr.mjs`, `resumir.mjs`, `banco/`, `casos-largos.mjs`, pruebas) | Es la única forma de saber si algo ahorra de verdad. Sirve para comparar con Codex u otro modelo | 108 respuestas verificadas, 0 claves en resultados |
| **Regla: medir tokens totales** | Evita "ahorros" falsos | Ponytail bajaba la salida 19 % pero subía el total ×3,3 |

## No sirve (descartado)

| Pieza | Por qué | Qué se hace |
|---|---|---|
| **Ponytail** como prompt de sistema | Completo: rompe el formato (4/18). Sin cierre: cuesta 3,3 veces más tokens totales | Queda solo como registro en `resultados/` |
| **Bucle de skills en tareas largas** | 3 candidatas empataron 6/9 con 101 % de tokens; sin skill 0/9 en la reserva de contar | Solo como medición. Contar con código |
| **Bucle de skills en tareas cortas** | En encargos cortos el modelo ya responde solo con código; una skill solo suma entrada. 3 candidatas: 0/18, 11/18 y 12/18, todas más caras (117 % a 150 %) | Pausado. Ver abajo |

## Límites conocidos de lo que sí sirve

- Headroom **pierde líneas** en logs (conservó 4 de 5 WARN): sirve para encontrar lo raro, no para contar. No usarlo donde importa un número exacto.
- Nemotron cuenta mal en listas largas con o sin Headroom (pedidos: 27 a 38 de 65 reales). Eso no lo arregla comprimir.

## Lo que sigue y sí puede aportar

1. **El mismo banco con Codex.** Lo que gana con Nemotron no necesariamente gana con Codex.
2. **Para contar o sumar: código antes del modelo.** Si la tarea es contar devueltos o sumar montos, que lo calcule un script y el modelo solo redacte. Es más barato y exacto que cualquier skill o compresión.
