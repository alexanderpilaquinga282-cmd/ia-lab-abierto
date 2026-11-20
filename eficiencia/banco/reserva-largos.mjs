// Casos largos de RESERVA para el bucle de mejora con --bateria largos.
// Nunca se muestran al modelo que propone skills. Son tareas de contar y
// agregar sobre salidas largas de herramienta, el tipo donde Nemotron falla
// (ver "pedidos" en casos-largos.mjs). Todo ficticio, con semilla fija; la
// respuesta correcta la calcula el código.
import { generador } from '../casos-largos.mjs';

const pad = (n, largo) => String(n).padStart(largo, '0');

function casoInventario() {
  const azar = generador(9031);
  const bodegas = ['norte', 'sur', 'centro'];
  const filas = Array.from({ length: 250 }, (_, i) => {
    const minimo = 10 + azar(40);
    const stock = azar(5) === 0 ? azar(minimo) : minimo + azar(60);
    return { sku: 'K-' + pad(i + 1, 4), bodega: bodegas[azar(3)], stock, minimo };
  });
  const bajos = filas.filter(f => f.stock < f.minimo);
  const peor = bajos.reduce((a, b) => (b.minimo - b.stock > a.minimo - a.stock ? b : a));
  // Un único déficit máximo evita respuestas ambiguas.
  peor.minimo = Math.max(...bajos.map(f => f.minimo - f.stock)) + peor.stock + 1;
  return {
    id: 'inventario',
    nivel: 'largo',
    pregunta: 'La herramienta devolvió un inventario ficticio en CSV. Cuenta las filas con stock menor que minimo y di el sku con el mayor déficit (minimo - stock). Responde solo con un objeto JSON {"bajoMinimo": <número>, "mayorDeficit": "<sku>"}.',
    datos: ['sku,bodega,stock,minimo', ...filas.map(f => `${f.sku},${f.bodega},${f.stock},${f.minimo}`)].join('\n'),
    esperado: { bajoMinimo: bajos.length, mayorDeficit: peor.sku },
  };
}

function casoAccesos() {
  const azar = generador(5150);
  const usuarios = Array.from({ length: 12 }, (_, i) => 'u-' + pad(i + 1, 2));
  const lineas = [];
  const fallos = new Map();
  for (let i = 0; i < 800; i++) {
    const usuario = usuarios[azar(usuarios.length)];
    const falla = azar(9) === 0;
    if (falla) fallos.set(usuario, (fallos.get(usuario) ?? 0) + 1);
    lineas.push(`2026-11-19T08:${pad(Math.floor(i / 60) % 60, 2)}:${pad(i % 60, 2)}Z login usuario=${usuario} resultado=${falla ? 'FALLO' : 'OK'} ip=10.0.${azar(255)}.${azar(255)}`);
  }
  // Un único usuario con más fallos: se le agrega uno al final.
  const [lider] = [...fallos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  lineas.push(`2026-11-19T09:00:00Z login usuario=${lider} resultado=FALLO ip=10.0.0.1`);
  const total = [...fallos.values()].reduce((a, b) => a + b, 0) + 1;
  return {
    id: 'accesos',
    nivel: 'largo',
    pregunta: 'La herramienta devolvió un registro ficticio de inicios de sesión. Cuenta las líneas con resultado=FALLO y di el usuario con más fallos. Responde solo con un objeto JSON {"fallos": <número>, "usuarioMasFallos": "<usuario>"}.',
    datos: lineas.join('\n'),
    esperado: { fallos: total, usuarioMasFallos: lider },
  };
}

function casoSensores() {
  const azar = generador(6262);
  const lecturas = Array.from({ length: 320 }, (_, i) => ({
    n: i + 1,
    sensor: 'S-' + pad(1 + azar(20), 2),
    valor: Number((azar(9000) / 100).toFixed(2)),
  }));
  // Una sola lectura máxima, por encima de todas las demás.
  const elegida = lecturas[azar(lecturas.length)];
  elegida.valor = 99.37;
  return {
    id: 'sensores',
    nivel: 'largo',
    pregunta: 'La herramienta devolvió lecturas ficticias de sensores en JSON. Cuenta las lecturas con valor mayor que 80 y di el sensor de la lectura más alta. Responde solo con un objeto JSON {"sobre80": <número>, "sensorMaximo": "<sensor>"}.',
    datos: JSON.stringify(lecturas),
    esperado: { sobre80: lecturas.filter(l => l.valor > 80).length, sensorMaximo: elegida.sensor },
  };
}

export const casosReservaLargos = [casoInventario(), casoAccesos(), casoSensores()];
