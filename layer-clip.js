(function (root) {
  'use strict';
  function validate(layers) {
    const byId = new Map(layers.map(layer => [layer.id, layer])), done = new Set(), visiting = new Set();
    function visit(layer) {
      if (done.has(layer.id)) return;
      if (visiting.has(layer.id)) throw new Error('剪贴蒙版不能循环引用。');
      visiting.add(layer.id);
      if (layer.clipTo != null) {
        if (typeof layer.clipTo !== 'string' || !byId.has(layer.clipTo)) throw new Error('剪贴蒙版的目标图层不存在。');
        if (layer.clipTo === layer.id) throw new Error('图层不能剪贴到自身。');
        visit(byId.get(layer.clipTo));
      }
      visiting.delete(layer.id); done.add(layer.id);
    }
    layers.forEach(visit);
  }
  function canClip(layers, id, target) {
    try { validate(layers.map(layer => layer.id === id ? { ...layer, clipTo: target } : layer)); return true; } catch { return false; }
  }
  // Flat rendering preserves the clipping relationship when WebGL is unavailable.
  const flatCache = new WeakMap();
  function drawFlat(ctx, layers, view) {
    let cache = flatCache.get(ctx); if (!cache) { cache = new Map(); flatCache.set(ctx, cache); }
    for (const id of cache.keys()) if (!layers.some(layer => layer.id === id)) cache.delete(id);
    const rendered = new Set(), visiting = new Set(), w = ctx.canvas.width, h = ctx.canvas.height;
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    function draw(layer) {
      let item = cache.get(layer.id);
      if (!item) { item = { canvas: document.createElement('canvas') }; cache.set(layer.id, item); }
      if (rendered.has(layer.id)) return item.canvas;
      if (visiting.has(layer.id)) throw new Error('剪贴蒙版不能循环引用。');
      visiting.add(layer.id);
      const canvas = item.canvas; if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const c = canvas.getContext('2d'); c.clearRect(0, 0, w, h);
      const stamp = layer.mask ? `${layer.mask.enabled}:${layer.mask.base}:${layer.mask.strokes.length}:${layer.mask.strokes.at(-1)?.points.length || 0}` : '';
      if (item.element !== layer.element || item.mask !== layer.mask || item.stamp !== stamp) {
        item.element = layer.element; item.mask = layer.mask; item.stamp = stamp; item.source = root.LayerMask.composite(layer);
      }
      const t = root.SceneMath.layerTransform(view.x, view.y, layer.depth, view.strength, w, h);
      c.save(); c.translate(w / 2 + t.x, h / 2 + t.y); c.scale(t.scale, t.scale); c.drawImage(item.source, -w / 2, -h / 2, w, h); c.restore();
      if (layer.clipTo && byId.has(layer.clipTo)) { const target = draw(byId.get(layer.clipTo)); c.save(); c.globalCompositeOperation = 'destination-in'; c.drawImage(target, 0, 0); c.restore(); }
      visiting.delete(layer.id); rendered.add(layer.id); return canvas;
    }
    for (const layer of layers) if (view.solo ? layer.id === view.solo : layer.visible) ctx.drawImage(draw(layer), 0, 0);
  }
  const api = { validate, canClip, drawFlat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LayerClip = api;
})(typeof window !== 'undefined' ? window : globalThis);
