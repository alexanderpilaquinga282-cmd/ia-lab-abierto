import { mountReels } from './reels.js';
import { decidirRuta } from './ruta-codigo.js';

const byId = id => document.getElementById(id);

export function createPanel({ post, result, number, usage, onBusy, chatBusy }) {
  const tabs = [...document.querySelectorAll('[data-view]')];
  const views = {
    chat: [byId('viewport'), byId('compose-area')],
    image: [byId('image-view')],
    code: [byId('code-view')],
    reels: [byId('reels-view')],
  };
  const labels = { chat: 'NVIDIA', image: 'Cloudflare', code: 'NVIDIA', reels: 'Montaje local' };
  const reels = mountReels();
  const imageForm = byId('image-form');
  const imagePrompt = byId('image-prompt');
  const imageFile = byId('image-file');
  const imageStatus = byId('image-status');
  const imageSubmit = byId('image-submit');
  const imageConnection = byId('image-connection');
  const imageCredentials = byId('image-credentials');
  const imagePreview = byId('image-preview');
  const imageOutput = byId('image-output');
  const imageSave = byId('image-save');
  const codeForm = byId('code-form');
  const codeProvider = byId('code-provider');
  const codePrompt = byId('code-prompt');
  const codeConfirm = byId('code-confirm');
  const codeScope = byId('code-scope');
  const codeData = byId('code-data');
  const codeProof = byId('code-proof');
  const codeRouteFields = byId('code-route-fields');
  const codeRouteHint = byId('code-route-hint');
  const codeBridge = byId('code-bridge');
  const codeBridgeState = byId('code-bridge-state');
  const codeBridgeToggle = byId('code-bridge-toggle');
  const codeBridgeError = byId('code-bridge-error');
  const codeStatus = byId('code-status');
  const codeSubmit = byId('code-submit');
  const codeAnswer = byId('code-answer');
  const codeCopy = byId('code-copy');
  let view = 'chat';
  let availability = {};
  let busy = false;
  let reuse;

  function datosDeRuta() {
    return {
      encargo: codePrompt.value.trim(),
      alcance: codeScope.value,
      datos: codeData.value,
      prueba: codeProof.value,
    };
  }

  function status(next = availability) {
    availability = next;
    for (const option of codeProvider.options) {
      option.disabled = option.value !== 'auto' && !availability[option.value];
    }
    if (!codeProvider.selectedOptions[0] || codeProvider.selectedOptions[0].disabled) {
      codeProvider.value = 'auto';
      codeConfirm.checked = false;
    }
    const provider = codeProvider.value;
    const usaRuta = provider === 'auto' || provider === 'opencode';
    const ruta = usaRuta ? decidirRuta(datosDeRuta()) : null;
    byId('code-confirm-row').hidden = provider !== 'codex' || !availability.codex;
    codeRouteFields.hidden = !usaRuta;
    codeRouteHint.textContent = usaRuta
      ? (ruta.destino === 'nvidia' && !availability.nvidia ? 'Conecta NVIDIA para consultar. ' : '') + ruta.motivo
      : '';
    const codeAvailability = byId('code-availability');
    codeAvailability.hidden = Boolean(availability.nvidia || availability.codex);
    codeAvailability.textContent = codeAvailability.hidden ? '' : 'Conecta NVIDIA para empezar o abre el panel desde un equipo con Codex configurado.';
    labels.code = { auto: 'Decisión local', opencode: 'OpenCode', codex: 'Codex' }[provider];
    byId('provider-name').textContent = labels[view];
    const blocked = busy || chatBusy();
    codeBridge.hidden = !availability.nvidia;
    codeBridgeToggle.disabled = blocked;
    const bridgeLabel = availability.bridge ? 'Desconectar Codex' : 'Habilitar Codex';
    const bridgeState = availability.bridge
      ? 'Codex puede consultar a NVIDIA durante esta sesión. La conexión caduca a los 30 minutos.'
      : 'Permite que Codex envíe encargos de código con datos ficticios a esta sesión de NVIDIA.';
    if (codeBridgeToggle.textContent !== bridgeLabel) codeBridgeToggle.textContent = bridgeLabel;
    if (codeBridgeState.textContent !== bridgeState) codeBridgeState.textContent = bridgeState;
    imageSubmit.disabled = blocked || !availability.images;
    const puedeConsultar = usaRuta
      ? ruta.destino === 'nvidia' && Boolean(provider === 'auto' ? availability.nvidia : availability.opencode)
      : availability[provider] && (provider !== 'codex' || codeConfirm.checked);
    codeSubmit.disabled = blocked || !puedeConsultar;
  }

  function show(next) {
    view = next;
    for (const [name, sections] of Object.entries(views)) {
      for (const section of sections) section.hidden = name !== view;
    }
    byId('title').parentElement.hidden = view !== 'chat';
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
    status();
  }

  function focus() {
    if (view === 'chat' && availability.nvidia) byId('message').focus();
    else if (view === 'image' && availability.images) imagePrompt.focus();
    else if (view === 'code') codePrompt.focus();
    else tabs.find(tab => tab.dataset.view === view)?.focus();
  }

  function operation(active) {
    busy = active;
    imageForm.querySelectorAll('input, textarea').forEach(field => { field.disabled = active; });
    imageCredentials.querySelectorAll('input, button').forEach(field => { field.disabled = active; });
    codeForm.querySelectorAll('select, textarea, input').forEach(field => { field.disabled = active; });
    status();
    onBusy();
  }

  async function refresh() {
    try { status((await result(await post('status'))).panel); } catch { /* The launcher may have closed. */ }
  }

  async function prepareReference(source) {
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 511 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }

  async function reference() {
    const file = imageFile.files[0];
    if (!file) return reuse ? prepareReference(reuse) : undefined;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      throw new Error('Elige un PNG, JPEG o WebP de hasta 8 MiB.');
    }
    const url = URL.createObjectURL(file);
    try { return await prepareReference(url); }
    finally { URL.revokeObjectURL(url); }
  }

  function imageMode() {
    imageSubmit.textContent = imageFile.files.length || reuse ? 'Editar imagen' : 'Generar imagen';
  }

  imageCredentials.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || chatBusy()) return;
    const account = byId('cloudflare-account').value.trim();
    const token = byId('cloudflare-token').value.trim();
    byId('cloudflare-token').value = '';
    operation(true);
    try {
      status((await result(await post('images/connect', { account, token }))).panel);
      imageConnection.open = false;
      imageStatus.textContent = 'Cuenta configurada para esta sesión. La primera imagen comprobará el acceso.';
    } catch (error) {
      imageStatus.textContent = error.message;
    } finally {
      operation(false);
    }
  });

  imageForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || chatBusy() || !availability.images) return;
    const prompt = imagePrompt.value.trim();
    if (!prompt) return;
    operation(true);
    imageStatus.textContent = 'Procesando con FLUX…';
    try {
      const image = await result(await post('images/run', { prompt, reference: await reference() }));
      const source = 'data:' + image.mime + ';base64,' + image.image;
      imagePreview.src = source;
      imageSave.href = source;
      imageSave.download = 'ia-lab-flux.' + image.mime.split('/')[1];
      imageOutput.hidden = false;
      imageStatus.textContent = 'FLUX · ' + number.format(image.seconds) + ' s';
      imageFile.value = '';
      reuse = undefined;
      imageMode();
    } catch (error) {
      imageStatus.textContent = error.message;
      await refresh();
      if (!availability.images) imageConnection.open = true;
    } finally {
      operation(false);
    }
  });

  imageFile.addEventListener('change', () => {
    reuse = undefined;
    imageMode();
  });
  byId('image-reuse').addEventListener('click', () => {
    if (busy || chatBusy()) return;
    imageFile.value = '';
    reuse = imagePreview.src;
    imageStatus.textContent = 'La última imagen será la referencia de la próxima edición.';
    imageMode();
    imagePrompt.focus();
  });

  codeProvider.addEventListener('change', () => {
    codeConfirm.checked = false;
    status();
  });
  codeBridgeToggle.addEventListener('click', async () => {
    if (busy || chatBusy() || !availability.nvidia) return;
    const action = availability.bridge ? 'disable' : 'enable';
    operation(true);
    codeBridgeError.hidden = true;
    try {
      const snapshot = await result(await post('code/bridge/' + action));
      status(snapshot.panel);
    } catch (error) {
      codeBridgeError.textContent = error.message;
      codeBridgeError.hidden = false;
      await refresh();
    } finally {
      operation(false);
    }
  });
  for (const field of [codePrompt, codeScope, codeData, codeProof]) {
    field.addEventListener('input', () => status());
  }
  codeConfirm.addEventListener('change', () => status());
  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || chatBusy()) return;
    const prompt = codePrompt.value.trim();
    const provider = codeProvider.value;
    if (!prompt || codeSubmit.disabled) return;
    operation(true);
    codeAnswer.hidden = true;
    codeCopy.hidden = true;
    const proveedorVisible = provider === 'auto' ? 'NVIDIA' : labels.code;
    codeStatus.textContent = 'Consultando con ' + proveedorVisible + '…';
    try {
      let answer;
      if (provider === 'auto') {
        answer = await readCode(await post('code/route', datosDeRuta()));
      } else if (provider === 'opencode') {
        answer = await result(await post('code/route', { ...datosDeRuta(), cliente: 'opencode' }));
        usage(answer.stats);
      } else {
        answer = await result(await post('program', { prompt, confirmed: codeConfirm.checked }));
      }
      codeAnswer.textContent = answer.answer;
      codeAnswer.hidden = false;
      codeCopy.hidden = false;
      const tokens = answer.tokens ? ' · ' + number.format(answer.tokens.input + answer.tokens.output) + ' tokens' : '';
      codeStatus.textContent = proveedorVisible + ' · ' + number.format(answer.seconds) + ' s' + tokens;
    } catch (error) {
      codeStatus.textContent = error.message;
      try {
        const snapshot = await result(await post('status'));
        status(snapshot.panel);
        usage(snapshot.stats);
      } catch { /* The launcher may have closed. */ }
    } finally {
      codeConfirm.checked = false;
      operation(false);
    }
  });
  codeCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeAnswer.textContent);
      codeCopy.textContent = 'Copiado';
      setTimeout(() => { codeCopy.textContent = 'Copiar respuesta'; }, 1500);
    } catch {
      codeStatus.textContent = 'Selecciona la respuesta para copiarla.';
    }
  });

  async function readCode(response) {
    if (!response.ok) await result(response);
    let answer = '';
    let final;
    for (const line of (await response.text()).split('\n')) {
      if (!line) continue;
      const part = JSON.parse(line);
      if (part.error) throw new Error(part.error);
      if (part.text) answer += part.text;
      if (part.done) final = part;
    }
    if (!final || !answer.trim()) throw new Error('Nemotron no completó la respuesta.');
    usage(final.stats);
    if (final.finish === 'length') throw new Error('NVIDIA alcanzó el límite de generación. Acota el encargo antes de volver a consultar.');
    return { answer, seconds: final.seconds, tokens: final.usage };
  }

  for (const tab of tabs) tab.addEventListener('click', () => {
    show(tab.dataset.view);
    focus();
  });

  show('chat');
  return {
    get busy() { return busy; },
    focus,
    show,
    status,
    reset(next) {
      status(next);
      imageCredentials.reset();
      imageForm.reset();
      imageOutput.hidden = true;
      imagePreview.removeAttribute('src');
      imageSave.removeAttribute('href');
      imageConnection.open = false;
      imageStatus.textContent = '';
      codeForm.reset();
      codeBridge.open = false;
      codeBridgeError.hidden = true;
      codeAnswer.hidden = true;
      codeAnswer.textContent = '';
      codeCopy.hidden = true;
      codeStatus.textContent = '';
      reels.reset();
      reuse = undefined;
      imageMode();
      show('chat');
    },
  };
}
