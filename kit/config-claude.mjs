// Agrega o quita SOLO la entrada ia_lab_ahorro en un claude_desktop_config.json, sin tocar nada más.
//   node config-claude.mjs <ruta-config> <ruta-node> <ruta-servidor> [--quitar]
// Usa JSON.parse/JSON.stringify para no alterar el resto de ajustes de la app. Hace respaldo antes.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export function fusionar(texto, node, servidor, quitar = false) {
  const json = texto && texto.trim() ? JSON.parse(texto.replace(/^\uFEFF/, '')) : {};
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('La config no es un objeto JSON.');
  if (json.mcpServers !== undefined && (json.mcpServers === null || typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers))) throw new Error('mcpServers no es un objeto.');
  json.mcpServers ??= {};
  delete json.mcpServers.ia_lab_ahorro;
  if (!quitar) json.mcpServers.ia_lab_ahorro = { command: node, args: [servidor] };
  return JSON.stringify(json, null, 2) + '\n';
}

if (process.argv[1]?.endsWith('config-claude.mjs')) {
  const [ruta, node, servidor, bandera] = process.argv.slice(2);
  if (!ruta || !node || !servidor) { console.error('Uso: node config-claude.mjs <config> <node> <servidor> [--quitar]'); process.exit(2); }
  const quitar = bandera === '--quitar';
  const previo = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
  const nuevo = fusionar(previo, node, servidor, quitar);
  if (previo) {
    const respaldo = ruta.replace(/\.json$/i, '') + '.antes-ia-lab-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
    copyFileSync(ruta, respaldo);
    console.log('Respaldo: ' + respaldo);
  }
  const temporal = ruta + '.tmp-ia-lab';
  writeFileSync(temporal, nuevo, 'utf8');
  renameSync(temporal, ruta);
  // Relectura: la entrada quedó (o se fue) y el resto de claves sigue igual.
  const releido = JSON.parse(readFileSync(ruta, 'utf8'));
  const antes = previo.trim() ? JSON.parse(previo.replace(/^\uFEFF/, '')) : {};
  const otras = k => JSON.stringify(Object.fromEntries(Object.entries(k).filter(([c]) => c !== 'mcpServers')));
  const otrosServ = k => JSON.stringify(Object.fromEntries(Object.entries(k.mcpServers ?? {}).filter(([c]) => c !== 'ia_lab_ahorro')));
  if (otras(releido) !== otras(antes) || otrosServ(releido) !== otrosServ(antes)) { console.error('FALLO: cambió algo más que ia_lab_ahorro.'); process.exit(1); }
  const e = releido.mcpServers?.ia_lab_ahorro;
  if (quitar ? e : !(e && e.command === node && e.args?.[0] === servidor)) { console.error('FALLO: la entrada no quedó como se esperaba.'); process.exit(1); }
  console.log((quitar ? 'QUITADO de ' : 'ESCRITO en ') + ruta);
}
