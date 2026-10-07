(function (root) {
  'use strict';
  const messages = {
    idle: '', permission: '轻点开启倾斜感应，并允许运动与方向访问。',
    requesting: '请在浏览器弹窗中允许运动与方向访问。',
    waiting: '正在等待感应，请自然握持手机。', active: '倾斜手机即可查看；改变握持姿势后可回正。',
    insecure: '倾斜感应需要 HTTPS 安全页面；当前仍可拖动画面。',
    unsupported: '当前浏览器不支持倾斜感应，仍可拖动画面。',
    denied: '未获得感应权限，请在浏览器设置中允许后重试；仍可拖动画面。',
    unavailable: '未收到感应数据，请用手机浏览器打开并检查运动权限；仍可拖动画面。'
  };
  function create({ onPosition, onStatus }) {
    let status = 'idle', running = false, baseline = null, timer, generation = 0;
    const report = value => { status = value; onStatus(value, messages[value]); };
    function angle() { return root.screen.orientation?.angle ?? root.orientation ?? 0; }
    function recenter() { baseline = null; if (running) onPosition({ x: 0, y: 0 }); }
    function receive(event) {
      if (!running || root.document.hidden || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      root.clearTimeout(timer);
      if (!baseline) baseline = { beta: event.beta, gamma: event.gamma };
      if (status !== 'active') report('active');
      onPosition(root.SceneMath.orientationPosition(event.beta, event.gamma, baseline, angle()));
    }
    function waitForData() {
      root.clearTimeout(timer);
      if (root.document.hidden) return;
      timer = root.setTimeout(() => { detach(); onPosition({ x: 0, y: 0 }); report('unavailable'); }, 5000);
    }
    function visibility() {
      root.clearTimeout(timer); recenter();
      if (!root.document.hidden && status === 'waiting') waitForData();
    }
    function detach() {
      running = false; baseline = null; root.clearTimeout(timer);
      root.removeEventListener('deviceorientation', receive);
      root.removeEventListener('orientationchange', recenter);
      root.screen.orientation?.removeEventListener('change', recenter);
      root.document.removeEventListener('visibilitychange', visibility);
    }
    function stop() { generation++; detach(); report('idle'); }
    async function start({ requestPermission = false } = {}) {
      const attempt = ++generation; detach();
      if (!root.isSecureContext) { report('insecure'); return false; }
      const Orientation = root.DeviceOrientationEvent;
      if (!Orientation) { report('unsupported'); return false; }
      if (typeof Orientation.requestPermission === 'function') {
        if (!requestPermission) { report('permission'); return false; }
        report('requesting');
        try {
          // Must run directly in the button's click handler, before any other await.
          const permission = await Orientation.requestPermission();
          if (attempt !== generation) return false;
          if (permission !== 'granted') { report('denied'); return false; }
        } catch { if (attempt === generation) report('denied'); return false; }
      }
      if (attempt !== generation) return false;
      running = true; report('waiting');
      root.addEventListener('deviceorientation', receive);
      root.addEventListener('orientationchange', recenter);
      root.screen.orientation?.addEventListener('change', recenter);
      root.document.addEventListener('visibilitychange', visibility);
      waitForData(); return true;
    }
    return { start, stop, recenter, get running() { return running; }, get status() { return status; } };
  }
  root.SceneTilt = { create, messages, isMobile: () => root.matchMedia('(pointer: coarse)').matches || root.navigator.maxTouchPoints > 0 };
})(typeof window !== 'undefined' ? window : globalThis);
