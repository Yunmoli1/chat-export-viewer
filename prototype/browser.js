// 找一台 Chromium 内核浏览器来跑 CDP 验证：优先 CV_BROWSER，其次 Edge / Chrome 的常见安装位置
const fs = require('fs');
function has(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }

const WIN = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
];
const NIX = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];

function findBrowser() {
  const env = process.env.CV_BROWSER;
  if (has(env)) return env;
  const list = process.platform === 'win32' ? WIN : NIX;
  for (let i = 0; i < list.length; i++) if (has(list[i])) return list[i];
  throw new Error('没有找到 Chromium 内核浏览器。装一个 Edge/Chrome，或设置环境变量 CV_BROWSER 指向可执行文件。');
}
module.exports = { findBrowser };
