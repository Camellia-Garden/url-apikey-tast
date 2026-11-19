import { performance } from 'node:perf_hooks';

const protocols = {
  responses: { version: 'v1', endpoint: 'responses' },
  chat: { version: 'v1', endpoint: 'chat/completions' },
  claude: { version: 'v1', endpoint: 'messages' },
  gemini: { version: 'v1beta', endpoint: 'models' },
};

export class RelayError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

export function connection(input) {
  const { protocol, baseUrl, apiKey, auth = 'native' } = input ?? {};
  if (typeof protocol !== 'string' || !Object.hasOwn(protocols, protocol)) throw new RelayError('请选择接口协议。');
  if (typeof apiKey !== 'string' || !apiKey.trim() || !/^[\x21-\x7e]+$/.test(apiKey.trim())) {
    throw new RelayError('请输入有效的 API Key。');
  }
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new RelayError('请输入完整的 URL，例如 https://relay.example/v1。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.search && !(protocol === 'gemini' && url.search === '?alt=sse')) || url.hash) {
    throw new RelayError('URL 需要使用 HTTP(S)，并且不能含账号、密码、查询参数或锚点。');
  }
  url.search = '';

  const key = apiKey.trim();
  const headers = { Accept: 'application/json' };
  if (protocol === 'claude') headers['anthropic-version'] = '2023-06-01';
  if (auth !== 'bearer' && protocol === 'claude') headers['x-api-key'] = key;
  else if (auth !== 'bearer' && protocol === 'gemini') headers['x-goog-api-key'] = key;
  else headers.Authorization = `Bearer ${key}`;

  const { version, endpoint } = protocols[protocol];
  const addressPath = url.pathname.replace(/\/+$/, '');
  const path = addressPath.replace(/\/(?:chat\/completions|responses|messages|models(?:\/[^/]+:(?:streamGenerateContent|generateContent))?)$/, '');
  const explicit = path !== addressPath;
  const versioned = /\/v\d+(?:[a-z]+\d*)?(?:\/|$)/i.test(path);
  url.pathname = explicit || versioned ? path : `${path}/${version}`;
  return { key, headers, protocol, endpoint, root: url.href.replace(/\/+$/, '') };
}

const elapsed = start => Math.round(performance.now() - start);

function redact(value, key) {
  return value.replaceAll(key, '••••');
}

export function errorMessage(error, settings, signal) {
  if (signal.reason?.name === 'TimeoutError') return '请求超时（60 秒）。';
  if (error instanceof RelayError) return redact(error.message, settings.key);
  const code = error.cause?.code;
  return code ? `连接中转站失败（${code}）。` : '连接中转站失败或响应中断。';
}

async function jsonResponse(response, settings) {
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error.name !== 'SyntaxError') throw error;
  }
  if (!response.ok || data?.error) {
    throw new RelayError(upstreamError(data, response.status, settings), response.status);
  }
  if (!data || typeof data !== 'object') {
    throw new RelayError('中转站返回的内容不是有效的 API JSON。', response.status);
  }
  return data;
}

function upstreamError(data, status, settings) {
  const detail = data?.error?.message ?? data?.error ?? data?.message;
  if (typeof detail === 'string' && detail.trim()) return redact(detail, settings.key).slice(0, 1400);
  const messages = {
    401: '鉴权失败，请检查 API Key。',
    403: '访问被拒绝，请检查 Key 权限。',
    404: '找不到接口或模型，请检查 URL 和协议。',
    429: '请求被限流，或当前配额不足。',
  };
  if (status >= 300 && status < 400) return '中转站返回了重定向，请直接填写最终 API 地址。';
  return messages[status] ?? `中转站返回 HTTP ${status}。`;
}

export async function listModels(settings, signal, tick) {
  const start = performance.now();
  const { headers, protocol, root } = settings;
  const url = new URL(`${root}/models`);
  const models = new Map();
  let status;
  const cursors = new Set();
  while (true) {
    const response = await fetch(url, { headers, signal, redirect: 'manual' });
    status = response.status;
    tick(status);
    const data = await jsonResponse(response, settings);
    const entries = protocol === 'gemini' ? data.models : data.data;
    if (!Array.isArray(entries)) throw new RelayError('返回内容没有标准的模型列表。', status);
    for (const entry of entries) {
      const rawId = protocol === 'gemini' ? entry?.name : entry?.id;
      if (typeof rawId !== 'string' || !rawId.trim()) continue;
      const id = protocol === 'gemini' ? rawId.replace(/^models\//, '') : rawId;
      if (!id) continue;
      const methods = entry.supportedGenerationMethods;
      if (protocol === 'gemini' && Array.isArray(methods) && !methods.includes('generateContent')) continue;
      models.set(id, { id: redact(id, settings.key), name: redact(String(entry.display_name || entry.displayName || id), settings.key) });
    }
    const cursor = protocol === 'gemini' ? data.nextPageToken : protocol === 'claude' && data.has_more && data.last_id;
    if (typeof cursor !== 'string' || !cursor) break;
    if (cursors.has(cursor)) throw new RelayError('模型列表返回了重复的分页游标。', status);
    cursors.add(cursor);
    url.searchParams.set(protocol === 'gemini' ? 'pageToken' : 'after_id', cursor);
  }
  return { status, durationMs: elapsed(start), models: [...models.values()] };
}

export function probeInput(input) {
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!model || model.length > 512) throw new RelayError('请选择模型或输入模型 ID。');
  if (!prompt || prompt.length > 8000) throw new RelayError('请输入 1–8000 字符的测试提示词。');
  return { model, prompt, stream: input.stream !== false };
}

function buildRequest(settings, { model, prompt, stream }) {
  const { protocol, endpoint, root } = settings;
  const messages = [{ role: 'user', content: prompt }];
  const limit = 256;
  if (protocol === 'gemini') {
    const modelId = encodeURIComponent(model.replace(/^models\//, ''));
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return [`${root}/models/${modelId}:${method}`, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: limit },
    }];
  }

  const payloads = {
    responses: { input: prompt, max_output_tokens: limit },
    chat: { messages, max_completion_tokens: limit },
    claude: { messages, max_tokens: limit },
  };
  return [`${root}/${endpoint}`, { model, stream, ...payloads[protocol] }];
}

function geminiText(data) {
  return data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('');
}

function responsesText(data) {
  return data.output_text || data.output?.filter(item => item.type === 'message')
    .flatMap(item => item.content ?? []).filter(part => part.type === 'output_text')
    .map(part => part.text ?? '').join('');
}

function completeText(protocol, data) {
  if (protocol === 'responses') return responsesText(data);
  if (protocol === 'chat') return data.choices?.[0]?.message?.content;
  if (protocol === 'claude') return data.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
  return geminiText(data);
}

function streamPart(protocol, data) {
  if (protocol === 'responses') {
    if (data.type === 'response.output_text.delta') return { text: data.delta };
    if (['response.completed', 'response.incomplete'].includes(data.type)) {
      return { done: true, fallback: responsesText(data.response ?? {}) };
    }
  }
  if (protocol === 'chat') {
    const choice = data.choices?.[0];
    return { text: choice?.delta?.content, done: Boolean(choice?.finish_reason) };
  }
  if (protocol === 'claude') {
    if (data.type === 'content_block_start' && data.content_block?.type === 'text') return { text: data.content_block.text };
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') return { text: data.delta.text };
    return { done: data.type === 'message_stop' };
  }
  if (protocol === 'gemini') return { text: geminiText(data), done: Boolean(data.candidates?.[0]?.finishReason) };
  return {};
}

async function* serverEvents(body) {
  let buffer = '';
  let lines = [];
  let eventSize = 0;
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let match;
    while ((match = /\r\n|\n|\r(?!$)/.exec(buffer))) {
      const line = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (line.startsWith('data:')) {
        eventSize += line.length;
        if (eventSize > 2_000_000) throw new RelayError('流式事件过大。');
        lines.push(line.slice(5).replace(/^ /, ''));
      }
      if (line === '' && lines.length) {
        yield lines.join('\n');
        lines = [];
        eventSize = 0;
      }
    }
    if (buffer.length > 2_000_000) throw new RelayError('流式事件过大。');
  }
  if (buffer.replace(/\r$/, '') === '' && lines.length && buffer.endsWith('\r')) yield lines.join('\n');
}

export async function probe(settings, input, signal, emit) {
  const start = performance.now();
  let status = null;
  let headersMs = null;
  let firstTextMs = null;
  let charCount = 0;
  let streamed = false;
  let pending = '';
  const flush = (value = '') => {
    if (value) emit({ type: 'text', value: redact(value, settings.key), firstTextMs });
  };
  const output = value => {
    if (typeof value !== 'string' || !value) return;
    if (firstTextMs === null) firstTextMs = elapsed(start);
    charCount += value.length;
    pending += value;
    // Hold only a suffix that could become the key in a later chunk.
    const masked = redact(pending, settings.key);
    let retained = Math.min(masked.length, settings.key.length - 1);
    while (retained && !settings.key.startsWith(masked.slice(-retained))) retained--;
    flush(retained ? masked.slice(0, -retained) : masked);
    pending = retained ? masked.slice(-retained) : '';
  };

  try {
    const [url, payload] = buildRequest(settings, input);
    const response = await fetch(url, {
      method: 'POST', redirect: 'manual', signal,
      headers: { ...settings.headers, 'Content-Type': 'application/json', Accept: input.stream ? 'text/event-stream, application/json' : 'application/json' },
      body: JSON.stringify(payload),
    });
    status = response.status;
    headersMs = elapsed(start);
    streamed = response.ok && response.headers.get('content-type')?.includes('text/event-stream') === true;
    emit({ type: 'headers', status, headersMs, streamed });

    if (streamed) {
      let done = false;
      for await (const event of serverEvents(response.body)) {
        if (event.trim() === '[DONE]') {
          done = true;
          break;
        }
        let data;
        try {
          data = JSON.parse(event);
        } catch {
          throw new RelayError('中转站返回了无效的 SSE JSON。');
        }
        if (data.error || ['error', 'response.failed'].includes(data.type)) {
          throw new RelayError(upstreamError(data.response ?? data, status, settings));
        }
        const part = streamPart(settings.protocol, data);
        output(part.text);
        if (!charCount) output(part.fallback);
        if (part.done) {
          done = true;
          break;
        }
      }
      if (!done) throw new RelayError('流式响应提前中断，未收到结束事件。');
    } else {
      const data = await jsonResponse(response, settings);
      if (data.status === 'failed') throw new RelayError(upstreamError(data, status, settings));
      output(completeText(settings.protocol, data));
    }

    if (!charCount) throw new RelayError('中转站已响应，但模型没有返回可显示的文本。');
    flush(pending);
    emit({ type: 'done', status, headersMs, firstTextMs: streamed ? firstTextMs : null, durationMs: elapsed(start) });
  } catch (error) {
    flush(pending);
    emit({ type: 'error', status, headersMs, firstTextMs: streamed ? firstTextMs : null, durationMs: elapsed(start), message: errorMessage(error, settings, signal) });
  }
}
