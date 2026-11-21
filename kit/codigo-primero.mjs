// Medición sin red del kit "Claude dirige, Nemotron hace lo pesado" (kit-claude.pdf, 20/11/2026).
// Compara, en los 6 casos largos del banco (3 de entrenamiento + 3 de reserva), cuántos
// tokens PAGADOS gasta el modelo que dirige (Claude/Codex) con tres estrategias:
//   base           : el modelo pagado recibe la salida larga entera.
//   nemo (kit)     : Nemotron lee lo largo y el pagado solo ve el resumen. Exactitud = la de
//                    Nemotron leyendo lo crudo (medida el 18/11 y 20/11), porque el pagado
//                    no puede corregir lo que el resumen ya perdió.
//   codigo-primero : el pagado ve la pregunta + una muestra de 1.500 caracteres, escribe un
//                    filtro de pocas líneas, el filtro corre localmente y el pagado lee solo
//                    su salida (LIA5). Exactitud medida aquí, con el verificador del banco.
// Tokens: se estiman con la razón caracteres/token calibrada con las corridas reales de la base.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { casosLargos, verificarLargo } from '../eficiencia/casos-largos.mjs';
import { casosReservaLargos } from '../eficiencia/banco/reserva-largos.mjs';

const MUESTRA = 1500;
// Calibración de la corrida base del 18/11/2026 (eficiencia/resultados/ no viaja en Git):
// se usa cuando el JSON no está, como en un clon recién hecho.
export const CPT_CALIBRADO = 1.548;

// Filtros escritos a partir de la pregunta y la muestra (como los escribiría el modelo).
export const filtros = {
  'log-error': d => { const l = d.split('\n').find(x => / ERROR /.test(x)); return { codigo: l.match(/codigo=(\S+)/)[1], req: l.match(/req=(\S+)/)[1] }; },
  'pedidos': d => { const p = JSON.parse(d).filter(x => x.estado === 'devuelto'); return { devueltos: p.length, mayorDevuelto: p.reduce((a, b) => (b.monto > a.monto ? b : a)).id }; },
  'pruebas': d => ({ fallidas: [...d.matchAll(/✗ (.+?) \(/g)].map(m => m[1]).sort() }),
  'inventario': d => { const f = d.split('\n').slice(1).map(l => l.split(',')).map(([sku, , s, m]) => ({ sku, def: +m - +s })).filter(x => x.def > 0); return { bajoMinimo: f.length, mayorDeficit: f.reduce((a, b) => (b.def > a.def ? b : a)).sku }; },
  'accesos': d => { const c = {}; let n = 0; for (const l of d.split('\n')) if (/resultado=FALLO/.test(l)) { n++; const u = l.match(/usuario=(\S+)/)[1]; c[u] = (c[u] ?? 0) + 1; } return { fallos: n, usuarioMasFallos: Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] }; },
  'sensores': d => { const l = JSON.parse(d); return { sobre80: l.filter(x => x.valor > 80).length, sensorMaximo: l.reduce((a, b) => (b.valor > a.valor ? b : a)).sensor }; },
};

// Exactitud de Nemotron leyendo lo crudo (aprobadas/intentos), de las corridas reales.
// Entrenamiento: resultados/2026-11-18-04-54-base.json. Reserva: bucle largos 20/11 (base 0/9).
export const nemotronCrudo = { 'log-error': [3, 3], pedidos: [0, 3], pruebas: [3, 3], inventario: [0, 3], accesos: [0, 3], sensores: [0, 3] };

export function calibrar(rutaBase, casos) {
  const filas = JSON.parse(readFileSync(rutaBase, 'utf8')).filas.filter(f => f.nivel === 'largo');
  let car = 0, tok = 0;
  for (const c of casos) { const f = filas.find(x => x.id === c.id); if (!f) continue; car += (c.pregunta + '\n' + c.datos).length; tok += f.entrada; }
  return car / tok;
}

export function medir(caso, filtro, cpt) {
  const t = s => Math.ceil(s.length / cpt);
  const base = t(caso.pregunta + '\n' + caso.datos) + 25;
  let salidaFiltro, verif;
  try { salidaFiltro = JSON.stringify(filtro(caso.datos)); verif = verificarLargo(caso, salidaFiltro); }
  catch (e) { salidaFiltro = 'ERROR ' + e.message; verif = { aprobadas: 0, total: 1 }; }
  const codigo = t(caso.pregunta + '\n' + caso.datos.slice(0, MUESTRA)) + t(filtro.toString()) + t(salidaFiltro) + 25;
  const nemo = t(caso.pregunta) + 60 + 25; // ~60 tokens de resumen de Nemotron + respuesta
  return { id: caso.id, base, nemo, codigo, codigoOk: verif.aprobadas === verif.total };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rutaBase = fileURLToPath(new URL('../eficiencia/resultados/2026-11-18-04-54-base.json', import.meta.url));
  const cpt = existsSync(rutaBase) ? calibrar(rutaBase, casosLargos) : CPT_CALIBRADO;
  if (!existsSync(rutaBase)) console.log('(sin eficiencia/resultados/: uso la calibración guardada del 18/11/2026)');
  const filas = [...casosLargos, ...casosReservaLargos].map(c => ({ ...medir(c, filtros[c.id], cpt), nemoOk: nemotronCrudo[c.id] }));
  console.log(`caracteres por token (calibrado): ${cpt.toFixed(3)}`);
  console.log('caso         base   nemo  codigo  nemo-exact  codigo-exact');
  for (const f of filas) console.log(`${f.id.padEnd(11)} ${String(f.base).padStart(6)} ${String(f.nemo).padStart(6)} ${String(f.codigo).padStart(7)}  ${f.nemoOk.join('/').padStart(9)}  ${f.codigoOk ? '1/1' : '0/1'}`);
  const s = k => filas.reduce((a, f) => a + f[k], 0);
  const okN = filas.reduce((a, f) => a + f.nemoOk[0], 0), totN = filas.reduce((a, f) => a + f.nemoOk[1], 0);
  console.log(`TOTAL       ${s('base')} ${s('nemo')} ${s('codigo')}  nemo ${okN}/${totN}  codigo ${filas.filter(f => f.codigoOk).length}/6`);
  console.log(`ahorro pagado vs base: nemo ${(100 - 100 * s('nemo') / s('base')).toFixed(1)} %, codigo-primero ${(100 - 100 * s('codigo') / s('base')).toFixed(1)} %`);
}
