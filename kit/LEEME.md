# kit/: ahorro de tokens para Claude con NVIDIA y código

Un servidor MCP (`ia_lab_ahorro`) para la **app de escritorio de Claude**. Cuando Claude tiene que
trabajar con un archivo largo de tu taller, en vez de leerlo entero (tokens caros) hace una de dos cosas:

- **`calcular_con_codigo`**: escribe una función corta de JavaScript que cuenta, suma o filtra en tu PC
  (sandbox de 2 s, sin red, sin `require`). Claude solo ve el resultado.
- **`leer_con_nemotron`**: Nemotron (modelo gratuito de NVIDIA, con **tu** clave) lee el archivo y
  devuelve solo lo pedido. Rechaza tareas de contar: esas van a código (Nemotron se equivoca contando).
- **`estado_ahorro`**: totales del registro local (solo números).

Medido en este taller (estimación sin red, `codigo-primero.mjs`): código primero −93,9 % de tokens con
6/6 respuestas exactas; mandar todo a Nemotron −98,9 % pero solo 6/18 exactas. Por eso el orden.

## Instalar (Windows, Node 24+)
Lo hace `instalar.ps1` en la raíz del repo. A mano:
1. `copy config\carpetas-prohibidas.ejemplo.txt config\carpetas-prohibidas.txt` y escribe tus carpetas
   privadas (sin este archivo el servidor **no arranca**). Igual con `config\temas-privados.txt`.
2. `node --test kit\` → todo en verde (sin red ni claves).
3. Con **Claude cerrado**: `powershell -ExecutionPolicy Bypass -File kit\conectar-claude.ps1`.
   Hace respaldo de la config de Claude y agrega solo `ia_lab_ahorro`.
4. Abre Claude. La regla de uso llega sola; para reforzarla mira `INSTRUCCION-CLAUDE.md`.
5. La primera llamada a NVIDIA abre el cuadro **"IA Lab - clave NVIDIA para Claude"**: pega tu clave
   `nvapi-…` (de build.nvidia.com). Vive solo en memoria hasta que cierras Claude. Nunca en disco.

Quitarlo: `kit\conectar-claude.ps1 -Quitar` y reinicia Claude. Si no aparece: `kit\diagnosticar-claude.ps1` (solo lee).

## Fronteras (todo rechazo hace ruido)
- **Raíz** = la carpeta que contiene `kit\` (o la variable `IA_LAB_RAIZ`). Nada fuera de ella.
- **Tuyas, fuera de Git**, en `<raíz>\config\`:
  - `carpetas-prohibidas.txt`: nunca se leen, tampoco por enlaces.
  - `temas-privados.txt`: si un archivo o tarea los nombra, no sale a NVIDIA. "A.B.C." también atrapa
    "ABC" y "a b c", pero no "abc-label" ni palabras que lo contienen.
- **De fábrica** (solo se endurecen): `.local`, `.codex`, `.agents`, `.git`, `.venv`, `.claude`,
  `node_modules`, `config`, `.env*`, llaves (`.pem`, `.key`, `.pfx`…), claves pegadas en el texto,
  archivos de más de 2 MB.
- Endpoint solo `integrate.api.nvidia.com`. Registro `.local\ahorro\registro.jsonl` con solo números.

## Piezas
| Archivo | Qué hace |
|---|---|
| `ahorro-mcp.mjs` + `guardas.mjs`, `clave.mjs`, `registro.mjs` | El servidor y sus guardas |
| `conectar-claude.ps1` + `config-claude.mjs` | Conecta o quita la herramienta sin tocar otros ajustes |
| `diagnosticar-claude.ps1` | Solo lee: config de MCP y líneas de log, con claves tapadas |
| `ahorro.mjs` | Totales; `--nota <carpeta>` escribe una nota Markdown (pie opcional en `config\nota-pie.md`) |
| `codigo-primero.mjs` | La estimación de arriba |
| `vision\` | Banco de visión con 6 imágenes sintéticas |
| `demo\` | Archivos ficticios para la prueba en vivo de `INSTRUCCION-CLAUDE.md` |
| `portabilidad.test.mjs` | Falla si alguien mete una ruta personal o un proyecto privado en el kit |

## Ayudar a mejorarlo
Cada persona usa **su propia clave**. Si una mejora gana en tu PC, compártela (código y números, nunca
archivos) según `docs/NODOS.md`: pasa a ser la opción por defecto solo si gana en 3 o más nodos.
