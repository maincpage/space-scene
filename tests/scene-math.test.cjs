const test = require('node:test');
const assert = require('node:assert/strict');
const { pointerPosition, layerTransform, fitSize, orientationPosition } = require('../scene-math.js');
test('越近的图层位移越大，同时保持原始画布对齐', () => {
  const near = layerTransform(1, -.5, 1, 60, 600);
  const far = layerTransform(1, -.5, 0, 60, 600);
  assert.ok(Math.abs(near.x) > Math.abs(far.x) * 5);
  assert.equal(near.scale, far.scale);
  assert.equal(near.y, -near.x / 2);
});
test('平面模式恢复原始比例、零位移', () => {
  for (const depth of [0, .5, 1]) { const t = layerTransform(1, 1, depth, 0, 600); assert.ok(t.x === 0 && t.y === 0); assert.equal(t.scale, 1); }
});
test('最大视差不会超过缩放预留的画布边缘', () => {
  for (const strength of [1, 60, 100]) for (const [width, height] of [[200, 800], [1600, 400], [500, 500]]) {
    const t = layerTransform(99, -99, 1, strength, width, height);
    assert.ok(Math.abs(t.x) <= width * (t.scale - 1) / 2);
    assert.ok(Math.abs(t.y) <= height * (t.scale - 1) / 2);
  }
});
test('窗口尺寸变化仍完整显示原画比例', () => {
  for (const aspect of [0.7, 1, 2.5]) for (const [w, h] of [[300, 500], [1200, 500], [1, 1]]) {
    const fit = fitSize(w, h, aspect);
    assert.ok(fit.width <= w && fit.height <= h + 1e-10);
    assert.ok(Math.abs(fit.width / fit.height - aspect) < 1e-10);
  }
});
test('指针归一化并限制边界', () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 };
  assert.deepEqual(pointerPosition(200, 250, rect), { x: 0, y: 0 });
  assert.deepEqual(pointerPosition(-999, 999, rect), { x: -1, y: 1 });
});
test('手机以初始握持角度为中心，横屏时映射正确', () => {
  const base = { beta: 50, gamma: 8 };
  assert.deepEqual(orientationPosition(50, 8, base), { x: 0, y: 0 });
  assert.equal(orientationPosition(50, 30, base).x, 1);
  const rotated = orientationPosition(72, 8, base, 90);
  assert.ok(Math.abs(rotated.x - 1) < 1e-10 && Math.abs(rotated.y) < 1e-10);
});
test('俯仰角跨过正负 180 度时保持连续', () => {
  assert.ok(Math.abs(orientationPosition(-179, 0, { beta: 179, gamma: 0 }).y - 2 / 22) < 1e-10);
  assert.ok(Math.abs(orientationPosition(179, 0, { beta: -179, gamma: 0 }).y + 2 / 22) < 1e-10);
});
