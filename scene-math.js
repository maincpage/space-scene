(function (root) {
  'use strict';
  const clamp = (value, min = -1, max = 1) => Math.min(max, Math.max(min, value));
  function pointerPosition(x, y, rect) {
    return { x: clamp((x - rect.left) / Math.max(1, rect.width) * 2 - 1), y: clamp((y - rect.top) / Math.max(1, rect.height) * 2 - 1) };
  }
  function layerTransform(x, y, depth, strength, width, height = width) {
    const amount = clamp(strength, 0, 100) / 100;
    const factor = .033 * amount * (.12 + .88 * clamp(depth, 0, 1));
    return { x: -clamp(x) * Math.max(0, width) * factor, y: -clamp(y) * Math.max(0, height) * factor, scale: 1 + .075 * amount };
  }
  function fitSize(width, height, aspect) {
    const w = Math.min(Math.max(1, width), Math.max(1, height) * aspect);
    return { width: w, height: w / aspect };
  }
  function orientationPosition(beta, gamma, baseline, angle = 0) {
    const horizontal = clamp((gamma - baseline.gamma) / 22);
    const vertical = clamp((((beta - baseline.beta + 540) % 360) - 180) / 22);
    const radians = angle * Math.PI / 180;
    return { x: clamp(horizontal * Math.cos(radians) + vertical * Math.sin(radians)), y: clamp(vertical * Math.cos(radians) - horizontal * Math.sin(radians)) };
  }
  const api = { clamp, pointerPosition, layerTransform, fitSize, orientationPosition };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SceneMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
