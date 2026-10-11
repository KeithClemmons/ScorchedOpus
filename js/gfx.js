'use strict';
/* =====================================================================
   Remastered renderer: the same battlefield, drawn at the display's own
   resolution. Sky and terrain come from a WebGL shader that reads the
   simulation's land bitmap (smooth, lit edges); tanks, weapons, particles
   and the interface are drawn on top with Canvas 2D (fx.js, vui.js).
   Nothing here changes the simulation. F2 switches back to the original
   pixel renderer at any time.
   ===================================================================== */

const Gfx = {
  modern: true,      // Remastered renderer on (false: the original VGA look)
  ok: null,          // WebGL2 available (null: not probed yet)
  canvas: null, ctx: null,
  dpr: 1, cw: 1, ch: 1,                     // display canvas size in device pixels
  pf: { x: 0, y: 0, w: 1, h: 1 },           // 4:3 playfield inside it
  sx: 1, sy: 1,                             // device pixels per sim column / row
  ux: 1, uy: 1,                             // device pixels per UI unit
  t: 0,                                     // animation clock (seconds)
  shake: 0, shakeX: 0, shakeY: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = Screen.ctx;
    const saved = Store.get('scorch.gfx', null);
    if (saved && saved.modern === false) this.modern = false;
    if (this.modern && !this.available()) this.modern = false;
    window.addEventListener('resize', () => this.resize());
    this.apply();
  },
  available() {
    if (this.ok === null) this.ok = Terra.init();
    return this.ok;
  },
  // switch renderers (F2)
  setModern(on) {
    if (on && !this.available()) { Toast.show('Remastered graphics need WebGL 2.'); return; }
    this.modern = !!on;
    Store.set('scorch.gfx', { modern: this.modern });
    this.apply();
  },
  apply() {
    Theme.use(this.modern);
    const c = this.canvas;
    if (this.modern) {
      c.style.imageRendering = 'auto';
      c.style.cursor = 'default';
      this.resize();
    } else {
      c.style.imageRendering = '';
      c.width = Screen.W; c.height = Screen.H;
      Screen.ui = Screen.pixelUi || Screen.ui;
      installCursor(c);
      Screen.fit();
    }
  },
  resize() {
    if (!this.modern || !this.canvas) return;
    const ww = window.innerWidth, wh = window.innerHeight;
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    this.cw = Math.max(1, Math.round(ww * this.dpr));
    this.ch = Math.max(1, Math.round(wh * this.dpr));
    const c = this.canvas;
    if (c.width !== this.cw || c.height !== this.ch) { c.width = this.cw; c.height = this.ch; }
    c.style.width = ww + 'px'; c.style.height = wh + 'px';
    this.layout();
  },
  layout() {
    let pw = this.cw, ph = pw / Screen.aspect;
    if (ph > this.ch) { ph = this.ch; pw = ph * Screen.aspect; }
    pw = Math.floor(pw); ph = Math.floor(ph);
    this.pf = { x: Math.floor((this.cw - pw) / 2), y: Math.floor((this.ch - ph) / 2), w: pw, h: ph };
    this.sx = pw / Screen.W; this.sy = ph / Screen.H;
    this.ux = pw / Screen.UW; this.uy = ph / Screen.UH;
  },
  // sim / UI coordinates -> device pixels
  X(x) { return this.pf.x + x * this.sx; },
  Y(y) { return this.pf.y + y * this.sy; },
  UXp(u) { return this.pf.x + u * this.ux; },
  UYp(u) { return this.pf.y + u * this.uy; },
  // client (CSS) coordinates -> sim coordinates
  toInternal(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const dx = (cx - r.left) / r.width * this.cw, dy = (cy - r.top) / r.height * this.ch;
    return { x: (dx - this.pf.x) / this.sx, y: (dy - this.pf.y) / this.sy };
  },
  css(c) { return Theme.css(c); },

  /* ------------------------------------------------ the frame */
  frame(dt) {
    if (this.canvas.width !== this.cw || this.canvas.height !== this.ch || Math.round((window.devicePixelRatio || 1) * 100) !== Math.round(this.dpr * 100)) this.resize();
    if (this.pf.w / Screen.W !== this.sx || this.pf.h / Screen.H !== this.sy) this.layout();
    this.t += dt;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    Screen.ui = VUI.begin();
    const sc = App.scene;
    if (sc.drawModern) sc.drawModern(dt);
    else { this.backdrop('menu', dt); sc.draw(); }
    UI.draw(Screen.ui);
    Toast.draw(Screen.ui);
    Chat.draw(Screen.ui);
    Net.drawOverlay(Screen.ui);
    EventLog.draw(Screen.ui);
    Fx.drawOverlay(ctx, dt);
    Volume.draw();
    if (Cfg.pointer === 'Joystick' && Input.x >= 0) this.drawCursor(ctx);
    VUI.end();
  },
  // gamepad pointer
  drawCursor(ctx) {
    const x = this.X(Input.x), y = this.Y(Input.y), s = 7 * this.dpr;
    ctx.lineWidth = Math.max(2, 2 * this.dpr); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
    ctx.lineWidth = Math.max(1, this.dpr); ctx.strokeStyle = '#ffb640';
    ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
  },
  // what sits behind a menu screen: the title landscape, dimmed
  backdrop(kind, dt) {
    const ctx = this.ctx;
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, this.cw, this.ch);
    Title.draw(ctx, dt, kind);
  },
  // shake the battlefield (explosions); decays by itself
  kick(amount) {
    if (!Cfg.screenShake) return;
    this.shake = Math.min(1.2, this.shake + amount);
  },
  updateShake(dt) {
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake * this.pf.w * 0.012;
    this.shakeX = (Math.random() * 2 - 1) * s;
    this.shakeY = (Math.random() * 2 - 1) * s;
  }
};

/* =====================================================================
   Terra: WebGL2 sky + terrain. The land bitmap (palette indexes) is
   uploaded as a texture, blurred twice at simulation resolution (a fine
   blur for smooth anti-aliased edges, a coarse one for the relief
   normals), then shaded per display pixel.
   ===================================================================== */
const SKY_TYPES = ['PLAIN', 'STORMY', 'STARS', 'SHADED', 'SUNSET', 'CAVERN', 'BLACK'];
// four gradient stops per sky, top to horizon (sRGB 0..1)
const SKY_STOPS = {
  PLAIN: ['#1d4f9c', '#3f7fcf', '#86b9ec', '#c9e3f7'],
  STORMY: ['#07090e', '#141821', '#262c38', '#3b4250'],
  STARS: ['#010208', '#050a1a', '#0b1330', '#16204a'],
  SHADED: ['#02030a', '#0a1440', '#1d3a8a', '#4d74c4'],
  SUNSET: ['#12051f', '#4a1152', '#c02e5c', '#ff9a42'],
  CAVERN: ['#050302', '#0f0906', '#1a110b', '#26190f'],
  BLACK: ['#000000', '#000000', '#020203', '#050507']
};
function hexVec(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

const Terra = {
  gl: null, canvas: null, progs: {}, vao: null, tex: {}, fbo: {}, W: 0, H: 0,
  src: null, landVer: -1, palVer: -1, scorchVer: -1, dirty: true, lost: false,

  init() {
    try {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      const gl = c.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      this.gl = gl; this.canvas = c;
      c.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
      c.addEventListener('webglcontextrestored', () => { this.lost = false; this.setup(); });
      return this.setup();
    } catch (e) { console.warn('WebGL unavailable', e); return false; }
  },
  setup() {
    const gl = this.gl;
    this.progs.blur = this.program(TERRA_VS, TERRA_BLUR_FS);
    this.progs.main = this.program(TERRA_VS, TERRA_MAIN_FS);
    if (!this.progs.blur || !this.progs.main) return false;
    this.vao = gl.createVertexArray();   // the vertex shader makes a full-screen triangle from gl_VertexID
    this.tex = {}; this.fbo = {}; this.W = 0; this.H = 0; this.src = null; this.landVer = this.palVer = this.scorchVer = -1;
    this.uniforms = {};
    for (const k in this.progs) {
      const p = this.progs[k], u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        const name = info.name.replace(/\[0\]$/, '');
        u[name] = gl.getUniformLocation(p, info.name);
      }
      this.uniforms[k] = u;
    }
    return true;
  },
  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
    return p;
  },
  makeTex(w, h, fmt, filter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (fmt === 'r8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  },
  alloc(W, H) {
    const gl = this.gl;
    for (const k in this.tex) gl.deleteTexture(this.tex[k]);
    for (const k in this.fbo) gl.deleteFramebuffer(this.fbo[k]);
    this.tex = {
      land: this.makeTex(W, H, 'r8', gl.NEAREST),
      scorch: this.makeTex(W, H, 'r8', gl.LINEAR),
      tmp: this.makeTex(W, H, 'rgba', gl.NEAREST),
      cov: this.makeTex(W, H, 'rgba', gl.LINEAR),
      pal: this.makeTex(256, 1, 'rgba', gl.LINEAR)
    };
    this.fbo = {};
    for (const k of ['tmp', 'cov']) {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex[k], 0);
      this.fbo[k] = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.W = W; this.H = H;
    this.landVer = this.palVer = this.scorchVer = -1;
  },
  // bring the GPU copy of a world (World or the title landscape) up to date
  sync(src) {
    const gl = this.gl;
    if (src.W !== this.W || src.H !== this.H || !this.tex.land) this.alloc(src.W, src.H);
    if (src !== this.src) { this.src = src; this.landVer = this.palVer = this.scorchVer = -1; }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (src.ver !== this.landVer) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex.land);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, src.W, src.H, gl.RED, gl.UNSIGNED_BYTE, src.land);
      this.landVer = src.ver; this.dirty = true;
    }
    if (src.palVer !== this.palVer) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex.pal);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(src.pal.buffer, src.pal.byteOffset, 1024));
      this.palVer = src.palVer;
    }
    if (src.scorchMask && src.scorchVer !== this.scorchVer) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex.scorch);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, src.W, src.H, gl.RED, gl.UNSIGNED_BYTE, src.scorchMask);
      this.scorchVer = src.scorchVer;
    }
  },
  blur() {
    const gl = this.gl, p = this.progs.blur, u = this.uniforms.blur, src = this.src;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    gl.uniform1i(u.uSrc, 0);
    gl.activeTexture(gl.TEXTURE0);
    // horizontal: read the land itself
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.tmp);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.land);
    gl.uniform1i(u.uPass, 0);
    gl.uniform2f(u.uSig, 1.1, 3.2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // vertical: rows are denser than columns by the pixel aspect
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.cov);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.tmp);
    gl.uniform1i(u.uPass, 1);
    gl.uniform2f(u.uSig, 1.1 * src.ay, 3.2 * src.ay);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dirty = false;
  },
  /* draw sky + terrain for world `src` into this.canvas (w x h device pixels),
     o: {pf (playfield in those pixels), sky, sun, wind, lights, flash, flashColor, fog, time} */
  render(src, w, h, o) {
    if (this.lost) return false;
    const gl = this.gl, c = this.canvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.sync(src);
    if (this.dirty) this.blur();
    const p = this.progs.main, u = this.uniforms.main;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, w, h);
    const bind = (unit, tex, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u[name], unit); };
    bind(0, this.tex.cov, 'uCov'); bind(1, this.tex.land, 'uLand'); bind(2, this.tex.pal, 'uPal'); bind(3, this.tex.scorch, 'uScorch');
    const pf = o.pf;
    gl.uniform2f(u.uRes, w, h);
    gl.uniform4f(u.uPF, pf.x, pf.y, pf.w, pf.h);
    gl.uniform2f(u.uWorld, src.W, src.H);
    gl.uniform1f(u.uAy, src.ay);
    gl.uniform1f(u.uTop, src.top);
    gl.uniform1f(u.uLandTop, src.landTop || src.H * 0.5);
    gl.uniform1f(u.uScanned, src.scanned ? 1 : 0);
    gl.uniform1f(u.uTime, o.time);
    gl.uniform1f(u.uWind, o.wind || 0);
    gl.uniform1f(u.uSeed, (src.seed % 997) + 0.5);
    const sky = SKY_TYPES.indexOf(o.sky);
    gl.uniform1i(u.uSky, sky < 0 ? 4 : sky);
    const st = SKY_STOPS[o.sky] || SKY_STOPS.SUNSET;
    gl.uniform3fv(u.uStops, new Float32Array([].concat(...st.map(hexVec))));
    const sun = o.sun || { x: src.W * 0.7, y: src.H * 0.6, r: src.W * 0.08 };
    gl.uniform4f(u.uSun, sun.x, sun.y, sun.r, o.sky === 'SUNSET' ? 1 : 0);
    gl.uniform1f(u.uFlash, o.flash || 0);
    const fc = o.flashColor || [1, 1, 1];
    gl.uniform3f(u.uFlashCol, fc[0], fc[1], fc[2]);
    gl.uniform1f(u.uFog, o.fog || 0);
    gl.uniform1f(u.uWalls, o.walls || 0);
    const L = o.lights || [], n = Math.min(16, L.length);
    const lp = new Float32Array(64), lc = new Float32Array(48);
    for (let i = 0; i < n; i++) {
      const l = L[i];
      lp[i * 4] = l.x; lp[i * 4 + 1] = l.y; lp[i * 4 + 2] = l.r; lp[i * 4 + 3] = l.i;
      lc[i * 3] = l.c[0]; lc[i * 3 + 1] = l.c[1]; lc[i * 3 + 2] = l.c[2];
    }
    gl.uniform1i(u.uNL, n);
    gl.uniform4fv(u.uL, lp);
    gl.uniform3fv(u.uLC, lc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
};

const TERRA_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// separable gaussian: pass 0 reads the land (solid = index > 0) along x, pass 1 blurs that along y.
// R = fine (edges), G = coarse (relief)
const TERRA_BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform int uPass;
uniform vec2 uSig;
out vec4 frag;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 sz = textureSize(uSrc, 0);
  ivec2 dir = uPass == 0 ? ivec2(1, 0) : ivec2(0, 1);
  float s0 = max(uSig.x, 0.3), s1 = max(uSig.y, 0.3);
  int r0 = int(ceil(s0 * 2.5)), r1 = min(int(ceil(s1 * 2.5)), 40);
  float a0 = 0.0, w0 = 0.0, a1 = 0.0, w1 = 0.0;
  for (int k = -40; k <= 40; k++) {
    if (k < -r1 || k > r1) continue;
    ivec2 q = clamp(p + dir * k, ivec2(0), sz - 1);
    vec2 v;
    if (uPass == 0) { float s = texelFetch(uSrc, q, 0).r > 0.0 ? 1.0 : 0.0; v = vec2(s); }
    else v = texelFetch(uSrc, q, 0).rg;
    // below the bottom edge is solid ground
    if (uPass == 1 && p.y + k >= sz.y) v = vec2(1.0);
    float fk = float(k);
    float g1 = exp(-fk * fk / (2.0 * s1 * s1));
    a1 += v.y * g1; w1 += g1;
    if (k >= -r0 && k <= r0) { float g0 = exp(-fk * fk / (2.0 * s0 * s0)); a0 += v.x * g0; w0 += g0; }
  }
  frag = vec4(a0 / w0, a1 / w1, 0.0, 1.0);
}`;

const TERRA_MAIN_FS = `#version 300 es
precision highp float;
uniform sampler2D uCov, uLand, uPal, uScorch;
uniform vec2 uRes, uWorld;
uniform vec4 uPF;
uniform float uAy, uTop, uLandTop, uScanned, uTime, uWind, uSeed, uFlash, uFog, uWalls;
uniform int uSky;
uniform vec3 uStops[4];
uniform vec4 uSun;
uniform vec3 uFlashCol;
uniform vec4 uL[16];
uniform vec3 uLC[16];
uniform int uNL;
out vec4 frag;

uint hu(uvec2 p) {
  p = p * 1664525u + 1013904223u;
  p.x += p.y * 1664525u; p.y += p.x * 1664525u;
  p ^= p >> 16u;
  p.x += p.y * 1664525u; p.y += p.x * 1664525u;
  p ^= p >> 16u;
  return p.x ^ p.y;
}
float hash(vec2 p) { return float(hu(uvec2(ivec2(floor(p)) + 65536))) / 4294967295.0; }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float fbm1(float x) { return fbm(vec2(x, uSeed * 1.7)); }
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 lin2srgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

vec3 gradient(float v) {
  v = clamp(v, 0.0, 1.0);
  if (v < 0.34) return mix(uStops[0], uStops[1], smoothstep(0.0, 0.34, v));
  if (v < 0.68) return mix(uStops[1], uStops[2], smoothstep(0.34, 0.68, v));
  return mix(uStops[2], uStops[3], smoothstep(0.68, 1.0, v));
}

// p: sim coordinates (columns, rows); yc = rows scaled to columns
vec3 sky(vec2 p) {
  float v = p.y / uWorld.y;
  vec3 c = gradient(v);
  float yc = p.y / uAy;
  // stars
  if (uSky == 2 || uSky == 3 || uSky == 4) {
    float amt = uSky == 2 ? 1.0 : uSky == 3 ? 0.6 * (1.0 - smoothstep(0.1, 0.55, v)) : 0.5 * (1.0 - smoothstep(0.05, 0.35, v));
    vec2 g = vec2(p.x, yc) / 2.6;
    vec2 cell = floor(g);
    float h = hash(cell + 91.0);
    if (h > 0.93) {
      vec2 sp = cell + vec2(hash(cell + 7.0), hash(cell + 13.0));
      float d = length(g - sp) * 2.6;
      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h * 4.0) + h * 60.0);
      float b = smoothstep(0.55, 0.0, d) * (h - 0.93) / 0.07 * tw;
      c += vec3(0.85, 0.9, 1.0) * b * amt * 1.6;
    }
    if (uSky == 2) {
      // a faint band of distant stars
      float band = exp(-pow((yc - p.x * 0.35 - uWorld.x * 0.1) / (uWorld.x * 0.22), 2.0));
      float neb = fbm(vec2(p.x, yc) * 0.012 + uSeed);
      c += vec3(0.20, 0.12, 0.35) * band * neb * 0.55 + vec3(0.05, 0.12, 0.25) * neb * neb * 0.35;
    }
  }
  // sun
  if (uSun.w > 0.5) {
    vec2 d2 = vec2(p.x - uSun.x, (p.y - uSun.y) / uAy);
    float d = length(d2), r = uSun.z;
    vec3 sc = vec3(1.0, 0.86, 0.45);
    c += sc * exp(-d / (r * 2.2)) * 0.55 + vec3(1.0, 0.45, 0.35) * exp(-d / (r * 7.0)) * 0.25;
    float disc = smoothstep(r + 0.8, r - 0.8, d);
    // the classic striped sunset sun, done smooth
    if (d2.y > r * 0.05) {
      float band = (d2.y) / r;
      float stripe = smoothstep(0.0, 0.08, abs(fract(band * 4.5 + 0.1) - 0.5) - 0.12 * band - 0.05);
      disc *= mix(1.0, stripe, smoothstep(0.05, 0.25, band));
    }
    vec3 top = vec3(1.0, 0.95, 0.62), bot = vec3(1.0, 0.42, 0.28);
    c = mix(c, mix(top, bot, clamp(d2.y / r * 0.5 + 0.5, 0.0, 1.0)), disc);
  }
  // clouds drift with the wind
  if (uSky == 0 || uSky == 1 || uSky == 4) {
    float drift = uTime * (uWind * 0.045 + 1.5);
    vec2 q = vec2((p.x - drift) * 0.011, yc * 0.03 + uSeed);
    float n = fbm(q) + 0.5 * fbm(q * 2.3 + 5.0) - 0.25;
    float lo = uSky == 1 ? 0.28 : 0.48, amt = uSky == 1 ? 1.0 : 0.85;
    float mask = uSky == 1 ? (1.0 - smoothstep(0.3, 0.75, v)) : (1.0 - smoothstep(0.08, 0.6, v)) * smoothstep(0.0, 0.08, v);
    float d = smoothstep(lo, lo + 0.35, n) * mask * amt;
    vec3 cc = uSky == 1 ? vec3(0.22, 0.24, 0.29) : uSky == 4 ? mix(vec3(0.95, 0.45, 0.45), vec3(0.35, 0.12, 0.35), smoothstep(0.1, 0.5, v)) : vec3(0.97, 0.98, 1.0);
    float shade = 0.75 + 0.35 * fbm(q * 1.7 + 3.0);
    c = mix(c, cc * shade + uFlash * uFlashCol * (uSky == 1 ? 0.8 : 0.2), d * 0.9);
  }
  // distant ridges (not part of the battlefield)
  if (uSky != 5 && uSky != 6) {
    float ph = uWorld.y - uTop;
    float h1 = uTop + ph * 0.60 + ph * 0.14 * (fbm1(p.x * 0.004) - 0.5) * 2.0;
    float h2 = uTop + ph * 0.70 + ph * 0.10 * (fbm1(p.x * 0.007 + 40.0) - 0.5) * 2.0;
    vec3 haze = gradient(0.9);
    vec3 r1 = mix(uStops[1] * 0.55, haze, 0.55), r2 = mix(uStops[1] * 0.4, haze, 0.35);
    if (uSky == 2 || uSky == 3) { r1 = vec3(0.03, 0.05, 0.10); r2 = vec3(0.02, 0.03, 0.07); }
    c = mix(c, r1, smoothstep(h1 - 0.8, h1 + 0.8, p.y) * 0.85);
    c = mix(c, r2, smoothstep(h2 - 0.8, h2 + 0.8, p.y) * 0.92);
  }
  if (uSky == 5) {
    // cave wall
    float n = fbm(vec2(p.x, yc) * 0.03 + uSeed);
    c *= 0.6 + 0.8 * n;
    c += vec3(0.10, 0.05, 0.02) * smoothstep(0.55, 0.9, n);
  }
  // flash (lightning, nukes)
  c += uFlashCol * uFlash * 0.55;
  return c;
}

vec3 palAt(float idx) { return texture(uPal, vec2((idx + 0.5) / 256.0, 0.5)).rgb; }

void main() {
  vec2 frag2 = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);          // top-down pixel position
  vec2 p = (frag2 - uPF.xy) * uWorld / uPF.zw;                          // sim coordinates
  vec3 col = sky(p);
  // outside the walls the ground carries on at the edge column's height and fades into haze
  // (it used to be mirrored, which showed craters near an edge a second time)
  float out_ = 0.0;
  vec2 q = p;
  if (q.x < 0.0) { out_ = -q.x; q.x = 0.5; }
  if (q.x > uWorld.x) { out_ = q.x - uWorld.x; q.x = uWorld.x - 0.5; }
  vec2 texel = 1.0 / uWorld;
  vec2 uv = (q + 0.0) * texel;
  if (q.y > uTop - 2.0 && q.x >= 0.0 && q.x <= uWorld.x && q.y <= uWorld.y + 2.0) {
    vec2 cv = texture(uCov, uv).rg;
    float fw = fwidth(cv.r);
    float a = smoothstep(0.5 - fw * 0.9 - 0.02, 0.5 + fw * 0.9 + 0.02, cv.r);
    if (q.y >= uWorld.y) a = 1.0;
    // a needle or crust one pixel thin vanishes in the blur, yet tanks stand on it: show it as it is
    if (a < 0.5 && q.y < uWorld.y) {
      ivec2 mx = ivec2(uWorld) - 1, ip0 = clamp(ivec2(q), ivec2(0), mx);
      if (texelFetch(uLand, ip0, 0).r > 0.0) {
        bool nl = texelFetch(uLand, clamp(ip0 + ivec2(-1, 0), ivec2(0), mx), 0).r > 0.0;
        bool nr = texelFetch(uLand, clamp(ip0 + ivec2(1, 0), ivec2(0), mx), 0).r > 0.0;
        bool nu = texelFetch(uLand, clamp(ip0 + ivec2(0, -1), ivec2(0), mx), 0).r > 0.0;
        bool nd = texelFetch(uLand, clamp(ip0 + ivec2(0, 1), ivec2(0), mx), 0).r > 0.0;
        if ((!nl && !nr) || (!nu && !nd)) a = 1.0;
      }
    }
    if (a > 0.001) {
      // albedo from the palette: a smooth ramp by depth, or the scanned rock texture
      vec3 alb;
      if (uScanned > 0.5) {
        ivec2 ip = ivec2(clamp(q, vec2(0.0), uWorld - 1.0));
        float idx = texelFetch(uLand, ip, 0).r * 255.0;
        if (idx < 0.5) idx = max(max(texelFetch(uLand, ip + ivec2(1, 0), 0).r, texelFetch(uLand, ip - ivec2(1, 0), 0).r),
                                 max(texelFetch(uLand, ip + ivec2(0, 1), 0).r, texelFetch(uLand, ip - ivec2(0, 1), 0).r)) * 255.0;
        if (idx < 0.5) idx = 120.0;
        alb = palAt(idx);
      } else {
        float t = clamp((q.y - uLandTop) / max(1.0, uWorld.y - uLandTop), 0.0, 1.0);
        float n0 = fbm(vec2(q.x * 0.05, q.y / uAy * 0.05) + uSeed);
        alb = palAt(1.0 + clamp(t + (n0 - 0.5) * 0.08, 0.0, 1.0) * 254.0);
      }
      alb = srgb2lin(alb);
      // grain and strata
      float gr = fbm(vec2(q.x * 0.55, q.y / uAy * 0.55) + uSeed * 3.0);
      float strata = 0.5 + 0.5 * sin(q.y / uAy * 0.55 + fbm(vec2(q.x * 0.02, q.y * 0.01) + uSeed) * 9.0);
      alb *= 0.78 + 0.34 * gr;
      alb *= 0.92 + 0.1 * strata;
      // scorch marks
      alb *= 1.0 - texture(uScorch, uv).r * 0.8;
      // relief normal from the coarse coverage
      vec2 tx = vec2(texel.x * 1.5, 0.0), ty = vec2(0.0, texel.y * 1.5 * uAy);
      float dx = texture(uCov, uv + tx).g - texture(uCov, uv - tx).g;
      float dy = texture(uCov, uv + ty).g - texture(uCov, uv - ty).g;
      vec3 n = normalize(vec3(-dx * 2.4, dy * 2.4, 1.0));
      vec3 L = normalize(vec3(-0.45, 0.75, 0.55));
      float diff = clamp(dot(n, L), 0.0, 1.0);
      vec3 skyAmb = srgb2lin(gradient(0.2));
      vec3 horiz = srgb2lin(gradient(0.95));
      float ao = mix(1.0, 0.62, smoothstep(0.55, 1.0, cv.g));
      vec3 lit = alb * (vec3(0.30) + skyAmb * 0.35 + horiz * 0.55 * diff) * ao;
      // top surfaces catch the sky: a bright lip along every edge that faces up
      float above = texture(uCov, uv - vec2(0.0, texel.y * 2.2 * uAy)).r;
      float lip = (1.0 - smoothstep(0.25, 0.6, above)) * smoothstep(0.1, 0.6, n.y + 0.3);
      lit += (horiz * 0.35 + alb * 0.6) * lip * 0.55;
      // a thin dark outline where land meets air
      lit *= mix(0.55, 1.0, smoothstep(0.5, 0.72, cv.r));
      // dynamic lights (explosions, fire, lasers)
      for (int i = 0; i < 16; i++) {
        if (i >= uNL) break;
        vec2 d = vec2(uL[i].x - q.x, (uL[i].y - q.y) / uAy);
        float dist = length(d);
        float f = clamp(1.0 - dist / uL[i].z, 0.0, 1.0);
        f *= f;
        vec3 ld = normalize(vec3(d.x, -d.y, uL[i].z * 0.35));
        lit += srgb2lin(uLC[i]) * uL[i].w * f * (0.25 + 0.75 * clamp(dot(n, ld), 0.0, 1.0)) * (alb + 0.08);
      }
      lit += srgb2lin(uFlashCol) * uFlash * 0.35 * alb;
      vec3 land = lin2srgb(lit);
      // beyond the walls
      if (out_ > 0.0) land = mix(land, land * 0.5 + gradient(0.9) * 0.12, clamp(out_ / (uWorld.x * 0.05), 0.0, 1.0));
      col = mix(col, land, a);
    }
  }
  // dithering keeps smooth gradients free of bands
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) / 255.0;
  frag = vec4(col, 1.0);
}`;
