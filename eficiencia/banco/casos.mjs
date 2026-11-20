const instrucciones = 'Devuelve solo la declaración de la función en un bloque JavaScript. Sin imports, dependencias ni entrada o salida externa. No modifiques la entrada.';

function prueba(args, esperado) {
  return { args, esperado };
}

function beneficioPorSubconjuntos(trabajos) {
  let maximo = 0;
  for (let mascara = 0; mascara < 2 ** trabajos.length; mascara++) {
    const elegidos = trabajos.filter((_, indice) => mascara & (1 << indice));
    const compatibles = elegidos.every(([inicio, fin], indice) =>
      elegidos.slice(indice + 1).every(([otroInicio, otroFin]) =>
        fin <= otroInicio || otroFin <= inicio
      )
    );
    if (compatibles) {
      const puntos = elegidos.reduce((suma, trabajo) => suma + trabajo[2], 0);
      maximo = Math.max(maximo, puntos);
    }
  }
  return maximo;
}

function pruebasBeneficioGeneradas() {
  let estado = 841;
  function siguiente(limite) {
    estado = (Math.imul(1664525, estado) + 1013904223) >>> 0;
    return (estado >>> 16) % limite;
  }
  return Array.from({ length: 12 }, () => {
    const trabajos = Array.from({ length: 8 }, () => {
      const inicio = siguiente(13) - 4;
      return [inicio, inicio + 1 + siguiente(5), siguiente(16)];
    });
    return prueba([trabajos], beneficioPorSubconjuntos(trabajos));
  });
}

export const casos = [
  {
    id: 'sku',
    nivel: 'simple',
    nombre: 'normalizarSKU',
    prompt: 'Escribe normalizarSKU(s). Si s es un string, recorta sus extremos y acepta solo dos letras ASCII seguidas de un guion y tres dígitos. Devuelve el código en mayúsculas. Para cualquier entrada inválida, devuelve null.',
    pruebas: [
      prueba([' ab-007 '], 'AB-007'),
      prueba(['XY-123'], 'XY-123'),
      prueba(['abc-123'], null),
      prueba(['áB-123'], null),
      prueba(['aB-12'], null),
      prueba([123], null),
      prueba(['A B-123'], null),
      prueba([''], null),
    ],
  },
  {
    id: 'bisiesto',
    nivel: 'simple',
    nombre: 'esBisiesto',
    prompt: 'Escribe esBisiesto(y). Para un entero de 1 a 9999 devuelve un booleano según el calendario gregoriano. Es bisiesto si es divisible por 4, salvo años divisibles por 100 que no sean divisibles por 400. Para cualquier entrada inválida devuelve null.',
    pruebas: [
      prueba([2000], true),
      prueba([1900], false),
      prueba([2024], true),
      prueba([2023], false),
      prueba([4], true),
      prueba([1], false),
      prueba([0], null),
      prueba([10000], null),
      prueba(['2000'], null),
      prueba([2024.5], null),
    ],
  },
  {
    id: 'versiones',
    nivel: 'media',
    nombre: 'ultimasVersiones',
    prompt: 'Escribe ultimasVersiones(registros). Recibe pares [id, version] con id de texto y version entera no negativa. Conserva la versión máxima por id y devuelve un array de pares nuevos en el orden de primera aparición de cada id.',
    paresNuevos: true,
    pruebas: [
      prueba([[]], []),
      prueba([[['b', 1], ['a', 2], ['b', 3], ['a', 1]]], [['b', 3], ['a', 2]]),
      prueba([[['x', 0], ['x', 0], ['y', 1]]], [['x', 0], ['y', 1]]),
      prueba([[['__proto__', 2], ['constructor', 3], ['__proto__', 9]]], [['__proto__', 9], ['constructor', 3]]),
      prueba([[['12', 2], ['2', 7], ['12', 3], ['1', 0]]], [['12', 3], ['2', 7], ['1', 0]]),
      prueba([[['', 0]]], [['', 0]]),
    ],
  },
  {
    id: 'faltantes',
    nivel: 'media',
    nombre: 'rangoFaltante',
    prompt: 'Escribe rangoFaltante(ids, lo, hi). ids es un array de enteros desordenados, posiblemente repetidos o fuera de [lo, hi]. lo <= hi. Los números están entre -1000000000 y 1000000000. Devuelve los intervalos inclusivos [inicio, fin] de enteros faltantes, agrupando consecutivos y ordenando por inicio.',
    pruebas: [
      prueba([[], 1, 4], [[1, 4]]),
      prueba([[4, 2, 2, -1, 8], 1, 6], [[1, 1], [3, 3], [5, 6]]),
      prueba([[1, 2], 1, 2], []),
      prueba([[0], -2, 2], [[-2, -1], [1, 2]]),
      prueba([[5], 5, 5], []),
      prueba([[], 5, 5], [[5, 5]]),
      prueba([[1000000000, -1000000000, 0], -1000000000, 1000000000], [[-999999999, -1], [1, 999999999]]),
    ],
  },
  {
    id: 'csv',
    nivel: 'compleja',
    nombre: 'leerRegistro',
    prompt: 'Escribe leerRegistro(s) para una fila CSV dada como string sin saltos de línea. La coma separa campos, incluidos vacíos. Preserva espacios. Las comillas dobles solo abren al comienzo de un campo. Dentro del campo citado, dos comillas dobles representan una literal. Tras el cierre solo acepta coma o fin. Devuelve el array de campos o null si el formato es inválido.',
    pruebas: [
      prueba([''], ['']),
      prueba(['a,,b,'], ['a', '', 'b', '']),
      prueba(['"a,b","c""d",e'], ['a,b', 'c"d', 'e']),
      prueba(['""'], ['']),
      prueba(['"a'], null),
      prueba(['a"b,c'], null),
      prueba(['"a" x,b'], null),
      prueba([' a , b '], [' a ', ' b ']),
      prueba(['"  ",""""'], ['  ', '"']),
      prueba([',""'], ['', '']),
      prueba(['"a""'], null),
    ],
  },
  {
    id: 'beneficio',
    nivel: 'compleja',
    nombre: 'beneficioMaximo',
    prompt: 'Escribe beneficioMaximo(trabajos). Recibe hasta 1000 ternas desordenadas [inicio, fin, puntos] con enteros, inicio < fin y 0 <= puntos <= 1000000. Selecciona el subconjunto de trabajos sin solape con mayor suma de puntos. Un trabajo puede empezar justo cuando otro termina. Devuelve la suma máxima, o 0 para entrada vacía.',
    pruebas: [
      prueba([[]], 0),
      prueba([[[0, 4, 9], [0, 2, 5], [2, 4, 5]]], 10),
      prueba([[[3, 5, 5], [0, 2, 4], [2, 3, 3]]], 12),
      prueba([[[0, 4, 100], [1, 3, 40], [3, 4, 20]]], 100),
      prueba([[[0, 2, 4], [0, 2, 7], [2, 3, 2]]], 9),
      prueba([[[-3, -1, 3], [-1, 0, 4], [-2, 1, 6]]], 7),
      prueba([[[0, 1, 0]]], 0),
      ...pruebasBeneficioGeneradas(),
    ],
  },
].map(caso => ({ ...caso, prompt: caso.prompt + ' ' + instrucciones }));
