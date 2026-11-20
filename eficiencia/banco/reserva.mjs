// Casos de RESERVA para el bucle de mejora (mejorar.mjs).
// Nunca se muestran al modelo que propone skills: solo sirven para confirmar que
// una skill ganadora mejora en encargos que no vio. Mismo formato que casos.mjs.
// Todo sintético.
const instrucciones = 'Devuelve solo la declaración de la función en un bloque JavaScript. Sin imports, dependencias ni entrada o salida externa. No modifiques la entrada.';

function prueba(args, esperado) {
  return { args, esperado };
}

function generador(semilla) {
  let estado = semilla;
  return limite => {
    estado = (Math.imul(1664525, estado) + 1013904223) >>> 0;
    return (estado >>> 16) % limite;
  };
}

// Referencia para generar los esperados de caminoMinimo (BFS).
function bfs(grid) {
  const filas = grid.length;
  const columnas = grid[0].length;
  if (grid[0][0] === '#' || grid[filas - 1][columnas - 1] === '#') return -1;
  const dist = Array.from({ length: filas }, () => new Array(columnas).fill(-1));
  dist[0][0] = 0;
  const cola = [[0, 0]];
  for (let i = 0; i < cola.length; i++) {
    const [f, c] = cola[i];
    for (const [df, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nf = f + df;
      const nc = c + dc;
      if (nf >= 0 && nc >= 0 && nf < filas && nc < columnas && grid[nf][nc] === '.' && dist[nf][nc] < 0) {
        dist[nf][nc] = dist[f][c] + 1;
        cola.push([nf, nc]);
      }
    }
  }
  return dist[filas - 1][columnas - 1];
}

function pruebasCaminoGeneradas() {
  const siguiente = generador(2027);
  return [[60, 60, 25], [150, 150, 30], [200, 180, 20], [120, 200, 40]].map(([filas, columnas, muro]) => {
    const grid = Array.from({ length: filas }, (_, f) =>
      Array.from({ length: columnas }, (_, c) => ((f === 0 && c === 0) || (f === filas - 1 && c === columnas - 1) || siguiente(100) >= muro ? '.' : '#')).join(''));
    return prueba([grid], bfs(grid));
  });
}

export const casosReserva = [
  {
    id: 'vocales',
    nivel: 'simple',
    nombre: 'contarVocales',
    prompt: 'Escribe contarVocales(s). Si s es un string, devuelve cuántas vocales tiene, sin distinguir mayúsculas: a, e, i, o, u y también á, é, í, ó, ú, ü. Para cualquier otra entrada devuelve null.',
    pruebas: [
      prueba(['murciélago'], 5),
      prueba(['RITMO'], 2),
      prueba([''], 0),
      prueba(['pingüino'], 4),
      prueba(['xyz 123'], 0),
      prueba(['ÁÉÍÓÚ'], 5),
      prueba([42], null),
      prueba([null], null),
    ],
  },
  {
    id: 'hora',
    nivel: 'simple',
    nombre: 'formatoHora',
    prompt: 'Escribe formatoHora(segundos). Para un entero de 0 a 359999 devuelve el texto "HH:MM:SS" con dos dígitos por campo. Para cualquier entrada inválida devuelve null.',
    pruebas: [
      prueba([0], '00:00:00'),
      prueba([59], '00:00:59'),
      prueba([3600], '01:00:00'),
      prueba([86399], '23:59:59'),
      prueba([359999], '99:59:59'),
      prueba([360000], null),
      prueba([-1], null),
      prueba([12.5], null),
      prueba(['60'], null),
    ],
  },
  {
    id: 'intervalos',
    nivel: 'media',
    nombre: 'fusionarIntervalos',
    prompt: 'Escribe fusionarIntervalos(lista). Recibe pares [inicio, fin] de enteros desordenados con inicio <= fin. Une los que se solapan o comparten un extremo y devuelve un array de pares nuevos ordenado por inicio.',
    paresNuevos: true,
    pruebas: [
      prueba([[]], []),
      prueba([[[1, 3], [2, 6], [8, 10]]], [[1, 6], [8, 10]]),
      prueba([[[5, 7], [1, 5]]], [[1, 7]]),
      prueba([[[4, 4], [1, 2], [3, 3]]], [[1, 2], [3, 3], [4, 4]]),
      prueba([[[1, 10], [2, 3], [4, 5]]], [[1, 10]]),
      prueba([[[-5, -1], [-3, 2], [7, 9], [9, 9]]], [[-5, 2], [7, 9]]),
    ],
  },
  {
    id: 'rotar',
    nivel: 'media',
    nombre: 'rotarMatriz',
    prompt: 'Escribe rotarMatriz(m). Recibe una matriz rectangular como array de filas y devuelve una matriz nueva rotada 90 grados en sentido horario. Para un array vacío devuelve [].',
    pruebas: [
      prueba([[]], []),
      prueba([[[1]]], [[1]]),
      prueba([[[1, 2], [3, 4]]], [[3, 1], [4, 2]]),
      prueba([[[1, 2, 3], [4, 5, 6]]], [[4, 1], [5, 2], [6, 3]]),
      prueba([[[1], [2], [3]]], [[3, 2, 1]]),
      prueba([[['a', 'b'], ['c', 'd'], ['e', 'f']]], [['e', 'c', 'a'], ['f', 'd', 'b']]),
    ],
  },
  {
    id: 'expresion',
    nivel: 'compleja',
    nombre: 'evaluarExpresion',
    prompt: 'Escribe evaluarExpresion(s) sin usar eval ni Function. s tiene enteros no negativos, los operadores + - * /, paréntesis y espacios. * y / tienen prioridad sobre + y -, y se asocia de izquierda a derecha. La división es entera y trunca hacia cero. Se permite un menos unario delante de un número o de un paréntesis. Devuelve el resultado entero, o null si la expresión es inválida o divide por cero.',
    pruebas: [
      prueba(['1 + 2 * 3'], 7),
      prueba(['(1 + 2) * 3'], 9),
      prueba(['10 - 4 - 3'], 3),
      prueba(['7 / 2'], 3),
      prueba(['-7 / 2'], -3),
      prueba(['-(2 + 3) * 2'], -10),
      prueba(['2 * (3 + (4 - 1)) / 4'], 3),
      prueba(['8 / (3 - 3)'], null),
      prueba(['1 +'], null),
      prueba(['(1 + 2'], null),
      prueba(['1 2'], null),
      prueba([''], null),
      prueba(['  42  '], 42),
    ],
  },
  {
    id: 'camino',
    nivel: 'compleja',
    nombre: 'caminoMinimo',
    prompt: 'Escribe caminoMinimo(grid). grid es un array de hasta 200 strings de igual largo (hasta 200), con "." libre y "#" muro. Desde la esquina superior izquierda hasta la inferior derecha, moviendo en 4 direcciones, devuelve el mínimo de pasos, 0 si son la misma celda, o -1 si no hay camino o alguna de las dos es muro.',
    pruebas: [
      prueba([['.']], 0),
      prueba([['#']], -1),
      prueba([['..', '..']], 2),
      prueba([['.#', '#.']], -1),
      prueba([['...', '##.', '...']], 4),
      prueba([['....', '.##.', '.#..', '...#']], -1),
      prueba([['.....', '####.', '.....', '.####', '.....']], 16),
      ...pruebasCaminoGeneradas(),
    ],
  },
].map(caso => ({ ...caso, prompt: caso.prompt + ' ' + instrucciones }));
