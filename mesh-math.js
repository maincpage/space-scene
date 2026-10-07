(function (root) {
  'use strict';
  const GRID = 25, MAX_PINS = 12;
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const smooth = n => n * n * (3 - 2 * n);
  function defaults() { return { volume: 0, bend: 0, radius: .22, pins: [], relief: Array(GRID * GRID).fill(0) }; }
  function readDeform(value) {
    if (value === undefined) return defaults();
    const d = value;
    if (!d || !Number.isFinite(d.volume) || !Number.isFinite(d.bend) || !Number.isFinite(d.radius) ||
        !Array.isArray(d.pins) || d.pins.length > MAX_PINS || d.pins.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) ||
        !Array.isArray(d.relief) || d.relief.length !== GRID * GRID || d.relief.some(n => !Number.isFinite(n) || n < -1 || n > 1)) throw new Error('钉点或变形参数无效。');
    return { volume: clamp(d.volume), bend: clamp(d.bend), radius: clamp(d.radius, .1, .6), pins: d.pins.map(p => ({ x: p.x, y: p.y })), relief: d.relief.slice() };
  }
  function sample(values, u, v) {
    const x = clamp(u) * (GRID - 1), y = clamp(v) * (GRID - 1), ix = Math.min(GRID - 2, Math.floor(x)), iy = Math.min(GRID - 2, Math.floor(y));
    const fx = x - ix, fy = y - iy, at = iy * GRID + ix;
    return (values[at] * (1 - fx) + values[at + 1] * fx) * (1 - fy) + (values[at + GRID] * (1 - fx) + values[at + GRID + 1] * fx) * fy;
  }
  function paint(values, u, v, radius, amount, erase = false, aspect = 1) {
    const ax = aspect >= 1 ? aspect : 1, ay = aspect < 1 ? 1 / aspect : 1;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const distance = Math.hypot((x / (GRID - 1) - u) * ax, (y / (GRID - 1) - v) * ay);
      if (distance >= radius) continue;
      const weight = smooth(1 - distance / radius), i = y * GRID + x;
      values[i] = erase ? values[i] * (1 - weight * Math.abs(amount) * 3) : clamp(values[i] + amount * weight, -1, 1);
    }
  }
  function field(u, v, deform, aspect = 1) {
    let distance = Infinity;
    for (const pin of deform.pins) distance = Math.min(distance, Math.hypot((u - pin.x) * Math.max(1, aspect), (v - pin.y) * Math.max(1, 1 / aspect)));
    return { distance, mobility: smooth(clamp(distance / deform.radius)), height: deform.volume * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + sample(deform.relief, u, v) };
  }
  function project(u, v, baked, depth, bend, view) {
    const s = clamp(view.strength / 100), x = clamp(view.x, -1, 1), y = clamp(view.y, -1, 1);
    if (!s) return { x: u, y: v };
    const factor = .033 * s * (.12 + .88 * clamp(depth));
    const z = baked.height;
    let dx = (u - .5) * .075 * s - x * factor - x * z * .04 * s;
    let dy = (v - .5) * .075 * s - y * factor - y * z * .04 * s;
    const curve = Math.sin(v * Math.PI) * Math.sin(u * Math.PI);
    dx += bend * s * (x * .035 * Math.sin(v * Math.PI * 1.5) + (view.wave || 0) * .008 * curve);
    dy += bend * s * y * .025 * curve;
    dx *= baked.mobility; dy *= baked.mobility;
    // Bound the displacement near anchors so a strong effect cannot tear across a pin.
    const length = Math.hypot(dx * Math.max(1, view.aspect || 1), dy * Math.max(1, 1 / (view.aspect || 1)));
    const limit = Math.min(1, baked.distance * .65 / Math.max(1e-9, length));
    return { x: u + dx * limit, y: v + dy * limit };
  }
  function buildMesh(deform, aspect = 1, segments = 32) {
    // Insert exact pin coordinates in both axes: pins are real mesh vertices.
    const axis = key => [...new Set([...Array.from({ length: segments + 1 }, (_, i) => i / segments), ...deform.pins.map(p => p[key])])].sort((a, b) => a - b);
    const xs = axis('x'), ys = axis('y'), nodes = [], triangles = [];
    for (const v of ys) for (const u of xs) nodes.push({ u, v, ...field(u, v, deform, aspect) });
    for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
      const a = y * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1;
      triangles.push(a, b, c, b, d, c);
    }
    return { nodes, indices: new Uint16Array(triangles) };
  }
  const api = { GRID, MAX_PINS, defaults, readDeform, sample, paint, field, project, buildMesh };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MeshMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
