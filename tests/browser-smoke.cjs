// Optional end-to-end check: requires Playwright and its Chromium browser.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../server.cjs');

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-ui-check-'));
  const projectsRoot = path.join(temporary, '图');
  await fs.mkdir(projectsRoot);
  const source = path.join(__dirname, '..', '图', 'try01');
  await fs.cp(source, path.join(projectsRoot, '已有项目'), { recursive: true });
  const files = await Promise.all(['00.png', '01.png', '02.png'].map(async name => ({ name, mimeType: 'image/png', buffer: await fs.readFile(path.join(source, name)) })));
  const server = createServer({ projectsRoot });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], mutations = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (['POST', 'PUT', 'DELETE'].includes(request.method())) mutations.push(request.url()); });
    await page.goto(base);
    await page.getByRole('button', { name: '已有项目', exact: false }).click();
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '5');
    assert.deepEqual(await page.locator('#layerList label').allTextContents(), ['01.png', '02.png', '03.png', '04.png', '05.png']);
    assert.equal(await page.locator('.layer-order button:enabled').count(), 0);
    await page.getByRole('button', { name: '整图对比', exact: true }).click();
    assert.equal(await page.locator('#overviewImage').isVisible(), true);
    assert.equal(await page.locator('#scenePlane').isVisible(), false);
    await page.getByRole('button', { name: '返回视差', exact: true }).click();
    await page.screenshot({ path: path.join(temporary, 'desktop.png'), fullPage: true });
    console.log('PASS existing folders, numeric layers, separate overview');

    await page.locator('#projectName').fill('界面测试');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#sceneTitle').textContent === '界面测试' && !document.querySelector('#createProject').disabled);
    await page.locator('#imageInput').setInputFiles(files.slice(0, 2));
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '1' && !document.querySelector('#createProject').disabled);
    assert.deepEqual(await fs.readdir(path.join(projectsRoot, '界面测试')), ['00.png', '01.png']);
    assert.equal(await page.locator('#layerList label').textContent(), '01.png');
    console.log('PASS create project and save single-layer scene');

    await page.getByRole('button', { name: '清空预览', exact: true }).click();
    assert.equal(await page.locator('#emptyState').isVisible(), true);
    await page.getByRole('button', { name: '界面测试', exact: false }).click();
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '1' && !document.querySelector('#createProject').disabled);
    await page.reload();
    await page.getByRole('button', { name: '界面测试', exact: false }).click();
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '1' && !document.querySelector('#createProject').disabled);
    console.log('PASS reload project and clear preview without deleting files');

    const snapshot = await fs.readFile(path.join(projectsRoot, '界面测试', '00.png'));
    await page.locator('#imageInput').setInputFiles(files);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#createProject').disabled);
    assert.deepEqual(await fs.readFile(path.join(projectsRoot, '界面测试', '00.png')), snapshot);
    assert.equal(await page.locator('#layerCount').textContent(), '1');
    await page.locator('#imageInput').setInputFiles(files);
    await page.getByRole('button', { name: '替换并保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '2' && !document.querySelector('#createProject').disabled);
    assert.deepEqual(await fs.readdir(path.join(projectsRoot, '界面测试')), ['00.png', '01.png', '02.png']);
    console.log('PASS cancel and confirm replacement');

    await page.locator('#imageInput').setInputFiles([{ ...files[0], name: 'wrong.png' }, files[1]]);
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('两位数字'));
    assert.equal(await page.locator('#layerCount').textContent(), '2');
    const beforeGuest = mutations.length;
    await page.locator('#guestMode').click();
    await page.locator('#imageInput').setInputFiles(files);
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '2' && !document.querySelector('#createProject').disabled);
    assert.equal(mutations.length, beforeGuest);
    assert.equal(await page.locator('#sceneTitle').textContent(), '游客模式');
    assert.equal(await page.locator('.layer-order button:enabled').count(), 2);
    console.log('PASS guest import has zero write requests, invalid names preserve current scene');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(temporary, 'mobile.png'), fullPage: true });
    await page.locator('#folderInput').setInputFiles(path.join(projectsRoot, '已有项目'));
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '5' && !document.querySelector('#createProject').disabled);
    assert.equal(mutations.length, beforeGuest);
    assert.deepEqual(errors, []);
    console.log('PASS folder import, mobile layout, no JavaScript errors');

    // File URL remains a usable guest-only fallback.
    const { pathToFileURL } = require('node:url');
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.locator('#imageInput').setInputFiles(files.slice(0, 2));
    await page.waitForFunction(() => document.querySelector('#layerCount').textContent === '1');
    assert.equal(await page.locator('#createProject').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS direct HTML guest fallback');
    console.log(`Screenshots: ${temporary}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    // Keep screenshots for review, remove only the isolated project fixtures.
    assert.equal(path.dirname(projectsRoot), temporary);
    assert.ok(path.basename(temporary).startsWith('spatial-ui-check-'));
    await fs.rm(projectsRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
