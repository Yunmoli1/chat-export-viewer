// 全文搜索：跨会话命中、点结果跳转并高亮、回车下一条、空结果、Ctrl+F / Esc
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('./harness');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-search-'));
const file = path.join(dir, 'conversations.json');

function conv(title, pairs) {
  const mapping = {};
  let prev = 'root';
  pairs.forEach((pr, i) => {
    const id = 'n' + i;
    mapping[id] = {
      id, parent: prev, children: i + 1 < pairs.length ? ['n' + (i + 1)] : [],
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

const data = [
  conv('早餐', [['user', '今天早饭吃了关东煮'], ['assistant', '关东煮不错，下回再来一份']]),
  conv('午饭', [['user', '中午吃面'], ['assistant', '面也挺好']]),
  conv('夜宵', [['user', '夜宵也吃了关东煮'], ['assistant', '夜宵少吃点']])
];
fs.writeFileSync(file, JSON.stringify(data));

const snap = `JSON.stringify({
  stats: document.querySelector('#stats').textContent,
  info: document.querySelector('#qInfo').textContent,
  hitsHidden: document.querySelector('#qHits').hidden,
  hits: [...document.querySelectorAll('#qHits .q-hit')].map(h => h.textContent.trim()),
  tab: (document.querySelector('#preview .tab.on') || {}).textContent || '',
  marks: document.querySelectorAll('#preview mark.q-mark').length,
  flash: document.querySelectorAll('#preview .q-flash').length,
  q: document.querySelector('#q').value,
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  errs: window.__errs || []
})`;

async function type(h, text) {
  await h.ev('(() => { const q = document.getElementById("q"); q.value = ' + JSON.stringify(text) + '; q.dispatchEvent(new Event("input", { bubbles: true })); })()');
  await sleep(420);
}

async function loadFile(h, f) {
  const r = await h.send('Runtime.evaluate', { expression: 'document.getElementById("file")', returnByValue: false });
  await h.send('DOM.setFileInputFiles', { files: [f], objectId: r.result.objectId });
  await sleep(900);
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
  const h = await launch({ width: 1400, height: 900, port: 9332 });
  await h.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "window.__errs=[];addEventListener('error',function(e){window.__errs.push(String(e.message))});"
  });
  await h.send('Page.navigate', { url: h.BASE + 'index.html?blank=1' });
  await sleep(800);
  await loadFile(h, file);
  if (!(await waitFor(h, "document.querySelector('#stats').textContent.includes('3 个会话')"))) {
    console.log('load:', await h.ev(snap));
    throw new Error('文件没打开');
  }

  // 1) 跨会话命中：两个会话各一条
  await type(h, '关东煮');
  const a = JSON.parse(await h.ev(snap));
  console.log('搜索 关东煮:', JSON.stringify({ info: a.info, hits: a.hits }));
  if (a.info !== '3 条') throw new Error('命中数不对: ' + a.info);
  if (a.hits.length !== 3) throw new Error('结果条数不对: ' + a.hits.length);
  if (!a.hits[0].includes('早餐')) throw new Error('结果没有标出会话名: ' + a.hits[0]);
  if (a.hitsHidden) throw new Error('有结果时列表却藏起来了');

  // 2) 点第二条：切到「夜宵」并高亮
  await h.ev("document.querySelectorAll('#qHits .q-hit')[2].click()");
  await sleep(300);
  const b = JSON.parse(await h.ev(snap));
  console.log('点第二条:', JSON.stringify({ tab: b.tab, marks: b.marks, flash: b.flash }));
  if (!b.tab.includes('夜宵')) throw new Error('没有切到命中的会话: ' + b.tab);
  if (!b.marks) throw new Error('没有高亮命中词');
  if (!b.flash) throw new Error('没有闪一下定位');

  // 3) 回车：下一条（从第 2 条绕回第 1 条 → 早餐）
  await h.ev('document.getElementById("q").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
  await sleep(300);
  const c = JSON.parse(await h.ev(snap));
  console.log('回车下一条:', JSON.stringify({ tab: c.tab, marks: c.marks }));
  if (!c.tab.includes('早餐')) throw new Error('回车没有跳到下一条: ' + c.tab);

  // 4) 多词 AND
  await type(h, '关东煮 不错');
  const d = JSON.parse(await h.ev(snap));
  console.log('多词:', JSON.stringify({ info: d.info, hits: d.hits }));
  if (d.info !== '1 条') throw new Error('多词取交集不对: ' + d.info);

  // 5) 空结果
  await type(h, '绝对没有这个词');
  const e = JSON.parse(await h.ev(snap));
  if (e.info !== '没有命中') throw new Error('空结果提示不对: ' + e.info);
  if (!e.hitsHidden) throw new Error('空结果还显示着列表');

  // 6) Ctrl+F 聚焦、Esc 清空
  await h.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))');
  await sleep(120);
  const f = await h.ev('document.activeElement && document.activeElement.id');
  if (f !== 'q') throw new Error('Ctrl+F 没有聚焦搜索框: ' + f);
  await h.ev('document.getElementById("q").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await sleep(200);
  const g = JSON.parse(await h.ev(snap));
  if (g.q !== '' || g.info !== '') throw new Error('Esc 没有清空: ' + JSON.stringify({ q: g.q, info: g.info }));

  // 7) 手机上不横向溢出，结果列表在视口内
  const m = await launch({ width: 412, height: 915, mobile: true, scale: 2, port: 9333 });
  await m.send('Page.navigate', { url: m.BASE + 'index.html?blank=1' });
  await sleep(800);
  await loadFile(m, file);

  // 7a) 单列长页里预览在最下面：顶栏「搜索」要能滚过去并聚焦（否则手机上根本找不到搜索框）
  const btn = JSON.parse(await m.ev(`JSON.stringify((() => { const b = document.getElementById('btnSearch'); const r = b.getBoundingClientRect(); return { shown: !!b.offsetParent || r.width > 0, right: r.right, vw: innerWidth, y: window.scrollY }; })())`));
  if (!btn.shown) throw new Error('手机顶栏没有「搜索」按钮');
  if (btn.right > btn.vw + 1) throw new Error('「搜索」按钮溢出: ' + btn.right + ' > ' + btn.vw);
  await m.ev("document.getElementById('btnSearch').click()");
  await sleep(600);
  const jump = JSON.parse(await m.ev(`JSON.stringify({ focus: document.activeElement && document.activeElement.id,
    top: document.querySelector('.preview-panel').getBoundingClientRect().top,
    findTop: document.querySelector('.findbar').getBoundingClientRect().top,
    vh: innerHeight, y: window.scrollY })`));
  console.log('手机顶栏搜索:', JSON.stringify({ btn, jump }));
  if (jump.focus !== 'q') throw new Error('顶栏「搜索」没有聚焦搜索框: ' + jump.focus);
  if (jump.y < 1) throw new Error('顶栏「搜索」没有把页面滚下去: scrollY=' + jump.y);
  // 面板可能已在页尾、滚到顶就到底了；真正要保证的是搜索框落在视口里
  if (jump.findTop < -1 || jump.findTop > jump.vh - 80) throw new Error('搜索框不在视口内: findTop=' + jump.findTop + ' vh=' + jump.vh);

  await type(m, '关东煮');
  const h1 = JSON.parse(await m.ev(snap));
  const box = JSON.parse(await m.ev("JSON.stringify((() => { const r = document.querySelector('#qHits').getBoundingClientRect(); return { x: r.x, w: r.width, right: r.right }; })())"));
  console.log('手机:', JSON.stringify({ scrollW: h1.scrollW, innerW: h1.innerW, info: h1.info, box }));
  if (h1.scrollW > h1.innerW + 1) throw new Error('手机上有横向溢出: ' + h1.scrollW + ' > ' + h1.innerW);
  if (box.right > h1.innerW + 1) throw new Error('结果列表超出视口: ' + box.right);
  await m.shot('shot-search-mobile.png');
  m.close();

  const errs = JSON.parse(await h.ev('JSON.stringify(window.__errs)')).concat(h1.errs);
  if (errs.length) throw new Error('页面报错: ' + errs.join(' | '));

  await h.shot('shot-search.png');
  h.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n搜索验证通过');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });