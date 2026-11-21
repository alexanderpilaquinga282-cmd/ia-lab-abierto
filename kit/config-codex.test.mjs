import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aplicar, conectarRegla, conectarToml, quitarRegla, quitarTabla } from './config-codex.mjs';

const RAIZ = 'C:\\Taller\\ia-lab-abierto';
const AJENA = 'model = "gpt-x"\n\n[mcp_servers.otro]\ncommand = "otro"\n\n[profiles.rapido]\nmodel = "y"\n';

test('agrega la tabla y conserva todo lo demás', () => {
  const t = conectarToml(AJENA, RAIZ, 'node');
  assert.match(t, /\[mcp_servers\.otro\]\ncommand = "otro"/);
  assert.match(t, /\[profiles\.rapido\]/);
  assert.match(t, /args = \['C:\\Taller\\ia-lab-abierto[\\/]kit[\\/]ahorro-mcp\.mjs'\]/);
  assert.equal((t.match(/\[mcp_servers\.ia_lab_ahorro\]/g) ?? []).length, 1);
});

test('es idempotente: conectar dos veces deja una sola tabla y una sola regla', () => {
  const t = conectarToml(conectarToml(AJENA, RAIZ, 'node'), RAIZ, 'node');
  assert.equal((t.match(/ia_lab_ahorro\]/g) ?? []).length, 1);
  const r = conectarRegla(conectarRegla('# Mis reglas\n', RAIZ), RAIZ);
  assert.equal((r.match(/ia-lab-ahorro:inicio/g) ?? []).length, 1);
  assert.match(r, /^# Mis reglas/);
});

test('quitar deja el archivo como estaba (subtablas incluidas)', () => {
  const con = conectarToml(AJENA, RAIZ, 'node') + '\n[mcp_servers.ia_lab_ahorro.env]\nX = "1"\n\n[ultima]\na = 1\n';
  const sin = quitarTabla(con);
  assert.doesNotMatch(sin, /ia_lab_ahorro/);
  assert.match(sin, /\[ultima\]\na = 1/);
  assert.equal(quitarRegla(conectarRegla('# Mis reglas\n', RAIZ)).trim(), '# Mis reglas');
});

test('nunca escribe una clave en la config de Codex', () => {
  const t = conectarToml('', RAIZ, 'node');
  assert.doesNotMatch(t, /nvapi|NVIDIA_API_KEY|clave/i);
});

test('FALLA A PROPÓSITO: una ruta con comilla simple rompería el TOML y se rechaza', () => {
  assert.throws(() => conectarToml('', "C:\\Mi'Taller", 'node'), /no válida para TOML/);
});

test('aplicar hace respaldo una vez y no lo pisa', () => {
  const d = mkdtempSync(join(tmpdir(), 'codex-'));
  writeFileSync(join(d, 'config.toml'), AJENA);
  const r1 = aplicar({ codexHome: d, raiz: RAIZ, sello: 'x' });
  const r2 = aplicar({ codexHome: d, raiz: RAIZ, sello: 'x' });
  assert.equal(readFileSync(join(d, 'config.toml.antes-kit-x'), 'utf8'), AJENA);
  assert.deepEqual(r1.respaldos.length, 1);
  assert.equal(r2.respaldos.length, 2);
  aplicar({ codexHome: d, raiz: RAIZ, quitar: true, sello: 'x' });
  assert.equal(readFileSync(join(d, 'config.toml'), 'utf8').trim(), AJENA.trim());
  assert.ok(existsSync(join(d, 'AGENTS.md')));
});
