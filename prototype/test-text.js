const path = require('path');
const fs = require('fs');
const TB = require(path.join(__dirname, 'textblocks.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function blocksOf(msgs) {
  var out = [];
  msgs.forEach(function (m) { (m.blocks || []).forEach(function (b) { out.push(b); }); });
  return out;
}
function catsOf(msgs) { return blocksOf(msgs).map(function (b) { return b.cat; }); }

// ---------- 1. 酒馆 div 容器 ----------
const tavern = fs.readFileSync(path.join(__dirname, 'fixtures-text', 'tavern_div.txt'), 'utf8');
const r1 = TB.parse(tavern, {});
console.log('case tavern_div  containers=' + JSON.stringify(r1.containers) + ' stats=' + JSON.stringify(r1.stats));
ok('容器只有最外层 div.mes', JSON.stringify(r1.containers) === '["div.mes"]', JSON.stringify(r1.containers));
ok('4 条消息', r1.stats.messages === 4, r1.stats.messages);
ok('3 个块（details/stat/status）', r1.stats.blocks === 3, r1.stats.blocks);
const msgs1 = r1.flow.filter(function (m) { return m.kind === 'msg'; });
const ai1 = msgs1[1], ai2 = msgs1[3];
ok('AI 消息挂 2 个块', ai1.blocks.length === 2, ai1.blocks.map(function (b) { return b.cat; }).join(','));
ok('details 归为内心', ai1.blocks[0].cat === 'thought', ai1.blocks[0].cat);
ok('div.stat 归为状态栏', ai1.blocks[1].cat === 'status', ai1.blocks[1].cat);
ok('气泡内 parts 顺序 = text,block,block', ai1.parts.map(function (x) { return x.type; }).join(',') === 'text,block,block', ai1.parts.map(function (x) { return x.type; }).join(','));
ok('名字取 .name（保留 {{char}} 原文）', ai1.name === '{{char}}', ai1.name);
ok('data-role=user 判为 me', msgs1[0].role === 'me', msgs1[0].role);
ok('data-role=assistant 判为 ai', ai1.role === 'ai', ai1.role);
ok('第 4 条挂 status 块', ai2.blocks.length === 1 && ai2.blocks[0].cat === 'status', ai2.blocks.map(function (b) { return b.cat; }).join(','));
ok('消息正文不含状态栏文字', msgs1.every(function (m) { return !/好感|体力/.test(m.text); }));

// ---------- 2. 中文伪标签 + 行规则 ----------
const cn = fs.readFileSync(path.join(__dirname, 'fixtures-text', 'cn_tags_dialogue.txt'), 'utf8');
const r2 = TB.parse(cn, {});
const layout = r2.flow.map(function (x) { return x.kind === 'msg' ? ('msg:' + (x.name || x.role)) : ('blk:' + x.cat); }).join(' | ');
console.log('case cn_tags  stats=' + JSON.stringify(r2.stats) + '\n  layout: ' + layout);
ok('没有消息容器', r2.containers.length === 0, JSON.stringify(r2.containers));
ok('5 条消息', r2.stats.messages === 5, r2.stats.messages);
ok('5 个块（场景独立 + 4 个内联）', r2.stats.blocks === 5, r2.stats.blocks);
ok('场景块排在最前', r2.flow[0].kind === 'block' && r2.flow[0].cat === 'scene', r2.flow[0].kind + ':' + r2.flow[0].cat);
const msgs2 = r2.flow.filter(function (m) { return m.kind === 'msg'; });
ok('“我”判为 me', msgs2[1].role === 'me', msgs2.map(function (m) { return m.role; }).join(','));
ok('林夏/陆沉判为 person', msgs2[0].role === 'person' && msgs2[2].role === 'person', msgs2.map(function (m) { return m.role; }).join(','));
const cats2 = catsOf(msgs2);
console.log('  inline cats: ' + cats2.join(','));
ok('【状态】归为状态栏', cats2.indexOf('status') >= 0, cats2.join(','));
ok('【心理】归为内心', cats2.indexOf('thought') >= 0, cats2.join(','));
ok('【选项】归为选项', cats2.indexOf('choices') >= 0, cats2.join(','));
ok('（旁白）归为 OOC', cats2.indexOf('ooc') >= 0, cats2.join(','));
ok('状态块内容完整', /好感 32/.test(blocksOf(msgs2).filter(function (b) { return b.cat === 'status'; })[0].text));
ok('块不混进消息正文', msgs2.every(function (m) { return !/【|^（旁白）/.test(m.text); }));
ok('状态块跟在说“关东煮”的消息后面', msgs2[2].blocks.some(function (b) { return /好感 32/.test(b.text); }), msgs2.map(function (m) { return m.name; }).join(','));

// ---------- 3. 手动改类别 ----------
const statSig = ai1.blocks[1].sig;
const r3 = TB.parse(tavern, { blockCategories: { [statSig]: 'scene' } });
const ai1b = r3.flow.filter(function (m) { return m.kind === 'msg'; })[1];
ok('override 生效 ' + statSig + ' -> scene', ai1b.blocks[1].cat === 'scene', ai1b.blocks[1].cat);

// ---------- 4. 关闭容器 ----------
const r4 = TB.parse(tavern, { containerSigs: [] });
ok('containerSigs=[] 时不用容器', r4.containers.length === 0, JSON.stringify(r4.containers));

// ---------- 5. details 的 summary ----------
const det = '<details><summary>前情提要</summary><div>他们认识十年了。</div></details>';
const r5 = TB.parse(det, {});
const b5 = r5.flow[0];
ok('details 成 1 个块', r5.flow.length === 1 && b5.kind === 'block', r5.flow.map(function (x) { return x.kind; }).join(','));
ok('summary 没被当成子块', (b5.children || []).length === 0, JSON.stringify((b5.children || []).map(function (c) { return c.tag; })));
ok('summary 文本参与分类/展示', /前情提要/.test(b5.text || '') || /前情提要/.test(b5.summaryText || ''), (b5.text || '').slice(0, 30));

// ---------- 6. 畸形标签 ----------
const broken = '<div class="mes"><div class="mes_text">甲</div></div></span><div class="mes"><div class="mes_text">乙</div>';
const r6 = TB.parse(broken, {});
ok('多余闭合被记录', r6.scan.strayCloses >= 1, r6.scan.strayCloses);
ok('未闭合被记录', r6.scan.unclosed >= 1, r6.scan.unclosed);
ok('仍解析出 2 条消息', r6.stats.messages === 2, r6.stats.messages);

// ---------- 7. 纯文本 --------
const r7 = TB.parse('就是一段没有标签的普通文字。\n第二行。', {});
ok('纯文本产出 1 条消息 0 块', r7.stats.messages === 1 && r7.stats.blocks === 0, JSON.stringify(r7.stats));

// ---------- 8. standalone ----------
const r8 = TB.parse(cn, { attach: 'standalone' });
const standaloneBlocks = r8.flow.filter(function (x) { return x.kind === 'block'; });
ok('standalone 下块全部独立成项', standaloneBlocks.length === r8.stats.blocks, standaloneBlocks.length + '/' + r8.stats.blocks);
ok('standalone 下消息不带块', r8.flow.filter(function (x) { return x.kind === 'msg'; }).every(function (m) { return !(m.blocks || []).length; }));

// ---------- 9. style/script 跳过 ----------
const withCss = '<style>.mes{color:red}</style><div class="mes"><div class="mes_name">甲</div><div class="mes_text">正文一</div></div>' +
  '<script>var x = "<div class=\'mes\'>假的</div>";</script><div class="mes"><div class="mes_name">乙</div><div class="mes_text">正文二</div></div>';
const r9 = TB.parse(withCss, {});
ok('style/script 不产生消息', r9.stats.messages === 2, r9.stats.messages);
ok('正文里没有 CSS / JS 代码', r9.flow.filter(function (m) { return m.kind === 'msg'; }).every(function (m) { return !/color:red|var x/.test(m.text); }));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);