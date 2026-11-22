// 仓库级约定检查（跟网页逻辑无关，所以不放进 npm test 的断言计数里）
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let bad = 0;
function ok(name, cond, hint) {
  if (cond) return console.log('  ok   ' + name);
  bad++;
  console.log('  FAIL ' + name + (hint ? ' —— ' + hint : ''));
}

// PowerShell 5 把无 BOM 的 UTF-8 当 ANSI 读，中文注释会把脚本解析崩（踩过两次）
const ps1 = fs.readFileSync(path.join(root, 'android', 'build-apk.ps1'));
ok('build-apk.ps1 是 UTF-8 带 BOM',
  ps1[0] === 0xef && ps1[1] === 0xbb && ps1[2] === 0xbf,
  '用记事本另存为 UTF-8 带 BOM，或写回 EF BB BF 三个字节');

// 零联网是卖点，也是能拿得出手的证据：清单里不许出现 INTERNET 权限
const manifest = fs.readFileSync(path.join(root, 'android', 'AndroidManifest.xml'), 'utf8');
ok('AndroidManifest 没有 INTERNET 权限', !/android\.permission\.INTERNET/.test(manifest));

// 用户内容一律走 textContent；innerHTML 只允许用来清空（赋值空串），
// 这样即使导出文件里带了 script 标签 / onerror 属性也进不了 DOM。
function scanHtmlWrites(src) {
  const out = [];
  const re = /\.innerHTML\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(re.lastIndex);
    if (/^(''|"")\s*;/.test(rest)) continue;   // 只允许清空
    out.push(src.slice(0, m.index).split('\n').length);
  }
  return out;
}
const jsFiles = ['app.js', 'textblocks.js', 'core.js', 'recents.js', 'scrubber.js', 'samples.js', 'zip.js'];
const htmlWrites = [];
for (const name of jsFiles) {
  const src = fs.readFileSync(path.join(root, 'prototype', name), 'utf8');
  scanHtmlWrites(src).forEach(function (line) { htmlWrites.push(name + ':' + line); });
}
ok('用户内容不进 innerHTML（只允许清空）', htmlWrites.length === 0, htmlWrites.join(', '));
// 守卫自检：抓得到注入，放过清空
ok('innerHTML 守卫自检',
  scanHtmlWrites('a.innerHTML = "<b>x</b>";').length === 1 &&
  scanHtmlWrites("a.innerHTML = '';").length === 0);

// 版本号三处要一起改，漏一个就会出现「装的 1.1、里面写着 1.0」
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const verName = (manifest.match(/android:versionName="([^"]+)"/) || [])[1];
const verCode = (manifest.match(/android:versionCode="(\d+)"/) || [])[1];
const buildPs1 = fs.readFileSync(path.join(root, 'android', 'build-apk.ps1'), 'utf8');
ok('package.json 与 AndroidManifest 版本一致',
  !!verName && pkg.version === verName,
  'package.json ' + pkg.version + ' / manifest ' + verName);
ok('build-apk.ps1 的 --version-name 与清单一致',
  buildPs1.includes("'--version-name','" + verName + "'"),
  '清单 ' + verName);
ok('build-apk.ps1 的 --version-code 与清单一致',
  buildPs1.includes("'--version-code','" + verCode + "'"),
  '清单 ' + verCode);

console.log(bad ? bad + ' 项不通过' : '仓库检查通过');
process.exit(bad ? 1 : 0);
