const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, '..', 'sniffer', 'fixtures');
const FIXT = path.join(__dirname, 'fixtures-text');
function rd(n) { return fs.readFileSync(path.join(FIX, n), 'utf8'); }
function rdt(n) { return fs.readFileSync(path.join(FIXT, n), 'utf8'); }
const data = {
  chatgpt: { name: 'conversations.json', json: JSON.parse(rd('conversations.json')) },
  claude: { name: 'claude_conversations.json', json: JSON.parse(rd('claude_conversations.json')) },
  tavern: { name: 'roleplay.jsonl', json: rd('roleplay.jsonl').split(/\r?\n/).filter(Boolean).map(function (l) { return JSON.parse(l); }) },
  wechat: { name: 'whatsapp_chat.txt', text: rd('whatsapp_chat.txt') },
  stdiv: { name: 'tavern_export.txt', text: rdt('tavern_div.txt') },
  cntags: { name: 'cn_chat.txt', text: rdt('cn_tags_dialogue.txt') }
};
const out = 'window.SAMPLES = ' + JSON.stringify(data) + ';';
fs.writeFileSync(path.join(__dirname, 'samples.js'), out);
console.log('samples.js', out.length, 'bytes');
