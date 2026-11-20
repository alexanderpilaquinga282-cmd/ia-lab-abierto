import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { limpiarPropuesta, mejorar, supera } from '../mejorar.mjs';
import { casos } from '../banco/casos.mjs';
import { casosReserva } from '../banco/reserva.mjs';
import { verificar } from '../banco/verificar.mjs';
import { referencias } from './referencias-reserva.mjs';
import { casosLargos } from '../casos-largos.mjs';
import { casosReservaLargos } from '../banco/reserva-largos.mjs';

const respuestas = JSON.parse(await readFile(new URL('respuestas-codex.json', import.meta.url), 'utf8'));
const propuestas = [
  '<skill>Para normalizarSKU usa una regex.</skill>', // nombra un caso: se descarta sin medir
  '<skill>CORTA: solo código.</skill>', // el servidor falso responde más corto con esta
  '<skill>LARGA: explica todo con mucho cuidado y detalle antes de responder.</skill>',
];
const pedidosProponente = [];
let servidor;
let url;

before(async () => {
  servidor = createServer(async (req, res) => {
    let cuerpo = '';
    for await (const d of req) cuerpo += d;
    const body = JSON.parse(cuerpo);
    const sistema = body.messages.find(m => m.role === 'system')?.content ?? '';
    let texto;
    const usuario = body.messages.find(m => m.role === 'user').content;
    const largo = [...casosLargos, ...casosReservaLargos].find(c => c.pregunta === usuario);
    if (sistema.startsWith('Mejoras instrucciones') && sistema.includes('salidas largas')) {
      pedidosProponente.push(body);
      texto = '<skill>CUENTA: enumera los elementos antes de dar el total.</skill>';
    } else if (sistema.startsWith('Mejoras instrucciones')) {
      pedidosProponente.push(body);
      texto = propuestas[(pedidosProponente.length - 1) % propuestas.length];
    } else if (largo) {
      // Sin la skill CUENTA, el modelo falso cuenta mal en dos casos de contar.
      const falla = ['pedidos', 'accesos'].includes(largo.id) && !sistema.startsWith('CUENTA');
      texto = JSON.stringify(falla ? { ...largo.esperado, [Object.keys(largo.esperado)[0]]: -1 } : largo.esperado);
    } else {
      const caso = casos.find(c => c.prompt === usuario);
      texto = caso ? respuestas.find(r => r.id === caso.id).answer : referencias[casosReserva.find(c => c.prompt === usuario).id];
    }
    const salida = sistema.startsWith('CORTA') ? Math.round(texto.length / 3) : texto.length;
    res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: texto }, finish_reason: 'stop' }],
      usage: { prompt_tokens: JSON.stringify(body.messages).length, completion_tokens: salida } }));
  });
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${servidor.address().port}/v1/chat/completions`;
});
after(() => servidor.close());

const env = () => ({ ...process.env, NVIDIA_API_KEY: 'clave-de-prueba', EFICIENCIA_ENDPOINT: url });
const carpetaTemporal = async () => pathToFileURL(await mkdtemp(join(tmpdir(), 'bucle-')) + '/');

test('las referencias de reserva aprueban todo (los esperados son correctos)', () => {
  for (const c of casosReserva) {
    const r = verificar(c, referencias[c.id]);
    assert.equal(r.aprobadas, r.total, c.id + ' ' + JSON.stringify(r.fallos));
  }
});

test('la reserva no comparte encargos con el entrenamiento', () => {
  const nombres = new Set(casos.map(c => c.nombre));
  assert.ok(casosReserva.every(c => !nombres.has(c.nombre)));
});

test('limpiarPropuesta rechaza lo que no es una skill general', () => {
  assert.equal(limpiarPropuesta('<skill> Sé breve. </skill>').skill, 'Sé breve.');
  assert.match(limpiarPropuesta('Sé breve.').error, /etiquetas/);
  assert.match(limpiarPropuesta('<skill>Cuida leerRegistro</skill>').error, /entrenamiento/);
  assert.match(limpiarPropuesta('<skill>ver https://x.y</skill>').error, /enlace/);
  assert.match(limpiarPropuesta('<skill>' + 'a'.repeat(1300) + '</skill>').error, /larga/);
});

test('supera aplica los criterios congelados', () => {
  const c = { aprobadas: 12, intentos: 18, errores: 0, total: 300 };
  assert.equal(supera(c, { ...c, total: 285 }).gana, true);
  assert.equal(supera(c, { ...c, total: 290 }).gana, false);
  assert.equal(supera(c, { ...c, aprobadas: 13, total: 330 }).gana, true);
  assert.equal(supera(c, { ...c, aprobadas: 13, total: 331 }).gana, false);
  assert.equal(supera(c, { ...c, aprobadas: 11, total: 100 }).gana, false);
  assert.equal(supera(c, { ...c, total: 100, errores: 1 }).gana, false);
});

test('una generación: descarta, mide, confirma en reserva y guarda la propuesta', async () => {
  pedidosProponente.length = 0;
  const carpeta = await carpetaTemporal();
  const r = await mejorar({ generaciones: 1, candidatas: 3, repeticiones: 1, pausaMs: 0, env: env(), log: () => {}, carpeta });
  assert.equal(r.ganadoras.length, 1);
  assert.equal(r.campeona.texto, 'CORTA: solo código.');
  assert.equal(pedidosProponente.length, 3);

  const archivos = await readdir(new URL('propuestas/', carpeta));
  assert.equal(archivos.length, 1);
  const md = await readFile(new URL('propuestas/' + archivos[0], carpeta), 'utf8');
  assert.match(md, /pendiente de revisión/);
  assert.match(md, /CORTA: solo código\./);

  const todo = [md, ...(await Promise.all(['campeona.json', 'intentos.json', 'historial.md'].map(n => readFile(new URL(n, carpeta), 'utf8'))))].join('\n');
  assert.doesNotMatch(todo, /clave-de-prueba/);

  // El proponente nunca ve los encargos ni las pruebas.
  const visto = JSON.stringify(pedidosProponente);
  for (const c of [...casos, ...casosReserva]) {
    assert.ok(!visto.includes(c.nombre), 'el proponente vio ' + c.nombre);
  }
  assert.ok(pedidosProponente.every(b => b.temperature === 0.8));
});

test('la segunda corrida parte de la campeona guardada', async () => {
  pedidosProponente.length = 0;
  const carpeta = await carpetaTemporal();
  await mejorar({ generaciones: 1, candidatas: 3, repeticiones: 1, pausaMs: 0, env: env(), log: () => {}, carpeta });
  const r = await mejorar({ generaciones: 1, candidatas: 1, repeticiones: 1, pausaMs: 0, env: env(), log: () => {}, carpeta });
  assert.equal(r.campeona.texto, 'CORTA: solo código.');
  assert.match(JSON.stringify(pedidosProponente.at(-1)), /CORTA: solo código/);
  const historial = await readFile(new URL('historial.md', carpeta), 'utf8');
  assert.equal(historial.trim().split('\n').length, 2);
});

test('respeta el máximo de consultas antes de gastar ninguna', async () => {
  pedidosProponente.length = 0;
  const carpeta = await carpetaTemporal();
  const e = await mejorar({ generaciones: 5, candidatas: 5, repeticiones: 3, maximoConsultas: 150, pausaMs: 0, env: env(), log: () => {}, carpeta }).catch(e => e);
  assert.match(e.message, /máximo es 150/);
  assert.equal(pedidosProponente.length, 0);
});

test('reserva larga: casos nuevos, grandes y deterministas', async () => {
  const otra = await import('../banco/reserva-largos.mjs?otra');
  assert.deepEqual(otra.casosReservaLargos.map(c => c.esperado), casosReservaLargos.map(c => c.esperado));
  const ids = new Set(casosLargos.map(c => c.id));
  for (const c of casosReservaLargos) {
    assert.ok(!ids.has(c.id), c.id);
    assert.ok(c.datos.length > 4000, c.id);
  }
});

test('bateria largos: mejora la calidad, confirma en reserva larga y guarda aparte', async () => {
  pedidosProponente.length = 0;
  const carpeta = await carpetaTemporal();
  const r = await mejorar({ bateria: 'largos', generaciones: 1, candidatas: 1, repeticiones: 1, pausaMs: 0, env: env(), log: () => {}, carpeta });
  assert.equal(r.ganadoras.length, 1);
  assert.match(r.campeona.texto, /^CUENTA/);
  assert.equal(r.campeona.entrenamiento.aprobadas, 3);
  assert.equal(r.campeona.reserva.aprobadas, 3);
  const [archivo] = await readdir(new URL('propuestas/', carpeta));
  assert.match(await readFile(new URL('propuestas/' + archivo, carpeta), 'utf8'), /bateria: largos/);
  const visto = JSON.stringify(pedidosProponente);
  for (const c of [...casosLargos, ...casosReservaLargos]) {
    assert.ok(!visto.includes(c.pregunta) && !visto.includes(c.datos.slice(0, 60)), 'el proponente vio ' + c.id);
  }
});

test('limpiarPropuesta en largos rechaza nombres y respuestas del entrenamiento', async () => {
  const { BATERIAS, CRITERIO } = await import('../mejorar.mjs');
  const p = BATERIAS.largos.prohibidas;
  assert.equal(limpiarPropuesta('<skill>Enumera y luego cuenta.</skill>', CRITERIO, p).skill, 'Enumera y luego cuenta.');
  assert.match(limpiarPropuesta('<skill>En pedidos devueltos, cuenta</skill>', CRITERIO, p).error, /entrenamiento/);
  assert.match(limpiarPropuesta('<skill>El código suele ser E-4583</skill>', CRITERIO, p).error, /entrenamiento/);
});
