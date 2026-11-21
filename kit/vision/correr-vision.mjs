// Banco de visión del kit NVIDIA (Nemotron VL con 6 imágenes sintéticas).
//   node correr-vision.mjs [--repeticiones 3]     (clave en NVIDIA_API_KEY; usa correr-vision.ps1)
// Modelo según el kit: nvidia/nemotron-3.5-super-vl-120b-a12b (pendiente de verificar en build.nvidia.com:
// si NVIDIA responde 404 se anota tal cual y se para, sin probar otros modelos a ciegas).
// CRITERIOS CONGELADOS (20/11/2026, antes de correr):
//   - Lectura (5 casos tipo "leer"): se acepta como lector de imágenes del taller solo si acierta 15/15
//     (exactitud 100 %, estabilidad 3/3) y sin errores de red.
//   - Contar (1 caso): se reporta aparte; no decide.
//   - Ahorro: tokens que Claude NO gasta = (ancho×alto)/750 por imagen − tokens de la respuesta.
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { casosVision, tokensImagenClaude, verificarVision } from './imagenes.mjs';

export const MODELO_VL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const ENDPOINT_NVIDIA = 'https://integrate.api.nvidia.com/v1/chat/completions';

export function endpoint(env = process.env) {
  const url = env.EFICIENCIA_ENDPOINT ?? ENDPOINT_NVIDIA;
  const { protocol, hostname } = new URL(url);
  if (!(url === ENDPOINT_NVIDIA || (protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(hostname)))) throw new Error('Endpoint no permitido: solo integrate.api.nvidia.com o 127.0.0.1.');
  return url;
}

async function consultar(url, clave, caso) {
  const inicio = performance.now();
  const r = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO_VL, temperature: 0.1, max_tokens: 256,
      messages: [{ role: 'user', content: [
        { type: 'text', text: caso.pregunta },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + caso.png.toString('base64') } },
      ] }],
    }),
  });
  const segundos = Number(((performance.now() - inicio) / 1000).toFixed(2));
  if (!r.ok) return { error: 'HTTP ' + r.status, detalle: (await r.text().catch(() => '')).replace(/nvapi-[\w-]+/g, 'nvapi-***').slice(0, 200), segundos };
  const j = await r.json();
  return { segundos, texto: j.choices?.[0]?.message?.content ?? '', modelo: j.model ?? null, entrada: j.usage?.prompt_tokens ?? null, salida: j.usage?.completion_tokens ?? null };
}

export async function correrVision({ repeticiones = 3, pausaMs = 1500, env = process.env, log = console.log } = {}) {
  const clave = env.NVIDIA_API_KEY;
  if (!clave) throw new Error('Falta NVIDIA_API_KEY en esta terminal.');
  const url = endpoint(env);
  const filas = [];
  for (let rep = 1; rep <= repeticiones; rep++) for (const caso of casosVision) {
    let r;
    try { r = await consultar(url, clave, caso); } catch (e) { r = { error: e.name === 'TimeoutError' ? 'tiempo agotado' : 'conexión: ' + e.message }; }
    const v = r.error ? { aprobada: false, motivo: r.error } : verificarVision(caso, r.texto);
    const fila = { id: caso.id, tipo: caso.tipo, rep, ...r, aprobada: v.aprobada, motivo: v.motivo ?? null, tokensClaudeImagen: tokensImagenClaude(caso) };
    filas.push(fila);
    log(`vision rep${rep} ${caso.id}: ${r.error ?? (v.aprobada ? 'aprobada' : 'fallida ' + v.motivo)} · entrada ${r.entrada ?? '?'} · salida ${r.salida ?? '?'}`);
    if (['HTTP 401', 'HTTP 403', 'HTTP 404'].includes(r.error)) throw Object.assign(new Error(`NVIDIA respondió ${r.error} para ${MODELO_VL}: ${r.detalle || 'sin detalle'}. Se para aquí (sin reintentos).`), { filas });
    if (pausaMs) await new Promise(ok => setTimeout(ok, pausaMs));
  }
  return { fecha: new Date().toISOString(), modeloPedido: MODELO_VL, repeticiones, filas, veredicto: veredictoVision(filas) };
}

export function veredictoVision(filas) {
  const leer = filas.filter(f => f.tipo === 'leer'), contar = filas.filter(f => f.tipo === 'contar');
  const errores = filas.filter(f => f.error).length;
  const ok = leer.filter(f => f.aprobada).length;
  const evitados = leer.filter(f => f.aprobada).reduce((a, f) => a + f.tokensClaudeImagen - (f.salida ?? 0), 0);
  const aceptada = errores === 0 && leer.length > 0 && ok === leer.length;
  return { aceptada, lectura: `${ok}/${leer.length}`, contar: `${contar.filter(f => f.aprobada).length}/${contar.length}`, errores, tokensClaudeEvitados: evitados,
    motivo: aceptada ? 'lectura exacta en todas las repeticiones' : errores ? 'hubo errores de red o de modelo: sin decisión' : 'alguna lectura falló: no se acepta' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { repeticiones: { type: 'string', default: '3' } } });
  let resultado;
  try { resultado = await correrVision({ repeticiones: Number(values.repeticiones) }); }
  catch (e) { console.error(e.message); resultado = e.filas ? { fecha: new Date().toISOString(), modeloPedido: MODELO_VL, filas: e.filas, error: e.message } : null; process.exitCode = 1; }
  if (resultado) {
    const carpeta = new URL('resultados/', import.meta.url);
    await mkdir(carpeta, { recursive: true });
    const nombre = resultado.fecha.slice(0, 16).replace(/[:T]/g, '-') + '-vision.json';
    await writeFile(new URL(nombre, carpeta), JSON.stringify(resultado, null, 2));
    console.log(JSON.stringify(resultado.veredicto ?? { error: resultado.error }, null, 1));
    console.log('Guardado en vision/resultados/' + nombre);
  }
}
