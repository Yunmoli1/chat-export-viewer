// 三栏布局 / 候选卡片 / 气泡数量等 UI 冒烟：脚本体在 verify-page.js 里，注入页面执行
const fs = require('fs');
const path = require('path');
const { launch } = require('./harness');

async function main() {
  const h = await launch({ width: 1600, height: 1000 });
  await h.send('Page.navigate', { url: h.BASE + 'index.html?sample=chatgpt' });
  await h.sleep(1000);
  const expr = fs.readFileSync(path.join(__dirname, 'verify-page.js'), 'utf8');
  const result = await h.ev(expr);
  console.log(JSON.stringify(result, null, 1));
  h.close();
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });