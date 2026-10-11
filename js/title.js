'use strict';
/* =====================================================================
   The landscape behind the menus: a sunset valley with two tanks
   trading the odd (harmless, cosmetic) shot.
   ===================================================================== */

const Title = {
  world: null, tanks: [], shots: [], next: 1.5, turn: 0,
  build() {
    const saved = SR.s;
    SR.seed(19910501);
    const tw = Object.create(World);
    tw.init(Screen.W, Screen.H, Math.round(12 * Screen.UY));
    tw.seed = 5150; tw.skyType = 'SUNSET'; tw.cavern = false; tw.scanned = false;
    tw.genSky('SUNSET');
    const bump = Cfg.bumpiness, slope = Cfg.slope, rl = Cfg.randomLand, fl = Cfg.flattenPeaks;
    Cfg.bumpiness = 35; Cfg.slope = 45; Cfg.randomLand = false; Cfg.flattenPeaks = false;
    tw.genHeights();
    Cfg.bumpiness = bump; Cfg.slope = slope; Cfg.randomLand = rl; Cfg.flattenPeaks = fl;
    tw.buildPalette();
    // a warm, sunset-friendly land scheme
    const stops = [vga(60, 30, 16), vga(40, 14, 16), vga(18, 5, 12)];
    for (let i = 1; i < 256; i++) {
      const t = (i - 1) / 254, f = t * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f));
      tw.pal[i] = mixc(stops[k], stops[k + 1], f - k);
    }
    tw.palVer = (tw.palVer || 0) + 1;
    tw.fillLand();
    tw.ver = (tw.ver || 0) + 1;
    SR.s = saved;
    this.world = tw;
    const mk = (i, x, icon) => {
      const t = new Tank({ icon, color: Data.playerColors[i], name: '' });
      t.x = Math.round(x);
      // level a pad under the tank, as a battle does, so it sits on the ground instead of over a slope
      const W = tw.W, half = Math.ceil(t.w / 2) + 1;
      let sum = 0, k = 0;
      for (let c = t.x - half; c <= t.x + half; c++) { sum += tw.surfaceY(c); k++; }
      const y0 = clamp(Math.round(sum / k), tw.top + t.hh + 4, tw.H - 1);
      for (let c = Math.max(0, t.x - half); c <= Math.min(W - 1, t.x + half); c++) {
        for (let y = y0 - t.hh - 3; y < y0; y++) if (y >= tw.top) tw.clearPixel(y * W + c);
        for (let y = y0; y < tw.H; y++) { const i = y * W + c; if (tw.land[i]) break; tw.setPixel(i, tw.dirtIndex(c, y)); }
      }
      tw.ver++;
      t.y = y0;
      t.angle = x < tw.W / 2 ? 55 : 125;
      return t;
    };
    this.tanks = [mk(0, tw.W * 0.44, 0), mk(1, tw.W * 0.86, 2)];
    this.shots = [];
  },
  update(dt) {
    const tw = this.world;
    this.next -= dt;
    const g = 0.278 * tw.W * tw.ay * 0.9;
    if (this.next <= 0) {
      this.next = rand(2.5, 4.5);
      const from = this.tanks[this.turn % 2], to = this.tanks[(this.turn + 1) % 2];
      this.turn++;
      from.target = { a: from.x < to.x ? rand(48, 66) : 180 - rand(48, 66) };
      from.fireAt = 0.6;
      from.shotTo = to;
    }
    for (const t of this.tanks) {
      if (t.target) t.angle += (t.target.a - t.angle) * Math.min(1, dt * 4);
      if (t.fireAt !== undefined) {
        t.fireAt -= dt;
        if (t.fireAt <= 0) {
          delete t.fireAt;
          // solve a simple arc that lands near the other tank
          const m = t.muzzle(0), to = t.shotTo, a = t.angle * DEG;
          const dx = (to.x + rand(-10, 10)) - m.x, dy = (to.top - m.y) / tw.ay;
          const c = Math.cos(a), s = Math.sin(a);
          const denom = 2 * c * c * (dx * Math.tan(a) - dy);
          const v = denom > 0 ? Math.sqrt(g / tw.ay * dx * dx / denom) : 200;
          this.shots.push({ x: m.x, y: m.y, vx: c * v, vy: -s * v * tw.ay, trail: [], t: 0 });
          Fx.add({ k: 'glow', x: m.x, y: m.y, vx: 0, vy: 0, life: 0.2, size: 3, grow: 2, c: [255, 210, 140], alpha: 0.9, front: 1 });
        }
      }
    }
    for (const s of this.shots) {
      s.t += dt;
      const n = 6;
      for (let i = 0; i < n && !s.done; i++) {
        s.vy += g * dt / n; s.x += s.vx * dt / n; s.y += s.vy * dt / n;
        if (s.y >= tw.H - 1 || (s.y > tw.top && tw.isLand(s.x, s.y)) || s.x < -20 || s.x > tw.W + 20) {
          s.done = true;
          const r = 16;
          Fx.burst(s.x, s.y, r, { col: [255, 190, 90] });
          Fx.add({ k: 'glow', x: s.x, y: s.y, vx: 0, vy: 0, life: 0.6, size: r * 0.8, grow: r * 0.8, c: [255, 190, 110], alpha: 0.8, front: 1 });
        }
      }
      s.trail.push(s.x, s.y);
      if (s.trail.length > 40) s.trail.splice(0, 2);
    }
    this.shots = this.shots.filter(s => !s.done);
  },
  draw(ctx, dt, kind) {
    if (!this.world || this.world.W !== Screen.W || this.world.H !== Screen.H) this.build();
    const tw = this.world;
    this.update(dt);
    Fx.update(dt);
    Gfx.updateShake(0);
    const q = quality().gl;
    const gw = Math.max(2, Math.round(Gfx.cw * q)), gh = Math.max(2, Math.round(Gfx.ch * q));
    const pf = { x: Gfx.pf.x * q, y: Gfx.pf.y * q, w: Gfx.pf.w * q, h: Gfx.pf.h * q };
    const lights = Fx.collectLights([]);
    for (const s of this.shots) lights.push({ x: s.x, y: s.y, r: 14, i: 0.6, c: [1, 0.75, 0.4] });
    if (Terra.render(tw, gw, gh, { pf, sky: 'SUNSET', sun: tw.sun, wind: 40, lights, time: Gfx.t })) ctx.drawImage(Terra.canvas, 0, 0, gw, gh, 0, 0, Gfx.cw, Gfx.ch);
    Fx.drawParts(ctx, 0);
    for (const t of this.tanks) Fx.drawTank(ctx, t);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.shots) {
      for (let i = 2; i < s.trail.length; i += 2) {
        const a = i / s.trail.length;
        ctx.strokeStyle = 'rgba(255,220,170,' + 0.5 * a + ')';
        ctx.lineWidth = Math.max(1, Gfx.sx * 0.7 * a);
        ctx.beginPath(); ctx.moveTo(Gfx.X(s.trail[i - 2]), Gfx.Y(s.trail[i - 1])); ctx.lineTo(Gfx.X(s.trail[i]), Gfx.Y(s.trail[i + 1])); ctx.stroke();
      }
      Fx.drawGlow(ctx, Gfx.X(s.x), Gfx.Y(s.y), Gfx.sx * 3.5, [255, 230, 180], 0.9);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    Fx.drawParts(ctx, 1);
    Fx.vignette(ctx, kind === 'title' ? 0.08 : kind === 'menu' ? 0.5 : 0.3);
  }
};
