import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const duracion = 30 * 60_000;

export function rutaSesionCodex() {
  const local = process.env.LOCALAPPDATA;
  return process.platform === 'win32' && local && isAbsolute(local)
    ? join(local, 'ia-lab-abierto', 'puente-codex.json')
    : null;
}

export async function leerSesionCodex(archivo) {
  if (!archivo) return null;
  try {
    const info = await lstat(archivo);
    if (!info.isFile() || info.size > 1024) return null;
    const lectura = await open(archivo, 'r');
    let dato;
    try {
      const bytes = Buffer.alloc(1025);
      const { bytesRead } = await lectura.read(bytes);
      if (bytesRead > 1024) return null;
      dato = JSON.parse(bytes.toString('utf8', 0, bytesRead));
    } finally {
      await lectura.close();
    }
    if (Number.isSafeInteger(dato?.port) && dato.port >= 1 && dato.port <= 65535 &&
        typeof dato.token === 'string' && /^[a-f0-9]{64}$/.test(dato.token) &&
        Number.isSafeInteger(dato.expiresAt)) return dato;
  } catch {
    // El panel puede haber cerrado o estar reemplazando el descriptor.
  }
  return null;
}

async function conBloqueo(archivo, operar) {
  // El cierre del proceso libera el bloqueo incluso si no se ejecuta su limpieza.
  const id = createHash('sha256').update(archivo.toLowerCase()).digest('hex').slice(0, 32);
  const pipe = '\\\\.\\pipe\\ia-lab-codex-' + id;
  const lock = createServer(socket => socket.destroy());
  try {
    for (let intento = 0; ; intento++) {
      try {
        await new Promise((ok, fail) => {
          const fallo = error => {
            lock.removeListener('listening', listo);
            fail(error);
          };
          const listo = () => {
            lock.removeListener('error', fallo);
            ok();
          };
          lock.once('error', fallo);
          lock.once('listening', listo);
          lock.listen(pipe);
        });
        break;
      } catch (error) {
        if (error.code !== 'EADDRINUSE' || intento >= 9) throw error;
        await delay(25);
      }
    }
    return await operar();
  } finally {
    if (lock.listening) await new Promise(ok => lock.close(ok));
  }
}

export async function publicarSesionCodex(archivo, port) {
  const sesion = { port, token: randomBytes(32).toString('hex'), expiresAt: Date.now() + duracion };
  return conBloqueo(archivo, async () => {
    await mkdir(dirname(archivo), { recursive: true, mode: 0o700 });
    const temporal = archivo + '.' + randomBytes(12).toString('hex') + '.tmp';
    try {
      await writeFile(temporal, JSON.stringify(sesion), { flag: 'wx', mode: 0o600 });
      await rename(temporal, archivo);
      return sesion;
    } finally {
      await unlink(temporal).catch(() => {});
    }
  });
}

export async function borrarSesionCodex(archivo, sesion) {
  return conBloqueo(archivo, async () => {
    const actual = await leerSesionCodex(archivo);
    if (actual?.token === sesion.token) await unlink(archivo);
  });
}
