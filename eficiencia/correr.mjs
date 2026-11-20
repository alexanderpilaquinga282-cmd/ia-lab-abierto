// Corre el banco de eficiencia contra Nemotron (NVIDIA Build).
//
//   node correr.mjs --variante base|ponytail|ponytail-sin-cierre|headroom
//                   [--bateria codigo|largos|todas] [--repeticiones 3]
//
// La clave se lee solo de NVIDIA_API_KEY en la terminal actual. No se guarda,
// no se imprime y no se pasa al compresor. Sin reintentos: un fallo queda
// registrado como fallo.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { casos as casosCodigo } from './banco/casos.mjs';
import { verificar } from './banco/verificar.mjs';
import { casosLargos, verificarLargo } from './casos-largos.mjs';

export const MODELO = 'nvidia/nemotron-3-ultra-550b-a55b';
const ENDPOINT_NVIDIA = 'https://integrate.api.nvidia.com/v1/chat/completions';
const VARIANTES = ['base', 'ponytail', 'ponytail-sin-cierre', 'headroom'];
const CIERRE = 'End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.';
const HERRAMIENTA = {
  type: 'function',
  function: { name: 'leer_datos', description: 'Devuelve los datos del caso.', parameters: { type: 'object', properties: {} } },
};

// Solo NVIDIA o un servidor local de prueba: la clave no puede ir a otro lado.
export function endpoint(env = process.env) {
  const url = env.EFICIENCIA_ENDPOINT ?? ENDPOINT_NVIDIA;
  const { protocol, hostname } = new URL(url);
  const permitido = url === ENDPOINT_NVIDIA || (protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(hostname));
  if (!permitido) throw new Error('Endpoint no permitido: solo integrate.api.nvidia.com o 127.0.0.1.');
  return url;
}

export async function promptSistema(variante) {
  if (!variante.startsWith('ponytail')) return null;
  const texto = await readFile(new URL('ponytail-SKILL.md', import.meta.url), 'utf8');
  const cuerpo = texto.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^---[\s\S]*?---\s*/, '').trim();
  if (variante === 'ponytail') return cuerpo;
  if (!cuerpo.includes(CIERRE)) throw new Error('El SKILL.md de Ponytail cambió: revisa la frase de cierre.');
  return cuerpo.replace(' ' + CIERRE, '');
}

export function mensajes(caso, sistema) {
  const base = sistema ? [{ role: 'system', content: sistema }] : [];
  if (!caso.datos) return [...base, { role: 'user', content: caso.prompt }];
  return [
    ...base,
    { role: 'user', content: caso.pregunta },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'leer_datos', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: caso.datos },
  ];
}

function comprimir(messages, env = process.env) {
  const comando = env.EFICIENCIA_COMPRESOR ? JSON.parse(env.EFICIENCIA_COMPRESOR) : ['python', 'comprimir.py'];
  const { NVIDIA_API_KEY, ...resto } = env;
  const hijoEnv = { ...resto, HEADROOM_OFFLINE: '1', HEADROOM_BEACON: 'off', HEADROOM_TELEMETRY: 'off', DO_NOT_TRACK: '1' };
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(comando[0], comando.slice(1), { cwd: new URL('.', import.meta.url), env: hijoEnv });
    let salida = '';
    let errores = '';
    hijo.stdout.on('data', d => (salida += d));
    hijo.stderr.on('data', d => (errores += d));
    hijo.on('error', rechazar);
    hijo.on('close', codigo => {
      if (codigo !== 0) return rechazar(new Error('El compresor falló: ' + errores.slice(-500)));
      try { resolver(JSON.parse(salida)); } catch (e) { rechazar(e); }
    });
    hijo.stdin.end(JSON.stringify({ messages }));
  });
}

export async function consultar(url, clave, messages, conHerramienta, { temperatura = 0.1, maxTokens = 2048 } = {}) {
  const inicio = performance.now();
  const respuesta = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      messages,
      temperature: temperatura,
      max_tokens: maxTokens,
      reasoning_effort: 'none',
      chat_template_kwargs: { enable_thinking: false },
      ...(conHerramienta ? { tools: [HERRAMIENTA], tool_choice: 'none' } : {}),
    }),
  });
  const segundos = Number(((performance.now() - inicio) / 1000).toFixed(2));
  if (!respuesta.ok) {
    const detalle = (await respuesta.text().catch(() => '')).replace(/nvapi-[\w-]+/g, 'nvapi-***').slice(0, 200);
    return { error: 'HTTP ' + respuesta.status, detalle, segundos };
  }
  const json = await respuesta.json();
  return {
    segundos,
    texto: json.choices?.[0]?.message?.content ?? '',
    fin: json.choices?.[0]?.finish_reason ?? null,
    modelo: json.model ?? null,
    entrada: json.usage?.prompt_tokens ?? null,
    salida: json.usage?.completion_tokens ?? null,
  };
}

// Corre una lista de casos con un prompt de sistema dado (o ninguno) y verifica
// cada respuesta. La usan correr() y el bucle de mejora (mejorar.mjs).
export async function evaluarCasos({ lista, sistema = null, etiqueta, repeticiones = 3, pausaMs = 1500, env = process.env, log = console.log, comprimirMensajes = false }) {
  const clave = env.NVIDIA_API_KEY;
  if (!clave) throw new Error('Falta NVIDIA_API_KEY en esta terminal.');
  const url = endpoint(env);
  const filas = [];
  for (let rep = 1; rep <= repeticiones; rep++) {
    for (const caso of lista) {
      let messages = mensajes(caso, sistema);
      let compresion = null;
      if (comprimirMensajes) {
        const r = await comprimir(messages, env);
        messages = r.messages;
        compresion = { antes: r.tokens_before, despues: r.tokens_after };
      }
      let r;
      try {
        r = await consultar(url, clave, messages, Boolean(caso.datos));
      } catch (e) {
        r = { error: e.name === 'TimeoutError' ? 'tiempo agotado' : 'conexión: ' + e.message };
      }
      const calidad = r.error ? null : caso.datos ? verificarLargo(caso, r.texto) : verificar(caso, r.texto);
      const fila = {
        id: caso.id, nivel: caso.nivel, rep, ...r, compresion,
        aprobada: Boolean(calidad && calidad.aprobadas === calidad.total),
        pruebas: calidad && { aprobadas: calidad.aprobadas, total: calidad.total, fallos: calidad.fallos.slice(0, 3) },
      };
      filas.push(fila);
      log(`${etiqueta} rep${rep} ${caso.id}: ${r.error ?? (fila.aprobada ? 'aprobada' : 'fallida')} · entrada ${r.entrada ?? '?'} · salida ${r.salida ?? '?'} · ${r.segundos ?? '?'} s`);
      if (r.error === 'HTTP 401' || r.error === 'HTTP 403') {
        throw new Error(`NVIDIA rechazó la clave (${r.error}): ${r.detalle || 'sin detalle'}. Revisa que NVIDIA_API_KEY sea tu clave real y que tenga acceso a ${MODELO}.`);
      }
      if (pausaMs) await new Promise(ok => setTimeout(ok, pausaMs));
    }
  }
  return filas;
}

export async function correr({ variante, bateria = 'todas', repeticiones = 3, pausaMs = 1500, env = process.env, log = console.log }) {
  if (!VARIANTES.includes(variante)) throw new Error('Variante inválida. Usa: ' + VARIANTES.join(', '));
  if (!env.NVIDIA_API_KEY) throw new Error('Falta NVIDIA_API_KEY en esta terminal.');
  const url = endpoint(env);
  const sistema = await promptSistema(variante);
  const lista = [
    ...(bateria !== 'largos' ? casosCodigo : []),
    ...(bateria !== 'codigo' ? casosLargos : []),
  ];
  const filas = await evaluarCasos({ lista, sistema, etiqueta: variante, repeticiones, pausaMs, env, log, comprimirMensajes: variante === 'headroom' });
  return { fecha: new Date().toISOString(), variante, bateria, repeticiones, modeloPedido: MODELO, endpoint: new URL(url).host, filas };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      variante: { type: 'string', default: 'base' },
      bateria: { type: 'string', default: 'todas' },
      repeticiones: { type: 'string', default: '3' },
    },
  });
  const resultado = await correr({ ...values, repeticiones: Number(values.repeticiones) }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
  const carpeta = new URL('resultados/', import.meta.url);
  await mkdir(carpeta, { recursive: true });
  const nombre = resultado.fecha.slice(0, 16).replace(/[:T]/g, '-') + '-' + resultado.variante + '.json';
  await writeFile(new URL(nombre, carpeta), JSON.stringify(resultado, null, 2));
  console.log('Guardado en resultados/' + nombre);
}
