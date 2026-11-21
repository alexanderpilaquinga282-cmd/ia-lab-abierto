// Clave de NVIDIA por sesión. Se pide en un cuadro de diálogo de Windows (siempre encima,
// con caracteres ocultos), viaja por una tubería local con nombre aleatorio y vive solo en
// la memoria de este proceso. Nunca se escribe en disco.
//
// Historia: la versión con Read-Host no abría ninguna ventana visible cuando la lanzaba la app
// de Claude (el proceso no tiene consola) y la llamada esperaba 3 minutos. Ahora:
//  - el cuadro es una ventana gráfica (WinForms), no depende de tener consola;
//  - la llamada espera como mucho ESPERA_MS; si la clave no llegó, responde enseguida
//    "pega la clave y vuelve a pedirlo", y el cuadro sigue abierto hasta LIMITE_MS;
//  - cerrar el cuadro o dejarlo vacío niega en el acto.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

export const ESPERA_MS = 45_000;   // menos que el tiempo de espera de la app (~60-80 s)
export const LIMITE_MS = 300_000;  // el cuadro se puede contestar durante 5 minutos

export class ClavePendiente extends Error {
  constructor() { super('clave pendiente'); this.name = 'ClavePendiente'; }
}

let enMemoria = null;
let pendiente = null;

export function olvidarClave() { enMemoria = null; }

export function guion(tuberia) {
  return [
    'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing',
    '$f = New-Object System.Windows.Forms.Form',
    "$f.Text = 'IA Lab - clave NVIDIA para Claude'",
    "$f.TopMost = $true; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'",
    '$f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ClientSize = New-Object System.Drawing.Size(460, 130)',
    '$l = New-Object System.Windows.Forms.Label',
    "$l.Text = 'Claude pidió usar Nemotron (solo archivos del taller, datos ficticios). Pega tu clave de NVIDIA y presiona Enter. Cierra esta ventana para negar.'",
    '$l.SetBounds(12, 10, 436, 45)',
    '$t = New-Object System.Windows.Forms.TextBox; $t.UseSystemPasswordChar = $true; $t.SetBounds(12, 60, 436, 24)',
    "$b = New-Object System.Windows.Forms.Button; $b.Text = 'Usar clave'; $b.SetBounds(338, 94, 110, 28)",
    "$b.DialogResult = [System.Windows.Forms.DialogResult]::OK",
    '$f.AcceptButton = $b; $f.Controls.AddRange(@($l, $t, $b))',
    '$f.Add_Shown({ $f.Activate(); $t.Focus() })',
    "$p = ''; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $p = $t.Text }",
    '$f.Dispose()',
    `$c = New-Object System.IO.Pipes.NamedPipeClientStream('.', '${tuberia}', [System.IO.Pipes.PipeDirection]::Out)`,
    '$c.Connect(10000)',
    '$w = New-Object System.IO.StreamWriter($c)',
    '$w.Write($p); $w.Flush(); $c.Dispose(); $p = $null',
  ].join('; ');
}

function pedirEnVentana(limiteMs = LIMITE_MS) {
  const nombre = 'ia-lab-nemo-' + randomBytes(16).toString('hex');
  return new Promise((ok, fallo) => {
    let recibido = '';
    const servidor = createServer(socket => {
      socket.on('data', d => { recibido += d; if (recibido.length > 512) socket.destroy(); });
      socket.on('end', () => { servidor.close(); clearTimeout(reloj); const k = recibido.trim(); k ? ok(k) : fallo(new Error('Se cerró el cuadro de la clave (negado).')); });
    });
    const reloj = setTimeout(() => { servidor.close(); fallo(new Error('Nadie contestó el cuadro de la clave en 5 minutos.')); }, limiteMs);
    servidor.on('error', e => { clearTimeout(reloj); fallo(e); });
    servidor.listen('\\\\.\\pipe\\' + nombre, () => {
      const codificado = Buffer.from(guion(nombre), 'utf16le').toString('base64');
      // Ventana gráfica: -WindowStyle Hidden esconde la consola y solo se ve el cuadro.
      // Sin detached (en Windows eso deja a PowerShell sin consola) y sin windowsHide
      // (pasaría SW_HIDE al primer ShowWindow, que puede ser el del cuadro).
      const hijo = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', codificado], { windowsHide: false, stdio: 'ignore' });
      hijo.on('error', e => { clearTimeout(reloj); servidor.close(); fallo(e); });
      // Si PowerShell termina sin mandar nada, el cuadro no se pudo abrir: avisar ya, no a los 5 minutos.
      hijo.on('exit', codigo => setTimeout(() => {
        if (recibido) return;
        clearTimeout(reloj); servidor.close();
        fallo(new Error(`El cuadro de la clave no se pudo abrir (PowerShell salió con código ${codigo}).`));
      }, 3000));
      hijo.unref();
    });
  });
}

const valida = k => /^[\x21-\x7e]{20,300}$/.test(k);

// pedir: inyectable para pruebas. esperaMs: cuánto bloquea esta llamada como mucho.
export async function obtenerClave(env = process.env, { pedir = pedirEnVentana, esperaMs = ESPERA_MS, plataforma = process.platform } = {}) {
  if (env.NVIDIA_API_KEY) return env.NVIDIA_API_KEY;
  if (enMemoria) return enMemoria;
  if (plataforma !== 'win32') throw new Error('Falta NVIDIA_API_KEY (el cuadro para pedirla solo existe en Windows; en Mac o Linux abre Claude desde una terminal con NVIDIA_API_KEY puesta).');
  if (!pendiente) {
    pendiente = pedir().then(k => {
      if (!valida(k)) throw new Error('La clave tiene un formato inválido.');
      enMemoria = k;
      return k;
    }).finally(() => { pendiente = null; });
    pendiente.catch(() => {}); // si nadie la espera ya, el fallo no tumba el servidor
  }
  let reloj;
  const tope = new Promise((_, fallo) => { reloj = setTimeout(() => fallo(new ClavePendiente()), esperaMs); });
  try { return await Promise.race([pendiente, tope]); } finally { clearTimeout(reloj); }
}
