// Pruebas del cuadro de la clave sin Windows: la ventana se reemplaza por una promesa controlada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { obtenerClave, olvidarClave, guion, ClavePendiente } from './clave.mjs';

const CLAVE = 'nvapi-' + 'prueba-falsa-0000000000';
const win = { plataforma: 'win32' };
function controlada() {
  let ok, fallo, veces = 0;
  const pedir = () => { veces++; return new Promise((a, b) => { ok = a; fallo = b; }); };
  return { pedir, ok: k => ok(k), fallo: e => fallo(e), get veces() { return veces; } };
}

test('si la clave llega dentro de la espera, la llamada la usa', async () => {
  olvidarClave();
  const v = controlada();
  setTimeout(() => v.ok(CLAVE), 20);
  assert.equal(await obtenerClave({}, { ...win, pedir: v.pedir, esperaMs: 500 }), CLAVE);
});

test('si no llega a tiempo, responde ClavePendiente rápido y la siguiente llamada la usa sin abrir otro cuadro', async () => {
  olvidarClave();
  const v = controlada();
  const t0 = Date.now();
  await assert.rejects(obtenerClave({}, { ...win, pedir: v.pedir, esperaMs: 50 }), ClavePendiente);
  assert.ok(Date.now() - t0 < 1000, 'no debe bloquear');
  v.ok(CLAVE);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(await obtenerClave({}, { ...win, pedir: v.pedir, esperaMs: 50 }), CLAVE);
  assert.equal(v.veces, 1);
});

test('dos llamadas a la vez abren un solo cuadro', async () => {
  olvidarClave();
  const v = controlada();
  const a = obtenerClave({}, { ...win, pedir: v.pedir, esperaMs: 500 });
  const b = obtenerClave({}, { ...win, pedir: v.pedir, esperaMs: 500 });
  v.ok(CLAVE);
  assert.deepEqual(await Promise.all([a, b]), [CLAVE, CLAVE]);
  assert.equal(v.veces, 1);
});

test('falla a propósito: clave con formato inválido no queda en memoria', async () => {
  olvidarClave();
  const v = controlada();
  setTimeout(() => v.ok('corta'), 10);
  await assert.rejects(obtenerClave({}, { ...win, pedir: v.pedir, esperaMs: 500 }), /formato inválido/);
  const w = controlada();
  setTimeout(() => w.ok(CLAVE), 10);
  assert.equal(await obtenerClave({}, { ...win, pedir: w.pedir, esperaMs: 500 }), CLAVE);
  assert.equal(w.veces, 1, 'pidió de nuevo porque la inválida no se guardó');
});

test('falla a propósito: cuadro cerrado niega y el fallo tardío no tumba el proceso', async () => {
  olvidarClave();
  const v = controlada();
  await assert.rejects(obtenerClave({}, { ...win, pedir: v.pedir, esperaMs: 30 }), ClavePendiente);
  v.fallo(new Error('Se cerró el cuadro de la clave (negado).'));
  await new Promise(r => setTimeout(r, 20)); // sin unhandledRejection
  const w = controlada();
  setTimeout(() => w.fallo(new Error('Se cerró el cuadro de la clave (negado).')), 10);
  await assert.rejects(obtenerClave({}, { ...win, pedir: w.pedir, esperaMs: 500 }), /negado/);
});

test('falla a propósito: fuera de Windows sin variable no inventa clave', async () => {
  olvidarClave();
  await assert.rejects(obtenerClave({}, { plataforma: 'linux' }), /Falta NVIDIA_API_KEY/);
  assert.equal(await obtenerClave({ NVIDIA_API_KEY: CLAVE }, { plataforma: 'linux' }), CLAVE);
});

test('el cuadro es gráfico, siempre encima, oculta lo que se escribe y no usa la consola', () => {
  const g = guion('ia-lab-nemo-abc');
  assert.match(g, /System\.Windows\.Forms/);
  assert.match(g, /TopMost = \$true/);
  assert.match(g, /UseSystemPasswordChar = \$true/);
  assert.doesNotMatch(g, /Read-Host/);
  assert.match(g, /ia-lab-nemo-abc/);
});
