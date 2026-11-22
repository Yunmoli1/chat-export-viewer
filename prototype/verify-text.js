// 文字/HTML 侧解析的端到端验证：酒馆 div 样本、中文伪标签、手动改类别、切回 JSON 不串味
const { launch } = require('./harness');

async function main() {
  const h = await launch({ width: 1600, height: 1000 });
  const { send, ev, shot, sleep, BASE } = h;
  const report = {};

  // ---- 1. 酒馆 div 样本（自动模式）----
  await send('Page.navigate', { url: BASE + 'index.html?sample=stdiv' });
  await sleep(900);
  report.stdiv = await ev(`(() => {
    const q = (s) => document.querySelector(s);
    const msgs = [...document.querySelectorAll('#preview .msg')];
    const blocks = [...document.querySelectorAll('#preview .blk')];
    const names = msgs.map(m => m.querySelector('.who').textContent);
    return {
      kind: q('#meta .meta-row:nth-child(3) .meta-v') && q('#meta .meta-row:nth-child(3) .meta-v').textContent,
      stats: q('#stats').textContent,
      msgs: msgs.length,
      blocks: blocks.length,
      blockCats: blocks.map(b => b.className.replace(/.*cat-/, '')),
      names,
      inlineInBubble: document.querySelectorAll('#preview .msg-body .blk').length,
      inventory: [...document.querySelectorAll('.inv-row')].map(r => (r.querySelector('.inv-sig') || {}).textContent + ' ' + (r.querySelector('.inv-count') || {}).textContent),
      tree: [...document.querySelectorAll('#tree .tree-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      errors: window.__errs || []
    };
  })()`);
  await shot('shot-text-tavern.png');

  // ---- 2. 中文标签样本 ----
  await send('Page.navigate', { url: BASE + 'index.html?sample=cntags' });
  await sleep(700);
  report.cntags = await ev(`(() => {
    const q = (s) => document.querySelector(s);
    const blocks = [...document.querySelectorAll('#preview .blk')];
    return {
      stats: q('#stats').textContent,
      msgs: document.querySelectorAll('#preview .msg').length,
      blocks: blocks.length,
      blockCats: blocks.map(b => b.className.replace(/.*cat-/, '')),
      flowKinds: [...document.querySelectorAll('#preview .msgs > *')].map(e => e.className.split(' ')[0]),
      firstBadge: (document.querySelector('#preview .blk-badge') || {}).textContent,
      tree: [...document.querySelectorAll('#tree .tree-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })()`);
  await shot('shot-text-cn.png');

  // ---- 3. 手动模式：改一个块的类别为「忽略」，块应消失 ----
  await send('Page.navigate', { url: BASE + 'index.html?sample=cntags&mode=manual' });
  await sleep(800);
  report.manualBefore = await ev(`(() => ({
    blocks: document.querySelectorAll('#preview .blk').length,
    selects: document.querySelectorAll('#candList select.inv-cat').length,
    formTitle: (document.querySelector('#form .panel-title') || {}).textContent,
    formFields: document.querySelectorAll('#form select').length
  }))()`);
  report.manualAfter = await ev(`(() => {
    const rows = [...document.querySelectorAll('#candList .inv-row')];
    const target = rows.find(r => /pseudo/.test((r.querySelector('.inv-sig') || {}).textContent || ''));
    if (!target) return { error: 'no pseudo row' };
    const sel = target.querySelector('select');
    sel.value = 'ui';
    sel.dispatchEvent(new Event('change'));
    return { applied: sel.value, blocksNow: document.querySelectorAll('#preview .blk').length };
  })()`);
  await sleep(300);
  report.manualAfter.blocksAfterRerender = await ev('document.querySelectorAll("#preview .blk").length');
  await shot('shot-text-manual.png');

  // ---- 4. 切回 JSON 样本，确认互相不污染 ----
  await send('Page.navigate', { url: BASE + 'index.html?sample=chatgpt' });
  await sleep(800);
  report.backToJson = await ev(`(() => ({
    kind: (document.querySelector('#meta .meta-row:nth-child(3) .meta-v') || {}).textContent,
    msgs: document.querySelectorAll('#preview .msg').length,
    blocks: document.querySelectorAll('#preview .blk').length,
    cands: document.querySelectorAll('#candList .cand').length
  }))()`);

  console.log(JSON.stringify(report, null, 1));
  h.close();
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });