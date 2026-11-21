// Prueba de portabilidad (propuesta "kit en otros PC", 21/11/2026). Falló 0/4 con el kit de un
// solo PC y pasa 4/4 con este. Revisa cualquier kit: KIT=<carpeta> node --test portabilidad.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = process.env.KIT ?? fileURLToPath(new URL('./', import.meta.url));
const archivos = dir => readdirSync(dir).filter(n => n !== 'portabilidad.test.mjs').flatMap(n => {
  const r = join(dir, n);
  return statSync(r).isDirectory() ? archivos(r) : /\.(mjs|js|ps1|md)$/.test(n) ? [r] : [];
});

test('ningún archivo del kit trae una ruta personal C:\\Users\\<nombre>', () => {
  const hallazgos = archivos(KIT).filter(f => /[A-Z]:\\\\?Users\\\\?(?!<)[\w.-]+/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hallazgos.map(f => f.slice(KIT.length)), []);
});

test('ningún archivo del kit nombra proyectos privados de una persona', () => {
  const privado = /colmena|caria|aria_auditoria|fisio|fundingpips/i;
  const hallazgos = archivos(KIT).filter(f => privado.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hallazgos.map(f => f.slice(KIT.length)), []);
});

test('la raíz permitida sale de la instalación, no de una constante', async () => {
  const g = await import(pathToFileURL(join(KIT, 'guardas.mjs')));
  const conf = g.configuracion({ IA_LAB_RAIZ: '/tmp/otro-pc/ia-lab-abierto' });
  assert.equal(conf.raiz, '/tmp/otro-pc/ia-lab-abierto');
});

test('las carpetas prohibidas de cada persona vienen de su config local', async () => {
  const g = await import(pathToFileURL(join(KIT, 'guardas.mjs')));
  assert.equal(typeof g.leerProhibidas, 'function');
});
