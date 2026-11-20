// Bucle de mejora de skills: Nemotron propone versiones nuevas de una skill
// (un prompt de sistema), el banco las mide y solo queda la que gana con
// criterios congelados en tokens TOTALES y calidad, confirmada en casos que el
// proponente nunca vio. Cada ganadora se guarda como propuesta para revisión
// humana. No instala nada, no escribe fuera de bucle/ y usa solo datos sintéticos.
//
//   node mejorar.mjs [--bateria codigo|largos] [--generaciones 1] [--candidatas 3]
//                    [--repeticiones 3] [--maximo-consultas 150]
//
// Cada batería guarda su estado aparte: bucle/ (código) y bucle-largos/ (largos).
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { casos as casosEntrenamiento } from './banco/casos.mjs';
import { casosReserva } from './banco/reserva.mjs';
import { casosReservaLargos } from './banco/reserva-largos.mjs';
import { casosLargos } from './casos-largos.mjs';
import { consultar, endpoint, evaluarCasos, MODELO } from './correr.mjs';

// Criterios congelados el 18/11/2026, antes de la primera corrida del bucle.
export const CRITERIO = {
  ahorroMinimo: 0.95, // con la misma calidad: tokens totales ≤ 95 % de la campeona
  toleranciaMejora: 1.1, // si aprueba más: tokens totales ≤ 110 % de la campeona
  largoMaximo: 1200, // caracteres de la skill
};

// Por batería: casos de entrenamiento, casos de reserva (nunca se muestran al
// proponente), carpeta de estado, palabras que una skill no puede nombrar
// (sería aprenderse el examen) y cómo se le describe la tarea al proponente.
// La batería "largos" se agregó el 19/11/2026 con los mismos criterios.
export const BATERIAS = {
  codigo: {
    entrenamiento: casosEntrenamiento,
    reserva: casosReserva,
    carpeta: 'bucle/',
    prohibidas: casosEntrenamiento.flatMap(c => [c.id, c.nombre]),
    tarea: 'un modelo que escribe funciones JavaScript',
    general: 'cualquier encargo de programación',
    nota: 'Cada encargo ya pide "solo la declaración de la función en un bloque JavaScript".',
  },
  largos: {
    entrenamiento: casosLargos,
    reserva: casosReservaLargos,
    carpeta: 'bucle-largos/',
    prohibidas: [...casosLargos.map(c => c.id), 'devuelto', 'devueltos', 'mayorDevuelto',
      ...casosLargos.flatMap(c => Object.values(c.esperado).flat().map(String))],
    tarea: 'un modelo que lee salidas largas de herramientas (logs, JSON, CSV, reportes) y responde con un objeto JSON exacto',
    general: 'cualquier tarea de buscar, contar o agregar datos en una salida larga',
    nota: 'Cada encargo ya pide "responde solo con un objeto JSON" y dice qué campos lleva. Los datos llegan como resultado de una herramienta. Contar mal es el fallo típico.',
  },
};
const escapar = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function medir(filas) {
  const ok = filas.filter(f => !f.error);
  const totales = ok.map(f => f.entrada + f.salida).filter(Number.isFinite);
  const porCaso = {};
  for (const f of filas) {
    const p = (porCaso[f.id] ??= { nivel: f.nivel, aprobadas: 0, intentos: 0, total: 0, motivos: new Set() });
    p.intentos++;
    if (f.aprobada) p.aprobadas++;
    if (!f.error) p.total += f.entrada + f.salida;
    if (!f.aprobada) p.motivos.add(categoria(f));
  }
  for (const p of Object.values(porCaso)) {
    p.total = Math.round(p.total / p.intentos);
    p.motivos = [...p.motivos];
  }
  return {
    intentos: filas.length,
    aprobadas: filas.filter(f => f.aprobada).length,
    errores: filas.length - ok.length,
    total: totales.length ? Math.round(totales.reduce((a, b) => a + b, 0) / totales.length) : null,
    porCaso,
  };
}

// Solo categorías generales: el proponente no ve entradas ni salidas esperadas.
function categoria(f) {
  if (f.error) return 'error de red';
  const motivo = f.pruebas?.fallos?.[0]?.motivo ?? '';
  if (f.pruebas?.fallos?.[0]?.prueba === 'formato') return 'formato (prosa o firma distinta)';
  if (/timed out/.test(motivo)) return 'demasiado lento';
  if (/Modificó la entrada|Reutilizó/.test(motivo)) return 'modifica o reutiliza la entrada';
  return 'resultado incorrecto';
}

export function supera(campeona, candidata, criterio = CRITERIO) {
  if (candidata.errores || campeona.errores) return { gana: false, motivo: 'hubo errores de red: no se decide' };
  const relacion = candidata.total / campeona.total;
  const pct = (relacion * 100).toFixed(0) + ' %';
  const calidad = `${candidata.aprobadas}/${candidata.intentos} vs ${campeona.aprobadas}/${campeona.intentos}`;
  if (candidata.aprobadas > campeona.aprobadas && relacion <= criterio.toleranciaMejora) return { gana: true, motivo: `aprueba más (${calidad}) con ${pct} de tokens` };
  if (candidata.aprobadas === campeona.aprobadas && relacion <= criterio.ahorroMinimo) return { gana: true, motivo: `misma calidad (${calidad}) con ${pct} de tokens` };
  return { gana: false, motivo: `calidad ${calidad}, tokens ${pct}` };
}

// La skill propuesta es datos: se limpia, se limita y se rechaza si nombra los
// casos de entrenamiento (eso sería aprenderse el examen) o trae una clave.
export function limpiarPropuesta(texto, criterio = CRITERIO, prohibidas = BATERIAS.codigo.prohibidas) {
  const m = /<skill>([\s\S]*?)<\/skill>/i.exec(texto ?? '');
  if (!m) return { error: 'sin etiquetas <skill>' };
  const skill = m[1].trim();
  if (!skill) return { error: 'vacía' };
  if (skill.length > criterio.largoMaximo) return { error: `muy larga (${skill.length} caracteres)` };
  if (/nvapi-|https?:\/\//i.test(skill)) return { error: 'contiene una clave o un enlace' };
  const nombrado = prohibidas.find(n => new RegExp('(^|[^\\p{L}\\p{N}_-])' + escapar(n) + '($|[^\\p{L}\\p{N}_-])', 'iu').test(skill));
  if (nombrado) return { error: `nombra un caso de entrenamiento (${nombrado})` };
  return { skill };
}

function pedidoPropuesta(campeona, intentos, b) {
  const casos = Object.entries(campeona.entrenamiento.porCaso)
    .map(([, p], i) => `- encargo ${i + 1} (${p.nivel}): ${p.aprobadas}/${p.intentos} aprobadas, ${p.total} tokens${p.motivos.length ? ', falla por: ' + p.motivos.join(', ') : ''}`)
    .join('\n');
  const previos = intentos.slice(-6).map(x => `- ${x.resultado}: ${JSON.stringify(x.skill.slice(0, 160))}`).join('\n') || '- ninguno';
  return [
    {
      role: 'system',
      content: `Mejoras instrucciones de sistema para ${b.tarea}. ` +
        'El objetivo es aprobar más pruebas y gastar menos tokens en total (entrada + salida). Cada palabra de la instrucción se paga en cada consulta. ' +
        `Escribe reglas generales que sirvan para ${b.general}, sin mencionar encargos concretos. ` +
        `Responde solo con la instrucción nueva entre <skill> y </skill>, en menos de ${CRITERIO.largoMaximo} caracteres.`,
    },
    {
      role: 'user',
      content: `Instrucción actual:\n<skill>${campeona.texto || '(vacía: el modelo no recibe instrucción de sistema)'}</skill>\n\n` +
        `Resultados con la instrucción actual (${campeona.entrenamiento.total} tokens promedio por consulta):\n${casos}\n\n` +
        `${b.nota}\n\n` +
        `Intentos anteriores que no ganaron:\n${previos}\n\nPropón una instrucción distinta y mejor.`,
    },
  ];
}

export async function mejorar({ bateria = 'codigo', generaciones = 1, candidatas = 3, repeticiones = 3, maximoConsultas = 150, pausaMs = 1500, env = process.env, log = console.log, carpeta }) {
  const b = BATERIAS[bateria];
  if (!b) throw new Error('Batería inválida. Usa: ' + Object.keys(BATERIAS).join(', '));
  carpeta ??= new URL(b.carpeta, import.meta.url);
  const { entrenamiento: casosEntrenamiento, reserva: casosReserva } = b;
  const clave = env.NVIDIA_API_KEY;
  if (!clave) throw new Error('Falta NVIDIA_API_KEY en esta terminal.');
  const url = endpoint(env);
  await mkdir(new URL('propuestas/', carpeta), { recursive: true });
  const leer = async (n, d) => { try { return JSON.parse(await readFile(new URL(n, carpeta), 'utf8')); } catch { return d; } };
  let campeona = await leer('campeona.json', null);
  const intentos = await leer('intentos.json', []);

  const porMedicion = (casosEntrenamiento.length + casosReserva.length) * repeticiones;
  const previstas = (campeona ? 0 : porMedicion) + generaciones * (candidatas * (1 + casosEntrenamiento.length * repeticiones) + casosReserva.length * repeticiones);
  if (previstas > maximoConsultas) throw new Error(`Esta corrida haría hasta ${previstas} consultas y el máximo es ${maximoConsultas}. Baja --generaciones o --candidatas, o sube --maximo-consultas.`);
  log(`Batería ${bateria}: hasta ${previstas} consultas a ${MODELO}.`);

  const opciones = { repeticiones, pausaMs, env, log };
  if (!campeona) {
    log('Primera corrida: midiendo la campeona inicial (sin instrucción de sistema).');
    const texto = '';
    campeona = {
      texto, origen: 'inicial (sin skill)', fecha: new Date().toISOString(),
      entrenamiento: medir(await evaluarCasos({ ...opciones, lista: casosEntrenamiento, sistema: null, etiqueta: 'campeona' })),
      reserva: medir(await evaluarCasos({ ...opciones, lista: casosReserva, sistema: null, etiqueta: 'campeona-reserva' })),
    };
    if (campeona.entrenamiento.errores || campeona.reserva.errores) throw new Error('La medición inicial tuvo errores de red; vuelve a correr más tarde.');
    await writeFile(new URL('campeona.json', carpeta), JSON.stringify(campeona, null, 2));
  }
  const inicial = campeona;
  const ganadoras = [];

  for (let g = 1; g <= generaciones; g++) {
    const medidas = [];
    for (let k = 1; k <= candidatas; k++) {
      const r = await consultar(url, clave, pedidoPropuesta(campeona, intentos, b), false, { temperatura: 0.8, maxTokens: 700 }).catch(e => ({ error: e.message }));
      if (r.error === 'HTTP 401' || r.error === 'HTTP 403') throw new Error(`NVIDIA rechazó la clave (${r.error}).`);
      const p = r.error ? { error: r.error } : limpiarPropuesta(r.texto, CRITERIO, b.prohibidas);
      if (p.error) { log(`g${g} candidata ${k}: descartada antes de medir (${p.error})`); continue; }
      const entrenamiento = medir(await evaluarCasos({ ...opciones, lista: casosEntrenamiento, sistema: p.skill, etiqueta: `g${g}c${k}` }));
      const v = supera(campeona.entrenamiento, entrenamiento);
      log(`g${g} candidata ${k}: ${v.gana ? 'pasa a reserva' : 'no gana'} · ${v.motivo}`);
      intentos.push({ fecha: new Date().toISOString(), skill: p.skill, resultado: v.motivo });
      if (v.gana) medidas.push({ skill: p.skill, entrenamiento });
    }
    medidas.sort((a, b) => b.entrenamiento.aprobadas - a.entrenamiento.aprobadas || a.entrenamiento.total - b.entrenamiento.total);
    const mejor = medidas[0];
    if (!mejor) { log(`g${g}: ninguna candidata superó a la campeona.`); continue; }
    const reserva = medir(await evaluarCasos({ ...opciones, lista: casosReserva, sistema: mejor.skill, etiqueta: `g${g}-reserva` }));
    const v = supera(campeona.reserva, reserva);
    log(`g${g} confirmación en reserva: ${v.gana ? 'GANA' : 'no se confirma'} · ${v.motivo}`);
    if (!v.gana) { intentos.push({ fecha: new Date().toISOString(), skill: mejor.skill, resultado: 'ganó en entrenamiento pero no en reserva: ' + v.motivo }); continue; }
    campeona = { texto: mejor.skill, origen: `generación ${g}`, fecha: new Date().toISOString(), entrenamiento: mejor.entrenamiento, reserva };
    ganadoras.push(campeona);
    await writeFile(new URL('campeona.json', carpeta), JSON.stringify(campeona, null, 2));
    const nombre = campeona.fecha.slice(0, 16).replace(/[:T]/g, '-') + '-g' + g + '.md';
    await writeFile(new URL('propuestas/' + nombre, carpeta), propuestaMarkdown(campeona, inicial, bateria, casosReserva.length));
    log(`Propuesta guardada en ${b.carpeta}propuestas/${nombre}`);
  }
  await writeFile(new URL('intentos.json', carpeta), JSON.stringify(intentos, null, 2));
  await appendFile(new URL('historial.md', carpeta), `- ${new Date().toISOString()}: ${generaciones} generación(es), ${ganadoras.length} ganadora(s). Campeona: ${campeona.origen}, ${campeona.entrenamiento.total} tokens, ${campeona.entrenamiento.aprobadas}/${campeona.entrenamiento.intentos} entrenamiento, ${campeona.reserva.aprobadas}/${campeona.reserva.intentos} reserva.\n`);
  return { campeona, ganadoras };
}

function propuestaMarkdown(c, inicial, bateria, nReserva) {
  const fila = (n, m, b) => `| ${n} | ${m.aprobadas}/${m.intentos} | ${m.total} | ${b.aprobadas}/${b.intentos} | ${b.total} |`;
  return `---
tipo: propuesta de skill
estado: pendiente de revisión
origen: ${c.origen}
bateria: ${bateria}
fecha: ${c.fecha}
modelo: ${MODELO}
---
# Propuesta de skill (${c.origen})

No se aplica sola. Revísala; si la apruebas, cópiala a mano como instrucción de sistema donde quieras usarla.

## Texto

\`\`\`text
${c.texto}
\`\`\`

## Números (tokens totales por consulta = entrada + salida)

| | Entrenamiento aprobadas | Entrenamiento tokens | Reserva aprobadas | Reserva tokens |
|---|---|---|---|---|
${fila('Sin skill', inicial.entrenamiento, inicial.reserva)}
${fila('Esta propuesta', c.entrenamiento, c.reserva)}

Reserva = ${nReserva} encargos que el modelo que propone nunca vio. Medido con ${MODELO}; con Codex o Claude hay que volver a medir.
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      bateria: { type: 'string', default: 'codigo' },
      generaciones: { type: 'string', default: '1' },
      candidatas: { type: 'string', default: '3' },
      repeticiones: { type: 'string', default: '3' },
      'maximo-consultas': { type: 'string', default: '150' },
    },
  });
  await mejorar({
    bateria: values.bateria, generaciones: Number(values.generaciones), candidatas: Number(values.candidatas),
    repeticiones: Number(values.repeticiones), maximoConsultas: Number(values['maximo-consultas']),
  }).catch(e => { console.error(e.message); process.exit(1); });
}
