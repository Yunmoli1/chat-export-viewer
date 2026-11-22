/* 极简 ZIP 读取器：只做「列条目 + 取内容」，够聊天导出用。
   支持：stored(0) / deflate(8)、ZIP64 中央目录、UTF-8 与 GB18030 文件名、目录条目、加密标记。
   解压优先 DecompressionStream('deflate-raw')；老 WebView 没有时退回内置 inflate（纯 JS）。
   不写盘、不依赖库；整个文件在内存里。
   安全边界（都在本文件里兜住，不依赖调用方）：条目数上限、单条目解压输出硬上限、
   压缩比上限、CRC32 校验。ZIP 头里声明的大小一律当成不可信。 */
(function (global) {
  'use strict';

  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }
  function u64(d, o) { return u32(d, o) + u32(d, o + 4) * 4294967296; }

  // ---- 安全上限 ----
  var MAX_ENTRY_OUT = 64 * 1024 * 1024;   // 单个条目解压后的硬上限
  var MAX_ENTRIES   = 20000;              // 中央目录条目数上限
  var MAX_RATIO     = 200;                // 压缩比上限（只拦明显离谱的，正常文本一般 <10）
  var RATIO_MIN     = 8 * 1024 * 1024;    // 压缩比检查只作用于大于这个值的条目

  function mbText(n) { return Math.round(n / 1024 / 1024) + ' MB'; }

  // CRC32（IEEE 802.3），用于核对解压结果是否和中央目录登记的一致
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(d) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function findEOCD(d) {
    var start = Math.max(0, d.length - 0x10016);
    for (var i = d.length - 22; i >= start; i--) {
      if (u32(d, i) === 0x06054b50) return i;
    }
    return -1;
  }

  // 文件名编码：UTF-8 标志位优先；否则先按 UTF-8 严解，失败退回 GB18030（Windows 打包常见）
  function decodeName(bytes, utf8Flag) {
    if (utf8Flag) {
      try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { /* 继续往下试 */ }
    } else {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* 不是 UTF-8 */ }
      try { return new TextDecoder('gb18030').decode(bytes); } catch (e) { /* 没有 GB18030 */ }
    }
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // ZIP64 扩展字段里按顺序出现的 8 字节值：未压缩大小、压缩大小、本地头偏移、磁盘号
  function readZip64Extra(bytes, need) {
    var off = 0, out = {};
    while (off + 4 <= bytes.length) {
      var id = u16(bytes, off), len = u16(bytes, off + 2);
      var body = bytes.subarray(off + 4, off + 4 + len);
      if (id === 0x0001) {
        var p = 0;
        if (need.size && p + 8 <= body.length) { out.size = u64(body, p); p += 8; }
        if (need.compSize && p + 8 <= body.length) { out.compSize = u64(body, p); p += 8; }
        if (need.offset && p + 8 <= body.length) { out.offset = u64(body, p); p += 8; }
      }
      off += 4 + len;
    }
    return out;
  }

  function list(d) {
    if (!d || d.length < 22) return { ok: false, error: '文件太小，不像 ZIP' };
    var eocd = findEOCD(d);
    if (eocd < 0) return { ok: false, error: '找不到 ZIP 中央目录（可能不是 zip，或文件被截断）' };

    var total = u16(d, eocd + 10);
    var cdSize = u32(d, eocd + 12);
    var cdOff = u32(d, eocd + 16);

    // ZIP64：定位器固定在 EOCD 前 20 字节
    if (eocd >= 20 && u32(d, eocd - 20) === 0x07064b50) {
      var z64off = u64(d, eocd - 12);
      if (z64off + 56 <= d.length && u32(d, z64off) === 0x06064b50) {
        total = u64(d, z64off + 32);
        cdSize = u64(d, z64off + 40);
        cdOff = u64(d, z64off + 48);
      }
    }

    if (cdOff + cdSize > d.length + 1) return { ok: false, error: '中央目录越界，文件可能不完整' };

    if (total > MAX_ENTRIES) return { ok: false, error: 'ZIP 里条目太多（' + total + ' 个），超过 ' + MAX_ENTRIES + ' 个上限' };

    var entries = [];
    var p = cdOff;
    for (var i = 0; i < total; i++) {
      if (p + 46 > d.length || u32(d, p) !== 0x02014b50) break;
      var flags = u16(d, p + 8);
      var method = u16(d, p + 10);
      var crc = u32(d, p + 16);
      var compSize = u32(d, p + 20);
      var size = u32(d, p + 24);
      var nameLen = u16(d, p + 28);
      var extraLen = u16(d, p + 30);
      var commentLen = u16(d, p + 32);
      var offset = u32(d, p + 42);
      var nameBytes = d.subarray(p + 46, p + 46 + nameLen);
      var extra = d.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);

      if (size === 0xffffffff || compSize === 0xffffffff || offset === 0xffffffff) {
        var z = readZip64Extra(extra, {
          size: size === 0xffffffff,
          compSize: compSize === 0xffffffff,
          offset: offset === 0xffffffff
        });
        if (z.size != null) size = z.size;
        if (z.compSize != null) compSize = z.compSize;
        if (z.offset != null) offset = z.offset;
      }

      var name = decodeName(nameBytes, (flags & 0x0800) !== 0);
      entries.push({
        name: name,
        dir: /[\\/]$/.test(name),
        method: method,
        size: size,
        compSize: compSize,
        crc: crc,
        offset: offset,
        encrypted: (flags & 0x0001) !== 0
      });
      p += 46 + nameLen + extraLen + commentLen;
    }

    if (!entries.length) return { ok: false, error: 'ZIP 里没有条目' };
    return { ok: true, entries: entries, count: entries.length };
  }

  // ---------------- raw inflate（RFC 1951），只在没有 DecompressionStream 时用 ----------------
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function inflateRaw(src, expected, limit) {
    var max = limit > 0 ? limit : MAX_ENTRY_OUT;
    var pos = 0, bitbuf = 0, bitcnt = 0;
    var cap = expected > 0 ? Math.min(expected, max) : Math.min(Math.max(1 << 12, src.length * 4), max);
    var out = new Uint8Array(cap), op = 0;

    function ensure(extra) {
      // 声明大小不可信：按实际输出计数，到顶就停
      if (op + extra > max) throw new Error('解压后超过 ' + mbText(max) + ' 上限，文件可能是压缩炸弹');
      if (op + extra <= out.length) return;
      var next = new Uint8Array(Math.min(max, Math.max(out.length * 2, op + extra)));
      next.set(out.subarray(0, op));
      out = next;
    }
    function need(n) {
      while (bitcnt < n) {
        if (pos >= src.length) throw new Error('deflate 数据提前结束');
        bitbuf |= src[pos++] << bitcnt;
        bitcnt += 8;
      }
    }
    function bits(n) {
      if (!n) return 0;
      need(n);
      var v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n;
      bitcnt -= n;
      return v;
    }
    function put(b) { ensure(1); out[op++] = b; }

    function buildTree(lengths) {
      var count = new Uint16Array(16), offs = new Uint16Array(16);
      var symbol = new Uint16Array(lengths.length), i;
      for (i = 0; i < lengths.length; i++) count[lengths[i]]++;
      count[0] = 0;
      for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
      for (i = 0; i < lengths.length; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
      return { count: count, symbol: symbol };
    }
    function decodeSym(t) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len < 16; len++) {
        code |= bits(1);
        var c = t.count[len];
        if (code - first < c) return t.symbol[index + (code - first)];
        index += c;
        first = (first + c) << 1;
        code <<= 1;
      }
      throw new Error('无效的 Huffman 码');
    }

    var fixedLit = null, fixedDist = null;
    function fixedLitTree() {
      if (!fixedLit) {
        var l = new Uint8Array(288);
        for (var i = 0; i < 144; i++) l[i] = 8;
        for (; i < 256; i++) l[i] = 9;
        for (; i < 280; i++) l[i] = 7;
        for (; i < 288; i++) l[i] = 8;
        fixedLit = buildTree(l);
      }
      return fixedLit;
    }
    function fixedDistTree() {
      if (!fixedDist) {
        var l = new Uint8Array(30);
        for (var i = 0; i < 30; i++) l[i] = 5;
        fixedDist = buildTree(l);
      }
      return fixedDist;
    }

    var final = 0;
    while (!final) {
      final = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;                       // stored 块按字节对齐
        if (pos + 4 > src.length) throw new Error('stored 块缺长度');
        var len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        if (pos + len > src.length) throw new Error('stored 块越界');
        ensure(len);
        out.set(src.subarray(pos, pos + len), op);
        op += len; pos += len;
        continue;
      }
      var lit, dist;
      if (type === 1) { lit = fixedLitTree(); dist = fixedDistTree(); }
      else if (type === 2) {
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        var clLens = new Uint8Array(19);
        for (var ci = 0; ci < hclen; ci++) clLens[CLORDER[ci]] = bits(3);
        var clTree = buildTree(clLens);
        var lens = new Uint8Array(hlit + hdist);
        var n = 0;
        while (n < lens.length) {
          var sym = decodeSym(clTree);
          if (sym < 16) { lens[n++] = sym; continue; }
          var rep, val = 0;
          if (sym === 16) {
            if (!n) throw new Error('长度重复码没有前值');
            val = lens[n - 1]; rep = 3 + bits(2);
          } else if (sym === 17) { rep = 3 + bits(3); }
          else { rep = 11 + bits(7); }
          while (rep-- > 0) { if (n >= lens.length) throw new Error('长度表越界'); lens[n++] = val; }
        }
        lit = buildTree(lens.subarray(0, hlit));
        dist = buildTree(lens.subarray(hlit));
      } else {
        throw new Error('deflate 块类型 3 保留未用');
      }

      for (;;) {
        var s = decodeSym(lit);
        if (s < 256) { put(s); continue; }
        if (s === 256) break;
        s -= 257;
        if (s >= LBASE.length) throw new Error('长度码越界');
        var length = LBASE[s] + bits(LEXT[s]);
        var ds = decodeSym(dist);
        if (ds >= DBASE.length) throw new Error('距离码越界');
        var distance = DBASE[ds] + bits(DEXT[ds]);
        if (distance > op) throw new Error('距离超出已解压数据');
        ensure(length);
        for (var k = 0; k < length; k++) { out[op] = out[op - distance]; op++; }
      }
    }
    return out.subarray(0, op);
  }

  function canStream() {
    if (typeof DecompressionStream !== 'function' || typeof Response !== 'function' || typeof Blob !== 'function') return false;
    try { return !!new DecompressionStream('deflate-raw'); } catch (e) { return false; }
  }

  function inflateWithStream(src, expected, limit) {
    var max = limit > 0 ? limit : MAX_ENTRY_OUT;
    var ds = new DecompressionStream('deflate-raw');
    var reader = new Blob([src]).stream().pipeThrough(ds).getReader();
    var chunks = [], total = 0;

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), at = 0;
          for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], at); at += chunks[i].length; }
          // expected 只用来预分配，实际长度以解压结果为准
          return out;
        }
        total += r.value.length;
        if (total > max) {
          try { reader.cancel(); } catch (e) { /* 已结束就算了 */ }
          throw new Error('解压后超过 ' + mbText(max) + ' 上限，文件可能是压缩炸弹');
        }
        chunks.push(r.value);
        return pump();
      });
    }
    return pump();
  }

  function inflateRawAsync(src, expected, limit) {
    if (canStream()) {
      return inflateWithStream(src, expected, limit).catch(function () { return inflateRaw(src, expected, limit); });
    }
    return Promise.resolve().then(function () { return inflateRaw(src, expected, limit); });
  }

  function checkCrc(entry, out) {
    if (crc32(out) !== entry.crc) {
      return Promise.reject(new Error('解压后校验失败（CRC32 不匹配），文件可能已损坏：' + entry.name));
    }
    return Promise.resolve();
  }

  // 取出一个条目的原始字节；返回 Promise<Uint8Array>
  // opts.maxBytes 可覆盖单条目上限（默认 64MB），测试里用得上
  function extract(d, entry, opts) {
    var limit = (opts && opts.maxBytes > 0) ? opts.maxBytes : MAX_ENTRY_OUT;
    if (entry.encrypted) return Promise.reject(new Error('这个条目加了密（需要密码），暂不支持'));
    if (entry.size > RATIO_MIN && entry.compSize > 0 && entry.size / entry.compSize > MAX_RATIO) {
      return Promise.reject(new Error('压缩比异常（声明 ' + mbText(entry.size) + '），可能是压缩炸弹：' + entry.name));
    }
    var o = entry.offset;
    if (o + 30 > d.length || u32(d, o) !== 0x04034b50) return Promise.reject(new Error('本地文件头损坏：' + entry.name));
    var nameLen = u16(d, o + 26), extraLen = u16(d, o + 28);
    var start = o + 30 + nameLen + extraLen;
    var end = start + entry.compSize;
    if (end > d.length) return Promise.reject(new Error('条目数据越界：' + entry.name));
    var raw = d.subarray(start, end);
    if (entry.method === 0) {
      if (raw.length > limit) return Promise.reject(new Error('解压后超过 ' + mbText(limit) + ' 上限：' + entry.name));
      var copy = new Uint8Array(raw);
      return checkCrc(entry, copy).then(function () { return copy; });
    }
    if (entry.method === 8) {
      return inflateRawAsync(raw, entry.size, limit).then(function (out) {
        return checkCrc(entry, out).then(function () { return out; });
      });
    }
    return Promise.reject(new Error('不支持的压缩方式 ' + entry.method + '（只认 stored / deflate）：' + entry.name));
  }

  var api = { list: list, extract: extract, inflateRaw: inflateRaw, canStream: canStream,
              decodeName: decodeName, crc32: crc32,
              limits: { entryOut: MAX_ENTRY_OUT, entries: MAX_ENTRIES, ratio: MAX_RATIO } };
  global.ChatZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);