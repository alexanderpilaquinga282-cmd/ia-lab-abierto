import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function runCodex(command, prompt, cwd, signal) {
  const args = [
    '--no-daemon', '-a', 'never', 'exec', '--ephemeral', '--ignore-user-config',
    '--skip-git-repo-check', '-C', cwd, '-s', 'read-only',
    '-c', 'web_search="disabled"', '--disable', 'shell_tool', '--disable', 'memories',
    '--disable', 'apps', '--json', '-',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, signal, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let answer = '';
    let tokens = null;
    let completed = false;
    lines.on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        answer = event.item.text;
      } else if (event.type === 'turn.completed') {
        completed = true;
        const input = event.usage?.input_tokens;
        const output = event.usage?.output_tokens;
        if ([input, output].every(n => Number.isSafeInteger(n) && n >= 0)) tokens = { input, output };
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 || !completed || !answer?.trim()) {
        reject(new Error('Codex no completó la tarea. Comprueba tu sesión en la aplicación de ChatGPT.'));
      } else {
        resolve({ answer, tokens });
      }
    });
    child.stdin.end(
      'Ayuda con una consulta de programación en texto. Usa solamente el enunciado, sin leer archivos ni ejecutar comandos. ' +
      'Entrega código o una explicación según lo pedido.\n\n' + prompt,
    );
  });
}
