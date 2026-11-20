const credencialPegada = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:nvapi-|sk-(?:proj-)?|gh[pousr]_|github_pat_)[\w-]{16,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bBearer\s+[^\s'"]{16,}|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|\b(?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET|PASSWORD)\s*[:=]\s*["']?[^\s'"]{8,}/i;
// Temas privados de cada persona: se leen de config/temas-privados.txt (fuera de Git) y llegan en opciones.temasPrivados.
const asuntoRestringido = /\b(?:api[\s_-]*keys?|claves?\s+(?:de\s+)?(?:api|nvidia|openai|acceso)|credenciales?|contraseñas?|tokens?\s+(?:de\s+)?(?:acceso|autenticaci[oó]n)|reglas?\s+de\s+riesgo)\b|\.env(?:\b|_)/i;
const variosArchivos = /\bmultiarchivo\b|\b(?:varios|m[uú]ltiples|dos|tres)\s+archivos\b|\b(?:todo el|repositorio)\s+(?:repo(?:sitorio)?|completo)\b/i;
const pruebaVaga = /^(?:s[ií]|ok|todo bien|probar|verificar|revisar|que funcione|funciona|por definir|no s[eé])[.!\s]*$/i;

const escapar = texto => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flexible = tema => escapar(tema.trim()).replace(/(\\\.|\s|-|_)+/g, '[\\s._-]*');

export function patronTemasPrivados(temas = []) {
  const limpios = temas.map(t => String(t).trim()).filter(t => t.length >= 2);
  return limpios.length ? new RegExp('(?<![\\w])(?:' + limpios.map(flexible).join('|') + ')(?![\\w])', 'i') : null;
}

export function decidirRuta(entradaDeclarada, { temasPrivados = [] } = {}) {
  const privados = patronTemasPrivados(temasPrivados);
  const { encargo, alcance, datos, prueba } = entradaDeclarada ?? {};
  const texto = typeof encargo === 'string' ? encargo : '';
  const criterio = typeof prueba === 'string' ? prueba.trim() : '';
  const entrada = texto + '\n' + criterio;
  const decision = (destino, motivo) => ({ destino, motivo, encargo: texto });

  if (!texto.trim()) return decision('incompleto', 'Escribe el encargo.');
  if (credencialPegada.test(entrada)) {
    return decision('incompleto', 'Hay un posible secreto en el texto. Quítalo antes de consultar.');
  }
  if (asuntoRestringido.test(entrada) || privados?.test(entrada)) {
    return decision('codex', 'Este asunto queda fuera de NVIDIA. Revisa qué datos puedes compartir antes de elegir la herramienta.');
  }
  if (datos === 'reales') {
    return decision('codex', 'El encargo usa datos reales. Revisa qué datos puedes compartir antes de elegir la herramienta.');
  }
  if (alcance === 'multiarchivo' || variosArchivos.test(entrada)) {
    return decision('codex', 'El encargo requiere revisar más de un archivo.');
  }
  if (alcance !== 'aislado' || datos !== 'ficticios') {
    return decision('incompleto', 'Indica el alcance del encargo y si usarás datos ficticios.');
  }
  if (criterio.length < 8 || criterio.length > 500 || pruebaVaga.test(criterio)) {
    return decision('incompleto', 'Añade una comprobación concreta de 8 a 500 caracteres que indique el resultado esperado.');
  }
  return {
    destino: 'nvidia',
    motivo: 'Encargo aislado con datos ficticios y un criterio de aceptación declarado.',
    encargo: texto + '\n\nCriterio de aceptación: ' + criterio +
      '\nUsa este criterio para comprobar la respuesta. Respeta el formato de entrega solicitado.',
  };
}
