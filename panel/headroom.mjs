// Headroom para la ruta de chat de NVIDIA. Comprime solo conversaciones largas
// (logs, JSON pegado) y, ante cualquier fallo, envía el mensaje sin comprimir.
// El proceso de Python no recibe la clave y corre con HEADROOM_OFFLINE=1.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export function pythonHeadroom(env = process.env) {
  const ruta = env.IA_LAB_HEADROOM_PYTHON ||
    fileURLToPath(new URL('../.venv/Scripts/python.exe', import.meta.url));
  return existsSync(ruta) ? ruta : null;
}

export function crearCompresor({
  python = pythonHeadroom(),
  script = fileURLToPath(new URL('headroom-sidecar.py', import.meta.url)),
  umbral = 6000,
  esperaMs = 20_000,
  lanzar = spawn,
} = {}) {
  let hijo = null;
  let lector = null;
  let cola = Promise.resolve();

  function arrancar() {
    const { NVIDIA_API_KEY, ...resto } = process.env;
    hijo = lanzar(python, ['-I', script], {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
      env: { ...resto, HEADROOM_OFFLINE: '1', HEADROOM_BEACON: 'off', HEADROOM_TELEMETRY: 'off', DO_NOT_TRACK: '1' },
    });
    lector = createInterface({ input: hijo.stdout });
    hijo.once('exit', () => { hijo = null; lector = null; });
    hijo.once('error', () => { hijo = null; lector = null; });
  }

  function pedir(messages) {
    if (!hijo) arrancar();
    const proceso = hijo;
    return new Promise((ok, fallo) => {
      const reloj = setTimeout(() => { proceso.kill(); fallo(new Error('tiempo')); }, esperaMs);
      lector.once('line', linea => { clearTimeout(reloj); ok(JSON.parse(linea)); });
      proceso.once('exit', () => { clearTimeout(reloj); fallo(new Error('salió')); });
      proceso.stdin.write(JSON.stringify({ messages }) + '\n');
    });
  }

  async function comprimir(messages) {
    const largo = messages.reduce((suma, m) => suma + String(m.content ?? '').length, 0);
    if (!python || largo < umbral) return { messages, aplicado: false };
    const turno = cola.then(() => pedir(messages));
    cola = turno.catch(() => {});
    try {
      const r = await turno;
      const validos = Array.isArray(r.messages) && r.messages.length === messages.length &&
        r.messages.every((m, i) => m.role === messages[i].role && typeof m.content === 'string');
      if (!validos || !(r.despues < r.antes)) return { messages, aplicado: false };
      return { messages: r.messages.map(({ role, content }) => ({ role, content })), aplicado: true, antes: r.antes, despues: r.despues };
    } catch {
      return { messages, aplicado: false };
    }
  }

  return { disponible: Boolean(python), comprimir, cerrar: () => hijo?.kill() };
}
