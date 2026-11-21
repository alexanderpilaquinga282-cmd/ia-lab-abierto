import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probar } from './probar-en-vivo.mjs';

const temporal = () => mkdtempSync(join(tmpdir(), 'vivo-'));

test('el servidor real responde por stdio: 65/P-0090 y E-4583/r-49817 con código, sin red', async () => {
  const conf = temporal();
  writeFileSync(join(conf, 'carpetas-prohibidas.txt'), '~/.ssh\n');
  writeFileSync(join(conf, 'temas-privados.txt'), '');
  const i = await probar({ env: { ...process.env, IA_LAB_CONFIG: conf, IA_LAB_REGISTRO_PRUEBA: join(temporal(), 'r.jsonl') } });
  assert.equal(i.todoOk, true, JSON.stringify(i));
  for (const c of i.casos) assert.ok(c.tokensPagados < c.tokensArchivo / 5, c.archivo);
});

test('FALLA A PROPÓSITO: sin carpetas-prohibidas.txt el servidor no arranca y la prueba lo dice', async () => {
  await assert.rejects(probar({ env: { ...process.env, IA_LAB_CONFIG: temporal(), IA_LAB_REGISTRO_PRUEBA: join(temporal(), 'r.jsonl') } }), /salió con 4/);
});
