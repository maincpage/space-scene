const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scene-package.js');
const M = require('../mesh-math.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
const src = 'data:image/png;base64,' + png.toString('base64');
function packet() { return { format: 'spatial-scene', version: 1, title: '中文 场景', width: 1, height: 1, enabled: true, strength: 67, overview: src, layers: [{ id: '01.png', src, depth: .6, visible: false, deform: { ...M.defaults(), pins: [{ x: .2, y: .3 }], bend: .7 } }] }; }
test('场景 PNG 保留原图像数据，并完整往返图层、钉点和参数', () => {
  const data = packet(), result = S.embed(png, data);
  assert.deepEqual(S.extract(result), data);
  assert.deepEqual(result.subarray(0, png.length - 12), new Uint8Array(png.subarray(0, -12)));
  assert.equal(S.extract(png), null);
  const again = S.embed(result, { ...data, title: '重新打包' }); assert.equal(S.extract(again).title, '重新打包');
});
test('损坏或截断的数据不能作为场景导入', () => {
  const result = S.embed(png, packet()); result[png.length + 30] ^= 1;
  assert.throws(() => S.extract(result), /损坏/);
  assert.throws(() => S.extract(result.subarray(0, -5)), /不完整/);
  assert.throws(() => S.extract(Buffer.from('not png')), /PNG/);
});
test('拒绝外部资源、非法文件名、重复图层、错误尺寸和无效变形', () => {
  for (const bad of [
    { ...packet(), overview: 'https://example.com/image.png' },
    { ...packet(), width: 0 },
    { ...packet(), layers: [{ ...packet().layers[0], id: '../01.png' }] },
    { ...packet(), layers: [...packet().layers, ...packet().layers] },
    { ...packet(), layers: [{ ...packet().layers[0], deform: { ...M.defaults(), pins: [{ x: 2, y: 0 }] } }] }
  ]) assert.throws(() => S.validate(bad));
});
test('黑白背景和内嵌底图往返恢复，旧文件仍可读取，外部底图被拒绝', () => {
  const B = require('../scene-background.js');
  assert.deepEqual(B.read(), { type: 'black' });
  for (const background of [{ type: 'black' }, { type: 'white' }, { type: 'image', src }]) {
    const data = { ...packet(), background }; assert.deepEqual(S.extract(S.embed(png, data)), data);
  }
  for (const background of [{ type: 'red' }, { type: 'image', src: 'https://example.com/bg.png' }, { type: 'image', src: 'data:image/png;base64,YQ==' }]) {
    assert.throws(() => S.validate({ ...packet(), background }));
  }
});
