import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fusionar } from './config-claude.mjs';

const N = 'C:\\Program Files\\nodejs\\node.exe', S = 'C:\\taller\\kit\\ahorro-mcp.mjs';
const appConfig = { preferences: { menuBarEnabled: false, sidebarMode: 'chat', lista: [], numero: 1.5, unicode: 'Configuración ✓' }, mcpServers: { otro: { command: 'x', args: ['a'], env: { A: '1' } } } };

test('agrega ia_lab_ahorro sin tocar preferencias ni otros servidores', () => {
  const r = JSON.parse(fusionar(JSON.stringify(appConfig), N, S));
  assert.deepEqual(r.preferences, appConfig.preferences);
  assert.deepEqual(r.mcpServers.otro, appConfig.mcpServers.otro);
  assert.deepEqual(r.mcpServers.ia_lab_ahorro, { command: N, args: [S] });
});
test('archivo vacío, con BOM o sin mcpServers', () => {
  assert.deepEqual(JSON.parse(fusionar('', N, S)), { mcpServers: { ia_lab_ahorro: { command: N, args: [S] } } });
  assert.ok(JSON.parse(fusionar('\uFEFF{"preferences":{}}', N, S)).mcpServers.ia_lab_ahorro);
});
test('quitar deja todo lo demás igual', () => {
  const con = fusionar(JSON.stringify(appConfig), N, S);
  assert.deepEqual(JSON.parse(fusionar(con, N, S, true)), appConfig);
});
test('FALLA A PROPÓSITO: JSON roto o mcpServers raro no se sobrescribe', () => {
  assert.throws(() => fusionar('{roto', N, S));
  assert.throws(() => fusionar('{"mcpServers":[]}', N, S), /mcpServers/);
});
test('CLI: respaldo, escritura atómica y relectura', () => {
  const d = mkdtempSync(join(tmpdir(), 'cfg-')), f = join(d, 'claude_desktop_config.json');
  writeFileSync(f, JSON.stringify(appConfig));
  const out = execFileSync(process.execPath, ['config-claude.mjs', f, N, S], { cwd: new URL('.', import.meta.url), encoding: 'utf8' });
  assert.match(out, /ESCRITO en/);
  assert.equal(readdirSync(d).filter(n => n.includes('antes-ia-lab')).length, 1);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')).preferences, appConfig.preferences);
  const fuera = execFileSync(process.execPath, ['config-claude.mjs', f, N, S, '--quitar'], { cwd: new URL('.', import.meta.url), encoding: 'utf8' });
  assert.match(fuera, /QUITADO/);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), appConfig);
});
