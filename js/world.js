'use strict';
/* =====================================================================
   World: sky, land bitmap (palette-indexed dirt), traces, composite
   buffer, terrain generation, crater carving, dirt adding and the
   column-based falling-dirt simulation.
   ===================================================================== */

const LAND_SCHEMES = [
  [vga(52, 36, 18), vga(38, 24, 9), vga(22, 12, 3)],                       // brown earth
  [vga(16, 50, 10), vga(22, 40, 8), vga(34, 24, 8), vga(18, 10, 2)],       // grassland
  [vga(63, 52, 26), vga(56, 38, 14), vga(40, 22, 6)],                      // desert
  [vga(63, 63, 63), vga(46, 48, 54), vga(26, 28, 36)],                     // snow
  [vga(60, 30, 16), vga(46, 17, 8), vga(26, 6, 2)],                        // red rock
  [vga(46, 26, 54), vga(31, 12, 40), vga(14, 4, 22)],                      // purple haze
  [vga(40, 44, 12), vga(30, 30, 8), vga(18, 16, 4)],                       // olive moss
  [vga(48, 48, 48), vga(34, 32, 30), vga(18, 16, 14)],                     // granite
  [vga(20, 44, 44), vga(10, 30, 32), vga(4, 14, 18)],                      // teal alien
  [vga(63, 40, 10), vga(50, 16, 6), vga(30, 4, 8), vga(14, 2, 10)]         // martian
];

const World = {
  W: 0, H: 0, top: 0, ay: 1,
  land: null, pal: new Uint32Array(256), sky: null, trace: null, comp: null,
  unstable: null, suspended: false,
  heights: null, ceil: null,
  skyType: 'SHADED', scanned: false, cavern: false, landTop: 0,
  stars: [], seed: 1,
  // for the Remastered renderer (cosmetic): change counters, burn marks, the sun's place
  ver: 0, palVer: 0, scorchMask: null, scorchVer: 0, sun: null,

  init(W, H, top) {
    this.W = W; this.H = H; this.top = top; this.ay = Screen.ay;
    const n = W * H;
    this.land = new Uint8Array(n);
    this.sky = new Uint32Array(n);
    this.trace = new Uint32Array(n);
    this.comp = new Uint32Array(n);
    this.unstable = new Uint8Array(W);
    this.heights = new Float64Array(W);
    this.ceil = new Int32Array(W);
    this.scorchMask = new Uint8Array(n);
    this.ver++; this.scorchVer++;
  },

  /* ------------------------------ generation ------------------------------ */
  generate(skyType) {
    this.seed = sirand(1, 1e9);
    this.skyType = skyType;
    this.cavern = skyType === 'CAVERN';
    this.scanned = schance(Cfg.scannedMountains / 100);
    this.land.fill(0); this.trace.fill(0); this.unstable.fill(0);
    this.suspended = false;
    this.genSky(skyType);
    if (this.scanned) this.genScanned(); else this.genHeights();
    this.buildPalette();
    this.fillLand();
    if (this.cavern) this.genCeiling();
    this.rebuild();
    this.scorchMask.fill(0);
    this.ver++; this.scorchVer++;
    if (this === World && typeof Fx !== 'undefined') Fx.clearTrace();
  },

  genSky(type) {
    const W = this.W, H = this.H, sky = this.sky;
    this.sun = null; this.cloudEdge = null;
    const grad = (stops, bands) => {
      for (let y = 0; y < H; y++) {
        let t = y / (H - 1);
        if (bands) t = Math.floor(t * bands) / (bands - 1);
        const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f));
        const c = vgaq(mixc(stops[i], stops[i + 1], f - i));
        sky.fill(c, y * W, (y + 1) * W);
      }
    };
    if (type === 'PLAIN') sky.fill(vga(9, 9, 31));          // 1.5's flat indigo
    else if (type === 'BLACK') sky.fill(vga(0, 0, 0));
    else if (type === 'SHADED') grad([vga(0, 0, 6), vga(4, 8, 30), vga(18, 30, 58)], 40);
    else if (type === 'SUNSET') {
      grad([vga(6, 0, 16), vga(26, 2, 36), vga(50, 6, 30), vga(63, 22, 8), vga(63, 46, 10), vga(63, 60, 30)], 36);
      // setting sun, low on the horizon
      const sx = W * srand(0.2, 0.8), sy = this.top + (H - this.top) * 0.62, r = W * 0.09;
      this.sun = { x: sx, y: sy, r };
      for (let y = Math.floor(sy - r * this.ay); y <= sy + r * this.ay; y++) {
        if (y < 0 || y >= H) continue;
        const dy = (y - sy) / this.ay, hw = Math.sqrt(Math.max(0, r * r - dy * dy));
        const band = Math.floor((y - (sy - r * this.ay)) / (3 * this.ay));
        if (dy > 0 && band % 2 === 1) continue; // striped retro sun
        for (let x = Math.floor(sx - hw); x <= sx + hw; x++) if (x >= 0 && x < W) sky[y * W + x] = vga(63, 58 - Math.max(0, dy) * 0.4, 20);
      }
    } else if (type === 'STARS' || type === 'CAVERN') {
      if (type === 'CAVERN') {
        // 1.5: warm grey air, darkest halfway between floor and ceiling, in bands
        const top = this.top, mid = top + (H - top) / 2, half = (H - top) / 2;
        for (let y = 0; y < H; y++) {
          const d = Math.floor(Math.min(1, Math.abs(y - mid) / half) * 24) / 24, v = 9 + 32 * d;
          sky.fill(vga(v, v, v * 0.88), y * W, (y + 1) * W);
        }
      }
      else sky.fill(vga(0, 0, 0));
      if (type === 'STARS') {
        const n = Math.floor(W * H / 700);
        for (let i = 0; i < n; i++) {
          const x = sirand(0, W - 1), y = sirand(0, H - 1);
          const b = srand(20, 63);
          sky[y * W + x] = vga(b, b, Math.min(63, b + srand(0, 10)));
          if (schance(0.06) && x + 1 < W && y + 1 < H) {
            sky[y * W + x + 1] = vga(b * 0.6, b * 0.6, b * 0.7);
            sky[(y + 1) * W + x] = vga(b * 0.6, b * 0.6, b * 0.7);
          }
        }
      }
    } else if (type === 'STORMY') {
      // 1.5: a banded deep-blue sky under a grey cloud band with a lumpy lower edge; the band
      // fades from black at the top to mid grey (lightning lights it up - see Battle.draw)
      grad([vga(6, 6, 37), vga(0, 0, 29)], 10);
      const top = this.top, ph = H - top, seed = this.seed;
      this.cloudEdge = new Int16Array(W);
      for (let x = 0; x < W; x++) {
        const e = Math.round(top + ph * (0.085 + 0.05 * fbm2(x / (W * 0.09), 0.5, seed + 31, 3)));
        this.cloudEdge[x] = e;
        for (let y = top; y < e; y++) {
          const v = 25 * (y - top) / Math.max(1, e - top);
          sky[y * W + x] = vga(v, v, v);
        }
      }
    }
  },

  midpoint(W, bump, anchors) {
    let n = 1; while (n < W) n <<= 1;
    const h = new Float64Array(n + 1);
    anchors = 1 << clamp(Math.round(Math.log2(anchors)), 0, 4);   // keep every step an integer
    const seg = n / anchors;
    for (let i = 0; i <= anchors; i++) h[Math.floor(i * seg)] = srand(-1, 1);
    // Bumpiness: low keeps 1.5's long straight slopes, high gets craggy
    const rough = 1.55 - bump / 100 * 1.1;
    let step = seg, disp = 0.55;
    while (step > 1) {
      const half = step >> 1;
      for (let i = half; i < n; i += step) h[i] = (h[i - half] + h[i + half]) / 2 + srand(-disp, disp);
      disp *= Math.pow(2, -rough);
      step = half;
    }
    return h;
  },

  genHeights() {
    const W = this.W, H = this.H, playH = H - this.top;
    let bump = Cfg.bumpiness, slope = Cfg.slope, flatten = Cfg.flattenPeaks;
    if (Cfg.randomLand) { bump = sirand(0, 100); slope = sirand(0, 100); flatten = schance(0.35); }
    const h = this.midpoint(W, bump, 1 << sirand(1, 3));
    let mn = Infinity, mx = -Infinity;
    for (let x = 0; x < W; x++) { mn = Math.min(mn, h[x]); mx = Math.max(mx, h[x]); }
    // Slope sets how tall the mountains get. 1.5's default (20) makes steep ranges that run
    // from near the top of the screen down to the bottom; 0 is gently rolling.
    // ...but not every round: some are rolling hills under one big ridge. The valleys sit near
    // the bottom of the screen either way, as in 1.5.
    const spread = playH * (1 - 0.72 * Math.exp(-slope / 12)) * srand(0.45, 1) * (this.cavern ? 0.55 : 1);
    const rng = Math.max(1e-6, mx - mn);
    const bottom = H - 3 - playH * srand(0, 0.1);
    const lo = this.top + playH * (this.cavern ? 0.42 : 0.07), hi = H - 3;
    for (let x = 0; x < W; x++) this.heights[x] = clamp(bottom - (h[x] - mn) / rng * spread, lo, hi);
    if (flatten) this.flattenSlopes(0.8 * this.ay);
  },

  flattenSlopes(maxStep) {
    const hts = this.heights, W = this.W;
    for (let x = 1; x < W; x++) hts[x] = Math.max(hts[x], hts[x - 1] - maxStep);
    for (let x = W - 2; x >= 0; x--) hts[x] = Math.max(hts[x], hts[x + 1] - maxStep);
  },

  // imitation of the digitized ("scanned") mountain ranges: craggy peaks
  genScanned() {
    const W = this.W, H = this.H, playH = H - this.top;
    const peaks = sirand(1, 3), seed = this.seed;
    const base = H - playH * srand(0.12, 0.25);
    const pk = [];
    for (let i = 0; i < peaks; i++) pk.push({ cx: W * srand(0.1, 0.9), h: playH * srand(0.35, this.cavern ? 0.45 : 0.68), w: W * srand(0.18, 0.45) });
    for (let x = 0; x < W; x++) {
      let up = 0;
      for (const p of pk) {
        const t = 1 - Math.abs(x - p.cx) / p.w;
        if (t > 0) up = Math.max(up, p.h * Math.pow(t, 1.25));
      }
      const ridge = (1 - Math.abs(fbm2(x / (W * 0.06), 0.5, seed, 5) * 2 - 1));
      up += ridge * playH * 0.08 + fbm2(x / (W * 0.015), 3.5, seed + 9, 3) * playH * 0.03;
      this.heights[x] = clamp(base - up, this.top + playH * (this.cavern ? 0.42 : 0.1), H - 3);
    }
  },

  genCeiling() {
    const W = this.W, playH = this.H - this.top;
    const h = this.midpoint(W, 30, 1 << sirand(2, 4));
    let mn = Infinity, mx = -Infinity;
    for (let x = 0; x < W; x++) { mn = Math.min(mn, h[x]); mx = Math.max(mx, h[x]); }
    for (let x = 0; x < W; x++) {
      // as in 1.5 the roof hangs anywhere from near the top to halfway down, closing in on the
      // floor in places (but leaving room to stand and shoot)
      let c = this.top + playH * (0.08 + (h[x] - mn) / Math.max(1e-6, mx - mn) * 0.42);
      c = Math.min(c, this.heights[x] - playH * 0.16);
      this.ceil[x] = Math.max(this.top + 2, Math.floor(c));
    }
    const land = this.land;
    for (let x = 0; x < W; x++) {
      for (let y = this.top; y < this.ceil[x]; y++) land[y * W + x] = this.dirtIndex(x, y);
    }
  },

  buildPalette() {
    const pal = this.pal;
    pal[0] = 0;
    if (this.scanned) {
      const tint = spick([[1, 0.93, 0.82], [0.95, 0.95, 0.98], [1, 0.85, 0.7], [0.9, 0.92, 0.85]]);
      for (let i = 1; i < 256; i++) {
        const t = (i - 1) / 254;
        let v = 10 + t * 50;
        if (i > 230) v = 58 + (i - 230) / 25 * 5; // snow
        const s = i > 230 ? [1, 1, 1] : tint;
        pal[i] = vga(v * s[0], v * s[1], v * s[2]);
      }
    } else {
      const stops = spick(LAND_SCHEMES);
      for (let i = 1; i < 256; i++) {
        const t = (i - 1) / 254;
        const f = t * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f));
        pal[i] = vgaq(mixc(stops[k], stops[k + 1], f - k));
      }
    }
    let lt = this.H;
    for (let x = 0; x < this.W; x++) lt = Math.min(lt, this.heights[x]);
    this.landTop = Math.floor(lt);
    this.palVer++;
  },

  // palette index for a dirt pixel at (x, y) (used for new dirt too)
  dirtIndex(x, y) {
    if (this.scanned) {
      const v = fbm2(x / 6, y / (18 * this.ay), this.seed + 77, 3);
      return 1 + Math.floor(clamp(0.18 + v * 0.55, 0, 0.99) * 229);
    }
    const t = clamp((y - this.landTop) / Math.max(1, this.H - this.landTop), 0, 1);
    // banded gradient, like a VGA ramp
    const bands = 40;
    return 1 + Math.floor(Math.floor(t * bands) / bands * 254);
  },
  // digitized-photo look: vertical rock streaks, light from the left, snow on high surfaces
  scannedIndex(x, y, surf, slope, snowLine) {
    const ay = this.ay, depth = (y - surf) / ay;
    const n = fbm2(x / 5, y / (20 * ay), this.seed + 77, 4);
    const big = noise2(x / 45, y / (45 * ay), this.seed + 5);
    const light = clamp(0.5 - slope * 0.12, 0.05, 0.95);
    let t = 0.12 + n * 0.5 + big * 0.22 + (depth < 24 ? (light - 0.5) * 0.5 * (1 - depth / 24) : 0) - Math.min(0.2, depth * 0.0012);
    if (surf < snowLine && depth < 2 + n * 7) return 231 + Math.floor(n * 24) % 25;
    return 1 + Math.floor(clamp(t, 0, 0.99) * 229);
  },

  fillLand() {
    const W = this.W, H = this.H, land = this.land, hts = this.heights;
    const snowLine = this.landTop + (H - this.landTop) * 0.22;
    for (let x = 0; x < W; x++) {
      const h0 = Math.floor(hts[x]);
      const slope = (hts[Math.min(W - 1, x + 2)] - hts[Math.max(0, x - 2)]) / (4 * this.ay);
      for (let y = Math.max(this.top, h0); y < H; y++) {
        land[y * W + x] = this.scanned ? this.scannedIndex(x, y, h0, slope, snowLine) : this.dirtIndex(x, y);
      }
    }
  },

  rebuild() {
    const land = this.land, comp = this.comp, sky = this.sky, trace = this.trace, pal = this.pal;
    for (let i = 0; i < comp.length; i++) comp[i] = land[i] ? pal[land[i]] : (trace[i] || sky[i]);
  },
  bgAt(i) { return this.trace[i] || this.sky[i]; },

  /* ------------------------------ queries ------------------------------ */
  isLand(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= this.W || y >= this.H) return y >= this.H;
    if (y < 0) return false;
    return this.land[y * this.W + x] !== 0;
  },
  // first land row at or below y0 in column x (H if none)
  groundY(x, y0) {
    x = Math.floor(x);
    if (x < 0 || x >= this.W) return this.H;
    const W = this.W, land = this.land;
    for (let y = Math.max(0, Math.floor(y0)); y < this.H; y++) if (land[y * W + x]) return y;
    return this.H;
  },
  // top of the ground surface under the sky (skipping a cavern ceiling)
  surfaceY(x) {
    x = clamp(Math.floor(x), 0, this.W - 1);
    let y = this.top;
    if (this.cavern) {
      const W = this.W, land = this.land;
      while (y < this.H && land[y * W + x]) y++;
    }
    return this.groundY(x, y);
  },

  /* ------------------------------ modification ------------------------------ */
  markUnstable(x0, x1) {
    x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(this.W - 1, Math.floor(x1));
    for (let x = x0; x <= x1; x++) this.unstable[x] = 1;
  },
  clearPixel(i) {
    if (this.land[i]) { this.land[i] = 0; this.comp[i] = this.trace[i] || this.sky[i]; this.scorchMask[i] = 0; this.ver++; return true; }
    return false;
  },
  setPixel(i, idx) {
    this.land[i] = idx; this.comp[i] = this.pal[idx]; this.ver++;
  },
  carveEllipse(cx, cy, rx, ry, quiet, residue, seed) {
    const W = this.W, H = this.H;
    let n = 0;
    const ya = Math.max(this.top, Math.ceil(cy - ry)), yb = Math.min(H - 1, Math.floor(cy + ry));
    for (let y = ya; y <= yb; y++) {
      const t = (y - cy) / ry, q = 1 - t * t;
      if (q < 0) continue;
      const hw = rx * Math.sqrt(q);
      const xa = Math.max(0, Math.round(cx - hw)), xb = Math.min(W - 1, Math.round(cx + hw));
      for (let x = xa; x <= xb; x++) {
        // 1.5's underground blasts leave loose specks that fall afterwards
        if (residue && hash2(x, y, seed | 0) < residue) continue;
        if (this.clearPixel(y * W + x)) n++;
      }
    }
    if (!quiet) this.markUnstable(cx - rx - 1, cx + rx + 1);
    return n;
  },
  addEllipse(cx, cy, rx, ry, density, quiet) {
    const W = this.W, H = this.H;
    const ya = Math.max(this.top, Math.ceil(cy - ry)), yb = Math.min(H - 1, Math.floor(cy + ry));
    for (let y = ya; y <= yb; y++) {
      const t = (y - cy) / ry, q = 1 - t * t;
      if (q < 0) continue;
      const hw = rx * Math.sqrt(q);
      const xa = Math.max(0, Math.round(cx - hw)), xb = Math.min(W - 1, Math.round(cx + hw));
      for (let x = xa; x <= xb; x++) {
        const i = y * W + x;
        if (!this.land[i] && (density === undefined || Math.random() < density)) this.setPixel(i, this.dirtIndex(x, y));
      }
    }
    if (!quiet) this.markUnstable(cx - rx - 1, cx + rx + 1);
  },
  addPixel(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= this.W || y < this.top || y >= this.H) return false;
    const i = y * this.W + x;
    if (this.land[i]) return false;
    this.setPixel(i, this.dirtIndex(x, y));
    this.unstable[x] = 1;
    return true;
  },
  // wedge (sector) of radius r (in columns) around (cx, cy), angles in degrees (0 = right, 90 = up)
  carveSector(cx, cy, r, a0, a1, rStart, quiet, residue, seed, full) {
    const W = this.W, ay = this.ay;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(this.top, Math.floor(cy - r * ay)), y1 = Math.min(this.H - 1, Math.ceil(cy + r * ay));
    const r0 = rStart || 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = (cy - y) / ay, d = Math.hypot(dx, dy);
        if (d > r || d < r0) continue;
        let a = Math.atan2(dy, dx) / DEG;
        if (!full && !angleIn(a, a0, a1)) continue;
        if (residue && hash2(x, y, seed | 0) < residue) continue;
        this.clearPixel(y * W + x);
      }
    }
    if (!quiet) this.markUnstable(x0 - 1, x1 + 1);
  },
  tracePixel(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    this.trace[i] = c;
    if (!this.land[i]) this.comp[i] = c;
    if (this === World && typeof Fx !== 'undefined') Fx.addTrace(x + 0.5, y + 0.5, c);
  },
  clearTraces() { this.trace.fill(0); this.rebuild(); if (this === World && typeof Fx !== 'undefined') Fx.clearTrace(); },
  // scorch: darken existing dirt pixels near a point (napalm burn marks)
  scorch(cx, cy, r, f) {
    const W = this.W;
    for (let y = Math.floor(cy - r * this.ay); y <= cy + r * this.ay; y++) {
      if (y < this.top || y >= this.H) continue;
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || x >= W) continue;
        const i = y * W + x;
        if (this.land[i] && chance(0.5)) {
          this.comp[i] = scalec(this.comp[i], f);
          this.scorchMask[i] = Math.min(255, this.scorchMask[i] + Math.round((1 - f) * 200));
        }
      }
    }
    this.scorchVer++;
  },

  /* ------------------------------ falling dirt ------------------------------ */
  needsSettle() {
    if (this.suspended) return false;
    for (let x = 0; x < this.W; x++) if (this.unstable[x]) return true;
    return false;
  },
  // move floating dirt down by up to `passes` rows; returns true while anything moves
  settle(passes) {
    if (this.suspended) return false;
    const W = this.W, H = this.H, land = this.land, comp = this.comp, pal = this.pal;
    let moving = false;
    for (let x = 0; x < W; x++) {
      if (!this.unstable[x]) continue;
      // a cavern ceiling hanging from the top edge is anchored
      let yMin = this.top;
      if (this.cavern) { while (yMin < H && land[yMin * W + x]) yMin++; }
      let colMoved = false;
      for (let p = 0; p < passes; p++) {
        let any = false;
        for (let y = H - 2; y >= yMin; y--) {
          const i = y * W + x;
          if (land[i] !== 0 && land[i + W] === 0) {
            land[i + W] = land[i]; comp[i + W] = pal[land[i]];
            land[i] = 0; comp[i] = this.trace[i] || this.sky[i];
            any = true;
          }
        }
        if (!any) break;
        colMoved = true;
      }
      if (colMoved) moving = true; else this.unstable[x] = 0;
    }
    if (moving) this.ver++;
    return moving;
  },
  // instantly drop all floating dirt (used by Earth Disrupter + final settle)
  settleAll() {
    const W = this.W, H = this.H, land = this.land;
    this.suspended = false;
    for (let x = 0; x < W; x++) {
      let yMin = this.top;
      if (this.cavern) { while (yMin < H && land[yMin * W + x]) yMin++; }
      let write = H - 1;
      for (let y = H - 1; y >= yMin; y--) {
        const i = y * W + x;
        if (land[i]) {
          if (write !== y) { land[write * W + x] = land[i]; land[i] = 0; }
          write--;
        }
      }
      this.unstable[x] = 0;
    }
    this.rebuild();
    this.ver++;
  }
};

/* ---------- compact terrain encoding for network resyncs ----------
   Each column is alternating air/dirt run lengths from the top (base 36);
   colors are cosmetic, so a receiver keeps its own where it has dirt. */
World.encodeLand = function () {
  const W = this.W, H = this.H, land = this.land, cols = [];
  for (let x = 0; x < W; x++) {
    const runs = [];
    let solid = false, run = 0;
    for (let y = 0; y < H; y++) {
      const s = land[y * W + x] !== 0;
      if (s !== solid) { runs.push(run.toString(36)); run = 0; solid = s; }
      run++;
    }
    runs.push(run.toString(36));
    cols.push(runs.join(','));
  }
  return cols.join('|');
};
World.decodeLand = function (str) {
  const W = this.W, H = this.H, land = this.land;
  String(str).split('|').forEach((col, x) => {
    if (x >= W) return;
    let y = 0, solid = false;
    for (const r of col.split(',')) {
      const n = parseInt(r, 36) || 0;
      for (let k = 0; k < n && y < H; k++, y++) {
        const i = y * W + x;
        if (!solid) land[i] = 0;
        else if (!land[i]) land[i] = this.scanned ? this.scannedIndex(x, y, y, 0, -1) : this.dirtIndex(x, y);
      }
      solid = !solid;
    }
  });
  this.rebuild();
  this.ver++;
};
World.encodeBits = function (arr) {
  const runs = [];
  let v = 0, run = 0;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i] ? 1 : 0;
    if (b !== v) { runs.push(run); run = 0; v = b; }
    run++;
  }
  runs.push(run);
  return runs.join(',');
};
World.decodeBits = function (str, arr) {
  let i = 0, v = 0;
  for (const r of String(str).split(',')) {
    const n = +r || 0;
    for (let k = 0; k < n && i < arr.length; k++) arr[i++] = v;
    v = 1 - v;
  }
};

// is angle a (degrees) inside the arc from a0 to a1 (counter-clockwise)?
function angleIn(a, a0, a1) {
  const n = v => ((v % 360) + 360) % 360;
  a = n(a); a0 = n(a0); a1 = n(a1);
  return a0 <= a1 ? (a >= a0 && a <= a1) : (a >= a0 || a <= a1);
}
