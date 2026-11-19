import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { connection, errorMessage, listModels, probe, probeInput } from './relay.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/hero-art.jpg', ['hero-art.jpg', 'image/jpeg']],
  ['/page-background.jpg', ['page-background.jpg', 'image/jpeg']],
]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readInput(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('请求内容过大。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求内容不是有效的 JSON。');
  }
}

export function createApp() {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      return json(res, 403, { message: '请通过 localhost 或 127.0.0.1 打开。' });
    }

    if (req.method === 'GET' && files.has(req.url)) {
      const [name, type] = files.get(req.url);
      try {
        const file = await readFile(new URL(`./public/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(file);
      } catch {
        return json(res, 404, { message: '文件不存在。' });
      }
    }
    if (req.method !== 'POST' || !['/api/models', '/api/probe'].includes(req.url)) {
      return json(res, 404, { message: '接口不存在。' });
    }
    if ((req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      return json(res, 403, { message: '请从本地网页发起请求。' });
    }
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      return json(res, 415, { message: '请求需要使用 application/json。' });
    }

    const controller = new AbortController();
    res.once('close', () => controller.abort());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    let input;
    let settings;
    let test;
    try {
      input = await readInput(req);
      settings = connection(input);
      if (req.url === '/api/probe') test = probeInput(input);
    } catch (error) {
      if (!res.destroyed) json(res, 400, { message: error.message });
      return;
    }

    if (req.url === '/api/models') {
      let status = null;
      try {
        const result = await listModels(settings, signal, value => { status = value; });
        if (!res.destroyed) json(res, 200, result);
      } catch (error) {
        if (!res.destroyed) json(res, 502, { status, message: errorMessage(error, settings, signal) });
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    res.flushHeaders();
    await probe(settings, test, signal, event => {
      if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    });
    if (!res.destroyed) res.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 3177);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('端口需要是 1–65535 的整数。');
    process.exitCode = 1;
  } else {
    const server = createApp();
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用。可以用 npm start -- 其他端口 启动。` : error.message);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`月见中继站 · http://127.0.0.1:${port}`));
  }
}
