// Conecta (o quita) el kit de ahorro en Codex sin tocar nada más de su configuración.
//   config.toml : agrega o reemplaza solo la tabla [mcp_servers.ia_lab_ahorro].
//   AGENTS.md   : agrega o reemplaza solo el bloque entre las marcas ia-lab-ahorro.
// La clave NVIDIA nunca pasa por aquí: el servidor la pide en su propio cuadro de Windows.
// Uso: node kit/config-codex.mjs <carpeta .codex> <raíz del taller> [--quitar]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TABLA = 'mcp_servers.ia_lab_ahorro';
const INICIO = '<!-- ia-lab-ahorro:inicio -->';
const FIN = '<!-- ia-lab-ahorro:fin -->';

const literal = s => {
  if (/['\r\n]/.test(s)) throw new Error(`ruta no válida para TOML: ${s}`);
  return `'${s}'`;
};

export function bloqueToml(raiz, node = 'node') {
  return [
    `[${TABLA}]`,
    `command = ${literal(node)}`,
    `args = [${literal(join(raiz, 'kit', 'ahorro-mcp.mjs'))}]`,
    `env = { IA_LAB_RAIZ = ${literal(raiz)} }`,
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 120',
  ].join('\n');
}

// Quita la tabla (y sus subtablas, p. ej. [mcp_servers.ia_lab_ahorro.env]) hasta el siguiente encabezado ajeno.
export function quitarTabla(toml) {
  const lineas = toml.split(/\r?\n/);
  const fuera = [];
  let dentro = false;
  for (const l of lineas) {
    const h = l.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (h) dentro = h[1] === TABLA || h[1].startsWith(TABLA + '.');
    if (!dentro) fuera.push(l);
  }
  return fuera.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + (fuera.some(l => l.trim()) ? '\n' : '');
}

export function conectarToml(toml, raiz, node) {
  const base = quitarTabla(toml ?? '');
  return (base ? base + '\n' : '') + bloqueToml(raiz, node) + '\n';
}

export function regla(raiz) {
  return `${INICIO}
## Regla de ahorro de tokens (IA Lab)
- Archivos de más de ~200 líneas o ~20 KB (logs, JSON, CSV, reportes): NO los leas enteros.
- Contar, sumar, filtrar, agrupar, máximos o mínimos: mira 20-40 líneas de muestra, escribe un script corto
  (node o PowerShell) que calcule y lee solo el resultado. Dentro de ${raiz} también sirve la herramienta
  MCP \`ia_lab_ahorro\` → \`calcular_con_codigo\`.
- Buscar una línea o resumir un archivo largo de datos ficticios del taller: \`leer_con_nemotron\`
  (verifica lo que diga antes de afirmarlo). Si pide la clave, la persona la pega en el cuadro de Windows.
- Nunca mandes a NVIDIA ni a modelos gratuitos nada privado (los temas de config\\temas-privados.txt), ni claves.
- Si una herramienta rechaza un archivo, no insistas ni lo mandes por otra vía.
${FIN}`;
}

export function quitarRegla(md) {
  const i = md.indexOf(INICIO), f = md.indexOf(FIN);
  if (i < 0 || f < i) return md;
  return (md.slice(0, i).replace(/\s+$/, '') + '\n' + md.slice(f + FIN.length).replace(/^\s+/, '')).replace(/^\s+$/, '');
}

export function conectarRegla(md, raiz) {
  const base = quitarRegla(md ?? '').replace(/\s+$/, '');
  return (base ? base + '\n\n' : '') + regla(raiz) + '\n';
}

function respaldar(ruta, sello) {
  if (!existsSync(ruta)) return null;
  const copia = `${ruta}.antes-kit-${sello}`;
  if (!existsSync(copia)) copyFileSync(ruta, copia);
  return copia;
}

export function aplicar({ codexHome, raiz, node = 'node', quitar = false, sello = new Date().toISOString().slice(0, 10) }) {
  mkdirSync(codexHome, { recursive: true });
  const toml = join(codexHome, 'config.toml'), agents = join(codexHome, 'AGENTS.md');
  const leer = r => (existsSync(r) ? readFileSync(r, 'utf8') : '');
  const respaldos = [respaldar(toml, sello), respaldar(agents, sello)].filter(Boolean);
  writeFileSync(toml, quitar ? quitarTabla(leer(toml)) : conectarToml(leer(toml), raiz, node), 'utf8');
  writeFileSync(agents, quitar ? quitarRegla(leer(agents)) : conectarRegla(leer(agents), raiz), 'utf8');
  return { toml, agents, respaldos };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [codexHome, raiz] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!codexHome || !raiz) { console.error('Uso: node config-codex.mjs <carpeta .codex> <raíz> [--quitar]'); process.exit(2); }
  const r = aplicar({ codexHome: resolve(codexHome), raiz: resolve(raiz), node: process.execPath, quitar: process.argv.includes('--quitar') });
  console.log(JSON.stringify(r, null, 2));
}
