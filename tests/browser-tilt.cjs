'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { createServer } = require('../server.cjs');

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-tilt-check-'));
  const server = createServer({ projectsRoot: path.join(temporary, 'projects') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const errors = [];
  async function open(url, permission = 'automatic', extra = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...extra });
    await context.addInitScript(({ permission, touch }) => {
      // Older Edge retains the host's touch count even with hasTouch: false.
      if (touch === false) Object.defineProperty(navigator, 'maxTouchPoints', { value: 0 });
      window.permissionCalls = 0;
      class Orientation extends Event {}
      if (permission !== 'automatic') Orientation.requestPermission = () => {
        window.permissionCalls++; window.hadActivation = navigator.userActivation.isActive;
        return permission === 'pending' ? new Promise(resolve => { window.finishPermission = resolve; }) : Promise.resolve(permission === 'timeout' ? 'granted' : permission);
      };
      Object.defineProperty(window, 'DeviceOrientationEvent', { value: Orientation, configurable: true });
      if (permission === 'insecure') Object.defineProperty(window, 'isSecureContext', { value: false });
      if (permission === 'timeout') {
        const schedule = window.setTimeout;
        window.setTimeout = (fn, delay, ...args) => schedule(fn, delay === 5000 ? 150 : delay, ...args);
      }
      // Observe the actual renderer inputs while still rendering the real WebGL pixels.
      let Renderer;
      Object.defineProperty(window, 'MeshRenderer', { configurable: true, get: () => Renderer, set: value => {
        Renderer = value; const render = value.prototype.render;
        value.prototype.render = function (layers, params) { window.lastRender = params; return render.call(this, layers, params); };
      } });
    }, { permission, touch: extra.hasTouch });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(url); return page;
  }
  async function send(page, beta, gamma) {
    await page.evaluate(({ beta, gamma }) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma })), { beta, gamma });
  }
  async function tiltRight(page) {
    await send(page, 50, 0); await send(page, 50, 11);
    await page.waitForFunction(() => window.lastRender?.x > .45);
  }
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const editor = await open(base);
    const src = await editor.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#cf6430'; ctx.fillRect(30, 30, 68, 68); return canvas.toDataURL();
    });
    const files = ['00.png', '01.png'].map(name => ({ name, mimeType: 'image/png', buffer: Buffer.from(src.split(',')[1], 'base64') }));
    async function importScene(page) { await page.locator('#imageInput').setInputFiles(files); await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '1'); }
    await importScene(editor); await tiltRight(editor);
    assert.equal(await editor.locator('#sensor').getAttribute('aria-pressed'), 'true');
    const box = await editor.locator('#stage').boundingBox();
    await editor.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await tiltRight(editor); assert.equal(await editor.locator('#sensor').getAttribute('aria-pressed'), 'true');
    await editor.locator('#recenter').click(); await send(editor, 70, 20);
    await editor.waitForFunction(() => Math.abs(window.lastRender.x) < .02);
    await editor.getByRole('button', { name: '编辑 01.png 的钉子与变形', exact: true }).click();
    await send(editor, 50, -40); assert.equal(await editor.locator('#sensor').getAttribute('aria-pressed'), 'false');
    console.log('PASS editor automatic tilt, drag recovery, recenter and editing isolation');

    const html = await editor.evaluate(src => SceneExport.html({ format: 'spatial-scene', version: 1, title: '倾斜测试', width: 128, height: 128, enabled: true, strength: 60, overview: src, layers: [{ id: '01.png', depth: 1, visible: true, src }] }), src);
    const htmlPath = path.join(temporary, 'tilt.html'); await fs.writeFile(htmlPath, html);
    const url = pathToFileURL(htmlPath).href;
    const player = await open(url, 'granted', { offline: true });
    await player.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
    assert.equal(await player.evaluate(() => permissionCalls), 0);
    assert.equal(await player.locator('#sensor').getAttribute('data-state'), 'permission');
    await player.locator('#sensor').tap();
    assert.equal(await player.evaluate(() => permissionCalls === 1 && hadActivation), true);
    await send(player, 50, 0); await player.waitForFunction(() => Math.abs(window.lastRender.x) < .02);
    const centered = await player.locator('#canvas').screenshot(); await tiltRight(player);
    assert.notDeepEqual(await player.locator('#canvas').screenshot(), centered);
    const touch = await player.context().newCDPSession(player);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 400 }] });
    await send(player, 50, 22);
    await player.waitForFunction(() => window.lastRender.x < -.5);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await player.touchscreen.tap(100, 150); await tiltRight(player);
    assert.equal(await player.locator('#sensor').getAttribute('aria-pressed'), 'true');
    await player.evaluate(() => { Object.defineProperty(screen.orientation, 'angle', { configurable: true, value: 90 }); screen.orientation.dispatchEvent(new Event('change')); });
    await send(player, 70, 20); await player.waitForFunction(() => Math.abs(window.lastRender.x) < .02);
    await send(player, 81, 20); await player.waitForFunction(() => window.lastRender.x > .45 && Math.abs(window.lastRender.y) < .02);
    await player.touchscreen.tap(10, 10); await player.locator('#compare').tap(); assert.equal(await player.locator('.overview').isVisible(), true);
    await player.locator('#compare').tap(); assert.equal(await player.locator('#canvas').isVisible(), true);
    await player.screenshot({ path: path.join(temporary, 'mobile-tilt.png') });
    assert.equal(await player.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
    console.log('PASS offline exported HTML, click permission, tilt changes pixels, touch recovery, landscape and comparison');

    for (const permission of ['denied', 'insecure', 'timeout']) {
      const page = await open(url, permission);
      await page.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
      if (permission !== 'insecure') await page.locator('#sensor').tap();
      const expected = permission === 'timeout' ? 'unavailable' : permission;
      await page.waitForFunction(expected => document.querySelector('#sensor').dataset.state === expected, expected);
      assert.equal(await page.locator('#sensor').getAttribute('aria-pressed'), 'false');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] });
      await page.waitForFunction(() => window.lastRender.x > .45);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.context().close();
    }
    const reduced = await open(url, 'automatic', { reducedMotion: 'reduce' });
    await reduced.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
    await send(reduced, 0, 0); await send(reduced, 0, 22);
    assert.equal(await reduced.evaluate(() => window.lastRender.x), 0);
    await reduced.locator('#sensor').tap(); await tiltRight(reduced);
    const desktop = await open(url, 'automatic', { hasTouch: false, isMobile: false });
    await desktop.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
    assert.equal(await desktop.locator('#sensor').isVisible(), false);
    const pending = await open(base, 'pending'); await importScene(pending);
    await pending.locator('#sensor').click(); await pending.locator('[data-mode="pointer"]').click();
    await pending.evaluate(() => finishPermission('granted')); await send(pending, 0, 0); await send(pending, 0, 22);
    assert.equal(await pending.locator('#sensor').getAttribute('aria-pressed'), 'false');
    console.log('PASS rejected permission, insecure context, sensor timeout, drag fallback and cancelled permission');
    assert.deepEqual(errors, []); console.log(`Artifacts: ${temporary}`);
  } finally {
    await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
