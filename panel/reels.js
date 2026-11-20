const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MP4_TYPES = ['video/mp4;codecs=avc1.420034', 'video/mp4;codecs=avc1', 'video/mp4'];

function wrappedLines(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && ctx.measureText(line + ' ' + word).width > width) {
      lines.push(line);
      line = '';
    }
    if (ctx.measureText(word).width <= width) {
      line = line ? line + ' ' + word : word;
    } else {
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawText(ctx, text, top, preferredSize, color) {
  let size = preferredSize;
  let lines;
  do {
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
    lines = wrappedLines(ctx, text, 796);
    if (lines.length <= 2) break;
    size -= 4;
  } while (size >= 38);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => ctx.fillText(line, 514, top + index * size * 1.18));
}

function drawScene(ctx, scene, title, progress) {
  const { bitmap, caption } = scene;
  const scale = Math.max(WIDTH / bitmap.width, HEIGHT / bitmap.height) * (1 + progress * 0.055);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);

  const shade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  shade.addColorStop(0, title ? '#08110eea' : '#08110e40');
  shade.addColorStop(0.28, '#08110e17');
  shade.addColorStop(0.55, '#08110e0d');
  shade.addColorStop(0.76, '#08110ef2');
  shade.addColorStop(1, '#08110e');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.shadowColor = '#08110e';
  ctx.shadowBlur = 16;
  if (title) drawText(ctx, title, 205, 83, '#f5fcf7');
  drawText(ctx, caption, 1300, 63, '#f5fcf7');
  ctx.shadowBlur = 0;
}

function timecode(ms) {
  const seconds = Math.floor(ms / 1000);
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

function reviewScript(title, scenes) {
  const outline = scenes.map((scene, index) =>
    '(' + (index + 1) + ') ' + timecode(scene.start) + ' – ' + timecode(scene.end) + '\n' +
    'Imagen: ' + scene.name.replace(/[\r\n]/g, ' ') + '\n' +
    'Texto en pantalla: ' + scene.caption,
  );
  const text = [
    'REVISIÓN EDITORIAL · REEL',
    'Título (primera escena): ' + title,
    'Formato: vertical 9:16, 1080 × 1920, sin voz ni música.',
    'Duración prevista: ' + timecode(scenes.at(-1).end),
    '',
    ...outline.flatMap(scene => [scene, '']),
    'Adjunta también el storyboard. Revisa el gancho inicial, el orden de las escenas, el encuadre y la legibilidad. Sugiere cambios por código de tiempo para texto, ritmo y voz. Si una afirmación de salud necesita fuente o revisión profesional, señálala antes de sugerir su publicación.',
  ].join('\n');
  return new Blob([text], { type: 'text/plain;charset=utf-8' });
}

function makeStoryboard(canvas, ctx, scenes, title) {
  const tileWidth = 270;
  const tileHeight = 480;
  const gap = 16;
  const bar = 34;
  const columns = Math.min(2, scenes.length);
  const rows = Math.ceil(scenes.length / columns);
  const sheet = document.createElement('canvas');
  sheet.width = columns * (tileWidth + gap) + gap;
  sheet.height = rows * (tileHeight + bar + gap) + gap;
  const sheetCtx = sheet.getContext('2d');
  sheetCtx.fillStyle = '#101815';
  sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
  scenes.forEach((scene, index) => {
    const x = gap + (index % columns) * (tileWidth + gap);
    const y = gap + Math.floor(index / columns) * (tileHeight + bar + gap);
    sheetCtx.fillStyle = '#ecf3f0';
    sheetCtx.font = 'bold 16px system-ui, sans-serif';
    sheetCtx.fillText((index + 1) + ' · ' + timecode(scene.start) + ' – ' + timecode(scene.end), x, y + 21);
    drawScene(ctx, scene, index === 0 ? title : '', 0.5);
    sheetCtx.drawImage(canvas, x, y + bar, tileWidth, tileHeight);
  });
  return new Promise((resolve, reject) => {
    sheet.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo exportar el storyboard.')), 'image/jpeg', 0.92);
  });
}

async function buildReel(scenes, title, signal, report) {
  const mimeType = MP4_TYPES.find(type => globalThis.MediaRecorder?.isTypeSupported(type));
  if (!mimeType) throw new Error('Este navegador no puede grabar MP4. Abre el panel en Microsoft Edge.');
  const canvas = Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext('2d', { alpha: false });
  const loaded = [];
  let stream;

  try {
    for (const scene of scenes) {
      loaded.push({ ...scene, bitmap: await createImageBitmap(scene.file) });
      signal.throwIfAborted();
    }
    ctx.imageSmoothingQuality = 'high';
    const storyboard = await makeStoryboard(canvas, ctx, loaded, title);
    signal.throwIfAborted();
    drawScene(ctx, loaded[0], title, 0);
    stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    const duration = loaded.at(-1).end;
    const video = await new Promise((resolve, reject) => {
      const chunks = [];
      let frame;
      let watchdog;
      let start;
      let lastScene = -1;
      let settled = false;

      function finish(error) {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(frame);
        clearTimeout(watchdog);
        signal.removeEventListener('abort', cancel);
        document.removeEventListener('visibilitychange', checkVisibility);
        if (error) reject(error);
        else if (chunks.length) resolve(new Blob(chunks, { type: 'video/mp4' }));
        else reject(new Error('El navegador no produjo un archivo de video.'));
      }

      function stopWithError(error) {
        finish(error);
        if (recorder.state !== 'inactive') recorder.stop();
      }

      function cancel() { stopWithError(signal.reason); }

      function checkVisibility() {
        if (document.hidden) stopWithError(new Error('Se detuvo el montaje. Mantén visible el panel y vuelve a renderizar.'));
      }

      function tick(now) {
        start ??= now;
        const elapsed = now - start;
        const index = loaded.findIndex(scene => elapsed < scene.end);
        if (index !== -1 ? index > lastScene + 1 : lastScene < loaded.length - 1) {
          stopWithError(new Error('El navegador omitió una escena. Mantén visible el panel y vuelve a renderizar.'));
          return;
        }
        if (index === -1) {
          recorder.stop();
          return;
        }
        if (index !== lastScene) {
          lastScene = index;
          report('Grabando escena ' + (index + 1) + ' de ' + loaded.length + '…');
        }
        const scene = loaded[index];
        drawScene(ctx, scene, index === 0 ? title : '', (elapsed - scene.start) / (scene.end - scene.start));
        frame = requestAnimationFrame(tick);
      }

      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => finish(new Error('Edge no pudo codificar el MP4.'));
      recorder.onstop = () => finish();
      if (document.hidden) { checkVisibility(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      document.addEventListener('visibilitychange', checkVisibility);
      try { recorder.start(); } catch (error) { finish(error); return; }
      frame = requestAnimationFrame(tick);
      watchdog = setTimeout(() => {
        stopWithError(new Error('La grabación se demoró demasiado. Mantén visible el panel al renderizar.'));
      }, duration + 7500);
    });
    return { video, storyboard };
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    loaded.forEach(({ bitmap }) => bitmap.close());
  }
}

export function mountReels() {
  const get = id => document.getElementById('reel-' + id);
  const form = get('form');
  const status = get('status');
  const result = get('result');
  const video = get('video');
  const list = get('scenes');
  const filesInput = get('files');
  const submit = get('submit');
  const outputs = { download: get('download'), script: get('script'), storyboard: get('storyboard') };
  const scenes = [];
  const urls = [];
  let current;

  function objectUrl(blob) {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  }

  function clear() {
    video.removeAttribute('src');
    video.load();
    for (const output of Object.values(outputs)) output.removeAttribute('href');
    urls.splice(0).forEach(url => URL.revokeObjectURL(url));
    result.hidden = true;
  }

  function updateOrder() {
    scenes.forEach(({ row, earlier, later }, index) => {
      earlier.disabled = index === 0;
      later.disabled = index === scenes.length - 1;
      list.append(row);
    });
  }

  function move(scene, step) {
    const index = scenes.indexOf(scene);
    const target = index + step;
    if (target < 0 || target >= scenes.length) return;
    [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
    updateOrder();
    const preferred = step < 0 ? scene.earlier : scene.later;
    (preferred.disabled ? (step < 0 ? scene.later : scene.earlier) : preferred).focus();
  }

  function addScene(file) {
    const row = document.createElement('li');
    row.className = 'reel-scene';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const caption = Object.assign(document.createElement('input'), {
      type: 'text', maxLength: 70, required: true, placeholder: 'Texto que se verá en el video',
    });
    const captionLabel = document.createElement('label');
    captionLabel.textContent = 'Texto de escena';
    captionLabel.append(caption);
    const seconds = Object.assign(document.createElement('input'), { type: 'number', min: 3, max: 12, value: 5, required: true });
    const timeLabel = document.createElement('label');
    timeLabel.textContent = 'Segundos';
    timeLabel.append(seconds);
    const earlier = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: 'Subir' });
    const later = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', textContent: 'Bajar' });
    earlier.setAttribute('aria-label', 'Subir escena ' + file.name);
    later.setAttribute('aria-label', 'Bajar escena ' + file.name);
    const buttons = document.createElement('div');
    buttons.className = 'reel-order';
    buttons.append(earlier, later);
    row.append(name, buttons, captionLabel, timeLabel);
    const scene = { file, row, caption, seconds, earlier, later };
    earlier.addEventListener('click', () => move(scene, -1));
    later.addEventListener('click', () => move(scene, 1));
    scenes.push(scene);
  }

  filesInput.addEventListener('change', () => {
    scenes.length = 0;
    list.replaceChildren();
    status.textContent = '';
    const files = [...filesInput.files];
    if (files.length > MAX_IMAGES ||
        files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_IMAGE_BYTES)) {
      filesInput.value = '';
      status.textContent = 'Elige hasta cuatro imágenes PNG, JPEG o WebP de hasta 8 MiB cada una.';
      return;
    }
    files.forEach(addScene);
    updateOrder();
  });

  video.addEventListener('loadedmetadata', () => {
    if (result.hidden || !Number.isFinite(video.duration)) return;
    const duration = video.duration.toLocaleString('es', { maximumFractionDigits: 2 });
    status.textContent = 'MP4 listo · ' + duration + ' s · ' + video.videoWidth + ' × ' + video.videoHeight;
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (current) return;
    const title = get('title').value.trim();
    let end = 0;
    const plan = scenes.map(({ file, caption, seconds }) => {
      const start = end;
      const duration = seconds.valueAsNumber;
      end += duration * 1000;
      return { file, name: file.name, caption: caption.value.trim(), duration, start, end };
    });
    if (!title || !plan.length || plan.some(scene =>
      !scene.caption || !Number.isInteger(scene.duration) || scene.duration < 3 || scene.duration > 12)) {
      status.textContent = 'Escribe un título y completa el texto y la duración de 3 a 12 segundos por escena.';
      return;
    }
    clear();
    const job = new AbortController();
    current = job;
    form.querySelector('fieldset').disabled = true;
    submit.disabled = true;
    status.textContent = 'Preparando escenas…';
    try {
      const { video: file, storyboard } = await buildReel(plan, title, job.signal, message => { status.textContent = message; });
      if (job.signal.aborted) return;
      video.src = objectUrl(file);
      outputs.download.href = video.src;
      outputs.script.href = objectUrl(reviewScript(title, plan));
      outputs.storyboard.href = objectUrl(storyboard);
      result.hidden = false;
      status.textContent = 'MP4 listo.';
    } catch (error) {
      if (!job.signal.aborted) status.textContent = error.message || 'No se pudo grabar el MP4.';
    } finally {
      if (current === job) {
        current = undefined;
        form.querySelector('fieldset').disabled = false;
        submit.disabled = false;
      }
    }
  });

  return { reset() {
    current?.abort();
    current = undefined;
    form.querySelector('fieldset').disabled = false;
    submit.disabled = false;
    form.reset();
    scenes.length = 0;
    list.replaceChildren();
    clear();
    status.textContent = '';
  } };
}
