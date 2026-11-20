import assert from 'node:assert/strict';
import test from 'node:test';
import { decidirRuta } from './ruta-codigo.js';

const caso = {
  encargo: 'Escribe una función que redondee minutos a un bloque de 15.',
  alcance: 'aislado',
  datos: 'ficticios',
  prueba: 'redondear(16) devuelve 30.',
};

test('elige NVIDIA solo con una declaración y un resultado verificable', () => {
  const decision = decidirRuta(caso);
  assert.equal(decision.destino, 'nvidia');
  assert.ok(decision.encargo.startsWith(caso.encargo + '\n\n'));
  assert.ok(decision.encargo.includes(caso.prueba));
});

test('requiere alcance, tipo de datos y comprobación', () => {
  for (const falta of [{}, null, { ...caso, alcance: '' }, { ...caso, datos: '' },
    { ...caso, prueba: 'que funcione' }, { ...caso, prueba: 'x'.repeat(501) }]) {
    assert.equal(decidirRuta(falta).destino, 'incompleto');
  }
});

test('un criterio de aceptación no añade apartados al formato que pidió la persona', () => {
  const encargo = 'Devuelve únicamente el código de la función, sin explicaciones.';
  const decision = decidirRuta({ ...caso, encargo });
  assert.equal(decision.encargo, encargo + '\n\nCriterio de aceptación: ' + caso.prueba +
    '\nUsa este criterio para comprobar la respuesta. Respeta el formato de entrega solicitado.');
});

test('mantiene fuera de NVIDIA el trabajo multiarchivo y los datos reales', () => {
  for (const complejo of [{ ...caso, alcance: 'multiarchivo' }, { ...caso, datos: 'reales' },
    { ...caso, encargo: 'Revisa varios archivos y corrige los imports.' }]) {
    const decision = decidirRuta(complejo);
    assert.equal(decision.destino, 'codex');
    assert.equal(decision.encargo, complejo.encargo);
  }
});

test('detecta los temas excluidos tanto en el encargo como en la prueba', () => {
  for (const asunto of ['reglas de riesgo', 'clave de API', 'credenciales', '.env.local']) {
    assert.equal(decidirRuta({ ...caso, encargo: 'Explica ' + asunto }).destino, 'codex');
    assert.equal(decidirRuta({ ...caso, prueba: 'Salida con ' + asunto }).destino, 'codex');
  }
});

test('los temas privados de cada persona llegan por configuración', () => {
  const temasPrivados = ['Proyecto Delta', 'A.B.C.', 'MiClinica'];
  for (const asunto of ['Proyecto Delta', 'proyecto-delta', 'A.B.C.', 'ABC', 'miclinica']) {
    assert.equal(decidirRuta({ ...caso, encargo: 'Explica ' + asunto }, { temasPrivados }).destino, 'codex');
  }
  assert.equal(decidirRuta({ ...caso, encargo: 'Explica abecedario' }, { temasPrivados }).destino, 'nvidia');
  assert.equal(decidirRuta({ ...caso, encargo: 'Explica Proyecto Delta' }).destino, 'nvidia');
});

test('pide retirar texto con formato de credencial antes de elegir herramienta', () => {
  const prueba = 'Comprueba con nvapi-' + 'f'.repeat(22) + '.';
  const ret = decidirRuta({ ...caso, prueba });
  assert.equal(ret.destino, 'incompleto');
  assert.equal(ret.encargo, caso.encargo);
  assert.ok(ret.motivo.includes('Quítalo'));
});

test('un atributo de accesibilidad o una clave de objeto puede ser trabajo sintético', () => {
  assert.equal(decidirRuta({
    ...caso,
    encargo: 'Agrega aria-label a un botón ficticio. Lee la clave id de un objeto.',
  }).destino, 'nvidia');
});
