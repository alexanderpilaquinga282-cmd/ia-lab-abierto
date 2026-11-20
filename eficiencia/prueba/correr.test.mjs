import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { correr, endpoint, promptSistema } from '../correr.mjs';
import { casos } from '../banco/casos.mjs';
import { casosLargos } from '../casos-largos.mjs';
import { agregar, veredicto } from '../resumir.mjs';

const respuestas = JSON.parse(await readFile(new URL('respuestas-codex.json', import.meta.url), 'utf8'));
const recibidos = [];
let servidor;
let url;

before(async () => {
  servidor = createServer(async (req, res) => {
    let cuerpo = '';
    for await (const d of req) cuerpo += d;
    const body = JSON.parse(cuerpo);
    if (req.url.includes('/rechazo/')) { recibidos.push({ body }); res.statusCode = 403; return res.end('{"detail":"Authorization failed"}'); }
    recibidos.push({ auth: req.headers.authorization, body });
    const usuario = body.messages.find(m => m.role === 'user').content;
    const caso = casos.find(c => c.prompt === usuario);
    const largo = casosLargos.find(c => c.pregunta === usuario);
    const texto = caso ? respuestas.find(r => r.id === caso.id).answer : JSON.stringify(largo.esperado);
    const entrada = JSON.stringify(body.messages).length;
    res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: texto }, finish_reason: 'stop' }], usage: { prompt_tokens: entrada, completion_tokens: texto.length } }));
  });
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${servidor.address().port}/v1/chat/completions`;
});
after(() => servidor.close());

const env = () => ({ ...process.env, NVIDIA_API_KEY: 'clave-de-prueba', EFICIENCIA_ENDPOINT: url,
  EFICIENCIA_COMPRESOR: JSON.stringify([process.execPath, 'prueba/compresor-falso.mjs']) });

test('el endpoint solo acepta NVIDIA o localhost', () => {
  assert.equal(endpoint({}), 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.throws(() => endpoint({ EFICIENCIA_ENDPOINT: 'https://api.openai.com/v1/chat/completions' }));
  assert.throws(() => endpoint({ EFICIENCIA_ENDPOINT: 'https://127.0.0.1.evil.com/v1' }));
});

test('ponytail-sin-cierre quita solo la frase de cierre', async () => {
  const completo = await promptSistema('ponytail');
  const sinCierre = await promptSistema('ponytail-sin-cierre');
  assert.match(completo, /End your reply with one or two lines/);
  assert.doesNotMatch(sinCierre, /End your reply/);
  assert.equal(completo.length - sinCierre.length, 106);
  assert.equal(await promptSistema('base'), null);
});

test('los casos largos son deterministas y grandes', async () => {
  const otra = await import('../casos-largos.mjs?otra');
  assert.deepEqual(otra.casosLargos.map(c => c.esperado), casosLargos.map(c => c.esperado));
  for (const c of casosLargos) assert.ok(c.datos.length > 10_000, c.id);
});

test('base corre las 9 tareas, verifica y no guarda la clave', async () => {
  const r = await correr({ variante: 'base', repeticiones: 1, pausaMs: 0, env: env(), log: () => {} });
  assert.equal(r.filas.length, 9);
  assert.ok(r.filas.every(f => f.aprobada), JSON.stringify(r.filas.filter(f => !f.aprobada)));
  assert.doesNotMatch(JSON.stringify(r), /clave-de-prueba/);
  assert.equal(recibidos.at(-1).auth, 'Bearer clave-de-prueba');
  assert.equal(recibidos.at(-1).body.tool_choice, 'none');
});

test('ponytail envía el SKILL.md como prompt de sistema', async () => {
  recibidos.length = 0;
  await correr({ variante: 'ponytail', bateria: 'codigo', repeticiones: 1, pausaMs: 0, env: env(), log: () => {} });
  assert.equal(recibidos.length, 6);
  assert.ok(recibidos.every(r => r.body.messages[0].role === 'system' && r.body.messages[0].content.startsWith('# Ponytail')));
});

test('headroom comprime sin ver la clave y el veredicto se calcula', async () => {
  const base = await correr({ variante: 'base', bateria: 'largos', repeticiones: 1, pausaMs: 0, env: env(), log: () => {} });
  const hr = await correr({ variante: 'headroom', bateria: 'largos', repeticiones: 1, pausaMs: 0, env: env(), log: () => {} });
  assert.ok(hr.filas.every(f => f.compresion.despues < f.compresion.antes));
  assert.ok(agregar(hr, 'largo').entrada < agregar(base, 'largo').entrada);
  const v = veredicto('headroom', base, hr);
  assert.equal(v.aceptada, true, v.motivo);
});

test('una clave rechazada detiene la corrida en la primera consulta', async () => {
  recibidos.length = 0;
  const e = await correr({ variante: 'base', bateria: 'codigo', repeticiones: 3, pausaMs: 0,
    env: { ...env(), EFICIENCIA_ENDPOINT: url.replace('/v1/', '/rechazo/') }, log: () => {} }).catch(e => e);
  assert.match(e.message, /HTTP 403/);
  assert.equal(recibidos.length, 1);
});
