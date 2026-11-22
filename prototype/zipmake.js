// 测试用的最小 ZIP 生成器：写 zip.js 读取所需字段（CRC32 是真算的、不写时间戳）。
// 只给 test-zip.js / verify-zip.js 用，不打进 APK。
const zlib = require('zlib');

// Node 22.2+ 自带 zlib.crc32；老一点的 Node 退回手算表
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crcOf(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }

function buildZip(items, opts) {
  opts = opts || {};
  const locals = [], centrals = [];
  let offset = 0;
  for (const it of items) {
    const raw = Buffer.isBuffer(it.data) ? it.data : Buffer.from(it.data);
    const nameBytes = it.nameBytes || Buffer.from(it.name, 'utf8');
    const method = it.method == null ? 0 : it.method;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const flags = (it.utf8 === false ? 0 : 0x0800) | (it.encrypted ? 0x0001 : 0);
    const crc = crcOf(raw);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(crc), u32(body.length), u32(raw.length), u16(nameBytes.length), u16(0),
      nameBytes, body
    ]);
    const cSizes = opts.zip64
      ? Buffer.concat([u32(0xffffffff), u32(0xffffffff)])
      : Buffer.concat([u32(body.length), u32(raw.length)]);
    const extra = opts.zip64
      ? Buffer.concat([u16(0x0001), u16(24), u64(raw.length), u64(body.length), u64(offset)])
      : Buffer.alloc(0);
    const central = Buffer.concat([
      u32(0x02014b50), u16(0x0314), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(crc), cSizes, u16(nameBytes.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0),
      u32(opts.zip64 ? 0xffffffff : offset), nameBytes, extra
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const cdOff = offset;
  const parts = locals.concat([cd]);
  if (opts.zip64) {
    parts.push(Buffer.concat([
      u32(0x06064b50), u64(44), u16(0x0314), u16(45), u32(0), u32(0),
      u64(items.length), u64(items.length), u64(cd.length), u64(cdOff)
    ]));
    parts.push(Buffer.concat([u32(0x07064b50), u32(0), u64(cdOff + cd.length), u32(1)]));
  }
  parts.push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(opts.zip64 ? 0xffff : items.length), u16(opts.zip64 ? 0xffff : items.length),
    u32(opts.zip64 ? 0xffffffff : cd.length), u32(opts.zip64 ? 0xffffffff : cdOff), u16(0)
  ]));
  return Buffer.concat(parts);
}

const enc = (s) => Buffer.from(s, 'utf8');
module.exports = { buildZip, enc };