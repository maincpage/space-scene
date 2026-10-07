(function (root) {
  'use strict';
  const MAX_BYTES = 32 * 1024 * 1024;
  function read(value) {
    if (value === undefined) return { type: 'black' };
    if (!value || !['black', 'white', 'image'].includes(value.type)) throw new Error('背景设置无效。');
    if (value.type !== 'image') return { type: value.type };
    if (typeof value.src !== 'string' || value.src.length > MAX_BYTES * 4 / 3 + 24 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.src) || (value.src.length - 22) % 4) throw new Error('底图数据无效，请重新上传图片。');
    return { type: 'image', src: value.src };
  }
  function apply(element, background) {
    element.style.backgroundColor = background.type === 'white' ? '#fff' : '#000';
    element.style.backgroundImage = background.type === 'image' ? `url("${background.src}")` : 'none';
    element.style.backgroundPosition = 'center'; element.style.backgroundSize = 'cover'; element.style.backgroundRepeat = 'no-repeat';
  }
  function draw(ctx, width, height, background, image) {
    ctx.fillStyle = background.type === 'white' ? '#fff' : '#000'; ctx.fillRect(0, 0, width, height);
    if (background.type !== 'image' || !image) return;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }
  const api = { read, apply, draw, MAX_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SceneBackground = api;
})(typeof window !== 'undefined' ? window : globalThis);
