// Casos con salidas de herramienta largas (logs, JSON, reportes de pruebas).
// Todo es ficticio y se genera con semilla fija: el mismo archivo produce
// siempre los mismos datos y la misma respuesta esperada.
import { isDeepStrictEqual } from 'node:util';

export function generador(semilla) {
  let estado = semilla >>> 0;
  return limite => {
    estado = (Math.imul(1664525, estado) + 1013904223) >>> 0;
    return (estado >>> 16) % limite;
  };
}

const pad = (n, largo) => String(n).padStart(largo, '0');

function casoLog() {
  const azar = generador(4721);
  const servicios = ['inventario', 'pagos', 'envios', 'usuarios'];
  const lineas = [];
  const posError = 731;
  const posAvisos = new Set([88, 240, 512, 905, 1100]);
  let esperado;
  for (let i = 0; i < 1200; i++) {
    const hora = `2026-11-18T10:${pad(Math.floor(i / 60) % 60, 2)}:${pad(i % 60, 2)}.${pad(azar(1000), 3)}Z`;
    const svc = servicios[azar(servicios.length)];
    const req = 'r-' + pad(10000 + azar(89999), 5);
    if (i === posError) {
      esperado = { codigo: 'E-' + (4000 + azar(999)), req };
      lineas.push(`${hora} ERROR svc=${svc} req=${req} codigo=${esperado.codigo} msg="saldo ficticio inconsistente"`);
    } else if (posAvisos.has(i)) {
      lineas.push(`${hora} WARN svc=${svc} req=${req} lento=${800 + azar(900)}ms`);
    } else {
      lineas.push(`${hora} INFO svc=${svc} req=${req} GET /items/${azar(500)} 200 ${3 + azar(40)}ms`);
    }
  }
  return {
    id: 'log-error',
    nivel: 'largo',
    pregunta: 'Revisa el log que devolvió la herramienta. Hay exactamente una línea ERROR. Responde solo con un objeto JSON {"codigo": "...", "req": "..."} con el código de error y el req de esa línea.',
    datos: lineas.join('\n'),
    esperado,
  };
}

function casoPedidos() {
  const azar = generador(300);
  const estados = ['pagado', 'pagado', 'enviado', 'enviado', 'devuelto'];
  const pedidos = Array.from({ length: 300 }, (_, i) => ({
    id: 'P-' + pad(i + 1, 4),
    estado: estados[azar(estados.length)],
    monto: 1000 + azar(90000),
  }));
  const devueltos = pedidos.filter(p => p.estado === 'devuelto');
  const mayor = devueltos.reduce((a, b) => (b.monto > a.monto ? b : a));
  // Un único máximo evita respuestas ambiguas.
  mayor.monto = Math.max(...devueltos.map(p => p.monto)) + 1;
  return {
    id: 'pedidos',
    nivel: 'largo',
    pregunta: 'La herramienta devolvió pedidos ficticios en JSON. Cuenta los pedidos con estado "devuelto" y di el id del devuelto con mayor monto. Responde solo con un objeto JSON {"devueltos": <número>, "mayorDevuelto": "<id>"}.',
    datos: JSON.stringify(pedidos),
    esperado: { devueltos: devueltos.length, mayorDevuelto: mayor.id },
  };
}

function casoPruebas() {
  const azar = generador(77);
  const modulos = ['carrito', 'factura', 'stock', 'login', 'reportes', 'agenda'];
  const fallidas = new Map([[143, null], [318, null]]);
  const lineas = ['RUN  v3.2.0 /proyecto-ficticio', ''];
  for (let i = 0; i < 400; i++) {
    const nombre = `${modulos[azar(modulos.length)]} › caso ${pad(i, 3)}`;
    if (fallidas.has(i)) {
      fallidas.set(i, nombre);
      lineas.push(` ✗ ${nombre} (${2 + azar(30)} ms)`);
      lineas.push(`   AssertionError: expected ${azar(100)} to equal ${100 + azar(100)}`);
    } else {
      lineas.push(` ✓ ${nombre} (${1 + azar(20)} ms)`);
    }
  }
  lineas.push('', 'Tests  2 failed | 398 passed (400)');
  return {
    id: 'pruebas',
    nivel: 'largo',
    pregunta: 'La herramienta devolvió el reporte de un corredor de pruebas. Responde solo con un objeto JSON {"fallidas": [...]} con los nombres exactos de las pruebas fallidas (el texto entre "✗ " y " (") en orden alfabético.',
    datos: lineas.join('\n'),
    esperado: { fallidas: [...fallidas.values()].sort() },
  };
}

export const casosLargos = [casoLog(), casoPedidos(), casoPruebas()];

export function verificarLargo(caso, respuesta) {
  const texto = String(respuesta ?? '').trim();
  const json = texto.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)?.[1] ?? texto;
  let obtenido;
  try {
    obtenido = JSON.parse(json);
  } catch {
    return { aprobadas: 0, total: 1, fallos: [{ prueba: 'formato', motivo: 'No es un objeto JSON.' }] };
  }
  return isDeepStrictEqual(obtenido, caso.esperado)
    ? { aprobadas: 1, total: 1, fallos: [] }
    : { aprobadas: 0, total: 1, fallos: [{ prueba: 'valor', motivo: 'Obtenido ' + JSON.stringify(obtenido).slice(0, 200) }] };
}
