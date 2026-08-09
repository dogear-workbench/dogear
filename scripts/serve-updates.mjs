import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVE_DIR = process.env.UPDATE_SERVER_DIR || path.join(ROOT, 'update-server');
const PORT = 9527;

const MIME_TYPES = {
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.exe': 'application/octet-stream',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.blockmap': 'application/octet-stream',
  '.html': 'text/html',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') {
    listFiles();
    return;
  }

  const filePath = path.join(SERVE_DIR, urlPath);
  if (!filePath.startsWith(SERVE_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const total = stats.size;
    const range = req.headers.range;

    console.log(`${req.method} ${urlPath}${range ? ` [range: ${range}]` : ''}`);

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

      if (start >= total || end >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  function listFiles() {
    fs.readdir(SERVE_DIR, (dirErr, files) => {
      if (dirErr) {
        res.writeHead(500);
        res.end('Server directory not found');
        return;
      }
      const links = files
        .map(f => `  <li><a href="/${encodeURIComponent(f)}">${f}</a></li>`)
        .join('\n');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><body><h1>Dogear Update Server</h1><ul>\n${links}\n</ul></body></html>`);
    });
  }
});

server.listen(PORT, () => {
  console.log(`\n🔄 Dogear 更新服务已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   目录: ${SERVE_DIR}`);
  console.log(`   manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`\n按 Ctrl+C 停止\n`);
});
