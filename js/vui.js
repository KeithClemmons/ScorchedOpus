'use strict';
/* =====================================================================
   Vector UI for the Remastered look. The game's screens keep drawing in
   UI units through the same Surface calls (fillRect, Font.draw, frame(),
   drawButton() ...); in Remastered mode those land here and are drawn
   with Canvas 2D at full resolution in a modern style instead of pixels.
   ===================================================================== */

const UIC_CLASSIC = Object.assign({}, UIC);
const UIC_MODERN = {
  face: rgb(20, 26, 40), hi: rgb(74, 88, 118), lo: rgb(8, 11, 18), black: rgb(230, 234, 242),
  text: rgb(230, 234, 242), hot: rgb(255, 182, 64), dis: rgb(123, 132, 153), field: rgb(10, 14, 22),
  sel: rgb(45, 74, 138), selText: rgb(255, 255, 255), light: rgb(38, 50, 76), dark: rgb(14, 19, 30),
  blue: rgb(106, 194, 255), title: rgb(230, 234, 242), wind: rgb(127, 224, 255), white: rgb(255, 255, 255),
  yellow: rgb(255, 210, 87), red: rgb(255, 96, 96), green: rgb(111, 227, 138)
};

const FONT_UI = '"Chakra Petch", "Bahnschrift", "Segoe UI", system-ui, sans-serif';
const FONT_DISPLAY = '"Russo One", "Bahnschrift", "Segoe UI Black", "Arial Black", sans-serif';

const Theme = {
  modern: false,
  cssCache: new Map(),
  use(modern) {
    this.modern = modern;
    Object.assign(UIC, modern ? UIC_MODERN : UIC_CLASSIC);
  },
  css(c, a) {
    const key = a === undefined ? c : c + ':' + a;
    let s = this.cssCache.get(key);
    if (!s) {
      s = a === undefined ? 'rgb(' + cR(c) + ',' + cG(c) + ',' + cB(c) + ')' : 'rgba(' + cR(c) + ',' + cG(c) + ',' + cB(c) + ',' + a + ')';
      if (this.cssCache.size > 4000) this.cssCache.clear();
      this.cssCache.set(key, s);
    }
    return s;
  },
  // accent helpers
  accent: 'rgb(255,182,64)', ink: 'rgb(230,234,242)', muted: 'rgb(123,132,153)', info: 'rgb(106,194,255)',
  panel: 'rgba(15,20,32,0.9)', panelHi: 'rgba(30,40,62,0.95)', edge: 'rgba(160,184,230,0.16)', edgeHi: 'rgba(255,182,64,0.75)'
};

// fonts arrive late; forget measurements taken with fallbacks
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => VUI.measures.clear());

const VUI = {
  vector: true, ctx: null, w: 360, h: 240, clipped: 0, measures: new Map(), mctx: null,
  begin() {
    this.ctx = Gfx.ctx;
    this.w = Screen.UW; this.h = Screen.UH;
    this.clipped = 0;
    return this;
  },
  end() {
    while (this.clipped > 0) { this.ctx.restore(); this.clipped--; }
  },
  X(u) { return Gfx.pf.x + u * Gfx.ux; },
  Y(u) { return Gfx.pf.y + u * Gfx.uy; },
  // one device-pixel-ish hairline
  hair() { return Math.max(1, Math.round(Gfx.dpr)); },
  fontPx(scale) { return 10 * Math.min(Gfx.ux, Gfx.uy) * (scale || 1); },
  font(o) {
    o = o || {};
    const w = o.bold ? 700 : (o.weight || 600);
    return w + ' ' + (this.fontPx(o.scale) * (o.size || 1)).toFixed(1) + 'px ' + (o.display ? FONT_DISPLAY : FONT_UI);
  },

  /* ---------------- Surface-compatible primitives (UI units) ---------------- */
  clear() {},
  get() { return 0; },
  resetClip() { while (this.clipped > 0) { this.ctx.restore(); this.clipped--; } },
  clip(x, y, w, h) {
    this.resetClip();
    const c = this.ctx;
    c.save(); this.clipped++;
    c.beginPath(); c.rect(this.X(x), this.Y(y), w * Gfx.ux, h * Gfx.uy); c.clip();
  },
  fill(c) { const a = Theme.alphaOf(c); return a === 1 ? Theme.css(c) : Theme.css(c, a); },
  pset(x, y, c) { this.ctx.fillStyle = this.fill(c); this.ctx.fillRect(this.X(Math.floor(x)), this.Y(Math.floor(y)), Gfx.ux, Gfx.uy); },
  fillRect(x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = this.fill(c);
    this.ctx.fillRect(this.X(x), this.Y(y), w * Gfx.ux, h * Gfx.uy);
  },
  hline(xa, xb, y, c) {
    const a = Math.min(xa, xb), b = Math.max(xa, xb) + 1, t = this.hair();
    this.ctx.fillStyle = Theme.css(c, 0.55);
    this.ctx.fillRect(this.X(a), Math.round(this.Y(y + 0.5) - t / 2), (b - a) * Gfx.ux, t);
  },
  vline(x, ya, yb, c) {
    const a = Math.min(ya, yb), b = Math.max(ya, yb) + 1, t = this.hair();
    this.ctx.fillStyle = Theme.css(c, 0.55);
    this.ctx.fillRect(Math.round(this.X(x + 0.5) - t / 2), this.Y(a), t, (b - a) * Gfx.uy);
  },
  rect(x, y, w, h, c) {
    const t = this.hair(), ctx = this.ctx;
    ctx.strokeStyle = Theme.css(c, 0.7); ctx.lineWidth = t;
    ctx.strokeRect(this.X(x) + t / 2, this.Y(y) + t / 2, w * Gfx.ux - t, h * Gfx.uy - t);
  },
  line(x0, y0, x1, y1, c) {
    const ctx = this.ctx;
    ctx.strokeStyle = Theme.css(c); ctx.lineWidth = Math.max(1, Gfx.ux * 0.5); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(this.X(x0 + 0.5), this.Y(y0 + 0.5)); ctx.lineTo(this.X(x1 + 0.5), this.Y(y1 + 0.5)); ctx.stroke();
  },
  fillEllipse(cx, cy, rx, ry, c) {
    const ctx = this.ctx;
    ctx.fillStyle = Theme.css(c);
    ctx.beginPath(); ctx.ellipse(this.X(cx + 0.5), this.Y(cy + 0.5), Math.max(0.5, rx) * Gfx.ux, Math.max(0.5, ry) * Gfx.uy, 0, 0, TAU); ctx.fill();
  },
  ellipse(cx, cy, rx, ry, c) {
    const ctx = this.ctx;
    ctx.strokeStyle = Theme.css(c); ctx.lineWidth = this.hair();
    ctx.beginPath(); ctx.ellipse(this.X(cx + 0.5), this.Y(cy + 0.5), Math.max(0.5, rx) * Gfx.ux, Math.max(0.5, ry) * Gfx.uy, 0, 0, TAU); ctx.stroke();
  },
  blend(x, y, c, a) { this.ctx.fillStyle = Theme.css(c, a); this.ctx.fillRect(this.X(x), this.Y(y), Gfx.ux, Gfx.uy); },
  fillRectBlend(x, y, w, h, c, a) { this.ctx.fillStyle = Theme.css(c, a); this.ctx.fillRect(this.X(x), this.Y(y), w * Gfx.ux, h * Gfx.uy); },
  // pixel sprites (icons) stay crisp pixel art, drawn at full size
  blit(spr, dx, dy, opt) {
    if (spr.tankIcon !== undefined) { this.tank(spr.tankIcon, spr.tankColor, dx, dy, spr.w, spr.h, opt && opt.flip); return; }
    const img = spriteCanvas(spr, opt);
    const sx = (opt && opt.sx) || 1, sy = (opt && opt.sy) || 1;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, this.X(Math.floor(dx)), this.Y(Math.floor(dy)), spr.w * sx * Gfx.ux, spr.h * sy * Gfx.uy);
    ctx.imageSmoothingEnabled = true;
  },

  // a vector tank filling a w x h box (UI units): used wherever the UI shows a tank icon
  tank(icon, color, x, y, w, h, flip) {
    const ctx = this.ctx, ic = TankIcons[icon];
    const cols = ic.rows[0].length, rows = ic.rows.length;
    const P = Fx.palette({ color, hitFlash: 0, flash: 0, fx: null });
    const X = this.X(x), Y = this.Y(y), kx = w * Gfx.ux / cols, ky = h * Gfx.uy / rows;
    ctx.save();
    ctx.translate(flip ? X + w * Gfx.ux : X, Y); ctx.scale(flip ? -kx : kx, ky);
    // barrel at a jaunty 55 degrees
    ic.piv.forEach((pv, i) => {
      const a = (55 + (ic.triple ? (i - 1) * 14 : 0)) * DEG, L = 6.5;
      ctx.strokeStyle = rgba(P.deep, 1); ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pv[0] + 0.5, pv[1] + 0.5); ctx.lineTo(pv[0] + 0.5 + Math.cos(a) * L, pv[1] + 0.5 - Math.sin(a) * L * kx / ky); ctx.stroke();
      ctx.strokeStyle = rgba(mix3(P.steelHi, P.base, 0.25), 1); ctx.lineWidth = 0.8;
      ctx.stroke();
    });
    (TANK_ART[icon] || TANK_ART[0])(ctx, P, 1 / Math.min(kx, ky));
    ctx.restore();
  },

  /* ---------------- text ---------------- */
  measure(text, o) {
    const f = this.font(Object.assign({}, o, { scale: (o && o.scale || 1) }));
    const key = f + '|' + text;
    let w = this.measures.get(key);
    if (w === undefined) {
      if (!this.mctx) this.mctx = document.createElement('canvas').getContext('2d');
      this.mctx.font = f;
      w = this.mctx.measureText(text).width;
      if (this.measures.size > 3000) this.measures.clear();
      this.measures.set(key, w);
    }
    return w;
  },
  // width in UI units, as Font.width reports it
  width(str, o) {
    const p = Font.parse(String(str));
    return this.measure(p.text, o) / Gfx.ux;
  },
  text(str, x, y, c, o) {
    o = o || {};
    const p = Font.parse(String(str));
    const t = p.text;
    if (!t) return 0;
    const ctx = this.ctx;
    ctx.font = this.font(o);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const X = this.X(x), Y = this.Y(y + 7.4);
    if (o.shadow !== undefined) {
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = 4 * Gfx.dpr; ctx.shadowOffsetY = 1 * Gfx.dpr;
    }
    ctx.fillStyle = Theme.css(c);
    ctx.fillText(t, X, Y);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (p.hot >= 0) {
      const pre = this.measure(t.slice(0, p.hot), o), cw = this.measure(t[p.hot], o);
      const hc = o.hotColor !== undefined ? o.hotColor : c;
      if (o.hotColor !== undefined) { ctx.fillStyle = Theme.css(hc); ctx.fillText(t[p.hot], X + pre, Y); }
      if (o.underline !== false) {
        const th = Math.max(1, Gfx.dpr);
        ctx.fillStyle = Theme.css(hc, 0.9);
        ctx.fillRect(X + pre, Y + 2 * Gfx.dpr, cw, th);
      }
    }
    return this.measure(t, o) / Gfx.ux;
  },

  /* ---------------- modern widgets (called by frame()/drawButton()... in vector mode) ---------------- */
  rr(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  },
  panel(x, y, w, h, o) {
    o = o || {};
    const ctx = this.ctx, X = this.X(x), Y = this.Y(y), W = w * Gfx.ux, H = h * Gfx.uy;
    const r = (o.radius !== undefined ? o.radius : 4) * Math.min(Gfx.ux, Gfx.uy);
    ctx.save();
    if (o.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 24 * Gfx.dpr; ctx.shadowOffsetY = 6 * Gfx.dpr; }
    this.rr(X, Y, W, H, r);
    const g = ctx.createLinearGradient(0, Y, 0, Y + H);
    g.addColorStop(0, o.top || 'rgba(26,34,52,0.94)');
    g.addColorStop(1, o.bottom || 'rgba(12,16,26,0.94)');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    this.rr(X + 0.5, Y + 0.5, W - 1, H - 1, r);
    ctx.lineWidth = this.hair();
    ctx.strokeStyle = o.edge || Theme.edge; ctx.stroke();
    // a lit top edge
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(X + r, Y + this.hair(), W - 2 * r, this.hair());
    if (o.accent) { ctx.fillStyle = o.accent; ctx.fillRect(X + r, Y, W - 2 * r, Math.max(2, 2 * Gfx.dpr)); }
  },
  hover(x, y, w, h) {
    return Input.ux >= x && Input.ux < x + w && Input.uy >= y && Input.uy < y + h && Input.inside;
  },
  button(x, y, w, h, label, o) {
    o = o || {};
    const ctx = this.ctx, X = this.X(x), Y = this.Y(y), W = w * Gfx.ux, H = h * Gfx.uy;
    const r = 3 * Math.min(Gfx.ux, Gfx.uy);
    const hot = !o.disabled && this.hover(x, y, w, h);
    const down = !!o.pressed;
    this.rr(X, Y + (down ? Gfx.dpr : 0), W, H, r);
    const g = ctx.createLinearGradient(0, Y, 0, Y + H);
    if (o.disabled) { g.addColorStop(0, 'rgba(34,40,54,0.7)'); g.addColorStop(1, 'rgba(24,28,38,0.7)'); }
    else if (down) { g.addColorStop(0, 'rgba(20,26,40,1)'); g.addColorStop(1, 'rgba(30,38,58,1)'); }
    else if (hot) { g.addColorStop(0, 'rgba(58,74,108,1)'); g.addColorStop(1, 'rgba(36,46,70,1)'); }
    else { g.addColorStop(0, 'rgba(44,56,82,1)'); g.addColorStop(1, 'rgba(28,36,54,1)'); }
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = this.hair();
    ctx.strokeStyle = hot ? Theme.edgeHi : 'rgba(150,176,230,0.22)';
    ctx.stroke();
    if (!down && !o.disabled) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(X + r, Y + this.hair(), W - 2 * r, this.hair()); }
    const ty = y + (h - 8) / 2 + (down ? 0.3 : 0);
    const col = o.disabled ? UIC.dis : (o.color === undefined ? UIC.text : o.color);
    const hc = o.disabled ? UIC.dis : UIC.hot;
    if (o.value !== undefined) {
      this.text(label, x + 5, ty, col, { hotColor: hc });
      const vs = String(o.value), vw = this.width(vs);
      this.text(vs.replace(/&/g, '&&'), x + w - 5 - vw, ty, o.disabled ? UIC.dis : UIC.hot);
    } else if (o.align === 'left') {
      this.text(label, x + 5, ty, col, { hotColor: hc });
    } else {
      const tw = this.width(label);
      this.text(label, x + (w - tw) / 2, ty, col, { hotColor: hc });
    }
  },
  // a list row: quiet by default, lit when selected or hovered
  row(x, y, w, h, o) {
    o = o || {};
    const ctx = this.ctx, X = this.X(x), Y = this.Y(y), W = w * Gfx.ux, H = h * Gfx.uy;
    const r = 2.5 * Math.min(Gfx.ux, Gfx.uy), hot = this.hover(x, y, w, h);
    this.rr(X, Y, W, H, r);
    if (o.flash) ctx.fillStyle = 'rgba(255,214,120,0.55)';
    else if (o.sel) {
      const g = ctx.createLinearGradient(X, 0, X + W, 0);
      g.addColorStop(0, 'rgba(255,182,64,0.32)'); g.addColorStop(1, 'rgba(255,182,64,0.08)');
      ctx.fillStyle = g;
    } else ctx.fillStyle = hot ? 'rgba(150,176,230,0.14)' : o.odd ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    if (o.sel) { ctx.lineWidth = this.hair(); ctx.strokeStyle = 'rgba(255,182,64,0.6)'; ctx.stroke(); }
  },
  bevel(x, y, w, h, raised, face) {
    const ctx = this.ctx, X = this.X(x), Y = this.Y(y), W = w * Gfx.ux, H = h * Gfx.uy;
    const r = 2.5 * Math.min(Gfx.ux, Gfx.uy);
    this.rr(X, Y, W, H, r);
    if (face !== undefined) {
      ctx.fillStyle = face === UIC.field ? 'rgba(6,9,15,0.9)' : face === UIC.light ? 'rgba(52,70,108,0.95)' : 'rgba(30,38,58,0.9)';
      ctx.fill();
    }
    ctx.lineWidth = this.hair();
    ctx.strokeStyle = raised ? 'rgba(150,176,230,0.25)' : 'rgba(0,0,0,0.55)';
    ctx.stroke();
    if (!raised) { ctx.strokeStyle = 'rgba(150,176,230,0.12)'; this.rr(X + this.hair(), Y + this.hair(), W - 2 * this.hair(), H - 2 * this.hair(), r); ctx.stroke(); }
  },
  check(x, y, on, disabled) {
    const ctx = this.ctx, X = this.X(x), Y = this.Y(y), S = 9 * Gfx.ux, SY = 9 * Gfx.uy;
    const r = 2 * Math.min(Gfx.ux, Gfx.uy);
    this.rr(X, Y, S, SY, r);
    ctx.fillStyle = on ? (disabled ? 'rgba(120,120,130,0.8)' : Theme.accent) : 'rgba(6,9,15,0.9)';
    ctx.fill();
    ctx.lineWidth = this.hair(); ctx.strokeStyle = on ? 'rgba(255,220,150,0.8)' : 'rgba(150,176,230,0.3)'; ctx.stroke();
    if (on) {
      ctx.strokeStyle = '#1a1206'; ctx.lineWidth = Math.max(1.5, Gfx.ux * 0.55); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(X + S * 0.24, Y + SY * 0.52); ctx.lineTo(X + S * 0.44, Y + SY * 0.72); ctx.lineTo(X + S * 0.78, Y + SY * 0.3); ctx.stroke();
    }
  },
  field(x, y, w, text, caret, maxShow) {
    this.bevel(x, y, w, 12, false, UIC.field);
    const ctx = this.ctx;
    if (caret) { this.rr(this.X(x), this.Y(y), w * Gfx.ux, 12 * Gfx.uy, 2.5 * Math.min(Gfx.ux, Gfx.uy)); ctx.strokeStyle = Theme.edgeHi; ctx.lineWidth = this.hair(); ctx.stroke(); }
    let t = String(text);
    while (t.length && this.width(t.replace(/&/g, '&&')) > w - 7) t = t.slice(1);
    const tw = this.text(t.replace(/&/g, '&&'), x + 3.5, y + 2, UIC.text);
    if (caret && (Math.floor(performance.now() / 450) & 1)) {
      ctx.fillStyle = Theme.accent;
      ctx.fillRect(this.X(x + 4 + tw), this.Y(y + 2), Math.max(1.5, Gfx.dpr * 1.5), 8.5 * Gfx.uy);
    }
  }
};

Theme.alphaOf = function (c) {
  if (!this.modern) return 1;
  if (c === UIC.face) return 0.9;
  if (c === UIC.light || c === UIC.dark) return 0.92;
  return 1;
};

// pixel sprite -> canvas (cached per sprite and look)
const spriteCache = new WeakMap();
function spriteCanvas(spr, opt) {
  const key = (opt && opt.flip ? 'f' : '') + (opt && opt.tint ? String(opt.tint) : '');
  let m = spriteCache.get(spr);
  if (!m) { m = new Map(); spriteCache.set(spr, m); }
  let c = m.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = spr.w; c.height = spr.h;
  const g = c.getContext('2d'), img = g.createImageData(spr.w, spr.h), out = new Uint32Array(img.data.buffer);
  const data = spr.data || spr.buf, flip = opt && opt.flip, tint = opt && opt.tint;
  for (let y = 0; y < spr.h; y++) {
    for (let x = 0; x < spr.w; x++) {
      let v = data[y * spr.w + (flip ? spr.w - 1 - x : x)];
      if (!v) continue;
      if (tint) v = tint(v);
      out[y * spr.w + x] = v;
    }
  }
  g.putImageData(img, 0, 0);
  if (m.size < 32) m.set(key, c);
  return c;
}
