import { isDeepStrictEqual } from 'node:util';
import { createContext, Script } from 'node:vm';

function prepararFuncion(caso, respuesta) {
  if (typeof respuesta !== 'string' || respuesta.length > 20_000) {
    throw new Error('La respuesta debe contener una sola función de hasta 20.000 caracteres.');
  }
  const texto = respuesta.trim();
  const bloque = texto.match(/^```(?:javascript|js)?[^\S\r\n]*\r?\n([\s\S]+)\r?\n```$/i);
  const codigo = (bloque?.[1] ?? texto).trim();
  const declaracion = codigo.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (declaracion?.[1] !== caso.nombre || !codigo.endsWith('}')) {
    throw new Error('Se esperaba solo la declaración de ' + caso.nombre + ', sin prosa adicional.');
  }
  return new Script('"use strict";\nconst resolver = (\n' + codigo + '\n);', {
    filename: 'respuesta-modelo.js',
  });
}

// Revisa la función antes de invocar este verificador. vm limita el entorno
// y el tiempo, pero no constituye una frontera de seguridad por sí solo.
export function verificar(caso, respuesta) {
  const total = caso.pruebas.length + 1;
  const fallos = [];
  let fuente;
  try {
    fuente = prepararFuncion(caso, respuesta);
  } catch (error) {
    return {
      aprobadas: 0,
      total,
      fallos: [
        { prueba: 'formato', motivo: error.message },
        { prueba: 'ejecución', motivo: 'Sin ejecutar los casos de prueba por formato inválido.' },
      ],
    };
  }

  for (const [indice, { args, esperado }] of caso.pruebas.entries()) {
    try {
      const contexto = createContext(Object.create(null), {
        codeGeneration: { strings: false, wasm: false },
      });
      fuente.runInContext(contexto, { timeout: 1000 });
      const prueba = new Script(`
        const argumentos = ${JSON.stringify(args)};
        const salida = resolver(...argumentos);
        if (salida === undefined) throw new Error('La función devolvió undefined.');
        const sinAlias = ${caso.paresNuevos
          ? 'Array.isArray(salida) && salida !== argumentos[0] && salida.every(par => !argumentos[0].includes(par))'
          : 'true'};
        JSON.stringify({ salida, argumentos, sinAlias, salidaEsNull: salida === null });
      `);
      const observado = JSON.parse(prueba.runInContext(contexto, { timeout: 1000 }));
      if (!isDeepStrictEqual(observado.argumentos, args)) {
        throw new Error('Modificó la entrada.');
      }
      if (!isDeepStrictEqual(observado.salida, esperado) || observado.salidaEsNull !== (esperado === null)) {
        throw new Error('Resultado distinto del esperado: ' + JSON.stringify(observado.salida));
      }
      if (!observado.sinAlias) {
        throw new Error('Reutilizó la entrada o alguno de sus pares.');
      }
    } catch (error) {
      fallos.push({ prueba: indice + 1, motivo: String(error?.message ?? error).slice(0, 300) });
    }
  }

  return { aprobadas: total - fallos.length, total, fallos };
}
