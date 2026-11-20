// Revisa archivos antes de publicar. Sale con código 1 si encuentra algo.
// Uso: node scripts/escanear-secretos.mjs [carpeta]   (por defecto, todo el repo)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const raiz = process.argv[2] ?? '.';
const saltar = new Set(['.git', 'node_modules', '.venv', '.local']);
const binarios = new Set(['.png', '.jpg', '.jpeg', '.mp4', '.wav', '.zip', '.exe', '.lnk']);

const reglas = [
  ['clave NVIDIA', /nvapi-[A-Za-z0-9_-]{20,}/],
  ['clave OpenAI', /sk-(proj-)?[A-Za-z0-9_-]{20,}/],
  ['token GitHub', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['clave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['token genérico', /(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i],
  ['ruta personal Windows', /[A-Z]:\\Users\\(?!<)[A-Za-z0-9._-]+/i],
  ['correo', /[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9.-]+\.[a-z]{2,}/i],
  ['tema privado', /\b(A\.?R\.?I\.?A\.?|Colmena|FundingPips|FisioPir[aá]mide)\b/],
];

const hallazgos = [];
function recorrer(dir) {
  for (const nombre of readdirSync(dir)) {
    if (saltar.has(nombre)) continue;
    const ruta = join(dir, nombre);
    const st = statSync(ruta);
    if (st.isDirectory()) { recorrer(ruta); continue; }
    if (binarios.has(extname(nombre).toLowerCase()) || st.size > 2_000_000) continue;
    if (ruta.endsWith('escanear-secretos.mjs')) continue;
    readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
      for (const [tipo, re] of reglas) if (re.test(linea)) hallazgos.push(`${ruta}:${i + 1}  ${tipo}`);
    });
  }
}
recorrer(raiz);
if (hallazgos.length) {
  console.error(`NO PUBLICAR. ${hallazgos.length} hallazgo(s):\n` + hallazgos.join('\n'));
  process.exit(1);
}
console.log('Sin hallazgos. Revisa igual el diff antes de publicar.');
