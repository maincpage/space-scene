'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { createServer } = require('../server.cjs');
const S = require('../scene-package.js');

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-mask-check-'));
  const projectsRoot = path.join(temporary, '图'); await fs.mkdir(projectsRoot);
  const server = createServer({ projectsRoot }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const fixtures = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 384;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1450c8'; ctx.fillRect(0, 0, 256, 384); const base = canvas.toDataURL();
      ctx.fillStyle = '#f02850'; ctx.fillRect(20, 20, 216, 344); const overview = canvas.toDataURL();
      ctx.clearRect(0, 0, 256, 384); ctx.fillRect(20, 20, 216, 344);
      return { base, overview, top: canvas.toDataURL() };
    });
    const project = path.join(projectsRoot, '蒙版测试'); await fs.mkdir(project);
    for (const [name, src] of [['00.png', fixtures.overview], ['01.png', fixtures.base], ['02.png', fixtures.top]]) await fs.writeFile(path.join(project, name), Buffer.from(src.split(',')[1], 'base64'));
    await page.locator('#refreshProjects').click();
    const open = async () => {
      await page.getByRole('button', { name: '蒙版测试', exact: false }).click();
      await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '2' && !document.querySelector('#createProject').disabled);
    };
    await open();
    const config = () => page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.startsWith('spatial-scene:v3:project:'))[1]));
    const mask = async (id = '02.png') => (await config()).layers.find(l => l.id === id).mask;
    const point = async (u, v) => { const r = await page.locator('#editOverlay').boundingBox(); return { x: r.x + r.width * u, y: r.y + r.height * v }; };
    const paint = async (u, v) => { const p = await point(u, v); await page.mouse.click(p.x, p.y); };
    const range = async (id, value) => page.locator('#' + id).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    const pixel = (target, u = .5, v = .5, id = 'meshCanvas') => target.evaluate(({ u, v, id }) => new Promise(resolve => requestAnimationFrame(() => {
      const canvas = document.getElementById(id), gl = canvas.getContext('webgl'), data = new Uint8Array(4);
      gl.readPixels(Math.floor(u * canvas.width), Math.floor((1 - v) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data); resolve([...data]);
    })), { u, v, id });
    const red = [240, 40, 80, 255], blue = [20, 80, 200, 255];
    await page.getByRole('button', { name: '编辑 02.png 的蒙版', exact: true }).click();
    assert.equal(await page.locator('#maskSection').isVisible(), true);
    await range('maskSize', 30); await range('maskHardness', 100);
    await paint(.5, .5); assert.deepEqual(await pixel(page), blue); assert.deepEqual(await pixel(page, .2, .2), red);
    assert.equal((await mask()).strokes.length, 1); assert.equal(await mask('01.png'), undefined);
    await page.locator('#editOverlay').press('x'); await paint(.5, .5); assert.deepEqual(await pixel(page), red);
    await page.locator('#editOverlay').press('Control+z'); assert.deepEqual(await pixel(page), blue);
    await page.locator('#maskEnabled').uncheck(); assert.deepEqual(await pixel(page), red);
    await page.locator('#undoMask').click(); assert.deepEqual(await pixel(page), blue);
    await page.locator('#maskInvert').click(); assert.deepEqual(await pixel(page), red); assert.deepEqual(await pixel(page, .2, .2), blue);
    await page.locator('#undoMask').click(); assert.deepEqual(await pixel(page), blue);
    await page.locator('#removeMask').click(); assert.deepEqual(await pixel(page), red);
    await page.locator('#undoMask').click(); assert.deepEqual(await pixel(page), blue);
    await page.locator('#maskHideAll').click(); assert.deepEqual(await pixel(page, .2, .2), blue);
    await page.locator('#undoMask').click(); assert.deepEqual(await pixel(page, .2, .2), red);
    console.log('PASS hide/reveal, independent layers, invert, disable/delete and undo with real GPU pixels');

    await page.locator('#maskLayer').selectOption('01.png'); await page.locator('#maskHideAll').click();
    assert.equal((await mask('01.png')).base, 0); assert.equal((await mask()).strokes.length, 1);
    await page.locator('#undoMask').click(); await page.locator('#maskLayer').selectOption('02.png');
    await page.locator('[data-mask-tool=hide]').click();
    await page.locator('#zoomIn').click(); await page.locator('#zoomIn').click();
    await paint(.55, .55); const last = (await mask()).strokes.at(-1).points[0]; assert.ok(Math.abs(last[0] - .55) < .003 && Math.abs(last[1] - .55) < .003);
    await page.locator('#fitView').click(); await page.locator('#maskRevealAll').click();
    await paint(.5, .5);
    await page.screenshot({ path: path.join(temporary, 'mask-desktop.png'), fullPage: true });
    await page.locator('#finishEdit').click(); await page.locator('#spatialToggle').click();
    const saved = await config(); await page.reload(); await open(); assert.deepEqual(await mask(), saved.layers[1].mask);
    console.log('PASS zoom-correct brush coordinates, separate undo per layer and reload persistence');

    const gpu = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'), renderer = new MeshRenderer(canvas, () => {});
      const source = document.createElement('canvas'); source.width = source.height = 256; source.getContext('2d').fillRect(0, 0, 256, 256);
      const image = new Image(); image.src = source.toDataURL(); await image.decode();
      const deform = { ...MeshMath.defaults(), volume: .8, bend: .75, pins: [{ x: .2, y: .2 }] };
      const mask = { ...LayerMask.defaults(), strokes: [{ mode: 'hide', radius: .045, hardness: 1, opacity: 1, points: [[.5, .5]] }] };
      const layer = { id: 'masked', element: image, depth: 1, visible: true, deform, mask }; renderer.setLayers([layer], 1);
      const values = [];
      for (const x of [-1, 1]) {
        const view = { x, y: x, strength: 100, width: 256, height: 256, pixelRatio: 1, aspect: 1 };
        renderer.render([layer], view);
        const p = MeshMath.project(.5, .5, MeshMath.field(.5, .5, deform, 1), 1, deform.bend, view), data = new Uint8Array(4);
        renderer.gl.readPixels(Math.round(p.x * 256), Math.round((1 - p.y) * 256), 1, 1, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, data); values.push(data[3]);
      }
      const error = renderer.gl.getError(); renderer.clear(); renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
      // Incremental preview must match replay after saving, including soft strokes and inversion.
      const soft = { ...LayerMask.defaults(), strokes: [{ mode: 'hide', radius: .2, hardness: .2, opacity: .4, points: [[.2, .3]] }] };
      LayerMask.canvas(soft, 1); soft.strokes[0].points.push([.5, .5]); LayerMask.canvas(soft, 1); soft.strokes[0].points.push([.7, .6]);
      const bytes = m => LayerMask.canvas(m, 1).getContext('2d').getImageData(0, 0, 2048, 2048).data;
      const a = bytes(soft), b = bytes(LayerMask.read(soft)); let difference = 0;
      for (let i = 3; i < a.length; i += 4) difference = Math.max(difference, Math.abs(a[i] - b[i]));
      LayerMask.invert(soft); const c = bytes(soft); let inverseError = 0;
      for (let i = 3; i < a.length; i += 4) inverseError = Math.max(inverseError, Math.abs(a[i] + c[i] - 255));
      return { values, error, difference, inverseError };
    });
    assert.deepEqual(gpu.values, [0, 0]); assert.equal(gpu.error, 0); assert.equal(gpu.difference, 0); assert.ok(gpu.inverseError <= 4, JSON.stringify(gpu));
    console.log('PASS mask follows deformed UVs; soft brush preview equals saved replay and inverted alpha');

    await page.locator('#openExport').click();
    const download = async id => {
      const pending = page.waitForEvent('download'); await page.locator('#' + id).click(); const file = await pending;
      const destination = path.join(temporary, file.suggestedFilename()); await file.saveAs(destination);
      await page.waitForFunction(() => !document.querySelector('#closeExport').disabled); return destination;
    };
    const html = await download('exportHTML'), scene = await download('exportScenePNG'), png = await download('exportPNG');
    const packet = S.extract(await fs.readFile(scene)); assert.deepEqual(packet.layers[1].mask, saved.layers[1].mask);
    const pngPixel = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode(); const c = document.createElement('canvas'); c.width = 256; c.height = 384;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(128, 192, 1, 1).data];
    }, 'data:image/png;base64,' + (await fs.readFile(png)).toString('base64'));
    assert.deepEqual(pngPixel, blue);
    const offline = await browser.newContext({ offline: true }); const player = await offline.newPage(); player.on('pageerror', e => errors.push(e.message));
    await player.goto(pathToFileURL(html).href); await player.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
    assert.deepEqual(await pixel(player, .5, .5, 'canvas'), blue); await offline.close();
    await page.locator('#closeExport').click();
    const parameterDownload = page.waitForEvent('download'); await page.locator('#exportConfig').click(); const parameters = await parameterDownload;
    const parameterPath = path.join(temporary, 'params.json'); await parameters.saveAs(parameterPath);
    await page.locator('#reset').click(); assert.equal(await mask(), undefined);
    await page.locator('#configInput').setInputFiles(parameterPath); await page.waitForFunction(() => document.querySelector('#toast').textContent === '已载入场景配置。');
    assert.deepEqual(await mask(), saved.layers[1].mask);
    const bad = JSON.parse(JSON.stringify(saved)); bad.layers[1].mask.strokes[0].points = [[-1, .5]];
    await page.locator('#configInput').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('蒙版笔画坐标无效')); assert.deepEqual(await mask(), saved.layers[1].mask);
    await page.locator('#guestMode').click(); let writes = 0; page.on('request', r => { if (['PUT', 'POST'].includes(r.method())) writes++; });
    await page.locator('#imageInput').setInputFiles(scene); await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('场景已恢复'));
    assert.equal(writes, 0);
    const restored = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.includes(':guest:'))[1]));
    assert.deepEqual(restored.layers[1].mask, packet.layers[1].mask);
    console.log('PASS static PNG pixels, offline HTML, scene PNG round-trip, JSON restore and atomic invalid-config rejection');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '编辑 02.png 的蒙版', exact: true }).click();
    await page.locator('#editOverlay').scrollIntoViewIfNeeded(); const touch = await point(.3, .3); await page.touchscreen.tap(touch.x, touch.y);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(temporary, 'mask-mobile.png'), fullPage: true });
    await page.locator('#finishEdit').click();
    await page.evaluate(() => document.querySelector('#meshCanvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext());
    await page.waitForFunction(() => document.querySelector('#meshCanvas').hidden);
    assert.match(await page.locator('.scene-layer').nth(1).evaluate(el => el.style.maskImage), /data:image\/png/);
    assert.deepEqual(errors, []); console.log('PASS mobile touch, layout, GPU-loss mask fallback and no page errors');
    console.log(`Artifacts: ${temporary}`);
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(projectsRoot), temporary); assert.ok(path.basename(temporary).startsWith('spatial-mask-check-'));
    await fs.rm(projectsRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
