// Servidor MCP "ia_lab_ahorro" para Claude (kit NVIDIA de ia-lab-abierto).
//   leer_con_nemotron   : Nemotron lee un archivo largo del taller y Claude solo lee la respuesta
//                         (para encontrar lo raro: errores, líneas, nombres). Nunca para contar.
//   calcular_con_codigo : Claude escribe una función corta, corre aquí sobre el archivo y Claude
//                         lee solo el resultado (contar, sumar, máximos). Sin red. Regla LIA5.
//   estado_ahorro       : totales del registro de ahorro.
// Guardas: solo archivos dentro del taller; carpetas y temas privados de config/, credenciales y configuración bloqueados;
// sin texto libre hacia NVIDIA; clave por sesión en ventana privada; endpoint solo NVIDIA o 127.0.0.1.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { archivoPermitido, configuracion, contenidoPermitido, cwdProhibido, tareaDeContar } from './guardas.mjs';
import { obtenerClave, olvidarClave } from './clave.mjs';
import { anotar, estimarTokens, leerRegistro, resumen } from './registro.mjs';

export const MODELO_LECTOR = 'nvidia/nemotron-3-ultra-550b-a55b';
const ENDPOINT_NVIDIA = 'https://integrate.api.nvidia.com/v1/chat/completions';
const LECTOR = 'Lees un archivo largo para otro asistente. Responde en español, breve, solo lo pedido. Copia tal cual las líneas, códigos o nombres que respalden tu respuesta. Si no lo encuentras, responde exactamente NO ENCONTRADO. No cuentes ni sumes: si la tarea lo pide, responde USA CODIGO.';

export function endpoint(env = process.env) {
  const url = env.IA_LAB_ENDPOINT_PRUEBA ?? ENDPOINT_NVIDIA;
  const { protocol, hostname } = new URL(url);
  if (!(url === ENDPOINT_NVIDIA || (protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(hostname)))) {
    throw new Error('Endpoint no permitido: solo integrate.api.nvidia.com o 127.0.0.1.');
  }
  return url;
}

export function crearHerramientas(raiz) {
  return [
    {
    name: 'leer_con_nemotron',
    description: `Usa Nemotron (NVIDIA, gratis) para leer un archivo LARGO dentro de ${raiz} y devolver solo lo pedido: encontrar un error, una línea, un nombre o resumir. Ahorra los tokens de leer el archivo entero. NO sirve para contar, sumar ni sacar máximos (usa calcular_con_codigo). Solo datos ficticios del taller; las carpetas y temas privados están bloqueados. Verifica la respuesta antes de usarla: puede perder detalles.`,
    inputSchema: {
      type: 'object',
      properties: {
        archivo: { type: 'string', description: `Ruta absoluta del archivo dentro de ${raiz}.` },
        tarea: { type: 'string', minLength: 8, maxLength: 500, description: 'Qué buscar o resumir. Sin datos pegados.' },
      },
      required: ['archivo', 'tarea'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    },
    {
    name: 'calcular_con_codigo',
    description: `Corre en el PC una función JavaScript que tú escribes sobre el texto de un archivo de ${raiz} y te devuelve solo el resultado. Úsala para contar, sumar, filtrar o sacar máximos en archivos largos en vez de leerlos enteros (exacto y sin tokens de lectura). Primero mira una muestra corta del archivo si no conoces el formato. La función debe ser exactamente \`function calcular(texto) { ... }\` y devolver un valor serializable a JSON. Sin red, sin require, límite 2 s.`,
    inputSchema: {
      type: 'object',
      properties: {
        archivo: { type: 'string', description: `Ruta absoluta del archivo dentro de ${raiz}.` },
        funcion: { type: 'string', minLength: 20, maxLength: 8000, description: 'function calcular(texto) { ... return resultado; }' },
      },
      required: ['archivo', 'funcion'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
    name: 'estado_ahorro',
    description: 'Muestra cuántos tokens de lectura se evitaron con leer_con_nemotron y calcular_con_codigo (registro local, sin contenido).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    },
  ];
}

// Instrucción que la app recibe al conectar (campo "instructions" de MCP). Es la regla fija:
// archivos largos del taller nunca se leen enteros.
export function instrucciones(raiz) {
  return `Regla de ahorro de IA Lab: cuando una tarea toque un archivo de ${raiz} de más de ~200 líneas o ~20 KB (logs, JSON, CSV, reportes), NO lo leas entero.
1. Para contar, sumar, filtrar, agrupar o sacar máximos/mínimos: mira una muestra corta (las primeras 20-40 líneas) y usa calcular_con_codigo con una función que devuelva solo el resultado.
2. Para encontrar algo raro (un error, una línea, un nombre) o resumir: usa leer_con_nemotron y verifica la respuesta (puede perder detalles).
3. Archivos cortos, o fuera de ${raiz}: trabaja normal.
4. Si la herramienta rechaza un archivo (carpeta o tema privado), no insistas ni lo leas por otra vía para mandarlo a NVIDIA.
Al terminar una tarea que usó estas herramientas, puedes mostrar estado_ahorro si el usuario pregunta por el ahorro.`;
}

const texto = (data, isError = false) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }], ...(isError && { isError: true }) });

async function preguntarNemotron(url, clave, contenido, tarea, signal) {
  const inicio = performance.now();
  const r = await fetch(url, {
    method: 'POST', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO_LECTOR, temperature: 0.1, max_tokens: 1024,
      reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: LECTOR }, { role: 'user', content: `Tarea: ${tarea}\n\nArchivo:\n${contenido}` }],
    }),
  });
  const segundos = Number(((performance.now() - inicio) / 1000).toFixed(2));
  if (!r.ok) return { error: 'HTTP ' + r.status, segundos };
  const j = await r.json();
  return { segundos, respuesta: j.choices?.[0]?.message?.content ?? '', entrada: j.usage?.prompt_tokens ?? null, salida: j.usage?.completion_tokens ?? null };
}

export function ejecutarFuncion(funcion, contenido) {
  const codigo = funcion.trim().replace(/^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  if (!/^function\s+calcular\s*\(\s*\w+\s*\)\s*\{/.test(codigo) || !codigo.endsWith('}')) {
    throw new Error('Envía solo `function calcular(texto) { ... }`, sin otra cosa.');
  }
  const contexto = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  contexto.__texto = contenido;
  new Script('"use strict";\n' + codigo + '\nvar __salida = JSON.stringify(calcular(__texto));').runInContext(contexto, { timeout: 2000 });
  const salida = contexto.__salida;
  if (salida === undefined) throw new Error('calcular devolvió undefined.');
  if (salida.length > 20_000) throw new Error('El resultado pasa de 20.000 caracteres: resume más dentro de la función.');
  return salida;
}

export function crearLlamador(env = process.env) {
  const conf = configuracion(env);
  return async (nombre, args = {}, signal) => {
    if (nombre === 'estado_ahorro') {
      const r = resumen(leerRegistro(env));
      return texto({ ...r, nota: 'leer_con_nemotron usa los tokens que reporta NVIDIA; calcular_con_codigo estima 4 caracteres por token (conservador).' });
    }
    const herramienta = nombre;
    let real, contenido;
    try {
      real = archivoPermitido(args.archivo, conf);
      contenido = readFileSync(real, 'utf8');
    } catch (e) {
      anotar({ herramienta, error: 'rechazado' }, env);
      return texto(e.message, true);
    }

    if (nombre === 'calcular_con_codigo') {
      try {
        const salida = ejecutarFuncion(String(args.funcion ?? ''), contenido);
        const tokensArchivo = estimarTokens(contenido);
        const tokensQueLeeClaude = estimarTokens(args.funcion) + estimarTokens(salida);
        anotar({ herramienta, bytes: Buffer.byteLength(contenido), tokensArchivo, tokensQueLeeClaude, fuente: 'estimado' }, env);
        return texto(salida);
      } catch (e) {
        anotar({ herramienta, error: 'funcion' }, env);
        return texto('La función falló: ' + String(e?.message ?? e).slice(0, 300), true);
      }
    }

    // leer_con_nemotron
    const tarea = String(args.tarea ?? '');
    if (tarea.length < 8 || tarea.length > 500) return texto('Describe la tarea en 8 a 500 caracteres.', true);
    if (tareaDeContar.test(tarea)) {
      anotar({ herramienta, error: 'contar' }, env);
      return texto('Esta tarea es de contar, sumar o sacar extremos: Nemotron se equivoca ahí (0/12 en el banco). Usa calcular_con_codigo.', true);
    }
    try { contenidoPermitido(contenido, tarea, conf); } catch (e) { anotar({ herramienta, error: 'rechazado' }, env); return texto(e.message, true); }
    let r;
    try {
      const url = endpoint(env);
      const clave = await obtenerClave(env);
      r = await preguntarNemotron(url, clave, contenido, tarea, signal);
    } catch (e) {
      if (e.name === 'ClavePendiente') {
        anotar({ herramienta, error: 'clave pendiente' }, env);
        return texto('Abrí en el PC el cuadro "IA Lab - clave NVIDIA para Claude" (siempre encima; si no lo ves, búscalo en la barra de tareas). La persona pega su clave ahí y presiona Enter; luego vuelve a llamar esta herramienta con lo mismo. El cuadro espera 5 minutos.', true);
      }
      r = { error: e.name === 'TimeoutError' ? 'tiempo agotado' : String(e.message).replace(/nvapi-[\w-]+/g, 'nvapi-***').slice(0, 200) };
    }
    if (r.error === 'HTTP 401' || r.error === 'HTTP 403') olvidarClave();
    if (r.error) {
      anotar({ herramienta, error: r.error }, env);
      return texto(`Nemotron no respondió (${r.error}). Sigue sin él; no reintentes en NVIDIA.`, true);
    }
    const tokensArchivo = r.entrada ?? estimarTokens(contenido);
    const tokensQueLeeClaude = r.salida ?? estimarTokens(r.respuesta);
    anotar({ herramienta, bytes: Buffer.byteLength(contenido), tokensArchivo, tokensQueLeeClaude, segundos: r.segundos, fuente: r.entrada == null ? 'estimado' : 'nvidia' }, env);
    return texto(`${r.respuesta}\n\n[Nemotron leyó ${tokensArchivo} tokens; tú lees ${tokensQueLeeClaude}. Verifica antes de usar: un resumen puede perder líneas.]`);
  };
}

// ---------- protocolo MCP por stdio (mismo esquema que ia_lab_nvidia de Codex) ----------
const versiones = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export async function servir(entrada = process.stdin, salida = process.stdout, env = process.env) {
  const llamar = crearLlamador(env);
  const { raiz } = configuracion(env);
  const herramientas = crearHerramientas(raiz);
  const lineas = createInterface({ input: entrada, crlfDelay: Infinity, terminal: false });
  const enviar = m => salida.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const pendientes = new Map();
  let iniciado = false;
  for await (const linea of lineas) {
    let m;
    try { m = JSON.parse(linea); } catch { enviar({ id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    const { id, method, params } = m ?? {};
    if (id === undefined) { if (method === 'notifications/cancelled') pendientes.get(params?.requestId)?.abort(); continue; }
    if (method === 'initialize') {
      iniciado = true;
      enviar({ id, result: { protocolVersion: versiones.includes(params?.protocolVersion) ? params.protocolVersion : versiones[0], capabilities: { tools: {} }, serverInfo: { name: 'ia_lab_ahorro', version: '1.1.0' }, instructions: instrucciones(raiz) } });
    } else if (method === 'ping') enviar({ id, result: {} });
    else if (!iniciado) enviar({ id, error: { code: -32002, message: 'Server not initialized' } });
    else if (method === 'tools/list') enviar({ id, result: { tools: herramientas } });
    else if (method === 'tools/call') {
      if (!herramientas.some(h => h.name === params?.name)) { enviar({ id, error: { code: -32602, message: 'Unknown tool' } }); continue; }
      const control = new AbortController();
      pendientes.set(id, control);
      llamar(params.name, params.arguments ?? {}, control.signal)
        .catch(() => texto('ia_lab_ahorro no pudo completar la operación.', true))
        .then(r => { if (!control.signal.aborted) enviar({ id, result: r }); })
        .finally(() => pendientes.delete(id));
    } else enviar({ id, error: { code: -32601, message: 'Method not found' } });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const conf = configuracion();
  // Sin la config local no arranca: así nunca corre con las fronteras vacías por error.
  if (!existsSync(join(conf.config, 'carpetas-prohibidas.txt'))) {
    process.stderr.write(`ia_lab_ahorro: falta ${join(conf.config, 'carpetas-prohibidas.txt')}. Corre instalar.ps1 (o copia config/carpetas-prohibidas.ejemplo.txt).\n`);
    process.exit(4);
  }
  const p = cwdProhibido(process.cwd(), conf);
  if (p) { process.stderr.write(`ia_lab_ahorro: bloqueado, no arranca con ${process.cwd()} como carpeta de trabajo (carpeta prohibida).\n`); process.exit(3); }
  await servir();
}
