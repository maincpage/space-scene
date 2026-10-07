(function (root) {
  'use strict';
  const MAX_POINTS = 100000, MAX_STROKES = 4000, cache = new WeakMap(), validatedImages = new WeakSet();
  const defaults = () => ({ version: 1, enabled: true, base: 1, strokes: [] });
  function readImage(value) {
    if (validatedImages.has(value)) return value;
    if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 2048 || value.height > 2048 || typeof value.data !== 'string' || value.data.length !== 4 * Math.ceil(value.width * value.height / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) throw new Error('蒙版图片数据无效。');
    if (atob(value.data).length !== value.width * value.height) throw new Error('蒙版图片数据不完整。');
    const result = Object.freeze({ width: value.width, height: value.height, data: value.data }); validatedImages.add(result); return result;
  }
  function fromImage(image) {
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight)), surface = document.createElement('canvas');
    surface.width = Math.max(1, Math.round(image.naturalWidth * scale)); surface.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = surface.getContext('2d'); ctx.drawImage(image, 0, 0, surface.width, surface.height);
    const rgba = ctx.getImageData(0, 0, surface.width, surface.height).data, bytes = new Uint8Array(surface.width * surface.height);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round((.2126 * rgba[i * 4] + .7152 * rgba[i * 4 + 1] + .0722 * rgba[i * 4 + 2]) * rgba[i * 4 + 3] / 255);
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { ...defaults(), image: readImage({ width: surface.width, height: surface.height, data: btoa(binary) }) };
  }
  function read(value) {
    if (value == null) return null;
    const valid = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
    if (value.version !== 1 || typeof value.enabled !== 'boolean' || ![0, 1].includes(value.base) || !Array.isArray(value.strokes) || value.strokes.length > MAX_STROKES) throw new Error('图层蒙版数据无效。');
    let count = 0;
    const strokes = value.strokes.map(s => {
      if (!s || !['hide', 'reveal'].includes(s.mode) || !valid(s.radius, .0025, .5) || !valid(s.hardness, 0, 1) || !valid(s.opacity, .01, 1) || !Array.isArray(s.points) || !s.points.length || (count += s.points.length) > MAX_POINTS) throw new Error('蒙版笔画数据无效或过大。');
      const points = s.points.map(p => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(n => valid(n, 0, 1))) throw new Error('蒙版笔画坐标无效。');
        return p.slice();
      });
      return { mode: s.mode, radius: s.radius, hardness: s.hardness, opacity: s.opacity, points };
    });
    return { version: 1, enabled: value.enabled, base: value.base, strokes, ...(value.image === undefined ? {} : { image: readImage(value.image) }) };
  }
  function invert(mask) {
    mask.base = 1 - mask.base;
    mask.strokes.forEach(s => { s.mode = s.mode === 'hide' ? 'reveal' : 'hide'; });
    cache.delete(mask);
  }
  function canvas(mask, aspect) {
    // Store normalized brush paths; only the preview raster is resolution-limited.
    let item = cache.get(mask);
    if (!item || item.aspect !== aspect) {
      const surface = document.createElement('canvas');
      surface.width = Math.max(1, Math.round(2048 * Math.min(1, aspect)));
      surface.height = Math.max(1, Math.round(2048 / Math.max(1, aspect)));
      const ctx = surface.getContext('2d');
      if (mask.image) {
        const image = document.createElement('canvas'); image.width = mask.image.width; image.height = mask.image.height;
        const c = image.getContext('2d'), pixels = c.createImageData(image.width, image.height), bytes = atob(mask.image.data);
        for (let i = 0; i < bytes.length; i++) { pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = mask.base ? bytes.charCodeAt(i) : 255 - bytes.charCodeAt(i); }
        c.putImageData(pixels, 0, 0); ctx.drawImage(image, 0, 0, surface.width, surface.height);
      } else if (mask.base) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, surface.width, surface.height); }
      item = { surface, ctx, aspect, stroke: 0, point: 0 }; cache.set(mask, item);
    }
    const { ctx, surface } = item, w = surface.width, h = surface.height;
    for (; item.stroke < mask.strokes.length; item.stroke++, item.point = 0) {
      const s = mask.strokes[item.stroke], radius = s.radius * Math.min(w, h);
      ctx.globalCompositeOperation = s.mode === 'hide' ? 'destination-out' : 'source-over';
      ctx.globalAlpha = s.opacity;
      const stamp = (x, y) => {
        ctx.fillStyle = '#fff';
        if (s.hardness < 1) {
          const gradient = ctx.createRadialGradient(x, y, radius * s.hardness, x, y, radius);
          gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gradient;
        }
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      };
      for (; item.point < s.points.length; item.point++) {
        const p = s.points[item.point], x = p[0] * w, y = p[1] * h;
        if (!item.point) { stamp(x, y); continue; }
        const previous = s.points[item.point - 1], px = previous[0] * w, py = previous[1] * h;
        const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / Math.max(.5, radius * .2)));
        for (let i = 1; i <= steps; i++) stamp(px + (x - px) * i / steps, py + (y - py) * i / steps);
      }
      // The last stroke can still grow while the pointer is down.
      if (item.stroke === mask.strokes.length - 1) break;
    }
    return surface;
  }
  function composite(layer) {
    if (!layer.mask?.enabled) return layer.element;
    const result = document.createElement('canvas'), image = layer.element;
    result.width = image.naturalWidth; result.height = image.naturalHeight;
    const ctx = result.getContext('2d'); ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(canvas(layer.mask, result.width / result.height), 0, 0, result.width, result.height);
    return result;
  }
  function applyFallback(layer) {
    const value = layer.mask?.enabled ? `url("${canvas(layer.mask, layer.element.naturalWidth / layer.element.naturalHeight).toDataURL()}")` : 'none';
    layer.element.style.maskImage = value; layer.element.style.webkitMaskImage = value;
    layer.element.style.maskSize = layer.element.style.webkitMaskSize = '100% 100%';
  }
  const api = { defaults, read, readImage, fromImage, invert, canvas, composite, applyFallback, MAX_POINTS, MAX_STROKES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LayerMask = api;
})(typeof window !== 'undefined' ? window : globalThis);
