const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3013;

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end('Sorry, there was an error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 ZeroDrop Protocol server running at http://127.0.0.1:${PORT}/`);
  console.log(`📍 Pages available:`);
  console.log(`   Main: http://127.0.0.1:${PORT}/`);
  console.log(`   Fundraiser: http://127.0.0.1:${PORT}/fundraiser.html`);
  console.log(`   Trading: http://127.0.0.1:${PORT}/trading.html`);
  console.log(`   Wallet Setup: http://127.0.0.1:${PORT}/wallet-setup.html`);
  console.log(`   Wallet Test: http://127.0.0.1:${PORT}/wallet-test.html`);
});