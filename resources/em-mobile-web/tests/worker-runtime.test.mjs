// 真实无头 Chrome 验证（换证据类型）：App 运行时确实构造 module Worker（而非降级到主线程直连），
// 且 Worker 脚本在桌面端同款 CSP（无显式 worker-src，回退 script-src 'self'）下被真实加载。
// 默认不进常规 npm test（需本机有 Chrome + 已构建 dist），显式 EM_BROWSER_TEST=1 才跑。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const skip = !existsSync(CHROME) ? '本机无 Chrome'
  : !existsSync(path.join(dist, 'index.html')) ? '尚未 npm run build'
    : process.env.EM_BROWSER_TEST !== '1' ? '真实浏览器验证需 EM_BROWSER_TEST=1 显式启用'
      : false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

/** 起一个只托管 dist 的静态服务，并下发与 mobile-web-service.ts 同款 CSP。 */
function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = (req.url || '/').split('?')[0];
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      const file = path.resolve(dist, rel);
      if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404).end(); return; }
      const csp = [
        "default-src 'self'", "script-src 'self'", "style-src 'self'",
        "img-src 'self' data: blob:", "connect-src 'self' ws://127.0.0.1:47778",
        "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
      ].join('; ') + ';';
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': csp,
      }).end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitForDebugPort(port, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch { /* 未就绪 */ }
    await sleep(150);
  }
  throw new Error('Chrome DevTools 端口未就绪');
}

test('真实 Chrome：构造 module Worker 且 Worker 脚本在 CSP 下被加载（非降级）', { skip, timeout: 60_000 }, async () => {
  const { server, port } = await startStaticServer();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'em-chrome-'));
  const debugPort = 20_000 + Math.floor(Math.random() * 20_000);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    await waitForDebugPort(debugPort);
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = targets.find((item) => item.type === 'page');
    assert.ok(page, '应存在 page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    let id = 0;
    const pending = new Map();
    const requests = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const i = ++id; pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    // 在每份新文档最前面包装 Worker，记录构造是否成功（super 抛错 = 被 CSP 拦下 / 降级路径不会调用）。
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__workerLog = [];
      const __OrigWorker = window.Worker;
      window.Worker = class extends __OrigWorker {
        constructor(url, opts) {
          const entry = { url: String(url), type: opts && opts.type, phase: 'constructing' };
          window.__workerLog.push(entry);
          super(url, opts);
          entry.phase = 'ok';
        }
      };
    ` });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await sleep(700);

    // 预置一条合法配对凭证，让 App 走 createTransportClient → new Worker；否则停在扫码页不会建 Worker。
    const cred = {
      version: 1, pcId: 'pc-test', pcName: 'test-host', addresses: ['127.0.0.1'], port: 47778,
      deviceId: 'web-test', deviceName: 'Web', sharedSecret: Buffer.alloc(32, 7).toString('base64'),
    };
    const book = JSON.stringify({ version: 1, devices: [cred], activePcId: 'pc-test' });
    const writeExpr = `new Promise((resolve) => {
      const req = indexedDB.open('easymint-web-v1', 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(${JSON.stringify(book)}, 'easymint.pc-devices.v1');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    })`;
    const wrote = await send('Runtime.evaluate', { expression: writeExpr, awaitPromise: true, returnByValue: true });
    assert.equal(wrote.result?.result?.value, true, '应成功写入假凭证到 IndexedDB');

    requests.length = 0;
    await send('Page.reload');
    await sleep(2000); // leader 选举 350ms + 建连 + Worker 脚本加载

    const evaluated = await send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__workerLog || [])', returnByValue: true,
    });
    const log = JSON.parse(evaluated.result?.result?.value ?? '[]');
    assert.ok(log.some((e) => e.type === 'module' && e.phase === 'ok'),
      `App 应成功构造 type:module 的 Worker，实际：${JSON.stringify(log)}`);
    assert.ok(requests.some((url) => /worker-[A-Za-z0-9_-]+\.js/.test(url)),
      `Worker 脚本应被真实请求（CSP script-src 'self' 回退链合法），实际请求：${requests.join(', ')}`);
  } finally {
    try { ws?.close(); } catch { /* 忽略 */ }
    chrome.kill('SIGKILL');
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
