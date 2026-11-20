---
tipo: protocolo
estado: listo para correr
fecha: 2026-11-18
---
# Eficiencia: Nemotron + skills de GitHub

## Qué mide

Si Ponytail (prompt de sistema) y Headroom (compresión de salidas de herramienta) bajan los tokens de Nemotron 3 Ultra **sin bajar la calidad**. Un cambio = una corrida = una medición.

## Baterías (todo sintético)

| Batería | Casos | Qué prueba |
|---|---|---|
| `codigo` | Los 6 encargos de `ia Lab PC/evaluacion-codigo` (copiados en `banco/`) | Calidad y tokens de salida con prompt corto |
| `largos` | 3 casos nuevos en `casos-largos.mjs`: log de 1.200 líneas con un ERROR, 300 pedidos en JSON, reporte de 400 pruebas con 2 fallidas | Tokens de entrada cuando el modelo recibe salidas de herramienta largas |

Los datos largos se generan con semilla fija: siempre son los mismos y la respuesta correcta se calcula sola. Ninguno toca datos reales, cuentas ni claves.

## Variantes

| Variante | Qué cambia |
|---|---|
| `base` | Nada. Mismos parámetros que el panel: razonamiento apagado, temperatura 0,1 |
| `ponytail` | `ponytail-SKILL.md` completo como prompt de sistema |
| `ponytail-sin-cierre` | Igual, sin la frase "End your reply with one or two lines…" |
| `headroom` | Los mensajes pasan por `compress()` de Headroom en tu PC antes de ir a NVIDIA |

**Por qué hay dos Ponytail:** Ponytail pide cerrar cada respuesta con una o dos líneas de comentario. El banco exige "solo la declaración de la función" y el verificador rechaza cualquier prosa. Predicción registrada antes de correr: `ponytail` completo va a fallar por formato y `ponytail-sin-cierre` es la prueba justa.

**Por qué Headroom va sin proxy:** `comprimir.py` llama a `compress()` dentro del proceso, con `HEADROOM_OFFLINE=1`, y `correr.mjs` le quita `NVIDIA_API_KEY` del entorno antes de lanzarlo. Headroom nunca ve la clave ni abre conexiones; la consulta a NVIDIA la hace `correr.mjs`, que solo acepta `integrate.api.nvidia.com`. Así se elimina el riesgo de que `headroom wrap` mande la clave a OpenAI.

## Criterios congelados (18/11/2026, antes de correr)

Se compara la última corrida de cada variante con la última `base`, 3 repeticiones por caso.

| Variante | Calidad | Ahorro exigido |
|---|---|---|
| `ponytail` y `ponytail-sin-cierre` | Tasa de aprobadas en `codigo` ≥ base | Tokens de salida promedio ≤ 90 % de la base |
| `headroom` | Tasa de aprobadas en `largos` ≥ base | Tokens de entrada promedio ≤ 80 % de la base |

Si falla cualquiera de las dos columnas, se descarta. `resumir.mjs` aplica esto solo; no se ajustan los umbrales después de ver los números.

## Cómo correrlo (PowerShell, desde esta carpeta)

```powershell
$env:NVIDIA_API_KEY = "nvapi-..."      # solo en esta terminal; no se guarda en disco
node .\correr.mjs --variante base
node .\correr.mjs --variante ponytail-sin-cierre
node .\correr.mjs --variante ponytail --bateria codigo
# Headroom: requiere instalarlo antes (ver abajo)
node .\correr.mjs --variante headroom --bateria largos
node .\resumir.mjs
Remove-Item Env:NVIDIA_API_KEY
```

Unas 90 consultas en total, con 1,5 s de pausa entre ellas. Sin reintentos: un error HTTP o un tiempo agotado queda anotado como fallo.

**Instalar Headroom:** `instalar.ps1` lo ofrece y lo deja en `.venv` en la raíz del repo, sin tocar el Python global. Para usarlo en el banco, desde `eficiencia/`:

```powershell
$env:HEADROOM_OFFLINE = "1"
$env:EFICIENCIA_COMPRESOR = '["..\\.venv\\Scripts\\python.exe", "comprimir.py"]'
```

## Pruebas del banco

`node --test prueba\correr.test.mjs` corre todo contra un servidor falso en 127.0.0.1 (sin clave real ni modelo). Comprueba: que la clave no queda en los resultados, que el endpoint solo acepta NVIDIA o localhost, que el compresor no recibe la clave, que Ponytail llega como prompt de sistema y que los criterios se calculan.

## Sábado: Codex

Cuando se reinicien los tokens de ChatGPT, repetir `base` y la variante ganadora con Codex. `correr.mjs` todavía no habla con la CLI de Codex: hay que agregarle ese proveedor antes, con la misma forma de ejecución que usó `evaluacion-codigo`.

## Prueba previa de Headroom en la nube (18/11/2026, sin modelo ni clave)

`headroom-ai==0.44.0` en un contenedor desechable, `HEADROOM_OFFLINE=1`, `comprimir.py` con los mismos mensajes que arma `correr.mjs`. Tokens según el contador de Headroom (tokenizador de gpt-4o), no de Nemotron.

| Caso | Antes | Después | Ahorro | ¿Conserva lo necesario? |
|---|---:|---:|---:|---|
| log-error (1.200 líneas) | 23.397 | 644 | 97 % | Sí: la línea ERROR con código y req. Quedan 28 líneas; de 5 WARN conservó 4 |
| pedidos (300 en JSON) | 4.650 | 1.722 | 63 % | Sí, sin pérdida: pasó el JSON a tabla compacta con las 300 filas y los 65 devueltos |
| pruebas (400 líneas) | 3.014 | 3.014 | 0 % | No lo tocó |
| **Total** | **31.061** | **5.380** | **83 %** | |

Observaciones:
- En el log la compresión **pierde datos**: una pregunta como "¿cuántos WARN hay?" habría fallado. Agrega un aviso `[1200 lines compressed to 28. Retrieve more: hash=…]` que solo sirve si el agente tiene la herramienta de recuperación de Headroom; este banco no la ofrece.
- La tabla de pedidos llega como un texto entre comillas con `\n` escapados. Hay que ver si a Nemotron le cuesta leerla.
- Falta lo principal: confirmar con Nemotron que los veredictos no bajan.

## Resultados con Nemotron (18/11/2026, 3 repeticiones, en el PC del autor)

| Variante | Batería | Aprobadas | Entrada prom. | Salida prom. | Seg. prom. |
|---|---|---|---:|---:|---:|
| base | código | 12/18 | 124 | 149 | 2,7 |
| base | largos | 6/9 | 25.894 | 25 | 4,4 |
| ponytail-sin-cierre | código | 12/18 | 787 | 121 | 3,2 |
| ponytail-sin-cierre | largos | 6/9 | 26.557 | 25 | 3,6 |
| ponytail (completo) | código | 4/18 | 812 | 156 | 4,1 |
| headroom | largos | 6/9 | 4.107 | 25 | 2,9 |

Modelo verificado en las 108 respuestas: `nvidia/nemotron-3-ultra-550b-a55b`. Ninguna clave quedó en los archivos de `resultados/`.

### Headroom: aceptado, ganancia real
- Entrada −84 % (25.894 → 4.107) con la misma calidad (6/9) y menos latencia (4,4 → 2,9 s).
- Por caso: log 64.375 → 1.634 (−97 %), pedidos 7.514 → 4.894 (−35 %), pruebas sin cambio.
- Pedidos falla igual con y sin Headroom: cuenta mal los devueltos (base 29, Headroom 38, real 65) aunque acierta el mayor. Es un límite del modelo contando, no de la compresión.
- Costo de referencia (tarifas DeepInfra de `evaluacion-codigo`): USD 0,0130 → 0,0021 por consulta larga.
- Riesgo conocido: en el log descarta líneas (1 de 5 WARN). Sirve para "encontrar lo raro", no para contar.

### Ponytail completo: descartado, como se predijo
- 14 de 18 respuestas fallaron por la línea final "Skipped: … Risk: …". Curioso: en *faltantes* esa línea avisaba justo del bug real ("will hang on full-range calls").

### Ponytail sin cierre: pasa el criterio congelado, pero no conviene
- Cumple lo que se fijó (calidad igual, salida −19 %). **El criterio tenía un hueco:** solo miraba la salida. El SKILL.md suma ~660 tokens de entrada por consulta, así que el total sube de 273 a 908 tokens (×3,3) y el costo de referencia sube ~69 %. Solo empata con la base si el proveedor cachea el prompt de sistema.
- No se cambia el veredicto a posteriori; queda como lección: **los próximos criterios deben medir tokens totales o costo, no solo una dirección.**
- Recomendación: no usar Ponytail en encargos cortos de una función. Podría servir en tareas largas de código, donde la salida domina; habría que medirlo aparte.

## Bucle de mejora de skills (`mejorar.mjs`), desde 18/11/2026

**Una sola vía, con revisión humana.** El laboratorio mejora skills con datos sintéticos, y ninguna skill sale del laboratorio sin que una persona la revise y la copie a mano. Ninguna parte toca cuentas, mercados ni archivos fuera de `eficiencia/bucle/`.

**Cómo funciona una generación**
1. Nemotron (temperatura 0,8) recibe la skill campeona y solo números agregados del entrenamiento: aprobadas, tokens y una categoría de fallo por encargo ("formato", "demasiado lento", "resultado incorrecto"…). No ve los enunciados, las pruebas ni los casos de reserva.
2. Propone una skill nueva entre `<skill>` y `</skill>`. Se descarta sin medir si pasa de 1.200 caracteres, trae un enlace o una clave, o nombra un encargo de entrenamiento (eso sería aprenderse el examen).
3. Cada candidata se mide en los 6 encargos de `banco/casos.mjs` (entrenamiento).
4. La mejor que supera a la campeona se confirma en `banco/reserva.mjs`: 6 encargos nuevos que el proponente nunca vio (vocales, hora, intervalos, rotar matriz, evaluar expresión, camino mínimo en grilla de 200×200). Sus esperados están verificados con soluciones de referencia en `prueba/referencias-reserva.mjs`.
5. Si también gana en reserva, pasa a ser la campeona y queda en `bucle/propuestas/<fecha>-gN.md` con estado "pendiente de revisión". La siguiente corrida parte de ella (`bucle/campeona.json`), y los intentos fallidos se le muestran al proponente para que no los repita (`bucle/intentos.json`).

**Criterios congelados (antes de la primera corrida)** — métrica: tokens **totales** por consulta (entrada + salida), por la lección de Ponytail.

| Caso | Ganar exige |
|---|---|
| Misma cantidad de aprobadas | Tokens totales ≤ 95 % de la campeona |
| Más aprobadas | Tokens totales ≤ 110 % de la campeona |
| Menos aprobadas, o algún error de red | No gana |

Se exige en entrenamiento **y** en reserva. Sin reintentos.

**Costo:** la primera corrida mide la campeona inicial (sin skill) en las dos baterías: 36 consultas. Cada generación con 3 candidatas: 3 propuestas + 54 de entrenamiento + 18 de reserva = 75. Por defecto (1 generación) son 111 consultas, unos 8 minutos. `--maximo-consultas` (150 por defecto) corta antes de gastar nada si la cuenta no cabe.

```powershell
$env:NVIDIA_API_KEY = "nvapi-..."      # solo en esta terminal
node .\mejorar.mjs                     # 1 generación, 3 candidatas
node .\mejorar.mjs --generaciones 2 --maximo-consultas 160
Remove-Item Env:NVIDIA_API_KEY
```

**Límites honestos:** 6 + 6 encargos es poco; una ganadora puede deberse al azar con 3 repeticiones. Por eso cada propuesta muestra sus números contra la línea base y dice "volver a medir con Codex o Claude": lo que gana con Nemotron no necesariamente gana con otro modelo. Para que corra solo (por ejemplo cada noche) la clave tendría que guardarse en el PC; eso queda como decisión aparte de cada persona.

**Pruebas:** `node --test prueba\mejorar.test.mjs` (7 pruebas con servidor falso: descarte de propuestas, criterios, confirmación en reserva, que el proponente no vea los encargos, que la clave no quede en `bucle/`, tope de consultas).

## Corridas del bucle

### Primera corrida del bucle (18/11/2026, 11:10 a 11:19 Bogotá, PC del autor)

111 consultas, sin errores de red. Ninguna candidata ganó; la campeona sigue siendo "sin skill".

| | Entrenamiento | Tokens totales | Reserva |
|---|---|---:|---|
| Sin skill (campeona) | 12/18 | 274 | 15/18 |
| Candidata 1 | 0/18 | 150 % | no se midió |
| Candidata 2 | 11/18 | 117 % | no se midió |
| Candidata 3 | 12/18 | 125 % | no se midió |

Fallas fijas de la campeona: *faltantes* (lento con rangos enormes), *csv* (resultado) y, en reserva, *intervalos*. Ninguna candidata arregló ninguna de las tres.

**Lectura:** en encargos cortos la salida ya es casi solo código, así que una skill casi no puede bajar tokens; solo suma entrada (70 a 170 tokens sobre 274). Para ganar por calidad con el tope de 110 % la skill tendría que medir menos de ~27 tokens. Es la misma conclusión que con Ponytail: **en tareas cortas el ahorro está en no poner skill.** Donde una skill sí podría pagar es en tareas con entrada grande (tipo `largos`, ~26.000 tokens), donde 100 tokens de skill son menos del 1 % y lo que cuenta es la calidad. Siguiente experimento posible: el bucle sobre `largos`, con casos largos de reserva nuevos y criterios congelados antes.

Conclusiones cortas: `QUE-SIRVE.md`.

## Bucle en tareas largas (`--bateria largos`), desde 19/11/2026

Siguiente experimento después de la corrida en tareas cortas. Mismo bucle, mismos criterios congelados (tabla de arriba), estado aparte en `bucle-largos/`.

- **Entrenamiento:** los 3 casos de `casos-largos.mjs` (log con un ERROR, 300 pedidos, reporte de 400 pruebas). La base sacó 6/9: falla siempre *pedidos* (cuenta mal los devueltos).
- **Reserva nueva** (`banco/reserva-largos.mjs`, nunca vista por el proponente): inventario CSV de 250 filas (contar bajo mínimo y mayor déficit), 800 inicios de sesión (contar fallos y usuario con más fallos), 320 lecturas de sensores en JSON (contar sobre 80 y sensor de la lectura más alta). Las tres son de contar, que es donde falla el modelo.
- **Lo que el proponente no puede escribir:** los nombres de los casos de entrenamiento ni sus respuestas (por ejemplo "pedidos", "devueltos", "E-4583"). Así una skill no puede aprenderse el examen.
- **Cómo puede ganar:** con entradas de miles de tokens, una skill de 100 tokens no puede bajar el total un 5 %, así que la única vía es **aprobar más** gastando ≤ 110 %. Predicción registrada antes de correr: la mayoría de candidatas empatan en 6/9; ganar exige arreglar *pedidos* sin romper los otros dos, y luego contar mejor en reserva.
- **Costo:** 57 consultas por defecto (18 de la campeona inicial, 30 de 3 candidatas, 9 de reserva), cerca de 1,1 millones de tokens de NVIDIA y unos 7 minutos. Sin Headroom: la compresión pierde líneas y aquí importa contar.

```powershell
.\correr-bucle.ps1 --bateria largos     # pide la clave en la ventana
```

**Pruebas:** `node --test prueba\mejorar.test.mjs` suma 3 pruebas para esta batería (reserva determinista y distinta del entrenamiento, una ganadora falsa que se confirma y se guarda en su carpeta, y el filtro de palabras prohibidas).

### Resultado en tareas largas (19/11/2026)

Ninguna ganadora: las 3 candidatas empataron en 6/9 con el 101 % de los tokens totales, y la versión sin skill sacó 0/9 en la reserva larga de contar (esperados verificados por separado). **Conclusión:** con Nemotron sin razonamiento, el bucle no ahorra ni en tareas cortas ni en largas. Para contar hay que calcular con código y dejar que el modelo solo redacte. El bucle queda como herramienta de medición, no como fuente de ahorro.
