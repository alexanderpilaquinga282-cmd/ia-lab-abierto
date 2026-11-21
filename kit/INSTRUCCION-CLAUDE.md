# Instrucción fija para Claude (app de escritorio)

La regla ya viaja **sola**: el servidor `ia_lab_ahorro` se la entrega a Claude cada vez que arranca
(campo `instructions` del protocolo MCP), con la ruta de tu taller ya puesta. Pegarla además en tus
preferencias la refuerza en todos los chats. Hazlo una vez:

1. Claude → **Configuración → General → Preferencias personales** (o, si solo la quieres en un
   proyecto, en las **instrucciones del proyecto**).
2. Pega el bloque de abajo y cambia `<RAIZ>` por la carpeta de tu taller (la que contiene `kit\`).
   `instalar.ps1` te la imprime ya rellenada.

```text
Regla de ahorro de IA Lab (herramientas ia_lab_ahorro). Cuando una tarea toque un archivo de <RAIZ>
de más de ~200 líneas o ~20 KB (logs, JSON, CSV, reportes), NO lo leas entero:
1. Contar, sumar, filtrar, agrupar, máximos o mínimos: mira una muestra corta (20-40 líneas) y usa
   calcular_con_codigo con una función que devuelva solo el resultado.
2. Encontrar algo (un error, una línea, un nombre) o resumir: usa leer_con_nemotron y verifica lo
   que diga antes de afirmarlo.
3. Archivos cortos o fuera de <RAIZ>: trabaja normal.
4. Si la herramienta rechaza un archivo (carpeta o tema privado), no insistas ni lo mandes por otra vía.
Si pregunto por el ahorro, muestra estado_ahorro.
```

## Dónde aplica (y dónde no)
- **Sí:** chats y proyectos de la **app de escritorio** en el PC donde corriste `conectar-claude.ps1`.
- **No:** claude.ai en el navegador, el móvil ni otro PC: allí no existe el servidor local.
- Solo ahorra cuando hay un **archivo largo del taller**. Una conversación normal cuesta lo mismo.

## Prueba en vivo (2 minutos)
Con Claude reiniciado, pide en un chat nuevo:
- "Busca la línea de error en `<RAIZ>\kit\demo\log-ficticio.txt`" → debe usar `leer_con_nemotron`
  y nombrar **E-4583** en la petición **r-49817**.
- "¿Cuántos pedidos devueltos hay en `<RAIZ>\kit\demo\pedidos-ficticios.json` y cuál es el más caro?"
  → debe usar `calcular_con_codigo` y dar **65** y **P-0090**.
- "Muéstrame estado_ahorro" → las dos llamadas con sus tokens.
