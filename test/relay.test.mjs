import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { createApp } from '../server.mjs';

const key = 'sk-test-secret';
const requests = [];
const fake = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
  const path = new URL(req.url, 'http://127.0.0.1');
  requests.push({ path: path.pathname, query: path.search, headers: req.headers, body });

  function json(data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  if (req.headers.authorization === 'Bearer bad-key') return json({ error: { message: 'Rejected bad-key' } }, 401);
  if (path.pathname === '/redirect/v1/models') {
    res.writeHead(302, { Location: '/other/v1/models' });
    return res.end();
  }
  if (path.pathname === '/google/v1beta/models') {
    if (path.searchParams.has('pageToken')) return json({ models: [{ name: 'models/gemini-next' }] });
    return json({ nextPageToken: 'page-2', models: [
      { name: 'models/gemini-demo', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
    ] });
  }
  if (path.pathname === '/claude/v1/models') {
    if (path.searchParams.has('after_id')) return json({ data: [{ id: 'claude-next' }], has_more: false });
    return json({ data: [{ id: 'claude-demo', display_name: 'Claude Demo' }], has_more: true, last_id: 'claude-demo' });
  }
  if (path.pathname.endsWith('/models')) return json({ data: [{ id: 'mock-ok' }, { id: 'mock-truncated' }] });

  if (path.pathname.endsWith('/responses') && !body.stream) {
    return json({ output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: '同步正常' }] }] });
  }
  if (body?.model === 'missing') return json({ error: { message: 'Model unavailable' } }, 404);

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.flushHeaders();
  const send = data => res.write(`data: ${JSON.stringify(data)}\r\n\r\n`);
  if (path.pathname.endsWith('/responses')) {
    send({ type: 'response.output_text.delta', delta: '连接' });
    await delay(25);
    send({ type: 'response.output_text.delta', delta: '正常' });
    if (body.model !== 'mock-truncated') send({ type: 'response.completed', response: { output_text: '连接正常' } });
  } else if (path.pathname.endsWith('/chat/completions')) {
    send({ choices: [{ delta: { content: '返回 sk-test-' }, finish_reason: null }] });
    send({ choices: [{ delta: { content: 'secret 正常' }, finish_reason: null }] });
    res.write('data: [DONE]\n\n');
  } else if (path.pathname.endsWith('/messages')) {
    send({ type: 'content_block_start', content_block: { type: 'text', text: 'Claude ' } });
    send({ type: 'content_block_delta', delta: { type: 'text_delta', text: '正常' } });
    send({ type: 'message_stop' });
  } else if (path.pathname.endsWith(':streamGenerateContent')) {
    send({ candidates: [{ content: { parts: [{ text: '隐藏的思考', thought: true }, { text: 'Gemini 正常' }] }, finishReason: 'STOP' }] });
  }
  res.end();
});

const app = createApp();
let local;
let upstream;

async function start(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => { [local, upstream] = await Promise.all([start(app), start(fake)]); });
after(async () => {
  await Promise.all([app, fake].map(server => new Promise(resolve => server.close(resolve))));
});

function request(path, overrides = {}, options = {}) {
  return fetch(`${local}/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...options },
    body: JSON.stringify({ baseUrl: `${upstream}/relay/v1/responses/`, apiKey: key, protocol: 'responses', model: 'mock-ok', prompt: 'Say hello', ...overrides }),
  });
}

async function probe(overrides) {
  const response = await request('probe', overrides);
  assert.equal(response.status, 200);
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line));
}

const text = events => events.filter(event => event.type === 'text').map(event => event.value).join('');

test('serves UI and assets and binds API requests to the local origin', async () => {
  const page = await fetch(local);
  assert.match(await page.text(), /中转站<span>可用性测试/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${local}/moon-relay.webp`)).headers.get('content-type'), 'image/webp');
  assert.equal((await request('models', {}, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('models', {}, { 'Content-Type': 'text/plain' })).status, 415);
});

test('uses the selected key and discovers models from an API URL with a prefix and endpoint', async () => {
  const data = await (await request('models')).json();
  assert.equal(data.status, 200);
  assert.deepEqual(data.models.map(model => model.id), ['mock-ok', 'mock-truncated']);
  assert.equal(requests.at(-1).path, '/relay/v1/models');
  assert.equal(requests.at(-1).headers.authorization, `Bearer ${key}`);
  assert.equal((await request('models', { baseUrl: `${upstream}/custom/responses` })).status, 200);
  assert.equal(requests.at(-1).path, '/custom/models');
});

test('discovers Claude and Gemini models across pages using their native auth', async () => {
  const claude = await (await request('models', { protocol: 'claude', baseUrl: `${upstream}/claude` })).json();
  assert.deepEqual(claude.models.map(model => model.id), ['claude-demo', 'claude-next']);
  assert.equal(requests.at(-1).query, '?after_id=claude-demo');
  assert.equal(requests.at(-1).headers['x-api-key'], key);
  assert.equal(requests.at(-1).headers['anthropic-version'], '2023-06-01');
  const gemini = await (await request('models', { protocol: 'gemini', baseUrl: `${upstream}/google` })).json();
  assert.deepEqual(gemini.models.map(model => model.id), ['gemini-demo', 'gemini-next']);
  assert.equal(requests.at(-1).query, '?pageToken=page-2');
  assert.equal(requests.at(-1).headers['x-goog-api-key'], key);
});

test('streams Responses text with timings and handles synchronous requests', async () => {
  const stream = await probe();
  assert.equal(text(stream), '连接正常');
  assert.equal(stream.filter(event => event.type === 'text').length, 2);
  const end = stream.at(-1);
  assert.equal(end.type, 'done');
  assert.ok(end.durationMs > end.firstTextMs && end.firstTextMs >= end.headersMs);
  const sync = await probe({ stream: false });
  assert.equal(text(sync), '同步正常');
  assert.equal(sync.at(-1).firstTextMs, null);
  assert.equal(requests.at(-1).body.stream, false);
});

test('normalizes Chat, Claude and Gemini streams and masks a key split across two events', async () => {
  const chat = await probe({ protocol: 'chat', baseUrl: upstream });
  assert.equal(text(chat), '返回 •••• 正常');
  assert.equal(requests.at(-1).path, '/v1/chat/completions');
  assert.equal(text(await probe({ protocol: 'claude', baseUrl: upstream, auth: 'bearer' })), 'Claude 正常');
  assert.equal(requests.at(-1).headers.authorization, `Bearer ${key}`);
  assert.equal(requests.at(-1).headers['x-api-key'], undefined);
  assert.equal(text(await probe({ protocol: 'gemini', baseUrl: `${upstream}/v1beta/models/other:streamGenerateContent?alt=sse`, model: 'models/demo' })), 'Gemini 正常');
  assert.equal(requests.at(-1).path, '/v1beta/models/demo:streamGenerateContent');
  assert.equal(requests.at(-1).query, '?alt=sse');
});

test('reports upstream HTTP errors, redacts credentials, and rejects truncation and redirects', async () => {
  const denied = await (await request('models', { apiKey: 'bad-key' })).json();
  assert.equal(denied.status, 401);
  assert.equal(denied.message, 'Rejected ••••');
  const missing = (await probe({ model: 'missing' })).at(-1);
  assert.equal(missing.status, 404);
  assert.equal(missing.type, 'error');
  const truncated = await probe({ model: 'mock-truncated' });
  assert.equal(text(truncated), '连接正常');
  assert.match(truncated.at(-1).message, /提前中断/);
  const redirect = await (await request('models', { baseUrl: `${upstream}/redirect` })).json();
  assert.equal(redirect.status, 302);
  assert.equal(requests.at(-1).path, '/redirect/v1/models');
});
