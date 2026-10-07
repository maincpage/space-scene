const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../layer-mask.js');
const S = require('../scene-package.js');
const stroke = () => ({ mode: 'hide', radius: .12, hardness: .7, opacity: 1, points: [[.25, .4], [.7, .6]] });
test('旧参数无蒙版；独立复制蒙版，反相两次恢复原始数据', () => {
  assert.equal(K.read(), null); assert.equal(K.read(null), null);
  const mask = { ...K.defaults(), strokes: [stroke()] }, copy = K.read(mask);
  K.invert(copy); assert.equal(copy.base, 0); assert.equal(copy.strokes[0].mode, 'reveal');
  assert.equal(mask.strokes[0].mode, 'hide'); K.invert(copy); assert.deepEqual(copy, mask);
  copy.strokes[0].points[0][0] = .9; assert.equal(mask.strokes[0].points[0][0], .25);
});
test('拒绝无效蒙版、笔刷参数、坐标和过量笔画', () => {
  for (const mask of [false, {}, { ...K.defaults(), enabled: 'true' }, { ...K.defaults(), base: .5 },
    ...[{ mode: 'invalid' }, { radius: 0 }, { radius: Infinity }, { hardness: -1 }, { opacity: 0 }, { points: [] }, { points: [[2, .5]] }, { points: [[NaN, .5]] }, { points: Array(K.MAX_POINTS + 1).fill([.1, .2]) }].map(bad => ({ ...K.defaults(), strokes: [{ ...stroke(), ...bad }] })),
    { ...K.defaults(), strokes: Array(K.MAX_STROKES + 1).fill(stroke()) }
  ]) assert.throws(() => K.read(mask), /蒙版/);
});
test('场景 PNG 保留可编辑蒙版，损坏蒙版不能进入导入流程', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
  const src = 'data:image/png;base64,' + png.toString('base64');
  const data = { format: 'spatial-scene', version: 1, title: '蒙版', width: 1, height: 1, enabled: true, strength: 60, overview: src, layers: [{ id: '01.png', src, depth: 0, visible: true, mask: { ...K.defaults(), enabled: false, strokes: [stroke()] } }] };
  assert.deepEqual(S.extract(S.embed(png, data)), data);
  data.layers[0].mask.strokes[0].points[0] = [-1, 0]; assert.throws(() => S.validate(data), /蒙版/);
});
