import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));

export function localPort(value = process.env.PORT ?? 3177) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口需要是 1–65535 的整数。');
  return port;
}

function pipeAddress(port) {
  const checkout = createHash('sha256').update(serverPath.toLowerCase()).digest('hex').slice(0, 24);
  return `\\\\.\\pipe\\tsukimi-relay-${checkout}-${port}`;
}

export function attachWindowsControl(server, port) {
  if (process.platform !== 'win32') return;
  const control = createServer(socket => {
    socket.on('error', () => socket.destroy());
    socket.setTimeout(1000, () => socket.destroy());
    socket.setEncoding('utf8');
    let command = '';
    socket.on('data', data => {
      command += data;
      if (command.length > 8) return socket.destroy();
      if (!command.endsWith('\n')) return;
      if (command === 'status\n') return socket.end('ready');
      if (command !== 'stop\n') return socket.end();
      socket.end('stopped');
      server.close();
      server.closeAllConnections();
    });
  });
  server.once('close', () => control.close());
  control.on('error', error => {
    console.error(`本地控制通道启动失败（${error.code}）。`);
    server.close();
    process.exitCode = 1;
  });
  control.listen(pipeAddress(port));
}

function send(port, command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipeAddress(port), () => socket.write(`${command}\n`));
    let reply = '';
    socket.setEncoding('utf8');
    socket.setTimeout(1000, () => socket.destroy(new Error('本地控制通道响应超时。')));
    socket.on('data', data => { reply += data; });
    socket.on('end', () => resolve(reply));
    socket.on('error', error => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) resolve('');
      else reject(error);
    });
  });
}

async function start(port) {
  if (await send(port, 'status') === 'ready') return;
  const child = spawn(process.execPath, [serverPath, String(port)], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  let failure;
  child.once('error', error => { failure = error; });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (failure) throw failure;
    if (await send(port, 'status') === 'ready') return;
    await delay(100);
  }
  throw new Error(`启动失败。请检查 ${port} 端口是否被其他程序占用。`);
}

async function openBrowser(url) {
  try {
    await new Promise((resolve, reject) => {
      const rundll32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe');
      const opener = spawn(rundll32, ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', windowsHide: true });
      opener.once('spawn', resolve);
      opener.once('error', reject);
      opener.unref();
    });
  } catch {
    console.log(`可在浏览器中手动打开 ${url}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, value] = process.argv.slice(2);
    const port = localPort(value);
    if (action === 'start') {
      await start(port);
      const url = `http://127.0.0.1:${port}/`;
      console.log(`月见中继站已就绪 · ${url}`);
      await openBrowser(url);
    } else if (action === 'stop') {
      const stopped = await send(port, 'stop') === 'stopped';
      console.log(stopped ? `月见中继站已停止（端口 ${port}）。` : `端口 ${port} 上没有当前项目的实例。`);
    } else {
      throw new Error('请使用 start.bat 或 stop.bat。');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
