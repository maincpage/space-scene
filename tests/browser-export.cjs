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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-export-check-'));
  const projectsRoot = path.join(temporary, '图'); await fs.mkdir(projectsRoot);
  await fs.cp(path.join(__dirname, '..', '图', 'try01'), path.join(projectsRoot, '导出测试'), { recursive: true });
  const server = createServer({ projectsRoot }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: '导出测试', exact: false }).click();
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '5' && !document.querySelector('#createProject').disabled);
    await page.getByRole('button', { name: '编辑 04.png 的钉子与变形', exact: true }).click();
    assert.equal(await page.locator('#layersPanel').isVisible(), false); assert.equal(await page.locator('#deformSection').isVisible(), true);
    const box = await page.locator('#editOverlay').boundingBox(); await page.mouse.click(box.x + box.width * .35, box.y + box.height * .27);
    await page.getByRole('button', { name: '柔软', exact: true }).click(); await page.locator('#finishEdit').click();
    await page.locator('#layersTab').click(); await page.getByRole('button', { name: '隐藏 02.png', exact: true }).click();
    await page.screenshot({ path: path.join(temporary, 'workspace.png'), fullPage: true });
    await page.locator('#openExport').click(); await page.screenshot({ path: path.join(temporary, 'export-dialog.png'), fullPage: true });
    async function download(id) {
      const pending = page.waitForEvent('download', { timeout: 60000 }); await page.locator('#' + id).click(); const file = await pending;
      const savedPath = path.join(temporary, file.suggestedFilename()); await file.saveAs(savedPath);
      await page.waitForFunction(() => !document.querySelector('#closeExport').disabled); return savedPath;
    }
    const html = await download('exportHTML'), scenePNG = await download('exportScenePNG'), flatPNG = await download('exportPNG');
    const sceneBytes = await fs.readFile(scenePNG), packet = S.extract(sceneBytes), staticBytes = await fs.readFile(flatPNG);
    assert.equal(packet.layers.length, 5); assert.equal(packet.layers[3].deform.pins.length, 1); assert.equal(packet.layers[3].deform.bend, .75); assert.equal(packet.layers[1].visible, false);
    assert.equal(S.extract(staticBytes), null); assert.equal(staticBytes.readUInt32BE(16), 2480); assert.equal(staticBytes.readUInt32BE(20), 3508);
    console.log('PASS all three exports contain the expected images and settings');

    const offline = await browser.newContext({ offline: true, viewport: { width: 726, height: 672 }, hasTouch: true }); const player = await offline.newPage(); const requests = [];
    player.on('pageerror', e => errors.push(e.message)); player.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await player.goto(pathToFileURL(html).href);
    await player.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
    assert.equal(await player.locator('#canvas').isVisible(), true); assert.deepEqual(requests, []);
    assert.equal(await player.locator('header, footer, nav').count(), 0);
    assert.equal(await player.locator('button').count(), 2); assert.equal(await player.locator('#compare').textContent(), '');
    assert.equal(await player.locator('#sensor').isVisible(), true);
    const stageBox = await player.locator('#stage').boundingBox(), frameBox = await player.locator('#frame').boundingBox(), eyeBox = await player.locator('#compare').boundingBox();
    assert.equal(stageBox.height, 672); assert.equal(stageBox.width, 726);
    assert.ok(Math.abs(eyeBox.y - frameBox.y - 12) < 1); assert.ok(Math.abs(frameBox.x + frameBox.width - eyeBox.x - eyeBox.width - 12) < 1);
    const data = await player.locator('#sceneData').textContent(); assert.deepEqual(JSON.parse(data), packet);
    const first = await player.locator('#canvas').screenshot(); await player.locator('#stage').press('Home');
    await player.locator('#stage').press('ArrowRight'); await player.locator('#stage').press('ArrowRight');
    const second = await player.locator('#canvas').screenshot(); assert.notDeepEqual(first, second);
    await player.locator('#stage').click({ position: { x: 10, y: 10 } });
    await player.getByRole('button', { name: '整图对比', exact: true }).click(); assert.equal(await player.locator('.overview').isVisible(), true);
    assert.equal(await player.locator('#compare').getAttribute('aria-pressed'), 'true');
    await player.screenshot({ path: path.join(temporary, 'standalone.png'), fullPage: true });
    await player.waitForFunction(() => getComputedStyle(document.querySelector('#compare')).opacity === '0');
    assert.equal(await player.locator('#compare').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await player.mouse.move(20, 20); assert.equal(await player.locator('#compare').evaluate(el => el.classList.contains('controls-hidden')), true);
    await player.mouse.click(20, 20); assert.equal(await player.locator('#compare').evaluate(el => el.classList.contains('controls-hidden')), false);
    assert.equal(await player.locator('#compare').getAttribute('aria-pressed'), 'true');
    await player.locator('#compare').click(); assert.equal(await player.locator('#canvas').isVisible(), true);
    await player.setViewportSize({ width: 390, height: 844 });
    await player.waitForFunction(() => document.querySelector('#frame').getBoundingClientRect().width <= innerWidth - 24);
    assert.equal(await player.evaluate(() => document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight), true);
    await player.waitForFunction(() => getComputedStyle(document.querySelector('#compare')).opacity === '0');
    await player.touchscreen.tap(10, 10); assert.equal(await player.locator('#compare').evaluate(el => el.classList.contains('controls-hidden')), false);
    await player.locator('#compare').tap(); assert.equal(await player.locator('.overview').isVisible(), true);
    await player.screenshot({ path: path.join(temporary, 'standalone-mobile.png'), fullPage: true });
    console.log('PASS pure scene layout, icon placement, three-second hiding, click/touch reveal and comparison toggle');
    // A normal browser image decoder can still display the PNG with the private scene chunk.
    const dimensions = await player.evaluate(async url => { const image = new Image(); image.src = url; await image.decode(); return [image.naturalWidth, image.naturalHeight]; }, pathToFileURL(scenePNG).href);
    assert.deepEqual(dimensions, [2480, 3508]);
    await offline.close(); console.log('PASS standalone HTML works offline with zero external requests; scene PNG is a valid image');

    await page.locator('#closeExport').click(); await page.locator('#guestMode').click();
    let writes = 0; page.on('request', r => { if (['PUT', 'POST'].includes(r.method())) writes++; });
    await page.locator('#imageInput').setInputFiles(scenePNG);
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('场景已恢复'));
    assert.equal(writes, 0); assert.equal(await page.locator('#layerCount').textContent(), '5');
    const restored = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.includes(':guest:'))[1]));
    assert.deepEqual(restored.layers.map(({ id, depth, visible, deform }) => ({ id, depth, visible, deform })), packet.layers.map(({ src, ...rest }) => rest));
    await page.getByRole('button', { name: '编辑 04.png 的钉子与变形', exact: true }).click(); assert.equal(await page.locator('#pinTotal').textContent(), '1 / 12');
    await page.locator('#finishEdit').click();
    console.log('PASS scene PNG reimport restores pins, deformation and hidden layers in guest mode without writes');

    const damaged = Buffer.from(sceneBytes); const marker = damaged.indexOf(Buffer.from('scNe')); damaged[marker + 20] ^= 1;
    await page.locator('#imageInput').setInputFiles({ name: '损坏场景.png', mimeType: 'image/png', buffer: damaged });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已损坏'));
    assert.equal(await page.locator('#layerCount').textContent(), '5'); assert.equal(writes, 0);
    await page.locator('#projectName').fill('恢复项目'); await page.locator('#createProject').click();
    await page.waitForFunction(() => document.querySelector('#sceneTitle').textContent === '恢复项目' && !document.querySelector('#createProject').disabled);
    await page.locator('#imageInput').setInputFiles(scenePNG);
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '5' && !document.querySelector('#createProject').disabled);
    assert.deepEqual(await fs.readdir(path.join(projectsRoot, '恢复项目')), ['00.png', '01.png', '02.png', '03.png', '04.png', '05.png']);
    assert.equal(writes, 2); console.log('PASS damaged metadata preserves the scene; project import saves the original numbered layers');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#projectToggle').click(); assert.equal(await page.locator('#guestMode').isVisible(), true); await page.locator('#projectToggle').click();
    await page.locator('#openExport').click(); assert.equal(await page.locator('#exportScenePNG').isVisible(), true); await page.locator('#closeExport').click();
    await page.screenshot({ path: path.join(temporary, 'mobile.png'), fullPage: true }); assert.deepEqual(errors, []);
    console.log('PASS mobile project drawer, export menu, layout and no JavaScript errors');
    console.log(`Artifacts: ${temporary}`);
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(projectsRoot), temporary); assert.ok(path.basename(temporary).startsWith('spatial-export-check-'));
    await fs.rm(projectsRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
