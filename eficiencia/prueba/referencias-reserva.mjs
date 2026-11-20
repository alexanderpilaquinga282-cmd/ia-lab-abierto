// Soluciones de referencia de los casos de reserva, escritas a mano. Solo para
// comprobar que los esperados de banco/reserva.mjs son correctos.
const bloque = codigo => '```javascript\n' + codigo.trim() + '\n```';

export const referencias = {
  vocales: bloque(`
function contarVocales(s) {
  if (typeof s !== 'string') return null;
  return (s.toLowerCase().match(/[aeiouáéíóúü]/g) ?? []).length;
}`),
  hora: bloque(`
function formatoHora(segundos) {
  if (!Number.isInteger(segundos) || segundos < 0 || segundos > 359999) return null;
  const dos = n => String(n).padStart(2, '0');
  return dos(Math.floor(segundos / 3600)) + ':' + dos(Math.floor(segundos / 60) % 60) + ':' + dos(segundos % 60);
}`),
  intervalos: bloque(`
function fusionarIntervalos(lista) {
  const orden = lista.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
  const salida = [];
  for (const par of orden) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && par[0] <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], par[1]);
    else salida.push(par);
  }
  return salida;
}`),
  rotar: bloque(`
function rotarMatriz(m) {
  if (m.length === 0) return [];
  return m[0].map((_, c) => m.map(fila => fila[c]).reverse());
}`),
  expresion: bloque(`
function evaluarExpresion(s) {
  if (typeof s !== 'string') return null;
  const t = s.match(/\\d+|[-+*/()]|\\S/g) ?? [];
  let i = 0;
  const fallo = {};
  function primario() {
    const x = t[i];
    if (x === '-') { i++; return -primario(); }
    if (x === '(') { i++; const v = suma(); if (t[i] !== ')') throw fallo; i++; return v; }
    if (x !== undefined && /^\\d+$/.test(x)) { i++; return Number(x); }
    throw fallo;
  }
  function producto() {
    let v = primario();
    while (t[i] === '*' || t[i] === '/') {
      const op = t[i++];
      const d = primario();
      if (op === '/' && d === 0) throw fallo;
      v = op === '*' ? v * d : Math.trunc(v / d);
    }
    return v;
  }
  function suma() {
    let v = producto();
    while (t[i] === '+' || t[i] === '-') { const op = t[i++]; const d = producto(); v = op === '+' ? v + d : v - d; }
    return v;
  }
  try { const v = suma(); return i === t.length ? v + 0 : null; } catch (e) { if (e === fallo) return null; throw e; }
}`),
  camino: bloque(`
function caminoMinimo(grid) {
  const F = grid.length, C = grid[0].length;
  if (grid[0][0] === '#' || grid[F - 1][C - 1] === '#') return -1;
  const dist = new Int32Array(F * C).fill(-1);
  dist[0] = 0;
  const cola = [0];
  for (let k = 0; k < cola.length; k++) {
    const p = cola[k], f = Math.floor(p / C), c = p % C;
    for (const [nf, nc] of [[f + 1, c], [f - 1, c], [f, c + 1], [f, c - 1]]) {
      if (nf >= 0 && nc >= 0 && nf < F && nc < C && grid[nf][nc] === '.' && dist[nf * C + nc] < 0) {
        dist[nf * C + nc] = dist[p] + 1;
        cola.push(nf * C + nc);
      }
    }
  }
  return dist[F * C - 1];
}`),
};
