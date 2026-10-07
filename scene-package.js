(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./mesh-math.js') : root.MeshMath;
  const B = typeof module !== 'undefined' && module.exports ? require('./scene-background.js') : root.SceneBackground;
  const K = typeof module !== 'undefined' && module.exports ? require('./layer-mask.js') : root.LayerMask;
  const C = typeof module !== 'undefined' && module.exports ? require('./layer-clip.js') : root.LayerClip;
  const LIMIT = 220 * 1024 * 1024, MAX_FILE = 300 * 1024 * 1024;
  const signature = [137,80,78,71,13,10,26,10], encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
  const table = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); return n >>> 0; });
  function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) n = (n >>> 8) ^ table[(n ^ byte) & 255]; return (n ^ 0xffffffff) >>> 0; }
  function chunks(bytes) {
    if (bytes.length > MAX_FILE) throw new Error('场景图片超过 300 MB。');
    if (!signature.every((n, i) => bytes[i] === n)) throw new Error('这不是有效的 PNG 图片。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = []; let offset = 8;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (offset + 12 + size > bytes.length) throw new Error('PNG 文件不完整。');
      result.push({ type, start: offset, size, end: offset + size + 12 }); offset += size + 12;
      if (type === 'IEND') { if (size !== 0 || offset !== bytes.length) throw new Error('PNG 结尾无效。'); return result; }
    }
    throw new Error('PNG 文件不完整。');
  }
  function validate(data) {
    if (!data || data.format !== 'spatial-scene' || data.version !== 1 || typeof data.title !== 'string' || data.title.length > 160 ||
        !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) || data.width < 1 || data.height < 1 || data.width > 32768 || data.height > 32768 || data.width * data.height > 100000000 ||
        !Number.isFinite(data.strength) || data.strength < 0 || data.strength > 100 || typeof data.enabled !== 'boolean' || !Array.isArray(data.layers) || data.layers.length < 1 || data.layers.length > 20) throw new Error('场景图片的数据格式无效。');
    let total = 0; const ids = new Set();
    function asset(src) {
      if (typeof src !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) throw new Error('场景图片包含无效图层。');
      const raw = src.slice(22); if (raw.length % 4) throw new Error('场景图层编码无效。');
      total += raw.length / 4 * 3 - (raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0);
      if (total > 150 * 1024 * 1024) throw new Error('场景图层合计超过 150 MB。');
    }
    asset(data.overview);
    const background = B.read(data.background); if (background.type === 'image') asset(background.src);
    for (const layer of data.layers) {
      if (!layer || typeof layer.id !== 'string' || !/^(?!00)\d{2}\.png$/.test(layer.id) || ids.has(layer.id) || !Number.isFinite(layer.depth) || layer.depth < 0 || layer.depth > 1 || typeof layer.visible !== 'boolean') throw new Error('场景图层参数无效。');
      ids.add(layer.id); M.readDeform(layer.deform); K.read(layer.mask); asset(layer.src);
    }
    if (!ids.has('01.png')) throw new Error('场景缺少 01.png 底层。');
    C.validate(data.layers);
    return data;
  }
  function embed(png, data) {
    validate(data); const payload = encoder.encode(JSON.stringify(data)); if (payload.length > LIMIT) throw new Error('场景数据过大。');
    const parts = chunks(png); const block = new Uint8Array(payload.length + 12), view = new DataView(block.buffer);
    view.setUint32(0, payload.length); block.set(encoder.encode('scNe'), 4); block.set(payload, 8); view.setUint32(block.length - 4, crc(block.subarray(4, block.length - 4)));
    const kept = parts.filter(p => p.type !== 'scNe'); const total = 8 + kept.reduce((n, p) => n + p.end - p.start, 0) + block.length;
    if (total > MAX_FILE) throw new Error('场景图片过大。');
    const result = new Uint8Array(total); result.set(png.subarray(0, 8)); let offset = 8;
    for (const part of kept) { if (part.type === 'IEND') { result.set(block, offset); offset += block.length; } result.set(png.subarray(part.start, part.end), offset); offset += part.end - part.start; }
    return result;
  }
  function extract(png) {
    const parts = chunks(png).filter(p => p.type === 'scNe'); if (!parts.length) return null;
    if (parts.length !== 1 || parts[0].size > LIMIT) throw new Error('场景数据块无效。');
    const p = parts[0], view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (crc(png.subarray(p.start + 4, p.end - 4)) !== view.getUint32(p.end - 4)) throw new Error('场景数据已损坏，请使用未压缩的原文件。');
    try { return validate(JSON.parse(decoder.decode(png.subarray(p.start + 8, p.end - 4)))); }
    catch (error) { throw new Error(error instanceof SyntaxError || error instanceof TypeError ? '场景数据无法读取。' : error.message); }
  }
  function toFiles(data) {
    validate(data);
    return [{ name: '00.png', src: data.overview }, ...data.layers.map(l => ({ name: l.id, src: l.src }))].map(item => {
      const raw = atob(item.src.slice(22)), bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
      if (!signature.every((n, i) => bytes[i] === n)) throw new Error('场景内的图片不是 PNG。');
      return new File([bytes], item.name, { type: 'image/png', lastModified: 0 });
    });
  }
  const api = { embed, extract, validate, toFiles, MAX_FILE, crc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ScenePackage = api;
})(typeof window !== 'undefined' ? window : globalThis);
