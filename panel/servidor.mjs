import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImageProvider, imageReference } from './imagenes.mjs';
import { runCodex } from './programacion.mjs';
import { resolverOpenCode, runOpenCode } from './opencode.mjs';
import { decidirRuta } from './ruta-codigo.js';
import { leerTemasPrivados } from './temas-privados.mjs';
import { crearCompresor } from './headroom.mjs';
import { borrarSesionCodex, leerSesionCodex, publicarSesionCodex, rutaSesionCodex } from './sesion-codex.mjs';

const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/estilo.css', ['estilo.css', 'text/css']],
  ['/chat.js', ['chat.js', 'text/javascript']],
  ['/panel.js', ['panel.js', 'text/javascript']],
  ['/reels.js', ['reels.js', 'text/javascript']],
  ['/ruta-codigo.js', ['ruta-codigo.js', 'text/javascript']],
].map(([path, [file, type]]) => [path, {
  type: type.startsWith('audio/') ? type : type + '; charset=utf-8',
  content: readFileSync(new URL(file, import.meta.url)),
}]));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req, limit = MAX_BODY_BYTES, tooLargeMessage = 'La conversación es demasiado larga. Abre un chat nuevo con un resumen.') {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Formato de solicitud incompatible.');
  }
  const tooLarge = () => new HttpError(413, tooLargeMessage);
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw tooLarge();
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw tooLarge();
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'La solicitud no contiene datos válidos.');
  }
}

function checkMessages(messages) {
  if (!Array.isArray(messages) || messages.length % 2 !== 1 || messages.some((message, index) =>
    message?.role !== (index % 2 ? 'assistant' : 'user') ||
    typeof message.content !== 'string' || !message.content.trim()
  )) {
    throw new HttpError(400, 'Escribe un mensaje para continuar.');
  }
  return messages.map(({ role, content }) => ({ role, content }));
}

function usageFrom(raw) {
  const input = raw?.prompt_tokens;
  const output = raw?.completion_tokens;
  if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  return { input, output };
}

async function* completionParts(upstream) {
  if (!upstream.headers.get('content-type')?.includes('text/event-stream')) {
    yield await upstream.json();
    yield '[DONE]';
    return;
  }
  let buffer = '';
  const decoder = new TextDecoder();
  const extract = event => {
    const data = event.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return null;
    return data === '[DONE]' ? data : JSON.parse(data);
  };
  for await (const bytes of upstream.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let separator;
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const part = extract(buffer.slice(0, separator.index));
      buffer = buffer.slice(separator.index + separator[0].length);
      if (part) yield part;
      if (part === '[DONE]') return;
    }
  }
  const part = extract(buffer + decoder.decode());
  if (part) yield part;
}

function upstreamError(status) {
  const messages = {
    400: 'NVIDIA rechazó el mensaje. Revisa su tamaño o inicia un chat nuevo.',
    401: 'NVIDIA no aceptó la clave. Revisa que siga activa en NVIDIA Build.',
    402: 'NVIDIA indica que tu cuenta no tiene saldo disponible.',
    403: 'Tu clave no tiene acceso a este modelo de NVIDIA.',
    422: 'NVIDIA rechazó el formato de la consulta.',
    429: 'NVIDIA alcanzó un límite de uso. Esta solicitud se detuvo.',
  };
  return new HttpError(messages[status] ? status : 502,
    messages[status] ?? 'NVIDIA no pudo responder en este momento.');
}

export async function iniciarChat({ request = fetch, program = null, archivoPuente = rutaSesionCodex(), compresor = crearCompresor() } = {}) {
  const token = randomBytes(32).toString('hex');
  let key = '';
  let lastSeen = Date.now();
  let firstRequest;
  const ready = new Promise(resolveReady => { firstRequest = resolveReady; });
  let active = null;
  let shutdownTimer;
  let puente;
  let temporizadorPuente;
  let cambioPuente = 0;
  const stats = { requests: 0, metered: 0, input: 0, output: 0 };
  const images = createImageProvider(request);
  const openCode = resolverOpenCode();

  function panelStatus() {
    return {
      nvidia: Boolean(key), images: images.connected, codex: Boolean(program), opencode: Boolean(key && openCode),
      bridge: Boolean(key && puente && puente.expiresAt > Date.now()),
    };
  }

  async function revocarPuente() {
    const anterior = puente;
    cambioPuente++;
    puente = undefined;
    clearTimeout(temporizadorPuente);
    anterior?.controller.abort();
    if (anterior) await borrarSesionCodex(archivoPuente, anterior).catch(() => {});
  }

  async function autorizarPuente(req) {
    const actual = puente;
    if (!key || !actual || actual.expiresAt <= Date.now() || req.headers.origin !== undefined ||
        req.headers.authorization !== 'Bearer ' + actual.token ||
        !['/api/code/route', '/api/code/bridge/status'].includes(req.url)) return null;
    const publicada = await leerSesionCodex(archivoPuente);
    if (actual !== puente || publicada?.token !== actual.token) return null;
    return actual;
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== host) {
      json(res, 403, { error: 'Abre el chat desde su acceso directo.' });
      return;
    }
    const asset = req.method === 'GET' && assets.get(req.url);
    if (asset) {
      if (req.url === '/') firstRequest(true);
      res.writeHead(200, { 'Content-Type': asset.type });
      res.end(asset.content);
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/api/')) {
      json(res, 404, { error: 'Ruta desconocida.' });
      return;
    }
    const navegador = req.headers.origin === origin && req.headers.authorization === 'Bearer ' + token;
    const sesionExterna = navegador ? null : await autorizarPuente(req);
    if (!navegador && !sesionExterna) {
      json(res, 403, { error: 'Abre el chat desde su acceso directo.' });
      return;
    }

    lastSeen = Date.now();
    if (req.url === '/api/leave') {
      clearTimeout(shutdownTimer);
      shutdownTimer = setTimeout(close, 6000);
      res.writeHead(204).end();
      return;
    }
    clearTimeout(shutdownTimer);
    try {
      if (req.url === '/api/status') {
        const actual = puente;
        const cambio = cambioPuente;
        if (actual) {
          const publicada = await leerSesionCodex(archivoPuente);
          if (actual === puente && cambio === cambioPuente && publicada?.token !== actual.token) await revocarPuente();
        }
        json(res, 200, { connected: Boolean(key), stats, panel: panelStatus() });
      } else if (req.url === '/api/connect') {
        const candidate = (await readJson(req))?.key;
        if (typeof candidate !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(candidate) || /["']/.test(candidate)) {
          throw new HttpError(400, 'Pega la clave NVIDIA completa, sin espacios ni comillas.');
        }
        if (active) throw new HttpError(409, 'Hay una respuesta en curso.');
        if (key && key !== candidate) await revocarPuente();
        key = candidate;
        json(res, 200, { connected: true, stats, panel: panelStatus() });
      } else if (req.url === '/api/disconnect') {
        if (active) throw new HttpError(409, 'Detén la respuesta antes de cerrar sesión.');
        key = '';
        await revocarPuente();
        images.clear();
        Object.assign(stats, { requests: 0, metered: 0, input: 0, output: 0 });
        json(res, 200, { connected: false, stats, panel: panelStatus() });
      } else if (req.url === '/api/send') {
        await send(checkMessages((await readJson(req))?.messages), res);
      } else if (req.url === '/api/code/bridge/enable') {
        if (process.platform !== 'win32' || !archivoPuente) throw new HttpError(503, 'El puente requiere un panel de Windows.');
        if (!key) throw new HttpError(401, 'Conecta NVIDIA para habilitar el puente.');
        const cambio = ++cambioPuente;
        const sesion = await publicarSesionCodex(archivoPuente, server.address().port);
        if (cambio !== cambioPuente || !key || closing) {
          await borrarSesionCodex(archivoPuente, sesion).catch(() => {});
          throw new HttpError(409, 'La sesión cambió. Habilita el puente desde el panel activo.');
        }
        puente?.controller.abort();
        clearTimeout(temporizadorPuente);
        puente = { ...sesion, controller: new AbortController() };
        temporizadorPuente = setTimeout(() => void revocarPuente(), sesion.expiresAt - Date.now()).unref();
        json(res, 200, { panel: panelStatus() });
      } else if (req.url === '/api/code/bridge/disable') {
        await revocarPuente();
        json(res, 200, { panel: panelStatus() });
      } else if (req.url === '/api/code/bridge/status' && sesionExterna) {
        json(res, 200, { connected: true });
      } else if (req.url === '/api/code/route') {
        const data = await readJson(req);
        const cliente = data?.cliente ?? 'nvidia';
        if (!['nvidia', 'opencode'].includes(cliente)) throw new HttpError(400, 'Elige un cliente de código válido.');
        if (sesionExterna && cliente !== 'nvidia') throw new HttpError(403, 'El puente solo habilita NVIDIA directa.');
        const encargo = checkPrompt(data?.encargo);
        const ruta = decidirRuta({ ...data, encargo }, { temasPrivados: leerTemasPrivados() });
        if (ruta.destino !== 'nvidia') throw new HttpError(400, ruta.motivo);
        if (cliente === 'nvidia') {
          await send([{ role: 'user', content: ruta.encargo }], res, 1024, sesionExterna?.controller.signal);
        } else {
          if (!key) throw new HttpError(401, 'Conecta NVIDIA para usar OpenCode.');
          if (!openCode) throw new HttpError(503, 'El OpenCode portátil del laboratorio no está disponible.');
          const output = await panelJob(res, async signal => {
            try {
              const result = await runOpenCode({
                instalacion: openCode, prompt: ruta.encargo, signal,
                request: async (_url, options) => {
                  stats.requests++;
                  return request(ENDPOINT, {
                    method: 'POST', redirect: 'error', signal: options.signal,
                    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
                    body: options.body,
                  });
                },
              });
              actualizarUso(result.tokens);
              return result;
            } catch (error) {
              if (error.truncada) {
                actualizarUso(error.tokens);
                throw new HttpError(502, 'NVIDIA alcanzó el límite de generación. Acota el encargo antes de volver a consultar.');
              }
              if (error.status === 401) {
                key = '';
                await revocarPuente();
              }
              if ([400, 401, 402, 403, 422, 429].includes(error.status)) throw upstreamError(error.status);
              if (signal.aborted) throw error;
              throw new HttpError(502, 'OpenCode no completó la consulta. Revisa la conexión o acota el encargo.');
            }
          });
          if (output) json(res, 200, { ...output, stats });
        }
      } else if (req.url === '/api/images/connect') {
        const data = await readJson(req);
        if (active) throw new HttpError(409, 'Espera a que termine la operación actual.');
        if (!images.connect(data?.account, data?.token)) {
          throw new HttpError(400, 'Revisa el identificador de cuenta y el token de Cloudflare.');
        }
        json(res, 200, { panel: panelStatus() });
      } else if (req.url === '/api/images/run') {
        const data = await readJson(req, 1_500_000, 'La imagen de referencia es demasiado grande.');
        if (!images.connected) throw new HttpError(401, 'Conecta tu cuenta de Cloudflare para continuar.');
        const prompt = checkPrompt(data?.prompt);
        const reference = imageReference(data?.reference);
        if (reference === null) throw new HttpError(400, 'Elige una referencia PNG menor de 512 × 512 píxeles.');
        const result = await panelJob(res, signal => images.run(prompt, reference, signal));
        if (result?.status === 200) json(res, 200, result);
        else if (result) {
          const message = {
            400: 'Cloudflare rechazó la descripción o la imagen.',
            401: 'Cloudflare no aceptó el token. Vuelve a conectar la cuenta.',
            403: 'La cuenta o el token carece de acceso a Workers AI.',
            429: 'Cloudflare alcanzó un límite de uso.',
          }[result.status];
          throw new HttpError(message ? result.status : 502, message ?? 'Cloudflare no devolvió una imagen válida.');
        }
      } else if (req.url === '/api/program') {
        const data = await readJson(req);
        const prompt = checkPrompt(data?.prompt);
        if (!program) throw new HttpError(503, 'Codex no está disponible en este equipo.');
        if (data?.confirmed !== true) throw new HttpError(400, 'Confirma el uso de tu cuenta de Codex.');
        const result = await panelJob(res, signal => program(prompt, signal));
        if (result) json(res, 200, result);
      } else {
        throw new HttpError(404, 'Ruta desconocida.');
      }
    } catch (error) {
      if (!res.destroyed) {
        const status = error instanceof HttpError ? error.status : 500;
        json(res, status, { error: status === 500 ? 'El chat no pudo procesar la solicitud.' : error.message, stats });
      }
    }
  });

  function checkPrompt(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 16_000) {
      throw new HttpError(400, 'Escribe una instrucción de hasta 16.000 caracteres.');
    }
    return text.trim();
  }

  async function panelJob(res, work) {
    if (active) throw new HttpError(409, 'Espera a que termine la operación actual.');
    if (res.destroyed) return;
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    active = controller;
    res.once('close', () => controller.abort());
    const start = performance.now();
    try {
      const data = await work(signal);
      if (!res.destroyed) return { ...data, seconds: (performance.now() - start) / 1000 };
    } catch (error) {
      if (!res.destroyed) {
        if (error instanceof HttpError && !timeout.aborted) throw error;
        throw new HttpError(timeout.aborted ? 504 : 502,
          timeout.aborted ? 'El proveedor superó el tiempo de espera.' : 'La operación se interrumpió. Revisa tu conexión o la sesión del proveedor.');
      }
    } finally {
      active = null;
    }
  }

  function actualizarUso(uso) {
    if (!uso) return;
    stats.metered++;
    stats.input += uso.input;
    stats.output += uso.output;
  }

  async function send(messages, res, maxTokens = 8192, sesionSignal) {
    if (!key) throw new HttpError(401, 'Introduce tu clave NVIDIA para continuar.');
    if (active) throw new HttpError(409, 'Espera a que termine la respuesta actual.');
    if (res.destroyed) return;

    const controller = new AbortController();
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    active = controller;
    res.once('close', () => controller.abort());
    const signal = AbortSignal.any([deadline, controller.signal, ...(sesionSignal ? [sesionSignal] : [])]);
    const start = performance.now();
    let usage = null;
    let finish = null;
    let hasText = false;
    let completed = false;
    let headroom = null;
    const push = part => { if (!res.destroyed) res.write(JSON.stringify(part) + '\n'); };

    try {
      signal.throwIfAborted();
      const compresion = await compresor.comprimir(messages);
      if (compresion.aplicado) {
        messages = compresion.messages;
        headroom = { antes: compresion.antes, despues: compresion.despues };
      }
      signal.throwIfAborted();
      stats.requests++;
      const upstream = await request(ENDPOINT, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'system', content: 'Responde en el idioma de la persona. Da respuestas claras y concisas, y usa Markdown cuando ayude.' }, ...messages],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxTokens,
          reasoning_effort: 'none',
          chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true },
        }),
      });
      if (!upstream.ok || upstream.status !== 200) {
        await upstream.body?.cancel();
        if (upstream.status === 401) {
          key = '';
          await revocarPuente();
        }
        throw upstreamError(upstream.status);
      }

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      for await (const part of completionParts(upstream)) {
        if (part === '[DONE]') {
          completed = true;
          break;
        }
        if (part.error) throw new HttpError(502, 'NVIDIA interrumpió la respuesta.');
        usage = usageFrom(part.usage) ?? usage;
        const choice = part.choices?.[0];
        const content = choice?.delta?.content ?? choice?.message?.content;
        finish = choice?.finish_reason ?? finish;
        if (typeof content === 'string' && content) {
          hasText ||= Boolean(content.trim());
          push({ text: content });
        }
      }
      if (!completed && !finish) throw new HttpError(502, 'La conexión se cerró antes de completar la respuesta.');
      if (!hasText) throw new HttpError(502, 'NVIDIA no devolvió una respuesta de texto.');
    } catch (error) {
      if (!res.destroyed) {
        const failure = error instanceof HttpError ? error : new HttpError(
          deadline.aborted ? 504 : 502,
          deadline.aborted ? 'NVIDIA superó el tiempo de espera.' : 'La conexión con NVIDIA se interrumpió.',
        );
        if (res.headersSent) {
          push({ error: failure.message });
          res.end();
        } else {
          throw failure;
        }
      }
      return;
    } finally {
      actualizarUso(usage);
      active = null;
    }
    push({ done: true, usage, stats, finish, seconds: (performance.now() - start) / 1000, ...(headroom ? { headroom } : {}) });
    res.end();
  }

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const host = '127.0.0.1:' + server.address().port;
  const origin = 'http://' + host;
  const idle = setInterval(() => {
    if (!active && Date.now() - lastSeen > 600_000) close();
  }, 10_000);
  let closing;
  function close() {
    if (closing) return closing;
    key = '';
    compresor.cerrar();
    images.clear();
    active?.abort();
    firstRequest(false);
    clearInterval(idle);
    clearTimeout(shutdownTimer);
    closing = Promise.all([new Promise(done => server.close(done)), revocarPuente()]);
    server.closeAllConnections();
    return closing;
  }
  return { origin, token, ready, close, closed: new Promise(done => server.once('close', done)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const edgePath = process.argv[2];
  if (!edgePath) throw new Error('Falta la ruta de Microsoft Edge.');
  const codex = [process.argv[3], process.env.CODEX_APP_RUNTIME_CLI_PATH]
    .find(path => path && isAbsolute(path) && existsSync(path));
  let work;
  let profile;
  let startup;
  let app;
  try {
    profile = mkdtempSync(join(tmpdir(), 'ia-lab-chat-'));
    if (codex) work = mkdtempSync(join(tmpdir(), 'ia-lab-codex-'));
    app = await iniciarChat({ program: codex ? (prompt, signal) => runCodex(codex, prompt, work, signal) : null });
    const edge = spawn(edgePath, [
      '--user-data-dir=' + profile,
      '--inprivate', '--disable-sync', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      '--app=' + app.origin + '/#' + app.token,
    ], { stdio: 'ignore', detached: true });
    edge.once('error', () => { process.exitCode = 1; void app.close(); });
    edge.unref();
    startup = setTimeout(() => { process.exitCode = 1; void app.close(); }, 20_000);
    await app.ready;
    clearTimeout(startup);
    await app.closed;
  } finally {
    clearTimeout(startup);
    await app?.close();
    if (work) {
      try { rmSync(work, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); } catch {
        // Windows can briefly retain process handles when a request is cancelled.
      }
    }
    if (profile) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); } catch {
        // Edge can briefly retain its own temporary files as the window closes.
      }
    }
  }
}
