import { Agent, request } from 'node:http';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { decidirRuta } from './ruta-codigo.js';
import { leerTemasPrivados } from './temas-privados.mjs';
import { leerSesionCodex, rutaSesionCodex } from './sesion-codex.mjs';

const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const offline = 'Abre IA Lab PC, conecta NVIDIA y activa la conexión con Codex.';
const requestedFields = ['encargo', 'alcance', 'datos', 'prueba'];
const tools = [
  {
    name: 'estado_nvidia',
    description: 'Comprueba si hay una sesión de IA Lab PC enlazada a Codex, sin consultar a un modelo.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'consultar_codigo',
    description: 'Envía una sola función o archivo sintético y verificable a NVIDIA mediante el panel local de IA Lab PC. La salida requiere verificación.',
    inputSchema: {
      type: 'object',
      properties: {
        encargo: { type: 'string', minLength: 1, maxLength: 16000 },
        alcance: { type: 'string', enum: ['aislado'] },
        datos: { type: 'string', enum: ['ficticios'] },
        prueba: { type: 'string', minLength: 8, maxLength: 500 },
      },
      required: requestedFields,
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

const unavailableStatuses = new Set([401, 403, 404]);
const requestErrors = new Map([
  [400, 'El panel rechazó el encargo o el criterio de aceptación.'],
  [402, 'NVIDIA no tiene cupo disponible para esta consulta.'],
  [409, 'El panel está atendiendo otra consulta.'],
  [422, 'NVIDIA rechazó el formato de la consulta.'],
  [429, 'NVIDIA alcanzó un límite de uso.'],
  [504, 'NVIDIA tardó demasiado en responder.'],
]);

async function post(session, path, payload, timeout, signal) {
  const body = JSON.stringify(payload);
  const agent = new Agent();
  try {
    const response = await new Promise((done, fail) => {
      const deadline = AbortSignal.timeout(timeout);
      const req = request({
        host: '127.0.0.1', port: session.port, path, method: 'POST', agent,
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: {
          Authorization: 'Bearer ' + session.token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, done);
      req.once('error', fail);
      req.end(body);
    });
    const { statusCode: status, headers } = response;
    if (status !== 200) {
      response.destroy();
      return { status };
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 128 * 1024) throw new Error('Response limit');
      chunks.push(chunk);
    }
    return { status, contentType: headers['content-type'], text: Buffer.concat(chunks).toString('utf8') };
  } finally {
    agent.destroy();
  }
}

function result(data, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], ...(isError && { isError: true }) };
}

function codeResult(text) {
  let answer = '';
  let final;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const part = JSON.parse(line);
    if (part?.error || final) throw new Error('Invalid completion');
    if (typeof part?.text === 'string') answer += part.text;
    if (part?.done === true) final = part;
  }
  if (final?.finish === 'length') {
    return result({ message: 'NVIDIA alcanzó el límite de generación. Acota el encargo.' }, true);
  }
  if (!final || !answer.trim() || !Number.isFinite(final.seconds) || final.seconds < 0) {
    throw new Error('Incomplete completion');
  }
  const { input, output } = final.usage ?? {};
  const usage = [input, output].every(n => Number.isSafeInteger(n) && n >= 0) ? { input, output } : null;
  return result({ answer, usage, seconds: final.seconds, provider: 'nvidia', review: true });
}

export function createToolCaller(path = rutaSesionCodex(), requestLocal = post) {
  return async (name, args, signal) => {
    const consult = name === 'consultar_codigo';
    if (consult) {
      if (!args || typeof args !== 'object' || Object.keys(args).some(key => !requestedFields.includes(key)) ||
          typeof args.encargo !== 'string' || args.encargo.length > 16_000 ||
          typeof args.prueba !== 'string' || args.prueba.length > 500) {
        return result({ message: 'Envía solo el encargo, el alcance, los datos y la comprobación.' }, true);
      }
      const decision = decidirRuta(args, { temasPrivados: leerTemasPrivados() });
      if (decision.destino !== 'nvidia') return result({ message: decision.motivo }, true);
    }

    const session = await leerSesionCodex(path);
    if (!session || session.expiresAt <= Date.now()) {
      return consult ? result({ message: offline }, true) : result({ connected: false, message: offline });
    }

    try {
      if (!consult) {
        const status = await requestLocal(session, '/api/code/bridge/status', {}, 3000, signal);
        if (status.status === 200 && JSON.parse(status.text).connected === true) return result({ connected: true });
        return result({ connected: false, message: offline });
      }
      const response = await requestLocal(session, '/api/code/route', { ...args, cliente: 'nvidia' }, 125_000, signal);
      if (response.status !== 200) {
        const message = unavailableStatuses.has(response.status) ? offline :
          requestErrors.get(response.status) ?? 'La consulta de IA Lab PC se interrumpió.';
        return result({ message }, true);
      }
      if (!/^application\/x-ndjson(?:;|$)/i.test(response.contentType ?? '')) throw new Error('Invalid completion type');
      return codeResult(response.text);
    } catch {
      return consult ? result({ message: 'La consulta de IA Lab PC se interrumpió. Comprueba el estado del panel.' }, true) :
        result({ connected: false, message: offline });
    }
  };
}

async function serve() {
  const call = createToolCaller();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  const pending = new Map();
  let initialized = false;
  const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const error = (id, code, message) => send({ id, error: { code, message } });

  try {
    for await (const line of input) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        error(null, -32700, 'Parse error');
        continue;
      }
      const { jsonrpc, id, method, params } = parsed ?? {};
      if (jsonrpc !== '2.0' || typeof method !== 'string' ||
          (id !== undefined && typeof id !== 'string' && !Number.isSafeInteger(id))) {
        error(null, -32600, 'Invalid request');
        continue;
      }
      if (id === undefined) {
        if (method === 'notifications/cancelled') pending.get(params?.requestId)?.abort();
        continue;
      }
      if (method === 'initialize' && !initialized) {
        initialized = true;
        const protocolVersion = protocolVersions.includes(params?.protocolVersion) ? params.protocolVersion : protocolVersions[0];
        send({ id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'ia_lab_nvidia', version: '1.0.0' } } });
      } else if (method === 'ping') {
        send({ id, result: {} });
      } else if (!initialized) {
        error(id, -32002, 'Server not initialized');
      } else if (method === 'tools/list') {
        send({ id, result: { tools } });
      } else if (method === 'tools/call') {
        if (!tools.some(tool => tool.name === params?.name)) {
          error(id, -32602, 'Unknown tool');
          continue;
        }
        if (pending.has(id)) continue;
        const controller = new AbortController();
        pending.set(id, controller);
        const reply = data => { if (!controller.signal.aborted) send({ id, result: data }); };
        void call(params.name, params.arguments, controller.signal)
          .then(reply, () => reply(result({ message: 'IA Lab PC no pudo completar la operación.' }, true)))
          .finally(() => pending.delete(id));
      } else {
        error(id, -32601, 'Method not found');
      }
    }
  } finally {
    for (const controller of pending.values()) controller.abort();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await serve();
}
