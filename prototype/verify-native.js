
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PORT = 9225;
const BASE = process.env.CV_BASE || 'file:///'+__dirname.replace(/\\/g,'/')+'/';
const prof = path.join(os.tmpdir(), 'cvnat' + Date.now());
const edge = require('./browser').findBrowser();
const args = ['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1600,1000',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, 'about:blank'];
const child = cp.spawn(edge, args, { stdio: 'ignore', detached: false });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); return await r.json(); }
    catch (e) { await sleep(300); }
  }
  throw new Error('devtools not ready');
}
(async () => {
  const list = await targets();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; p.set(i, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  await send('Page.enable', {}); await send('Runtime.enable', {});
  try { await send('Storage.clearDataForOrigin', { origin: 'file://', storageTypes: 'all' }); } catch (e) { console.log('(storage clear skipped: ' + e.message + ')'); }
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "window.__nativeCalls=[];window.Native={pickFile:function(r){window.__nativeCalls.push({op:'pick',req:r});},readUri:function(u,r){window.__nativeCalls.push({op:'readUri',uri:u,req:r});},version:function(){return '0.2-native';}};"
  });

  const b64 = Buffer.from('[2024-05-01 10:00] 我: 你好\n[2024-05-01 10:01] 林夏: 在的，刚看到\n[2024-05-01 10:02] 我: 那就好', 'utf8').toString('base64');
  const uri = 'content://com.android.providers.downloads.documents/document/42';
  const snap = () => ev("JSON.stringify({stats:document.querySelector('#stats').textContent,name:(document.querySelector('#meta .meta-row')||{}).textContent||'',rows:[...document.querySelectorAll('#filesPop .file-row .f-name')].map(n=>n.textContent),toast:document.querySelector('#toast').textContent,calls:window.__nativeCalls})");

  // 1) 冷启动（空白）→ 点“打开” → 应调用 Native.pickFile
  await send('Page.navigate', { url: BASE + 'index.html?blank=1' });
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.getElementById('btn-open')")) break;
    await sleep(250);
  }
  await sleep(300);
  await ev("document.getElementById('btn-open').click()"); await sleep(200);
  console.log('1 pick:', await ev("JSON.stringify(window.__nativeCalls)"));

  // 2) 原生回调：打开成功
  await ev("window.__nativeFile(" + JSON.stringify({ reqId: 'pick', ok: true, name: '手机导出.txt', size: Buffer.byteLength('[2024-05-01 10:00] 我: 你好\n[2024-05-01 10:01] 林夏: 在的，刚看到\n[2024-05-01 10:02] 我: 那就好', 'utf8'), uri: uri, base64: b64 }) + ")");
  await sleep(900);
  console.log('2 loaded:', await snap());

  // 3) 重载 → 自动用 uri 重开（Native.readUri）
  await send('Page.navigate', { url: BASE + 'index.html' }); await sleep(1500);
  console.log('3 reopen:', await ev("JSON.stringify(window.__nativeCalls)"));

  // 4) 重开失败 → 应回退到 IndexedDB 缓存并提示
  await ev("window.__nativeFile(" + JSON.stringify({ reqId: 'reopen', ok: false, uri: uri, error: '权限已失效，请重新选择文件' }) + ")");
  await sleep(1200);
  console.log('4 fallback:', await snap());
  console.log('   filesN:', await ev("document.getElementById('filesN').textContent"));

  // 4b) 分片协议：begin + N 个 chunk + end，拼起来必须与原文件一致
  const bigText = '【分片测试】' + '我: 一二三四五六七八九十\n'.repeat(4000);
  const bigBuf = Buffer.from(bigText, 'utf8');
  const b64big = bigBuf.toString('base64');
  const chunks = [];
  for (let i = 0; i < b64big.length; i += 65536) chunks.push(b64big.slice(i, i + 65536));
  const beginPayload = JSON.stringify({ reqId: 'pick', ok: true, name: '分片文件.txt', size: bigBuf.length, uri: 'content://chunk/1' });
  await ev('window.__nativeBegin(' + beginPayload + ')');
  for (const c of chunks) await ev('window.__nativeChunk(\'pick\',' + JSON.stringify(c) + ')');
  await ev("window.__nativeEnd('pick')");
  await sleep(1500);
  const metaRows = await ev("[...document.querySelectorAll('#meta .meta-row')].map(r=>r.textContent.trim())");
  console.log('4b chunked: name=' + metaRows[0] + ' size=' + metaRows[1] + ' chunks=' + chunks.length + ' stats=' + await ev("document.querySelector('#stats').textContent"));
  // 5) 取消选择 → 不应再弹一次
  const before = await ev("window.__nativeCalls.length");
  await ev("window.__nativeFile(" + JSON.stringify({ reqId: 'pick', ok: false, error: 'cancelled' }) + ")");
  await sleep(400);
  console.log('5 cancel: callsBefore=' + before + ' callsAfter=' + await ev("window.__nativeCalls.length") + ' toast=' + await ev("document.querySelector('#toast').textContent"));

  console.log('errors:', await ev("JSON.stringify(window.__errs||[])"));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(__dirname+'/shot-native-flow.png', Buffer.from(shot.data, 'base64'));
  ws.close(); child.kill();
  // 临时 profile 目录常被 Edge 占着删不掉，清理失败不算测试失败
  try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
