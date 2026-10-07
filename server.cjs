'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createProjectStore, decodeUpload, MAX_BYTES } = require('./project-store.cjs');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const assets = new Set(['index.html', 'styles.css', 'app.js', 'scene-math.js', 'image-files.js', 'example.js', 'mesh-math.js', 'mesh-renderer.js', 'layer-editor.js']);
async function readBody(req, limit) {
  const chunks = []; let size = 0;
  if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error('上传文件过大。'), { status: 413 });
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('上传文件过大。'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function createServer({ root = __dirname, projectsRoot = path.join(root, '图') } = {}) {
  const store = createProjectStore(projectsRoot);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'api') {
        if (!['GET', 'HEAD'].includes(req.method)) {
          const origin = req.headers.origin;
          if (req.headers['x-spatial-client'] !== '1' || (origin && origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
            json(res, 403, { error: '请在空间场景页面中操作项目。' }); return;
          }
        }
        if (parts[1] === 'projects' && parts.length === 2) {
          if (req.method === 'GET') { json(res, 200, await store.list()); return; }
          if (req.method === 'POST') {
            const data = JSON.parse((await readBody(req, 4096)).toString('utf8'));
            json(res, 201, await store.create(data.name)); return;
          }
        }
        if (parts[1] === 'projects' && parts.length === 3 && req.method === 'GET') { json(res, 200, await store.details(parts[2])); return; }
        if (parts[1] === 'projects' && parts[3] === 'images' && parts.length === 4 && req.method === 'PUT') {
          const upload = decodeUpload(await readBody(req, MAX_BYTES + 65540));
          json(res, 200, await store.save(parts[2], upload)); return;
        }
        json(res, 404, { error: '接口不存在。' }); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      let filename;
      if (parts[0] === '图' && parts.length === 3) filename = await store.imagePath(parts[1], parts[2]);
      else if (!parts.length || (parts.length === 1 && assets.has(parts[0]))) filename = path.join(root, parts[0] || 'index.html');
      else { res.writeHead(404); res.end('Not found'); return; }
      const stat = await fs.promises.stat(filename);
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)], 'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(filename); stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status || (error.code === 'ENOENT' ? 404 : error instanceof SyntaxError || error instanceof URIError ? 400 : error.code ? 500 : 400);
      json(res, status, { error: status === 500 ? '文件读写失败，请检查目录权限后重试。' : error.message });
    }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请设置 PORT 后重试。` : error.message); process.exitCode = 1; });
  server.listen(port, host, () => { console.log(`空间场景已启动：http://${host}:${port}`); console.log('项目保存在“图”目录，按 Ctrl+C 停止。'); });
}
module.exports = { createServer };
