import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { createApp } from '../server.mjs';
import { connection, errorDiagnosis, RelayError } from '../relay.mjs';

const key = 'sk-test-secret';
const clientNotice = '本站仅支持编程客户端使用：Codex、Claude Code、OpenCode、ZCode、DeepSeek Harness、Hermes Agent、Minis、WorkBuddy、Cursor、pi/omp、Qoder、Kilo、Cline、Roo、Trae、GitHub Copilot、Grok CLI。脚本、SDK 直连和第三方聊天客户端暂不支持';
const failures = {
  policy: { status: 403, body: { error: { type: 'invalid_request_error', message: clientNotice } }, category: 'client_restricted' },
  'plain-policy': { status: 200, body: clientNotice, contentType: 'text/plain', category: 'client_restricted' },
  'html-policy': { status: 403, body: `<html><body><p>${clientNotice}</p></body></html>`, contentType: 'text/html', category: 'client_restricted' },
  'wrapped-policy': { status: 200, body: { success: false, code: 'UNSUPPORTED_CLIENT', message: clientNotice }, category: 'client_restricted' },
  'json-string-policy': { status: 200, body: clientNotice, category: 'client_restricted' },
  balance: { status: 403, body: { error: { code: 'insufficient_balance', type: 'invalid_request_error', message: '余额不足喵' } }, category: 'balance_insufficient' },
  quota: { status: 429, body: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota.' } }, category: 'quota_exhausted' },
  group: { status: 500, body: { error: { code: 'no_available_channel', message: '当前分组模型不存在喵' } }, category: 'group_unavailable' },
  model: { status: 404, body: { error: { code: 'model_not_found', message: 'The model does not exist' } }, category: 'model_unavailable' },
  upstream: { status: 529, body: { error: { type: 'overloaded_error', message: '上游出问题了喵' } }, category: 'upstream_error' },
  rate: { status: 429, body: { error: { code: 'rate_limit_exceeded', message: 'Too many requests' } }, category: 'rate_limited' },
  'ambiguous-429': { status: 429, body: {}, category: 'rate_or_quota' },
  'gemini-quota': { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource exhausted' } }, category: 'rate_or_quota' },
  'code-only': { status: 200, body: { code: 'invalid_api_key' }, category: 'authentication_failed' },
  'unknown-code-only': { status: 200, body: { code: 'CUSTOM_999', message: '站点自定义错误' }, category: 'unknown_error' },
  permission: { status: 403, body: { error: { type: 'permission_error', message: 'You do not have access' } }, category: 'permission_denied' },
  parameter: { status: 400, body: { error: { code: 'unsupported_parameter', message: 'Unsupported parameter max_output_tokens' } }, category: 'request_invalid' },
  'upstream-message': { status: 200, body: { success: false, message: '上游出问题了喵' }, category: 'upstream_error' },
  'http-only': { status: 502, body: '', contentType: 'text/plain', category: 'upstream_error' },
  'unknown-code': { status: 400, body: { error: { code: 'CUSTOM_777', message: `Something unusual ${key}` } }, category: 'request_invalid' },
  unknown: { status: 200, body: { success: false, code: 777, msg: '自定义错误' }, category: 'unknown_error' },
  webpage: { status: 200, body: '<html><body>Welcome to relay</body></html>', contentType: 'text/html', category: 'invalid_response' },
};
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

  const scenario = path.pathname === '/diagnostic/v1/models' ? failures.policy : failures[body?.model?.replace(/^diagnostic-/, '')];
  if (scenario) {
    if (!scenario.contentType) return json(scenario.body, scenario.status);
    res.writeHead(scenario.status, { 'Content-Type': scenario.contentType });
    return res.end(scenario.body);
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

  if (body?.model === 'sync-policy') {
    if (path.pathname.endsWith('/responses')) return json({ output_text: clientNotice });
    if (path.pathname.endsWith('/chat/completions')) return json({ choices: [{ message: { content: clientNotice } }] });
    if (path.pathname.endsWith('/messages')) return json({ content: [{ type: 'text', text: clientNotice }] });
  }
  if (body?.model === 'success-with-code') return json({ code: '000000', output_text: '成功生成，错误码说明只是正文。' });
  if (path.pathname.endsWith(':generateContent')) {
    return json({ candidates: [{ content: { parts: [{ text: clientNotice }] } }] });
  }
  if (path.pathname.endsWith('/responses') && !body.stream) {
    return json({ output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: '同步正常' }] }] });
  }
  if (body?.model === 'missing') return json({ error: { message: 'Model unavailable' } }, 404);

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.flushHeaders();
  const send = data => res.write(`data: ${JSON.stringify(data)}\r\n\r\n`);
  if (body?.model === 'empty-output') {
    send({ type: 'response.completed' });
    return res.end();
  }
  if (body?.model === 'bad-event') {
    send(null);
    return res.end();
  }
  if (body?.model === 'stream-error') {
    send({ type: 'response.output_text.delta', delta: '已收到的部分' });
    send({ type: 'response.failed', response: { error: { code: 'upstream_error', message: `上游出问题了喵 ${key}` } } });
    return res.end();
  }
  if (['policy-output', 'policy-without-end', 'quoted-policy'].includes(body?.model)) {
    const value = body.model === 'quoted-policy' ? `这段提示的含义是“${clientNotice}”。余额不足是另一类问题。` : clientNotice;
    send({ type: 'response.output_text.delta', delta: value.slice(0, 10) });
    send({ type: 'response.output_text.delta', delta: value.slice(10) });
    if (body.model !== 'policy-without-end') send({ type: 'response.completed' });
    return res.end();
  }
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
  for (const name of ['hero-art.jpg', 'page-background.jpg']) {
    const asset = await fetch(`${local}/${name}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/jpeg');
  }
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
  assert.equal(truncated.at(-1).diagnosis.category, 'stream_interrupted');
  const redirect = await (await request('models', { baseUrl: `${upstream}/redirect` })).json();
  assert.equal(redirect.status, 302);
  assert.equal(requests.at(-1).path, '/redirect/v1/models');
});

test('diagnoses relay failures from error codes, messages, and HTTP fallbacks', async t => {
  for (const [name, scenario] of Object.entries(failures)) {
    await t.test(name, async () => {
      const events = await probe({ model: `diagnostic-${name}` });
      const end = events.at(-1);
      assert.equal(end.type, 'error');
      assert.equal(end.status, scenario.status);
      assert.equal(end.diagnosis.category, scenario.category);
      assert.ok(end.diagnosis.summary && end.diagnosis.suggestion);
      assert.ok(Number.isFinite(end.headersMs) && end.durationMs >= end.headersMs);
      assert.ok(!JSON.stringify(events).includes(key));
    });
  }
});

test('preserves raw evidence, distinct codes, and model discovery diagnostics', async () => {
  const group = (await probe({ model: 'diagnostic-group' })).at(-1).diagnosis;
  assert.equal(group.code, 'no_available_channel');
  assert.match(group.rawResponse, /当前分组模型不存在/);
  assert.equal(group.source, 'code');
  const custom = (await probe({ model: 'diagnostic-unknown-code' })).at(-1).diagnosis;
  assert.equal(custom.code, 'CUSTOM_777');
  assert.match(custom.rawResponse, /••••/);
  assert.equal(custom.source, 'http');
  const response = await request('models', { baseUrl: `${upstream}/diagnostic` });
  assert.equal(response.status, 502);
  const discovery = await response.json();
  assert.equal(discovery.status, 403);
  assert.equal(discovery.diagnosis.category, 'client_restricted');
  assert.equal(discovery.diagnosis.tone, 'warning');
  assert.match(discovery.diagnosis.summary, /无法验证模型可用性/);
});

test('detects client-policy output across chunks without flagging explanations or losing partial text', async () => {
  const restricted = await probe({ model: 'policy-output' });
  assert.equal(text(restricted), clientNotice);
  assert.equal(restricted.at(-1).type, 'error');
  assert.equal(restricted.at(-1).status, 200);
  assert.equal(restricted.at(-1).diagnosis.category, 'client_restricted');
  const missingEnd = await probe({ model: 'policy-without-end' });
  assert.equal(missingEnd.at(-1).diagnosis.category, 'client_restricted');
  const explanation = await probe({ model: 'quoted-policy' });
  assert.equal(explanation.at(-1).type, 'done');
  assert.match(text(explanation), /余额不足/);
  const failed = await probe({ model: 'stream-error' });
  assert.equal(text(failed), '已收到的部分');
  assert.equal(failed.at(-1).diagnosis.category, 'upstream_error');
  assert.equal(failed.at(-1).status, 200);
  assert.ok(failed.at(-1).firstTextMs >= 0);
  assert.ok(!JSON.stringify(failed).includes(key));
});

test('diagnoses regular client-policy output for every supported protocol', async () => {
  for (const protocol of ['responses', 'chat', 'claude', 'gemini']) {
    const events = await probe({ protocol, baseUrl: upstream, model: 'sync-policy', stream: false });
    assert.equal(text(events), clientNotice);
    assert.equal(events.at(-1).diagnosis.category, 'client_restricted');
    assert.equal(events.at(-1).firstTextMs, null);
  }
  const customSuccess = await probe({ model: 'success-with-code', stream: false });
  assert.equal(customSuccess.at(-1).type, 'done');
  assert.match(text(customSuccess), /成功生成/);
});

test('distinguishes empty output, malformed events, network failure and timeout', async () => {
  assert.equal((await probe({ model: 'empty-output' })).at(-1).diagnosis.category, 'empty_response');
  assert.equal((await probe({ model: 'bad-event' })).at(-1).diagnosis.category, 'invalid_response');
  const settings = connection({ protocol: 'responses', baseUrl: upstream, apiKey: key });
  const network = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  const diagnosis = errorDiagnosis(network, settings, new AbortController().signal);
  assert.equal(diagnosis.category, 'connection_error');
  assert.equal(diagnosis.networkCode, 'ECONNREFUSED');
  const timeout = AbortSignal.abort(new DOMException('timeout', 'TimeoutError'));
  assert.equal(errorDiagnosis(new RelayError('请求超时'), settings, timeout).category, 'timeout');
});
