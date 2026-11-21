// node --test ahorro-mcp.test.mjs  (sin red: NVIDIA falso en 127.0.0.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { crearLlamador, servir, ejecutarFuncion, endpoint, crearHerramientas } from './ahorro-mcp.mjs';
import { patronTemas, configuracion } from './guardas.mjs';
import { nota } from './ahorro.mjs';
import { leerRegistro } from './registro.mjs';
import { casosLargos } from '../eficiencia/casos-largos.mjs';

const base = mkdtempSync(join(tmpdir(), 'ahorro-'));
const taller = join(base, 'taller');
const privada = join(base, 'Privada');
mkdirSync(join(taller, 'datos'), { recursive: true });
mkdirSync(join(taller, '.local'), { recursive: true });
mkdirSync(privada, { recursive: true });
mkdirSync(join(taller, 'config'), { recursive: true });
writeFileSync(join(taller, 'config', 'temas-privados.txt'), '# temas de prueba\nProyecto Delta\nA.B.C.\n');
writeFileSync(join(taller, 'config', 'carpetas-prohibidas.txt'), privada + '\n');
const log = casosLargos[0];
writeFileSync(join(taller, 'datos', 'log.txt'), log.datos);
writeFileSync(join(taller, 'datos', 'pedidos.json'), casosLargos[1].datos);
writeFileSync(join(taller, 'datos', 'con-clave.txt'), 'linea\nNVIDIA_API_KEY=' + 'nvapi-' + 'A'.repeat(24) + '\n');
writeFileSync(join(taller, 'datos', 'privado.txt'), 'notas del proyecto-delta sobre la cuenta');
writeFileSync(join(taller, 'datos', 'html.txt'), '<button aria-label="abrir">variar</button>\n'.repeat(5));
writeFileSync(join(taller, '.local', 'secreto.txt'), 'x');
writeFileSync(join(privada, 'nota.md'), 'nota privada');
// Windows sin modo desarrollador no deja crear enlaces: esa prueba se salta y lo dice.
let hayEnlaces = true;
try { symlinkSync(join(privada, 'nota.md'), join(taller, 'datos', 'atajo.md')); } catch { hayEnlaces = false; }

let pedidas = [];
const falso = createServer((req, res) => {
  let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
    pedidas.push({ auth: req.headers.authorization, cuerpo: JSON.parse(b) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: `ERROR codigo=${log.esperado.codigo} req=${log.esperado.req}` } }], usage: { prompt_tokens: 60000, completion_tokens: 30 } }));
  });
});
await new Promise(ok => falso.listen(0, '127.0.0.1', ok));
const env = {
  NVIDIA_API_KEY: 'nvapi-' + 'prueba-falsa-0000000000',
  IA_LAB_RAIZ_PRUEBA: taller,
  IA_LAB_ENDPOINT_PRUEBA: `http://127.0.0.1:${falso.address().port}/v1/chat/completions`,
  IA_LAB_REGISTRO_PRUEBA: join(base, 'registro.jsonl'),
};
const llamar = crearLlamador(env);
test.after(() => falso.close());

test('leer_con_nemotron: encuentra el error y anota tokens reales de NVIDIA', async () => {
  const r = await llamar('leer_con_nemotron', { archivo: join(taller, 'datos', 'log.txt'), tarea: 'Encuentra la línea ERROR y dame codigo y req' });
  assert.ok(!r.isError);
  assert.match(r.content[0].text, new RegExp(log.esperado.codigo));
  assert.equal(pedidas.at(-1).auth, 'Bearer ' + env.NVIDIA_API_KEY);
  const fila = leerRegistro(env).at(-1);
  assert.deepEqual([fila.tokensArchivo, fila.tokensQueLeeClaude, fila.fuente], [60000, 30, 'nvidia']);
  assert.ok(!JSON.stringify(fila).includes('log.txt'), 'el registro no guarda rutas');
});

test('FALLA A PROPÓSITO: pedirle a Nemotron que cuente se rechaza sin llamar a NVIDIA', async () => {
  const antes = pedidas.length;
  const r = await llamar('leer_con_nemotron', { archivo: join(taller, 'datos', 'pedidos.json'), tarea: 'Cuenta los pedidos devueltos' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /calcular_con_codigo/);
  assert.equal(pedidas.length, antes);
});

for (const [nombre, ruta, motivo] of [
  ['archivo de una carpeta prohibida (desde config/)', join(privada, 'nota.md'), /carpeta prohibida/],
  ['enlace del taller que apunta a la carpeta prohibida', join(taller, 'datos', 'atajo.md'), /carpeta prohibida/],
  ['carpeta .local', join(taller, '.local', 'secreto.txt'), /credenciales o configuración/],
  ['archivo con clave', join(taller, 'datos', 'con-clave.txt'), /clave o secreto/],
  ['archivo que menciona un tema privado (desde config/)', join(taller, 'datos', 'privado.txt'), /no sale del PC/],
  ['la propia carpeta config', join(taller, 'config', 'temas-privados.txt'), /credenciales o configuración/],
  ['ruta relativa', 'datos/log.txt', /absoluta/],
  ['fuera del taller', join(base, 'registro.jsonl'), /dentro del taller/],
]) {
  test(`FALLA A PROPÓSITO: ${nombre} se bloquea y no llega a NVIDIA`, { skip: nombre.startsWith('enlace') && !hayEnlaces && 'este Windows no permite crear enlaces' }, async () => {
    const antes = pedidas.length;
    const r = await llamar('leer_con_nemotron', { archivo: ruta, tarea: 'Resume lo importante del archivo' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, motivo);
    assert.equal(pedidas.length, antes);
  });
}

test('calcular_con_codigo: cuenta exacto los devueltos y anota el ahorro', async () => {
  const funcion = 'function calcular(texto) { const p = JSON.parse(texto).filter(x => x.estado === "devuelto"); return { devueltos: p.length, mayorDevuelto: p.reduce((a, b) => b.monto > a.monto ? b : a).id }; }';
  const r = await llamar('calcular_con_codigo', { archivo: join(taller, 'datos', 'pedidos.json'), funcion });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(JSON.parse(r.content[0].text), casosLargos[1].esperado);
  const fila = leerRegistro(env).at(-1);
  assert.ok(fila.tokensQueLeeClaude < fila.tokensArchivo / 10);
});

test('FALLA A PROPÓSITO: bucle infinito, require y código sin forma se cortan', () => {
  assert.throws(() => ejecutarFuncion('function calcular(t) { while (true) {} }', 'x'), /timed out/i);
  assert.throws(() => ejecutarFuncion('function calcular(t) { return require("fs"); }', 'x'), /require is not defined/);
  assert.throws(() => ejecutarFuncion('function calcular(t) { return eval("1"); }', 'x'), /Code generation from strings disallowed/);
  assert.throws(() => ejecutarFuncion('console.log(1)', 'x'), /function calcular/);
});

test('el endpoint solo puede ser NVIDIA o 127.0.0.1', () => {
  assert.throws(() => endpoint({ IA_LAB_ENDPOINT_PRUEBA: 'https://otro.ejemplo.com/v1' }), /no permitido/);
});

test('estado_ahorro y la nota salen del registro', async () => {
  const r = await llamar('estado_ahorro', {});
  const datos = JSON.parse(r.content[0].text);
  assert.ok(datos.total.evitados > 0);
  assert.ok(datos.por.leer_con_nemotron.fallos >= 7);
  const md = nota(leerRegistro(env), '2026-11-20');
  assert.match(md, /^---\ntipo: medicion/);
  assert.match(md, /Ahorro en vivo de Claude/);
  assert.match(nota(leerRegistro(env), '2026-11-20', 'Pie: [[Mi bóveda]]'), /Pie: \[\[Mi bóveda\]\]/);
});

test('protocolo MCP: initialize, tools/list y tools/call', async () => {
  const entrada = new PassThrough(), salida = new PassThrough();
  let texto = ''; salida.on('data', d => (texto += d));
  const fin = servir(entrada, salida, env);
  entrada.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  entrada.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  entrada.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'estado_ahorro', arguments: {} } }) + '\n');
  await new Promise(ok => setTimeout(ok, 200));
  entrada.end(); await fin;
  const r = texto.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(r[0].result.serverInfo.name, 'ia_lab_ahorro');
  assert.match(r[0].result.instructions, /calcular_con_codigo/);
  assert.ok(r[0].result.instructions.includes(taller), 'la instrucción nombra la raíz de este taller');
  assert.deepEqual(r[1].result.tools.map(t => t.name), ['leer_con_nemotron', 'calcular_con_codigo', 'estado_ahorro']);
  assert.ok(r[2].result.content[0].text.includes('total'));
});

test('un tema privado no atrapa abc-label ni palabras que lo contienen', async () => {
  const p = patronTemas(['A.B.C.', 'Proyecto Delta']);
  for (const si of ['ABC', 'a.b.c.', 'A B C', 'proyecto_delta', 'PROYECTO DELTA']) assert.ok(p.test('x ' + si + ' y'), si);
  for (const no of ['abc-label', 'xabcx', 'abcd', 'proyectodeltas']) assert.ok(!p.test('x ' + no + ' y'), no);
  const r = await llamar('leer_con_nemotron', { archivo: join(taller, 'datos', 'html.txt'), tarea: 'Resume lo importante del archivo' });
  assert.ok(!r.isError, r.content[0].text);
});

test('las descripciones de las herramientas nombran la raíz instalada, no una ruta fija', () => {
  const t = JSON.stringify(crearHerramientas(taller));
  const enJson = JSON.stringify(taller).slice(1, -1);
  assert.ok(t.includes(enJson));
  assert.ok(!/Users[\\/]+[a-z]/i.test(t.split(enJson).join('')), 'ninguna otra ruta de usuario');
});

test('la raíz por defecto es la carpeta que contiene el kit', () => {
  const conf = configuracion({});
  assert.equal(conf.raiz, dirname(dirname(fileURLToPath(import.meta.url))));
});

const servidor = fileURLToPath(new URL('./ahorro-mcp.mjs', import.meta.url));
test('FALLA A PROPÓSITO: sin config local el servidor no arranca', () => {
  const vacia = mkdtempSync(join(tmpdir(), 'sin-config-'));
  const r = spawnSync(process.execPath, [servidor], { env: { ...process.env, IA_LAB_RAIZ: vacia }, input: '', encoding: 'utf8' });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /carpetas-prohibidas\.txt/);
});

test('FALLA A PROPÓSITO: arrancar dentro de una carpeta prohibida se niega', () => {
  const r = spawnSync(process.execPath, [servidor], { cwd: privada, env: { ...process.env, IA_LAB_RAIZ: taller }, input: '', encoding: 'utf8' });
  assert.equal(r.status, 3);
});
