'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SceneMath = require('../scene-math.js');
function fixture({ secure = true, supported = true, permission } = {}) {
  const window = new EventTarget(), document = new EventTarget(), orientation = new EventTarget();
  const timers = new Map(), positions = [], statuses = []; let nextTimer = 0, permissionCalls = 0;
  Object.assign(document, { hidden: false }); orientation.angle = 0;
  Object.assign(window, { document, screen: { orientation }, isSecureContext: secure, SceneMath,
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) });
  if (supported) window.DeviceOrientationEvent = {};
  if (permission) window.DeviceOrientationEvent.requestPermission = () => { permissionCalls++; return permission(); };
  vm.runInNewContext(fs.readFileSync(require.resolve('../scene-tilt.js'), 'utf8'), { window });
  const tilt = window.SceneTilt.create({ onPosition: p => positions.push(p), onStatus: s => statuses.push(s) });
  return { tilt, positions, statuses, window, document, orientation, timers,
    get permissionCalls() { return permissionCalls; },
    send: (beta, gamma) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma })) };
}
test('无弹窗浏览器自动接入；首个有效读数校准，关闭后不再接收', async () => {
  const f = fixture(); assert.equal(await f.tilt.start(), true);
  f.send(null, null); assert.equal(f.tilt.status, 'waiting');
  f.send(50, 5); assert.deepEqual(f.positions.at(-1), { x: 0, y: 0 }); assert.equal(f.timers.size, 0);
  f.send(61, 16); assert.deepEqual(f.positions.at(-1), { x: .5, y: .5 });
  f.tilt.stop(); const count = f.positions.length; f.send(72, 27); assert.equal(f.positions.length, count);
});
test('必须点击才能请求权限，拒绝后允许重试', async () => {
  let allowed = false;
  const f = fixture({ permission: async () => allowed ? 'granted' : 'denied' });
  assert.equal(await f.tilt.start(), false); assert.equal(f.tilt.status, 'permission'); assert.equal(f.permissionCalls, 0);
  assert.equal(await f.tilt.start({ requestPermission: true }), false); assert.equal(f.tilt.status, 'denied');
  allowed = true; assert.equal(await f.tilt.start({ requestPermission: true }), true); f.send(0, 0); assert.equal(f.tilt.status, 'active');
});
test('授权尚未返回时切换模式，不会被迟到的授权重新打开', async () => {
  let resolve; const f = fixture({ permission: () => new Promise(r => { resolve = r; }) });
  const pending = f.tilt.start({ requestPermission: true }); assert.equal(f.permissionCalls, 1);
  f.tilt.stop(); resolve('granted'); assert.equal(await pending, false); assert.equal(f.tilt.running, false);
});
test('HTTP、不支持、权限异常与无数据都安全回退', async () => {
  for (const [options, status] of [[{ secure: false }, 'insecure'], [{ supported: false }, 'unsupported'], [{ permission: () => { throw new Error('blocked'); } }, 'denied']]) {
    const f = fixture(options); assert.equal(await f.tilt.start({ requestPermission: true }), false); assert.equal(f.tilt.status, status);
  }
  const f = fixture(); await f.tilt.start(); f.send(null, null);
  [...f.timers.values()][0](); assert.equal(f.tilt.status, 'unavailable'); assert.equal(f.tilt.running, false);
  const count = f.positions.length; f.send(0, 0); assert.equal(f.positions.length, count);
});
test('横竖屏切换、回正和回到前台均重新校准', async () => {
  const f = fixture(); await f.tilt.start(); f.send(50, 0); f.send(61, 11);
  f.orientation.angle = 90; f.orientation.dispatchEvent(new Event('change')); f.send(70, 10);
  assert.equal(f.positions.at(-1).x, 0); assert.equal(f.positions.at(-1).y, 0);
  f.send(81, 10); assert.ok(Math.abs(f.positions.at(-1).x - .5) < 1e-10);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  const count = f.positions.length; f.send(-70, -60); assert.equal(f.positions.length, count);
  f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange')); f.send(-70, -60);
  assert.equal(f.positions.at(-1).x, 0); assert.equal(f.positions.at(-1).y, 0);
  f.tilt.recenter(); f.send(0, 0); assert.equal(f.positions.at(-1).x, 0);
});
