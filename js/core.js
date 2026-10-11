'use strict';
/* =====================================================================
   Scorched Opus - core helpers and the software (VGA-style) renderer.
   Everything is drawn into 32-bit pixel buffers and pushed to a canvas
   with a single putImageData per frame, like writing to mode 13h.
   ===================================================================== */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function rand(a, b) { return a + Math.random() * (b - a); }
function irand(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function chance(p) { return Math.random() < p; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function sign(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
/* Seeded RNG for the shared simulation. Anything that changes the battlefield
   draws from SR so every networked peer replays a shot identically; purely
   cosmetic randomness (colors, sounds, lightning zigzags, AI whims on the host)
   keeps using Math.random through the helpers above. */
const SR = {
  s: 1,
  seed(n) { this.s = (n >>> 0) || 1; },
  next() {   // mulberry32
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
};
function srand(a, b) { return a + SR.next() * (b - a); }
function sirand(a, b) { return Math.floor(a + SR.next() * (b - a + 1)); }
function schance(p) { return SR.next() < p; }
function spick(a) { return a[Math.floor(SR.next() * a.length)]; }
function sshuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(SR.next() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function rid(n) {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < (n || 8); i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function commas(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function money(n) { n = Math.round(n); return (n < 0 ? '-$' : '$') + commas(Math.abs(n)); }

/* ---------- colors: Uint32 in little-endian ABGR (ImageData order) ---------- */
function rgb(r, g, b) {
  r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}
// 6-bit VGA DAC values (0..63), the way the original palette was specified
function vga(r, g, b) {
  r = clamp(Math.round(r), 0, 63); g = clamp(Math.round(g), 0, 63); b = clamp(Math.round(b), 0, 63);
  return rgb((r << 2) | (r >> 4), (g << 2) | (g >> 4), (b << 2) | (b >> 4));
}
function cR(c) { return c & 255; }
function cG(c) { return (c >>> 8) & 255; }
function cB(c) { return (c >>> 16) & 255; }
function mixc(a, b, t) {
  return rgb(cR(a) + (cR(b) - cR(a)) * t, cG(a) + (cG(b) - cG(a)) * t, cB(a) + (cB(b) - cB(a)) * t);
}
function scalec(c, f) { return rgb(cR(c) * f, cG(c) * f, cB(c) * f); }
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgb(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}
// quantize a color to the 6-bit VGA DAC so everything shares the period look
function vgaq(c) { return vga(cR(c) >> 2, cG(c) >> 2, cB(c) >> 2); }
function cssColor(c) { return 'rgb(' + cR(c) + ',' + cG(c) + ',' + cB(c) + ')'; }

/* ---------- hash noise (for terrain texture, clouds, etc.) ---------- */
function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 144269504)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm2(x, y, seed, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f, y * f, seed + i * 31);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}
function noise1(x, seed) {
  const xi = Math.floor(x), u = smooth(x - xi);
  return lerp(hash2(xi, 0, seed), hash2(xi + 1, 0, seed), u);
}

/* ---------- storage (always guarded: may be unavailable) ---------- */
const Store = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  keys(prefix) {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out.push(k); } } catch (e) { /* ignore */ }
    return out;
  }
};

/* ---------- Surface: a 32-bit pixel buffer with clipped primitives ---------- */
class Surface {
  constructor(w, h, buf) {
    this.w = w; this.h = h;
    this.buf = buf || new Uint32Array(w * h);
    this.resetClip();
  }
  resetClip() { this.x0 = 0; this.y0 = 0; this.x1 = this.w; this.y1 = this.h; }
  clip(x, y, w, h) {
    this.x0 = Math.max(0, x | 0); this.y0 = Math.max(0, y | 0);
    this.x1 = Math.min(this.w, (x + w) | 0); this.y1 = Math.min(this.h, (y + h) | 0);
  }
  clear(c) { this.buf.fill(c >>> 0); }
  pset(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < this.x0 || y < this.y0 || x >= this.x1 || y >= this.y1) return;
    this.buf[y * this.w + x] = c;
  }
  get(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.buf[y * this.w + x];
  }
  hline(xa, xb, y, c) {
    y = Math.floor(y);
    if (y < this.y0 || y >= this.y1) return;
    let a = Math.floor(Math.min(xa, xb)), b = Math.floor(Math.max(xa, xb));
    if (a < this.x0) a = this.x0;
    if (b >= this.x1) b = this.x1 - 1;
    if (a > b) return;
    const o = y * this.w;
    this.buf.fill(c, o + a, o + b + 1);
  }
  vline(x, ya, yb, c) {
    x = Math.floor(x);
    if (x < this.x0 || x >= this.x1) return;
    let a = Math.floor(Math.min(ya, yb)), b = Math.floor(Math.max(ya, yb));
    if (a < this.y0) a = this.y0;
    if (b >= this.y1) b = this.y1 - 1;
    for (let y = a; y <= b; y++) this.buf[y * this.w + x] = c;
  }
  fillRect(x, y, w, h, c) {
    x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h);
    const xa = Math.max(this.x0, x), xb = Math.min(this.x1, x + w);
    const ya = Math.max(this.y0, y), yb = Math.min(this.y1, y + h);
    if (xa >= xb || ya >= yb) return;
    for (let yy = ya; yy < yb; yy++) this.buf.fill(c, yy * this.w + xa, yy * this.w + xb);
  }
  rect(x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    this.hline(x, x + w - 1, y, c); this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c); this.vline(x + w - 1, y, y + h - 1, c);
  }
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    for (;;) {
      this.pset(x0, y0, c);
      if ((x0 === x1 && y0 === y1) || ++n > 8000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  fillEllipse(cx, cy, rx, ry, c) {
    if (rx < 0.5 || ry < 0.5) { this.pset(cx, cy, c); return; }
    const ya = Math.ceil(cy - ry), yb = Math.floor(cy + ry);
    for (let y = ya; y <= yb; y++) {
      const t = (y - cy) / ry, q = 1 - t * t;
      if (q < 0) continue;
      const hw = rx * Math.sqrt(q);
      this.hline(Math.round(cx - hw), Math.round(cx + hw), y, c);
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    if (rx < 0.5 && ry < 0.5) { this.pset(cx, cy, c); return; }
    const ya = Math.ceil(cy - ry), yb = Math.floor(cy + ry);
    for (let y = ya; y <= yb; y++) {
      const t = (y - cy) / ry, hw = rx * Math.sqrt(Math.max(0, 1 - t * t));
      this.pset(Math.round(cx - hw), y, c); this.pset(Math.round(cx + hw), y, c);
    }
    const xa = Math.ceil(cx - rx), xb = Math.floor(cx + rx);
    for (let x = xa; x <= xb; x++) {
      const t = (x - cx) / rx, hh = ry * Math.sqrt(Math.max(0, 1 - t * t));
      this.pset(x, Math.round(cy - hh), c); this.pset(x, Math.round(cy + hh), c);
    }
  }
  blend(x, y, c, a) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < this.x0 || y < this.y0 || x >= this.x1 || y >= this.y1) return;
    const i = y * this.w + x, d = this.buf[i], ia = 1 - a;
    this.buf[i] = rgb(cR(d) * ia + cR(c) * a, cG(d) * ia + cG(c) * a, cB(d) * ia + cB(c) * a);
  }
  fillRectBlend(x, y, w, h, c, a) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.blend(xx, yy, c, a);
  }
  // sprite = {w, h, data: Uint32Array, 0 = transparent}; sx/sy integer scales
  blit(spr, dx, dy, opt) {
    const flip = opt && opt.flip, sx = (opt && opt.sx) || 1, sy = (opt && opt.sy) || 1;
    const tint = opt && opt.tint;
    const data = spr.data || spr.buf;
    dx = Math.floor(dx); dy = Math.floor(dy);
    for (let y = 0; y < spr.h; y++) {
      for (let x = 0; x < spr.w; x++) {
        let c = data[y * spr.w + (flip ? spr.w - 1 - x : x)];
        if (!c) continue;
        if (tint) c = tint(c);
        if (sx === 1 && sy === 1) this.pset(dx + x, dy + y, c);
        else this.fillRect(dx + x * sx, dy + y * sy, sx, sy, c);
      }
    }
  }
}

function makeSprite(rows, map) {
  const h = rows.length;
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const data = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = rows[y];
    for (let x = 0; x < r.length; x++) {
      const v = map[r[x]];
      if (v) data[y * w + x] = v;
    }
  }
  return { w, h, data };
}

/* ---------- Screen: main framebuffer + low-res UI layer ---------- */
const Screen = {
  canvas: null, ctx: null, img: null,
  W: 360, H: 480, ay: 1,
  main: null,          // full-resolution battlefield buffer
  ui: null,            // low-resolution UI layer (0 = transparent)
  UX: 1, UY: 1, UW: 360, UH: 240, aspect: 4 / 3,   // aspect: the screen's shape (4:3, or 16:9 for WIDE modes)
  flash: 0, flashColor: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    window.addEventListener('resize', () => this.fit());
  },
  setMode(w, h, aspect) {
    this.W = w; this.H = h; this.aspect = aspect || 4 / 3;
    const modern = typeof Gfx !== 'undefined' && Gfx.modern;
    if (!modern) { this.canvas.width = w; this.canvas.height = h; }
    this.img = this.ctx.createImageData(w, h);
    this.main = new Surface(w, h, new Uint32Array(this.img.data.buffer));
    // pixel aspect: how many rows cover the same on-screen distance as one column
    this.ay = (h * this.aspect) / w;
    this.UX = Math.max(1, Math.floor(w / 320));
    this.UY = Math.max(1, Math.round(this.UX * this.ay));
    this.UW = Math.floor(w / this.UX);
    this.UH = Math.floor(h / this.UY);
    this.ui = this.pixelUi = new Surface(this.UW, this.UH);
    this.fit();
  },
  fit() {
    if (!this.canvas) return;
    if (typeof Gfx !== 'undefined' && Gfx.modern) { Gfx.resize(); return; }
    const ww = window.innerWidth, wh = window.innerHeight;
    let cw = ww, ch = ww / this.aspect;
    if (ch > wh) { ch = wh; cw = wh * this.aspect; }
    this.canvas.style.width = Math.floor(cw) + 'px';
    this.canvas.style.height = Math.floor(ch) + 'px';
  },
  present() {
    const u = this.ui.buf, m = this.main.buf;
    const UW = this.UW, UH = this.UH, UX = this.UX, UY = this.UY, W = this.W;
    for (let y = 0; y < UH; y++) {
      const ur = y * UW;
      for (let x = 0; x < UW; x++) {
        const c = u[ur + x];
        if (c === 0) continue;
        if (UX === 1 && UY === 1) { m[y * W + x] = c; continue; }
        for (let sy = 0; sy < UY; sy++) {
          const o = (y * UY + sy) * W + x * UX;
          for (let sx = 0; sx < UX; sx++) m[o + sx] = c;
        }
      }
    }
    if (this.flash > 0) {
      // full-screen flash (lightning, nukes) - cheap additive tint
      const a = Math.min(1, this.flash), fc = this.flashColor;
      const fr = cR(fc) * a, fg = cG(fc) * a, fb = cB(fc) * a;
      for (let i = 0; i < m.length; i += 1) {
        const c = m[i];
        m[i] = rgb(cR(c) + fr, cG(c) + fg, cB(c) + fb);
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  },
  // client (CSS) coordinates -> internal pixel coordinates
  toInternal(cx, cy) {
    if (typeof Gfx !== 'undefined' && Gfx.modern) return Gfx.toInternal(cx, cy);
    const r = this.canvas.getBoundingClientRect();
    return { x: (cx - r.left) / r.width * this.W, y: (cy - r.top) / r.height * this.H };
  }
};
