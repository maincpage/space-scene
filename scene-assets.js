(() => {
  'use strict';
  let database; const pending = new Map(), saved = new Map(), maskKeys = new WeakMap();
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('spatial-scene-assets', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('backgrounds');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return database;
  }
  async function writeBackground(key, src) {
    if (saved.get(key) === src && !pending.has(key)) return;
    if (pending.get(key)?.src === src) return pending.get(key).promise;
    const previous = pending.get(key)?.promise;
    const promise = (async () => {
      if (previous) await previous.catch(() => {});
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('backgrounds', 'readwrite'); tx.objectStore('backgrounds').put(src, key);
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
      });
      saved.set(key, src);
    })();
    pending.set(key, { src, promise });
    try { await promise; } finally { if (pending.get(key)?.promise === promise) pending.delete(key); }
  }
  async function readBackground(key) {
    if (pending.has(key)) await pending.get(key).promise;
    if (saved.has(key)) return saved.get(key);
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('backgrounds').objectStore('backgrounds').get(key);
      request.onsuccess = () => { if (request.result !== undefined && !pending.has(key)) saved.set(key, request.result); resolve(request.result); }; request.onerror = () => reject(request.error);
    });
  }
  function thumbnail(image) {
    // Scan once on import, then reuse the crop for every list redraw.
    const scan = document.createElement('canvas'), scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    scan.width = Math.max(1, Math.round(image.naturalWidth * scale)); scan.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = scan.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, scan.width, scan.height);
    const pixels = ctx.getImageData(0, 0, scan.width, scan.height).data;
    let left = scan.width, top = scan.height, right = -1, bottom = -1;
    for (let y = 0; y < scan.height; y++) for (let x = 0; x < scan.width; x++) if (pixels[(y * scan.width + x) * 4 + 3]) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const bounds = right < 0 ? { x: 0, y: 0, width: 1, height: 1 } : {
      x: Math.max(0, left - 1) / scan.width, y: Math.max(0, top - 1) / scan.height,
      width: (Math.min(scan.width, right + 2) - Math.max(0, left - 1)) / scan.width,
      height: (Math.min(scan.height, bottom + 2) - Math.max(0, top - 1)) / scan.height
    };
    const crop = document.createElement('canvas'), w = bounds.width * image.naturalWidth, h = bounds.height * image.naturalHeight;
    const ratio = 160 / Math.max(w, h); crop.width = Math.max(1, Math.round(w * ratio)); crop.height = Math.max(1, Math.round(h * ratio));
    crop.getContext('2d').drawImage(image, bounds.x * image.naturalWidth, bounds.y * image.naturalHeight, w, h, 0, 0, crop.width, crop.height);
    const src = crop.toDataURL('image/png'); scan.width = scan.height = crop.width = crop.height = 1;
    return { bounds, src };
  }
  function storeMaskImage(image) {
    let key = maskKeys.get(image);
    if (!key) { key = 'mask-image:' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join(''); maskKeys.set(image, key); }
    return { key, promise: isStored(key, image) ? null : writeBackground(key, image) };
  }
  async function readMaskImage(key) {
    if (typeof key !== 'string' || !/^mask-image:[0-9a-f]{32}$/.test(key)) throw new Error('保存的蒙版图片引用无效。');
    const image = window.LayerMask.readImage(await readBackground(key)); maskKeys.set(image, key); saved.set(key, image); return image;
  }
  function isStored(key, value) { return saved.get(key) === value && !pending.has(key); }
  window.SceneAssets = { writeBackground, readBackground, isStored, storeMaskImage, readMaskImage, thumbnail };
})();
