// Resumen del ahorro real de Claude con ia_lab_ahorro.  node ahorro.mjs [--nota <carpeta>]
// Con --nota escribe "Ahorro en vivo de Claude.md" en esa carpeta (por ejemplo, tu bóveda de Obsidian).
// Si existe config/nota-pie.md, su texto va al final de la nota (enlaces de tu bóveda).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carpetaConfig } from './guardas.mjs';
import { leerRegistro, resumen } from './registro.mjs';

export function nota(filas, hoy = new Date().toISOString().slice(0, 10), pie = '') {
  const { por, total } = resumen(filas);
  const fila = (n, r) => `| ${n} | ${r.llamadas} | ${r.fallos} | ${r.tokensArchivo.toLocaleString('es-CO')} | ${r.tokensQueLeeClaude.toLocaleString('es-CO')} | ${r.evitados.toLocaleString('es-CO')} |`;
  return `---
tipo: medicion
area: ia-lab
conexion: taller
datos: sinteticos
estado: vivo
actualizado: ${hoy}
fuente: .local/ahorro/registro.jsonl del taller (solo números)
tags: [ia-lab, ahorro, kit-nvidia]
---
# Ahorro en vivo de Claude (ia_lab_ahorro)

Generado por \`ahorro.mjs --nota\`. No editar a mano.

| herramienta | llamadas | fallos o rechazos | tokens del archivo | tokens que leyó Claude | evitados |
|---|---|---|---|---|---|
${Object.entries(por).map(([n, r]) => fila(n, r)).join('\n') || '| (sin uso todavía) | 0 | 0 | 0 | 0 | 0 |'}

**Total:** ${total.archivo.toLocaleString('es-CO')} tokens de archivo, Claude leyó ${total.lee.toLocaleString('es-CO')}: **${total.porcentaje} % menos**.

- \`leer_con_nemotron\` usa los tokens que reporta NVIDIA (tokenizador de Nemotron, no el de Claude).
- \`calcular_con_codigo\` estima 4 caracteres por token (subestima el ahorro en logs).
- Exactitud: no se mide aquí; la mide el banco (\`eficiencia/\` y \`kit/codigo-primero.mjs\`).
${pie ? '\n' + pie.trim() + '\n' : ''}`;
}

if (process.argv[1]?.endsWith('ahorro.mjs')) {
  const filas = leerRegistro();
  console.log(JSON.stringify(resumen(filas), null, 1));
  const i = process.argv.indexOf('--nota');
  if (i > 0) {
    const carpeta = process.argv[i + 1];
    if (!carpeta || !existsSync(carpeta)) { console.error('Uso: node ahorro.mjs --nota <carpeta existente>'); process.exit(2); }
    const rutaPie = join(carpetaConfig(), 'nota-pie.md');
    const pie = existsSync(rutaPie) ? readFileSync(rutaPie, 'utf8') : '';
    const destino = join(carpeta, 'Ahorro en vivo de Claude.md');
    writeFileSync(destino, nota(filas, undefined, pie), 'utf8');
    console.log('Nota escrita en ' + destino);
  }
}
