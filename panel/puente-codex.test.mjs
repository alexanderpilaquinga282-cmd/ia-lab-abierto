import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { iniciarChat } from './servidor.mjs';
import { leerSesionCodex } from './sesion-codex.mjs';

const fixture = {
  encargo: 'Escribe una función de JavaScript para validar un código ficticio.',
  alcance: 'aislado', datos: 'ficticios', prueba: 'validar("B2") devuelve true.',
};
const claveSimulada = 'nvidia-fixture-sin-credenciales';

function post(app, path, { cap, body = {}, externa = false, origin } = {}) {
  const headers = {
    Authorization: 'Bearer ' + (cap ?? app.token),
    'Content-Type': 'application/json',
  };
  if (!externa || origin) headers.Origin = origin ?? app.origin;
  return fetch(app.origin + '/api/' + path, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

async function banco(t, request) {
  const raiz = resolve(tmpdir());
  const carpeta = await mkdtemp(join(raiz, 'ia-lab-codex-test-'));
  const archivo = join(carpeta, 'puente-codex.json');
  const apps = [];
  t.after(async () => {
    await Promise.all(apps.map(app => app.close()));
    if (dirname(carpeta) === raiz) await rm(carpeta, { recursive: true, force: true });
  });
  return {
    archivo,
    async abrir() {
      const app = await iniciarChat({ archivoPuente: archivo, request });
      apps.push(app);
      return app;
    },
  };
}

async function habilitar(app, archivo) {
  assert.equal((await post(app, 'connect', { body: { key: claveSimulada } })).status, 200);
  const antes = Date.now();
  const response = await post(app, 'code/bridge/enable');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).panel.bridge, true);
  const sesion = await leerSesionCodex(archivo);
  assert.deepEqual(Object.keys(sesion).sort(), ['expiresAt', 'port', 'token']);
  assert.notEqual(sesion.token, app.token);
  assert.equal(sesion.port, Number(new URL(app.origin).port));
  assert.ok(sesion.expiresAt >= antes + 30 * 60_000 && sesion.expiresAt <= Date.now() + 30 * 60_000);
  return sesion.token;
}

// El puente guarda su sesión en %LOCALAPPDATA%: solo existe en Windows.
const soloWindows = { skip: process.platform !== 'win32' && 'el puente con Codex solo funciona en Windows' };

test('el puente requiere conectar y habilitar, limita la capacidad y cuenta solo la solicitud elegible', soloWindows, async t => {
  const solicitudes = [];
  const { abrir, archivo } = await banco(t, async (url, options) => {
    solicitudes.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json({
      choices: [{ message: { content: 'const validar = () => true;' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 14, completion_tokens: 8 },
    });
  });
  const app = await abrir();
  assert.equal((await post(app, 'code/bridge/enable')).status, 401);
  assert.equal(await leerSesionCodex(archivo), null);
  const cap = await habilitar(app, archivo);
  const externa = { cap, externa: true };
  const status = await post(app, 'code/bridge/status', externa);
  assert.deepEqual(await status.json(), { connected: true });
  for (const [path, opts, codigo] of [
    ['code/bridge/status', { ...externa, cap: 'a'.repeat(64) }, 403],
    ['code/bridge/status', { ...externa, origin: 'https://example.test' }, 403],
    ['code/bridge/status', { ...externa, cap: app.token }, 403],
    ['program', { ...externa, body: { confirmed: true, prompt: fixture.encargo } }, 403],
    ['connect', { ...externa, body: { key: claveSimulada } }, 403],
    ['code/bridge/enable', externa, 403],
    ['code/bridge/disable', externa, 403],
    ['code/route', { ...externa, body: { ...fixture, cliente: 'opencode' } }, 403],
    ['code/route', { ...externa, body: { ...fixture, alcance: 'multiarchivo' } }, 400],
    ['code/route', { ...externa, body: { ...fixture, datos: 'reales' } }, 400],
  ]) {
    assert.equal((await post(app, path, opts)).status, codigo, path);
  }
  assert.equal(solicitudes.length, 0);
  const envio = await post(app, 'code/route', { ...externa, body: fixture });
  const bloques = (await envio.text()).trim().split('\n').map(linea => JSON.parse(linea));
  assert.equal(bloques[0].text, 'const validar = () => true;');
  assert.deepEqual(bloques[1].stats, { requests: 1, metered: 1, input: 14, output: 8 });
  assert.equal(solicitudes.length, 1);
  assert.equal(solicitudes[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(solicitudes[0].body.max_tokens, 1024);
  assert.match(solicitudes[0].body.messages[1].content, /validar\("B2"\) devuelve true/);
  assert.equal((await post(app, 'code/bridge/disable')).status, 200);
  assert.equal((await post(app, 'code/bridge/status', externa)).status, 403);
  assert.equal(await leerSesionCodex(archivo), null);
});

test('la sesión más reciente sustituye la anterior sin que el cierre borre la publicada por otro panel', soloWindows, async t => {
  const { abrir, archivo } = await banco(t, () => { throw Error('Consulta inesperada'); });
  const primero = await abrir();
  const segundo = await abrir();
  const antiguo = await habilitar(primero, archivo);
  const nuevo = await habilitar(segundo, archivo);
  assert.notEqual(antiguo, nuevo);
  assert.equal((await post(primero, 'code/bridge/status', { cap: antiguo, externa: true })).status, 403);
  await primero.close();
  assert.equal((await leerSesionCodex(archivo)).token, nuevo);
  assert.equal((await post(segundo, 'code/bridge/status', { cap: nuevo, externa: true })).status, 200);
  await segundo.close();
  assert.equal(await leerSesionCodex(archivo), null);
});

test('un 429 no reintenta y un 401 revoca el puente', soloWindows, async t => {
  let intentos = 0;
  const { abrir, archivo } = await banco(t, async () => {
    intentos++;
    return new Response(null, { status: intentos === 1 ? 429 : 401 });
  });
  const app = await abrir();
  const cap = await habilitar(app, archivo);
  const datos = { cap, externa: true, body: fixture };
  assert.equal((await post(app, 'code/route', datos)).status, 429);
  assert.equal(intentos, 1);
  assert.equal((await post(app, 'code/route', datos)).status, 401);
  assert.equal(intentos, 2);
  assert.equal(await leerSesionCodex(archivo), null);
  assert.equal((await post(app, 'code/bridge/status', datos)).status, 403);
});
