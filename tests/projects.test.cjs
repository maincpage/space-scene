'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { deflateSync } = require('node:zlib');
const { createServer } = require('../server.cjs');
const { validateName } = require('../project-store.cjs');

function chunk(type, data) {
  const buffer = Buffer.alloc(data.length + 12); buffer.writeUInt32BE(data.length); buffer.write(type, 4); data.copy(buffer, 8);
  let crc = 0xffffffff;
  for (const byte of buffer.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  buffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0, buffer.length - 4); return buffer;
}
function png(width = 1, height = 1, red = 255) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { pixels[y * (1 + width * 4) + 1 + x * 4] = red; pixels[y * (1 + width * 4) + 4 + x * 4] = 255; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function upload(revision, files) {
  const manifest = Buffer.from(JSON.stringify({ revision, files: files.map(([name, data]) => ({ name, size: data.length })) }));
  const header = Buffer.alloc(4); header.writeUInt32BE(manifest.length);
  return Buffer.concat([header, manifest, ...files.map(([, data]) => data)]);
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-project-test-'));
  const server = createServer({ projectsRoot: path.join(root, '图') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('spatial-project-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = 'GET', body, headers = {}) => fetch(base + url, { method, body, headers: { 'X-Spatial-Client': '1', ...headers } });
  const create = async name => {
    const response = await request('/api/projects', 'POST', JSON.stringify({ name }));
    assert.equal(response.status, 201); return response.json();
  };
  return { root, base, request, create };
}

test('项目名不能逃出根目录，也不能使用 Windows 保留名', () => {
  for (const name of ['../x', '..', 'a/b', 'a\\b', 'CON', 'nul.png', 'COM1', 'COM¹', ' a', 'a.', '.hidden', 'a:b']) assert.throws(() => validateName(name));
  assert.equal(validateName('中文项目 01'), '中文项目 01');
});
test('扫描现有项目、运行时新建项目、重复名称不覆盖', async t => {
  const { root, request, create } = await fixture(t);
  await fs.mkdir(path.join(root, '图', '现有项目'), { recursive: true });
  const created = await create('新项目'); assert.deepEqual(created.files, []);
  const list = await (await request('/api/projects')).json();
  assert.deepEqual(list.projects.map(p => p.name).sort(), ['新项目', '现有项目'].sort());
  assert.equal((await request('/api/projects', 'POST', JSON.stringify({ name: '新项目' }))).status, 409);
});
test('整组 PNG 保存、重新打开和替换；旧图层不会残留', async t => {
  const { root, request, create } = await fixture(t), original = await create('场景 A');
  const route = '/api/projects/' + encodeURIComponent('场景 A');
  const files = [['02.png', png()], ['00.png', png()], ['01.png', png()]];
  let response = await request(route + '/images', 'PUT', upload(original.revision, files));
  assert.equal(response.status, 200); const saved = await response.json();
  assert.deepEqual(saved.files.map(f => f.name), ['00.png', '01.png', '02.png']);
  assert.deepEqual((await (await request(route)).json()).files, saved.files);
  assert.deepEqual(await fs.readFile(path.join(root, '图', '场景 A', '00.png')), png());
  const served = await request('/图/' + encodeURIComponent('场景 A') + '/00.png');
  assert.equal(served.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await served.arrayBuffer()), png());
  response = await request(route + '/images', 'PUT', upload(saved.revision, [['00.png', png(2, 2)], ['01.png', png(2, 2)]]));
  assert.equal(response.status, 200);
  assert.deepEqual((await fs.readdir(path.join(root, '图', '场景 A'))).sort(), ['00.png', '01.png']);
  assert.deepEqual(await fs.readdir(path.join(root, '图')), ['场景 A']);
});
test('无效 PNG、错尺寸、错误名称和过期版本均不能覆盖原文件', async t => {
  const { root, request, create } = await fixture(t), project = await create('保留');
  const route = '/api/projects/' + encodeURIComponent('保留') + '/images';
  const first = await request(route, 'PUT', upload(project.revision, [['00.png', png()], ['01.png', png()]]));
  const saved = await first.json();
  for (const files of [
    [['00.png', png()], ['01.png', Buffer.from('not PNG')]],
    [['00.png', png()], ['01.png', png(2, 1)]],
    [['00.png', png()], ['01.png', png().subarray(0, -5)]],
    [['00.png', png()], ['01.jpg', png()]],
    [['00.png', png()], ['../01.png', png()]]
  ]) assert.equal((await request(route, 'PUT', upload(saved.revision, files))).status, 400);
  assert.equal((await request(route, 'PUT', upload(project.revision, [['00.png', png()], ['01.png', png()]]))).status, 409);
  assert.deepEqual(await fs.readFile(path.join(root, '图', '保留', '00.png')), png());
  assert.deepEqual(await fs.readdir(path.join(root, '图')), ['保留']);
});
test('不符合规则的现有文件夹显示原因且不被覆盖', async t => {
  const { root, request, create } = await fixture(t);
  await create('旧素材'); await fs.writeFile(path.join(root, '图', '旧素材', '原图.jpg'), 'original');
  const route = '/api/projects/' + encodeURIComponent('旧素材');
  const project = await (await request(route)).json(); assert.match(project.error, /不符合规则/);
  assert.equal((await request(route + '/images', 'PUT', upload(project.revision, [['00.png', png()], ['01.png', png()]]))).status, 400);
  assert.equal(await fs.readFile(path.join(root, '图', '旧素材', '原图.jpg'), 'utf8'), 'original');
});
test('拒绝跨站写入、恶意项目路径和错误请求体', async t => {
  const { base, request } = await fixture(t);
  assert.equal((await fetch(base + '/api/projects', { method: 'POST', body: '{"name":"bad"}' })).status, 403);
  assert.equal((await request('/api/projects', 'POST', '{"name":"bad"}', { Origin: 'https://other.example' })).status, 403);
  assert.equal((await request('/api/projects', 'POST', '{"name":"../escape"}')).status, 400);
  assert.equal((await request('/api/projects', 'POST', '{')).status, 400);
  assert.equal((await request('/api/projects/%2e%2e%5cescape')).status, 400);
  assert.equal((await request('/server.cjs')).status, 404);
});
