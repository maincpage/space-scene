const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../layer-clip.js'), K = require('../layer-mask.js'), S = require('../scene-package.js');
const layers = () => ['01.png', '02.png', '03.png', '04.png', '05.png'].map(id => ({ id }));
test('任意图层可剪贴至另一层，支持隐藏目标与多级引用，禁止循环及悬空引用', () => {
  const list = layers(); list[1].clipTo = '04.png'; list[3].clipTo = '03.png'; list[3].visible = false;
  assert.doesNotThrow(() => C.validate(list)); assert.equal(C.canClip(list, '03.png', '02.png'), false);
  assert.equal(C.canClip(list, '04.png', '02.png'), false); assert.equal(C.canClip(list, '04.png', null), true);
  assert.equal(C.canClip(list, '02.png', '02.png'), false); assert.equal(C.canClip(list, '02.png', '99.png'), false);
  list[2].clipTo = '02.png'; assert.throws(() => C.validate(list), /循环/);
});
test('图片蒙版校验尺寸、灰度字节长度，撤销快照共享只读图片并独立保存笔画', () => {
  const image = { width: 2, height: 2, data: Buffer.from([0, 54, 128, 255]).toString('base64') };
  const mask = K.read({ ...K.defaults(), image }), copy = K.read(mask);
  assert.equal(copy.image, mask.image); assert.ok(Object.isFrozen(mask.image));
  K.invert(copy); assert.equal(copy.base, 0); assert.equal(mask.base, 1);
  for (const bad of [{ ...image, width: 2049 }, { ...image, height: 0 }, { ...image, data: 'AAAA' }, { ...image, data: 'AAAAAA==' + 'A' }, { ...image, data: '@AAAAA==' }]) assert.throws(() => K.read({ ...K.defaults(), image: bad }), /蒙版图片/);
});
test('场景 PNG 同时保留剪贴关系与图片蒙版，拒绝有循环关系的场景', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64'), src = 'data:image/png;base64,' + png.toString('base64');
  const data = { format: 'spatial-scene', version: 1, title: '剪贴', width: 1, height: 1, strength: 60, enabled: true, overview: src, layers: layers().map(layer => ({ ...layer, src, depth: .5, visible: true })) };
  data.layers[1].clipTo = '04.png'; data.layers[1].mask = { ...K.defaults(), image: { width: 1, height: 1, data: 'gA==' } };
  assert.deepEqual(S.extract(S.embed(png, data)), data);
  data.layers[3].clipTo = '02.png'; assert.throws(() => S.validate(data), /循环/);
});
