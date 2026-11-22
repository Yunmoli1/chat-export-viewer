const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname); // 仓库里的 prototype 目录，与启动位置无关
const PORT = Number(process.env.PORT) || 8765;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  const rel = path.relative(ROOT, f);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + p);
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('up http://127.0.0.1:' + PORT + '/'));
