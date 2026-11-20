// Sustituto de comprimir.py para las pruebas: recorta los mensajes de herramienta.
let entrada = '';
for await (const d of process.stdin) entrada += d;
if (process.env.HEADROOM_OFFLINE !== '1' || 'NVIDIA_API_KEY' in process.env) {
  console.error('entorno inseguro');
  process.exit(3);
}
const { messages } = JSON.parse(entrada);
const antes = JSON.stringify(messages).length;
const salida = messages.map(m => (m.role === 'tool' ? { ...m, content: m.content.slice(0, 100) } : m));
console.log(JSON.stringify({ messages: salida, tokens_before: antes, tokens_after: JSON.stringify(salida).length }));
