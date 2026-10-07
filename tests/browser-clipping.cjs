'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { createServer } = require('../server.cjs'), S = require('../scene-package.js');
(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-clipping-check-')), projectsRoot = path.join(temporary, '图'); await fs.mkdir(projectsRoot);
  const server = createServer({ projectsRoot }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true }), errors = [];
    page.on('pageerror', e => errors.push(e.message)); await page.goto(`http://127.0.0.1:${server.address().port}`);
    const fixtures = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 512; const ctx = c.getContext('2d');
      const blank = c.toDataURL(); ctx.fillStyle = '#1450c8'; ctx.fillRect(0, 0, 512, 512); const base = c.toDataURL();
      ctx.fillStyle = '#f02850'; ctx.fillRect(0, 0, 512, 512); const source = c.toDataURL();
      ctx.clearRect(0, 0, 512, 512); ctx.fillStyle = '#fff'; ctx.fillRect(96, 96, 320, 320); ctx.clearRect(110, 110, 40, 90); const target = c.toDataURL();
      c.width = c.height = 2048;
      for (const [i, color] of ['white', 'black', 'red', 'lime', 'blue'].entries()) { ctx.fillStyle = color; ctx.fillRect(i * 384, 0, 384, 2048); }
      return { blank, base, source, target, imageMask: c.toDataURL() };
    });
    const project = path.join(projectsRoot, '剪贴测试'); await fs.mkdir(project);
    for (const [name, key] of [['00.png', 'base'], ['01.png', 'base'], ['02.png', 'source'], ['03.png', 'blank'], ['04.png', 'target'], ['05.png', 'blank']]) await fs.writeFile(path.join(project, name), Buffer.from(fixtures[key].split(',')[1], 'base64'));
    await page.locator('#refreshProjects').click();
    const open = async () => { await page.getByRole('button', { name: '剪贴测试', exact: false }).click(); await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '5' && !document.querySelector('#createProject').disabled); };
    await open();
    const saved = () => page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.startsWith('spatial-scene:v3:project:'))[1]));
    const pixel = (p, x, y, id = 'meshCanvas') => p.evaluate(({ x, y, id }) => new Promise(resolve => requestAnimationFrame(() => { const c = document.getElementById(id), gl = c.getContext('webgl'), rgba = new Uint8Array(4); gl.readPixels(Math.floor(x * c.width), Math.floor((1 - y) * c.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba); resolve([...rgba]); })), { x, y, id });
    const red = [240, 40, 80, 255], blue = [20, 80, 200, 255];
    await page.getByRole('button', { name: '隐藏 04.png', exact: true }).click();
    await page.getByRole('combobox', { name: '02.png 剪贴至', exact: true }).selectOption('04.png');
    await page.locator('#spatialToggle').click();
    assert.equal((await saved()).layers[1].clipTo, '04.png'); assert.deepEqual(await pixel(page, .5, .5), red); assert.deepEqual(await pixel(page, .1, .5), blue); assert.deepEqual(await pixel(page, .25, .3), blue);
    assert.equal(await page.getByRole('combobox', { name: '04.png 剪贴至', exact: true }).locator('option[value="02.png"]').isDisabled(), true);
    await page.screenshot({ path: path.join(temporary, 'clipping-desktop.png'), fullPage: true });
    await page.reload(); await open(); assert.equal((await saved()).layers[1].clipTo, '04.png');
    console.log('PASS 02 clips to hidden 04 including holes, layer order, cycle prevention and reload persistence');

    const gpu = await page.evaluate(async ({ source, target }) => {
      const decode = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
      const elements = await Promise.all([decode(source), decode(target)]), canvas = document.createElement('canvas'), renderer = new MeshRenderer(canvas, () => {});
      const layers = [
        { id: '02.png', element: elements[0], depth: 1, visible: true, clipTo: '04.png', deform: { ...MeshMath.defaults(), volume: .6, bend: .8 } },
        { id: '04.png', element: elements[1], depth: .1, visible: false, deform: { ...MeshMath.defaults(), volume: .9, bend: .3, pins: [{ x: .4, y: .4 }] }, mask: { ...LayerMask.defaults(), strokes: [{ mode: 'hide', radius: .08, hardness: .5, opacity: 1, points: [[.65, .65]] }] } }
      ]; renderer.setLayers(layers, 1); const results = [];
      const read = () => { const all = new Uint8Array(canvas.width * canvas.height * 4); renderer.gl.readPixels(0, 0, canvas.width, canvas.height, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, all); return all; };
      for (const size of [256, 512]) for (const x of [-1, 0, 1]) {
        const view = { x, y: -x, strength: 100, width: size, height: size, pixelRatio: 1, aspect: 1, wave: .8 };
        renderer.render(layers, { ...view, solo: '02.png' }); const clipped = read();
        renderer.render(layers, { ...view, solo: '04.png' }); const reference = read(); let outside = 0, visible = 0;
        for (let py = 1; py < size - 1; py++) for (let px = 1; px < size - 1; px++) {
          if (clipped[(py * size + px) * 4 + 3] < 8) continue; visible++;
          let max = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) max = Math.max(max, reference[((py + dy) * size + px + dx) * 4 + 3]);
          if (max < 4) outside++;
        }
        results.push({ size, x, outside, visible });
      }
      // A two-step reference also clips to the final target's mask.
      layers.push({ id: '03.png', element: elements[0], depth: 0, visible: false, deform: MeshMath.defaults(), mask: { ...LayerMask.defaults(), base: 0 } });
      layers[1].clipTo = '03.png'; renderer.setLayers(layers, 1);
      renderer.render(layers, { x: .8, y: .5, strength: 100, width: 256, height: 256, pixelRatio: 1, aspect: 1, solo: '02.png' }); const chained = read().some((n, i) => i % 4 === 3 && n > 0);
      const error = renderer.gl.getError(); renderer.clear(); renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { results, chained, error };
    }, fixtures);
    assert.equal(gpu.error, 0); assert.equal(gpu.chained, false);
    for (const result of gpu.results) { assert.equal(result.outside, 0, JSON.stringify(result)); assert.ok(result.visible > result.size * result.size * .15); }
    console.log('PASS GPU clipping follows independently moving/deforming targets, their painted masks, resize and chained references');

    await page.getByRole('combobox', { name: '02.png 剪贴至', exact: true }).selectOption('');
    await page.getByRole('button', { name: '编辑 02.png 的蒙版', exact: true }).click();
    const input = { name: '彩色蒙版.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.imageMask.split(',')[1], 'base64') };
    await page.locator('#maskImageInput').setInputFiles(input);
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已导入图片并转为灰度蒙版') && !document.querySelector('#importMaskImage').disabled);
    let config = await saved(); assert.match(config.layers[1].mask.image.stored, /^mask-image:/); assert.ok(JSON.stringify(config).length < 20000);
    const grayscale = await page.evaluate(async ref => { const image = await SceneAssets.readMaskImage(ref), data = atob(image.data); return [image.width, image.height, ...[192, 576, 960, 1344, 1728, 2000].map(x => data.charCodeAt(1024 * image.width + x))]; }, config.layers[1].mask.image.stored);
    assert.deepEqual(grayscale, [2048, 2048, 255, 0, 54, 182, 18, 0]);
    assert.deepEqual(await pixel(page, .1, .5), red); assert.deepEqual(await pixel(page, .28, .5), blue);
    const mixed = await pixel(page, .47, .5); assert.ok(Math.abs(mixed[0] - (20 + 220 * 54 / 255)) <= 2);
    await page.locator('#maskInvert').click(); assert.deepEqual(await pixel(page, .1, .5), blue); assert.deepEqual(await pixel(page, .28, .5), red);
    await page.locator('#undoMask').click(); assert.deepEqual(await pixel(page, .1, .5), red);
    await page.locator('#maskHideAll').click(); await page.locator('#undoMask').click(); assert.deepEqual(await pixel(page, .1, .5), red);
    const box = await page.locator('#editOverlay').boundingBox(); await page.mouse.click(box.x + box.width * .1, box.y + box.height * .5);
    assert.deepEqual(await pixel(page, .1, .5), blue); await page.locator('#undoMask').click(); assert.deepEqual(await pixel(page, .1, .5), red);
    await page.locator('#maskImageInput').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('bad') });
    await page.waitForFunction(() => !document.querySelector('#importMaskImage').disabled); assert.deepEqual(await pixel(page, .1, .5), red);
    await page.screenshot({ path: path.join(temporary, 'image-mask-desktop.png'), fullPage: true });
    await page.locator('#finishEdit').click(); await page.locator('#spatialToggle').click();
    await page.locator('#layersTab').click(); await page.getByRole('combobox', { name: '02.png 剪贴至', exact: true }).selectOption('04.png');
    await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === '参数已自动保存');
    await page.reload(); await open(); assert.deepEqual(await pixel(page, .1, .5), blue); assert.equal((await saved()).layers[1].clipTo, '04.png');
    console.log('PASS color→luminance conversion, transparency, large image persistence outside localStorage, paint/invert/undo and failed-import preservation');

    await page.locator('#openExport').click();
    const download = async id => { const pending = page.waitForEvent('download', { timeout: 60000 }); await page.locator('#' + id).click(); const file = await pending, destination = path.join(temporary, file.suggestedFilename()); await file.saveAs(destination); await page.waitForFunction(() => !document.querySelector('#closeExport').disabled); return destination; };
    const html = await download('exportHTML'), scene = await download('exportScenePNG'), png = await download('exportPNG');
    const packet = S.extract(await fs.readFile(scene)); assert.equal(packet.layers[1].clipTo, '04.png'); assert.equal(packet.layers[1].mask.image.data.length, 5592408);
    const imagePixel = async (p, src, x, y) => p.evaluate(async ({ src, x, y }) => { const image = new Image(); image.src = src; await image.decode(); const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(Math.floor(x * c.width), Math.floor(y * c.height), 1, 1).data]; }, { src, x, y });
    assert.deepEqual(await imagePixel(page, 'data:image/png;base64,' + (await fs.readFile(png)).toString('base64'), .1, .5), blue);
    const expected = await pixel(page, .47, .5);
    assert.deepEqual(await imagePixel(page, 'data:image/png;base64,' + (await fs.readFile(png)).toString('base64'), .47, .5), expected);
    const offline = await browser.newContext({ offline: true }); const player = await offline.newPage(); player.on('pageerror', e => errors.push(e.message));
    await player.goto(pathToFileURL(html).href); await player.waitForFunction(() => document.querySelector('#stage').dataset.state === 'ready');
    assert.deepEqual(await pixel(player, .1, .5, 'canvas'), blue); assert.deepEqual(await pixel(player, .47, .5, 'canvas'), expected); await offline.close();
    await page.locator('#closeExport').click();
    const pending = page.waitForEvent('download'); await page.locator('#exportConfig').click(); const file = await pending, params = path.join(temporary, 'params.json'); await file.saveAs(params);
    await page.locator('#reset').click(); await page.locator('#configInput').setInputFiles(params); await page.waitForFunction(() => document.querySelector('#toast').textContent === '已载入场景配置。');
    assert.deepEqual(await pixel(page, .47, .5), expected);
    const invalid = JSON.parse(await fs.readFile(params, 'utf8')); invalid.layers[3].clipTo = '02.png';
    await page.locator('#configInput').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('循环引用')); assert.deepEqual(await pixel(page, .47, .5), expected);
    await page.locator('#guestMode').click(); await page.locator('#imageInput').setInputFiles(scene); await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('场景已恢复'));
    assert.deepEqual(await pixel(page, .47, .5), expected);
    console.log('PASS JSON, scene PNG, static PNG and offline HTML preserve clipping and imported image masks; cycle rejection is atomic');
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(temporary, 'clipping-mobile.png'), fullPage: true });
    await page.evaluate(() => document.querySelector('#meshCanvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext());
    await page.waitForFunction(() => document.querySelector('#flatCanvas') && !document.querySelector('#flatCanvas').hidden);
    const fallback = await page.locator('#flatCanvas').evaluate(c => { const ctx = c.getContext('2d'); return [...ctx.getImageData(Math.floor(c.width * .47), Math.floor(c.height * .5), 1, 1).data]; });
    assert.ok(fallback.every((value, i) => Math.abs(value - expected[i]) <= 2), `2D fallback ${fallback} vs GPU ${expected}`); assert.deepEqual(errors, []);
    console.log('PASS mobile layout and GPU-loss fallback preserve clipping and grayscale mask pixels'); console.log(`Artifacts: ${temporary}`);
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(projectsRoot), temporary); assert.ok(path.basename(temporary).startsWith('spatial-clipping-check-')); await fs.rm(projectsRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
