import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const modelo = 'nvidia/nemotron-3-ultra-550b-a55b';
const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
const ruta = '/v1/chat/completions';
const salidaMax = 1024;

function archivoLocal(path) {
  try {
    if (!isAbsolute(path) || !lstatSync(path).isFile()) return false;
    for (let item = path; item !== dirname(item); item = dirname(item)) {
      if (lstatSync(item).isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function resolverOpenCode() {
  if (process.platform !== 'win32') return null;
  const administrado = join(process.env.ProgramData || 'C:\\ProgramData', 'opencode');
  if (existsSync(administrado)) return null;
  const lab = fileURLToPath(new URL('..', import.meta.url));
  const executable = join(lab, '.local', 'opencode', '2.2.7', 'opencode.exe');
  const limitsPlugin = join(lab, 'scripts', 'limites-opencode.mjs');
  return archivoLocal(executable) && archivoLocal(limitsPlugin) ? { executable, limitsPlugin } : null;
}

function crearConfiguracion(baseURL) {
  return {
    model: 'ia-nvidia/ultra', update: 'disable', warming: false, snapshots: false,
    compaction: { auto: false }, plugins: ['./limites'],
    agents: { build: { steps: 2 }, title: { disabled: true }, summary: { disabled: true } },
    permissions: [{ action: '*', resource: '*', effect: 'deny' }],
    policies: [
      { action: 'provider.use', resource: '*', effect: 'deny' },
      { action: 'provider.use', resource: 'ia-nvidia', effect: 'allow' },
    ],
    providers: {
      'ia-nvidia': {
        name: 'NVIDIA IA Lab', env: ['NVIDIA_API_KEY'], package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL, transport: 'http', timeout: 45000, encoding: 'none' },
        models: { ultra: {
          name: 'Nemotron Ultra', modelID: modelo,
          capabilities: { tools: false, input: ['text'], output: ['text'] },
          compatibility: { maxTokensField: 'max_tokens' },
          limit: { context: 32768, output: salidaMax },
          body: { reasoning_effort: 'none', max_tokens: salidaMax,
            chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true } },
        } },
      },
    },
  };
}

async function entornoAislado(work, baseURL, token, limitsPlugin) {
  const env = {};
  for (const key of ['SystemRoot', 'windir', 'SystemDrive', 'ComSpec', 'ProgramData',
    'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'OS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PATH = [join(env.SystemRoot || 'C:\\Windows', 'System32'), dirname(process.execPath)].join(';');
  const dirs = {
    USERPROFILE: 'home', XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data',
    XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state', TEMP: 'tmp',
    APPDATA: 'roaming', LOCALAPPDATA: 'local',
  };
  await Promise.all(Object.entries(dirs).map(async ([key, folder]) => {
    env[key] = join(work, folder);
    await mkdir(env[key]);
  }));
  Object.assign(env, {
    HOME: env.USERPROFILE, TMP: env.TEMP, OPENCODE_TEST_HOME: env.USERPROFILE,
    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DB: ':memory:',
    IA_LAB_MODO: 'Mensaje', IA_LAB_DESTINO: baseURL + '/chat/completions',
    IA_LAB_CONSUMO: join(work, 'consumo.json'), IA_LAB_ESTADO_HTTP: join(work, 'estado-http.txt'),
    NVIDIA_API_KEY: token,
  });
  const conf = join(env.XDG_CONFIG_HOME, 'opencode');
  const plugin = join(conf, 'limites');
  await mkdir(plugin, { recursive: true });
  await Promise.all([
    copyFile(limitsPlugin, join(plugin, 'index.js')),
    writeFile(join(conf, 'opencode.json'), JSON.stringify(crearConfiguracion(baseURL))),
    writeFile(join(conf, 'cli.json'), '{"highlights":false}'),
  ]);
  return env;
}

function escuchar(server) {
  return new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
}

async function verificarSolicitud(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64_000) throw new Error('Entrada de OpenCode demasiado larga.');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (body?.model !== modelo || !Array.isArray(body.messages)) throw new Error('Formato inesperado de OpenCode.');
}

async function consultaHija(executable, cwd, env, prompt, signal) {
  const args = ['run', '--standalone', '--model', 'ia-nvidia/ultra', '--agent', 'build', '--format', 'json'];
  const child = spawn(executable, args, { cwd, env, windowsHide: true, signal, stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdin.on('error', () => {});
  const exit = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let answer = '';
  lines.on('line', line => {
    if (!line.startsWith('{')) return;
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && typeof event.part?.text === 'string') answer += event.part.text;
    } catch { /* OpenCode can also emit client diagnostics on stdout. */ }
  });
  child.stdin.end(prompt);
  const code = await exit;
  if (code !== 0 || !answer.trim()) throw new Error('OpenCode terminó sin una respuesta utilizable.');
  return answer;
}

async function leerUso(work) {
  try {
    const { entrada: input, salida: output, pasosConUso } =
      JSON.parse(await readFile(join(work, 'consumo.json'), 'utf8'));
    if (pasosConUso === 1 && [input, output].every(x => Number.isSafeInteger(x) && x >= 0)) return { input, output };
  } catch { /* El proveedor puede no informar tokens. */ }
  return null;
}

function inspeccionarSSE(onPart) {
  const decoder = new TextDecoder();
  let pending = '';
  const inspect = event => {
    if (event.length > 64_000) throw new Error('Evento de NVIDIA demasiado largo.');
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (data && data !== '[DONE]') onPart(JSON.parse(data));
  };
  return new Transform({
    transform(bytes, _encoding, next) {
      try {
        pending += decoder.decode(bytes, { stream: true });
        let separator;
        while ((separator = /\r?\n\r?\n/.exec(pending))) {
          inspect(pending.slice(0, separator.index));
          pending = pending.slice(separator.index + separator[0].length);
        }
        if (pending.length > 64_000) throw new Error('Evento de NVIDIA demasiado largo.');
        next(null, bytes);
      } catch (error) {
        next(error);
      }
    },
    flush(next) {
      try {
        inspect(pending + decoder.decode());
        next();
      } catch (error) {
        next(error);
      }
    },
  });
}

export async function runOpenCode({ instalacion, prompt, request, signal }) {
  const deadline = AbortSignal.timeout(60_000);
  const controller = new AbortController();
  const workSignal = AbortSignal.any([deadline, controller.signal, ...(signal ? [signal] : [])]);
  const work = await mkdtemp(join(tmpdir(), 'ia-lab-opencode-'));
  const token = randomBytes(24).toString('hex');
  let origin;
  let requests = 0;
  let status;
  let occupied = false;
  let truncada = false;
  let tokens = null;
  const relay = createServer(async (req, res) => {
    if (req.url !== ruta || req.method !== 'POST' || req.headers.host !== new URL(origin).host ||
        req.headers.authorization !== 'Bearer ' + token) {
      res.writeHead(403).end();
      return;
    }
    if (occupied) {
      res.writeHead(429).end();
      return;
    }
    occupied = true;
    try {
      await verificarSolicitud(req);
      workSignal.throwIfAborted();
      requests++;
      const response = await request(endpoint, {
        method: 'POST', redirect: 'error', signal: workSignal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelo,
          messages: [
            { role: 'system', content: 'Responde directamente al mensaje. Usa el idioma de la persona.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: salidaMax, stream: true, stream_options: { include_usage: true },
          reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true },
        }),
      });
      status = response.status;
      const type = response.headers.get('content-type') || 'application/json';
      res.writeHead(status, { 'Content-Type': type });
      if (!response.body) {
        res.end();
        return;
      }
      const inputStream = Readable.fromWeb(response.body);
      if (status === 200 && type.includes('text/event-stream')) {
        await pipeline(inputStream, inspeccionarSSE(part => {
          truncada ||= part?.choices?.[0]?.finish_reason === 'length';
          const input = part?.usage?.prompt_tokens;
          const output = part?.usage?.completion_tokens;
          if ([input, output].every(n => Number.isSafeInteger(n) && n >= 0)) tokens = { input, output };
        }), res);
      } else {
        await pipeline(inputStream, res);
      }
    } catch {
      if (!res.headersSent && !res.destroyed) res.writeHead(502).end();
      else res.destroy();
    }
  });
  try {
    await escuchar(relay);
    origin = 'http://127.0.0.1:' + relay.address().port;
    const env = await entornoAislado(work, origin + '/v1', token, instalacion.limitsPlugin);
    const cwd = join(work, 'trabajo');
    await mkdir(cwd);
    const answer = await consultaHija(instalacion.executable, cwd, env, prompt, workSignal);
    if (truncada || requests !== 1 || status !== 200) throw new Error('La solicitud de OpenCode no se completó.');
    return { answer, tokens: tokens ?? await leerUso(work), requests };
  } catch (error) {
    throw Object.assign(error, {
      requests, ...(status != null ? { status } : {}),
      ...(truncada ? { truncada, tokens: tokens ?? await leerUso(work) } : {}),
    });
  } finally {
    controller.abort();
    relay.close();
    relay.closeAllConnections();
    const checked = resolve(work);
    if (dirname(checked) === resolve(tmpdir()) && parse(checked).base.startsWith('ia-lab-opencode-') &&
        checked.startsWith(resolve(tmpdir()) + sep)) {
      await rm(checked, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    }
  }
}
