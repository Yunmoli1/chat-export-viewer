// 窄屏（412×915）布局：不横向溢出、单列、文件浮层贴边、截图
const { launch } = require('./harness');

(async () => {
  const h = await launch({ width: 412, height: 915, scale: 2, mobile: true });
  const { send, ev, sleep, BASE } = h;

  await send('Page.navigate', { url: BASE + 'index.html?sample=stdiv' });
  await sleep(1200);
  console.log('mobile layout:', await ev("JSON.stringify({docW:document.documentElement.scrollWidth, vw:innerWidth, headerH:Math.round(document.querySelector('header').getBoundingClientRect().height), cols:getComputedStyle(document.querySelector('main')).gridTemplateColumns, msgW:Math.round(document.querySelector('#preview .msg').getBoundingClientRect().width), previewW:Math.round(document.querySelector('#preview').getBoundingClientRect().width)})"));

  await ev("document.getElementById('btn-files').click()");
  await sleep(300);
  console.log('pop:', await ev("JSON.stringify((()=>{const r=document.querySelector('#filesPop').getBoundingClientRect();return {x:Math.round(r.x),w:Math.round(r.width),right:Math.round(r.right),h:Math.round(r.height),vw:innerWidth}})())"));
  await h.shot('shot-mobile-files.png');

  await ev("document.getElementById('btn-files').click()");
  await sleep(200);
  const r2 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  require('fs').writeFileSync(__dirname + '/shot-mobile-full.png', Buffer.from(r2.data, 'base64'));

  console.log('errors:', await ev('JSON.stringify(window.__errs||[])').catch(() => '[]'));
  h.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });