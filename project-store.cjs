'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { prepareFiles } = require('./image-files.js');
const MAX_BYTES = 150 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function validateName(name) {
  if (typeof name !== 'string' || !name || name.length > 80 || name !== name.trim() ||
      /[<>:"/\\|?*\x00-\x1f]/.test(name) || /^[.]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) {
    throw fail('项目名请使用 1～80 个字符，不含路径符号、首尾空格或 Windows 保留名称。');
  }
  return name;
}

// Keep the upload binary so large PNGs do not need base64 copies in memory.
function decodeUpload(buffer) {
  if (buffer.length < 4) throw fail('图片数据不完整。');
  const length = buffer.readUInt32BE(0);
  if (!length || length > 65536 || length + 4 > buffer.length) throw fail('图片清单无效。');
  let manifest;
  try { manifest = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')); }
  catch { throw fail('图片清单无效。'); }
  if (!Array.isArray(manifest.files) || typeof manifest.revision !== 'string') throw fail('图片清单无效。');
  prepareFiles(manifest.files);
  let offset = 4 + length;
  const files = manifest.files.map(file => {
    if (offset + file.size > buffer.length) throw fail('图片数据不完整。');
    const data = buffer.subarray(offset, offset + file.size); offset += file.size;
    return { name: file.name, data };
  });
  if (offset !== buffer.length) throw fail('图片数据长度不正确。');
  let dimensions;
  for (const file of files) {
    const size = pngSize(file.data);
    if (dimensions && (dimensions.width !== size.width || dimensions.height !== size.height)) throw fail('整图与所有图层必须保持相同画布尺寸。');
    dimensions = size;
  }
  return { files, revision: manifest.revision };
}

function pngSize(data) {
  if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw fail('文件内容不是有效的 PNG。');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  if (!width || !height || width > 32768 || height > 32768 || width * height > 100000000) throw fail('PNG 画布尺寸无效或过大。');
  let offset = 8, hasData = false, ended = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > data.length) throw fail('PNG 文件不完整。');
    if (type === 'IDAT') hasData = true;
    offset += length + 12;
    if (type === 'IEND') { ended = length === 0; break; }
  }
  if (!hasData || !ended || offset !== data.length) throw fail('PNG 文件不完整。');
  return { width, height };
}

function createProjectStore(root) {
  root = path.resolve(root);
  const locks = new Set();
  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true });
    if ((await fs.lstat(root)).isSymbolicLink()) throw fail('图片根目录不能使用目录链接。');
  }
  async function folder(name) {
    validateName(name);
    await ensureRoot();
    const directory = path.join(root, name);
    let stat;
    try { stat = await fs.lstat(directory); } catch (error) { if (error.code === 'ENOENT') throw fail('项目不存在，请刷新项目列表。', 404); throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('项目必须是普通文件夹。');
    return directory;
  }
  async function details(name) {
    const directory = await folder(name), entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [], unsupported = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{2}\.png$/.test(entry.name)) { unsupported.push(entry.name); continue; }
      const stat = await fs.lstat(path.join(directory, entry.name));
      if (stat.isSymbolicLink()) { unsupported.push(entry.name); continue; }
      files.push({ name: entry.name, size: stat.size, lastModified: stat.mtimeMs });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    const revision = createHash('sha256').update(JSON.stringify({ files, unsupported: unsupported.sort() })).digest('hex');
    let error = unsupported.length ? `文件夹内有不符合规则的文件：${unsupported.join('、')}。请仅保留 00.png、01.png 等 PNG。` : null;
    if (files.length && !error) { try { prepareFiles(files); } catch (cause) { error = cause.message; } }
    return { name, files, revision, error };
  }
  async function list() {
    await ensureRoot();
    const entries = await fs.readdir(root, { withFileTypes: true }), projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      try { validateName(entry.name); } catch { continue; }
      const project = await details(entry.name);
      projects.push({ name: entry.name, imageCount: project.files.length, error: project.error });
    }
    return { root, projects: projects.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) };
  }
  async function create(name) {
    validateName(name); await ensureRoot();
    try { await fs.mkdir(path.join(root, name)); }
    catch (error) { if (error.code === 'EEXIST') throw fail('同名项目已经存在。', 409); throw error; }
    return details(name);
  }
  async function discard(directory) {
    // Only remove files from our own staging/backup directories, never follow links.
    const relative = path.relative(root, directory);
    if (!/^\.spatial-(stage|backup)-[0-9a-f-]+$/.test(relative)) throw fail('临时目录无效。');
    for (const entry of await fs.readdir(directory)) await fs.unlink(path.join(directory, entry));
    await fs.rmdir(directory);
  }
  async function save(name, upload) {
    validateName(name);
    const lock = name.toLocaleLowerCase('en-US');
    if (locks.has(lock)) throw fail('项目正在保存，请稍后重试。', 409);
    locks.add(lock);
    let staging, backup;
    try {
      const current = await details(name);
      if (upload.revision !== current.revision) throw fail('项目文件已经变化，请重新打开项目后导入。', 409);
      if (current.error) throw fail(current.error);
      const directory = await folder(name), token = randomUUID();
      staging = path.join(root, `.spatial-stage-${token}`); backup = path.join(root, `.spatial-backup-${token}`);
      await fs.mkdir(staging);
      for (const file of upload.files) await fs.writeFile(path.join(staging, file.name), file.data, { flag: 'wx' });
      if ((await details(name)).revision !== current.revision) throw fail('项目文件已经变化，请重新打开项目后导入。', 409);
      await fs.rename(directory, backup);
      try { await fs.rename(staging, directory); staging = null; }
      catch (error) { await fs.rename(backup, directory); throw error; }
      // Failure to remove an old backup must not report a successfully saved project as failed.
      await discard(backup).catch(() => {});
      return await details(name);
    } finally {
      if (staging) await discard(staging).catch(() => {});
      // A backup is intentionally retained if rollback itself failed.
      locks.delete(lock);
    }
  }
  async function imagePath(name, filename) {
    if (!/^\d{2}\.png$/.test(filename)) throw fail('图片名称无效。');
    const result = path.join(await folder(name), filename), stat = await fs.lstat(result);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail('图片必须是普通 PNG 文件。');
    return result;
  }
  return { list, create, details, save, imagePath };
}
module.exports = { createProjectStore, decodeUpload, validateName, pngSize, MAX_BYTES };
