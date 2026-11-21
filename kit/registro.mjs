// Registro de ahorro: solo números, nunca contenido, rutas ni claves.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuracion } from './guardas.mjs';

export const CARACTERES_POR_TOKEN = 4; // estimación conservadora (subestima el ahorro en logs)
export const estimarTokens = texto => Math.ceil(String(texto).length / CARACTERES_POR_TOKEN);

export function rutaRegistro(env = process.env) {
  return env.IA_LAB_REGISTRO_PRUEBA ?? join(configuracion(env).raiz, '.local', 'ahorro', 'registro.jsonl');
}

export function anotar(fila, env = process.env) {
  const ruta = rutaRegistro(env);
  mkdirSync(join(ruta, '..'), { recursive: true });
  appendFileSync(ruta, JSON.stringify({ fecha: new Date().toISOString(), ...fila }) + '\n', 'utf8');
}

export function leerRegistro(env = process.env) {
  let texto = '';
  try { texto = readFileSync(rutaRegistro(env), 'utf8'); } catch { return []; }
  return texto.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function resumen(filas) {
  const por = {};
  for (const f of filas) {
    const r = (por[f.herramienta] ??= { llamadas: 0, fallos: 0, sinNada: 0, tokensArchivo: 0, tokensQueLeeClaude: 0, evitados: 0 });
    r.llamadas++;
    if (f.error) { r.fallos++; continue; }
    r.tokensArchivo += f.tokensArchivo;
    r.tokensQueLeeClaude += f.tokensQueLeeClaude;
    r.evitados += f.tokensArchivo - f.tokensQueLeeClaude;
  }
  const total = Object.values(por).reduce((a, r) => ({ archivo: a.archivo + r.tokensArchivo, lee: a.lee + r.tokensQueLeeClaude }), { archivo: 0, lee: 0 });
  return { por, total: { ...total, evitados: total.archivo - total.lee, porcentaje: total.archivo ? Number((100 * (1 - total.lee / total.archivo)).toFixed(1)) : 0 } };
}
