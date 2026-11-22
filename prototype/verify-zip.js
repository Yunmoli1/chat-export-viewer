// 压缩包直读：自动挑条目、多分片合并、挑不出来时列条目、加密包不崩
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('./harness');
const { buildZip, enc } = require('./zipmake');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-zip-'));
const p = (n) => path.join(dir, n);

function conv(title, pairs) {
  const mapping = {};
  let prev = 'root';
  pairs.forEach((pr, i) => {
    const id = 'n' + i;
    mapping[id] = {
      id,
      parent: prev,
      children: i + 1 < pairs.length ? ['n' + (i + 1)] : [],
      message: {
        id, author: { role: pr[0], name: null, metadata: {} },
        create_time: 1736209400 + i, content: { content_type: 'text', parts: [pr[1]] },
        status: 'finished_successfully', end_turn: true, metadata: {}, recipient: 'all'
      }
    };
    prev = id;
  });
  return { title, create_time: 1736209400, current_node: prev, mapping };
}

const one = conv('压缩包测试', [['user', '这条来自 zip 里的 conversations.json'], ['assistant', '收到，压缩包能直接读了']]);
const shard0 = [conv('分片 A', [['user', '一号分片里的第一句'], ['assistant', '一号分片回复']])];
const shard1 = [conv('分片 B', [['user', '二号分片里的第一句'], ['assistant', '二号分片回复']])];

fs.writeFileSync(p('chatgpt.zip'), buildZip([
  { name: 'readme.txt', data: enc('exported by someone'), method: 8 },
  { name: 'conversations.json', data: enc(JSON.stringify([one])), method: 8 },
  { name: 'images/a.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), method: 0 }
]));
fs.writeFileSync(p('shards.zip'), buildZip([
  { name: 'conversations-001.json', data: enc(JSON.stringify(shard1)), method: 8 },
  { name: 'conversations-000.json', data: enc(JSON.stringify(shard0)), method: 8 }
]));
fs.writeFileSync(p('media.zip'), buildZip([
  { name: 'photos/a.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), method: 0 },
  { name: 'audio/b.m4a', data: Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]), method: 8 }
]));
fs.writeFileSync(p('locked.zip'), buildZip([
  { name: 'conversations.json', data: enc(JSON.stringify([one])), method: 8, encrypted: true }
]));

const snap = `JSON.stringify({
  stats: document.querySelector('#stats').textContent,
  meta: [...document.querySelectorAll('#meta .meta-row')].map(r => r.textContent.trim()),
  note: (document.querySelector('#meta .meta-note') || {}).textContent || '',
  msgs: document.querySelectorAll('#preview .msg').length,
  text: document.querySelector('#preview').textContent.slice(0, 160),
  tabs: document.querySelectorAll('#preview .tab').length,
  modal: !document.getElementById('zipModal').hidden,
  rows: [...document.querySelectorAll('#zipList .zip-row')].map(r => r.querySelector('.zip-name').textContent),
  errs: window.__errs || []
})`;

async function loadFile(h, file) {
  const r = await h.send('Runtime.evaluate', { expression: "document.getElementById('file')", returnByValue: false });
  await h.send('DOM.setFileInputFiles', { files: [file], objectId: r.result.objectId });
}

async function waitFor(h, expr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 5000)) {
    if (await h.ev(expr)) return true;
    await sleep(120);
  }
  return false;
}

(async () => {
  const h = await launch({ width: 1400, height: 900, port: 9330 });
  await h.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "window.__errs=[];addEventListener('error',function(e){window.__errs.push(String(e.message))});"
  });
  await h.send('Page.navigate', { url: h.BASE + 'index.html?blank=1' });
  await sleep(900);

  // 1) 普通压缩包：自动挑 conversations.json
  await loadFile(h, p('chatgpt.zip'));
  const okA = await waitFor(h, "document.querySelector('#stats').textContent.includes('1 个会话')");
  const a = JSON.parse(await h.ev(snap));
  console.log('chatgpt.zip:', JSON.stringify({ okA, stats: a.stats, meta: a.meta, msgs: a.msgs, modal: a.modal }));
  if (!okA || a.msgs < 2) throw new Error('压缩包没有自动打开会话');
  if (!a.meta.some((m) => m.includes('conversations.json'))) throw new Error('来源没有显示内部文件名');
  if (a.modal) throw new Error('认出来了却还弹选择框');
  if (!a.text.includes('压缩包能直接读了')) throw new Error('正文没出来');

  // 2) 分片：conversations-000/001 按顺序合并
  await loadFile(h, p('shards.zip'));
  const okB = await waitFor(h, "document.querySelector('#stats').textContent.includes('2 个会话')");
  const b = JSON.parse(await h.ev(snap));
  console.log('shards.zip:', JSON.stringify({ okB, stats: b.stats, meta: b.meta, tabs: b.tabs }));
  if (!okB) throw new Error('分片没有合并成 2 个会话');
  if (b.tabs !== 2) throw new Error('分片合并后 tab 数不对: ' + b.tabs);
  if (!b.meta.some((m) => m.includes('conversations-000.json + conversations-001.json'))) throw new Error('来源没有列出两个分片');

  // 3) 全是图片/音频：不硬猜，弹条目列表
  await loadFile(h, p('media.zip'));
  const okC = await waitFor(h, "!document.getElementById('zipModal').hidden");
  const c = JSON.parse(await h.ev(snap));
  console.log('media.zip:', JSON.stringify({ okC, modal: c.modal, rows: c.rows, note: c.note }));
  if (!okC) throw new Error('没认出来时没有弹出条目列表');
  if (c.rows.length !== 2) throw new Error('条目列表数量不对: ' + c.rows.length);

  // 点第一个条目（去掉「只看像聊天的」过滤后应有图片）
  await h.ev("document.getElementById('zipOnlyChat').checked=false; document.getElementById('zipOnlyChat').onchange();");
  await sleep(200);
  await h.ev("document.querySelector('#zipList .zip-row').click()");
  await sleep(800);
  const c2 = JSON.parse(await h.ev(snap));
  console.log('media.zip 选条目后:', JSON.stringify({ modal: c2.modal, note: c2.note, meta: c2.meta }));
  if (c2.modal) throw new Error('选了条目弹层没关');
  if (!c2.note.includes('二进制')) throw new Error('点图片没有给出二进制提示: ' + c2.note);

  // 4) 加密包：不崩，回到条目列表
  await loadFile(h, p('locked.zip'));
  const okD = await waitFor(h, "!document.getElementById('zipModal').hidden");
  const d = JSON.parse(await h.ev(snap));
  console.log('locked.zip:', JSON.stringify({ okD, modal: d.modal, note: d.note, rows: d.rows, errs: d.errs }));
  if (!okD) throw new Error('加密包没有回到条目列表');
  if (!/加密|密码/.test(d.note)) throw new Error('加密包没有说明原因: ' + d.note);
  if (d.errs.length) throw new Error('页面报错: ' + d.errs.join(' | '));

  await h.shot('shot-zip.png');

  // 5) 手机 412×915：条目列表不溢出、能滚、能被点
  const m = await launch({ width: 412, height: 915, mobile: true, scale: 2, port: 9331 });
  await m.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "window.__errs=[];addEventListener('error',function(e){window.__errs.push(String(e.message))});"
  });
  await m.send('Page.navigate', { url: m.BASE + 'index.html?blank=1' });
  await sleep(900);
  await loadFile(m, p('media.zip'));
  const okE = await waitFor(m, "!document.getElementById('zipModal').hidden");
  const e = JSON.parse(await m.ev(`JSON.stringify((() => { const r = document.querySelector('#zipModal .modal-card').getBoundingClientRect(); return {
    x: r.x, w: r.width, right: r.right, h: r.height, vw: innerWidth, vh: innerHeight,
    scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    rows: document.querySelectorAll('#zipList .zip-row').length, errs: window.__errs || [] }; })())`));
  console.log('手机 media.zip:', JSON.stringify(e));
  if (!okE) throw new Error('手机上没弹出条目列表');
  if (e.rows !== 2) throw new Error('手机条目数不对: ' + e.rows);
  if (e.x < 0 || e.right > e.vw + 1) throw new Error('手机弹层横向溢出: ' + JSON.stringify({ x: e.x, right: e.right, vw: e.vw }));
  if (e.scrollW > e.innerW + 1) throw new Error('手机上有横向溢出: ' + e.scrollW + ' > ' + e.innerW);
  if (e.errs.length) throw new Error('手机页面报错: ' + e.errs.join(' | '));
  await m.shot('shot-zip-mobile.png');
  m.close();

  h.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nZIP 浏览器端验证通过');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });