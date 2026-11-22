const T = require('./textblocks.js');
const cases = {
  st_div: '<START>\n{{user}}: 晚上好\n{{char}}: <div class="status">时间：22:00 | 地点：公寓 | 心情：平静</div>\n晚上好，今天过得怎么样？\n<div class="thoughts">（其实他有点紧张）</div>\n{{user}}: 还行吧',
  cn_brackets: '【场景】雨夜的便利店\n小明：你来了\n【状态】体力 80 / 心情 低落\n小红：嗯，刚到\n【内心】（他会不会发现）',
  html_msgs: '<div class="mes" data-role="user"><div class="name">我</div><div class="text">你好</div></div>\n<div class="mes" data-role="assistant"><div class="name">AI</div><div class="text">你好，有什么可以帮你？<div class="status">模型：gpt-4o</div></div></div>',
  details_txt: '<details><summary>前情提要</summary>上一章他们去了海边。</details>\nA: 然后呢\nB: 然后下雨了',
  broken: '<div class="status">未闭合\nA: 你好\n</div></div>\n<p>普通段落'
};
for (const k in cases) {
  const r = T.parse(cases[k]);
  console.log('=== ' + k + ' -> ' + r.format + ' | msgs=' + r.stats.messages + ' blocks=' + r.stats.blocks + ' warn=' + JSON.stringify(r.scan));
  for (const it of r.flow) {
    if (it.kind === 'msg') console.log('  [msg ' + it.role + (it.name ? '/' + it.name : '') + '] ' + JSON.stringify(it.text.slice(0, 50)) + (it.blocks.length ? ' +blocks:' + it.blocks.map(b => b.cat).join(',') : ''));
    else console.log('  [block ' + it.cat + '] ' + JSON.stringify((it.text || '').slice(0, 50)) + (it.children.length ? ' kids=' + it.children.length : ''));
  }
}
