import { createPanel } from './panel.js';

const byId = id => document.getElementById(id);
const token = location.hash.slice(1);
if (token) history.replaceState(null, '', location.pathname);

const ui = {
  login: byId('login'), keyForm: byId('key-form'), key: byId('key'), keyError: byId('key-error'),
  connect: byId('connect'), disconnect: byId('disconnect'), sidebar: byId('sidebar'),
  menu: byId('menu'), newChat: byId('new-chat'), chats: byId('chats'), usage: byId('usage'),
  title: byId('title'), viewport: byId('viewport'), thread: byId('thread'),
  notice: byId('notice'), composer: byId('composer'), message: byId('message'),
  send: byId('send'), stop: byId('stop'), deleteDialog: byId('delete-dialog'),
  deleteName: byId('delete-name'),
  enterPanel: byId('enter-panel'), reconnect: byId('reconnect-nvidia'),
};
const number = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
let chats = [];
let current;
let connected = false;
let panelOpen = false;
let pending;
let pendingDeletion;
let leaving = false;
let stats = { requests: 0, metered: 0, input: 0, output: 0 };
const panel = createPanel({ post, result, number, usage, onBusy: controls, chatBusy: () => Boolean(pending) });

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function inline(text, element) {
  const pattern = /(\x60[^\x60\r\n]+\x60|\*\*[^*\r\n]+\*\*)/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    element.append(text.slice(offset, match.index));
    const span = match[0];
    element.append(span.startsWith('**') ? node('strong', span.slice(2, -2)) : node('code', span.slice(1, -1)));
    offset = match.index + span.length;
  }
  element.append(text.slice(offset));
  return element;
}

function markdown(text, target) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const isTableRule = line => Boolean(line?.includes('|') && cells(line).every(cell => /^:?-{2,}:?$/.test(cell)));
  const listItem = line => /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line ?? '');
  const isHeading = line => /^#{1,4}\s+(.+)$/.exec(line ?? '');
  const isFence = line => /^\s*\x60{3}/.test(line ?? '');
  target.replaceChildren();
  target.classList.add('rendered');
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (isFence(line)) {
      const code = [];
      index++;
      while (index < lines.length && !isFence(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      const pre = node('pre');
      pre.append(node('code', code.join('\n')));
      target.append(pre);
    } else if (line.includes('|') && isTableRule(lines[index + 1])) {
      const table = node('table');
      const head = table.createTHead().insertRow();
      for (const cell of cells(line)) head.append(inline(cell, node('th')));
      index += 2;
      const body = table.createTBody();
      while (lines[index]?.includes('|') && lines[index].trim()) {
        const row = body.insertRow();
        for (const cell of cells(lines[index++])) row.append(inline(cell, node('td')));
      }
      const wrap = node('div', undefined, 'table-wrap');
      wrap.append(table);
      target.append(wrap);
    } else if (isHeading(line)) {
      const level = Math.min(4, line.match(/^#+/)[0].length + 1);
      target.append(inline(isHeading(line)[1], node('h' + level)));
      index++;
    } else if (listItem(line)) {
      const ordered = /^\d/.test(line);
      const list = node(ordered ? 'ol' : 'ul');
      while (listItem(lines[index]) && /^\d/.test(lines[index]) === ordered) {
        list.append(inline(listItem(lines[index++])[1], node('li')));
      }
      target.append(list);
    } else {
      const paragraph = [line];
      index++;
      while (lines[index]?.trim() && !isFence(lines[index]) && !isHeading(lines[index]) &&
             !listItem(lines[index]) && !(lines[index].includes('|') && isTableRule(lines[index + 1]))) {
        paragraph.push(lines[index++]);
      }
      target.append(inline(paragraph.join('\n'), node('p')));
    }
  }
}

function post(path, data, options = {}) {
  return fetch('/api/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
    ...options,
  });
}

async function result(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'La solicitud no se completó.');
  return data;
}

function notice(message = '') {
  ui.notice.textContent = message;
  ui.notice.hidden = !message;
}

function usage(next = stats) {
  stats = next;
  if (!stats.requests) {
    ui.usage.textContent = '';
  } else {
    const count = number.format(stats.requests);
    const label = stats.requests === 1 ? 'solicitud' : 'solicitudes';
    const tokens = stats.metered ? number.format(stats.input + stats.output) + ' tokens' : 'tokens sin informar';
    ui.usage.textContent = 'Sesión: ' + count + ' ' + label + ' · ' + tokens +
      (stats.metered && stats.metered < stats.requests ? ' parciales' : '');
    ui.usage.title = stats.metered
      ? 'NVIDIA · ' + number.format(stats.input) + ' de entrada + ' + number.format(stats.output) + ' de salida en esta sesión.'
      : 'NVIDIA no informó el consumo de estas solicitudes.';
  }
}

function controls() {
  ui.send.disabled = !connected || Boolean(pending) || panel.busy || !ui.message.value.trim();
  ui.send.hidden = Boolean(pending);
  ui.stop.hidden = !pending;
  ui.newChat.disabled = !connected || Boolean(pending);
  ui.disconnect.disabled = Boolean(pending) || panel.busy;
  ui.message.disabled = !connected || Boolean(pending);
}

function menu(open) {
  ui.sidebar.classList.toggle('open', open);
  ui.menu.setAttribute('aria-expanded', String(open));
}

function showChats() {
  ui.title.textContent = current?.title ?? 'Nuevo chat';
  ui.chats.replaceChildren();
  for (const chat of chats) {
    const row = node('div', undefined, 'chat-row');
    const button = node('button', chat.title, 'chat-link');
    button.type = 'button';
    button.disabled = Boolean(pending);
    button.title = chat.title;
    button.setAttribute('aria-current', String(chat === current));
    button.addEventListener('click', () => {
      if (pending) return;
      current = chat;
      ui.message.value = chat.draft;
      notice();
      render();
      menu(false);
      ui.message.focus();
    });
    const remove = node('button', undefined, 'chat-delete');
    remove.type = 'button';
    remove.disabled = Boolean(pending);
    remove.title = 'Eliminar chat';
    remove.setAttribute('aria-label', 'Eliminar chat: ' + chat.title);
    const icon = node('span', undefined, 'trash-icon');
    icon.setAttribute('aria-hidden', 'true');
    remove.append(icon);
    remove.addEventListener('click', () => {
      if (pending || !connected) return;
      pendingDeletion = chat;
      ui.deleteName.textContent = chat.title;
      ui.deleteDialog.returnValue = 'cancel';
      ui.deleteDialog.showModal();
    });
    row.append(button, remove);
    ui.chats.append(row);
  }
}

function deleteSelectedChat() {
  const chat = pendingDeletion;
  pendingDeletion = undefined;
  ui.deleteName.textContent = '';
  if (ui.deleteDialog.returnValue !== 'delete' || !chat) return;
  const index = chats.indexOf(chat);
  if (index === -1) return;

  chats.splice(index, 1);
  if (current === chat) {
    newChat();
  } else {
    showChats();
    const next = ui.chats.querySelectorAll('.chat-delete')[Math.min(index, chats.length - 1)];
    (next ?? ui.newChat).focus();
  }
  notice('Chat eliminado de esta sesión.');
}

function scrollToEnd() {
  ui.viewport.scrollTop = ui.viewport.scrollHeight;
}

function addMessage(message) {
  const box = node('article', undefined, 'message ' + message.role);
  const content = node('div', undefined, 'content');
  if (message.role === 'assistant') box.append(node('div', 'Nemotron', 'speaker'));
  box.append(content);
  if (message.role === 'assistant' && message.content) markdown(message.content, content);
  else content.textContent = message.content || 'Esperando respuesta…';
  if (message.role === 'assistant' && message.content) {
    const actions = node('div', undefined, 'response-actions');
    const copy = node('button', 'Copiar', 'quiet');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        copy.textContent = 'Copiado';
        setTimeout(() => { copy.textContent = 'Copiar'; }, 1500);
      } catch {
        notice('Selecciona el texto para copiarlo.');
      }
    });
    actions.append(copy);
    if (message.meta) {
      const count = message.meta.usage;
      const tokens = count ? number.format(count.input + count.output) + ' tokens · ' : '';
      actions.append(node('span', tokens + number.format(message.meta.seconds) + ' s'));
    }
    box.append(actions);
  }
  ui.thread.append(box);
  return content;
}

function render() {
  showChats();
  ui.thread.replaceChildren();
  if (!current?.messages.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h1', '¿Qué quieres hacer?'),
      node('p', 'Escribe una pregunta, pide un borrador o comparte un ejemplo ficticio.'));
    ui.thread.append(empty);
  } else {
    for (const message of current.messages) addMessage(message);
  }
  controls();
  scrollToEnd();
}

function newChat() {
  current = { title: 'Nuevo chat', messages: [], draft: '' };
  notice();
  ui.message.value = '';
  render();
  menu(false);
  ui.message.focus();
}

function setConnected(on) {
  connected = on;
  ui.reconnect.hidden = on;
  controls();
}

function setPanelOpen(open) {
  panelOpen = open;
  ui.login.hidden = open;
  ui.disconnect.hidden = !open;
  document.querySelector('.app').inert = !open;
  if (open) panel.focus();
  else ui.key.focus();
}

async function readAnswer(response, onText) {
  let final;
  if (!response.ok) await result(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let eol;
      while ((eol = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (event.text) onText(event.text);
        if (event.done) final = event;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!final) throw new Error('La respuesta se interrumpió antes de terminar.');
  return final;
}

async function send(event) {
  event.preventDefault();
  const content = ui.message.value.trim();
  if (!connected || pending || panel.busy || !content) return;
  notice();
  const chat = current;
  const userMessage = { role: 'user', content };
  if (!chats.includes(chat)) {
    chat.title = content.replace(/\s+/g, ' ').slice(0, 70);
    chats.unshift(chat);
  }
  chat.messages.push(userMessage);
  chat.draft = '';
  ui.message.value = '';
  pending = new AbortController();
  panel.status();
  render();
  const answer = { role: 'assistant', content: '' };
  const live = addMessage(answer);
  scrollToEnd();
  try {
    const response = await post('send', { messages: chat.messages }, { signal: pending.signal });
    const final = await readAnswer(response, chunk => {
      const nearBottom = ui.viewport.scrollHeight - ui.viewport.scrollTop - ui.viewport.clientHeight < 60;
      answer.content += chunk;
      live.textContent = answer.content;
      if (nearBottom) scrollToEnd();
    });
    answer.meta = final;
    chat.messages.push(answer);
    usage(final.stats);
    if (final.finish === 'length') notice('NVIDIA alcanzó el límite de esta respuesta. Puedes pedirle que continúe.');
  } catch (error) {
    chat.messages.pop();
    chat.draft = content;
    ui.message.value = content;
    const message = error instanceof TypeError ? 'Se interrumpió la conexión con el chat.' : error.message;
    notice(pending.signal.aborted ? 'Respuesta detenida. NVIDIA puede contabilizar la solicitud.' : message);
    try {
      const status = await result(await post('status'));
      usage(status.stats);
      if (!status.connected) {
        ui.keyError.textContent = message;
        ui.keyError.hidden = false;
        setConnected(false);
        setPanelOpen(false);
        panel.status(status.panel);
      }
    } catch {
      notice('El chat perdió la conexión. Abre el acceso directo de nuevo.');
    }
  } finally {
    pending = null;
    panel.status();
    render();
    if (connected) ui.message.focus();
  }
}

ui.keyForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!token) return;
  ui.connect.disabled = true;
  ui.keyError.hidden = true;
  ui.enterPanel.disabled = true;
  try {
    const response = await post('connect', { key: ui.key.value.trim() });
    ui.key.value = '';
    const status = await result(response);
    usage(status.stats);
    panel.status(status.panel);
    setConnected(true);
    panel.show('chat');
    setPanelOpen(true);
  } catch (error) {
    ui.keyError.textContent = error.message;
    ui.keyError.hidden = false;
    ui.key.focus();
  } finally {
    ui.connect.disabled = false;
    ui.enterPanel.disabled = false;
  }
});
ui.disconnect.addEventListener('click', async () => {
  if (pending || panel.busy) return;
  ui.disconnect.disabled = true;
  ui.send.disabled = true;
  ui.newChat.disabled = true;
  ui.message.disabled = true;
  try {
    const status = await result(await post('disconnect'));
    usage(status.stats);
    panel.reset(status.panel);
    chats = [];
    newChat();
    setConnected(false);
    setPanelOpen(false);
  } catch (error) {
    notice(error.message);
  } finally {
    controls();
  }
});
ui.enterPanel.addEventListener('click', async () => {
  if (!token) return;
  ui.enterPanel.disabled = true;
  ui.connect.disabled = true;
  try {
    const status = await result(await post('status'));
    panel.status(status.panel);
    setConnected(status.connected);
    if (!panelOpen && !status.connected) panel.show('image');
    setPanelOpen(true);
  } catch (error) {
    ui.keyError.textContent = error.message;
    ui.keyError.hidden = false;
  } finally {
    ui.connect.disabled = false;
    ui.enterPanel.disabled = false;
  }
});
ui.reconnect.addEventListener('click', () => {
  ui.keyError.hidden = true;
  setPanelOpen(false);
});
ui.newChat.addEventListener('click', newChat);
ui.deleteDialog.addEventListener('close', deleteSelectedChat);
ui.composer.addEventListener('submit', send);
ui.message.addEventListener('input', () => {
  current.draft = ui.message.value;
  controls();
});
ui.message.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    ui.composer.requestSubmit();
  }
});
ui.stop.addEventListener('click', () => pending?.abort());
ui.menu.addEventListener('click', () => menu(ui.menu.getAttribute('aria-expanded') !== 'true'));
window.addEventListener('pagehide', () => {
  leaving = true;
  if (token) void post('leave', null, { keepalive: true }).catch(() => {});
});
window.addEventListener('pageshow', () => { leaving = false; });

newChat();
setConnected(false);
setPanelOpen(false);
if (token) {
  setInterval(async () => {
    if (leaving || pending || panel.busy) return;
    try {
      const snapshot = await result(await post('status'));
      if (leaving || pending || panel.busy) return;
      usage(snapshot.stats);
      if (connected !== snapshot.connected) setConnected(snapshot.connected);
      panel.status(snapshot.panel);
    } catch { /* The launcher may have closed. */ }
  }, 30_000);
} else {
  ui.keyError.textContent = 'Abre el acceso directo IA Lab PC - Chat NVIDIA para iniciar una sesión.';
  ui.keyError.hidden = false;
  ui.connect.disabled = true;
  ui.enterPanel.disabled = true;
}
