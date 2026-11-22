// 在页面里跑的一段冒烟脚本：点遍示例和候选、切一遍模式，量三栏宽度、横向溢出、错误
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errs = [];
  window.addEventListener('error', (e) => errs.push('error: ' + (e.message || '')));
  window.addEventListener('unhandledrejection', (e) => errs.push('reject: ' + (e.reason && e.reason.message)));

  const cols = [...document.querySelectorAll('main > *')].map((c) => Math.round(c.getBoundingClientRect().width));
  const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const chips = document.querySelectorAll('.chip').length;
  const cands = document.querySelectorAll('.cand').length;

  document.querySelectorAll('.chip').forEach((c) => c.click());
  await sleep(300);
  document.querySelectorAll('.cand').forEach((c) => c.click());
  await sleep(300);
  document.querySelector('#modeAuto').click();
  document.querySelector('#modeManual').click();
  await sleep(300);

  return {
    errs,
    cols,
    overflowX,
    chips,
    cands,
    msgs: document.querySelectorAll('#preview .msg').length,
    blocks: document.querySelectorAll('#preview .blk').length,
    manualFormFields: document.querySelectorAll('#form select, #form input').length
  };
})()