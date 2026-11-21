// Prueba en vivo del servidor ia_lab_ahorro por stdio, como lo lanzan Codex o Claude.
// Sin red y sin clave: usa solo calcular_con_codigo y los rechazos. Mide el ahorro real
// en los archivos de demo (tokens del archivo entero vs. tokens que lee el modelo pagado).
// Uso: node kit/probar-en-vivo.mjs   → imprime un JSON y sale con 1 si algo no da lo esperado.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const MUESTRA = 1500; // caracteres, igual que codigo-primero.mjs
const KIT = dirname(fileURLToPath(import.meta.url));

const PEDIDOS = "function calcular(t){const p=JSON.parse(t).filter(x=>x.estado==='devuelto');return {devueltos:p.length,mayor:p.reduce((a,b)=>b.monto>a.monto?b:a).id}}";
const LOG = "function calcular(t){const l=t.split('\\n').find(x=>/ ERROR /.test(x));return {codigo:l.match(/codigo=(\\S+)/)[1],req:l.match(/req=(\\S+)/)[1]}}";

export async function probar({ raiz = resolve(KIT, '..'), env = process.env } = {}) {
  const hijo = spawn(process.execPath, [join(KIT, 'ahorro-mcp.mjs')], { cwd: raiz, env: { ...env, IA_LAB_RAIZ: raiz }, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  hijo.stderr.on('data', d => (err += d));
  const espera = new Map();
  createInterface({ input: hijo.stdout }).on('line', l => { const m = JSON.parse(l); espera.get(m.id)?.(m); });
  let n = 0;
  const pedir = (method, params) => new Promise((ok, mal) => {
    const id = ++n;
    const t = setTimeout(() => mal(new Error(`sin respuesta a ${method}. ${err}`)), 15000);
    espera.set(id, m => { clearTimeout(t); ok(m); });
    hijo.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const llamar = async (name, args) => { const r = (await pedir('tools/call', { name, arguments: args })).result; return { error: !!r.isError, texto: r.content[0].text }; };
  const salida = new Promise(ok => hijo.on('exit', c => ok(c)));
  try {
    await Promise.race([pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probar-en-vivo', version: '1' } }), salida.then(c => { throw new Error(`el servidor salió con ${c}: ${err.trim()}`); })]);
    hijo.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const herramientas = (await pedir('tools/list', {})).result.tools.map(h => h.name);
    const demo = f => join(raiz, 'kit', 'demo', f);
    const casos = [];
    for (const [archivo, funcion, esperado] of [['pedidos-ficticios.json', PEDIDOS, { devueltos: 65, mayor: 'P-0090' }], ['log-ficticio.txt', LOG, { codigo: 'E-4583', req: 'r-49817' }]]) {
      const r = await llamar('calcular_con_codigo', { archivo: demo(archivo), funcion });
      const real = r.error ? r.texto : JSON.parse(r.texto);
      const texto = readFileSync(demo(archivo), 'utf8');
      const tokensArchivo = Math.ceil(texto.length / 4);
      // Lo que paga el modelo: una muestra para conocer el formato + la función que escribe + el resultado.
      const tokensPagados = Math.ceil(texto.slice(0, MUESTRA).length / 4) + Math.ceil(funcion.length / 4) + Math.ceil(r.texto.length / 4);
      casos.push({ archivo, ok: JSON.stringify(real) === JSON.stringify(esperado), respuesta: real, tokensArchivo, tokensPagados, ahorro: `${(100 - 100 * tokensPagados / tokensArchivo).toFixed(1)} %` });
    }
    const rechazoConfig = await llamar('calcular_con_codigo', { archivo: join(raiz, 'config', 'temas-privados.txt'), funcion: 'function calcular(t){return t.length}' });
    const rechazoContar = await llamar('leer_con_nemotron', { archivo: demo('pedidos-ficticios.json'), tarea: 'cuenta cuántos pedidos devueltos hay' });
    const estado = JSON.parse((await llamar('estado_ahorro', {})).texto);
    const informe = {
      herramientas,
      casos,
      bloqueaConfigPrivada: rechazoConfig.error,
      rechazaContarEnNemotron: rechazoContar.error && /calcular_con_codigo/.test(rechazoContar.texto),
      registro: estado.total,
    };
    informe.todoOk = casos.every(c => c.ok) && informe.bloqueaConfigPrivada && informe.rechazaContarEnNemotron && herramientas.length === 3;
    return informe;
  } finally { hijo.kill(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  probar().then(i => { console.log(JSON.stringify(i, null, 2)); process.exit(i.todoOk ? 0 : 1); })
    .catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
}
