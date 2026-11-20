import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createToolCaller } from './mcp-codex.mjs';

const encargo = {
  encargo: 'Devuelve una función que suma dos números.',
  alcance: 'aislado',
  datos: 'ficticios',
  prueba: 'sumar(10, 5) devuelve 15.',
};
const capability = '0'.repeat(64);
const payload = value => JSON.parse(value.content[0].text);

async function descriptor(t, expiresAt = Date.now() + 60_000) {
  const root = await mkdtemp(join(tmpdir(), 'ia-lab-mcp-test-'));
  const file = join(root, 'puente.json');
  await writeFile(file, JSON.stringify({ port: 39_681, token: capability, expiresAt }));
  t.after(async () => {
    await unlink(file);
    await rmdir(root);
  });
  return file;
}

test('un descriptor ausente o vencido devuelve un estado seguro sin red', async t => {
  const expired = await descriptor(t, Date.now() - 1000);
  let calls = 0;
  for (const file of [null, expired]) {
    const call = createToolCaller(file, () => { calls++; });
    assert.equal(payload(await call('estado_nvidia')).connected, false);
    assert.equal((await call('consultar_codigo', encargo)).isError, true);
  }
  assert.equal(calls, 0);
});

test('rechaza datos reales, entradas adicionales, asuntos excluidos y alcance múltiple antes de la red', async t => {
  let calls = 0;
  const call = createToolCaller(await descriptor(t), () => { calls++; });
  for (const extra of [{ datos: 'reales' }, { ruta: '../cliente' }, { encargo: 'Edita las credenciales de la app.' },
    { alcance: 'multiarchivo' }, { prueba: 'ok' }]) {
    assert.equal((await call('consultar_codigo', { ...encargo, ...extra })).isError, true);
  }
  assert.equal(calls, 0);
});

test('estado comprueba el endpoint de estado y solo devuelve si el puente está conectado', async t => {
  let calls = 0;
  const call = createToolCaller(await descriptor(t), (session, endpoint, args) => {
    calls++;
    assert.equal(session.port, 39_681);
    assert.equal(endpoint, '/api/code/bridge/status');
    assert.deepEqual(args, {});
    return { status: 200, text: '{"connected":true}' };
  });
  const data = await call('estado_nvidia');
  assert.deepEqual(payload(data), { connected: true });
  assert.ok(!JSON.stringify(data).includes(capability));
  assert.equal(calls, 1);
});

test('consulta NVIDIA una vez y reúne el texto, el uso y la duración de NDJSON', async t => {
  let calls = 0;
  const call = createToolCaller(await descriptor(t), (_session, endpoint, args) => {
    calls++;
    assert.equal(endpoint, '/api/code/route');
    assert.deepEqual(args, { ...encargo, cliente: 'nvidia' });
    return {
      status: 200,
      contentType: 'application/x-ndjson; charset=utf-8',
      text: '{"text":"Una "}\n{"text":"función."}\n{"done":true,"usage":{"input":30,"output":6},"finish":"stop","seconds":0.8}\n',
    };
  });
  const data = await call('consultar_codigo', encargo);
  assert.equal(data.isError, undefined);
  assert.deepEqual(payload(data), {
    answer: 'Una función.', usage: { input: 30, output: 6 }, seconds: 0.8, provider: 'nvidia', review: true,
  });
  assert.equal(calls, 1);
});

test('rate limit y NDJSON incompleto o truncado devuelven error sin reintentar ni incluir texto parcial', async t => {
  const file = await descriptor(t);
  for (const response of [
    { status: 429 },
    { status: 200, contentType: 'application/x-ndjson', text: '{"text":"parcial"}\n' },
    { status: 200, contentType: 'application/x-ndjson', text: '{"text":"parcial"}\n{"done":true,"finish":"length","seconds":1}\n' },
  ]) {
    let calls = 0;
    const call = createToolCaller(file, () => { calls++; return response; });
    const data = await call('consultar_codigo', encargo);
    assert.equal(data.isError, true);
    assert.equal(payload(data).answer, undefined);
    assert.equal(calls, 1);
  }
});
