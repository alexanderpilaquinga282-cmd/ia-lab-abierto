# IA Lab Abierto

Panel local que reparte el trabajo entre un modelo gratuito (NVIDIA Nemotron) y uno de pago (Codex), comprime las entradas largas y genera imágenes y videos sin gastar tokens del plan de pago. Todo corre en tu PC, con **tus propias claves**.

> Proyecto personal de laboratorio. No es un servicio: nadie comparte claves ni cuentas.

## Qué ahorra (medido, no prometido)

| Prueba | Resultado | Calidad |
| --- | --- | --- |
| 4 funciones que Nemotron resolvió bien | 1.068 tokens contra 51.823 en Codex (−98 %) | igual |
| 6 funciones con enrutador + respaldo en Codex | USD 0,036–0,040 contra 0,104 todo en Codex (−62 a −66 %), a precios de API de referencia | 6/6 |
| Entradas largas con Headroom | 25.894 → 4.107 tokens de entrada (−84 %) | igual |

El ahorro sin perder calidad sale de tres reglas: **(1)** al modelo gratuito solo van tareas de una función o un archivo, con datos ficticios y una prueba concreta; **(2)** siempre se comprueba el resultado; **(3)** lo que falla pasa al modelo de pago sin reintentar. Detalles y método en [`eficiencia/PROTOCOLO.md`](eficiencia/PROTOCOLO.md).

## Instalar (Windows, unos 5 minutos)

Necesitas Node.js 24 o más y Microsoft Edge. Python 3.12 solo si quieres Headroom.

```powershell
git clone https://github.com/<tu-usuario>/ia-lab-abierto
cd ia-lab-abierto
.\instalar.ps1
```

1. Crea tu clave gratuita en [NVIDIA Build](https://build.nvidia.com). Es tuya: no la compartas.
2. Abre el panel con el acceso directo que deja el instalador. La clave se pide en un campo oculto y vive solo en memoria.
3. Escribe en `config/temas-privados.txt` lo que nunca debe ir al modelo gratuito (clientes, proyectos privados). El enrutador lo manda a Codex. En `config/carpetas-prohibidas.txt`, las carpetas que la herramienta de Claude nunca debe leer.
4. Opcional: para imágenes, un token de Cloudflare Workers AI (cuenta gratuita). Para Codex, tu propia sesión de ChatGPT; el instalador deja la conexión lista en `.codex/` de esta carpeta.

## Qué trae el panel

| Pestaña | Qué hace | Proveedor |
| --- | --- | --- |
| Chat | Conversación con Nemotron; Headroom comprime si pegas logs o JSON largos | NVIDIA, tu clave |
| Código | El enrutador decide Nemotron o Codex; Codex también puede pedirle código al panel | NVIDIA + tu Codex |
| Imágenes | Genera y edita con FLUX.2 Klein 4B | Cloudflare, tu cuenta gratuita |
| Reels | Monta video vertical con tus imágenes, guion y storyboard, sin tokens | tu navegador |

## Ahorro dentro de la app de Claude (`kit/`)

Un servidor MCP para la app de escritorio de Claude. Cuando Claude tiene que trabajar con un archivo largo de tu carpeta, no lo lee entero: **cuenta o filtra con código en tu PC** (`calcular_con_codigo`) o **le pide a Nemotron que lo lea** con tu clave (`leer_con_nemotron`). La regla de cuándo usarlas llega sola a Claude al conectar el servidor.

- Medido sin red: código primero −93,9 % de tokens con 6/6 respuestas exactas.
- Tus fronteras van en `config/carpetas-prohibidas.txt` y `config/temas-privados.txt`, fuera de Git. Sin el primero el servidor no arranca.
- El instalador ofrece conectarlo; detalles en [`kit/LEEME.md`](kit/LEEME.md) y la instrucción para pegar en Claude en [`kit/INSTRUCCION-CLAUDE.md`](kit/INSTRUCCION-CLAUDE.md).

## Sumarte como nodo

Un nodo es una persona que corre el laboratorio en su PC y comparte **resultados**, no claves. Corre el banco y manda tus números por *pull request*:

```powershell
cd eficiencia
node .\correr.mjs --variante base
cd ..
node scripts\escanear-secretos.mjs nodos\
```

Ver [`docs/NODOS.md`](docs/NODOS.md). Una skill solo se promueve si gana en varios nodos.

## Reglas

- Solo datos ficticios o públicos hacia el modelo gratuito.
- Nada de claves, datos personales, clínicos o financieros en el repo ni en los resultados.
- Respeta los términos de cada proveedor. El acceso de prueba de NVIDIA es para evaluación y desarrollo, no para servir a terceros.

## Pruebas

```powershell
node --test "panel/*.test.mjs" "eficiencia/prueba/*.test.mjs" "kit/*.test.mjs" "kit/vision/*.test.mjs"
```

Las pruebas usan servidores falsos: no gastan tokens ni necesitan claves. Tres pruebas del puente con Codex se saltan fuera de Windows, porque el puente solo existe ahí.

## Licencia

MIT.
