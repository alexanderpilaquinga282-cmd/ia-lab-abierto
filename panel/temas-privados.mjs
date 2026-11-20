// Lee los temas que nunca deben ir al modelo gratuito. Cada persona escribe los suyos en
// config/temas-privados.txt (uno por línea, # para comentarios). El archivo queda fuera de Git.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const rutaTemasPrivados = fileURLToPath(new URL('../config/temas-privados.txt', import.meta.url));

export function leerTemasPrivados(ruta = process.env.IA_LAB_TEMAS_PRIVADOS || rutaTemasPrivados) {
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, 'utf8').split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
}
