/* 最近文件 / 文件列表：记住文件、可改名、可切换。
   三套「重开」后端，按可用性降级：
   1) window.Native（Android WebView 壳，能记住 content:// URI，真正记住路径）
   2) File System Access 句柄（Chrome/Edge，同一文件下次直接打开）
   3) 内容缓存（IndexedDB，文件不大时把字节存下来，离线也能看）
   结构只存元数据（localStorage），字节与句柄放 IndexedDB。 */
(function () {
  'use strict';
  var KEY = 'cv.recents.v2';
  var MAX = 16;
  var CACHE_LIMIT = 24 * 1024 * 1024;
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open('cvfiles', 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
    return dbPromise;
  }

  function idb(op, fn) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx, store;
        try { tx = db.transaction('items', op); store = tx.objectStore('items'); } catch (e) { resolve(null); return; }
        var req = fn(store);
        req.onsuccess = function () { resolve(req.result == null ? null : req.result); };
        req.onerror = function () { resolve(null); };
      });
    });
  }

  function uid() { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function now() { return Date.now(); }

  var list = [];
  function load() {
    try { list = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    return list;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* 配额满就算了 */ }
  }
  function find(id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // 去重：同一文件（名字+大小）或同一个样本只留一条，但保留用户改的名字
  function rememberSample(key, label) {
    load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === 'sample' && list[i].sample === key) {
        list[i].ts = now();
        list.unshift(list.splice(i, 1)[0]);
        save(); return list[0];
      }
    }
    var e = { id: uid(), kind: 'sample', sample: key, name: label, size: 0, ts: now(), hasBytes: false };
    list.unshift(e); save(); return e;
  }

  function rememberFile(opt) {
    load();
    var name = opt.name || '未命名';
    var size = opt.size || 0;
    var existing = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === 'file' && list[i].name === name && list[i].size === size) { existing = list[i]; break; }
    }
    var e = existing || { id: uid(), kind: 'file', name: name, size: size, ts: now() };
    e.ts = now();
    if (opt.nativeUri) e.nativeUri = opt.nativeUri;
    if (opt.hasHandle) e.hasHandle = true;
    if (typeof opt.cached === 'boolean') e.hasBytes = opt.cached;
    if (opt.kindHint) e.kindHint = opt.kindHint;
    if (existing) list.splice(list.indexOf(existing), 1);
    list.unshift(e);
    save();
    return e;
  }

  function rename(id, name) {
    load();
    var e = find(id);
    if (!e) return null;
    var v = String(name || '').trim();
    if (v) e.custom = v; else delete e.custom;
    save();
    return e;
  }

  function remove(id) {
    load();
    var e = find(id);
    if (e) list.splice(list.indexOf(e), 1);
    save();
    idb('readwrite', function (s) { return s.delete(id); });
    return e;
  }

  function touch(id) {
    load();
    var e = find(id);
    if (!e) return;
    e.ts = now();
    list.splice(list.indexOf(e), 1);
    list.unshift(e);
    save();
  }

  function displayName(e) { return (e && (e.custom || e.name)) || '未命名'; }

  // ---- 内容缓存 ----
  function cacheBytes(id, bytes) {
    if (!bytes || bytes.length > CACHE_LIMIT) return Promise.resolve(false);
    var copy = bytes.slice(0);
    return idb('readwrite', function (s) { return s.put({ id: id, bytes: copy }); }).then(function (ok) { return ok !== null; });
  }
  function readBytes(id) {
    return idb('readonly', function (s) { return s.get(id); }).then(function (rec) {
      return rec && rec.bytes ? new Uint8Array(rec.bytes) : null;
    });
  }
  function cacheHandle(id, handle) {
    return idb('readwrite', function (s) { return s.put({ id: id, handle: handle }); }).then(function (ok) { return ok !== null; });
  }
  function readHandle(id) {
    return idb('readonly', function (s) { return s.get(id); }).then(function (rec) { return rec && rec.handle ? rec.handle : null; });
  }

  function caps() {
    return {
      native: !!(window.Native && typeof window.Native.pickFile === 'function'),
      handles: typeof window.showOpenFilePicker === 'function',
      idb: typeof indexedDB !== 'undefined'
    };
  }

  window.Recents = {
    load: load, list: function () { return load(); }, get: find, rename: rename, remove: remove,
    touch: touch, displayName: displayName, rememberSample: rememberSample, rememberFile: rememberFile,
    cacheBytes: cacheBytes, readBytes: readBytes, cacheHandle: cacheHandle, readHandle: readHandle,
    caps: caps, CACHE_LIMIT: CACHE_LIMIT
  };
})();
