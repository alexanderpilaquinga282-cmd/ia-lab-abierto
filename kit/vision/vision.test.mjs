// node --test vision.test.mjs   (NVIDIA falso en 127.0.0.1, sin red)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inflateSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { casosVision, crc32, verificarVision } from './imagenes.mjs';
import { correrVision, endpoint, veredictoVision, MODELO_VL } from './correr-vision.mjs';

let modo = 'bien', servidor, url;
const cuerpos = [];
before(async () => {
  servidor = createServer(async (req, res) => {
    let b = ''; for await (const d of req) b += d;
    const body = JSON.parse(b); cuerpos.push(body);
    if (modo === '404') { res.statusCode = 404; return res.end('{"detail":"model not found"}'); }
    const caso = casosVision.find(c => c.pregunta === body.messages[0].content[0].text);
    const texto = modo === 'bien' ? JSON.stringify(caso.esperado) : modo === 'cuenta-mal' && caso.tipo === 'contar' ? '{"rojos":3}' : modo === 'lee-mal' && caso.id === 'serie' ? '{"serie":"XXXXXXXX"}' : JSON.stringify(caso.esperado);
    res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: texto } }], usage: { prompt_tokens: 900, completion_tokens: 20 } }));
  });
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${servidor.address().port}/v1/chat/completions`;
});
after(() => servidor.close());
const env = () => ({ NVIDIA_API_KEY: 'clave-de-prueba', EFICIENCIA_ENDPOINT: url });

test('los PNG son válidos: firma, CRC y tamaño de píxeles', () => {
  for (const c of casosVision) {
    assert.deepEqual([...c.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    let p = 8, idat = [];
    while (p < c.png.length) {
      const n = c.png.readUInt32BE(p), tipo = c.png.toString('ascii', p + 4, p + 8);
      assert.equal(c.png.readUInt32BE(p + 8 + n), crc32(c.png.subarray(p + 4, p + 8 + n)), tipo);
      if (tipo === 'IDAT') idat.push(c.png.subarray(p + 8, p + 8 + n));
      p += 12 + n;
    }
    assert.equal(inflateSync(Buffer.concat(idat)).length, (c.ancho * 3 + 1) * c.alto);
  }
});

test('mismas imágenes cada vez (semilla fija) y respuestas únicas', async () => {
  const otra = await import('./imagenes.mjs?otra');
  assert.deepEqual(otra.casosVision.map(c => c.png.toString('base64')), casosVision.map(c => c.png.toString('base64')));
});

test('todo bien: 15/15 lectura, se acepta y la imagen viaja como data URL al modelo VL', async () => {
  modo = 'bien'; cuerpos.length = 0;
  const r = await correrVision({ repeticiones: 3, pausaMs: 0, env: env(), log: () => {} });
  assert.equal(r.veredicto.aceptada, true);
  assert.equal(r.veredicto.lectura, '15/15');
  assert.ok(r.veredicto.tokensClaudeEvitados > 0);
  assert.equal(cuerpos[0].model, MODELO_VL);
  assert.match(cuerpos[0].messages[0].content[1].image_url.url, /^data:image\/png;base64,iVBOR/);
});

test('FALLA A PROPÓSITO: una lectura mal en 1 de 15 basta para no aceptar', async () => {
  modo = 'lee-mal';
  const r = await correrVision({ repeticiones: 3, pausaMs: 0, env: env(), log: () => {} });
  assert.equal(r.veredicto.aceptada, false);
  assert.equal(r.veredicto.lectura, '12/15');
});

test('contar mal se reporta pero no decide', async () => {
  modo = 'cuenta-mal';
  const r = await correrVision({ repeticiones: 1, pausaMs: 0, env: env(), log: () => {} });
  assert.equal(r.veredicto.aceptada, true);
  assert.equal(r.veredicto.contar, '0/1');
});

test('FALLA A PROPÓSITO: modelo inexistente (404) para en la primera llamada, sin reintentos', async () => {
  modo = '404'; cuerpos.length = 0;
  await assert.rejects(correrVision({ repeticiones: 3, pausaMs: 0, env: env(), log: () => {} }), /404.*Se para aquí/);
  assert.equal(cuerpos.length, 1);
});

test('errores de red = sin decisión; endpoint ajeno rechazado; verificador exige JSON exacto', () => {
  assert.equal(veredictoVision([{ tipo: 'leer', error: 'tiempo agotado', aprobada: false }]).aceptada, false);
  assert.throws(() => endpoint({ EFICIENCIA_ENDPOINT: 'https://api.otro.com/v1' }), /no permitido/);
  assert.equal(verificarVision(casosVision[1], 'El total es ' + casosVision[1].esperado.total).aprobada, false);
});
