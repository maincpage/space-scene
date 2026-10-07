const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../mesh-math.js');
const { layerTransform } = require('../scene-math.js');
test('未设置变形时与原有平面视差一致', () => {
  const deform = M.defaults();
  for (const [x, y] of [[-1, 1], [0, 0], [.2, -.7]]) for (const strength of [0, 50, 100]) {
    const p = M.project(.2, .7, M.field(.2, .7, deform), .8, 0, { x, y, strength });
    const t = layerTransform(x, y, .8, strength, 1000, 500);
    assert.ok(Math.abs(p.x - (.5 + (.2 - .5) * t.scale + t.x / 1000)) < 1e-9);
    assert.ok(Math.abs(p.y - (.5 + (.7 - .5) * t.scale + t.y / 500)) < 1e-9);
  }
});
test('多个钉点在任意视角与最大变形下固定，远处仍然运动', () => {
  const d = M.defaults(); d.volume = 1; d.bend = 1; d.pins = [{ x: .137, y: .273 }, { x: .78, y: .19 }]; d.relief.fill(1);
  for (const aspect of [.5, 1, 2]) for (const x of [-1, 0, 1]) for (const y of [-1, 1]) {
    const mesh = M.buildMesh(d, aspect);
    for (const pin of d.pins) {
      const node = mesh.nodes.find(n => n.u === pin.x && n.v === pin.y); assert.ok(node, 'pin must be an actual vertex');
      assert.deepEqual(M.project(pin.x, pin.y, node, 1, 1, { x, y, strength: 100, wave: 1, aspect }), pin);
    }
    const p = M.project(.8, .8, M.field(.8, .8, d, aspect), 1, 1, { x, y, strength: 100, aspect });
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); assert.notDeepEqual(p, { x: .8, y: .8 });
  }
});
test('平面关闭视差时完整复原，体积起伏使同层不同位置位移不同', () => {
  const d = M.defaults(); d.volume = .9; d.bend = .8; d.pins = [{ x: .15, y: .12 }];
  for (const [u, v] of [[0, 0], [.5, .5], [1, 1]]) assert.deepEqual(M.project(u, v, M.field(u, v, d), 1, 1, { x: 1, y: 1, strength: 0 }), { x: u, y: v });
  const center = M.project(.5, .5, M.field(.5, .5, d), .5, 0, { x: 1, y: 0, strength: 100 });
  const flat = M.project(.5, .5, M.field(.5, .5, M.defaults()), .5, 0, { x: 1, y: 0, strength: 100 });
  assert.ok(center.x < flat.x);
});
test('画笔局部写入、擦平及越界值限制，其他图层不受影响', () => {
  const a = M.defaults(), b = M.defaults();
  M.paint(a.relief, .5, .5, .2, 1);
  assert.equal(M.sample(a.relief, .5, .5), 1); assert.equal(M.sample(a.relief, 0, 0), 0);
  assert.equal(M.sample(b.relief, .5, .5), 0);
  M.paint(a.relief, .5, .5, .2, .1, true); assert.ok(M.sample(a.relief, .5, .5) < 1);
  for (let i = 0; i < 40; i++) M.paint(a.relief, .5, .5, .3, -.2);
  assert.ok(a.relief.every(n => n >= -1 && n <= 1));
});
test('保存读回独立复制并拒绝错误钉点和画笔数据；旧参数可迁移', () => {
  const d = M.defaults(); d.pins.push({ x: .4, y: .5 });
  const loaded = M.readDeform(JSON.parse(JSON.stringify(d))); loaded.pins[0].x = .9;
  assert.equal(d.pins[0].x, .4); assert.deepEqual(M.readDeform(undefined), M.defaults());
  assert.throws(() => M.readDeform({ ...d, pins: [{ x: NaN, y: .2 }] }));
  assert.throws(() => M.readDeform({ ...d, pins: Array(13).fill({ x: 0, y: 0 }) }));
  assert.throws(() => M.readDeform({ ...d, relief: [0, 1] }));
  assert.throws(() => M.readDeform({ ...d, relief: Array(M.GRID * M.GRID).fill(2) }));
});
