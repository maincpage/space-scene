// Optional interaction and GPU rendering tests; same Playwright setup as browser-smoke.cjs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../server.cjs');

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-deform-check-'));
  const projectsRoot = path.join(temporary, '图'); await fs.mkdir(projectsRoot);
  await fs.cp(path.join(__dirname, '..', '图', 'try01'), path.join(projectsRoot, '测试场景'), { recursive: true });
  const server = createServer({ projectsRoot }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const open = async () => {
      await page.getByRole('button', { name: '测试场景', exact: false }).click();
      await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '5' && !document.querySelector('#createProject').disabled);
    };
    await open();
    assert.equal(await page.locator('#meshCanvas').isVisible(), true, await page.locator('#rendererStatus').textContent());
    await page.getByRole('button', { name: '编辑 04.png 的钉子与变形', exact: true }).click();
    assert.equal(await page.locator('#editOverlay').isVisible(), true);
    const point = async (u, v) => { const r = await page.locator('#editOverlay').boundingBox(); return { x: r.x + r.width * u, y: r.y + r.height * v }; };
    const click = async (u, v) => { const p = await point(u, v); await page.mouse.click(p.x, p.y); };
    const config = () => page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.startsWith('spatial-scene:v3:'))[1]));
    const deform = async (id = '04.png') => (await config()).layers.find(l => l.id === id).deform;
    await click(.37, .23); await click(.6, .52);
    assert.equal((await deform()).pins.length, 2); assert.equal((await deform('01.png')).pins.length, 0);
    const from = await point(.6, .52), to = await point(.64, .56);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    assert.ok(Math.abs((await deform()).pins[1].x - .64) < .002);
    await page.locator('#undoDeform').click(); assert.ok(Math.abs((await deform()).pins[1].x - .6) < .002);
    await page.locator('#pinList').getByRole('button', { name: '钉点 2', exact: true }).click();
    await page.locator('#editOverlay').press('Delete'); assert.equal((await deform()).pins.length, 1);
    await page.locator('#undoDeform').click(); assert.equal((await deform()).pins.length, 2);
    console.log('PASS add, drag, delete and undo pins; independent layer state');

    await page.getByRole('button', { name: '凸起', exact: true }).click(); await click(.5, .4);
    assert.ok((await deform()).relief.some(n => n > 0));
    await page.getByRole('button', { name: '凹陷', exact: true }).click(); await click(.5, .8);
    assert.ok((await deform()).relief.some(n => n < 0));
    await page.getByRole('button', { name: '柔软', exact: true }).click(); assert.equal((await deform()).bend, .75);
    await page.locator('#editLayer').selectOption('02.png'); assert.equal(await page.locator('#pinTotal').textContent(), '0 / 12');
    await page.locator('#editLayer').selectOption('04.png'); assert.equal(await page.locator('#pinTotal').textContent(), '2 / 12');
    await page.screenshot({ path: path.join(temporary, 'editor.png'), fullPage: true });
    await page.locator('#editMesh').click(); assert.equal(await page.locator('#editOverlay').isVisible(), false);
    await page.getByRole('button', { name: '自动播放', exact: true }).click();
    const viewA = await page.locator('#meshCanvas').screenshot();
    await page.waitForFunction(() => document.querySelector('#coordinates').textContent.includes('X 0.') || document.querySelector('#coordinates').textContent.includes('X -0.'));
    const viewB = await page.locator('#meshCanvas').screenshot(); assert.notDeepEqual(viewA, viewB);
    console.log('PASS relief painting, presets, selection and animated canvas');

    const downloadEvent = page.waitForEvent('download'); await page.locator('#exportConfig').click();
    const download = await downloadEvent; const exportedPath = path.join(temporary, 'parameters.json'); await download.saveAs(exportedPath);
    const saved = JSON.parse(await fs.readFile(exportedPath, 'utf8')); assert.equal(saved.version, 3); assert.equal(saved.layers.find(l => l.id === '04.png').deform.pins.length, 2);
    await page.reload(); await open();
    await page.getByRole('button', { name: '编辑 04.png 的钉子与变形', exact: true }).click();
    assert.equal(await page.locator('#pinTotal').textContent(), '2 / 12'); assert.equal(await page.locator('#bend').inputValue(), '75');
    await page.locator('#resetDeform').click(); assert.equal((await deform()).pins.length, 0);
    await page.locator('#configInput').setInputFiles(exportedPath);
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '已载入场景配置。');
    assert.equal((await deform()).pins.length, 2);
    const corrupt = structuredClone(saved); corrupt.layers[3].deform.pins[0].x = -2;
    await page.locator('#configInput').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corrupt)) });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('钉点或变形参数无效'));
    assert.deepEqual((await deform()).pins, saved.layers[3].deform.pins);
    console.log('PASS persistence, export/import and atomic invalid-config rejection');

    const gpu = await page.evaluate(async () => {
      const source = document.createElement('canvas'); source.width = source.height = 128; const ctx = source.getContext('2d');
      ctx.fillStyle = '#305070'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#ff00ff'; ctx.fillRect(46, 46, 10, 10); ctx.fillStyle = '#00ff00'; ctx.fillRect(94, 94, 8, 8);
      const image = new Image(); image.src = source.toDataURL(); await image.decode();
      const canvas = document.createElement('canvas'), renderer = new MeshRenderer(canvas, () => {});
      const d = MeshMath.defaults(); d.pins = [{ x: .4, y: .4 }]; d.volume = .8; d.bend = .75;
      const layer = { id: 'test', element: image, depth: 1, visible: true, deform: d };
      renderer.setLayers([layer], 1);
      function read(x) {
        renderer.render([layer], { x, y: x, strength: 100, width: 128, height: 128, aspect: 1 });
        const pixel = new Uint8Array(4); renderer.gl.readPixels(51, 76, 1, 1, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixel);
        const all = new Uint8Array(128 * 128 * 4); renderer.gl.readPixels(0, 0, 128, 128, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, all);
        return { pin: [...pixel], all: [...all] };
      }
      const a = read(-1), b = read(1); const result = { available: renderer.available, a: a.pin, b: b.pin, changed: a.all.filter((n, i) => n !== b.all[i]).length, error: renderer.gl.getError() };
      renderer.clear(); renderer.gl.getExtension('WEBGL_lose_context')?.loseContext(); return result;
    });
    assert.equal(gpu.available, true); assert.equal(gpu.error, 0); assert.deepEqual(gpu.a, [255, 0, 255, 255]); assert.deepEqual(gpu.b, gpu.a); assert.ok(gpu.changed > 300);
    console.log('PASS GPU pixels: anchor stays fixed while other pixels deform');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '编辑 04.png 的钉子与变形', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#editOverlay').scrollIntoViewIfNeeded();
    // Use a native touch tap so pointer capture follows the browser's real input path.
    const mobilePoint = await point(.25, .5);
    await page.touchscreen.tap(mobilePoint.x, mobilePoint.y);
    assert.equal((await deform()).pins.length, 3);
    await page.screenshot({ path: path.join(temporary, 'mobile-editor.png'), fullPage: true });
    await page.locator('#finishEdit').click(); assert.equal(await page.locator('#editOverlay').isVisible(), false);
    const legacy = { ...saved, version: 2, layers: saved.layers.map(({ deform, ...rest }) => rest) };
    await page.locator('#configInput').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '已载入场景配置。');
    assert.ok((await config()).layers.every(l => l.deform.pins.length === 0));
    assert.deepEqual(errors, []);
    console.log('PASS mobile layout and legacy parameter migration');
    await page.evaluate(() => document.querySelector('#meshCanvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext());
    await page.waitForFunction(() => document.querySelector('#meshCanvas').hidden);
    assert.equal(await page.locator('#scenePlane').isVisible(), true);
    assert.equal(await page.locator('#editMesh').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS GPU context-loss fallback keeps the scene usable');
    console.log(`Screenshots: ${temporary}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(projectsRoot), temporary); assert.ok(path.basename(temporary).startsWith('spatial-deform-check-'));
    await fs.rm(projectsRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
