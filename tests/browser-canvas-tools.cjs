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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-canvas-check-'));
  const projectsRoot = path.join(temporary, '图'); await fs.mkdir(projectsRoot);
  const server = createServer({ projectsRoot }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true }); const errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (['PUT', 'POST'].includes(r.method())) writes.push(r.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const fixtures = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 768; const c = canvas.getContext('2d');
      const one = () => { c.fillStyle = '#f43a7c'; c.fillRect(100, 220, 140, 210); };
      const two = () => { c.fillStyle = '#ffd845'; c.fillRect(320, 540, 24, 36); };
      one(); two(); const all = canvas.toDataURL(); c.clearRect(0, 0, 512, 768); one(); const base = canvas.toDataURL();
      c.clearRect(0, 0, 512, 768); two(); const small = canvas.toDataURL();
      c.fillStyle = '#1257b4'; c.fillRect(0, 0, 512, 768); c.fillStyle = '#19bc84'; c.fillRect(256, 0, 256, 768);
      c.fillStyle = '#d62838'; c.fillRect(10, 10, 80, 80); const background = canvas.toDataURL();
      return { all, base, small, background };
    });
    const project = path.join(projectsRoot, '精细编辑'); await fs.mkdir(project);
    for (const [name, data] of [['00.png', fixtures.all], ['01.png', fixtures.base], ['02.png', fixtures.small]]) await fs.writeFile(path.join(project, name), Buffer.from(data.split(',')[1], 'base64'));
    await page.locator('#refreshProjects').click();
    const open = async () => {
      await page.getByRole('button', { name: '精细编辑', exact: false }).click();
      await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '2' && !document.querySelector('#uploadBackground').disabled);
    };
    await open();
    const config = () => page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.startsWith('spatial-scene:v3:project:'))[1]));
    assert.equal(await page.locator('#thumbnailBounds').inputValue(), 'layer');
    const cropped = await page.locator('.layer-thumb').nth(1).getAttribute('src');
    assert.ok(cropped.startsWith('data:image/png'));
    const cropDimensions = await page.locator('.layer-thumb').nth(1).evaluate(el => [el.naturalWidth, el.naturalHeight]);
    assert.ok(cropDimensions[0] > 90 && cropDimensions[1] === 160);
    await page.locator('#thumbnailBounds').selectOption('document');
    assert.ok((await page.locator('.layer-thumb').nth(1).getAttribute('src')).includes('02.png'));
    await page.locator('#thumbnailBounds').selectOption('layer');
    assert.equal(await page.locator('.layer-thumb').nth(1).getAttribute('src'), cropped);
    console.log('PASS layer/document thumbnails enlarge small content without changing source images');

    await page.locator('[data-background=white]').click(); assert.deepEqual((await config()).background, { type: 'white' });
    assert.equal(await page.locator('#artFrame').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    await page.locator('[data-background=black]').click(); assert.equal((await config()).background.type, 'black');
    await page.locator('#backgroundInput').setInputFiles({ name: '底图.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.background.split(',')[1], 'base64') });
    await page.waitForFunction(() => document.querySelector('#uploadBackground').getAttribute('aria-pressed') === 'true' && !document.querySelector('#uploadBackground').disabled);
    assert.deepEqual((await config()).background, { type: 'image', stored: true });
    await page.reload(); await open();
    assert.equal(await page.locator('#uploadBackground').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#thumbnailBounds').inputValue(), 'layer');
    const frameBefore = await page.locator('#artFrame').boundingBox();
    const appearance = await page.locator('#artFrame').evaluate(el => [getComputedStyle(el).backgroundImage, getComputedStyle(el).backgroundPosition, getComputedStyle(el).backgroundSize]);
    await page.mouse.move(frameBefore.x + frameBefore.width - 20, frameBefore.y + 20);
    await page.locator('#stage').press('ArrowRight');
    assert.equal(await page.locator('#artFrame').evaluate(el => getComputedStyle(el).transform), 'none');
    assert.deepEqual(await page.locator('#artFrame').evaluate(el => [getComputedStyle(el).backgroundImage, getComputedStyle(el).backgroundPosition, getComputedStyle(el).backgroundSize]), appearance);
    assert.deepEqual(writes, []);
    console.log('PASS black/white/image background, IndexedDB persistence and stationary background');

    await page.getByRole('button', { name: '编辑 02.png 的钉子与变形', exact: true }).click();
    await page.locator('#focusLayer').click();
    assert.equal(await page.locator('#editZoom').textContent(), '800%');
    const rect = () => page.locator('#editOverlay').boundingBox();
    const p = async (x, y) => { const r = await rect(); return { x: r.x + r.width * x, y: r.y + r.height * y }; };
    const initial = await p(332 / 512, 558 / 768); await page.mouse.click(initial.x, initial.y);
    let pins = (await config()).layers[1].deform.pins;
    assert.equal(pins.length, 1); assert.ok(Math.abs(pins[0].x - 332 / 512) < .0005); assert.ok(Math.abs(pins[0].y - 558 / 768) < .0005);
    const target = await p(334 / 512, 560 / 768);
    await page.mouse.move(initial.x, initial.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 4 }); await page.mouse.up();
    pins = (await config()).layers[1].deform.pins; assert.ok(Math.abs(pins[0].x - 334 / 512) < .0005);
    await page.locator('#undoDeform').click(); assert.ok(Math.abs((await config()).layers[1].deform.pins[0].x - 332 / 512) < .0005);
    const savedPins = (await config()).layers[1].deform.pins;
    const beforePan = await rect(); await page.locator('#panTool').click();
    await page.mouse.move(initial.x, initial.y); await page.mouse.down(); await page.mouse.move(initial.x + 35, initial.y + 25, { steps: 4 }); await page.mouse.up();
    const afterPan = await rect(); assert.ok(Math.abs(afterPan.x - beforePan.x - 35) < 1); assert.ok(Math.abs(afterPan.y - beforePan.y - 25) < 1);
    assert.deepEqual((await config()).layers[1].deform.pins, savedPins);
    assert.equal((await config()).layers[1].deform.pins.length, 1);
    await page.locator('#panTool').click(); await page.locator('#fitView').click();
    assert.equal(await page.locator('#editZoom').textContent(), '100%');
    const baseRect = await rect(), anchor = { x: baseRect.x + baseRect.width * .45, y: baseRect.y + baseRect.height * .4 };
    await page.mouse.move(anchor.x, anchor.y); await page.mouse.wheel(0, -400);
    await page.waitForFunction(() => document.querySelector('#editZoom').textContent !== '100%');
    const zoomedRect = await rect(); assert.ok(Math.abs((anchor.x - zoomedRect.x) / zoomedRect.width - .45) < .002); assert.ok(Math.abs((anchor.y - zoomedRect.y) / zoomedRect.height - .4) < .002);
    await page.locator('#editOverlay').evaluate(el => el.focus({ preventScroll: true })); await page.keyboard.down('Space');
    const beforeSpace = await rect(); await page.mouse.down(); await page.mouse.move(anchor.x + 25, anchor.y + 15); await page.mouse.up(); await page.keyboard.up('Space');
    assert.ok(Math.abs((await rect()).x - beforeSpace.x - 25) < 1); assert.equal((await config()).layers[1].deform.pins.length, 1);
    await page.locator('#fitView').click(); await page.locator('#focusLayer').click();
    await page.screenshot({ path: path.join(temporary, 'precision-editor.png'), fullPage: true });
    await page.locator('#finishEdit').click(); assert.equal(await page.locator('#artFrame').evaluate(el => getComputedStyle(el).transform), 'none');
    assert.equal(await page.locator('#editViewTools').isVisible(), false);
    console.log('PASS 800% editing coordinates, pin drag/undo, grab/space pan, cursor-anchored wheel zoom and view reset');

    await page.locator('#openExport').click();
    async function download(id) {
      const next = page.waitForEvent('download'); await page.locator(id).click(); const file = await next;
      const dest = path.join(temporary, file.suggestedFilename()); await file.saveAs(dest); await page.waitForFunction(() => !document.querySelector('#closeExport').disabled); return dest;
    }
    const html = await download('#exportHTML'), scenePNG = await download('#exportScenePNG'), png = await download('#exportPNG');
    const packet = S.extract(await fs.readFile(scenePNG)); assert.deepEqual(packet.background, { type: 'image', src: fixtures.background });
    const getPixel = async (targetPage, src, x, y) => targetPage.evaluate(async ({ src, x, y }) => {
      const image = new Image(); image.src = src; await image.decode(); const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data];
    }, { src, x, y });
    const staticSrc = 'data:image/png;base64,' + (await fs.readFile(png)).toString('base64');
    assert.deepEqual(await getPixel(page, staticSrc, 30, 30), [214, 40, 56, 255]); assert.deepEqual(await getPixel(page, staticSrc, 400, 100), [25, 188, 132, 255]);
    const offline = await browser.newContext({ offline: true }); const player = await offline.newPage(); player.on('pageerror', e => errors.push(e.message));
    await player.goto(pathToFileURL(html).href); await player.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
    assert.equal(await player.locator('#frame').evaluate(el => el.style.backgroundImage), appearance[0]);
    assert.deepEqual(JSON.parse(await player.locator('#sceneData').textContent()).background, packet.background); await offline.close(); await page.bringToFront();
    await page.locator('#closeExport').click(); await page.locator('#guestMode').click(); await page.locator('#imageInput').setInputFiles(scenePNG);
    await page.waitForFunction(() => document.querySelector('#uploadBackground').getAttribute('aria-pressed') === 'true' && !document.querySelector('#uploadBackground').disabled);
    assert.deepEqual(writes, []);
    assert.equal(await page.locator('#artFrame').evaluate(el => el.style.backgroundImage), appearance[0]);
    await page.locator('[data-background=white]').click(); await page.locator('#openExport').click();
    const whitePNG = await download('#exportPNG'); assert.deepEqual(await getPixel(page, 'data:image/png;base64,' + (await fs.readFile(whitePNG)).toString('base64'), 30, 30), [255, 255, 255, 255]);
    await page.locator('#closeExport').click();
    console.log('PASS HTML offline and scene PNG background round-trip; static PNG composites image and white backgrounds');

    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '编辑 02.png 的钉子与变形', exact: true }).click();
    await page.locator('#editViewTools').scrollIntoViewIfNeeded(); await page.locator('#zoomIn').tap(); await page.locator('#panTool').tap();
    const stage = await page.locator('#stage').boundingBox(); const beforeTouch = await rect();
    const cdp = await page.context().newCDPSession(page), touch = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x + 20, y: touch.y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(Math.abs((await rect()).x - beforeTouch.x - 20) < 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(temporary, 'mobile-editor.png'), fullPage: true });
    assert.equal(await page.evaluate(() => !document.hidden && !document.querySelector('#meshCanvas').hidden), true);
    assert.deepEqual(errors, []); console.log('PASS mobile zoom/grab gesture and no page errors');
    console.log(`Artifacts: ${temporary}`);
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(projectsRoot), temporary); assert.ok(path.basename(temporary).startsWith('spatial-canvas-check-'));
    await fs.rm(projectsRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
