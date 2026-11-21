// Imágenes sintéticas para el banco de visión (propuesta B del kit NVIDIA, firmada el 20/11/2026).
// PNG generados con código (sin dependencias), semilla fija, respuesta correcta calculada aquí.
import { deflateSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

// Fuente 5x7: cada carácter son 7 filas de 5 bits.
const F = {
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0], '.': [0, 0, 0, 0, 0, 12, 12], '=': [0, 0, 31, 0, 31, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0],
};

export function lienzo(ancho, alto, fondo = [255, 255, 255]) {
  const px = Buffer.alloc(ancho * alto * 3);
  for (let i = 0; i < ancho * alto; i++) px.set(fondo, i * 3);
  return { ancho, alto, px };
}
export function rect(l, x, y, w, h, color) {
  for (let j = Math.max(0, y); j < Math.min(l.alto, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(l.ancho, x + w); i++) l.px.set(color, (j * l.ancho + i) * 3);
}
export function escribir(l, texto, x, y, escala = 4, color = [20, 20, 20]) {
  for (const [k, ch] of [...texto.toUpperCase()].entries()) {
    const g = F[ch];
    if (!g) throw new Error('Carácter sin glifo: ' + ch);
    g.forEach((fila, j) => { for (let b = 0; b < 5; b++) if (fila & (16 >> b)) rect(l, x + k * 6 * escala + b * escala, y + j * escala, escala, escala, color); });
  }
}

const tablaCrc = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = tablaCrc[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function trozo(tipo, datos) {
  const t = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(t));
  return Buffer.concat([largo, t, crc]);
}
export function png(l) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l.ancho, 0); ihdr.writeUInt32BE(l.alto, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const crudo = Buffer.alloc((l.ancho * 3 + 1) * l.alto);
  for (let y = 0; y < l.alto; y++) l.px.copy(crudo, y * (l.ancho * 3 + 1) + 1, y * l.ancho * 3, (y + 1) * l.ancho * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

function azar(semilla) { let s = semilla >>> 0; return n => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return (s >>> 16) % n; }; }
const pad = (n, k) => String(n).padStart(k, '0');

function casoError() {
  const a = azar(11), l = lienzo(760, 260, [245, 245, 245]);
  const codigo = 'E-' + (4000 + a(999)), req = 'R-' + pad(10000 + a(89999), 5);
  for (let i = 0; i < 6; i++) escribir(l, i === 3 ? `ERROR ${codigo} ${req}` : `INFO GET ${100 + a(800)} OK`, 16, 16 + i * 38, 4, i === 3 ? [190, 20, 20] : [60, 60, 60]);
  return { id: 'captura-error', tipo: 'leer', l, pregunta: 'Es una captura ficticia de un log. Hay una sola línea ERROR. Responde solo un JSON {"codigo": "...", "req": "..."} con el código (E-...) y el req (R-...) de esa línea.', esperado: { codigo, req } };
}
function casoTotal() {
  const a = azar(22), l = lienzo(560, 160);
  const total = 10000 + a(89999);
  escribir(l, 'RESUMEN FICTICIO', 16, 16, 4); escribir(l, `TOTAL: ${total}`, 16, 80, 6, [10, 60, 150]);
  return { id: 'numero-total', tipo: 'leer', l, pregunta: 'Imagen ficticia. Responde solo un JSON {"total": <número>} con el número que aparece después de TOTAL.', esperado: { total } };
}
function casoTabla() {
  const a = azar(33), l = lienzo(520, 260);
  const nombres = ['NORTE', 'SUR', 'CENTRO', 'OESTE', 'ESTE'];
  const filas = nombres.map(n => [n, 100 + a(900)]);
  filas.forEach(([n, v], i) => { escribir(l, n, 16, 16 + i * 46, 4); escribir(l, String(v), 300, 16 + i * 46, 4); rect(l, 10, 52 + i * 46, 500, 2, [200, 200, 200]); });
  return { id: 'tabla', tipo: 'leer', l, pregunta: 'Tabla ficticia de dos columnas. Responde solo un JSON {"CENTRO": <número>, "OESTE": <número>} con los valores de esas filas.', esperado: { CENTRO: filas[2][1], OESTE: filas[3][1] } };
}
function casoSerie() {
  const a = azar(44), l = lienzo(560, 120);
  const letras = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';
  const serie = Array.from({ length: 8 }, () => letras[a(letras.length)]).join('');
  escribir(l, 'SERIE ' + serie, 16, 30, 5);
  return { id: 'serie', tipo: 'leer', l, pregunta: 'Imagen ficticia con un código de serie. Responde solo un JSON {"serie": "..."} con los 8 caracteres después de SERIE, en mayúsculas.', esperado: { serie } };
}
function casoBarras() {
  const a = azar(55), l = lienzo(620, 340);
  const et = ['A', 'B', 'C', 'D', 'E', 'F'];
  const alt = et.map(() => 40 + a(200));
  const max = alt.indexOf(Math.max(...alt)); alt[max] += 15;
  et.forEach((e, i) => { rect(l, 40 + i * 95, 300 - alt[i], 60, alt[i], [40, 110, 200]); escribir(l, e, 58 + i * 95, 310, 4); });
  return { id: 'barras', tipo: 'leer', l, pregunta: 'Gráfico de barras ficticio con barras A a F. Responde solo un JSON {"mayor": "<letra>"} con la letra de la barra más alta.', esperado: { mayor: et[max] } };
}
function casoContar() {
  const a = azar(66), l = lienzo(600, 400);
  const n = 7 + a(6);
  const ocupadas = new Set();
  for (let k = 0; k < n;) { const c = a(10), f = a(6); if (ocupadas.has(c + ',' + f)) continue; ocupadas.add(c + ',' + f); rect(l, 20 + c * 58, 20 + f * 62, 40, 40, [200, 40, 40]); k++; }
  for (let k = 0; k < 5; k++) rect(l, 30 + a(540), 30 + a(340), 14, 14, [40, 160, 60]);
  return { id: 'contar-rojos', tipo: 'contar', l, pregunta: 'Imagen ficticia con cuadrados rojos grandes y cuadrados verdes pequeños. Responde solo un JSON {"rojos": <número>} con cuántos cuadrados rojos hay.', esperado: { rojos: n } };
}

export const casosVision = [casoError(), casoTotal(), casoTabla(), casoSerie(), casoBarras(), casoContar()]
  .map(({ l, ...c }) => ({ ...c, ancho: l.ancho, alto: l.alto, png: png(l) }));

// Tokens que gastaría Claude leyendo la imagen: (ancho × alto) / 750, fórmula publicada por Anthropic.
export const tokensImagenClaude = c => Math.ceil((c.ancho * c.alto) / 750);

export function verificarVision(caso, respuesta) {
  const t = String(respuesta ?? '').trim();
  const j = t.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)?.[1] ?? t;
  let o; try { o = JSON.parse(j); } catch { return { aprobada: false, motivo: 'No es JSON' }; }
  return isDeepStrictEqual(o, caso.esperado) ? { aprobada: true } : { aprobada: false, motivo: 'Obtenido ' + JSON.stringify(o).slice(0, 120) };
}
