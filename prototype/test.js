const fs = require('fs');
const path = require('path');
const core = require('./core.js');

const FIX = path.join(__dirname, '..', 'sniffer', 'fixtures');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// ---------- 1. ChatGPT export ----------
const chatgpt = JSON.parse(fs.readFileSync(path.join(FIX, 'conversations.json'), 'utf8'));
console.log('\n[1] ChatGPT export');
const c1 = core.inferCandidates(chatgpt);
check('has candidates', c1.length > 0, 'none');
const top = c1[0];
check('format = ChatGPT', /ChatGPT/.test(top.format), top.format);
check('conversations = $[*]', top.conversations === '$[*]', top.conversations);
check('messages = .mapping', top.messages === '.mapping', top.messages);
check('order = tree', top.order === 'tree', top.order);
check('role path', top.role === '.message.author.role', top.role);
check('text path', /parts|content/.test(top.text), top.text);
const a1 = core.assemble(chatgpt, top);
check('2 conversations', a1.conversations.length === 2, a1.conversations.length);
const conv1 = a1.conversations[0];
check('tree path = 4 messages', conv1.messages.length === 4, conv1.messages.length);
check('branch dropped = 2', conv1.branchDropped === 2, conv1.branchDropped);
check('order follows current_node', conv1.messages.map(m => m.id).join(',') === 'a1,a2,a3,a5', conv1.messages.map(m => m.id).join(','));
check('roles', conv1.messages.map(m => m.role).join(',') === 'user,assistant,user,assistant', conv1.messages.map(m => m.role).join(','));
check('text extracted', conv1.messages[0].text.indexOf('Kotlin') >= 0, conv1.messages[0].text);

// ---------- 2. Claude export ----------
const claude = JSON.parse(fs.readFileSync(path.join(FIX, 'claude_conversations.json'), 'utf8'));
console.log('\n[2] Claude export');
const c2 = core.inferCandidates(claude);
const top2 = c2[0];
check('format = Claude', /Claude/.test(top2.format), top2.format);
check('messages = .chat_messages', top2.messages === '.chat_messages', top2.messages);
check('role = .sender', top2.role === '.sender', top2.role);
check('text = .text', top2.text === '.text', top2.text);
const a2 = core.assemble(claude, top2);
check('1 conversation', a2.conversations.length === 1, a2.conversations.length);
check('2 messages', a2.conversations[0].messages.length === 2, a2.conversations[0].messages.length);
check('sender mapped', a2.conversations[0].messages.map(m => m.role).join(',') === 'human,assistant', a2.conversations[0].messages.map(m => m.role).join(','));

// ---------- 3. SillyTavern jsonl ----------
const lines = fs.readFileSync(path.join(FIX, 'roleplay.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
const tavern = lines.map(l => JSON.parse(l));
console.log('\n[3] SillyTavern .jsonl');
const c3 = core.inferCandidates(tavern);
const top3 = c3[0];
check('format = SillyTavern', /SillyTavern/.test(top3.format), top3.format);
check('messages = [*]', top3.messages === '[*]', top3.messages);
check('role = .is_user (boolean)', top3.role === '.is_user', top3.role);
const a3 = core.assemble(tavern, top3);
check('6 messages', a3.conversations[0].messages.length === 6, a3.conversations[0].messages.length);
check('boolean role mapped', a3.conversations[0].messages[0].role === 'user', a3.conversations[0].messages[0].role);
check('assistant mapped', a3.conversations[0].messages[1].role === 'assistant', a3.conversations[0].messages[1].role);

// ---------- 4. chat text ----------
const wa = fs.readFileSync(path.join(FIX, 'whatsapp_chat.txt'), 'utf8');
console.log('\n[4] WhatsApp txt');
const t4 = core.chatTextParse(wa);
check('parsed ok', t4.ok);
check('format', t4.format === 'WhatsApp-iOS', t4.format);
check('3 messages (continuation merged)', t4.messages.length === 3, t4.messages.length);
check('continuation appended', t4.messages[1].text.indexOf('换行续写') >= 0, t4.messages[1].text);
check('2 participants', t4.participants.length === 2, JSON.stringify(t4.participants));

// ---------- 5. path engine ----------
console.log('\n[5] path engine');
const root = { a: [{ b: 1 }, { b: 2 }], c: { d: 'x' } };
check('key', core.resolve(root, '$.c.d')[0] === 'x');
check('wild', core.resolve(root, '$.a[*].b').join(',') === '1,2');
check('object values', core.resolve(root, '$.c.*').length === 1);
check('index', core.resolve(root, '$.a[1].b')[0] === 2);
check('pathStr roundtrip', core.pathStr(core.tokenize('$.a[*].b')) === '$.a[*].b', core.pathStr(core.tokenize('$.a[*].b')));

// ---------- 6. 异常输入：解析器不许抛 ----------
console.log('\n[6] malformed input');
const weird = [null, [], {}, { mapping: {} }, { conversations: 'x' }, { title: 'no messages' },
  { mapping: { a: { parent: null, message: null } }, current_node: 'a' }];
let threw = '';
for (const w of weird) {
  try { core.inferCandidates(w); } catch (e) { threw = String(e && e.message); }
}
check('空/畸形 JSON 不抛异常', threw === '', threw);
let deep = {}, cur = deep;
for (let i = 0; i < 300; i++) { cur.a = {}; cur = cur.a; }
try { core.inferCandidates(deep); check('深层嵌套不炸栈', true); }
catch (e) { check('深层嵌套不炸栈', false, e.message); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
