(() => {
  'use strict';
  const $ = id => document.getElementById(id), M = window.MeshMath, K = window.LayerMask;
  class LayerEditor {
    constructor(options) {
      Object.assign(this, options); this.layers = []; this.selected = null; this.editing = false; this.tool = 'pin'; this.pin = -1; this.history = new Map(); this.stroke = null;
      this.zoom = 1; this.pan = { x: 0, y: 0 }; this.hand = false; this.space = false; this.viewDrag = null;
      this.mode = 'deform'; this.maskTool = 'hide'; this.maskHistory = new Map(); this.cursor = null;
      $('maskLayer').addEventListener('change', event => this.select(event.target.value, 'mask'));
      $('editMask').addEventListener('click', () => { this.mode = 'mask'; this.setEditing(!this.editing); });
      document.querySelectorAll('[data-mask-tool]').forEach(button => button.addEventListener('click', () => { this.mode = 'mask'; this.maskTool = button.dataset.maskTool; this.hand = false; this.setEditing(true); }));
      for (const id of ['maskSize', 'maskHardness', 'maskOpacity']) $(id).addEventListener('input', () => this.sync());
      $('maskSolo').addEventListener('change', () => this.onMode());
      $('maskEnabled').addEventListener('change', event => this.changeMask(mask => { mask.enabled = event.target.checked; }));
      $('maskRevealAll').addEventListener('click', () => this.fillMask(1));
      $('maskHideAll').addEventListener('click', () => this.fillMask(0));
      $('maskInvert').addEventListener('click', () => this.changeMask(mask => K.invert(mask)));
      $('removeMask').addEventListener('click', () => { if (!this.layer()?.mask) return; this.rememberMask(); this.layer().mask = null; this.maskChanged(); });
      $('undoMask').addEventListener('click', () => this.undoMask());
      $('zoomIn').addEventListener('click', () => this.setZoom(this.zoom * 1.25));
      $('zoomOut').addEventListener('click', () => this.setZoom(this.zoom / 1.25));
      $('fitView').addEventListener('click', () => this.resetView());
      $('focusLayer').addEventListener('click', () => this.focusLayer());
      $('panTool').addEventListener('click', () => { this.hand = !this.hand; this.applyView(); });
      $('stage').addEventListener('wheel', event => {
        if (!this.editing || this.disabled) return;
        event.preventDefault(); event.stopPropagation(); if (this.stroke || this.viewDrag) return;
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
        this.setZoom(this.zoom * Math.exp(-delta * .0015), event.clientX, event.clientY);
      }, { passive: false });
      $('stage').addEventListener('pointerdown', event => {
        if (!this.editing || this.disabled || !event.isPrimary || !(event.button === 1 || (event.button === 0 && (this.hand || this.space)))) return;
        event.preventDefault(); event.stopImmediatePropagation(); $('editOverlay').focus({ preventScroll: true });
        this.viewDrag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...this.pan } };
        $('stage').setPointerCapture(event.pointerId); this.applyView();
      }, true);
      $('stage').addEventListener('pointermove', event => {
        if (this.viewDrag?.pointer !== event.pointerId) return;
        event.preventDefault(); event.stopImmediatePropagation();
        this.pan = { x: this.viewDrag.pan.x + event.clientX - this.viewDrag.x, y: this.viewDrag.pan.y + event.clientY - this.viewDrag.y }; this.applyView();
      }, true);
      const endViewDrag = event => {
        if (this.viewDrag?.pointer !== event.pointerId) return;
        event.stopImmediatePropagation(); this.viewDrag = null; this.applyView();
      };
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('stage').addEventListener(name, endViewDrag, true);
      document.addEventListener('keyup', event => { if (event.code === 'Space' && this.space) { this.space = false; this.applyView(); } });
      window.addEventListener('blur', () => { this.finishStroke(); this.space = false; this.viewDrag = null; this.applyView(); });
      $('editLayer').addEventListener('change', event => this.select(event.target.value, 'deform'));
      $('editMesh').addEventListener('click', () => { this.mode = 'deform'; this.setEditing(!this.editing); });
      $('finishEdit').addEventListener('click', () => this.setEditing(false));
      document.querySelectorAll('[data-edit-tool]').forEach(button => button.addEventListener('click', () => { this.mode = 'deform'; this.tool = button.dataset.editTool; this.hand = false; this.setEditing(true); }));
      for (const [id, key, scale] of [['volume', 'volume', 100], ['bend', 'bend', 100], ['pinRadius', 'radius', 100]]) {
        $(id).addEventListener('input', event => {
          const layer = this.layer(); if (!layer) return;
          this.remember(); layer.deform[key] = Number(event.target.value) / scale; this.changed();
        });
      }
      document.querySelectorAll('[data-deform-preset]').forEach(button => button.addEventListener('click', () => {
        const layer = this.layer(); if (!layer) return;
        this.remember(); const preset = button.dataset.deformPreset;
        layer.deform.volume = preset === 'volume' ? .65 : preset === 'soft' ? .2 : 0;
        layer.deform.bend = preset === 'soft' ? .75 : 0;
        if (preset === 'flat') layer.deform.relief.fill(0);
        this.changed();
      }));
      $('removePin').addEventListener('click', () => this.removePin());
      $('clearPins').addEventListener('click', () => { if (!this.layer()) return; this.remember(); this.layer().deform.pins = []; this.pin = -1; this.changed(); });
      $('resetDeform').addEventListener('click', () => { if (!this.layer()) return; this.remember(); this.layer().deform = M.defaults(); this.pin = -1; this.changed(); });
      $('undoDeform').addEventListener('click', () => {
        const snapshot = this.history.get(this.selected)?.pop(); if (!snapshot) return;
        this.layer().deform = snapshot; this.pin = -1; this.changed();
      });
      $('soloLayer').addEventListener('change', () => this.onMode());
      $('showMesh').addEventListener('change', () => this.draw());
      $('brushSize').addEventListener('input', () => this.sync());
      const overlay = $('editOverlay');
      overlay.addEventListener('pointerdown', event => {
        if (!this.editing || this.disabled || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.stopPropagation(); overlay.focus({ preventScroll: true });
        const p = this.point(event), layer = this.layer(); if (!layer) return;
        if (this.mode === 'mask') {
          if (layer.mask?.enabled === false) { this.notify('请先启用蒙版，再使用画笔。'); return; }
          const mask = layer.mask || K.defaults();
          if (mask.strokes.length >= K.MAX_STROKES || mask.strokes.reduce((n, s) => n + s.points.length, 0) >= K.MAX_POINTS) { this.notify('本层蒙版笔画已达上限，可撤销或全部显示后重画。'); return; }
          this.rememberMask(); layer.mask = mask;
          mask.strokes.push({ mode: this.maskTool, radius: Number($('maskSize').value) / 200, hardness: Number($('maskHardness').value) / 100, opacity: Number($('maskOpacity').value) / 100, points: [] });
          this.stroke = { pointer: event.pointerId, mask: true, count: mask.strokes.reduce((n, s) => n + s.points.length, 0) };
          this.paintMask(p); overlay.setPointerCapture(event.pointerId); return;
        }
        this.remember();
        if (this.tool === 'pin') {
          const rect = overlay.getBoundingClientRect();
          let closest = -1, best = 18;
          layer.deform.pins.forEach((pin, i) => { const d = Math.hypot((pin.x - p.x) * rect.width, (pin.y - p.y) * rect.height); if (d < best) { best = d; closest = i; } });
          if (closest < 0) {
            if (layer.deform.pins.length >= M.MAX_PINS) { this.notify(`每层最多 ${M.MAX_PINS} 个钉点。`); return; }
            closest = layer.deform.pins.push(p) - 1;
          }
          this.pin = closest; this.stroke = { pointer: event.pointerId, pin: closest, last: p };
          this.changed();
        } else { this.stroke = { pointer: event.pointerId, pin: -1, last: p }; this.paintAt(p); }
        overlay.setPointerCapture(event.pointerId);
      });
      overlay.addEventListener('pointermove', event => {
        if (this.editing && this.mode === 'mask') { this.cursor = this.point(event); if (!this.stroke) this.draw(); }
        if (!this.stroke || this.stroke.pointer !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const p = this.point(event);
        if (this.stroke.mask) { this.paintMask(p); return; }
        if (this.stroke.pin >= 0) { this.layer().deform.pins[this.stroke.pin] = p; this.changed(); }
        else {
          const previous = this.stroke.last, distance = Math.hypot(p.x - previous.x, p.y - previous.y);
          const steps = Math.max(1, Math.min(30, Math.ceil(distance / .012)));
          for (let i = 1; i <= steps; i++) this.paintAt({ x: previous.x + (p.x - previous.x) * i / steps, y: previous.y + (p.y - previous.y) * i / steps }, false);
          this.changed();
        }
        this.stroke.last = p;
      });
      overlay.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); });
      const end = event => { if (this.stroke?.pointer !== event.pointerId) return; event.stopPropagation(); this.finishStroke(); };
      overlay.addEventListener('pointerup', end); overlay.addEventListener('pointercancel', end); overlay.addEventListener('lostpointercapture', end);
      overlay.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.code === 'Space') { event.preventDefault(); this.space = true; this.applyView(); return; }
        if (['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); if (event.key === '0') this.resetView(); else this.setZoom(this.zoom * (event.key === '-' ? .8 : 1.25)); return; }
        if (this.mode === 'mask') {
          if (event.key === 'Escape') this.setEditing(false);
          if (event.key.toLowerCase() === 'x') { event.preventDefault(); this.maskTool = this.maskTool === 'hide' ? 'reveal' : 'hide'; this.sync(); this.onMode(); }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); this.undoMask(); }
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.removePin(); }
        if (event.key === 'Escape') this.setEditing(false);
        const p = this.layer()?.deform.pins[this.pin];
        if (p && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); this.remember(); const step = event.shiftKey ? .02 : .005 / this.zoom;
          p.x = Math.min(1, Math.max(0, p.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)));
          p.y = Math.min(1, Math.max(0, p.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0))); this.changed();
        }
      });
    }
    layer() { return this.layers.find(layer => layer.id === this.selected); }
    finishStroke() { const mask = this.stroke?.mask; this.stroke = null; if (mask) this.onCommit?.(); }
    rememberMask() {
      const layer = this.layer(); if (!layer) return;
      const list = this.maskHistory.get(layer.id) || []; list.push(K.read(layer.mask));
      if (list.length > 30) list.shift(); this.maskHistory.set(layer.id, list);
    }
    undoMask() {
      this.finishStroke(); const list = this.maskHistory.get(this.selected); if (!list?.length) return;
      this.layer().mask = list.pop(); this.maskChanged();
    }
    changeMask(fn) { if (!this.layer()?.mask) return; this.finishStroke(); this.rememberMask(); fn(this.layer().mask); this.maskChanged(); }
    fillMask(base) {
      if (!this.layer()) return; this.finishStroke(); this.rememberMask();
      this.layer().mask = { ...K.defaults(), base }; this.maskChanged();
    }
    paintMask(p) {
      if (this.stroke.count >= K.MAX_POINTS) return;
      const points = this.layer().mask.strokes.at(-1).points, point = [Number(p.x.toFixed(6)), Number(p.y.toFixed(6))];
      const last = points.at(-1); if (last && last[0] === point[0] && last[1] === point[1]) return;
      points.push(point); this.stroke.count++; this.cursor = p; this.maskChanged();
    }
    maskChanged() { this.onChange(this.layer(), 'mask'); this.sync(); }
    importMask(mask) { if (!this.layer()) return; this.finishStroke(); this.rememberMask(); this.layer().mask = mask; this.maskChanged(); }
    setLayers(layers) {
      this.maskHistory.clear(); this.mode = 'deform'; this.cursor = null;
      this.layers = layers; this.history.clear(); this.selected = layers[0]?.id || null; this.pin = -1; this.editing = false; this.stroke = null;
      this.zoom = 1; this.pan = { x: 0, y: 0 }; this.hand = this.space = false; this.viewDrag = null;
      $('editLayer').replaceChildren(...layers.map(layer => { const option = document.createElement('option'); option.value = layer.id; option.textContent = layer.name; return option; }));
      $('maskLayer').replaceChildren(...layers.map(layer => { const option = document.createElement('option'); option.value = layer.id; option.textContent = layer.name; return option; }));
      this.sync();
    }
    select(id, mode = this.mode) { this.finishStroke(); this.selected = id; this.mode = mode; this.pin = -1; this.cursor = null; this.setEditing(true); }
    setEditing(value) {
      this.finishStroke();
      this.editing = !!value && !!this.layer() && !this.disabled; this.stroke = null; this.viewDrag = null;
      if (this.editing && this.mode === 'mask' && !this.layer().mask) { this.rememberMask(); this.layer().mask = K.defaults(); this.onChange(this.layer(), 'mask'); }
      if (!this.editing) { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.hand = this.space = false; }
      this.sync(); this.onMode();
    }
    resetView() { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.applyView(); }
    setZoom(value, clientX, clientY) {
      const next = Math.min(8, Math.max(.5, value)), ratio = next / this.zoom, r = $('stage').getBoundingClientRect();
      const x = clientX === undefined ? 0 : clientX - r.left - r.width / 2, y = clientY === undefined ? 0 : clientY - r.top - r.height / 2;
      this.pan = { x: x - (x - this.pan.x) * ratio, y: y - (y - this.pan.y) * ratio }; this.zoom = next; this.applyView();
    }
    focusLayer() {
      const b = this.layer()?.thumbnail?.bounds; if (!b) return;
      const { width, height } = this.size(), stage = $('stage');
      this.zoom = Math.max(.5, Math.min(8, .9 * (stage.clientWidth - 24) / (width * b.width), .9 * (stage.clientHeight - 24) / (height * b.height)));
      this.pan = { x: (.5 - b.x - b.width / 2) * width * this.zoom, y: (.5 - b.y - b.height / 2) * height * this.zoom }; this.applyView();
    }
    applyView() {
      const frame = $('artFrame'), stage = $('stage'), { width, height } = this.size();
      const scale = this.editing ? this.zoom : 1;
      frame.style.width = `${width * scale}px`; frame.style.height = `${height * scale}px`;
      const limitX = Math.max(0, (width * this.zoom + stage.clientWidth) / 2 - 40), limitY = Math.max(0, (height * this.zoom + stage.clientHeight) / 2 - 40);
      this.pan.x = Math.max(-limitX, Math.min(limitX, this.pan.x)); this.pan.y = Math.max(-limitY, Math.min(limitY, this.pan.y));
      frame.style.transform = this.editing ? `translate(${this.pan.x}px,${this.pan.y}px)` : 'none';
      $('editZoom').textContent = `${Math.round(this.zoom * 100)}%`; $('zoomOut').disabled = !!this.disabled || this.zoom <= .5; $('zoomIn').disabled = !!this.disabled || this.zoom >= 8;
      $('panTool').setAttribute('aria-pressed', String(this.hand));
      stage.classList.toggle('pan-mode', this.hand || this.space); stage.classList.toggle('panning', !!this.viewDrag);
      this.draw();
    }
    remember() {
      const layer = this.layer(); if (!layer) return;
      const list = this.history.get(layer.id) || []; list.push(M.readDeform(layer.deform)); if (list.length > 30) list.shift(); this.history.set(layer.id, list);
    }
    changed() { const layer = this.layer(); if (!layer) return; this.onChange(layer); this.sync(); }
    removePin() {
      const layer = this.layer(); if (!layer || this.pin < 0) return;
      this.remember(); layer.deform.pins.splice(this.pin, 1); this.pin = -1; this.changed();
    }
    point(event) { const r = $('editOverlay').getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) }; }
    paintAt(p, commit = true) {
      M.paint(this.layer().deform.relief, p.x, p.y, Number($('brushSize').value) / 100, this.tool === 'lower' ? -.1 : .1, this.tool === 'erase', this.aspect());
      if (commit) this.changed();
    }
    sync(disabled = this.disabled) {
      this.disabled = disabled; const layer = this.layer();
      const maskMode = this.mode === 'mask', mask = layer?.mask;
      $('maskEmpty').hidden = !!layer && !disabled;
      $('maskEmpty').textContent = layer ? '蒙版编辑需要开启浏览器硬件加速。' : '导入图片后可编辑图层蒙版。';
      $('maskControls').hidden = !layer;
      $('maskLayer').value = this.selected || '';
      document.querySelectorAll('#maskControls button,#maskControls input,#maskControls select').forEach(control => { control.disabled = !!disabled || !layer; });
      $('maskEnabled').checked = mask?.enabled !== false; $('maskEnabled').disabled ||= !mask;
      for (const id of ['maskInvert', 'removeMask']) $(id).disabled ||= !mask;
      $('undoMask').disabled ||= !this.maskHistory.get(this.selected)?.length;
      $('editMask').textContent = this.editing && maskMode ? '完成蒙版 · 预览' : mask ? '编辑蒙版' : '添加并编辑蒙版';
      $('editMask').setAttribute('aria-pressed', String(this.editing && maskMode));
      $('maskStatus').textContent = !mask ? '尚未添加蒙版' : `${mask.image ? '图片蒙版' : '蒙版'}${mask.enabled ? '已启用' : '已停用'}`;
      document.querySelectorAll('[data-mask-tool]').forEach(button => button.setAttribute('aria-pressed', String(this.editing && maskMode && button.dataset.maskTool === this.maskTool)));
      for (const id of ['maskSize', 'maskHardness', 'maskOpacity']) {
        const input = $(id); $(id + 'Value').textContent = `${input.value}%`; input.style.setProperty('--progress', `${(input.value - input.min) / (input.max - input.min) * 100}%`);
      }
      const preview = $('maskPreview'), ctx = preview.getContext('2d'), aspect = this.aspect();
      const pw = Math.min(preview.width, preview.height * aspect), ph = pw / aspect, px = (preview.width - pw) / 2, py = (preview.height - ph) / 2;
      ctx.fillStyle = '#242830'; ctx.fillRect(0, 0, preview.width, preview.height);
      ctx.fillStyle = mask ? '#000' : '#fff'; ctx.fillRect(px, py, pw, ph);
      if (mask) ctx.drawImage(K.canvas(mask, aspect), px, py, pw, ph);
      $('deformControls').hidden = !layer;
      $('editOverlay').hidden = !this.editing || disabled;
      $('editOverlay').setAttribute('aria-label', maskMode ? '蒙版画布：拖动隐藏或恢复图层，X 切换画笔，Ctrl 或 Command Z 撤销，Escape 完成编辑' : '编辑画布：点击添加钉点，拖动移动；方向键微调，Delete 删除，Escape 完成编辑');
      $('editViewTools').hidden = !this.editing; $('editViewTools').querySelectorAll('button').forEach(button => { button.disabled = !!disabled; });
      $('editMesh').textContent = this.editing ? '完成编辑 · 预览' : '编辑钉子 / 起伏';
      $('editMesh').setAttribute('aria-pressed', String(this.editing));
      $('editHint').textContent = this.editing ? '滚轮缩放 · 空格 / 中键拖动 · 0 适应画布' : '编辑后点击完成，查看动态效果';
      $('brushControls').hidden = this.tool === 'pin'; $('pinControls').hidden = this.tool !== 'pin';
      $('editLayer').value = this.selected || '';
      document.querySelectorAll('#deformControls button,#deformControls input,#deformControls select').forEach(control => { control.disabled = disabled || !layer; });
      document.querySelectorAll('[data-edit-tool]').forEach(button => button.setAttribute('aria-pressed', String(this.editing && button.dataset.editTool === this.tool)));
      if (!layer) { this.applyView(); return; }
      for (const [id, value] of [['volume', layer.deform.volume * 100], ['bend', layer.deform.bend * 100], ['pinRadius', layer.deform.radius * 100], ['brushSize', Number($('brushSize').value)]]) {
        $(id).value = Math.round(value); $(id + 'Value').textContent = `${Math.round(value)}%`;
        $(id).style.setProperty('--progress', `${(value - Number($(id).min)) / (Number($(id).max) - Number($(id).min)) * 100}%`);
      }
      $('removePin').disabled ||= this.pin < 0;
      $('clearPins').disabled ||= !layer.deform.pins.length;
      $('undoDeform').disabled ||= !this.history.get(this.selected)?.length;
      $('pinTotal').textContent = `${layer.deform.pins.length} / ${M.MAX_PINS}`;
      $('pinList').replaceChildren(...layer.deform.pins.map((p, i) => {
        const button = document.createElement('button'); button.textContent = `钉点 ${i + 1}`; button.className = 'pin-chip'; button.disabled = disabled;
        button.setAttribute('aria-pressed', String(i === this.pin));
        button.addEventListener('click', () => { this.pin = i; this.tool = 'pin'; this.hand = false; this.setEditing(true); $('editOverlay').focus({ preventScroll: true }); }); return button;
      }));
      this.applyView();
    }
    draw() {
      const canvas = $('editOverlay'), layer = this.layer(); if (canvas.hidden || !layer) return;
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2, 8192 / Math.max(rect.width, rect.height), Math.sqrt(16000000 / (rect.width * rect.height)));
      canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); const w = rect.width, h = rect.height;
      if (this.mode === 'mask') {
        if (this.cursor && !this.hand && !this.space) {
          ctx.beginPath(); ctx.arc(this.cursor.x * w, this.cursor.y * h, Number($('maskSize').value) / 200 * Math.min(w, h), 0, Math.PI * 2);
          ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = this.maskTool === 'hide' ? '#fff' : '#adffc7'; ctx.lineWidth = 1; ctx.stroke();
        }
        return;
      }
      if (this.tool !== 'pin') {
        const step = 1 / (M.GRID - 1);
        for (let y = 0; y < M.GRID; y++) for (let x = 0; x < M.GRID; x++) {
          const value = layer.deform.relief[y * M.GRID + x]; if (Math.abs(value) < .01) continue;
          ctx.fillStyle = value > 0 ? `rgba(255,160,60,${Math.abs(value) * .5})` : `rgba(60,160,255,${Math.abs(value) * .5})`;
          ctx.fillRect((x - .5) * step * w, (y - .5) * step * h, step * w + 1, step * h + 1);
        }
      }
      if ($('showMesh').checked) {
        ctx.beginPath(); ctx.strokeStyle = '#bacce140'; ctx.lineWidth = .6;
        for (let i = 0; i <= 24; i++) { const x = i / 24 * w, y = i / 24 * h; ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke();
      }
      layer.deform.pins.forEach((pin, i) => {
        const x = pin.x * w, y = pin.y * h;
        if (this.pin === i) { ctx.beginPath(); ctx.arc(x, y, layer.deform.radius * Math.min(w, h), 0, Math.PI * 2); ctx.fillStyle = '#77baff12'; ctx.fill(); ctx.strokeStyle = '#9ac9ff80'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = this.pin === i ? '#f5ca76' : '#b8d5ff'; ctx.fill(); ctx.strokeStyle = '#202836'; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.strokeText(String(i + 1), x + 10, y - 9); ctx.fillText(String(i + 1), x + 10, y - 9);
      });
    }
  }
  window.LayerEditor = LayerEditor;
})();
