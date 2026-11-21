// Guardas de la herramienta de ahorro. Solo archivos del taller pueden salir a NVIDIA o al
// cálculo local. Todo rechazo hace ruido (lanza un error).
//
// Portable (21/11/2026): la raíz del taller es la carpeta que contiene este kit (o IA_LAB_RAIZ),
// y las fronteras de cada persona viven en <raíz>/config/, fuera de Git:
//   config/carpetas-prohibidas.txt  carpetas que la herramienta nunca lee (una por línea)
//   config/temas-privados.txt       temas que nunca salen a NVIDIA (uno por línea)
// Lo de fábrica (credenciales, .git, .codex, .env, llaves) solo se puede endurecer, nunca quitar.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ_POR_DEFECTO = dirname(dirname(fileURLToPath(import.meta.url)));
// Dentro del taller tampoco: credenciales, configuración de agentes, git, entornos.
const SUBCARPETAS_VEDADAS = ['.local', '.codex', '.agents', '.git', '.venv', 'node_modules', '.claude', 'config'];
export const MAX_BYTES = 2 * 1024 * 1024;

export const credencialPegada = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:nvapi-|sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_)[\w-]{16,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bBearer\s+[^\s'"]{16,}|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|\b(?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET|PASSWORD|SECRET|TOKEN)\s*[:=]\s*["']?[^\s'"]{8,}|\bbot\d{6,}:[\w-]{20,}/i;
// Contar, sumar o sacar extremos: eso va a código, nunca a un resumen de Nemotron.
export const tareaDeContar = /\b(?:cu[aá]nt[oa]s|cuenta|contar|conteo|suma|sumar|total(?:es)?|promedio|media|m[aá]ximo|m[ií]nimo|mayor|menor|porcentaje|count|sum|average|max|min|how many)\b/i;

const escapar = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flexible = t => escapar(t.trim()).replace(/(?:\\\.|\s|-|_)+/g, '[\\s._-]*');

// Un tema por línea; "A.B.C." también atrapa "ABC" y "a b c", pero no "abc-label" ni "xabcx".
export function patronTemas(temas = []) {
  const limpios = temas.map(t => String(t).trim()).filter(t => t.length >= 2);
  return limpios.length ? new RegExp('(?<![\\w-])(?:' + limpios.map(flexible).join('|') + ')(?![\\w-])', 'i') : null;
}

export function leerLista(ruta) {
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
}

const expandir = p => p.replace(/^~(?=$|[\\/])/, homedir()).replace(/%([A-Za-z_]\w*)%/g, (m, v) => process.env[v] ?? m);

export function carpetaConfig(env = process.env, raiz = env.IA_LAB_RAIZ_PRUEBA ?? env.IA_LAB_RAIZ ?? RAIZ_POR_DEFECTO) {
  return env.IA_LAB_CONFIG ?? join(raiz, 'config');
}

export function leerProhibidas(env = process.env, raiz) {
  return leerLista(join(carpetaConfig(env, raiz), 'carpetas-prohibidas.txt')).map(expandir);
}

export function leerTemas(env = process.env, raiz) {
  return leerLista(join(carpetaConfig(env, raiz), 'temas-privados.txt'));
}

const norm = (p, win) => (win ? p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() : resolve(p));

export function configuracion(env = process.env) {
  const win = process.platform === 'win32';
  const raiz = env.IA_LAB_RAIZ_PRUEBA ?? env.IA_LAB_RAIZ ?? RAIZ_POR_DEFECTO;
  // Las pruebas pueden AÑADIR carpetas prohibidas, nunca quitar las de la config.
  const extra = env.IA_LAB_PROHIBIDAS_PRUEBA ? JSON.parse(env.IA_LAB_PROHIBIDAS_PRUEBA) : [];
  const temas = leerTemas(env, raiz);
  return {
    win, raiz,
    config: carpetaConfig(env, raiz),
    prohibidas: [...leerProhibidas(env, raiz), ...extra],
    temas,
    patronTemas: patronTemas(temas),
  };
}

function dentro(hijo, padre, win) {
  const h = norm(hijo, win), p = norm(padre, win);
  const s = win ? '\\' : sep;
  return h === p || h.startsWith(p + s);
}

export function cwdProhibido(cwd, conf) {
  return conf.prohibidas.find(x => dentro(cwd, x, conf.win));
}

// Devuelve la ruta real del archivo si se puede usar; si no, lanza con el motivo.
export function archivoPermitido(ruta, conf = configuracion()) {
  if (typeof ruta !== 'string' || !ruta.trim()) throw new Error('Indica la ruta absoluta del archivo.');
  if (!isAbsolute(ruta) && !/^[A-Za-z]:[\\/]/.test(ruta)) throw new Error('La ruta debe ser absoluta.');
  let real;
  try { real = realpathSync.native(ruta); } catch { throw new Error('El archivo no existe o no se puede leer.'); }
  for (const r of new Set([ruta, real])) {
    const p = conf.prohibidas.find(x => dentro(r, x, conf.win));
    if (p) throw new Error(`BLOQUEADO (carpeta prohibida): ${p} no se lee con esta herramienta.`);
  }
  if (!dentro(real, conf.raiz, conf.win)) throw new Error(`BLOQUEADO: solo se aceptan archivos dentro del taller (${conf.raiz}).`);
  const rel = norm(real, conf.win).slice(norm(conf.raiz, conf.win).length + 1).split(conf.win ? '\\' : sep);
  if (rel.some(parte => SUBCARPETAS_VEDADAS.includes(parte.toLowerCase()))) throw new Error('BLOQUEADO: carpeta de credenciales o configuración.');
  const nombre = rel.at(-1).toLowerCase();
  if (nombre.startsWith('.env') || /\.(?:dpapi|pem|key|pfx|p12)$/.test(nombre)) throw new Error('BLOQUEADO: archivo de credenciales.');
  const info = statSync(real);
  if (!info.isFile()) throw new Error('La ruta no es un archivo.');
  if (info.size > MAX_BYTES) throw new Error(`El archivo pasa de ${MAX_BYTES} bytes.`);
  return real;
}

export function contenidoPermitido(texto, tarea = '', conf = configuracion()) {
  if (credencialPegada.test(texto) || credencialPegada.test(tarea)) throw new Error('BLOQUEADO: el archivo o la tarea parecen tener una clave o secreto.');
  if (conf.patronTemas && (conf.patronTemas.test(texto) || conf.patronTemas.test(tarea))) {
    throw new Error('BLOQUEADO: el archivo menciona un tema privado de config/temas-privados.txt y no sale del PC.');
  }
}
