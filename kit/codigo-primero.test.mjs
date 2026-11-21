import test from 'node:test';
import assert from 'node:assert/strict';
import { filtros, medir } from './codigo-primero.mjs';
import { casosLargos } from '../eficiencia/casos-largos.mjs';
import { casosReservaLargos } from '../eficiencia/banco/reserva-largos.mjs';

const todos = [...casosLargos, ...casosReservaLargos];

test('los 6 filtros dan la respuesta exacta del verificador', () => {
  for (const c of todos) assert.equal(medir(c, filtros[c.id], 2.5).codigoOk, true, c.id);
});

test('FALLA A PROPÓSITO: un filtro equivocado (busca WARN en vez de ERROR) se marca como fallo', () => {
  const malo = d => { const l = d.split('\n').find(x => / WARN /.test(x)); return { codigo: l.match(/codigo=(\S+)/)?.[1] ?? '?', req: l.match(/req=(\S+)/)[1] }; };
  assert.equal(medir(casosLargos[0], malo, 2.5).codigoOk, false);
});

test('FALLA A PROPÓSITO: un filtro que revienta no se cuenta como acierto', () => {
  assert.equal(medir(casosLargos[1], () => { throw new Error('boom'); }, 2.5).codigoOk, false);
});

test('contar con >= en vez de > en sensores cambia la respuesta y el verificador lo ve', () => {
  const c = casosReservaLargos[2];
  const ge = d => { const l = JSON.parse(d); return { sobre80: l.filter(x => x.valor >= 80).length + 1, sensorMaximo: 'S-00' }; };
  assert.equal(medir(c, ge, 2.5).codigoOk, false);
});

test('corre en un clon recién hecho (sin eficiencia/resultados/) y da los mismos totales', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const salida = execFileSync(process.execPath, [fileURLToPath(new URL('./codigo-primero.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.match(salida, /codigo 6\/6/);
  assert.match(salida, /codigo-primero 9\d\.\d %/);
});
