import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearCompresor } from './headroom.mjs';
import { iniciarChat } from './servidor.mjs';

const python = process.env.HEADROOM_PYTHON_PRUEBA;
const log = Array.from({ length: 1500 }, (_, i) => `2026-11-18T10:00:${String(i % 60).padStart(2, '0')}Z INFO svc=demo req=r-${10000 + i} GET /items/${i % 97} 200 ${i % 40}ms`);
log[777] = '2026-11-18T10:12:57Z ERROR svc=pagos req=r-10777 codigo=E-4583 msg="dato ficticio"';
const pregunta = '¿Qué código tiene la línea ERROR de este log?';
const mensajes = [{ role: 'user', content: pregunta + '\n\n' + log.join('\n') }];

test('mensajes cortos no se tocan ni lanzan Python', async () => {
  let lanzado = false;
  const c = crearCompresor({ python: 'python', lanzar: () => { lanzado = true; } });
  const r = await c.comprimir([{ role: 'user', content: 'hola' }]);
  assert.equal(r.aplicado, false);
  assert.equal(lanzado, false);
});

test('si Python no existe, el panel sigue sin comprimir', async () => {
  const c = crearCompresor({ python: '/no/existe/python', esperaMs: 3000 });
  const r = await c.comprimir(mensajes);
  assert.equal(r.aplicado, false);
  assert.equal(r.messages, mensajes);
});

test('Headroom real comprime, conserva la pregunta y el ERROR', { skip: !python }, async () => {
  const c = crearCompresor({ python });
  try {
    const r = await c.comprimir(mensajes);
    assert.equal(r.aplicado, true);
    assert.ok(r.despues < r.antes / 5, `${r.antes} -> ${r.despues}`);
    assert.ok(r.messages[0].content.includes(pregunta));
    assert.ok(r.messages[0].content.includes('E-4583'));
    const r2 = await c.comprimir(mensajes);  // el proceso queda vivo para la segunda
    assert.equal(r2.aplicado, true);
  } finally { c.cerrar(); }
});

test('el chat envía a NVIDIA los mensajes comprimidos', async () => {
  let cuerpo;
  const request = async (url, opciones) => {
    cuerpo = JSON.parse(opciones.body);
    return new Response('data: {"choices":[{"delta":{"content":"E-4583"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const compresor = { comprimir: async m => ({ messages: [{ role: 'user', content: 'corto' }], aplicado: true, antes: 900, despues: 100 }), cerrar() {} };
  const app = await iniciarChat({ request, compresor, archivoPuente: null });
  try {
    const h = { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json', Origin: app.origin };
    let r = await fetch(app.origin + '/api/connect', { method: 'POST', headers: h, body: JSON.stringify({ key: 'nvapi-' + 'x'.repeat(60) }) });
    assert.equal(r.status, 200, await r.text());
    r = await fetch(app.origin + '/api/send', { method: 'POST', headers: h, body: JSON.stringify({ messages: mensajes }) });
    const texto = await r.text();
    assert.match(texto, /E-4583/);
    assert.equal(cuerpo.messages.at(-1).content, 'corto');
    assert.match(texto, /"headroom":\{"antes":900,"despues":100\}/);
  } finally { await app.close(); }
});
