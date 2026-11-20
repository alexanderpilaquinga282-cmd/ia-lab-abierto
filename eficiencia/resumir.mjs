// Resume resultados/*.json y aplica los criterios congelados de PROTOCOLO.md.
// Usa la corrida más reciente de cada variante. No consulta ningún modelo.
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Criterios congelados el 18/11/2026, antes de cualquier corrida.
export const CRITERIOS = {
  ponytail: { bateria: 'codigo', metrica: 'salida', maximoRelativo: 0.9 },
  'ponytail-sin-cierre': { bateria: 'codigo', metrica: 'salida', maximoRelativo: 0.9 },
  headroom: { bateria: 'largo', metrica: 'entrada', maximoRelativo: 0.8 },
};

const promedio = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function agregar(corrida, grupo) {
  const filas = corrida.filas.filter(f => (grupo === 'largo' ? f.nivel === 'largo' : f.nivel !== 'largo'));
  const ok = filas.filter(f => !f.error);
  return {
    intentos: filas.length,
    aprobadas: filas.filter(f => f.aprobada).length,
    errores: filas.length - ok.length,
    entrada: promedio(ok.map(f => f.entrada).filter(Number.isFinite)),
    salida: promedio(ok.map(f => f.salida).filter(Number.isFinite)),
    segundos: promedio(ok.map(f => f.segundos)),
    modelos: [...new Set(ok.map(f => f.modelo))],
  };
}

export function veredicto(variante, base, corrida) {
  const c = CRITERIOS[variante];
  if (!c) return null;
  const a = agregar(base, c.bateria);
  const b = agregar(corrida, c.bateria);
  if (!a.intentos || !b.intentos) return { aceptada: null, motivo: 'Falta la batería ' + c.bateria + ' en alguna corrida.' };
  const relacion = b[c.metrica] / a[c.metrica];
  const calidad = b.aprobadas / b.intentos >= a.aprobadas / a.intentos;
  const ahorro = relacion <= c.maximoRelativo;
  return {
    aceptada: calidad && ahorro,
    motivo: `calidad ${b.aprobadas}/${b.intentos} vs base ${a.aprobadas}/${a.intentos} (${calidad ? 'ok' : 'baja'}); ` +
      `tokens de ${c.metrica} ${(relacion * 100).toFixed(0)} % de la base (límite ${c.maximoRelativo * 100} %)`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const carpeta = new URL('resultados/', import.meta.url);
  const archivos = (await readdir(carpeta)).filter(n => n.endsWith('.json')).sort();
  const ultimas = new Map();
  for (const nombre of archivos) {
    const corrida = JSON.parse(await readFile(new URL(nombre, carpeta), 'utf8'));
    ultimas.set(corrida.variante, corrida);
  }
  const base = ultimas.get('base');
  const fmt = n => (n == null ? '–' : Math.round(n).toLocaleString('es-CO'));
  console.log('| Variante | Batería | Aprobadas | Errores | Entrada prom. | Salida prom. | Seg. prom. | Modelo verificado |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const [variante, corrida] of ultimas) {
    for (const grupo of ['codigo', 'largo']) {
      const a = agregar(corrida, grupo);
      if (!a.intentos) continue;
      console.log(`| ${variante} | ${grupo} | ${a.aprobadas}/${a.intentos} | ${a.errores} | ${fmt(a.entrada)} | ${fmt(a.salida)} | ${a.segundos?.toFixed(1) ?? '–'} | ${a.modelos.join(', ')} |`);
    }
  }
  if (!base) console.log('\nFalta la corrida base: no se pueden aplicar criterios.');
  else for (const [variante, corrida] of ultimas) {
    const v = veredicto(variante, base, corrida);
    if (v) console.log(`\n${variante}: ${v.aceptada === null ? 'sin veredicto' : v.aceptada ? 'ACEPTADA' : 'DESCARTADA'} · ${v.motivo}`);
  }
}
