(async () => {
  'use strict';
  const $ = id => document.getElementById(id), data = JSON.parse($('sceneData').textContent);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let auto = !reduced.matches && data.enabled, flat = false, target = { x: 0, y: 0 }, current = { x: 0, y: 0 }, frame, last = 0, dragging = false, width = 1, height = 1, tilt;
  async function decode(src) { const image = new Image(); image.src = src; await image.decode(); return image; }
  try {
    const layers = await Promise.all(data.layers.map(async item => ({ ...item, name: item.id, deform: MeshMath.readDeform(item.deform), mask: LayerMask.read(item.mask), element: await decode(item.src) })));
    const overview = await decode(data.overview); overview.className = 'overview'; $('frame').append(overview); overview.hidden = true;
    const background = SceneBackground.read(data.background);
    if (background.type === 'image') await decode(background.src);
    SceneBackground.apply($('frame'), background);
    function fallback() { flat = true; auto = false; tilt?.stop(); $('status').textContent = '当前浏览器不支持互动显示，已显示整图'; $('stage').dataset.state = 'fallback'; $('canvas').hidden = true; overview.hidden = false; $('compare').hidden = true; $('sensor').hidden = true; }
    const renderer = new MeshRenderer($('canvas'), fallback); renderer.setLayers(layers, data.width / data.height);
    new ResizeObserver(resize).observe($('stage')); resize();
    if (!renderer.available) { fallback(); return; }
    function resize() { const size = SceneMath.fitSize($('stage').clientWidth - 24, $('stage').clientHeight - 24, data.width / data.height); width = size.width; height = size.height; $('frame').style.width = width + 'px'; $('frame').style.height = height + 'px'; }
    function controls() { $('compare').setAttribute('aria-pressed', String(flat)); overview.hidden = !flat; $('canvas').hidden = flat; }
    let hideTimer, statusTimer;
    const buttons = [$('compare'), $('sensor')];
    function showControls() {
      clearTimeout(hideTimer); buttons.forEach(button => button.classList.remove('controls-hidden'));
      hideTimer = setTimeout(() => buttons.forEach(button => button.classList.add('controls-hidden')), 3000);
    }
    tilt = SceneTilt.create({
      onPosition: position => { if (!dragging) target = position; },
      onStatus: (status, message) => {
        if (status === 'active') message = '倾斜手机即可查看；轻点画面可重新校准。';
        const enabled = status === 'waiting' || status === 'active';
        if (enabled) auto = false;
        $('sensor').setAttribute('aria-pressed', String(enabled));
        $('sensor').setAttribute('aria-label', enabled ? '关闭倾斜感应' : '开启倾斜感应');
        $('sensor').title = enabled ? '关闭倾斜感应' : '开启倾斜感应';
        $('sensor').disabled = status === 'requesting';
        $('sensor').dataset.state = status;
        clearTimeout(statusTimer); $('status').textContent = message;
        $('status').classList.toggle('sensor-message', !!message);
        if (message) statusTimer = setTimeout(() => $('status').classList.remove('sensor-message'), 5000);
      }
    });
    document.addEventListener('click', showControls);
    document.addEventListener('keydown', showControls);
    for (const button of buttons) {
      button.addEventListener('focus', showControls);
      button.addEventListener('pointerdown', e => e.stopPropagation());
      button.addEventListener('keydown', e => e.stopPropagation());
    }
    $('sensor').addEventListener('click', () => {
      if (tilt.running) { tilt.stop(); target = { x: 0, y: 0 }; }
      else void tilt.start({ requestPermission: true });
    });
    function move(event) { target = SceneMath.pointerPosition(event.clientX, event.clientY, $('stage').getBoundingClientRect()); }
    $('stage').addEventListener('pointerdown', e => { if (e.button !== 0 || !e.isPrimary) return; auto = false; dragging = true; $('stage').setPointerCapture(e.pointerId); move(e); controls(); });
    $('stage').addEventListener('pointermove', e => { if (e.target.closest('button')) return; if (dragging || e.pointerType === 'mouse' && !tilt.running) { auto = false; move(e); controls(); } });
    function end() { if (!dragging) return; dragging = false; target = { x: 0, y: 0 }; tilt.recenter(); }
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('stage').addEventListener(event, end);
    $('stage').addEventListener('pointerleave', () => { if (!dragging && !tilt.running) target = { x: 0, y: 0 }; });
    $('stage').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
      e.preventDefault(); auto = false;
      if (e.key === 'Home') { target = { x: 0, y: 0 }; tilt.recenter(); }
      else { tilt.stop(); target.x = SceneMath.clamp(target.x + (e.key === 'ArrowRight' ? .25 : e.key === 'ArrowLeft' ? -.25 : 0)); target.y = SceneMath.clamp(target.y + (e.key === 'ArrowDown' ? .25 : e.key === 'ArrowUp' ? -.25 : 0)); }
      controls();
    });
    $('compare').onclick = () => { flat = !flat; controls(); };
    function tick(time) {
      const delta = Math.min(50, time - (last || time)); last = time;
      if (auto) target = { x: Math.sin(time / 2800) * .82, y: Math.cos(time / 3700) * .6 };
      const ease = 1 - Math.exp(-delta / 135); current.x += (target.x - current.x) * ease; current.y += (target.y - current.y) * ease;
      if (!flat) renderer.render(layers, { ...current, strength: data.enabled ? data.strength : 0, width, height, aspect: data.width / data.height, wave: auto && !reduced.matches ? Math.sin(time / 1100) : 0 });
      frame = requestAnimationFrame(tick);
    }
    controls(); $('compare').hidden = false; showControls(); $('stage').dataset.state = 'ready'; $('status').textContent = '';
    $('sensor').hidden = !data.enabled || !SceneTilt.isMobile();
    if (!$('sensor').hidden && !reduced.matches) void tilt.start();
    document.addEventListener('visibilitychange', () => { cancelAnimationFrame(frame); if (!document.hidden) { last = 0; frame = requestAnimationFrame(tick); } });
    reduced.addEventListener('change', () => { if (reduced.matches) { auto = false; controls(); } });
    frame = requestAnimationFrame(tick);
  } catch { $('stage').dataset.state = 'error'; $('status').className = 'error'; $('status').textContent = '图片加载失败，文件可能不完整。'; }
})();
