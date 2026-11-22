// 共用的小型 CDP 测试脚手架：自己拉起 headless Edge/Chrome，连上去，提供 send / ev / shot
// 这样每个 verify-*.js 都能单独跑，不依赖事先开好的调试端口。
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { findBrowser } = require('./browser');

const BASE = 'file:///' + __dirname.replace(/\\/g, '/') + '/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort(from) {
  for (let port = from; port < from + 200; port++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      s.listen(port, '127.0.0.1');
    });
    if (ok) return port;
  }
  throw new Error('找不到可用端口');
}

async function launch(opts) {
  const o = Object.assign({ width: 1600, height: 1000, mobile: false, scale: 1 }, opts || {});
  const port = await freePort(o.port || 9300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  const child = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=' + port, '--user-data-dir=' + prof, 'about:blank'
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      if (list && list.length) break;
    } catch (e) { /* 浏览器还没起来 */ }
    await sleep(250);
  }
  if (!list || !list.length) { try { child.kill(); } catch (e) {} throw new Error('浏览器没起来（端口 ' + port + '）'); }

  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket 连接失败')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(method + ' ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', {
    width: o.width, height: o.height, deviceScaleFactor: o.scale, mobile: o.mobile
  });

  const close = () => {
    try { ws.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  };

  return { send, ev, shot, sleep, close, BASE, port };
}

module.exports = { launch, BASE, sleep };
