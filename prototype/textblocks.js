/* textblocks.js —— 纯文本 / 半 HTML 聊天记录的「块」解析器
 * 目标：把 <div class="status">…</div>、【状态】…、<details>…</details> 这类
 * 辅助信息识别成可折叠的块，按原文顺序插回对话流。
 * 无 DOM 依赖（自带标签栈扫描），可被浏览器与 Node 共用。
 */
(function (root) {
  'use strict';

  // ---------- 语义词典 ----------
  var CATS = [
    { id: 'status', label: '状态栏', fold: true, words: ['status', 'state', 'stat', 'stats', 'panel', 'vitals', 'inventory', 'attribute', 'attrs', 'sheet', '状态', '属性', '面板', '数值', '当前', '背包'] },
    { id: 'thought', label: '内心', fold: true, words: ['thought', 'thoughts', 'think', 'thinking', 'reason', 'reasoning', 'inner', 'monologue', 'mind', 'psyche', 'subtext', 'analysis', '内心', '心声', '心理', '想法', '念头', '思考', '推理'] },
    { id: 'summary', label: '摘要', fold: true, words: ['summary', 'recap', 'previously', 'premise', '前情', '摘要', '总结', '回顾', '梗概'] },
    { id: 'system', label: '系统', fold: true, words: ['system', 'sys', 'note', 'notice', 'hint', 'rule', '系统', '规则', '提示', '说明'] },
    { id: 'ooc', label: 'OOC', fold: true, words: ['ooc', 'outofcharacter', 'meta', 'comment', '旁白', '吐槽', '场外'] },
    { id: 'choices', label: '选项', fold: true, words: ['choice', 'choices', 'option', 'options', 'action', '选项', '抉择', '行动'] },
    { id: 'scene', label: '场景', fold: true, words: ['scene', 'location', 'weather', 'time', 'env', 'setting', '场景', '地点', '时间', '天气', '环境'] },
    { id: 'ui', label: '装饰', fold: true, words: ['hr', 'br', 'sep', 'separator', 'spacer', 'icon', 'emoji', 'button', 'toolbar', 'divider'] },
    { id: 'dialogue', label: '对话', fold: false, words: ['mes', 'message', 'msg', 'bubble', 'chat', 'line', 'dialog', 'dialogue', 'speech', '对话', '发言', '气泡'] },
    { id: 'fold', label: '折叠块', fold: true, words: [] }
  ];
  var CAT_BY_ID = {};
  for (var ci = 0; ci < CATS.length; ci++) CAT_BY_ID[CATS[ci].id] = CATS[ci];

  var BLOCK_LEVEL = { div: 1, p: 1, br: 1, li: 1, tr: 1, section: 1, article: 1, blockquote: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, pre: 1, hr: 1, details: 1, summary: 1, ul: 1, ol: 1, table: 1, header: 1, footer: 1, main: 1, aside: 1, nav: 1, figure: 1, figcaption: 1 };
  var MARKERS = { start: 1, end: 1, begin: 1, chat_start: 1, chat_end: 1 };

  function attrOf(attrs, name) {
    var re = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    var m = re.exec(attrs || '');
    if (!m) return '';
    return (m[2] != null ? m[2] : m[3] != null ? m[3] : m[4]) || '';
  }

  function tagAttrs(attrs) {
    var cls = (attrOf(attrs, 'class') || '').trim().split(/\s+/).filter(Boolean).sort();
    return { cls: cls, id: attrOf(attrs, 'id'), role: attrOf(attrs, 'data-role') || attrOf(attrs, 'role'), raw: attrs || '' };
  }

  function sigOf(tag, meta) {
    return tag + (meta.cls.length ? '.' + meta.cls.join('.') : '') + (meta.id ? '#' + meta.id : '');
  }

  // ---------- 1. 标签栈扫描 ----------
  var RE_TAG = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

  function scan(text) {
    var tokens = [], strayCloses = [], unclosed = [], m, last = 0, pos = 0;
    RE_TAG.lastIndex = 0;
    while ((m = RE_TAG.exec(text)) !== null) {
      if (m.index > last) tokens.push({ kind: 'text', text: text.slice(last, m.index), start: last, end: m.index });
      if (m[0].slice(0, 4) === '<!--') { last = RE_TAG.lastIndex; continue; }
      if (m[1]) {
        tokens.push({ kind: 'close', tag: m[1].toLowerCase(), start: m.index, end: RE_TAG.lastIndex });
      } else {
        var tag = m[2].toLowerCase();
        // <style>/<script> 整段跳过：既不入树也不进正文
        if (tag === 'style' || tag === 'script') {
          var closeRe = new RegExp('</' + tag + '\\s*>', 'i');
          var cm = closeRe.exec(text.slice(RE_TAG.lastIndex));
          var skipTo = cm ? RE_TAG.lastIndex + cm.index + cm[0].length : text.length;
          last = skipTo; RE_TAG.lastIndex = skipTo;
          continue;
        }
        var meta = tagAttrs(m[3]);
        var selfClose = m[4] === '/' || tag === 'br' || tag === 'hr' || tag === 'img' || tag === 'input' || !!MARKERS[tag];
        tokens.push({ kind: selfClose ? 'empty' : 'open', tag: tag, attrs: meta, sig: sigOf(tag, meta), start: m.index, end: RE_TAG.lastIndex });
      }
      last = RE_TAG.lastIndex;
    }
    if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last), start: last, end: text.length });

    // 建树
    var rootNode = { tag: '#root', attrs: { cls: [], id: '', raw: '' }, sig: '#root', children: [], start: 0, end: text.length, parent: null, depth: 0 };
    var stack = [rootNode];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var top = stack[stack.length - 1];
      if (t.kind === 'text') { top.children.push({ kind: 'text', text: t.text, start: t.start, end: t.end }); continue; }
      if (t.kind === 'open') {
        var node = { kind: 'el', tag: t.tag, attrs: t.attrs, sig: t.sig, children: [], start: t.start, end: t.end, parent: top, depth: stack.length, contentStart: t.end };
        top.children.push(node);
        stack.push(node);
        continue;
      }
      if (t.kind === 'empty') {
        top.children.push({ kind: 'el', tag: t.tag, attrs: t.attrs, sig: t.sig, children: [], start: t.start, end: t.end, parent: top, depth: stack.length, empty: true, contentStart: t.end });
        continue;
      }
      // close
      var found = -1;
      for (var s = stack.length - 1; s >= 1; s--) if (stack[s].tag === t.tag) { found = s; break; }
      if (found < 0) { strayCloses.push({ tag: t.tag, start: t.start }); continue; }
      for (var k = stack.length - 1; k > found; k--) { unclosed.push({ tag: stack[k].tag, start: stack[k].start }); stack[k].end = t.start; }
      var el = stack[found];
      el.end = t.end;
      el.contentEnd = t.start;
      stack.length = found;
    }
    for (var r = stack.length - 1; r >= 1; r--) { unclosed.push({ tag: stack[r].tag, start: stack[r].start }); stack[r].end = text.length; stack[r].contentEnd = text.length; }
    return { tokens: tokens, root: rootNode, strayCloses: strayCloses, unclosed: unclosed };
  }

  // ---------- 2. 文本抽取 ----------
  var ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ldquo: '“', rdquo: '”', hellip: '…', mdash: '—' };
  function decodeEnt(s) {
    return String(s)
      .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, k) {
        if (k.charAt(0) === '#') {
          var code = k.charAt(1).toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
          try { return String.fromCodePoint(code); } catch (e) { return m; }
        }
        var v = ENT[k.toLowerCase()];
        return v === undefined ? m : v;
      });
  }

  function innerText(node, skipBlockNodes) {
    var out = [];
    (function walk(n) {
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c.kind === 'text') { out.push(c.text); continue; }
        if (skipBlockNodes && c !== node && skipBlockNodes[c.sig]) continue;
        if (BLOCK_LEVEL[c.tag]) out.push('\n');
        if (c.tag === 'br') { out.push('\n'); continue; }
        walk(c);
        if (BLOCK_LEVEL[c.tag]) out.push('\n');
      }
    })(node);
    return decodeEnt(out.join('')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- 3. 分类 ----------
  function classifySig(sig, meta) {
    var hay = (sig + ' ' + (meta && meta.raw ? meta.raw : '')).toLowerCase();
    var best = null, bestScore = 0;
    for (var i = 0; i < CATS.length; i++) {
      var c = CATS[i], score = 0;
      for (var w = 0; w < c.words.length; w++) if (hay.indexOf(c.words[w]) >= 0) score++;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best ? { cat: best.id, label: best.label, score: bestScore } : { cat: 'unknown', label: '未分类', score: 0 };
  }

  function allEls(root) {
    var out = [];
    (function walk(n) { for (var i = 0; i < n.children.length; i++) { var c = n.children[i]; if (c.kind === 'el') { out.push(c); walk(c); } } })(root);
    return out;
  }

  // ---------- 4. 容器（每条消息一个 div）识别 ----------
  function containerStats(root) {
    var els = allEls(root), stats = {};
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (MARKERS[e.tag]) continue;
      var text = innerText(e);
      if (!text) continue;
      var s = stats[e.sig] || (stats[e.sig] = { sig: e.sig, tag: e.tag, cls: e.attrs.cls, count: 0, chars: 0, withChildren: 0, samples: [] });
      s.count++; s.chars += text.length;
      if (e.children.some(function (c) { return c.kind === 'el'; })) s.withChildren++;
      if (s.samples.length < 3) s.samples.push(text.slice(0, 60));
    }
    var out = [];
    for (var k in stats) {
      var st = stats[k];
      st.avg = Math.round(st.chars / st.count);
      st.isContainer = st.count >= 2 && st.withChildren >= st.count * 0.6 && st.avg > 0 && st.avg < 4000 && (classifySig(st.sig, null).cat === 'dialogue' || st.withChildren === st.count);
      out.push(st);
    }
    return out;
  }

  var NAME_CLS = /(^|[-_])(name|speaker|author|who|nick|username|char|sender)([-_]|$)/i;
  var BODY_CLS = /(^|[-_])(text|content|body|message|mes[-_]?text|bubble|speech)([-_]|$)/i;
  var TIME_CLS = /(^|[-_])(time|date|timestamp|ts|clock|when)([-_]|$)/i;
  var HEADER_CLS = /(^|[-_])(header|head|meta|info|toolbar|footer|avatar|badge|time|date|timestamp)([-_]|$)/i;

  // 广度优先找第一个类名匹配的后代（限深度）
  function findDesc(el, re, maxDepth) {
    var level = [el], depth = 0;
    while (level.length && depth < (maxDepth || 3)) {
      var next = [];
      for (var i = 0; i < level.length; i++) {
        var kids = level[i].children;
        for (var j = 0; j < kids.length; j++) {
          var c = kids[j];
          if (c.kind !== 'el') continue;
          if (re.test((c.attrs.cls || []).join(' '))) return c;
          next.push(c);
        }
      }
      level = next; depth++;
    }
    return null;
  }

  function pickNameBody(msgEl, blockSigs) {
    var blocks = collectBlocks(msgEl, blockSigs, 0);
    var nameEl = findDesc(msgEl, NAME_CLS, 3);
    var bodyEl = findDesc(msgEl, BODY_CLS, 3);
    var timeEl = findDesc(msgEl, TIME_CLS, 3);
    var name = nameEl ? innerText(nameEl).trim() : '';
    var time = timeEl ? innerText(timeEl).trim() : '';
    var text = bodyEl ? textWithoutBlocks(bodyEl, blockSigs) : textWithoutBlocks(msgEl, blockSigs);
    if (!bodyEl) {
      [name, time].forEach(function (v) {
        if (!v) return;
        if (text.indexOf(v) === 0) text = text.slice(v.length).trim();
        else text = text.split(v).join('').trim();
      });
    }
    if (name || time) return { name: name, text: text.trim(), blocks: blocks, time: time };
    // 首个子节点短文本且无名字类时，视为名字
    var kids = msgEl.children;
    if (!name && kids.length > 1) {
      for (var j = 0; j < kids.length; j++) {
        var k = kids[j];
        if (k.kind !== 'el' || isBlockSig(k.sig, k.attrs, blockSigs)) continue;
        var t = innerText(k);
        if (t && t.length <= 24 && text.indexOf(t) === 0) { name = t; text = text.slice(t.length).trim(); }
        break;
      }
    }
    return { name: name.trim(), text: text.trim(), blocks: blocks, time: time };
  }

  function isBlockSig(sig, attrs, blockSigs) {
    if (blockSigs && blockSigs[sig]) return true;
    var cls = classifySig(sig, attrs);
    return cls.cat !== 'dialogue' && cls.cat !== 'unknown' && cls.score > 0;
  }

  function collectBlocks(el, blockSigs, depth) {
    var out = [];
    (function walk(n) {
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c.kind !== 'el') continue;
        if (c.tag === 'summary' && n.tag === 'details') continue;
        if (HEADER_CLS.test((c.attrs.cls || []).join(' '))) continue;
        if (isBlockSig(c.sig, c.attrs, blockSigs)) {
          var bcat = blockSigs[c.sig] || null;
          if (bcat === 'ui') continue;
          out.push(makeBlock(c, blockSigs, bcat, (depth || 0) + 1));
        }
        else walk(c);
      }
    })(el);
    return out;
  }

  function textWithoutBlocks(el, blockSigs, excludeTags) {
    var out = [];
    (function walk(n) {
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c.kind === 'text') { out.push(c.text); continue; }
        if (c.tag === 'br') { out.push('\n'); continue; }
        if (excludeTags && excludeTags[c.tag]) continue;
        if (isBlockSig(c.sig, c.attrs, blockSigs)) continue;
        if (BLOCK_LEVEL[c.tag]) out.push('\n');
        walk(c);
        if (BLOCK_LEVEL[c.tag]) out.push('\n');
      }
    })(el);
    return decodeEnt(out.join('')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function makeBlock(el, blockSigs, catOverride, depth, excludeTags) {
    var cls = classifySig(el.sig, el.attrs);
    var cat = catOverride || (CAT_BY_ID[cls.cat] ? cls.cat : 'unknown');
    var blockItems = collectBlocks(el, blockSigs, depth || 0);
    var text = textWithoutBlocks(el, blockSigs, excludeTags);
    return { kind: 'block', cat: cat, label: (CAT_BY_ID[cat] || { label: '未分类' }).label, tag: el.tag, sig: el.sig, text: text, children: blockItems, start: el.start, end: el.end, depth: depth || 0 };
  }

  function roleFromName(name) {
    var n = String(name || '').trim().toLowerCase();
    if (!n) return 'person';
    if (n === '我' || n === 'user' || n === 'you' || n === '{{user}}' || n === 'me' || n === '人类' || n === '玩家') return 'me';
    if (n === 'ai' || n === 'assistant' || n === 'bot' || n === '{{char}}' || n === 'char' || n === 'character' || n === 'gpt' || n === '模型' || n === '系统') return 'ai';
    return 'person';
  }

  function roleFromAttrs(el) {
    var r = (el.attrs.role || '').toLowerCase();
    var cls = (el.attrs.cls || []).join(' ').toLowerCase();
    if (/user|human|player|me\b/.test(r) || /(^|[-])user([-_]|$)|(^|[-])human([-_]|$)/.test(cls)) return 'me';
    if (/assistant|bot|char|narrat/.test(r) || /(^|[-])(assistant|ai|bot|char)([-_]|$)/.test(cls)) return 'ai';
    return '';
  }

  // ---------- 5. 行规则（含续行） ----------
  var CHAT_RULES = [
    { name: 'bracket-time', re: /^\[([^\]]{1,40})\]\s*([^:：]{1,40})[:：]\s?(.*)$/ },
    { name: 'name-colon', re: /^([^:：]{1,24})[:：]\s*(.+)$/ },
    { name: 'name-dash', re: /^([^\s:：]{1,24})\s*[—–-]{1,2}\s*(.+)$/ }
  ];

  // 【状态】 / [状态] / **状态** 一类伪标签行
  function pseudoTag(line) {
    var m = /^\s*(?:【([^】]{1,24})】|\[([^\]\n]{1,24})\]|（([^）]{1,16})）)\s*(.*)$/.exec(line);
    if (!m) return null;
    var name = (m[1] || m[2] || m[3] || '').trim();
    var cls = classifySig(name.toLowerCase(), null);
    if (cls.cat === 'dialogue' || cls.cat === 'unknown') return null;
    return { cat: cls.cat, label: cls.label, name: name, rest: m[4] || '' };
  }

  // ---------- 6. 主流程 ----------
  function parse(text, opts) {
    opts = opts || {};
    var src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var blockCatOverride = opts.blockCategories || {};   // sig -> cat
    var containerOverride = opts.containerSigs || null;  // array of sig
    var attach = opts.attach || 'inline';

    var sc = scan(src);
    var root = sc.root;

    // 记录自定义类别的 sig 也算块
    var blockSigs = {};
    for (var bs in blockCatOverride) if (blockCatOverride[bs]) blockSigs[bs] = blockCatOverride[bs];

    var stats = containerStats(root);
    var containerSet = {};
    if (containerOverride) {
      for (var oi = 0; oi < containerOverride.length; oi++) containerSet[containerOverride[oi]] = 1;
    } else {
      for (var si = 0; si < stats.length; si++) if (stats[si].isContainer && classifySig(stats[si].sig, null).cat === 'dialogue') containerSet[stats[si].sig] = 1;
      // 去掉被别的容器包住的容器（如 div.mes 里的 div.mes_header）
      var els0 = allEls(root);
      for (var cs in containerSet) {
        var allNested = true, seen = 0;
        for (var ei = 0; ei < els0.length; ei++) {
          if (els0[ei].sig !== cs) continue;
          seen++;
          var up = els0[ei].parent, nested = false;
          while (up && up !== root) { if (up.sig && containerSet[up.sig] && up.sig !== cs) { nested = true; break; } up = up.parent; }
          if (!nested) { allNested = false; break; }
        }
        if (seen && allNested) delete containerSet[cs];
      }
    }

    var items = [];   // {kind:'block'|'msg', ...} 送入 sentinel 之前的原始段
    var warnings = [];

    // 递归把文档压平为「段」：文本段 / 消息段 / 块段
    function emitText(t) {
      if (!t.trim()) return;
      items.push({ kind: 'text', text: t, start: 0 });
    }

    (function walk(node) {
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (c.kind === 'text') { emitText(c.text); continue; }
        if (MARKERS[c.tag] || (c.tag === 'summary' && node.tag === 'details')) { continue; }
        var sig = c.sig;
        var isCustomBlock = !!blockSigs[sig];
        var cls = classifySig(sig, c.attrs);
        var isContainer = !!containerSet[sig] || (!containerOverride && cls.cat === 'dialogue' && stats.some(function (s) { return s.sig === sig && s.isContainer; }));

        if (isContainer) {
          var nb = pickNameBody(c, blockSigs);
          var role = roleFromAttrs(c) || roleFromName(nb.name);
          var parts = [];
          if (nb.text) parts.push({ type: 'text', text: nb.text });
          for (var bi = 0; bi < nb.blocks.length; bi++) nb.blocks[bi].attach = attach;
          parts = parts.concat(nb.blocks);
          items.push({ kind: 'msg', role: role, name: nb.name, time: nb.time, text: nb.text, blocks: nb.blocks, start: c.start, end: c.end });
          continue;
        }
        if (c.tag === 'details') {
          var sumText = '';
          for (var sc2 = 0; sc2 < c.children.length; sc2++) {
            var ch = c.children[sc2];
            if (ch.kind === 'el' && ch.tag === 'summary') { sumText = innerText(ch); break; }
          }
          var sumCat = sumText ? classifySig(sumText.toLowerCase(), null) : null;
          var dcat = sumCat && sumCat.cat !== 'unknown' && sumCat.cat !== 'dialogue' && sumCat.score > 0 ? sumCat.cat : 'fold';
          var dblk = makeBlock(c, blockSigs, dcat, 0, { summary: 1 });
          if (dblk.text || dblk.children.length) { dblk.summaryText = sumText; dblk.attach = attach; items.push({ kind: 'block', block: dblk, start: c.start, end: c.end }); }
          continue;
        }
        if (isCustomBlock || (cls.cat !== 'dialogue' && cls.cat !== 'unknown' && cls.score > 0)) {
          var blk = makeBlock(c, blockSigs, blockCatOverride[sig] || null, 0);
          if (blk.cat === 'ui' || (!blk.text && !blk.children.length)) { continue; }
          blk.attach = attach;
          items.push({ kind: 'block', block: blk, start: c.start, end: c.end });
          continue;
        }
        // 透明容器：继续下钻，但先输出自己的前导文本
        walk(c);
      }
    })(root);

    // 文本段 → 行规则 + 伪标签块，产出有序 flow
    var flow = [], cur = null, sentinelCounter = 0;
    function pushMsg(role, name, text, time) {
      var m = { kind: 'msg', role: role, name: name, time: time || '', text: text, blocks: [], parts: text ? [{ type: 'text', text: text }] : [] };
      flow.push(m); cur = m; return m;
    }
    function attachBlock(blk) {
      if (cur && attach === 'inline') { cur.blocks.push(blk); cur.parts.push({ type: 'block', block: blk }); return; }
      flow.push(blk);
    }
    function appendText(t) {
      if (!cur) { pushMsg('sys', '', t); return; }
      var parts = cur.parts;
      var last = parts[parts.length - 1];
      if (last && last.type === 'text') { last.text += '\n' + t; cur.text = (cur.text ? cur.text + '\n' : '') + t; }
      else { parts.push({ type: 'text', text: t }); cur.text = (cur.text ? cur.text + '\n' : '') + t; }
    }

    for (var it = 0; it < items.length; it++) {
      var item = items[it];
      if (item.kind === 'block') { attachBlock(item.block); continue; }
      if (item.kind === 'msg') {
        var msg = { kind: 'msg', role: item.role, name: item.name, time: item.time || '', text: item.text, blocks: item.blocks || [], parts: [] };
        if (item.text) msg.parts.push({ type: 'text', text: item.text });
        for (var mb = 0; mb < (item.blocks || []).length; mb++) msg.parts.push({ type: 'block', block: item.blocks[mb] });
        flow.push(msg); cur = msg; continue;
      }
      // 文本段
      var lines = String(item.text).split('\n');
      var pending = null;   // 伪标签块累积
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var pt = pseudoTag(line);
        if (pt) {
          if (pending) attachPending(pending);
          pending = { tag: 'pseudo', sig: 'pseudo:' + pt.name, cat: pt.cat, label: pt.label, text: pt.rest, children: [], start: 0, kind: 'block' };
          continue;
        }
        if (pending) {
          if (!line.trim() || CHAT_RULES.some(function (r) { return r.re.test(line); })) { attachPending(pending); pending = null; }
          else { pending.text += '\n' + line; continue; }
        }
        if (!line.trim()) continue;
        var hit = null;
        for (var r = 0; r < CHAT_RULES.length; r++) { var mm = CHAT_RULES[r].re.exec(line); if (mm) { hit = { rule: CHAT_RULES[r], m: mm }; break; } }
        if (hit) {
          var name = hit.m[1], body = hit.m[hit.m.length - 1];
          if (hit.rule.name === 'bracket-time') { name = hit.m[2]; body = hit.m[3]; }
          pushMsg(roleFromName(name), name.trim(), body.trim());
        } else appendText(line);
      }
      if (pending) attachPending(pending);
    }
    function attachPending(p) { if (!p.text.trim()) return; attachBlock(p); }

    // 收尾：去掉空消息
    var out = [];
    for (var f = 0; f < flow.length; f++) {
      var x = flow[f];
      if (x.kind === 'msg' && !x.text.trim() && !x.blocks.length) continue;
      if (x.kind === 'block' && !x.text.trim() && !(x.children && x.children.length)) continue;
      out.push(x);
    }

    var msgCount = 0, flowBlocks = 0;
    for (var q = 0; q < out.length; q++) { if (out[q].kind === 'msg') msgCount++; else flowBlocks++; }
    // 内联到消息里的块也算进总数
    function countDeep(list) { var n = 0; for (var i = 0; i < list.length; i++) { n += 1 + countDeep(list[i].children || []); } return n; }
    var blockCount = 0;
    for (var q2 = 0; q2 < out.length; q2++) {
      if (out[q2].kind === 'msg') blockCount += countDeep(out[q2].blocks || []);
      else blockCount += 1 + countDeep(out[q2].children || []);
    }

    return {
      ok: out.length > 0,
      format: containerSet && Object.keys(containerSet).length ? 'html blocks (' + Object.keys(containerSet).join(', ') + ')' : (blockCount ? 'text + blocks' : 'text'),
      flow: out,
      containers: Object.keys(containerSet),
      blocks: stats.filter(function (s) { return !containerSet[s.sig] && s.count >= 2; }).sort(function (a, b) { return b.count - a.count; }),
      stats: { messages: msgCount, blocks: blockCount, flowBlocks: flowBlocks },
      warnings: warnings,
      scan: { strayCloses: sc.strayCloses.length, unclosed: sc.unclosed.length, unclosedTags: sc.unclosed.map(function (u) { return u.tag; }) },
      text: src
    };
  }

  var api = { parse: parse, scan: scan, classifySig: classifySig, containerStats: containerStats, innerText: innerText, decodeEnt: decodeEnt, CATS: CATS, CHAT_RULES: CHAT_RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatText = api;
})(typeof window !== 'undefined' ? window : globalThis);
