// 最近文件：切换样本、重开页面后自动读回 —— 不依赖真实文件系统，走内置样本
const { launch } = require('./harness');

(async () => {
  const h = await launch({ width: 1600, height: 1000 });
  const { send, ev, sleep, BASE } = h;
  const snap = () => ev("JSON.stringify({stats:document.querySelector('#stats').textContent, meta:[...document.querySelectorAll('#meta .meta-row')].map(r=>r.textContent.trim()), rows:[...document.querySelectorAll('#filesPop .file-row')].map(r=>r.querySelector('.f-name').textContent), n:document.querySelector('#filesN').textContent})");

  await send('Page.navigate', { url: BASE + 'index.html?sample=stdiv' });
  await sleep(1000);
  await ev("document.getElementById('btn-files').click()");
  await sleep(300);
  console.log('after stdiv:', await snap());

  // 通过「文件」弹层里的示例切换到中文样本
  await ev("(()=>{const c=[...document.querySelectorAll('#filesPop .sample-row .chip')].find(x=>x.textContent.includes('中文')); c.click(); return 1})()");
  await sleep(900);
  await ev("document.getElementById('btn-files').click()");
  await sleep(300);
  console.log('after switch:', await snap());

  // 重开页面：应自动回到上次的样本
  await send('Page.navigate', { url: BASE + 'index.html' });
  await sleep(1400);
  console.log('after reload:', await snap());
  h.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });