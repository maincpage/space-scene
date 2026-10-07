const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareFiles } = require('../image-files.js');
const file = (name, size = 100, lastModified = 1) => ({ name, size, lastModified });
test('00 是独立整图，图层按数字从低到高排列', () => {
  const result = prepareFiles([file('10.png'), file('02.png'), file('00.png'), file('01.png')]);
  assert.equal(result.overview.name, '00.png');
  assert.deepEqual(result.layers.map(f => f.name), ['01.png', '02.png', '10.png']);
});
test('非 PNG、不规范命名、缺少整图或底层会被拒绝', () => {
  for (const name of ['1.png', 'preview.png', '00.jpg', '02.PNG', '../02.png']) {
    assert.throws(() => prepareFiles([file('00.png'), file('01.png'), file(name)]), /两位数字/);
  }
  assert.throws(() => prepareFiles([file('01.png'), file('02.png')]), /必须包含/);
  assert.throws(() => prepareFiles([file('00.png'), file('02.png')]), /必须包含/);
});
test('整图加一个图层也可使用；不能混入子文件夹', () => {
  assert.equal(prepareFiles([file('00.png'), file('01.png')]).layers.length, 1);
  assert.throws(() => prepareFiles([{ ...file('00.png'), webkitRelativePath: 'a/00.png' }, { ...file('01.png'), webkitRelativePath: 'a/b/01.png' }]), /子文件夹/);
});
test('同名的新素材不会复用另一组素材的缓存参数', () => {
  const a = prepareFiles([file('00.png'), file('01.png')]);
  const b = prepareFiles([file('00.png', 200), file('01.png', 300)]);
  assert.notEqual(a.id, b.id);
});
test('重复文件名、缺少图层、过多和过大文件组会被拒绝', () => {
  assert.throws(() => prepareFiles([file('00.png'), file('00.png')]), /不能重复/);
  assert.throws(() => prepareFiles([file('00.png')]), /1～20/);
  assert.throws(() => prepareFiles(Array.from({ length: 22 }, (_, i) => file(`${String(i).padStart(2, '0')}.png`))), /1～20/);
  assert.throws(() => prepareFiles([file('00.png', 0), file('01.png')]), /为空/);
  assert.throws(() => prepareFiles([file('00.png', 160*1024*1024), file('01.png')]), /150 MB/);
});
