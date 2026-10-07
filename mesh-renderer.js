(() => {
  'use strict';
  class MeshRenderer {
    constructor(canvas, onFailure) {
      this.canvas = canvas; this.onFailure = onFailure; this.resources = new Map(); this.available = false;
      try {
        const gl = this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
        if (!gl) throw new Error('WebGL unavailable');
        const shader = (type, source) => {
          const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
          if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
          return result;
        };
        const vs = shader(gl.VERTEX_SHADER, 'attribute vec2 position; attribute vec2 uv; varying vec2 textureUV; void main(){textureUV=uv;gl_Position=vec4(position.x*2.0-1.0,1.0-position.y*2.0,0.0,1.0);}');
        const fs = shader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D image; uniform sampler2D mask; uniform sampler2D clip; uniform float clipped; uniform vec2 resolution; varying vec2 textureUV; void main(){float a=clipped>0.5?texture2D(clip,gl_FragCoord.xy/resolution).a:1.0;gl_FragColor=texture2D(image,textureUV)*texture2D(mask,textureUV).a*a;}');
        const program = this.program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
        gl.deleteShader(vs); gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        this.position = gl.getAttribLocation(program, 'position'); this.uv = gl.getAttribLocation(program, 'uv');
        gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'mask'), 1);
        gl.uniform1i(gl.getUniformLocation(program, 'clip'), 2);
        this.clipped = gl.getUniformLocation(program, 'clipped'); this.resolution = gl.getUniformLocation(program, 'resolution');
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        this.available = true;
      } catch { this.available = false; }
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.fail(); });
      // Reloading creates fresh textures and a coherent editor after a GPU reset.
    }
    fail() { if (!this.available) return; this.available = false; this.clear(); this.onFailure(); }
    clear() {
      if (!this.gl) return;
      for (const item of this.resources.values()) { this.gl.deleteTexture(item.texture); this.gl.deleteTexture(item.maskTexture); this.gl.deleteTexture(item.clipTexture); this.gl.deleteFramebuffer(item.framebuffer); this.gl.deleteBuffer(item.vertices); this.gl.deleteBuffer(item.indices); }
      this.resources.clear();
    }
    setLayers(layers, aspect) {
      window.LayerClip.validate(layers);
      this.clear(); this.aspect = aspect;
      if (!this.available) return;
      const gl = this.gl;
      try {
        for (const layer of layers) {
          const texture = gl.createTexture(), vertices = gl.createBuffer(), indices = gl.createBuffer();
          const item = { texture, vertices, indices, maskTexture: gl.createTexture() }; this.resources.set(layer.id, item);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          // Cap texture memory for up to twenty full-size transparent layers.
          const budget = 2 ** Math.floor(Math.log2(Math.sqrt(24 * 1024 * 1024 / layers.length)));
          const max = Math.min(4096, budget, gl.getParameter(gl.MAX_TEXTURE_SIZE));
          const scale = Math.min(1, max / Math.max(layer.element.naturalWidth, layer.element.naturalHeight));
          const width = Math.min(max, 2 ** Math.ceil(Math.log2(layer.element.naturalWidth * scale)));
          const height = Math.min(max, 2 ** Math.ceil(Math.log2(layer.element.naturalHeight * scale)));
          let source = layer.element;
          if (width !== source.naturalWidth || height !== source.naturalHeight) {
            source = document.createElement('canvas'); source.width = width; source.height = height;
            source.getContext('2d').drawImage(layer.element, 0, 0, source.width, source.height);
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          gl.generateMipmap(gl.TEXTURE_2D);
          this.update(layer);
        }
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Texture upload failed');
      } catch { this.fail(); }
    }
    update(layer) {
      const item = this.resources.get(layer.id); if (!item || !this.available) return;
      this.updateMask(layer);
      item.mesh = window.MeshMath.buildMesh(layer.deform, this.aspect);
      item.data = new Float32Array(item.mesh.nodes.length * 4);
      item.mesh.nodes.forEach((node, i) => { item.data[i * 4 + 2] = node.u; item.data[i * 4 + 3] = node.v; });
      const gl = this.gl; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, item.indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, item.mesh.indices, gl.STATIC_DRAW);
    }
    updateMask(layer) {
      const item = this.resources.get(layer.id); if (!item || !this.available) return;
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, item.maskTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (layer.mask?.enabled) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, window.LayerMask.canvas(layer.mask, this.aspect));
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.activeTexture(gl.TEXTURE0);
    }
    render(layers, view) {
      if (!this.available) return;
      const gl = this.gl, canvas = this.canvas, ratio = view.pixelRatio ?? Math.min(devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(view.width * ratio)), h = Math.max(1, Math.round(view.height * ratio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.clearColor(0, 0, 0, 0); gl.useProgram(this.program);
      const byId = new Map(layers.map(layer => [layer.id, layer]));
      const targets = new Set(layers.map(layer => layer.clipTo).filter(id => byId.has(id)));
      // Keep the combined offscreen clipping buffers within a bounded GPU budget.
      const scale = Math.min(1, gl.getParameter(gl.MAX_TEXTURE_SIZE) / Math.max(w, h), Math.sqrt(16 * 1024 * 1024 / Math.max(1, targets.size) / (w * h)));
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      for (const layer of layers) {
        const item = this.resources.get(layer.id); if (!item) continue;
        if (!targets.has(layer.id) && item.framebuffer) { gl.deleteTexture(item.clipTexture); gl.deleteFramebuffer(item.framebuffer); item.clipTexture = item.framebuffer = null; }
        item.mesh.nodes.forEach((node, i) => {
          const p = window.MeshMath.project(node.u, node.v, node, layer.depth, layer.deform.bend, view);
          item.data[i * 4] = p.x; item.data[i * 4 + 1] = p.y;
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, item.vertices); gl.bufferData(gl.ARRAY_BUFFER, item.data, gl.DYNAMIC_DRAW);
      }
      const draw = (layer, clipTexture, width, height) => {
        const item = this.resources.get(layer.id); if (!item) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, item.vertices);
        gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(this.uv); gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 16, 8);
        gl.uniform2f(this.resolution, width, height); gl.uniform1f(this.clipped, clipTexture ? 1 : 0);
        // Always bind a complete texture, including on drivers that validate unused samplers.
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, clipTexture || item.maskTexture);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, item.maskTexture);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, item.texture); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, item.indices);
        gl.drawElements(gl.TRIANGLES, item.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
      };
      const rendered = new Set(), visiting = new Set();
      const renderTarget = id => {
        const layer = byId.get(id), item = this.resources.get(id); if (!layer || !item) return null;
        if (rendered.has(id)) return item.clipTexture;
        if (visiting.has(id)) throw new Error('剪贴蒙版不能循环引用。');
        visiting.add(id);
        const parent = layer.clipTo ? renderTarget(layer.clipTo) : null;
        if (!item.framebuffer) { item.framebuffer = gl.createFramebuffer(); item.clipTexture = gl.createTexture(); item.clipWidth = item.clipHeight = 0; }
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, item.clipTexture);
        if (item.clipWidth !== cw || item.clipHeight !== ch) {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); item.clipWidth = cw; item.clipHeight = ch;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, item.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, item.clipTexture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('无法创建剪贴蒙版缓冲区。');
        gl.viewport(0, 0, cw, ch); gl.clear(gl.COLOR_BUFFER_BIT); draw(layer, parent, cw, ch);
        visiting.delete(id); rendered.add(id); return item.clipTexture;
      };
      try { for (const id of targets) renderTarget(id); }
      catch { gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.fail(); return; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
      for (const layer of layers) {
        if (view.solo ? layer.id !== view.solo : !layer.visible) continue;
        draw(layer, layer.clipTo ? this.resources.get(layer.clipTo)?.clipTexture : null, w, h);
      }
    }
  }
  window.MeshRenderer = MeshRenderer;
})();
