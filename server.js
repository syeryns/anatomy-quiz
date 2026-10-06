const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const port = 8000;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log(`포트 ${port}이(가) 이미 사용 중입니다. 서버가 이미 켜져 있을 수 있어요.`);
  else console.log(err);
}).listen(port, '0.0.0.0', () => {
  console.log('해부학 퀴즈 서버가 켜졌습니다. 휴대폰에서 아래 주소로 접속하세요:\n');
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        console.log(`  http://${a.address}:${port}`);
      }
    }
  }
  console.log('\n이 창을 닫으면 서버가 꺼집니다.');
});
