const $ = id => document.getElementById(id);
const connectionForm = $('connection-form');
const probeForm = $('probe-form');
const modelInput = $('model');
const promptInput = $('prompt');
const output = $('output');
const consoleBody = $('console-body');
const modelRows = $('model-rows');
const search = $('search');
const selected = new Set();
const results = new Map();
const rows = new Map();
const protocols = {
  responses: '/v1/responses',
  chat: '/v1/chat/completions',
  claude: '/v1/messages',
  gemini: '/v1beta/models/{id}:generateContent',
};

let models = [];
let discovered = false;
let operation = null;
let current = null;
let autofilled = '';
let copyTimer;

$('local-port').textContent = location.port || '80';

function protocol() {
  return connectionForm.elements.protocol.value;
}

function settings() {
  return {
    protocol: protocol(),
    baseUrl: $('base-url').value.trim(),
    apiKey: $('api-key').value.trim(),
    auth: $('auth-label').hidden ? 'native' : $('auth').value,
  };
}

function syncProtocol() {
  const value = protocol();
  $('endpoint').textContent = protocols[value];
  $('auth-label').hidden = value !== 'claude' && value !== 'gemini';
  if (value === 'gemini' && $('stream').checked) {
    $('endpoint').textContent = '/v1beta/models/{id}:streamGenerateContent';
  }
}

function tone(element, value) {
  if (value) element.dataset.tone = value;
  else delete element.dataset.tone;
}

function connectionStatus(text, appearance) {
  const status = $('connection-status');
  status.textContent = text;
  tone(status, appearance);
}

function probeStatus(text, appearance) {
  const status = $('probe-status');
  status.lastElementChild.textContent = text;
  tone(status, appearance);
}

function duration(value) {
  return Number.isFinite(value) ? `${value} ms` : '—';
}

function syncOutputActions() {
  $('clear').disabled = Boolean(operation) || !current;
  $('copy').disabled = !current?.text;
}

function resetConsole() {
  current = null;
  output.textContent = '';
  output.hidden = true;
  $('output-note').hidden = true;
  $('output-model').textContent = '';
  $('empty-output').hidden = false;
  $('empty-output').dataset.running = 'false';
  $('empty-output').lastElementChild.textContent = '测试输出将在这里显示';
  renderMetrics();
  probeStatus('等待测试');
  syncOutputActions();
}

function renderMetrics(result = {}) {
  $('http-status').textContent = result.status ?? '—';
  $('headers-time').textContent = duration(result.headersMs);
  $('first-time').textContent = duration(result.firstTextMs);
  $('total-time').textContent = duration(result.durationMs);
}

function showResult(result) {
  current = result;
  $('output-model').textContent = result.model;
  $('output-model').title = result.model;
  output.textContent = result.text;
  output.hidden = !result.text;
  const note = $('output-note');
  note.hidden = !result.message;
  note.textContent = result.message ?? '';
  tone(note, result.state === 'success' ? null : result.state);
  const empty = $('empty-output');
  const running = result.state === 'active';
  empty.hidden = Boolean(result.text || result.message);
  empty.dataset.running = String(running);
  empty.lastElementChild.textContent = '等待中转站响应…';
  renderMetrics(result);
  probeStatus(result.label, result.state);
  syncOutputActions();
}

function chooseModel(id) {
  modelInput.value = id;
  autofilled = id;
}

function visibleModels() {
  const term = search.value.trim().toLowerCase();
  return models.filter(({ id, name }) => `${id} ${name}`.toLowerCase().includes(term));
}

function selectionState() {
  const visible = visibleModels();
  const checked = visible.filter(model => selected.has(model.id)).length;
  const all = $('select-all');
  all.checked = checked > 0 && checked === visible.length;
  all.indeterminate = checked > 0 && checked < visible.length;
  all.disabled = Boolean(operation) || !visible.length;
  $('batch').disabled = Boolean(operation) || !selected.size;
  $('batch').textContent = selected.size ? `测试所选（${selected.size}）` : '测试所选';
}

function updateRow(id) {
  const row = rows.get(id);
  if (!row) return;
  const result = results.get(id);
  const status = row.querySelector('.row-status');
  status.textContent = result?.label ?? '未测试';
  tone(status, result?.state);
  row.querySelector('.row-time').textContent = duration(result?.durationMs);
  row.querySelector('.row-view').hidden = !result || result.state === 'active';
  row.querySelector('input').checked = selected.has(id);
  for (const control of row.querySelectorAll('input, button')) control.disabled = Boolean(operation);
}

function renderTable() {
  const visible = visibleModels();
  $('model-count').textContent = models.length;
  $('model-table').hidden = !visible.length;
  const empty = $('models-empty');
  empty.hidden = Boolean(visible.length);
  if (models.length) empty.textContent = '没有匹配的模型。';
  else if (discovered) empty.textContent = '中转站未返回可列出的模型。可以手动输入模型 ID。';
  else empty.textContent = '获取模型列表后，可在此选择要实测的模型。';

  const fragment = document.createDocumentFragment();
  rows.clear();
  for (const { id, name } of visible) {
    const row = $('model-row').content.firstElementChild.cloneNode(true);
    rows.set(id, row);
    const checkbox = row.querySelector('input');
    checkbox.setAttribute('aria-label', `选择 ${id}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(id);
      else selected.delete(id);
      selectionState();
    });
    const modelButton = row.querySelector('.model-id');
    modelButton.textContent = id;
    modelButton.title = '填入模型 ID';
    modelButton.addEventListener('click', () => {
      chooseModel(id);
      modelInput.focus();
    });
    const nameElement = row.querySelector('.model-name');
    nameElement.hidden = name === id;
    nameElement.textContent = name;
    row.querySelector('.row-run').addEventListener('click', () => {
      if (runTests([id])) showConsole();
    });
    row.querySelector('.row-view').addEventListener('click', () => {
      const result = results.get(id);
      if (!result || operation) return;
      chooseModel(id);
      showResult(result);
      showConsole();
    });
    fragment.append(row);
    updateRow(id);
  }
  modelRows.replaceChildren(fragment);
  selectionState();
  search.disabled = Boolean(operation) || !models.length;
}

function showConsole() {
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  $('probe-title').scrollIntoView({ behavior, block: 'nearest' });
  consoleBody.focus({ preventScroll: true });
}

function setOperation(next) {
  operation = next;
  const busy = Boolean(operation);
  for (const id of ['base-url', 'api-key', 'toggle-key', 'auth', 'discover', 'model', 'prompt', 'stream', 'run']) {
    $(id).disabled = busy;
  }
  for (const radio of connectionForm.querySelectorAll('input[type="radio"]')) radio.disabled = busy;
  $('stop').hidden = !busy;
  $('stop').disabled = false;
  $('stop').textContent = next?.kind === 'discover' ? '取消获取' : '停止';
  search.disabled = busy || !models.length;
  for (const id of rows.keys()) updateRow(id);
  selectionState();
  syncOutputActions();
}

async function post(path, payload, signal) {
  const response = await fetch(path, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json();
    const error = new Error(data.message || '本地请求失败。');
    error.upstreamStatus = data.status;
    throw error;
  }
  return response;
}

connectionForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (operation) return;
  const config = settings();
  const controller = new AbortController();
  setOperation({ kind: 'discover', controller });
  connectionStatus('正在获取模型列表…', 'active');
  try {
    const response = await post('/api/models', config, controller.signal);
    const data = await response.json();
    models = data.models;
    discovered = true;
    const idSet = new Set(models.map(model => model.id));
    for (const id of selected) if (!idSet.has(id)) selected.delete(id);
    const suggestions = models.map(({ id }) => new Option(id, id));
    $('model-suggestions').replaceChildren(...suggestions);
    if (!modelInput.value && models.length === 1) chooseModel(models[0].id);
    connectionStatus(`HTTP ${data.status} · ${models.length} 个模型 · ${duration(data.durationMs)}`, 'success');
    renderTable();
  } catch (error) {
    if (controller.signal.aborted) connectionStatus('已取消获取模型。', 'stopped');
    else {
      const prefix = error.upstreamStatus ? `HTTP ${error.upstreamStatus} · ` : '';
      connectionStatus(`${prefix}${error.message}`, 'error');
    }
  } finally {
    setOperation(null);
  }
});

function clearConnectionResults() {
  models = [];
  discovered = false;
  results.clear();
  selected.clear();
  search.value = '';
  $('model-suggestions').replaceChildren();
  if (modelInput.value === autofilled) modelInput.value = '';
  autofilled = '';
  connectionStatus('API Key 仅用于本次页面会话');
  renderTable();
  resetConsole();
}

$('base-url').addEventListener('input', clearConnectionResults);
$('api-key').addEventListener('input', clearConnectionResults);
$('auth').addEventListener('change', clearConnectionResults);
for (const radio of connectionForm.querySelectorAll('input[type="radio"]')) {
  radio.addEventListener('change', () => {
    syncProtocol();
    clearConnectionResults();
  });
}
$('stream').addEventListener('change', syncProtocol);
$('toggle-key').addEventListener('click', event => {
  const button = event.currentTarget;
  const input = $('api-key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? '隐藏' : '显示';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', `${button.textContent} API Key`);
});

search.addEventListener('input', renderTable);
$('select-all').addEventListener('change', event => {
  for (const { id } of visibleModels()) {
    if (event.currentTarget.checked) selected.add(id);
    else selected.delete(id);
    updateRow(id);
  }
  selectionState();
});

async function* events(response) {
  let remaining = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    const lines = (remaining + chunk).split('\n');
    remaining = lines.pop();
    for (const line of lines) if (line) yield JSON.parse(line);
  }
  if (remaining.trim()) yield JSON.parse(remaining);
}

async function runProbe(config, model, controller, progress) {
  const result = { model, text: '', state: 'active', label: '测试中' };
  results.set(model, result);
  updateRow(model);
  chooseModel(model);
  showResult(result);
  if (progress) probeStatus(`测试中 ${progress}`, 'active');
  const started = performance.now();
  const timer = setInterval(() => { $('total-time').textContent = duration(Math.round(performance.now() - started)); }, 100);
  let terminal = false;
  let upstreamStreamed = false;
  try {
    const response = await post('/api/probe', { ...config, model }, controller.signal);
    for await (const event of events(response)) {
      if (event.type === 'headers') {
        upstreamStreamed = event.streamed;
        result.status = event.status;
        result.headersMs = event.headersMs;
        renderMetrics({ ...result, durationMs: Math.round(performance.now() - started) });
      } else if (event.type === 'text') {
        const atBottom = consoleBody.scrollHeight - consoleBody.scrollTop - consoleBody.clientHeight < 25;
        result.text += event.value;
        result.firstTextMs = upstreamStreamed ? event.firstTextMs : null;
        $('first-time').textContent = duration(result.firstTextMs);
        $('empty-output').hidden = true;
        output.hidden = false;
        output.append(document.createTextNode(event.value));
        if (atBottom) consoleBody.scrollTop = consoleBody.scrollHeight;
        syncOutputActions();
      } else if (event.type === 'done' || event.type === 'error') {
        terminal = true;
        result.status = event.status;
        result.headersMs = event.headersMs;
        result.firstTextMs = event.firstTextMs;
        result.durationMs = event.durationMs;
        result.state = event.type === 'done' ? 'success' : 'error';
        result.label = event.type === 'done' ? '通过' : '失败';
        result.message = event.message ?? (config.stream && !upstreamStreamed ? '中转站返回普通响应，首段延时仅在 SSE 流式响应中测量。' : '');
      }
    }
    if (!terminal) throw new Error('本地响应提前中断。');
  } catch (error) {
    const stopped = controller.signal.aborted;
    result.state = stopped ? 'stopped' : 'error';
    result.label = stopped ? '已停止' : '失败';
    result.message = stopped ? '已停止本次测试。' : error.message;
    result.durationMs = Math.round(performance.now() - started);
  } finally {
    clearInterval(timer);
    showResult(result);
    updateRow(model);
  }
  return result;
}

function runTests(ids) {
  if (operation || !ids.length || !connectionForm.reportValidity() || !promptInput.reportValidity()) return false;
  if (!promptInput.value.trim() || ids.some(id => !id)) {
    probeStatus('请输入模型与提示词', 'error');
    return false;
  }
  const config = { ...settings(), prompt: promptInput.value.trim(), stream: $('stream').checked };
  const controller = new AbortController();
  setOperation({ kind: 'probe', controller });
  void runQueue(ids, config, controller);
  return true;
}

async function runQueue(ids, config, controller) {
  let passed = 0;
  try {
    for (const [index, model] of ids.entries()) {
      if (controller.signal.aborted) break;
      const progress = ids.length > 1 ? `${index + 1}/${ids.length}` : '';
      const result = await runProbe(config, model, controller, progress);
      if (result.state === 'success') passed++;
    }
    if (ids.length > 1) {
      const stopped = controller.signal.aborted;
      probeStatus(stopped ? `已停止 · ${passed}/${ids.length} 通过` : `${passed}/${ids.length} 通过`, stopped ? 'stopped' : passed === ids.length ? 'success' : 'error');
    }
  } finally {
    setOperation(null);
  }
}

probeForm.addEventListener('submit', event => {
  event.preventDefault();
  runTests([modelInput.value.trim()]);
});
$('batch').addEventListener('click', () => {
  if (runTests([...selected])) showConsole();
});
$('stop').addEventListener('click', event => {
  if (!operation) return;
  event.currentTarget.disabled = true;
  operation.controller.abort();
});
$('clear').addEventListener('click', resetConsole);
$('copy').addEventListener('click', async event => {
  const button = event.currentTarget;
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(current.text);
    button.textContent = '已复制';
  } catch {
    button.textContent = '复制失败';
  }
  copyTimer = setTimeout(() => { button.textContent = '复制'; }, 1500);
});

syncProtocol();
renderTable();
