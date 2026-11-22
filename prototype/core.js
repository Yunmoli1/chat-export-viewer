(function (global) {
  'use strict';

  var ROLE_KEYS = ['role', 'sender', 'author', 'from', 'is_user', 'speaker', 'participant', 'name'];
  var TEXT_KEYS = ['text', 'content', 'message', 'mes', 'parts', 'body', 'msg', 'content_text'];
  var TIME_KEYS = ['create_time', 'created_at', 'send_date', 'timestamp', 'time', 'date', 'ts', 'update_time'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isArr(v) { return Array.isArray(v); }
  function valuesOf(v) {
    if (isArr(v)) return v.slice();
    if (isObj(v)) return Object.keys(v).map(function (k) { return v[k]; });
    return [];
  }

  // ---- path ----
  function tokenize(path) {
    var s = String(path == null ? '$' : path).trim();
    if (s === '') s = '$';
    var toks = [], i = 0;
    if (s.charAt(0) === '$') i = 1;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === '.') {
        if (s.charAt(i + 1) === '*') { toks.push({ t: 'wild' }); i += 2; continue; }
        var j = i + 1;
        while (j < s.length && s.charAt(j) !== '.' && s.charAt(j) !== '[') j++;
        toks.push({ t: 'key', k: s.slice(i + 1, j) });
        i = j;
      } else if (c === '[') {
        var e = s.indexOf(']', i);
        if (e < 0) break;
        var inner = s.slice(i + 1, e).trim();
        if (inner === '*') toks.push({ t: 'wild' });
        else if (inner.charAt(0) === '"' || inner.charAt(0) === "'") toks.push({ t: 'key', k: inner.slice(1, -1) });
        else toks.push({ t: 'index', i: parseInt(inner, 10) });
        i = e + 1;
      } else { i++; }
    }
    return toks;
  }

  function tokenName(t) {
    if (t.t === 'wild') return '[*]';
    if (t.t === 'index') return '[' + t.i + ']';
    return '.' + t.k;
  }

  function pathStr(toks) {
    var s = '$';
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t === 'key') s += /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t.k) ? '.' + t.k : '[' + JSON.stringify(t.k) + ']';
      else s += tokenName(t);
    }
    return s;
  }

  function resolve(root, pathOrToks) {
    var toks = typeof pathOrToks === 'string' ? tokenize(pathOrToks) : pathOrToks;
    var cur = [root];
    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti], next = [];
      for (var ci = 0; ci < cur.length; ci++) {
        var v = cur[ci];
        if (t.t === 'wild') {
          var vs = valuesOf(v);
          for (var k = 0; k < vs.length; k++) next.push(vs[k]);
        } else if (t.t === 'key') {
          if (isObj(v) && Object.prototype.hasOwnProperty.call(v, t.k)) next.push(v[t.k]);
        } else if (t.t === 'index') {
          if (isArr(v) && t.i >= 0 && t.i < v.length) next.push(v[t.i]);
        }
      }
      cur = next;
      if (!cur.length) break;
    }
    return cur;
  }

  function firstVal(node, path) {
    if (!path) return undefined;
    var vs = resolve(node, path);
    return vs.length ? vs[0] : undefined;
  }

  // ---- value normalization ----
  function textOf(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (isArr(v)) {
      var parts = [];
      for (var i = 0; i < v.length; i++) {
        var x = v[i];
        if (typeof x === 'string') parts.push(x);
        else if (isObj(x)) {
          if (typeof x.text === 'string') parts.push(x.text);
          else if (typeof x.content === 'string') parts.push(x.content);
        }
      }
      return parts.join('\n').trim();
    }
    if (isObj(v)) {
      if (typeof v.text === 'string') return v.text;
      if (typeof v.content === 'string') return v.content;
      if (v.content != null && v.content !== v) return textOf(v.content);
      if (v.parts != null) return textOf(v.parts);
    }
    return '';
  }

  function roleOf(v) {
    if (v == null) return 'unknown';
    if (typeof v === 'boolean') return v ? 'user' : 'assistant';
    if (isObj(v)) {
      if (typeof v.role === 'string') return v.role;
      if (typeof v.name === 'string') return v.name;
    }
    return String(v);
  }

  function sampleOf(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.slice(0, 60);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (isArr(v)) return '[' + v.length + ' items]';
    if (isObj(v)) {
      var t = textOf(v);
      if (t) return t.slice(0, 60);
      return '{' + Object.keys(v).slice(0, 3).join(', ') + '}';
    }
    return '';
  }

  // ---- flatten a node's fields for the mapping dropdowns ----
  function flattenPaths(node, base, depth, out, seen) {
    out = out || []; seen = seen || {};
    base = base || [];
    if (!node || typeof node !== 'object' || depth <= 0) return out;
    if (isObj(node)) {
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var p = base.concat([{ t: 'key', k: k }]);
        var v = node[k];
        var key = pathStr(p).replace(/^\$/, '') || '$';
        if (seen[key]) continue;
        seen[key] = true;
        out.push({ path: key, toks: p, sample: sampleOf(v), kind: isArr(v) ? 'array' : (isObj(v) ? 'object' : typeof v) });
        if (isObj(v) && depth > 1) flattenPaths(v, p, depth - 1, out, seen);
        else if (isArr(v) && depth > 1) {
          for (var j = 0; j < Math.min(v.length, 2); j++) {
            if (isObj(v[j]) || isArr(v[j])) flattenPaths(v[j], p.concat([{ t: 'index', i: j }]), depth - 1, out, seen);
          }
        }
      }
    } else if (isArr(node)) {
      for (var j2 = 0; j2 < Math.min(node.length, 2); j2++) {
        if (isObj(node[j2]) || isArr(node[j2])) flattenPaths(node[j2], base.concat([{ t: 'index', i: j2 }]), depth - 1, out, seen);
      }
    }
    return out;
  }

  function relPath(toks) {
    // strip the leading '$' representation and return a path relative to a node
    return pathStr(toks).replace(/^\$/, '') || '$';
  }

  // ---- inference ----
  var ROLE_PRIORITY = { role: 100, sender: 90, is_user: 85, author: 80, from: 70, speaker: 65, participant: 60, name: 35 };
  var TEXT_PRIORITY = { text: 100, mes: 95, content: 90, parts: 85, message: 70, body: 60, msg: 55, content_text: 50 };
  var TIME_PRIORITY = { create_time: 100, created_at: 95, send_date: 90, timestamp: 85, time: 60, date: 55, ts: 50 };

  function probeFields(probe) {
    var node = isArr(probe) ? probe[0] : probe;
    var flat = flattenPaths(node, [], 4);
    var role = null, roleScore = -1, text = null, textScore = -1, time = null, timeScore = -1;
    for (var i = 0; i < flat.length; i++) {
      var f = flat[i], lastKey = '';
      var p = f.toks[f.toks.length - 1];
      if (p && p.t === 'key') lastKey = p.k;
      var v = resolve(node, f.path)[0];

      var rp = ROLE_PRIORITY[lastKey];
      if (rp != null && v != null && rp > roleScore) { role = f.path; roleScore = rp; }

      var tp = TEXT_PRIORITY[lastKey];
      if (tp != null && tp > textScore && textOf(v).length > 0) { text = f.path; textScore = tp; }

      var mp = TIME_PRIORITY[lastKey];
      if (mp != null && mp > timeScore) { time = f.path; timeScore = mp; }
    }
    return { role: role, text: text, time: time, hasRole: !!role, hasText: !!text };
  }

  function detectFormat(conv, msg) {
    if (isObj(conv) && conv.current_node && isObj(msg) && isObj(msg.message)) return 'ChatGPT export (mapping tree)';
    if (isObj(conv) && isArr(conv.chat_messages)) return 'Claude export (chat_messages)';
    if (isObj(msg) && typeof msg.is_user === 'boolean' && typeof msg.mes !== 'undefined') return 'SillyTavern (.jsonl)';
    if (isObj(msg) && isObj(msg.author)) return 'author/role style export';
    return 'generic message list';
  }

  function buildCandidate(root, toks, probe, fields, count) {
    var last = toks[toks.length - 1];
    var pt = toks.slice(0, -1);
    var conv = null, rel = null, multi = false;
    if (pt.length && pt[pt.length - 1].t === 'wild') {
      var pv = resolve(root, pt).filter(isObj);
      if (pv.length >= 1) { conv = pathStr(pt); rel = pathStr([last]).replace(/^\$/, ''); multi = true; }
    }
    if (!conv) {
      if (pt.length >= 2) {
        var pv2 = resolve(root, pt).filter(isObj);
        if (pv2.length >= 2) { conv = pathStr(pt); rel = pathStr([last]).replace(/^\$/, ''); multi = true; }
      }
    }
    if (!conv) { conv = '$'; rel = isArr(root) ? '[*]' : (toks.length ? pathStr(toks) : '$'); }

    var convSample = multi ? (resolve(root, conv).filter(isObj)[0] || {}) : (isObj(root) ? root : {});
    var msgSample = probe[0] || {};

    var leaf = null, parent = null;
    var convFlat = flattenPaths(convSample, [], 2);
    for (var i = 0; i < convFlat.length; i++) {
      var lk = convFlat[i].toks[convFlat[i].toks.length - 1].k;
      if (!leaf && (lk === 'current_node' || lk === 'leaf')) leaf = convFlat[i].path;
    }
    var msgFlat = flattenPaths(msgSample, [], 4);
    for (var j = 0; j < msgFlat.length; j++) {
      var mk = msgFlat[j].toks[msgFlat[j].toks.length - 1].k;
      if (!parent && (mk === 'parent' || mk === 'parent_message_uuid' || mk === 'parentId')) parent = msgFlat[j].path;
    }
    var idPath = null;
    for (var k = 0; k < msgFlat.length; k++) {
      var ik = msgFlat[k].toks[msgFlat[k].toks.length - 1].k;
      if (!idPath && (ik === 'id' || ik === 'uuid' || ik === 'message_id')) idPath = msgFlat[k].path;
    }

    var titlePath = null;
    for (var t2 = 0; t2 < convFlat.length; t2++) {
      var tk = convFlat[t2].toks[convFlat[t2].toks.length - 1].k;
      if (!titlePath && (tk === 'title' || tk === 'name')) titlePath = convFlat[t2].path;
    }

    var order = (leaf && parent) ? 'tree' : 'array';
    var coverage = fields.hasRole && fields.hasText ? 1 : 0;
    var score = coverage * 50 + Math.min(count, 40) * 0.5 + (multi ? 12 : 0) + (order === 'tree' ? 8 : 0);
    var format = detectFormat(convSample, msgSample);
    if (format.indexOf('ChatGPT') >= 0) score += 12;
    if (format.indexOf('Claude') >= 0) score += 10;
    if (format.indexOf('SillyTavern') >= 0) score += 8;

    return {
      id: pathStr(toks),
      conversations: conv,
      messages: rel,
      role: fields.role,
      text: fields.text,
      time: fields.time,
      title: titlePath,
      messageId: idPath,
      parent: parent,
      leaf: leaf,
      order: order,
      count: count,
      multi: multi,
      format: format,
      score: Math.round(score)
    };
  }

  function inferCandidates(root) {
    var cands = [], seen = {}, budget = 30000;
    function visit(node, toks, depth) {
      if (budget <= 0 || depth > 7 || !node || typeof node !== 'object') return;
      budget--;
      var vals = valuesOf(node);
      var objs = [];
      for (var i = 0; i < vals.length && i < 8; i++) if (isObj(vals[i])) objs.push(vals[i]);
      if (objs.length >= 2) {
        var probe = objs.slice(0, 5);
        var fields = probeFields(probe);
        if (fields.hasRole && fields.hasText) {
          var key = pathStr(toks);
          if (!seen[key]) {
            seen[key] = true;
            cands.push(buildCandidate(root, toks, probe, fields, vals.length));
          }
        }
      }
      if (budget <= 0) return;
      if (isArr(node)) {
        for (var a = 0; a < Math.min(node.length, 30); a++) visit(node[a], toks.concat([{ t: 'wild' }]), depth + 1);
      } else {
        var ks = Object.keys(node);
        for (var b = 0; b < Math.min(ks.length, 30); b++) visit(node[ks[b]], toks.concat([{ t: 'key', k: ks[b] }]), depth + 1);
      }
    }
    visit(root, [], 0);
    cands.sort(function (a, b) { return b.score - a.score; });
    return cands;
  }

  // ---- assembly ----
  function collectMessages(conv, recipe) {
    if (!recipe.messages || recipe.messages === '$') return isObj(conv) ? [conv] : [];
    var got = resolve(conv, recipe.messages);
    var raw = [];
    for (var i = 0; i < got.length; i++) {
      var g = got[i];
      if (isArr(g)) {
        var allObj = g.length > 0;
        for (var j = 0; j < g.length; j++) if (!isObj(g[j])) allObj = false;
        if (allObj) raw = raw.concat(g); else raw.push(g);
      } else if (isObj(g)) {
        var vs = valuesOf(g);
        var allObj2 = vs.length > 0;
        for (var k = 0; k < vs.length; k++) if (!isObj(vs[k])) allObj2 = false;
        if (allObj2) raw = raw.concat(vs); else raw.push(g);
      } else raw.push(g);
    }
    return raw;
  }

  function assemble(root, recipe) {
    var result = { conversations: [], errors: [], stats: { total: 0, shown: 0 } };
    var convs;
    if (!recipe.conversations || recipe.conversations === '$') convs = [root];
    else convs = resolve(root, recipe.conversations);
    convs = convs.filter(function (c) { return !!c && typeof c === 'object'; });
    if (!convs.length) { result.errors.push('会话集合路径没有命中任何对象'); return result; }

    for (var ci = 0; ci < convs.length; ci++) {
      var conv = convs[ci];
      var raw = collectMessages(conv, recipe);
      var list = [];
      for (var mi = 0; mi < raw.length; mi++) {
        var m = raw[mi];
        if (!m || typeof m !== 'object') continue;
        var text = textOf(firstVal(m, recipe.text));
        if (!text) continue;
        list.push({
          idx: mi,
          id: firstVal(m, recipe.messageId),
          parent: firstVal(m, recipe.parent),
          role: roleOf(firstVal(m, recipe.role)),
          time: firstVal(m, recipe.time),
          text: text
        });
      }
      result.stats.total += list.length;

      var ordered = list, branchDropped = 0;
      if (recipe.order === 'tree' && recipe.leaf && recipe.parent) {
        var leafVal = firstVal(conv, recipe.leaf);
        var map = {};
        for (var q = 0; q < list.length; q++) if (list[q].id != null) map[String(list[q].id)] = list[q];
        var chain = [], cur = leafVal == null ? null : String(leafVal), guard = 0;
        while (cur != null && map[cur] && guard++ < 20000) {
          chain.push(map[cur]);
          var pv = map[cur].parent;
          cur = pv == null ? null : String(pv);
        }
        if (chain.length > 0) {
          chain.reverse();
          ordered = chain;
          branchDropped = list.length - chain.length;
        } else {
          result.errors.push('会话 ' + (ci + 1) + ' 的树形回溯失败，已回退到数组顺序');
        }
      }

      var title = '';
      if (recipe.title) title = String(firstVal(conv, recipe.title) == null ? '' : firstVal(conv, recipe.title));
      if (!title && isObj(conv)) {
        title = String(conv.title || conv.name || conv.conversation_id || conv.uuid || '');
      }
      if (!title) title = '会话 ' + (ci + 1);

      result.conversations.push({
        index: ci,
        title: title,
        time: recipe.time && isObj(conv) ? firstVal(conv, recipe.time) : null,
        messages: ordered,
        branchDropped: branchDropped
      });
      result.stats.shown += ordered.length;
    }
    return result;
  }

  // ---- chat text ----
  var CHAT_RULES = [
    { name: 'WhatsApp-iOS', re: /^\[(\d{1,4}[\/.]\d{1,2}[\/.]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s+([^:：]{1,40})[:：]\s?(.*)$/ },
    { name: 'WhatsApp-Android', re: /^(\d{1,4}[\/.]\d{1,2}[\/.]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+-\s+([^:：]{1,40})[:：]\s?(.*)$/ },
    { name: 'WeChat/QQ(time-first)', re: /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:上午|下午)?\s*(.{1,40}?)[:：]\s?(.*)$/ },
    { name: 'bracket-time', re: /^\[([^\]]{1,40})\]\s*([^:：]{1,40})[:：]\s?(.*)$/ },
    { name: 'name-colon', re: /^([^:：]{1,24})[:：]\s?(.+)$/ }
  ];

  function chatTextParse(text) {
    var lines = String(text).replace(/\r\n/g, '\n').split('\n');
    var best = null, bestCount = 0;
    for (var r = 0; r < CHAT_RULES.length; r++) {
      var rule = CHAT_RULES[r], n = 0;
      for (var i = 0; i < lines.length; i++) if (lines[i].trim() && rule.re.test(lines[i])) n++;
      if (n > bestCount) { bestCount = n; best = rule; }
    }
    if (!best || bestCount < 2) return { ok: false, format: null, messages: [], participants: [] };
    var msgs = [], participants = [];
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (!line.trim()) continue;
      var m = best.re.exec(line);
      if (m) {
        var isWA = best.name.indexOf('WhatsApp') === 0;
        var isWX = best.name.indexOf('WeChat') === 0;
        var time = isWA || isWX ? (m[1] + ' ' + m[2]) : (best.name === 'bracket-time' ? m[1] : '');
        var name = isWA || isWX ? m[3] : (best.name === 'bracket-time' ? m[2] : m[1]);
        var body = isWA || isWX ? m[4] : (best.name === 'bracket-time' ? m[3] : m[2]);
        msgs.push({ role: 'person', name: name.trim(), time: time, text: body.trim() });
        if (participants.indexOf(name.trim()) < 0) participants.push(name.trim());
      } else if (msgs.length) {
        msgs[msgs.length - 1].text += '\n' + line.trim();
      }
    }
    return { ok: true, format: best.name, messages: msgs, participants: participants };
  }

  function detectMagic(bytes) {
    var b = bytes;
    if (!b || b.length < 4) return 'EMPTY';
    function u(i) { return b[i] & 255; }
    if (u(0) === 0x50 && u(1) === 0x4b) return 'ZIP';
    if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47) return 'PNG';
    if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return 'JPEG';
    if (u(0) === 0x25 && u(1) === 0x50 && u(2) === 0x44 && u(3) === 0x46) return 'PDF';
    if (u(0) === 0x1f && u(1) === 0x8b) return 'GZIP';
    if (u(0) === 0x53 && u(1) === 0x51 && u(2) === 0x4c && u(3) === 0x69) return 'SQLITE';
    return null;
  }

  var api = {
    tokenize: tokenize,
    pathStr: pathStr,
    resolve: resolve,
    textOf: textOf,
    roleOf: roleOf,
    flattenPaths: flattenPaths,
    inferCandidates: inferCandidates,
    assemble: assemble,
    chatTextParse: chatTextParse,
    detectMagic: detectMagic,
    valuesOf: valuesOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ChatCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
