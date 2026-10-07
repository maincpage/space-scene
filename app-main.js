(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { clamp, pointerPosition, layerTransform, fitSize } = window.SceneMath;
  const { prepareFiles } = window.ImageFiles;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const B = window.SceneBackground, A = window.SceneAssets, K = window.LayerMask, C = window.LayerClip;
  const saveVersions = new Map(), pendingSaves = new Map();
  const flatCanvas = document.createElement('canvas'); flatCanvas.className = 'scene-layer'; flatCanvas.id = 'flatCanvas';
  const state = { project: null, scene: null, layers: [], enabled: true, comparing: false, strength: 60, mode: 'pointer', target: { x: 0, y: 0 }, current: { x: 0, y: 0 }, width: 1, height: 1, objectURLs: [], loaded: false };
  let projects = [], serverAvailable = false;
  state.background = B.read(); state.backgroundImage = null;
  let thumbnailBounds = 'layer';
  try { if (localStorage.getItem('spatial-scene:thumbnail-bounds') === 'document') thumbnailBounds = 'document'; } catch { /* Optional view preference. */ }
  $('thumbnailBounds').value = thumbnailBounds;
  $('thumbnailBounds').addEventListener('change', event => {
    thumbnailBounds = event.target.value;
    try { localStorage.setItem('spatial-scene:thumbnail-bounds', thumbnailBounds); } catch { /* Optional view preference. */ }
    if (state.loaded) renderLayerList();
  });
  let toastTimer, saveTimer, frameId, lastTime = 0, lastReadout = 0, dragging = false, importBusy = false, loadSequence = 0;
  const svg = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200);
  }
  const renderer = new window.MeshRenderer($('meshCanvas'), () => {
    state.layers.forEach(K.applyFallback);
    editor.setEditing(false); syncControls(); notify('网格渲染不可用，已回到平面视差。请开启浏览器硬件加速后刷新。');
  });
  function updateLayer(layer) { renderer.update(layer); if (!renderer.available) K.applyFallback(layer); }
  const editor = new window.LayerEditor({
    notify,
    aspect: () => state.scene ? state.scene.width / state.scene.height : 1,
    size: () => ({ width: state.width, height: state.height }),
    onChange: (layer, kind) => {
      if (kind === 'mask') renderer.updateMask(layer); else renderer.update(layer);
      if (!renderer.available) K.applyFallback(layer);
      updateEditButtons(); if (!editor.stroke?.mask) persist();
    },
    onCommit: () => persist(),
    onMode: () => {
      state.comparing = false; state.current = { x: 0, y: 0 }; state.target = { x: 0, y: 0 }; dragging = false;
      if (editor.editing) { state.enabled = true; setInspector(editor.mode); setMode('pointer'); }
      syncControls(); updateEditButtons();
    }
  });
  const tilt = window.SceneTilt.create({
    onPosition: position => { if (state.loaded && state.mode === 'sensor' && !editor.editing && !dragging) state.target = position; },
    onStatus: (status, message) => {
      if (status === 'waiting') {
        state.mode = 'sensor'; state.enabled = true; state.comparing = false;
        state.target = { x: 0, y: 0 };
      } else if (status !== 'idle' && status !== 'active' && state.mode === 'sensor') {
        state.mode = 'pointer'; state.target = { x: 0, y: 0 };
      }
      $('sensorHint').textContent = message; syncControls();
    }
  });
  function setInspector(panel) {
    $('layersPanel').hidden = panel !== 'layers'; $('deformSection').hidden = panel !== 'deform'; $('maskSection').hidden = panel !== 'mask';
    for (const [id, name] of [['layersTab', 'layers'], ['deformTab', 'deform'], ['maskTab', 'mask']]) { $(id).setAttribute('aria-selected', String(name === panel)); $(id).tabIndex = name === panel ? 0 : -1; }
  }
  $('layersTab').addEventListener('click', () => { if (editor.editing) editor.setEditing(false); setInspector('layers'); });
  for (const mode of ['deform', 'mask']) $(mode + 'Tab').addEventListener('click', () => { if (editor.editing && editor.mode !== mode) editor.setEditing(false); editor.mode = mode; setInspector(mode); editor.sync(); });
  const inspectorTabs = ['layersTab', 'deformTab', 'maskTab'];
  for (const id of inspectorTabs) $(id).addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (inspectorTabs.indexOf(id) + (event.key === 'ArrowRight' ? 1 : 2)) % 3; $(inspectorTabs[next]).click(); $(inspectorTabs[next]).focus(); }
  });
  $('projectToggle').addEventListener('click', () => { const open = document.querySelector('.projects-panel').classList.toggle('expanded'); $('projectToggle').setAttribute('aria-expanded', String(open)); });
  function storageKey() {
    return `spatial-scene:v3:${state.scene.id}:${state.scene.width}x${state.scene.height}`;
  }
  function settings() {
    return { version: 3, scene: state.scene.id, width: state.scene.width, height: state.scene.height, strength: state.strength, enabled: state.enabled, background: state.background, layers: state.layers.map(({ id, depth, visible, deform, mask, clipTo }) => ({ id, depth, visible, deform, ...(mask ? { mask } : {}), ...(clipTo ? { clipTo } : {}) })) };
  }
  function persist() {
    if (!state.scene) return;
    clearTimeout(saveTimer);
    try {
      const key = storageKey(), config = settings(), assets = [], version = (saveVersions.get(key) || 0) + 1;
      saveVersions.set(key, version);
      if (config.background.type === 'image') {
        if (!A.isStored(key, config.background.src)) assets.push(A.writeBackground(key, config.background.src));
        config.background = { type: 'image', stored: true };
      }
      config.layers = config.layers.map(layer => {
        if (!layer.mask?.image) return layer;
        const asset = A.storeMaskImage(layer.mask.image); if (asset.promise) assets.push(asset.promise);
        return { ...layer, mask: { ...layer.mask, image: { stored: asset.key } } };
      });
      // Snapshot before asynchronous asset writes; a later edit must never be overwritten by an older save.
      const snapshot = JSON.stringify(config);
      const save = () => { if (saveVersions.get(key) !== version) return; localStorage.setItem(key, snapshot); if (state.scene && storageKey() === key) $('saveStatus').textContent = '参数已自动保存'; };
      if (!assets.length) { save(); return; }
      $('saveStatus').textContent = '正在保存图片与参数…';
      const pending = Promise.all(assets).then(save).catch(() => { if (state.scene && storageKey() === key && saveVersions.get(key) === version) $('saveStatus').textContent = '图片或参数未能自动保存，请导出场景或参数。'; });
      pendingSaves.set(key, pending); pending.finally(() => { if (pendingSaves.get(key) === pending) pendingSaves.delete(key); });
      return pending;
    }
    catch { $('saveStatus').textContent = '浏览器无法保存设置，可使用导出配置。'; }
  }
  async function applySettings(config, strict = false) {
    if (!config || ![2, 3].includes(config.version) || !Array.isArray(config.layers) || !Number.isFinite(config.strength) || typeof config.enabled !== 'boolean') throw new Error('配置文件格式不正确。');
    if (config.layers.some(l => !l || typeof l.id !== 'string' || !Number.isFinite(l.depth) || typeof l.visible !== 'boolean') || new Set(config.layers.map(l => l.id)).size !== config.layers.length) throw new Error('图层配置数据不完整。');
    if (strict && (config.width !== state.scene.width || config.height !== state.scene.height || config.layers.length !== state.layers.length || !state.layers.every(l => config.layers.some(c => c.id === l.id)))) throw new Error('这份配置与当前图层不匹配，请先导入对应的 PNG。');
    if (config.layers.length !== state.layers.length || !state.layers.every(layer => config.layers.some(item => item.id === layer.id))) throw new Error('参数与当前图层不匹配。');
    const deforms = config.layers.map(item => window.MeshMath.readDeform(item.deform));
    const masks = config.layers.map(item => K.read(item.mask));
    C.validate(config.layers);
    const background = B.read(config.background), backgroundImage = background.type === 'image' ? await decodeImage(background.src) : null;
    if (!state.scene.project) state.layers = config.layers.map(item => state.layers.find(layer => layer.id === item.id));
    state.strength = clamp(config.strength, 0, 100);
    state.enabled = config.enabled;
    state.background = background; state.backgroundImage = backgroundImage;
    state.layers.forEach(layer => {
      const item = config.layers.find(l => l.id === layer.id);
      if (item) { layer.depth = clamp(item.depth, 0, 1); layer.visible = item.visible; layer.deform = deforms[config.layers.indexOf(item)]; layer.mask = masks[config.layers.indexOf(item)]; layer.clipTo = item.clipTo || null; }
    });
  }
  function paintRange(input) { input.style.setProperty('--progress', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`); }
  function syncControls() {
    document.querySelectorAll('[data-needs-scene]').forEach(control => { control.disabled = !state.loaded || importBusy; });
    document.querySelectorAll('[data-import]').forEach(control => { control.disabled = importBusy; });
    $('createProject').disabled = importBusy || !serverAvailable;
    $('projectName').disabled = importBusy || !serverAvailable;
    $('refreshProjects').disabled = importBusy;
    $('guestMode').disabled = importBusy;
    $('guestMode').classList.toggle('active', !state.project);
    $('guestMode').setAttribute('aria-pressed', String(!state.project));
    document.querySelectorAll('[data-project]').forEach(button => {
      button.disabled = importBusy;
      const active = state.project?.name === button.dataset.project;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.layer-row input,.layer-row select,.eye-button').forEach(control => { control.disabled = importBusy; });
    document.querySelectorAll('.layer-order button').forEach(control => { control.disabled = importBusy || !!state.scene?.project || control.dataset.boundary === 'true'; });
    $('sceneTitle').textContent = state.project?.name || '游客模式';
    $('sceneTitle').title = $('sceneTitle').textContent;
    $('modeNote').textContent = state.project ? '本地项目' : '临时';
    $('modeNote').title = state.project ? '图片导入后保存到项目文件夹' : '图片仅在当前页面使用';
    $('layerOrderHint').textContent = state.project ? '按编号由底到顶排列' : '箭头调整顺序，滑杆调整深度';
    $('artFrame').hidden = !state.loaded;
    B.apply($('artFrame'), state.background);
    document.querySelectorAll('[data-background]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.background === state.background.type)));
    $('uploadBackground').setAttribute('aria-pressed', String(state.background.type === 'image'));
    $('uploadBackground').textContent = state.background.type === 'image' ? '替换底图' : '上传底图';
    $('thumbnailBounds').disabled = importBusy;
    $('emptyState').hidden = state.loaded;
    $('stage').classList.toggle('loaded', state.loaded);
    $('stage').tabIndex = state.loaded ? 0 : -1;
    $('strength').value = state.strength;
    $('strengthValue').textContent = `${Math.round(state.strength)}%`;
    paintRange($('strength'));
    $('spatialToggle').setAttribute('aria-checked', String(state.enabled));
    $('compare').setAttribute('aria-pressed', String(state.comparing));
    $('compare').querySelector('span').textContent = state.comparing ? '返回视差' : '整图对比';
    $('overviewImage').hidden = !state.comparing;
    $('scenePlane').hidden = state.comparing || renderer.available;
    $('meshCanvas').hidden = state.comparing || !renderer.available;
    $('artFrame').classList.toggle('mesh-editing', editor.editing);
    $('stage').classList.toggle('editing', editor.editing);
    $('finishEdit').hidden = !editor.editing; $('finishEdit').disabled = importBusy;
    $('rendererStatus').hidden = renderer.available && state.loaded;
    $('rendererStatus').textContent = !state.loaded ? '导入图片后可编辑' : '网格变形不可用，请开启硬件加速后刷新。';
    editor.sync(importBusy || !renderer.available || !state.loaded);
    document.querySelectorAll('.edit-layer,.edit-mask').forEach(button => { button.disabled = importBusy || !renderer.available; });
    if (editor.editing) { $('compare').disabled = true; $('sensor').disabled = true; $('spatialToggle').disabled = true; document.querySelectorAll('[data-mode]').forEach(button => { button.disabled = true; }); }
    $('openExport').disabled ||= editor.editing;
    const flat = !state.enabled || state.comparing;
    $('stageStatus').textContent = !state.loaded ? '未导入图片' : state.comparing ? '00.png · 整图' : flat ? '平面图层' : state.mode === 'auto' ? '自动播放' : state.mode === 'sensor' ? '倾斜感应' : '视差预览';
    $('interactionHint').textContent = !state.loaded ? '支持选择文件、文件夹或拖入图片' : flat ? '原始比例与位置' : state.mode === 'auto' ? '拖动画面可切换为手动' : state.mode === 'sensor' ? '倾斜手机；回正可重新校准' : '移动鼠标或拖动画面';
    document.querySelectorAll('[data-mode]').forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('sensor').classList.toggle('active', state.mode === 'sensor');
    $('sensor').setAttribute('aria-pressed', String(state.mode === 'sensor'));
    $('sensor').disabled ||= tilt.status === 'requesting';
    $('sensor').querySelector('span').textContent = state.mode === 'sensor' ? '关闭倾斜感应' : '开启倾斜感应';
    if (editor.editing) { $('stageStatus').textContent = `${editor.layer()?.name} · ${editor.mode === 'mask' ? '蒙版编辑' : '正面编辑'}`; $('interactionHint').textContent = editor.mode === 'mask' ? `${editor.maskTool === 'hide' ? '隐藏' : '恢复'}画笔 · X 切换 · Ctrl / ⌘ Z 撤销` : editor.tool === 'pin' ? '点击下钉 · 拖动钉点 · Delete 删除' : '拖动绘制起伏 · 橙色凸起 / 蓝色凹陷'; }
  }
  function updateEditButtons() {
    document.querySelectorAll('.edit-layer').forEach(button => {
      const layer = state.layers.find(item => item.id === button.dataset.layer);
      button.textContent = `编辑${layer?.deform.pins.length ? ` · ${layer.deform.pins.length} 个钉点` : '变形'}`;
      button.setAttribute('aria-pressed', String(editor.editing && editor.mode === 'deform' && editor.selected === layer?.id));
    });
    document.querySelectorAll('.edit-mask').forEach(button => {
      const layer = state.layers.find(item => item.id === button.dataset.layer);
      button.textContent = layer?.mask ? layer.mask.enabled ? '蒙版 · 已启用' : '蒙版 · 已停用' : '添加蒙版';
      button.setAttribute('aria-pressed', String(editor.editing && editor.mode === 'mask' && editor.selected === layer?.id));
    });
  }
  function renderLayerList() {
    $('layerList').replaceChildren();
    state.layers.forEach((layer, index) => {
      const row = document.createElement('div'); row.className = `layer-row${state.scene.project ? ' fixed-order' : ''}`;
      row.innerHTML = `<img class="layer-thumb" alt=""><div class="layer-info"><div class="layer-label"><label></label><output></output></div><input type="range" min="0" max="100" step="1"></div><button class="eye-button">${svg('eye')}</button><div class="layer-order"><button class="move-back">↑</button><button class="move-front">↓</button></div><div class="layer-actions"><button class="edit-layer text-button">钉子 / 变形</button><button class="edit-mask text-button">添加蒙版</button></div>`;
      const clipRow = document.createElement('div'); clipRow.className = 'layer-clip';
      const clipLabel = document.createElement('label'); clipLabel.textContent = '剪贴至'; clipLabel.htmlFor = `clip-${index}`;
      const clip = document.createElement('select'); clip.id = clipLabel.htmlFor; clip.dataset.layer = layer.id; clip.setAttribute('aria-label', `${layer.name} 剪贴至`);
      const none = document.createElement('option'); none.value = ''; none.textContent = '不剪贴'; clip.append(none);
      for (const target of state.layers) if (target.id !== layer.id) {
        const option = document.createElement('option'); option.value = target.id; option.textContent = target.name;
        option.disabled = !C.canClip(state.layers, layer.id, target.id); clip.append(option);
      }
      clip.value = layer.clipTo || ''; clip.disabled = importBusy;
      clip.addEventListener('change', () => {
        const target = clip.value || null; if (!C.canClip(state.layers, layer.id, target)) { notify('不能创建循环剪贴关系。'); clip.value = layer.clipTo || ''; return; }
        layer.clipTo = target; renderLayerList(); persist();
      });
      clipRow.append(clipLabel, clip); row.append(clipRow);
      row.querySelector('img').src = thumbnailBounds === 'layer' ? layer.thumbnail.src : layer.src;
      row.querySelector('img').alt = `${layer.name} · ${thumbnailBounds === 'layer' ? '图层边界' : '文档边界'}`;
      const input = row.querySelector('input'); input.id = `depth-${index}`;
      const label = row.querySelector('label'); label.textContent = layer.name; label.htmlFor = input.id; label.title = layer.name;
      const output = row.querySelector('output'); output.htmlFor = input.id;
      const eye = row.querySelector('.eye-button');
      const edit = row.querySelector('.edit-layer'); edit.dataset.layer = layer.id; edit.setAttribute('aria-label', `编辑 ${layer.name} 的钉子与变形`); edit.disabled = !renderer.available || importBusy;
      edit.addEventListener('click', () => { editor.select(layer.id, 'deform'); $('deformSection').scrollIntoView({ block: 'nearest' }); });
      const mask = row.querySelector('.edit-mask'); mask.dataset.layer = layer.id; mask.setAttribute('aria-label', `编辑 ${layer.name} 的蒙版`); mask.disabled = !renderer.available || importBusy;
      mask.addEventListener('click', () => { editor.select(layer.id, 'mask'); $('maskSection').scrollIntoView({ block: 'nearest' }); });
      const update = () => {
        input.value = Math.round(layer.depth * 100); output.textContent = input.value; paintRange(input);
        row.classList.toggle('hidden-layer', !layer.visible);
        eye.setAttribute('aria-label', `${layer.visible ? '隐藏' : '显示'} ${layer.name}`);
        eye.setAttribute('aria-pressed', String(layer.visible));
        layer.element.style.visibility = layer.visible ? 'visible' : 'hidden';
      };
      input.addEventListener('input', () => { layer.depth = Number(input.value) / 100; update(); persist(); });
      eye.addEventListener('click', () => { layer.visible = !layer.visible; update(); persist(); });
      for (const [selector, offset, text] of [['.move-back', -1, '向后移动'], ['.move-front', 1, '向前移动']]) {
        const button = row.querySelector(selector);
        button.setAttribute('aria-label', `${text} ${layer.name}`); button.title = `${text} ${layer.name}`;
        button.dataset.boundary = String(index + offset < 0 || index + offset >= state.layers.length);
        button.disabled = !!state.scene.project || button.dataset.boundary === 'true';
        if (state.scene.project) button.title = '项目图层按文件编号固定排序';
        button.addEventListener('click', () => {
          const target = index + offset;
          [state.layers[index], state.layers[target]] = [state.layers[target], state.layers[index]];
          $('scenePlane').replaceChildren(...state.layers.map(item => item.element));
          renderLayerList(); persist();
        });
      }
      update(); $('layerList').append(row);
    });
    updateEditButtons();
  }
  async function decodeImage(src) {
    const image = new Image(); image.decoding = 'async'; image.src = src;
    await image.decode();
    return image;
  }
  $('importMaskImage').addEventListener('click', () => $('maskImageInput').click());
  $('maskImageInput').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; const layer = editor.layer(); if (!file || !layer || importBusy) return;
    editor.finishStroke(); importBusy = true; syncControls(); let url;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('蒙版图片支持 PNG、JPG 和 WebP。');
      if (file.size > 25 * 1024 * 1024) throw new Error('请选择 25 MB 以内的蒙版图片。');
      url = URL.createObjectURL(file); const image = await decodeImage(url), mask = K.fromImage(image);
      editor.importMask(mask); await persist(); notify('已导入图片并转为灰度蒙版，可继续绘制或撤销。');
    } catch (error) { notify(error.name === 'EncodingError' ? '无法读取这张蒙版图片，请选择有效的 PNG、JPG 或 WebP。' : error.message || '蒙版图片无法读取。'); }
    finally { if (url) URL.revokeObjectURL(url); importBusy = false; syncControls(); }
  });
  document.querySelectorAll('[data-background]').forEach(button => button.addEventListener('click', () => {
    state.background = { type: button.dataset.background }; state.backgroundImage = null; syncControls(); persist();
  }));
  $('uploadBackground').addEventListener('click', () => $('backgroundInput').click());
  $('backgroundInput').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file || !state.scene || importBusy) return;
    importBusy = true; syncControls(); let url;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('底图支持 PNG、JPG 和 WebP。');
      if (file.size > 25 * 1024 * 1024) throw new Error('请选择 25 MB 以内的底图。');
      url = URL.createObjectURL(file); const image = await decodeImage(url);
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const background = B.read({ type: 'image', src: canvas.toDataURL('image/png') });
      const backgroundImage = await decodeImage(background.src); canvas.width = canvas.height = 1;
      state.background = background; state.backgroundImage = backgroundImage; await persist(); notify('已设置底图，保持静止。');
    } catch (error) { notify(error.message || '底图无法读取。'); }
    finally { if (url) URL.revokeObjectURL(url); importBusy = false; syncControls(); }
  });
  async function loadScene(scene) {
    const sequence = ++loadSequence;
    $('loading').hidden = false; $('loadingText').textContent = '正在读取图片…';
    try {
      const [overview, images] = await Promise.all([decodeImage(scene.overview), Promise.all(scene.layers.map(async layer => {
        const img = await decodeImage(layer.src);
        if (img.naturalWidth !== scene.width || img.naturalHeight !== scene.height) throw new Error(`${layer.name} 的画布尺寸与其他图层不同。`);
        img.className = 'scene-layer'; img.alt = layer.name; img.draggable = false;
        return img;
      }))]);
      if (overview.naturalWidth !== scene.width || overview.naturalHeight !== scene.height) throw new Error('00.png 整图尺寸必须与图层一致。');
      if (sequence !== loadSequence) return false;
      clearTimeout(saveTimer); setMode('pointer');
      state.scene = scene; state.strength = scene.strength ?? 60; state.enabled = true; state.comparing = false;
      state.background = B.read(); state.backgroundImage = null;
      state.layers = scene.layers.map((layer, i) => ({ ...layer, visible: true, deform: window.MeshMath.defaults(), mask: null, clipTo: null, element: images[i], thumbnail: A.thumbnail(images[i]) }));
      try {
        if (pendingSaves.has(storageKey())) await pendingSaves.get(storageKey());
        const saved = localStorage.getItem(storageKey());
        if (saved) {
          const config = JSON.parse(saved);
          if (config.background?.stored) config.background = { type: 'image', src: await A.readBackground(storageKey()) };
          for (const layer of config.layers) if (layer.mask?.image?.stored) layer.mask.image = await A.readMaskImage(layer.mask.image.stored);
          await applySettings(config);
        }
      } catch { /* Invalid or unavailable local settings do not prevent loading. */ }
      if (sequence !== loadSequence) return false;
      $('scenePlane').replaceChildren(...state.layers.map(layer => layer.element));
      renderer.setLayers(state.layers, scene.width / scene.height); editor.setLayers(state.layers); setInspector('layers');
      if (!renderer.available) state.layers.forEach(K.applyFallback);
      $('overviewImage').src = scene.overview;
      $('sceneMeta').textContent = `${images.length} 层 · ${scene.width} × ${scene.height}`;
      $('layerCount').textContent = String(images.length);
      state.loaded = true; state.target = { x: 0, y: 0 }; state.current = { x: 0, y: 0 };
      renderLayerList(); syncControls(); resize(); $('loading').hidden = true;
      if (state.enabled && window.SceneTilt.isMobile() && !reducedMotion.matches) void tilt.start();
      return true;
    } catch (error) {
      $('loading').hidden = true;
      notify(error.message || '无法加载图片。'); return false;
    }
  }
  function resize() {
    if (!state.scene) return;
    const size = fitSize($('stage').clientWidth - 12, $('stage').clientHeight - 12, state.scene.width / state.scene.height);
    state.width = size.width; state.height = size.height;
    $('artFrame').style.width = `${size.width}px`; $('artFrame').style.height = `${size.height}px`;
    editor.applyView();
  }
  function setMode(mode) {
    state.mode = mode; state.target = { x: 0, y: 0 };
    if (mode !== 'sensor') tilt.stop();
    syncControls();
  }
  function recenter() { state.target = { x: 0, y: 0 }; tilt.recenter(); if (state.mode === 'auto') setMode('pointer'); notify(state.mode === 'sensor' ? '已重新校准当前握持角度。' : '视角已回正。'); }
  function tick(time) {
    const delta = Math.min(50, time - (lastTime || time)); lastTime = time;
    if (state.mode === 'auto') state.target = { x: Math.sin(time / 2800) * .82, y: Math.cos(time / 3700) * .6 };
    const flat = !state.enabled || state.comparing || editor.editing;
    const target = flat ? { x: 0, y: 0 } : state.target;
    const ease = 1 - Math.exp(-delta / (reducedMotion.matches ? 35 : 135));
    state.current.x += (target.x - state.current.x) * ease; state.current.y += (target.y - state.current.y) * ease;
    if (state.loaded) {
      const { x, y } = state.current; const strength = flat ? 0 : state.strength;
      if (renderer.available) {
        const zoom = editor.editing ? editor.zoom : 1;
        if (!state.comparing) renderer.render(state.layers, { x, y, strength, width: state.width * zoom, height: state.height * zoom, pixelRatio: editor.editing ? Math.min(devicePixelRatio || 1, 2, 4096 / (zoom * Math.max(state.width, state.height))) : undefined, aspect: state.scene.width / state.scene.height, wave: state.mode === 'auto' && !reducedMotion.matches ? Math.sin(time / 1100) : 0, solo: editor.editing && $(editor.mode === 'mask' ? 'maskSolo' : 'soloLayer').checked ? editor.selected : null });
      } else {
        const clipped = state.layers.some(layer => layer.clipTo);
        flatCanvas.hidden = !clipped;
        if (clipped) {
          if (!flatCanvas.isConnected) $('scenePlane').append(flatCanvas);
          const ratio = Math.min(devicePixelRatio || 1, 2), w = Math.max(1, Math.round(state.width * ratio)), h = Math.max(1, Math.round(state.height * ratio));
          if (flatCanvas.width !== w || flatCanvas.height !== h) { flatCanvas.width = w; flatCanvas.height = h; }
          const ctx = flatCanvas.getContext('2d'); ctx.clearRect(0, 0, w, h); C.drawFlat(ctx, state.layers, { x, y, strength });
        }
        state.layers.forEach(layer => {
          layer.element.hidden = clipped;
          const t = layerTransform(x, y, layer.depth, strength, state.width, state.height);
          layer.element.style.transform = `translate3d(${t.x.toFixed(3)}px,${t.y.toFixed(3)}px,0) scale(${t.scale})`;
        });
      }
      if (time - lastReadout > 100) { $('coordinates').textContent = `X ${x.toFixed(2)}   Y ${y.toFixed(2)}`; lastReadout = time; }
    }
    frameId = requestAnimationFrame(tick);
  }
  const stage = $('stage');
  function track(event) { state.target = pointerPosition(event.clientX, event.clientY, stage.getBoundingClientRect()); }
  stage.addEventListener('pointerdown', event => {
    if (!state.loaded || importBusy || editor.editing || event.button !== 0 || !event.isPrimary) return;
    dragging = true; if (state.mode !== 'sensor') setMode('pointer'); stage.setPointerCapture(event.pointerId); track(event);
  });
  stage.addEventListener('pointermove', event => { if (state.loaded && !editor.editing && (dragging || state.mode === 'pointer' && event.pointerType === 'mouse')) track(event); });
  function endDrag() { if (!dragging) return; dragging = false; state.target = { x: 0, y: 0 }; if (state.mode === 'sensor') tilt.recenter(); }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag); stage.addEventListener('lostpointercapture', endDrag);
  stage.addEventListener('pointerleave', () => { if (!dragging && state.mode === 'pointer') state.target = { x: 0, y: 0 }; });
  stage.addEventListener('keydown', event => {
    if (editor.editing) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); if (state.mode !== 'pointer') setMode('pointer');
      if (event.key === 'ArrowLeft') state.target.x = clamp(state.target.x - .25);
      if (event.key === 'ArrowRight') state.target.x = clamp(state.target.x + .25);
      if (event.key === 'ArrowUp') state.target.y = clamp(state.target.y - .25);
      if (event.key === 'ArrowDown') state.target.y = clamp(state.target.y + .25);
    } else if (event.key === 'Home') { event.preventDefault(); recenter(); }
  });
  $('strength').addEventListener('input', event => { state.strength = Number(event.target.value); syncControls(); persist(); });
  $('spatialToggle').addEventListener('click', () => { state.enabled = !state.enabled; state.comparing = false; syncControls(); persist(); });
  $('compare').addEventListener('click', () => { state.comparing = !state.comparing; syncControls(); });
  $('recenter').addEventListener('click', recenter);
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { state.comparing = false; state.enabled = true; setMode(button.dataset.mode); persist(); }));
  $('reset').addEventListener('click', () => {
    if (!state.scene) return;
    state.strength = state.scene.strength ?? 60; state.enabled = true; state.comparing = false;
    state.background = B.read(); state.backgroundImage = null;
    editor.finishStroke();
    state.layers = state.scene.layers.map(original => { const layer = state.layers.find(item => item.id === original.id); return { ...layer, depth: original.depth, visible: true, deform: window.MeshMath.defaults(), mask: null, clipTo: null }; });
    $('scenePlane').replaceChildren(...state.layers.map(layer => layer.element));
    state.layers.forEach(updateLayer); editor.setLayers(state.layers);
    setMode('pointer'); renderLayerList(); persist(); notify('已恢复导入时的顺序和默认参数。');
  });
  $('sensor').addEventListener('click', async () => {
    if (state.mode === 'sensor') { setMode('pointer'); return; }
    if (await tilt.start({ requestPermission: true })) persist();
  });
  $('fullscreen').addEventListener('click', async () => {
    const viewer = $('viewer');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewer.classList.contains('immersive')) viewer.classList.remove('immersive');
      else if (viewer.requestFullscreen) await viewer.requestFullscreen();
      else viewer.classList.add('immersive');
    } catch { viewer.classList.toggle('immersive'); }
    resize(); updateFullscreenLabel();
  });
  function updateFullscreenLabel() { const active = !!document.fullscreenElement || $('viewer').classList.contains('immersive'); $('fullscreen').setAttribute('aria-label', active ? '退出全屏' : '全屏'); $('fullscreen').title = active ? '退出全屏' : '全屏'; }
  document.addEventListener('fullscreenchange', () => { resize(); updateFullscreenLabel(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('viewer').classList.remove('immersive'); resize(); updateFullscreenLabel(); } });
  function releaseImages() { state.objectURLs.forEach(url => URL.revokeObjectURL(url)); state.objectURLs = []; }
  function clearScene() {
    clearTimeout(saveTimer); releaseImages();
    renderer.clear(); editor.setLayers([]);
    state.loaded = false; state.scene = null; state.layers = []; state.strength = 60; state.enabled = true; state.comparing = false; state.background = B.read(); state.backgroundImage = null;
    state.current = { x: 0, y: 0 }; setMode('pointer');
    $('scenePlane').replaceChildren(); $('sceneMeta').textContent = '未导入图片'; $('layerCount').textContent = '0'; $('coordinates').textContent = '';
    $('overviewImage').removeAttribute('src');
    $('layerList').innerHTML = '<p class="muted note">导入后显示图层。</p>';
  }
  $('clearScene').addEventListener('click', clearScene);
  document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', () => $(button.dataset.import === 'folder' ? 'folderInput' : 'imageInput').click()));
  async function importFiles(input) {
    if (importBusy) return;
    importBusy = true; syncControls(); $('loading').hidden = false;
    let urls = [];
    try {
      let incoming = Array.from(input), packet = null;
      if (incoming.length === 1) {
        if (incoming[0].size > window.ScenePackage.MAX_FILE) throw new Error('场景图片超过 300 MB。');
        packet = window.ScenePackage.extract(new Uint8Array(await incoming[0].arrayBuffer()));
        if (packet) incoming = window.ScenePackage.toFiles(packet);
      }
      const { files, id } = prepareFiles(incoming);
      urls = files.map(file => URL.createObjectURL(file));
      const images = await Promise.all(urls.map(decodeImage));
      const width = images[0].naturalWidth, height = images[0].naturalHeight;
      if (images.some(img => img.naturalWidth !== width || img.naturalHeight !== height)) throw new Error('所有 PNG 必须保持相同的画布尺寸和坐标。');
      if (packet && (packet.width !== width || packet.height !== height)) throw new Error('场景尺寸与图片不一致。');
      if (packet?.background?.type === 'image') await decodeImage(packet.background.src);
      let project = state.project;
      if (project) {
        if (project.files.length && !(await confirmReplacement(project.name))) return;
        $('loadingText').textContent = '正在保存项目图片…';
        const manifest = new TextEncoder().encode(JSON.stringify({ revision: project.revision, files: files.map(file => ({ name: file.name, size: file.size })) }));
        const header = new ArrayBuffer(4); new DataView(header).setUint32(0, manifest.length);
        project = await api(`/api/projects/${encodeURIComponent(project.name)}/images`, { method: 'PUT', body: new Blob([header, manifest, ...files], { type: 'application/octet-stream' }) });
        state.project = project;
      }
      const layers = files.slice(1).map((file, i) => ({ id: file.name, name: file.name, src: urls[i + 1], depth: i / Math.max(1, files.length - 2) }));
      const loaded = await loadScene({ id: project ? `project:${project.name}:${project.revision}` : `guest:${id}`, project: !!project, overview: urls[0], width, height, background: '#000000', strength: 60, layers });
      if (!loaded) throw new Error('图片未能加载。');
      releaseImages(); state.objectURLs = urls;
      if (packet) {
        await applySettings({ version: 3, width, height, strength: packet.strength, enabled: packet.enabled, background: packet.background, layers: packet.layers }, true);
        $('scenePlane').replaceChildren(...state.layers.map(layer => layer.element)); state.layers.forEach(updateLayer); editor.setLayers(state.layers); renderLayerList(); await persist();
      }
      if (project) await refreshProjects();
      notify(packet ? '场景已恢复，包含图层、蒙版、钉点和变形参数。' : project ? `已保存到项目「${project.name}」。` : `已导入 ${layers.length} 层。`);
    } catch (error) { notify(error.message || '导入失败，请检查 PNG 文件。'); }
    finally { if (state.objectURLs !== urls) urls.forEach(url => URL.revokeObjectURL(url)); importBusy = false; $('loading').hidden = true; syncControls(); }
  }
  for (const id of ['imageInput', 'folderInput']) $(id).addEventListener('change', event => {
    const files = [...event.target.files]; event.target.value = ''; if (files.length) importFiles(files);
  });
  async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options, headers: { 'X-Spatial-Client': '1', ...options.headers } });
    let data;
    try { data = await response.json(); } catch { throw new Error('项目服务不可用，请通过“打开空间场景.cmd”启动。'); }
    if (!response.ok) throw new Error(data.error || '项目操作失败。');
    return data;
  }
  function renderProjects() {
    $('projectList').replaceChildren();
    for (const project of projects) {
      const button = document.createElement('button'); button.className = 'project-item'; button.dataset.project = project.name;
      const title = document.createElement('strong'); title.textContent = project.name;
      const info = document.createElement('span'); info.textContent = project.error ? '图片格式需要检查' : project.imageCount ? `整图 + ${project.imageCount - 1} 个图层` : '空项目 · 等待导入';
      button.append(title, info); button.title = project.error || project.name;
      button.addEventListener('click', () => openProject(project.name)); $('projectList').append(button);
    }
    syncControls();
  }
  async function refreshProjects() {
    try {
      if (location.protocol === 'file:') throw new Error('请双击“打开空间场景.cmd”启用项目功能；当前仍可使用游客模式。');
      const data = await api('/api/projects'); projects = data.projects; serverAvailable = true;
      $('projectRoot').textContent = data.root;
      $('projectStatus').textContent = projects.length ? `${projects.length} 个项目` : '还没有项目';
      renderProjects();
    } catch (error) {
      serverAvailable = false;
      $('projectStatus').textContent = error.message === 'Failed to fetch' ? '项目服务未连接，请重新运行“打开空间场景.cmd”。游客模式仍可用。' : error.message;
      syncControls();
    }
  }
  async function showProject(project) {
    if (project.error) throw new Error(project.error);
    if (project.files.length) {
      const { files } = prepareFiles(project.files);
      const src = file => `./图/${encodeURIComponent(project.name)}/${file.name}?v=${project.revision}`;
      const overview = await decodeImage(src(files[0]));
      const layers = files.slice(1).map((file, i) => ({ id: file.name, name: file.name, src: src(file), depth: i / Math.max(1, files.length - 2) }));
      if (!(await loadScene({ id: `project:${project.name}:${project.revision}`, project: true, overview: src(files[0]), width: overview.naturalWidth, height: overview.naturalHeight, strength: 60, layers }))) return false;
      releaseImages();
    } else clearScene();
    state.project = project; document.querySelector('.projects-panel').classList.remove('expanded'); $('projectToggle').setAttribute('aria-expanded', 'false'); syncControls(); return true;
  }
  async function openProject(name) {
    if (importBusy) return;
    importBusy = true; syncControls(); $('loading').hidden = false; $('loadingText').textContent = '正在打开项目…';
    try { await showProject(await api(`/api/projects/${encodeURIComponent(name)}`)); }
    catch (error) { notify(error.message); }
    finally { importBusy = false; $('loading').hidden = true; syncControls(); }
  }
  $('refreshProjects').addEventListener('click', refreshProjects);
  $('guestMode').addEventListener('click', () => {
    if (!importBusy) { document.querySelector('.projects-panel').classList.remove('expanded'); $('projectToggle').setAttribute('aria-expanded', 'false'); }
    if (importBusy || !state.project) return;
    state.project = null; clearScene(); syncControls();
    notify('已切换到游客模式。导入图片不会保存到项目目录。');
  });
  $('newProjectForm').addEventListener('submit', async event => {
    event.preventDefault(); if (importBusy || !serverAvailable) return;
    importBusy = true; syncControls();
    try {
      const project = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('projectName').value }) });
      await showProject(project); $('projectName').value = ''; await refreshProjects();
      notify(`已创建项目「${project.name}」，现在可以导入整图和图层。`);
    } catch (error) { notify(error.message); }
    finally { importBusy = false; syncControls(); }
  });
  function confirmReplacement(name) {
    return new Promise(resolve => {
      const dialog = $('replaceDialog'); dialog.returnValue = '';
      $('replaceMessage').textContent = `将用本次选择的整图和图层替换项目「${name}」中的全部图片。取消会保留原图片。`;
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'replace'), { once: true });
      dialog.showModal(); $('cancelReplace').focus();
    });
  }
  $('cancelReplace').addEventListener('click', () => $('replaceDialog').close('cancel'));
  $('confirmReplace').addEventListener('click', () => $('replaceDialog').close('replace'));
  let dragDepth = 0;
  document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true; importFiles(event.dataTransfer.files); } });
  $('viewer').addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; } });
  $('viewer').addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; });
  $('openExport').addEventListener('click', () => { $('exportStatus').textContent = ''; $('exportDialog').showModal(); });
  $('closeExport').addEventListener('click', () => { if (!importBusy) $('exportDialog').close(); });
  $('exportDialog').addEventListener('cancel', event => { if (importBusy) event.preventDefault(); });
  function capturePNG() {
    const scale = Math.min(1, 4096 / Math.max(state.scene.width, state.scene.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(state.scene.width * scale); canvas.height = Math.round(state.scene.height * scale);
    const ctx = canvas.getContext('2d'); B.draw(ctx, canvas.width, canvas.height, state.background, state.backgroundImage);
    if (state.comparing) ctx.drawImage($('overviewImage'), 0, 0, canvas.width, canvas.height);
    else if (renderer.available) {
      const view = { ...state.current, strength: state.enabled ? state.strength : 0, width: state.width, height: state.height, aspect: state.scene.width / state.scene.height, wave: state.mode === 'auto' && !reducedMotion.matches ? Math.sin(performance.now() / 1100) : 0 };
      try { renderer.render(state.layers, { ...view, width: canvas.width, height: canvas.height, pixelRatio: 1 }); ctx.drawImage($('meshCanvas'), 0, 0); }
      finally { renderer.render(state.layers, view); }
    } else {
      C.drawFlat(ctx, state.layers, { ...state.current, strength: state.enabled ? state.strength : 0 });
    }
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败。')), 'image/png'));
  }
  async function exportScene(kind) {
    if (!state.scene || importBusy || editor.editing) return;
    importBusy = true; syncControls();
    const buttons = ['exportHTML', 'exportScenePNG', 'exportPNG', 'closeExport']; buttons.forEach(id => { $(id).disabled = true; });
    $('exportStatus').textContent = '正在打包…';
    try {
      const title = state.project?.name || '空间场景', filename = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      // Capture before asynchronous image reads so a PNG represents this exact view.
      const picture = kind !== 'html' ? await capturePNG() : null;
      if (kind === 'png') window.SceneExport.download(picture, `${filename}.png`);
      else {
        const config = JSON.parse(JSON.stringify(settings()));
        const packet = { format: 'spatial-scene', version: 1, title, width: config.width, height: config.height, strength: config.strength, enabled: config.enabled, background: config.background, overview: await window.SceneExport.imageData(state.scene.overview), layers: [] };
        for (let i = 0; i < state.layers.length; i++) {
          const layer = state.layers[i]; packet.layers.push({ ...config.layers[i], src: await window.SceneExport.imageData(layer.src) });
          $('exportStatus').textContent = `正在打包图层 ${i + 1} / ${state.layers.length}…`;
        }
        if (kind === 'html') window.SceneExport.download(new Blob([window.SceneExport.html(packet)], { type: 'text/html;charset=utf-8' }), `${filename}-互动场景.html`);
        else {
          const png = window.ScenePackage.embed(new Uint8Array(await picture.arrayBuffer()), packet);
          window.SceneExport.download(new Blob([png], { type: 'image/png' }), `${filename}-场景.png`);
        }
      }
      $('exportStatus').textContent = kind === 'html' ? '已导出。用浏览器打开 HTML 即可互动。' : kind === 'scene' ? '已导出。将场景 PNG 拖回本工具即可恢复。' : '静态图片已导出。';
    } catch (error) { $('exportStatus').textContent = error.message || '导出失败，请重试。'; }
    finally { importBusy = false; buttons.forEach(id => { $(id).disabled = false; }); syncControls(); }
  }
  $('exportHTML').addEventListener('click', () => exportScene('html'));
  $('exportScenePNG').addEventListener('click', () => exportScene('scene'));
  $('exportPNG').addEventListener('click', () => exportScene('png'));
  $('exportConfig').addEventListener('click', () => {
    if (!state.scene) return;
    const blob = new Blob([JSON.stringify(settings(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'scene-parameters.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); notify('已导出深度与效果设置，可通过“载入参数”恢复。');
  });
  $('importConfig').addEventListener('click', () => $('configInput').click());
  $('configInput').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file || !state.scene || importBusy) return;
    importBusy = true; syncControls();
    try {
      if (file.size > 220 * 1024 * 1024) throw new Error('配置文件过大。');
      const config = JSON.parse(await file.text()); await applySettings(config, true);
      state.comparing = false; $('scenePlane').replaceChildren(...state.layers.map(layer => layer.element)); state.layers.forEach(updateLayer); editor.setLayers(state.layers); setInspector('layers'); renderLayerList(); syncControls(); await persist(); notify('已载入场景配置。');
    } catch (error) { notify(error instanceof SyntaxError ? '这不是有效的 JSON 配置文件。' : error.message); }
    finally { importBusy = false; syncControls(); }
  });
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('pagehide', () => editor.finishStroke());
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(frameId); if (!document.hidden) { lastTime = 0; frameId = requestAnimationFrame(tick); } });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches && state.mode === 'auto') setMode('pointer'); });
  syncControls(); refreshProjects(); frameId = requestAnimationFrame(tick);
})();
