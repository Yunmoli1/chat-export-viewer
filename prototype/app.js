(function () {
  'use strict';
  var core = window.ChatCore;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

  var S = {
    name: '', size: 0, bytes: null, text: '', data: null,
    kind: '', encoding: '', format: '', note: '',
    candidates: [], recipe: null, result: null, convs: [],
    mode: 'auto', activeConv: 0, isText: false,
    textResult: null, textOpts: { blockCategories: {}, attach: 'inline' },
    // 对齐：每种角色气泡靠哪一侧。默认「我」在左（阅读式），自动/手动模式都能改
    align: { user: 'left', assistant: 'right', system: 'center', other: 'left' },
    // 块（状态栏、内心、场景…）也可以单独定左右；_default 管没单独指定的
    blockAlign: {}
  };

  // 从「最近文件」里重开时记下 id：原生读取失败就用缓存顶上
  var reopenId = null;

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // ---------- data intake ----------
  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function decodeBytes(bytes) {
    var utf8 = new TextDecoder('utf-8', { fatal: false });
    var s = utf8.decode(bytes);
    var bad = (s.match(/\uFFFD/g) || []).length;
    if (bad > 0 && bad / Math.max(s.length, 1) > 0.005) {
      try {
        var gb = new TextDecoder('gb18030', { fatal: false }).decode(bytes);
        var badGb = (gb.match(/\uFFFD/g) || []).length;
        if (badGb < bad) return { text: gb, encoding: 'GB18030' };
      } catch (e) { /* ignore */ }
    }
    if (s.length > 1 && s.indexOf('\uFFFD') < 3 && s.charCodeAt(0) === 0xEF && s.charCodeAt(1) === 0xBB) return { text: s.replace(/^\uFEFF/, ''), encoding: 'UTF-8 (BOM)' };
    return { text: s, encoding: 'UTF-8' };
  }

  function setContent(name, bytes) {
    S.name = name; S.size = bytes.length; S.bytes = bytes;
    var magic = core.detectMagic(bytes);
    if (magic && magic !== 'EMPTY') {
      S.kind = magic; S.data = null; S.candidates = []; S.convs = []; S.recipe = null; S.isText = false;
      S.encoding = '-'; S.format = 'binary / container';
      S.note = magic === 'ZIP' ? '这是压缩包：原型不负责解压，请在桌面端解压后用解压出的 json 再试。' : '这是二进制文件（' + magic + '），没有可展示的聊天结构。';
      renderAll(); return;
    }
    var dec = decodeBytes(bytes);
    S.text = dec.text; S.encoding = dec.encoding; S.isText = false; S.data = null; S.candidates = []; S.recipe = null; S.convs = [];
    parseText(S.text);
    renderAll();
  }

  function parseText(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) { S.kind = 'EMPTY'; S.format = '空文件'; S.note = '0 字节'; return; }

    var parsed = null;
    if (trimmed.charAt(0) === '[' || trimmed.charAt(0) === '{') {
      try { parsed = JSON.parse(trimmed); } catch (e) { parsed = null; }
    }
    if (parsed == null && trimmed.charAt(0) === '{') {
      var lines = trimmed.split(/\r?\n/).filter(function (l) { return l.trim(); });
      var objs = [];
      for (var i = 0; i < lines.length; i++) {
        try { objs.push(JSON.parse(lines[i])); } catch (e) { objs = null; break; }
      }
      if (objs && objs.length) { parsed = objs; S.note = '按 JSONL 解析：每行一个对象'; }
    }
    if (parsed != null) {
      S.data = parsed; S.kind = 'JSON'; S.note = ''; S.isText = false;
      var cands = core.inferCandidates(parsed);
      S.candidates = cands;
      S.format = cands.length ? cands[0].format : 'JSON（未识别出消息结构）';
      if (!cands.length) S.note = '没有找到「一堆对象，且有角色字段和正文字段」的结构，请到手动映射里指定。';
      return;
    }

    parseRichText(text, false);
  }

  // ---------- recipes ----------
  function firstConv() {
    if (!S.data) return {};
    if (!S.recipe || !S.recipe.conversations || S.recipe.conversations === '$') return S.data;
    var vs = core.resolve(S.data, S.recipe.conversations);
    for (var i = 0; i < vs.length; i++) if (vs[i] && typeof vs[i] === 'object' && !Array.isArray(vs[i])) return vs[i];
    return {};
  }

  function firstMessageObj(conv, rel) {
    if (!rel || rel === '$') return conv;
    var got = core.resolve(conv, rel), out = [];
    for (var i = 0; i < got.length; i++) {
      var g = got[i];
      if (Array.isArray(g)) { out = out.concat(g); continue; }
      if (g && typeof g === 'object') {
        var vs = core.valuesOf(g);
        var allObj = vs.length > 0;
        for (var j = 0; j < vs.length; j++) if (!vs[j] || typeof vs[j] !== 'object' || Array.isArray(vs[j])) allObj = false;
        out = allObj ? out.concat(vs) : out.concat([g]);
      }
    }
    for (var k = 0; k < out.length; k++) {
      if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) return out[k];
    }
    return {};
  }

  function applyRecipe(r) {
    S.recipe = r;
    if (!S.data) { renderAll(); return; }
    var res = core.assemble(S.data, r);
    S.result = res;
    S.convs = res.conversations;
    S.activeConv = 0;
    renderAll();
  }

  function applyCandidate(c) {
    S.mode = 'auto';
    var r = {
      id: c.id, conversations: c.conversations, messages: c.messages,
      role: c.role, text: c.text, time: c.time, title: c.title,
      parent: c.parent, leaf: c.leaf, messageId: c.messageId, order: c.order
    };
    applyRecipe(r);
  }

  function recipeFromForm() {
    function v(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
    return {
      id: 'manual',
      conversations: v('convPath') || '$',
      messages: v('msgPath') || '$',
      role: v('field-role'), text: v('field-text'), time: v('field-time'),
      title: v('field-title'), parent: v('field-parent'), leaf: v('field-leaf'),
      messageId: v('field-id'),
      order: v('field-order') || 'array'
    };
  }

  // ---------- rendering ----------
  function renderAll() {
    renderMeta();
    renderTree();
    renderMode();
    renderPreview();
    renderRecipe();
  }

  function renderMeta() {
    var box = $('meta'); box.innerHTML = '';
    if (!S.name) { box.appendChild(el('div', 'empty', '未加载文件')); return; }
    var rows = [
      ['文件', S.name],
      ['大小', humanSize(S.size)],
      ['识别', S.kind || '-'],
      ['编码', S.encoding || '-'],
      ['结构', S.format || '-']
    ];
    rows.forEach(function (r) {
      var row = el('div', 'meta-row');
      row.appendChild(el('span', 'meta-k', r[0]));
      row.appendChild(el('span', 'meta-v', String(r[1])));
      box.appendChild(row);
    });
    if (S.note) box.appendChild(el('div', 'meta-note', S.note));
  }

  function renderTree() {
    var host = $('tree'); host.innerHTML = '';
    if (S.isText) { renderTextTree(host); return; }
    if (S.data == null) { host.appendChild(el('div', 'empty', '没有可展示的结构')); return; }
    host.appendChild(treeNode('$', S.data, 0));
  }

  function treeNode(name, value, depth) {
    var d = document.createElement('details');
    d.className = 'tnode';
    var summary = document.createElement('summary');
    summary.title = name;
    summary.appendChild(el('span', 'tkey', name));
    var isA = Array.isArray(value);
    var isO = value && typeof value === 'object' && !isA;
    if (isA || isO) {
      var n = isA ? value.length : Object.keys(value).length;
      summary.appendChild(el('span', 'ttype', isA ? '[' + n + ']' : '{' + n + '}'));
      if (depth < 2) d.open = true;
    } else {
      summary.appendChild(el('span', 'tval', trunc(typeof value === 'string' ? value : JSON.stringify(value), 48)));
    }
    d.appendChild(summary);
    if ((isA || isO) && depth < 8) {
      var keys = isA ? value.map(function (_, i) { return i; }) : Object.keys(value);
      var shown = keys.slice(0, 30);
      for (var i = 0; i < shown.length; i++) {
        var kk = shown[i];
        d.appendChild(treeNode(isA ? '[' + kk + ']' : kk, value[kk], depth + 1));
      }
      if (keys.length > shown.length) d.appendChild(el('div', 'tmore', '… 还有 ' + (keys.length - shown.length) + ' 项'));
    }
    return d;
  }

  function renderMode() {
    $('modeAuto').classList.toggle('on', S.mode === 'auto');
    $('modeManual').classList.toggle('on', S.mode === 'manual');
    $('panel-auto').style.display = S.mode === 'auto' ? '' : 'none';
    $('panel-manual').style.display = S.mode === 'manual' ? '' : 'none';
    renderCandidates();
    renderForm();
  }

  // ---------- 文本 / 块模式 ----------
  var CAT_LABEL = null;
  function catLabel(id) {
    if (!CAT_LABEL && window.ChatText) { CAT_LABEL = {}; window.ChatText.CATS.forEach(function (c) { CAT_LABEL[c.id] = c.label; }); }
    return (CAT_LABEL && CAT_LABEL[id]) || '未分类';
  }

  function parseRichText(text, keepOpts) {
    if (!window.ChatText) { S.kind = 'PLAIN_TEXT'; S.format = '纯文本'; S.note = '块解析器未加载'; return; }
    if (!keepOpts) S.textOpts = { blockCategories: {}, attach: 'inline' };
    var res = window.ChatText.parse(text, S.textOpts);
    S.textResult = res;
    S.isText = true; S.data = null; S.candidates = []; S.recipe = null;
    S.kind = res.containers.length || res.stats.blocks ? 'RICH_TEXT' : (res.stats.messages ? 'CHAT_TEXT' : 'PLAIN_TEXT');
    S.format = res.format;
    var notes = [];
    if (res.stats.messages) notes.push(res.stats.messages + ' 条消息');
    if (res.stats.blocks) notes.push(res.stats.blocks + ' 个块');
    if (res.containers.length) notes.push('容器 ' + res.containers.join(', '));
    if (res.scan.unclosed) notes.push(res.scan.unclosed + ' 个未闭合标签');
    if (res.scan.strayCloses) notes.push(res.scan.strayCloses + ' 个多余闭合');
    S.note = notes.join(' · ') || '没有解析出对话';
    if (!res.stats.messages) { S.convs = []; return; }
    var names = [];
    res.flow.forEach(function (it) { if (it.kind === 'msg' && it.name && names.indexOf(it.name) < 0) names.push(it.name); });
    S.convs = [{ index: 0, title: names.slice(0, 3).join(' / ') || '聊天记录', messages: res.flow, branchDropped: 0 }];
    S.activeConv = 0;
  }

  function collectSigStats() {
    var map = {}, order = [];
    function add(b) {
      var s = map[b.sig] || (map[b.sig] = { sig: b.sig, cat: b.cat, label: b.label, count: 0, chars: 0, sample: '' });
      s.count++; s.chars += (b.text || '').length;
      if (!s.sample && b.text) s.sample = b.text.split('\n')[0].slice(0, 60);
      (b.children || []).forEach(add);
    }
    (S.textResult ? S.textResult.flow : []).forEach(function (it) {
      if (it.kind === 'block') add(it);
      else (it.blocks || []).forEach(add);
    });
    for (var k in map) order.push(map[k]);
    order.sort(function (a, b) { return b.count - a.count; });
    return order;
  }

  function blockCard(b) {
    var d = document.createElement('details');
    d.className = 'blk cat-' + (b.cat || 'unknown');
    var s = document.createElement('summary');
    s.appendChild(el('span', 'blk-badge', b.label || catLabel(b.cat)));
    s.appendChild(el('span', 'blk-title', trunc((b.summaryText || b.text || '').split('\n')[0], 46)));
    var meta = [];
    if (b.text) meta.push(b.text.length + ' 字');
    if (b.children && b.children.length) meta.push(b.children.length + ' 子块');
    if (meta.length) s.appendChild(el('span', 'blk-meta', meta.join(' · ')));
    d.appendChild(s);
    var body = el('div', 'blk-body');
    if (b.text) body.appendChild(el('div', 'blk-text', b.text));
    (b.children || []).forEach(function (c) { body.appendChild(blockCard(c)); });
    d.appendChild(body);
    return d;
  }

  function blockWrap(card, cat) {
    var w = el('div', 'blk-wrap side-' + blockSide(cat));
    w.appendChild(card);
    return w;
  }

  function textStatsLine() {
    var res = S.textResult;
    if (!res) return '';
    var t = res.stats.messages + ' 条消息 · ' + res.stats.blocks + ' 个块';
    if (res.containers.length) t += ' · 容器 ' + res.containers.join(', ');
    if (res.scan.unclosed) t += ' · 未闭合 ' + res.scan.unclosed;
    if (res.scan.strayCloses) t += ' · 多余闭合 ' + res.scan.strayCloses;
    return t;
  }

  function renderBlockInventory(host, editable) {
    var res = S.textResult;
    if (!res) { host.appendChild(el('div', 'empty', '没有可识别的内容')); return; }
    var head = el('div', 'inv-head');
    head.appendChild(el('span', 'inv-title', '识别到的块'));
    head.appendChild(el('span', 'inv-sub', res.stats.blocks + ' 个 · ' + (res.containers.length ? '容器 ' + res.containers.join(', ') : '无容器')));
    host.appendChild(head);
    var list = collectSigStats();
    if (!list.length) host.appendChild(el('div', 'empty', '没有标签块，当前按「名字: 内容」行规则解析。'));
    list.forEach(function (s) {
      var row = el('div', 'inv-row');
      var top = el('div', 'inv-top');
      top.appendChild(el('code', 'inv-sig', s.sig));
      top.appendChild(el('span', 'inv-count', '×' + s.count));
      row.appendChild(top);
      if (s.sample) row.appendChild(el('div', 'inv-sample', s.sample));
      if (editable) {
        var sel = document.createElement('select');
        sel.className = 'inv-cat';
        var cur = S.textOpts.blockCategories[s.sig] || '';
        var opts = [['', '自动（' + catLabel(s.cat) + '）']].concat(
          window.ChatText.CATS.filter(function (c) { return c.id !== 'dialogue'; }).map(function (c) { return [c.id, c.label]; })
        ).concat([['ui', '忽略不显示']]);
        opts.forEach(function (o) {
          var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
          if (cur === o[0]) op.selected = true;
          sel.appendChild(op);
        });
        sel.onchange = function () {
          if (sel.value) S.textOpts.blockCategories[s.sig] = sel.value; else delete S.textOpts.blockCategories[s.sig];
          reparseText();
        };
        row.appendChild(sel);
      } else {
        row.appendChild(el('span', 'inv-cat-label', s.label || catLabel(s.cat)));
      }
      host.appendChild(row);
    });
    if (res.containers.length) {
      var note = el('div', 'inv-note', '容器标签（一条消息一个）：' + res.containers.join(', '));
      host.appendChild(note);
    }
    if (res.scan.unclosed || res.scan.strayCloses) {
      host.appendChild(el('div', 'inv-note', '标签不闭合：' + (res.scan.unclosed || 0) + ' 处，多余闭合：' + (res.scan.strayCloses || 0) + ' 处（已容错）'));
    }
  }

  function reparseText() {
    parseRichText(S.text, true);
    renderAll();
  }

  // ---------- 左右位置（角色 + 各种块，自动/手动共用一套设置） ----------
  var ALIGN_ROLES = [['user', '我 / 用户'], ['assistant', 'AI / 助手'], ['system', '系统消息'], ['other', '其他人']];
  var ALIGN_BLOCKS = [['status', '状态栏'], ['thought', '内心 / 思考'], ['summary', '摘要'], ['system', '系统块'],
    ['ooc', '旁白 / OOC'], ['choices', '选项'], ['scene', '场景'], ['fold', '折叠块'], ['_default', '其它块']];
  var ALIGN_OPTS = [['left', '左'], ['center', '中'], ['right', '右']];
  var DEFAULT_ALIGN = { user: 'left', assistant: 'right', system: 'center', other: 'left' };
  var DISPLAY_KEY = 'cv.display.v1';

  function sideOk(v) { return v === 'left' || v === 'center' || v === 'right' ? v : 'left'; }
  function blockSide(cat) {
    var m = S.blockAlign || {};
    return sideOk(m[cat] || m._default || 'left');
  }

  function saveDisplay() {
    try {
      localStorage.setItem(DISPLAY_KEY, JSON.stringify({ align: S.align, blockAlign: S.blockAlign }));
    } catch (e) { /* 隐私模式里就算了 */ }
  }
  function loadDisplay() {
    try {
      var raw = localStorage.getItem(DISPLAY_KEY);
      if (!raw) return;
      var o = JSON.parse(raw) || {};
      if (o.align) for (var k in DEFAULT_ALIGN) if (o.align[k]) S.align[k] = sideOk(o.align[k]);
      if (o.blockAlign && typeof o.blockAlign === 'object') S.blockAlign = o.blockAlign;
    } catch (e) { /* 坏数据直接忽略 */ }
  }

  function setAlign(key, side, isBlock) {
    if (isBlock) S.blockAlign[key] = side; else S.align[key] = side;
    saveDisplay();
    renderAlignPop();
    renderPreview(); renderRecipe();
  }

  function alignRowImpl(label, key, isBlock) {
    var row = el('div', 'align-row');
    row.appendChild(el('span', 'a-label', label));
    var seg = el('span', 'seg3');
    var cur = isBlock ? blockSide(key) : sideOk(S.align[key] || 'left');
    ALIGN_OPTS.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = o[1];
      if (cur === o[0]) b.className = 'on';
      b.onclick = function (ev) { ev.stopPropagation(); setAlign(key, o[0], isBlock); };
      seg.appendChild(b);
    });
    row.appendChild(seg);
    return row;
  }

  function renderAlignPop() {
    var pop = $('alignPop'); if (!pop) return;
    pop.innerHTML = '';
    var head = el('div', 'pop-head');
    head.appendChild(el('span', null, '谁靠哪一边'));
    head.appendChild(el('span', null, '自动 / 手动都生效'));
    pop.appendChild(head);

    pop.appendChild(el('div', 'align-sec', '角色'));
    ALIGN_ROLES.forEach(function (pair) { pop.appendChild(alignRowImpl(pair[1], pair[0], false)); });

    pop.appendChild(el('div', 'pop-sep'));
    pop.appendChild(el('div', 'align-sec', '文本块（状态栏、内心、场景…）'));
    ALIGN_BLOCKS.forEach(function (pair) { pop.appendChild(alignRowImpl(pair[1], pair[0], true)); });

    var foot = el('div', 'align-foot');
    var reset = document.createElement('button');
    reset.className = 'ghost-btn';
    reset.id = 'alignReset';
    reset.style.marginTop = '0';
    reset.textContent = '恢复默认（我在左 / AI 在右）';
    reset.onclick = function (ev) {
      ev.stopPropagation();
      S.align = { user: 'left', assistant: 'right', system: 'center', other: 'left' };
      S.blockAlign = {};
      saveDisplay();
      renderAlignPop();
      renderPreview(); renderRecipe();
    };
    foot.appendChild(reset);
    pop.appendChild(foot);
  }

  // 手动映射里的表单不再重复放一遍下拉，给个按钮指过去
  function alignHint(host) {
    host.appendChild(el('div', 'form-sep', '左右位置'));
    var b = document.createElement('button');
    b.className = 'ghost-btn';
    b.textContent = '打开「位置」→ 改谁在左 / 谁在右';
    b.onclick = function (ev) { if (ev) ev.stopPropagation(); openAlignPop(); };
    host.appendChild(b);
    host.appendChild(el('div', 'field-hint', '角色和文本块都能单独定左 / 中 / 右，设置会记住。'));
  }

  function renderTextForm(host) {
    host.appendChild(el('div', 'panel-title', '手动映射（文本）'));
    host.appendChild(el('div', 'form-hint', '对话以外的块会收成可折叠的小盒子，按原文顺序插在气泡之间。改类别立刻重排。'));
    var row = el('div', 'field-row');
    row.appendChild(el('label', 'field-label', '块的位置'));
    var sel = document.createElement('select');
    [['inline', '跟随所属消息'], ['standalone', '独立插在对话间']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
      if ((S.textOpts.attach || 'inline') === o[0]) op.selected = true;
      sel.appendChild(op);
    });
    sel.onchange = function () { S.textOpts.attach = sel.value; reparseText(); };
    row.appendChild(sel);
    host.appendChild(row);
    alignHint(host);

    var crow = el('div', 'field-row');
    crow.appendChild(el('label', 'field-label', '消息容器'));
    var csel = document.createElement('select');
    var hasC = S.textResult && S.textResult.containers.length;
    [['auto', '自动检测' + (hasC ? '（' + S.textResult.containers.join(', ') + '）' : '（当前无）')], ['none', '不用容器，只按行规则']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
      var cur = S.textOpts.containerSigs && S.textOpts.containerSigs.length === 0 ? 'none' : 'auto';
      if (cur === o[0]) op.selected = true;
      csel.appendChild(op);
    });
    csel.onchange = function () {
      if (csel.value === 'none') S.textOpts.containerSigs = []; else delete S.textOpts.containerSigs;
      reparseText();
    };
    crow.appendChild(csel);
    host.appendChild(crow);

    var btn = document.createElement('button');
    btn.className = 'ghost-btn';
    btn.textContent = '按原文重新识别';
    btn.onclick = function () { S.textOpts = { blockCategories: {}, attach: 'inline' }; reparseText(); };
    host.appendChild(btn);
  }

  function renderTextTree(host) {
    var res = S.textResult;
    if (!res) { host.appendChild(el('div', 'empty', '没有可展示的块结构')); return; }
    var list = collectSigStats();
    if (!list.length) { host.appendChild(el('div', 'empty', '纯文本：没有标签结构，按行规则解析')); return; }
    list.forEach(function (s) {
      var row = el('div', 'tree-row');
      row.appendChild(el('code', 'inv-sig', s.sig));
      row.appendChild(el('span', 'inv-count', '×' + s.count + ' · 均 ' + Math.round(s.chars / s.count) + ' 字'));
      row.appendChild(el('span', 'inv-cat-label', s.label || catLabel(s.cat)));
      host.appendChild(row);
    });
    if (res.containers.length) host.appendChild(el('div', 'inv-note', '容器：' + res.containers.join(', ')));
  }

  function renderCandidates() {
    var host = $('candList'); host.innerHTML = '';
    if (S.isText) { renderBlockInventory(host, S.mode === 'manual'); return; }
    if (!S.candidates.length) { host.appendChild(el('div', 'empty', '没有候选。切到手动映射自己指定吧。')); return; }
    S.candidates.slice(0, 4).forEach(function (c) {
      var active = S.recipe && S.recipe.id === c.id;
      var card = el('div', 'cand' + (active ? ' active' : ''));
      var top = el('div', 'cand-top');
      top.appendChild(el('span', 'cand-format', c.format));
      top.appendChild(el('span', 'cand-score', c.score + ' 分'));
      card.appendChild(top);
      var paths = el('div', 'cand-paths');
      paths.appendChild(el('code', '', '会话 ' + c.conversations));
      paths.appendChild(el('code', '', '消息 ' + c.messages));
      card.appendChild(paths);
      var meta = el('div', 'cand-meta', (c.multi ? '多会话' : '单会话') + ' · ' + c.count + ' 个对象' + (c.order === 'tree' ? ' · 树形（从叶子回溯）' : ' · 数组顺序'));
      card.appendChild(meta);
      var bar = el('div', 'bar');
      var fill = el('div', 'bar-fill');
      fill.style.width = Math.min(100, c.score) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
      card.onclick = function () { applyCandidate(c); };
      host.appendChild(card);
    });
  }

  function fieldRow(label, id, options, current, hint) {
    var row = el('div', 'field-row');
    row.appendChild(el('label', 'field-label', label));
    var sel = document.createElement('select');
    sel.id = id;
    var none = document.createElement('option');
    none.value = '';
    none.textContent = '（不指定）';
    sel.appendChild(none);
    for (var i = 0; i < options.length; i++) {
      var o = document.createElement('option');
      o.value = options[i].path;
      o.textContent = options[i].path + '   ' + trunc(options[i].sample, 26);
      if (options[i].path === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = function () { onFormChange(false); };
    row.appendChild(sel);
    if (hint) row.appendChild(el('span', 'field-hint', hint));
    return row;
  }

  function pathInputRow(label, id, value, hint) {
    var row = el('div', 'field-row');
    row.appendChild(el('label', 'field-label', label));
    var inp = document.createElement('input');
    inp.id = id; inp.value = value || '$'; inp.spellcheck = false;
    inp.onchange = function () { onFormChange(true); };
    row.appendChild(inp);
    if (hint) row.appendChild(el('span', 'field-hint', hint));
    return row;
  }

  function renderForm() {
    var host = $('form'); host.innerHTML = '';
    if (S.isText) { renderTextForm(host); return; }
    var title = el('div', 'panel-title', '手动映射');
    host.appendChild(title);
    if (!S.data) { host.appendChild(el('div', 'empty', '先加载一个 JSON 文件')); return; }

    var r = S.recipe || { conversations: '$', messages: '$' };
    host.appendChild(pathInputRow('会话集合', 'convPath', r.conversations, '文件里有多个会话时填，如 $[*] 或 $.conversations[*]'));
    host.appendChild(pathInputRow('消息集合', 'msgPath', r.messages, '相对每个会话，如 mapping / chat_messages / [*]'));

    var sampleConv = firstConv();
    var sampleMsg = firstMessageObj(sampleConv, r.messages);
    host.appendChild(el('div', 'form-sep', '单条消息里的字段（相对本条消息）'));
    host.appendChild(fieldRow('角色', 'field-role', core.flattenPaths(sampleMsg, [], 4), r.role));
    host.appendChild(fieldRow('正文', 'field-text', core.flattenPaths(sampleMsg, [], 4), r.text));
    host.appendChild(fieldRow('时间', 'field-time', core.flattenPaths(sampleMsg, [], 4), r.time));
    host.appendChild(fieldRow('消息 ID', 'field-id', core.flattenPaths(sampleMsg, [], 3), r.messageId));
    host.appendChild(fieldRow('父节点', 'field-parent', core.flattenPaths(sampleMsg, [], 4), r.parent));

    host.appendChild(el('div', 'form-sep', '会话级字段（相对每个会话）'));
    host.appendChild(fieldRow('标题', 'field-title', core.flattenPaths(sampleConv, [], 2), r.title));
    host.appendChild(fieldRow('叶子节点', 'field-leaf', core.flattenPaths(sampleConv, [], 2), r.leaf));

    var orderRow = el('div', 'field-row');
    orderRow.appendChild(el('label', 'field-label', '排序'));
    var osel = document.createElement('select');
    osel.id = 'field-order';
    [['array', '数组顺序'], ['tree', '从叶子节点回溯']].forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      if ((r.order || 'array') === o[0]) op.selected = true;
      osel.appendChild(op);
    });
    osel.onchange = function () { onFormChange(false); };
    orderRow.appendChild(osel);
    host.appendChild(orderRow);
    alignHint(host);

    var hint = el('div', 'form-hint', '改动任意一项都会立刻重新解析右侧预览；满意后把下方配方导出，就是「配方」的来源。');
    host.appendChild(hint);
  }

  function onFormChange(rebuild) {
    if (!S.data) return;
    var r = recipeFromForm();
    var res = core.assemble(S.data, r);
    S.recipe = r; S.result = res; S.convs = res.conversations; S.activeConv = 0;
    if (rebuild) renderForm();
    renderPreview(); renderRecipe(); renderCandidates(); renderStats();
  }

  function renderStats() {
    var st = $('stats'); st.innerHTML = '';
    if (S.isText) { st.textContent = textStatsLine(); return; }
    if (!S.convs || !S.convs.length) return;
    var msgs = 0, dropped = 0;
    S.convs.forEach(function (c) { msgs += c.messages.length; dropped += c.branchDropped || 0; });
    var parts = [S.convs.length + ' 个会话', msgs + ' 条消息'];
    if (dropped) parts.push('已丢弃 ' + dropped + ' 条旁支');
    if (S.result && S.result.errors && S.result.errors.length) parts.push(S.result.errors[0]);
    st.textContent = parts.join(' · ');
  }

  function roleKey(role) {
    var r = String(role || '').toLowerCase();
    if (r === 'user' || r === 'human' || r === 'me') return 'user';
    if (r === 'assistant' || r === 'ai' || r === 'bot' || r === 'model') return 'assistant';
    if (r === 'system' || r === 'tool') return 'system';
    return 'other';
  }

  // 角色 → 视觉类名（配色用）与对齐侧（布局用）分开：配色跟着角色走，左右跟着用户设置走
  var COLOR_BY_ROLE = { user: 'me', assistant: 'ai', system: 'sys', other: 'other' };
  function colorClass(role) { return COLOR_BY_ROLE[roleKey(role)] || 'other'; }
  function sideOf(role) {
    return sideOk((S.align || {})[roleKey(role)] || 'left');
  }

  function cleanName(n) {
    var s = String(n == null ? '' : n).trim();
    if (!s) return '';
    if (/^\{\{\s*user\s*\}\}$/i.test(s)) return '我';
    if (/^\{\{\s*char\s*\}\}$/i.test(s)) return 'AI';
    return s.replace(/^\{\{|\}\}$/g, '');
  }

  function roleName(m) {
    var r = String(m.role || '').toLowerCase();
    if (r === 'user' || r === 'human') return '我';
    if (r === 'assistant' || r === 'ai' || r === 'model') return cleanName(m.name) || 'AI';
    if (r === 'system') return '系统';
    if (m.name) return cleanName(m.name) || m.role;
    return m.role || '未知';
  }

  function fmtTime(t) {
    if (t == null || t === '') return '';
    if (typeof t === 'number') {
      var d = new Date(t > 1e12 ? t : t * 1000);
      if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false });
    }
    var s = String(t);
    return s.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
  }

  function renderPreview() {
    var host = $('preview');
    var keepTop = host.scrollTop;            // 改对齐不该把人弹回顶部
    host.innerHTML = '';
    renderStats();
    if (!S.convs || !S.convs.length) {
      host.appendChild(el('div', 'empty', S.name ? '没有解析出消息。试试切到手动映射，或换一种字段组合。' : '打开文件或点一个样本开始。'));
      host.scrollTop = 0;
      if (window.ChatScrubber) window.ChatScrubber.refresh();
      return;
    }
    if (S.convs.length > 1) {
      var tabs = el('div', 'tabs');
      S.convs.forEach(function (c, i) {
        var b = el('button', 'tab' + (i === S.activeConv ? ' on' : ''), trunc(c.title, 22));
        b.onclick = function () { S.activeConv = i; renderPreview(); };
        tabs.appendChild(b);
      });
      host.appendChild(tabs);
    }
    var conv = S.convs[Math.min(S.activeConv, S.convs.length - 1)];
    var head = el('div', 'conv-head');
    head.appendChild(el('span', 'conv-title', conv.title || '会话'));
    if (conv.time) head.appendChild(el('span', 'conv-time', fmtTime(conv.time)));
    host.appendChild(head);
    var list = el('div', 'msgs');
    conv.messages.forEach(function (m) {
      if (m.kind === 'block') {
        if (!(S.textOpts.blockCategories[m.sig] === 'ui')) list.appendChild(blockWrap(blockCard(m), m.cat));
        return;
      }
      if (String(m.role || '').toLowerCase() === 'system' && !$('showSys').checked) return;
      var b = el('div', 'msg ' + colorClass(m.role) + ' side-' + sideOf(m.role));
      var h = el('div', 'msg-head');
      h.appendChild(el('span', 'who', roleName(m)));
      if (m.time) h.appendChild(el('span', 'ts', fmtTime(m.time)));
      b.appendChild(h);
      var body = el('div', 'msg-body');
      if (m.parts && m.parts.length) {
        m.parts.forEach(function (pt) {
          if (pt.type === 'block') body.appendChild(blockWrap(blockCard(pt.block), pt.block.cat));
          else if (pt.text) body.appendChild(el('div', 'msg-text', pt.text));
        });
      } else {
        body.appendChild(el('div', 'msg-text', m.text));
      }
      b.appendChild(body);
      list.appendChild(b);
    });
    host.appendChild(list);
    host.scrollTop = keepTop;
    if (window.ChatScrubber) window.ChatScrubber.refresh();
  }

  function renderRecipe() {
    var box = $('recipe');
    if (S.isText) {
      var res = S.textResult || { containers: [] };
      var blocks = {};
      collectSigStats().forEach(function (s) { blocks[s.sig] = S.textOpts.blockCategories[s.sig] || s.cat; });
      box.textContent = JSON.stringify({
        id: 'manual-text',
        detect: { kind: 'TEXT', format: S.format },
        text: {
          containers: S.textOpts.containerSigs || res.containers,
          blocks: blocks,
          attach: S.textOpts.attach || 'inline',
          rule: res.rule || 'auto'
        },
        display: { showSystem: $('showSys').checked, fields: ['name', 'time', 'text'], align: S.align, blockAlign: S.blockAlign }
      }, null, 2);
      return;
    }
    if (!S.recipe || !S.data) {
      box.textContent = '// 还没有配方';
      return;
    }
    var r = S.recipe;
    var out = {
      id: r.id || 'manual',
      detect: { kind: 'JSON', format: S.format },
      locate: { conversations: r.conversations, messages: r.messages },
      extract: { role: r.role || null, text: r.text || null, time: r.time || null, title: r.title || null, messageId: r.messageId || null },
      assemble: { order: r.order || 'array', parent: r.parent || null, leaf: r.leaf || null },
      display: { fields: ['time', 'role', 'text'], showSystem: $('showSys').checked, align: S.align, blockAlign: S.blockAlign }
    };
    box.textContent = JSON.stringify(out, null, 2);
  }

  // ---------- 最近文件 / 文件切换 ----------
  var SAMPLE_DEFS = [['chatgpt', 'ChatGPT 导出'], ['claude', 'Claude 导出'], ['tavern', 'SillyTavern .jsonl'],
    ['wechat', '微信 .txt'], ['stdiv', '酒馆 div 文本'], ['cntags', '中文标签文本']];
  function sampleLabel(key) {
    for (var i = 0; i < SAMPLE_DEFS.length; i++) if (SAMPLE_DEFS[i][0] === key) return SAMPLE_DEFS[i][1];
    return key;
  }
  function ago(ts) {
    var d = Date.now() - (ts || 0);
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.round(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.round(d / 3600000) + ' 小时前';
    return Math.round(d / 86400000) + ' 天前';
  }
  function closePop() {
    var pop = $('filesPop'); if (!pop) return;
    pop.hidden = true;
    $('btn-files').setAttribute('aria-expanded', 'false');
  }
  function openPop() {
    var pop = $('filesPop');
    renderFiles();
    pop.hidden = false;
    $('btn-files').setAttribute('aria-expanded', 'true');
    closeAlignPop();
  }

  function closeAlignPop() {
    var pop = $('alignPop'); if (!pop) return;
    pop.hidden = true;
    $('btn-align').setAttribute('aria-expanded', 'false');
  }
  function openAlignPop() {
    var pop = $('alignPop'); if (!pop) return;
    renderAlignPop();
    closePop();
    pop.hidden = false;
    $('btn-align').setAttribute('aria-expanded', 'true');
  }

  function renderFiles() {
    var pop = $('filesPop'); if (!pop) return;
    pop.innerHTML = '';
    var head = el('div', 'pop-head');
    head.appendChild(el('span', null, '最近打开'));
    var caps = Recents.caps();
    head.appendChild(el('span', null, caps.native ? '已记住路径' : caps.handles ? '可记住文件' : '仅缓存内容'));
    pop.appendChild(head);

    var entries = Recents.list();
    if (!entries.length) pop.appendChild(el('div', 'pop-empty', '还没有记录。打开一个文件后，这里会记住它，下次点一下就能切回来，也可以改个好记的名字。'));
    entries.forEach(function (e) {
      var row = el('div', 'file-row' + (S.fileId === e.id ? ' on' : ''));
      var main = el('div', 'f-main');
      main.appendChild(el('div', 'f-name', Recents.displayName(e)));
      var bits = [];
      if (e.kind === 'sample') bits.push('样本');
      else bits.push(e.size ? humanSize(e.size) : '大小未知');
      bits.push(ago(e.ts));
      if (e.hasBytes) bits.push('有缓存');
      main.appendChild(el('div', 'f-meta', bits.join(' · ')));
      row.appendChild(main);

      var pen = el('button', 'f-act', '✎');
      pen.title = '改名';
      pen.onclick = function (ev) { ev.stopPropagation(); beginRename(row, e); };
      row.appendChild(pen);

      var del = el('button', 'f-act', '×');
      del.title = '从列表移除（不删原文件）';
      del.onclick = function (ev) {
        ev.stopPropagation();
        Recents.remove(e.id);
        if (S.fileId === e.id) S.fileId = null;
        renderFiles();
      };
      row.appendChild(del);

      row.onclick = function () { openRecent(e.id); };
      pop.appendChild(row);
    });

    pop.appendChild(el('div', 'pop-sep'));
    pop.appendChild(el('div', 'pop-head')).appendChild(el('span', null, '样本'));
    var chips = el('div', 'sample-row');
    SAMPLE_DEFS.forEach(function (s) {
      var b = el('button', 'chip', s[1]);
      b.onclick = function (ev) { ev.stopPropagation(); loadSample(s[0]); };
      chips.appendChild(b);
    });
    pop.appendChild(chips);

    var n = $('filesN');
    if (n) n.textContent = entries.length ? String(entries.length) : '';
    if ($('btn-files')) $('btn-files').title = entries.length ? '最近打开 ' + entries.length + ' 个' : '文件列表';
  }

  function beginRename(row, e) {
    var nameEl = row.querySelector('.f-name');
    if (!nameEl) return;
    var inp = document.createElement('input');
    inp.className = 'f-rename';
    inp.value = e.custom || e.name;
    nameEl.replaceWith(inp);
    inp.focus(); inp.select();
    var done = false;
    function commit(save) {
      if (done) return; done = true;
      if (save) Recents.rename(e.id, inp.value);
      renderFiles();
    }
    inp.onblur = function () { commit(true); };
    inp.onclick = function (ev) { ev.stopPropagation(); };
    inp.onkeydown = function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    };
  }

  function b64ToBytes(b64) {
    try {
      var bin = atob(b64 || '');
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return new Uint8Array(0); }
  }

  function applyLoadedFile(e, bytes) {
    setContent(e.name, bytes);
    S.fileId = e.id;
    if (S.data && S.candidates.length && S.mode === 'auto') applyCandidate(S.candidates[0]);
    renderFiles();
  }

  function openRecent(id) {
    var e = Recents.get(id);
    if (!e) return;
    closePop();
    if (e.kind === 'sample') { loadSample(e.sample); return; }
    Recents.touch(id);
    S.fileId = e.id;

    if (e.nativeUri && window.Native && typeof window.Native.readUri === 'function') {
      toast('正在打开…');
      reopenId = e.id;
      window.Native.readUri(e.nativeUri, 'reopen');
      return;
    }
    function fromCache(msg) {
      Recents.readBytes(id).then(function (bytes) {
        if (bytes && bytes.length) {
          applyLoadedFile(e, bytes);
          if (msg) toast(msg);
        } else {
          toast('浏览器记不住任意路径，请重新选一次文件');
          openFileDialog();
        }
      });
    }
    if (typeof window.showOpenFilePicker === 'function') {
      Recents.readHandle(id).then(function (h) {
        if (!h) return fromCache();
        return Promise.resolve(h.queryPermission ? h.queryPermission({ mode: 'read' }) : 'granted')
          .then(function (perm) { return perm === 'granted' ? perm : (h.requestPermission ? h.requestPermission({ mode: 'read' }) : 'denied'); })
          .then(function (perm) {
            if (perm !== 'granted') return fromCache();
            return h.getFile().then(function (f) { return f.arrayBuffer(); }).then(function (buf) { applyLoadedFile(e, new Uint8Array(buf)); });
          });
      }).catch(function () { fromCache(); });
      return;
    }
    fromCache();
  }

  function openFileDialog() {
    if (window.Native && typeof window.Native.pickFile === 'function') {
      toast('选择文件…');
      window.Native.pickFile('pick');
      return;
    }
    if (typeof window.showOpenFilePicker === 'function') {
      window.showOpenFilePicker({ multiple: false }).then(function (hs) {
        var h = hs[0];
        return h.getFile().then(function (f) {
          return f.arrayBuffer().then(function (buf) { return { h: h, f: f, bytes: new Uint8Array(buf) }; });
        });
      }).then(function (o) {
        setContent(o.f.name, o.bytes);
        var e = Recents.rememberFile({ name: o.f.name, size: o.f.size, hasHandle: true });
        S.fileId = e.id;
        if (S.data && S.candidates.length && S.mode === 'auto') applyCandidate(S.candidates[0]);
        Recents.cacheHandle(e.id, o.h);
        Recents.cacheBytes(e.id, o.bytes).then(function (ok) {
          if (ok) { e.hasBytes = true; Recents.rememberFile({ name: o.f.name, size: o.f.size, hasHandle: true, cached: true }); }
          renderFiles();
        });
        renderFiles();
      }).catch(function (err) {
        if (!err || err.name !== 'AbortError') { $('file').click(); }
      });
      return;
    }
    $('file').click();
  }

  // ---- Android WebView 壳的回调 ----
  // 小文件走 __nativeFile 一次性回调；大文件走 __nativeBegin/__nativeChunk/__nativeEnd 分片，
  // 避免几十 MB 的 base64 塞进一次 evaluateJavascript 把 WebView 撑爆。
  var NC = null;

  function nativeOk(p) {
    reopenId = null;
    var bytes = b64ToBytes(p.base64);
    if (!bytes.length) { toast('文件为空或读取失败'); return; }
    var name = p.name || '未命名';
    setContent(name, bytes);
    var e = Recents.rememberFile({ name: name, size: p.size || bytes.length, nativeUri: p.uri || '' });
    S.fileId = e.id;
    if (S.data && S.candidates.length && S.mode === 'auto') applyCandidate(S.candidates[0]);
    Recents.cacheBytes(e.id, bytes).then(function (ok) {
      if (ok) { e.hasBytes = true; Recents.rememberFile({ name: name, size: e.size, nativeUri: p.uri || '', cached: true }); }
      renderFiles();
    });
    renderFiles();
  }

  function nativeFail(p) {
    var e0 = p.error || '未知错误';
    if (e0 === 'cancelled') { reopenId = null; return; }   // 用户自己取消，别再弹一次
    // 重开失败（URI 权限被回收 / 文件被删）：优先用本地缓存，其次请用户重选
    var entry = ((p.reqId || '') === 'reopen' && reopenId) ? Recents.get(reopenId) : null;
    reopenId = null;
    if (entry) {
      Recents.readBytes(entry.id).then(function (bytes) {
        if (bytes && bytes.length) {
          applyLoadedFile(entry, bytes);
          toast('原文件读不到了，已用本地缓存打开');
        } else {
          toast('打不开了（' + e0 + '），请重新选一次文件');
          openFileDialog();
        }
      });
      return;
    }
    toast('打不开了（' + e0 + '），请重新选一次文件');
    openFileDialog();
  }

  window.__nativeFile = function (p) {
    if (!p) return;
    if (!p.ok) nativeFail(p); else nativeOk(p);
  };

  window.__nativeBegin = function (p) {
    if (!p) return;
    NC = { meta: p, parts: [], got: 0 };
    if (!p.ok) nativeFail(p);
  };
  window.__nativeChunk = function (reqId, b64) {
    if (!NC || NC.meta.ok === false) return;
    if (b64) { NC.parts.push(b64); NC.got += b64.length; }
  };
  window.__nativeEnd = function (reqId) {
    if (!NC || NC.meta.ok === false) { NC = null; return; }
    var p = NC.meta;
    p.base64 = NC.parts.join('');
    NC = null;
    nativeOk(p);
  };

  // ---------- samples & files ----------
  function loadSample(key) {
    var s = window.SAMPLES[key];
    if (!s) { toast('样本缺失'); return; }
    var enc = new TextEncoder();
    var text = s.json != null ? JSON.stringify(s.json) : s.text;
    setContent(s.name, enc.encode(text));
    var rec = Recents.rememberSample(key, sampleLabel(key));
    S.fileId = rec.id;
    renderFiles();
    if (S.data && S.candidates.length && S.mode === 'auto') applyCandidate(S.candidates[0]);
  }

  function readFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var bytes = new Uint8Array(fr.result);
      setContent(file.name, bytes);
      if (S.data && S.candidates.length && S.mode === 'auto') applyCandidate(S.candidates[0]);
      if (S.isText) renderAll();
      var e = Recents.rememberFile({ name: file.name, size: file.size });
      S.fileId = e.id;
      renderFiles();
      Recents.cacheBytes(e.id, bytes).then(function (ok) {
        if (ok) { e.hasBytes = true; Recents.rememberFile({ name: file.name, size: file.size, cached: true }); renderFiles(); }
      });
    };
    fr.readAsArrayBuffer(file);
  }

  function init() {
    $('modeAuto').onclick = function () { S.mode = 'auto'; if (S.candidates.length) applyCandidate(S.candidates[0]); else renderAll(); };
    $('modeManual').onclick = function () { S.mode = 'manual'; renderAll(); };
    $('showSys').onchange = function () { renderPreview(); renderRecipe(); };
    $('file').onchange = function (e) {
      var f = e.target.files[0];
      if (f) readFile(f);
      e.target.value = '';
    };
    $('btn-open').onclick = function () { openFileDialog(); };
    $('btn-files').onclick = function (ev) {
      ev.stopPropagation();
      if ($('filesPop').hidden) openPop(); else closePop();
    };
    $('btn-align').onclick = function (ev) {
      ev.stopPropagation();
      if ($('alignPop').hidden) openAlignPop(); else closeAlignPop();
    };
    document.addEventListener('click', function (ev) {
      var fp = $('filesPop');
      if (!fp.hidden && !fp.contains(ev.target) && !$('btn-files').contains(ev.target)) closePop();
      var ap = $('alignPop');
      if (!ap.hidden && !ap.contains(ev.target) && !$('btn-align').contains(ev.target)) closeAlignPop();
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closePop(); closeAlignPop(); } });

    Recents.load();
    renderFiles();
    loadDisplay();
    if (window.ChatScrubber) window.ChatScrubber.init({ scrollEl: $('preview'), rail: $('rail') });

    $('btn-copy').onclick = function () {
      var txt = $('recipe').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('配方已复制'); });
      else toast('剪贴板不可用');
    };
    $('btn-download').onclick = function () {
      var blob = new Blob([$('recipe').textContent], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chat-recipe.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };

    var drop = document.body;
    drop.addEventListener('dragover', function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
    drop.addEventListener('dragleave', function () { document.body.classList.remove('dragging'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); document.body.classList.remove('dragging');
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });

    renderAll();
    var mSample = /[?&]sample=([\w-]+)/.exec(location.search);
    if (mSample && window.SAMPLES && window.SAMPLES[mSample[1]]) loadSample(mSample[1]);
    else if (!/blank=1/.test(location.search)) {
      // 下一次直接打开：优先恢复上次看的文件；没有记录就退回默认样本
      var last = Recents.list()[0];
      if (last) openRecent(last.id);
      else if (window.SAMPLES && window.SAMPLES.chatgpt) loadSample('chatgpt');
      else renderAll();
    }
    if (/mode=manual/.test(location.search)) { S.mode = 'manual'; renderAll(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
