// ZIP 读取器单测：自己拼 zip（stored/deflate/ZIP64/GBK 名），不依赖外部文件
const assert = require('assert');
const Z = require('./zip');
const { buildZip, enc } = require('./zipmake');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

const sample = JSON.stringify([{ role: 'user', content: '你好，压缩包测试' }, { role: 'assistant', content: '收到了' }]);

(async function main() {
  console.log('ZIP 读取器');

  const zip = buildZip([
    { name: 'conversations.json', data: enc(sample), method: 8 },
    { name: 'readme.txt', data: enc('hello'), method: 0 },
    { name: 'images/a.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), method: 0 },
    { name: 'images/', data: Buffer.alloc(0), method: 0 }
  ]);

  const info = Z.list(zip);
  ok('list 识别 4 个条目', () => {
    assert.strictEqual(info.ok, true);
    assert.strictEqual(info.entries.length, 4);
    assert.strictEqual(info.entries[0].name, 'conversations.json');
    assert.strictEqual(info.entries[0].method, 8);
    assert.strictEqual(info.entries[3].dir, true);
  });
  const got = await Z.extract(zip, info.entries[0]);
  const stored = await Z.extract(zip, info.entries[1]);
  ok('deflate / stored 解压正确', () => {
    assert.strictEqual(Buffer.from(got).toString('utf8'), sample);
    assert.strictEqual(Buffer.from(stored).toString('utf8'), 'hello');
  });

  // 大一点、可压缩的数据：走动态 Huffman
  const big = Buffer.from(Array.from({ length: 4000 }, (_, i) => '第' + i + '行：这是一段用于压缩的中文内容，重复出现。').join('\n'));
  const zip2 = buildZip([{ name: 'big.txt', data: big, method: 8 }]);
  const got2 = await Z.extract(zip2, Z.list(zip2).entries[0]);
  ok('300KB 中文文本往返一致', () => assert.strictEqual(Buffer.from(got2).equals(big), true));

  // 随机数据（不可压缩 → deflate 里会有 stored 块）
  const rnd = require('crypto').randomBytes(70000);
  const zip3 = buildZip([{ name: 'rnd.bin', data: rnd, method: 8 }]);
  const got3 = await Z.extract(zip3, Z.list(zip3).entries[0]);
  ok('70KB 随机字节往返一致', () => assert.strictEqual(Buffer.from(got3).equals(rnd), true));

  // 纯 JS inflate 兜底：临时关掉 DecompressionStream 再解一次
  const keep = global.DecompressionStream;
  delete global.DecompressionStream;
  try {
    const viaJs = await Z.extract(zip2, Z.list(zip2).entries[0]);
    const viaJs2 = await Z.extract(zip, Z.list(zip).entries[0]);
    ok('无 DecompressionStream 时 JS inflate 兜底一致', () => {
      assert.strictEqual(Buffer.from(viaJs).equals(big), true);
      assert.strictEqual(Buffer.from(viaJs2).toString('utf8'), sample);
    });
  } finally {
    if (keep) global.DecompressionStream = keep;
  }

  // ZIP64
  const zip64 = buildZip([{ name: 'z64.json', data: enc(sample), method: 8 }], { zip64: true });
  const i64 = Z.list(zip64);
  ok('ZIP64 中央目录可读', () => {
    assert.strictEqual(i64.ok, true);
    assert.strictEqual(i64.entries[0].name, 'z64.json');
  });
  const got64 = await Z.extract(zip64, i64.entries[0]);
  ok('ZIP64 条目解压正确', () => assert.strictEqual(Buffer.from(got64).toString('utf8'), sample));

  // GBK 文件名：不设 UTF-8 标志，字节是 GBK 的「聊天记录.txt」
  const gbkName = Buffer.from([0xc1, 0xc4, 0xcc, 0xec, 0xbc, 0xc7, 0xc2, 0xbc, 0x2e, 0x74, 0x78, 0x74]);
  const zipGbk = buildZip([{ nameBytes: gbkName, name: 'x', utf8: false, data: enc('hi'), method: 0 }]);
  ok('GBK 文件名解码', () => {
    assert.strictEqual(Z.list(zipGbk).entries[0].name, '聊天记录.txt');
  });

  // 加密条目：列表能看见，取内容要明确报错
  const zipEnc = buildZip([{ name: 'secret.json', data: enc('x'), method: 0, encrypted: true }]);
  const ie = Z.list(zipEnc);
  ok('加密条目被标记', () => assert.strictEqual(ie.entries[0].encrypted, true));
  let msg = '';
  try { await Z.extract(zipEnc, ie.entries[0]); } catch (e) { msg = e.message; }
  ok('取加密条目会报错', () => assert.ok(/加了密|加密/.test(msg), msg));

  // 坏输入
  ok('非 zip 返回 ok:false', () => assert.strictEqual(Z.list(Buffer.from('not a zip at all, just text')).ok, false));
  ok('截断的 zip 返回 ok:false', () => assert.strictEqual(Z.list(zip.subarray(0, 60)).ok, false));

  console.log('\n' + passed + ' passed');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });