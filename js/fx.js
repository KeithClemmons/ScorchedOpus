'use strict';
/* =====================================================================
   Remastered battlefield: vector tanks, projectiles, explosions,
   particles, shields, lights, traces, damage numbers and the kill feed.
   Everything here only looks at the simulation (Battle, World); the
   particles are cosmetic and use Math.random freely.
   ===================================================================== */

const QUALITY = { HIGH: { gl: 1, parts: 1800, spawn: 1 }, MEDIUM: { gl: 0.75, parts: 1000, spawn: 0.65 }, LOW: { gl: 0.5, parts: 450, spawn: 0.35 } };
function quality() { return QUALITY[Cfg.quality] || QUALITY.HIGH; }
function c3(c) { return [cR(c), cG(c), cB(c)]; }
function rgba(a, al) { return 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + al + ')'; }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mul3(a, f) { return [a[0] * f, a[1] * f, a[2] * f]; }
const WHITE3 = [255, 255, 255];
const FIRE3 = [[255, 250, 220], [255, 220, 120], [255, 160, 50], [240, 90, 30], [170, 40, 20], [60, 20, 14]];
function fireAt(t) {       // 0 = white hot .. 1 = dark red
  const f = clamp(t, 0, 1) * (FIRE3.length - 1), i = Math.min(FIRE3.length - 2, Math.floor(f));
  return mix3(FIRE3[i], FIRE3[i + 1], f - i);
}

// text over the battlefield, sized to the playfield rather than the UI grid
function worldFont(k) { return clamp(Gfx.pf.h * 0.021, 10 * Gfx.dpr, 24 * Gfx.dpr) * (k || 1); }

const Fx = {
  parts: [], seen: new WeakSet(), st: new WeakMap(), lights: [], floaters: [], feed: [],
  tankInfo: new Map(), tanksRef: null, glowCache: new Map(),
  trace: { pts: [], canvas: null, ctx: null, drawn: 0, w: 0, h: 0 },

  /* ------------------------------------------------ particles */
  add(p) {
    const q = quality();
    if (this.parts.length >= q.parts) this.parts.splice(0, this.parts.length - q.parts + 1);
    p.age = 0; p.max = p.life;
    this.parts.push(p);
    return p;
  },
  n(count) { return Math.max(1, Math.round(count * quality().spawn)); },
  update(dt) {
    const g = World.W ? Phys.g() : 100;
    const wind = App.scene === BattleScene && World.W ? Phys.windAcc(Battle.wind) : 0;
    const out = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const drag = p.drag || 0;
      p.vx += ((p.windy ? wind * p.windy : 0) - drag * p.vx) * dt;
      p.vy += ((p.grav || 0) * g - drag * p.vy) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += (p.spin || 0) * dt;
      if (p.bounce && World.W && p.vy > 0 && World.isLand(p.x, p.y)) {
        p.y -= p.vy * dt; p.vy *= -0.35; p.vx *= 0.6;
        if (Math.abs(p.vy) < 8) { p.vy = 0; p.grav = 0; p.vx = 0; p.life = Math.min(p.life, p.age + 0.5); }
      }
      out.push(p);
    }
    this.parts = out;
    this.floaters = this.floaters.filter(f => (f.t += dt) < f.dur);
    this.feed = this.feed.filter(f => (f.t += dt) < 7);
  },

  // soft round glow, cached per color
  glow(col) {
    const key = ((col[0] >> 3) << 10) | ((col[1] >> 3) << 5) | (col[2] >> 3);
    let c = this.glowCache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.25, rgba(col, 0.55)); gr.addColorStop(0.6, rgba(col, 0.14)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      if (this.glowCache.size > 300) this.glowCache.clear();
      this.glowCache.set(key, c);
    }
    return c;
  },
  // soft-edged puff for smoke and dust (normal blending)
  soft(col) {
    const key = 'S' + (((col[0] >> 3) << 10) | ((col[1] >> 3) << 5) | (col[2] >> 3));
    let c = this.glowCache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(col, 0.9)); gr.addColorStop(0.45, rgba(col, 0.6)); gr.addColorStop(0.8, rgba(col, 0.18)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      if (this.glowCache.size > 300) this.glowCache.clear();
      this.glowCache.set(key, c);
    }
    return c;
  },
  drawGlow(ctx, x, y, r, col, a) {
    if (r < 0.5 || a <= 0.003) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(this.glow(col), x - r, y - r, r * 2, r * 2);
  },
  drawParts(ctx, layer) {
    const sx = Gfx.sx;
    for (const p of this.parts) {
      if ((p.front ? 1 : 0) !== layer) continue;
      const t = p.age / p.life, X = Gfx.X(p.x), Y = Gfx.Y(p.y);
      switch (p.k) {
        case 'smoke': {
          const r = (p.size + p.grow * t) * sx * 1.35, a = (p.alpha || 0.35) * 1.3 * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
          if (a <= 0.004) break;
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(this.soft(p.c), X - r, Y - r, r * 2, r * 2);
          break;
        }
        case 'debris': {
          const s = p.size * sx;
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
          ctx.fillStyle = rgba(p.c, 1);
          ctx.save(); ctx.translate(X, Y); ctx.rotate(p.rot || 0); ctx.fillRect(-s / 2, -s / 2, s, s * 0.75); ctx.restore();
          break;
        }
        case 'spark': {
          ctx.globalCompositeOperation = 'lighter';
          const a = 1 - t, len = p.len || 0.05;
          ctx.globalAlpha = a;
          ctx.strokeStyle = rgba(mix3(p.c, WHITE3, 0.4 * a), 1);
          ctx.lineWidth = Math.max(1, p.size * sx);
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - p.vx * len * sx, Y - p.vy * len * Gfx.sy); ctx.stroke();
          break;
        }
        case 'ember': case 'glow': {
          ctx.globalCompositeOperation = 'lighter';
          const r = (p.size + (p.grow || 0) * t) * sx;
          const a = (p.alpha || 1) * (p.k === 'glow' ? (1 - t) * (1 - t) : 1 - t);
          this.drawGlow(ctx, X, Y, r, p.c, a);
          break;
        }
        case 'ring': {
          ctx.globalCompositeOperation = 'lighter';
          const r = (p.size + p.grow * Math.sqrt(t)) * sx;
          ctx.globalAlpha = (p.alpha || 0.8) * (1 - t);
          ctx.strokeStyle = rgba(p.c, 1);
          ctx.lineWidth = Math.max(1, (p.width || 1.2) * sx * (1 - t * 0.7));
          ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.stroke();
          break;
        }
        case 'dot': {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
          ctx.fillStyle = rgba(p.c, 1);
          ctx.beginPath(); ctx.arc(X, Y, Math.max(0.8, p.size * sx), 0, TAU); ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },

  /* ------------------------------------------------ effect spawners (cosmetic) */
  burst(x, y, r, o) {
    o = o || {};
    const col = o.col || [255, 190, 90];
    for (let i = 0, n = this.n(o.sparks !== undefined ? o.sparks : 10 + r * 1.4); i < n; i++) {
      const a = rand(0, TAU), v = rand(0.4, 1.6) * (40 + r * 5);
      this.add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * World.ay - rand(0, 40), life: rand(0.25, 0.7), size: rand(0.25, 0.5), c: mix3(col, WHITE3, rand(0, 0.5)), grav: 0.25, drag: 1.2, len: 0.035, front: 1 });
    }
    for (let i = 0, n = this.n(o.embers !== undefined ? o.embers : 4 + r * 0.5); i < n; i++) {
      const a = rand(0, TAU), v = rand(10, 30 + r * 2.2);
      this.add({ k: 'ember', x: x + rand(-r, r) * 0.3, y: y + rand(-r, r) * 0.3 * World.ay, vx: Math.cos(a) * v, vy: Math.sin(a) * v * World.ay - rand(10, 40), life: rand(0.6, 1.6), size: rand(0.6, 1.4), c: fireAt(rand(0.1, 0.5)), grav: 0.08, drag: 1.5, front: 1 });
    }
    if (o.smoke !== false) {
      for (let i = 0, n = this.n(3 + r * 0.35); i < n; i++) {
        const sc = rand(28, 52);
        this.add({ k: 'smoke', x: x + rand(-r, r) * 0.45, y: y + rand(-r, r) * 0.35 * World.ay, vx: rand(-6, 6), vy: -rand(8, 22) * World.ay, life: rand(1.6, 3.4), size: r * rand(0.25, 0.45), grow: r * rand(0.35, 0.8), c: o.smokeCol || [sc, sc * 0.95, sc * 0.9], alpha: o.smokeAlpha || 0.32, drag: 0.6, windy: 0.35 });
      }
    }
    if (o.ring !== false) this.add({ k: 'ring', x, y, vx: 0, vy: 0, life: 0.45 + r * 0.004, size: r * 0.4, grow: r * 1.35, c: o.ring || [255, 220, 170], alpha: 0.45, width: 0.9, front: 1 });
  },
  debris(x, y, r, col, n) {
    for (let i = 0, m = this.n(n); i < m; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), v = rand(20, 70 + r * 3);
      this.add({ k: 'debris', x: x + rand(-r, r) * 0.5, y: y + rand(-0.4, 0.3) * r * World.ay, vx: Math.cos(a) * v, vy: Math.sin(a) * v * World.ay, life: rand(0.8, 2.2), size: rand(0.5, 1.3), c: mix3(col, [0, 0, 0], rand(0, 0.35)), grav: 0.55, drag: 0.3, rot: rand(0, TAU), spin: rand(-12, 12), bounce: true, front: 1 });
    }
  },
  landColorAt(x, y) {
    const W = World.W, H = World.H;
    for (let d = 0; d < 6; d++) {
      for (const [dx, dy] of [[0, d], [d, 0], [-d, 0], [0, -d]]) {
        const xx = Math.floor(x + dx), yy = Math.floor(y + dy);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = World.land[yy * W + xx];
        if (i) return c3(World.pal[i]);
      }
    }
    return c3(World.pal[Math.floor(World.pal.length * 0.3)] || rgb(120, 90, 60));
  },
  shock(amount) { Gfx.kick(amount); },

  /* ------------------------------------------------ entity hooks */
  state(e) { let s = this.st.get(e); if (!s) { s = {}; this.st.set(e, s); } return s; },
  onSpawn(e) {
    const q = quality();
    if (e instanceof Explosion) {
      const r = e.r, type = e.type;
      const col = type === 'riot' ? [140, 200, 255] : type === 'dirt' ? [170, 120, 70] : type === 'funky' ? c3(e.o.color || rgb(255, 120, 255)) : [255, 190, 90];
      if (type === 'dirt') {
        this.burst(e.x, e.y, r * 0.6, { col, sparks: 0, embers: 0, smokeCol: [110, 80, 50], smokeAlpha: 0.3, ring: false });
        this.debris(e.x, e.y, r * 0.7, this.landColorAt(e.x, e.y + 2), 10 + r * 0.6);
      } else if (type === 'riot') {
        this.burst(e.x, e.y, r, { col, embers: 0, smoke: false, ring: [150, 210, 255] });
      } else {
        this.burst(e.x, e.y, r, { col, ring: type === 'nuke' ? [255, 240, 200] : [255, 220, 170] });
        if (type === 'nuke' && !e.o.small) {
          for (let i = 0, n = this.n(10 + r * 0.25); i < n; i++) {
            this.add({ k: 'smoke', x: e.x + rand(-r, r) * 0.25, y: e.y - rand(0, r) * World.ay, vx: rand(-4, 4), vy: -rand(18, 40) * World.ay, life: rand(3, 5.5), size: r * rand(0.18, 0.3), grow: r * rand(0.35, 0.7), c: [70, 55, 60], alpha: 0.3, drag: 0.35, windy: 0.3 });
          }
          this.add({ k: 'glow', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.9, size: r * 1.5, grow: r * 1.4, c: [255, 245, 220], alpha: 0.9, front: 1 });
        }
        if (type === 'tank') this.debris(e.x, e.y, r * 0.5, e.o.owner ? [90, 90, 96] : [90, 90, 96], 14);
      }
      this.shock(type === 'nuke' ? clamp(r / 55, 0.3, 1.1) : clamp(r / 90, 0.05, 0.5));
    } else if (e instanceof Shot) {
      const s = this.state(e);
      s.trail = [];
      if (e.main && e.owner && e.age < 0.05 && e.delay <= 0) {
        const m = e.owner.muzzle ? e.owner.muzzle(0) : { x: e.x, y: e.y };
        this.add({ k: 'glow', x: m.x, y: m.y, vx: 0, vy: 0, life: 0.18, size: 3, grow: 2, c: [255, 210, 140], alpha: 0.9, front: 1 });
        for (let i = 0, n = this.n(5); i < n; i++) {
          const a = Math.atan2(e.vy / World.ay, e.vx) + rand(-0.4, 0.4), v = rand(20, 60);
          this.add({ k: 'smoke', x: m.x, y: m.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * World.ay, life: rand(0.5, 1.1), size: 0.8, grow: 3, c: [150, 150, 150], alpha: 0.35, drag: 2.5, windy: 0.3 });
        }
      }
    } else if (e instanceof Spark) {
      const col = c3(e.c);
      for (let i = 0, n = this.n(10); i < n; i++) {
        const a = rand(0, TAU), v = rand(30, 90);
        this.add({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * World.ay, life: rand(0.2, 0.45), size: 0.35, c: mix3(col, WHITE3, 0.4), drag: 2, len: 0.04, front: 1 });
      }
    } else if (e instanceof Ring) {
      this.add({ k: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.8, size: 2, grow: World.W * 0.33, c: c3(e.c), alpha: 0.9, width: 1.5, front: 1 });
      this.shock(0.25);
    } else if (e instanceof Lightning) {
      this.shock(0.35);
    } else if (e instanceof LaserBeam) {
      this.shock(0.1);
    } else if (e instanceof PlasmaBlast) {
      this.shock(0.2);
    } else if (e instanceof Liquid && e.napalm) {
      this.burst(e.x, e.y, 6, { col: [255, 150, 60], smoke: false });
    }
    if (typeof NewFx !== 'undefined') NewFx.onSpawn(e);
  },
  // every frame for live entities: trails, smoke, fire
  tickEntity(e, dt) {
    if (e instanceof Shot) {
      const s = this.state(e);
      if (e.delay > 0 || !s.trail) return;
      // a portal moved it: start the trail again rather than streak across the sky
      if ((e.warps || 0) !== (s.warps || 0)) { s.warps = e.warps; s.trail = []; }
      s.trail.push(e.x, e.y);
      if (s.trail.length > 36) s.trail.splice(0, 2);
      const k = e.wp.kind;
      s.smokeT = (s.smokeT || 0) - dt;
      if (s.smokeT <= 0 && (k === 'missile' || k === 'nuke' || k === 'mirv' || k === 'napalm' || k === 'leapfrog' || e.wp.ext) && Cfg.bombIcon !== 'INVISIBLE') {
        s.smokeT = 0.03 / quality().spawn;
        this.add({ k: 'smoke', x: e.x - e.vx * 0.01, y: e.y - e.vy * 0.01, vx: rand(-3, 3), vy: rand(-3, 3), life: rand(0.5, 1.0), size: 0.7, grow: 2.2, c: [175, 175, 180], alpha: 0.18, drag: 1, windy: 0.4 });
      }
      if (e.wp.smoke) {
        s.smokeT2 = (s.smokeT2 || 0) - dt;
        if (s.smokeT2 <= 0) {
          s.smokeT2 = 0.015;
          this.add({ k: 'smoke', x: e.x, y: e.y, vx: 0, vy: 0, life: 3.5, size: 0.8, grow: 3.5, c: c3(hsl((Gfx.t * 240) % 360, 0.9, 0.6)), alpha: 0.35, drag: 1, windy: 0.25 });
        }
      }
    } else if (e instanceof Explosion) {
      const s = this.state(e);
      if (e.carved && !s.carved) {
        s.carved = true;
        // the crater rim glows for a moment
        if (e.type !== 'dirt' && e.type !== 'riot') {
          for (let i = 0, n = this.n(6 + e.r * 0.3); i < n; i++) {
            const a = rand(0.1, Math.PI - 0.1);
            this.add({ k: 'ember', x: e.x + Math.cos(a) * e.r * rand(0.85, 1.02), y: e.y + Math.sin(a) * e.r * World.ay * rand(0.85, 1.02), vx: 0, vy: -rand(0, 4), life: rand(1.2, 2.4), size: rand(0.7, 1.4), c: fireAt(rand(0.35, 0.6)), drag: 2, alpha: 0.8 });
          }
        }
        if (e.type !== 'dirt' && e.type !== 'riot') this.debris(e.x, e.y + e.r * 0.3 * World.ay, e.r * 0.6, this.landColorAt(e.x, e.y + e.r * 0.8 * World.ay), 6 + e.r * 0.4);
      }
    } else if (e instanceof Liquid && e.napalm && e.phase === 'burn') {
      const s = this.state(e);
      s.t = (s.t || 0) - dt;
      if (s.t <= 0) {
        s.t = 0.05 / quality().spawn;
        const live = e.parts.filter(p => !p.gone);
        for (let i = 0; i < 3 && live.length; i++) {
          const p = live[Math.floor(Math.random() * live.length)];
          const x = p.fly ? p.x : p.cx, y = p.fly ? p.y : p.cy;
          this.add({ k: 'smoke', x, y: y - 2 * World.ay, vx: rand(-3, 3), vy: -rand(10, 22) * World.ay, life: rand(1.2, 2.4), size: 1, grow: 5, c: [40, 34, 34], alpha: 0.3, drag: 0.5, windy: 0.5 });
          this.add({ k: 'ember', x, y: y - rand(1, 4) * World.ay, vx: rand(-6, 6), vy: -rand(12, 35) * World.ay, life: rand(0.4, 0.9), size: rand(0.5, 1), c: fireAt(rand(0.1, 0.4)), drag: 1, front: 1 });
        }
      }
    } else if (e instanceof Tunneler) {
      if (e.delay <= 0 && Math.random() < 0.5 * quality().spawn) this.add({ k: 'dot', x: e.x + rand(-1, 1), y: e.y + rand(-1, 1), vx: rand(-15, 15), vy: -rand(5, 25), life: rand(0.3, 0.7), size: rand(0.25, 0.5), c: this.landColorAt(e.x, e.y), grav: 0.3, front: 1 });
    } else if (e instanceof Meteor) {
      for (let i = 0; i < 2; i++) this.add({ k: 'ember', x: e.x, y: e.y, vx: rand(-8, 8) - e.vx * 0.1, vy: rand(-8, 8) - e.vy * 0.1, life: rand(0.4, 0.9), size: rand(0.8, 1.8), c: fireAt(rand(0.1, 0.5)), drag: 1, front: 1 });
      if (Math.random() < 0.5) this.add({ k: 'smoke', x: e.x, y: e.y, vx: rand(-3, 3), vy: rand(-3, 3), life: rand(0.8, 1.4), size: 1.2, grow: 3, c: [60, 45, 40], alpha: 0.35, drag: 0.6 });
    }
  },

  /* ------------------------------------------------ lights for the terrain shader */
  collectLights(ents) {
    const L = [];
    for (const e of ents) {
      if (e instanceof Explosion) {
        const et = e.vt !== undefined ? e.vt : e.t;
        const k = et < e.growT ? et / e.growT : et < e.growT + e.holdT ? 1 : 1 - (et - e.growT - e.holdT) / e.fadeT;
        const col = e.type === 'riot' ? [0.45, 0.7, 1] : e.type === 'dirt' ? [0.5, 0.4, 0.3] : e.type === 'funky' ? c3(e.o.color || rgb(255, 120, 255)).map(v => v / 255) : [1, 0.62, 0.3];
        L.push({ x: e.x, y: e.y, r: e.r * (e.type === 'nuke' ? 3.2 : 2.6), i: clamp(k, 0, 1) * (e.type === 'nuke' ? 2.2 : 1.5), c: col });
      } else if (e instanceof Liquid && e.napalm) {
        const live = e.parts.filter(p => !p.gone);
        const n = Math.min(4, live.length);
        const f = e.phase === 'burn' ? clamp(1 - e.burnT / e.burnDur, 0, 1) : 0.6;
        for (let i = 0; i < n; i++) {
          const p = live[Math.floor((i + 0.5) / n * live.length)];
          L.push({ x: p.fly ? p.x : p.cx, y: p.fly ? p.y : p.cy, r: 26, i: 0.9 * f * (0.8 + 0.2 * Math.sin(Gfx.t * 20 + i)), c: [1, 0.55, 0.2] });
        }
      } else if (e instanceof LaserBeam) {
        const f = clamp(1 - e.t / e.dur, 0, 1);
        for (let i = 0; i <= 3; i++) L.push({ x: lerp(e.x0, e.x1, i / 3), y: lerp(e.y0, e.y1, i / 3), r: 22, i: 1.2 * f, c: [1, 0.3, 0.45] });
      } else if (e instanceof PlasmaBlast) {
        L.push({ x: e.x, y: e.y, r: e.radius() * 2.2 + 8, i: 0.5 + 0.9 * e.bright(), c: [1, 0.2, 0.15] });
      } else if (e instanceof Lightning) {
        L.push({ x: e.tx, y: e.ty, r: 60, i: 1.6 * clamp(1 - e.t / 0.45, 0, 1), c: [0.7, 0.8, 1] });
      } else if (e instanceof Meteor) {
        L.push({ x: e.x, y: e.y, r: 45, i: 1.3, c: [1, 0.6, 0.3] });
      } else if (e instanceof Shot && e.delay <= 0 && Cfg.bombIcon !== 'INVISIBLE') {
        const k = e.wp.kind;
        if (k === 'nuke' || k === 'napalm' || k === 'funky' || k === 'mirv') L.push({ x: e.x, y: e.y, r: 16, i: 0.6, c: k === 'funky' ? [1, 0.5, 1] : [1, 0.75, 0.4] });
      } else if (typeof NewFx !== 'undefined') NewFx.light(e, L);
    }
    for (const p of this.parts) {
      if (p.k === 'glow' && p.age < p.life) L.push({ x: p.x, y: p.y, r: (p.size + p.grow) * 1.2, i: 1.2 * (1 - p.age / p.life), c: p.c.map(v => v / 255) });
    }
    L.sort((a, b) => b.i * b.r - a.i * a.r);
    return L.slice(0, 16);
  },

  /* ------------------------------------------------ traces (Trace Paths, Smoke Tracer) */
  addTrace(x, y, c) {
    this.trace.pts.push(x, y, c);
    if (this.trace.pts.length > 240000) this.trace.pts.splice(0, 30000);
  },
  clearTrace() { this.trace.pts = []; this.trace.drawn = 0; if (this.trace.ctx) this.trace.ctx.clearRect(0, 0, this.trace.w, this.trace.h); },
  drawTrace(ctx) {
    const T = this.trace;
    if (!T.pts.length) return;
    const w = Math.ceil(Gfx.pf.w), h = Math.ceil(Gfx.pf.h);
    if (!T.canvas) { T.canvas = document.createElement('canvas'); T.ctx = T.canvas.getContext('2d'); }
    if (T.w !== w || T.h !== h) { T.canvas.width = T.w = w; T.canvas.height = T.h = h; T.drawn = 0; }
    const g = T.ctx, r = Math.max(0.8, Gfx.sx * 0.45);
    for (let i = T.drawn; i < T.pts.length; i += 3) {
      g.fillStyle = Theme.css(T.pts[i + 2], 0.85);
      g.beginPath(); g.arc(T.pts[i] * Gfx.sx, T.pts[i + 1] * Gfx.sy, r, 0, TAU); g.fill();
    }
    T.drawn = T.pts.length;
    ctx.drawImage(T.canvas, Gfx.pf.x, Gfx.pf.y);
  },

  /* ------------------------------------------------ the battlefield */
  // o: {world, battle (or null), time, dim}
  drawWorld(ctx, dt, o) {
    const W = o.world, B = o.battle;
    const paused = !Net.online && UI.paused();
    const step = paused ? 0 : dt;
    if (B) {
      if (B.tanks !== this.tanksRef) this.newRound(B);
      for (const e of B.entities) {
        if (!this.seen.has(e)) { this.seen.add(e); this.onSpawn(e); }
        if (step) this.tickEntity(e, step);
      }
      this.watchTanks(B, step);
    }
    if (step) this.update(step);
    Gfx.updateShake(step);
    // sky + terrain
    const q = quality().gl;
    const gw = Math.max(2, Math.round(Gfx.cw * q)), gh = Math.max(2, Math.round(Gfx.ch * q));
    const pf = { x: (Gfx.pf.x + Gfx.shakeX) * q, y: (Gfx.pf.y + Gfx.shakeY) * q, w: Gfx.pf.w * q, h: Gfx.pf.h * q };
    const lights = B ? this.collectLights(B.entities) : this.collectLights([]);
    const fl = c3(Screen.flashColor || rgb(255, 255, 255)).map(v => v / 255);
    const ok = Terra.render(W, gw, gh, { pf, sky: W.skyType, sun: W.sun, wind: B ? B.wind : 30, lights, flash: Screen.flash || 0, flashColor: fl, time: Gfx.t });
    if (ok) ctx.drawImage(Terra.canvas, 0, 0, gw, gh, 0, 0, Gfx.cw, Gfx.ch);
    else { ctx.fillStyle = '#0a0d16'; ctx.fillRect(0, 0, Gfx.cw, Gfx.ch); }
    ctx.save();
    ctx.translate(Gfx.shakeX, Gfx.shakeY);
    this.drawTrace(ctx);
    if (B) this.drawWalls(ctx, B.walls);
    if (B) this.drawGates(ctx, B);
    this.drawParts(ctx, 0);
    if (W.skyType === 'STORMY') this.drawRain(ctx, step, B ? B.wind : 0);
    if (B) {
      for (const t of B.tanks) if (t.alive) this.drawTank(ctx, t);
      for (const e of B.entities) this.drawEntity(ctx, e);
      this.drawParts(ctx, 1);
      for (const t of B.tanks) if (t.alive && t.shield) this.drawShield(ctx, t);
      if (typeof Hud !== 'undefined') Hud.drawAimGuide(ctx);
      this.drawLabels(ctx, B);
      this.drawFloaters(ctx);
      this.drawBalloons(ctx, B);
    } else this.drawParts(ctx, 1);
    ctx.restore();
    if (B && World.skyType === 'STORMY' && B.cloudFlick > 0) {
      // lightning inside the clouds: the top of the sky flickers
      const g = ctx.createLinearGradient(0, Gfx.pf.y, 0, Gfx.pf.y + Gfx.pf.h * 0.3);
      g.addColorStop(0, 'rgba(190,200,255,0.32)'); g.addColorStop(1, 'rgba(190,200,255,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.fillRect(0, Gfx.pf.y, Gfx.cw, Gfx.pf.h * 0.3);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (Screen.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.6, Screen.flash * 0.45);
      ctx.fillStyle = rgba(c3(Screen.flashColor || rgb(255, 255, 255)), 1);
      ctx.fillRect(0, 0, Gfx.cw, Gfx.ch);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    this.vignette(ctx, o.dim || 0);
  },
  // rain for stormy skies: screen-space streaks slanted by the wind
  drawRain(ctx, dt, wind) {
    const n = Math.round(160 * quality().spawn);
    if (!this.rain || this.rain.length !== n) this.rain = Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 }));
    const W = Gfx.cw, H = Gfx.ch, slant = clamp(wind / 200, -1, 1) * 0.35;
    ctx.strokeStyle = 'rgba(190,205,230,0.28)'; ctx.lineWidth = Math.max(1, Gfx.dpr);
    ctx.beginPath();
    for (const d of this.rain) {
      d.y += dt * 1.1 * d.s; d.x += dt * slant * 1.1 * d.s;
      if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
      if (d.x < 0) d.x += 1; else if (d.x > 1) d.x -= 1;
      const x = d.x * W, y = d.y * H, len = 14 * Gfx.dpr * d.s;
      ctx.moveTo(x, y); ctx.lineTo(x - slant * len, y - len);
    }
    ctx.stroke();
  },
  vignette(ctx, dim) {
    const w = Gfx.cw, h = Gfx.ch;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (dim > 0) { ctx.fillStyle = 'rgba(4,6,12,' + dim + ')'; ctx.fillRect(0, 0, w, h); }
  },
  // Sky Gates: glowing frames with their effect on a tag; portals are rings, blue in and orange out
  drawGates(ctx, B) {
    const list = B.gates;
    if (!list || !list.length) return;
    const now = performance.now(), u = Math.min(Gfx.sx, Gfx.sy);
    ctx.save();
    ctx.globalAlpha = 1;
    for (const g of list) {
      const K = GATE_KINDS[g.k], col = K.col;
      const lit = g.flash ? clamp(1 - (now - g.flash) / 500, 0, 1) : 0;
      const X = Gfx.X(g.x), Y = Gfx.Y(g.y), H = g.h * Gfx.sy, W = Math.max(8 * u, 6 * Gfx.sx);
      const pulse = 0.75 + 0.25 * Math.sin(Gfx.t * 3 + g.x);
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(ctx, X, Y, H * 1.1, col, 0.18 + 0.4 * lit);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (g.k === 'pin' || g.k === 'pout') {
        // a ring with a swirl turning inside it
        ctx.lineWidth = Math.max(2, 2.2 * u);
        ctx.strokeStyle = rgba(mix3(col, WHITE3, 0.25 + 0.5 * lit), 0.95);
        ctx.beginPath(); ctx.ellipse(X, Y, W * 0.9, H, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = rgba(col, 0.16 + 0.2 * lit); ctx.fill();
        ctx.lineWidth = Math.max(1, 1.2 * u); ctx.strokeStyle = rgba(col, 0.7 * pulse);
        const spin = Gfx.t * (g.k === 'pin' ? 2.4 : -2.4);
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(X, Y, W * 0.55, H * 0.62, 0, spin + i * 2.1, spin + i * 2.1 + 1.2); ctx.stroke(); }
      } else {
        // a window frame
        VUI.rr.call({ ctx }, X - W / 2, Y - H, W, H * 2, Math.min(W / 2, 3 * u));
        ctx.fillStyle = rgba(col, 0.12 + 0.25 * lit); ctx.fill();
        ctx.lineWidth = Math.max(2.5, 2.4 * u);
        ctx.strokeStyle = rgba(mix3(col, WHITE3, 0.2 + 0.6 * lit), 0.9 * pulse + 0.1);
        ctx.stroke();
        // window bars
        ctx.lineWidth = Math.max(1, u);
        ctx.beginPath(); ctx.moveTo(X, Y - H + 2 * u); ctx.lineTo(X, Y + H - 2 * u); ctx.moveTo(X - W / 2 + 2 * u, Y); ctx.lineTo(X + W / 2 - 2 * u, Y);
        ctx.strokeStyle = rgba(col, 0.45);
        ctx.stroke();
      }
      // the tag
      const fs = Math.max(12, 10 * u);
      ctx.font = '700 ' + fs.toFixed(1) + 'px ' + FONT_UI;
      const tw = ctx.measureText(K.label).width, ph = fs * 1.35, pw = tw + fs * 0.9, py = Y - H - ph - 3 * u;
      VUI.rr.call({ ctx }, X - pw / 2, py, pw, ph, ph / 2);
      ctx.fillStyle = 'rgba(8,10,18,0.78)'; ctx.fill();
      ctx.lineWidth = Math.max(1, u * 0.8); ctx.strokeStyle = rgba(col, 0.9); ctx.stroke();
      ctx.fillStyle = rgba(mix3(col, WHITE3, 0.35), 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(K.label, X, py + ph / 2 + u * 0.3);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  },
  drawWalls(ctx, walls) {
    const col = { CONCRETE: [190, 190, 200], PADDED: [120, 170, 255], RUBBER: [90, 230, 120], SPRING: [255, 220, 80], WRAP: [200, 120, 255] }[walls];
    if (!col) return;
    const top = Gfx.Y(World.top), bot = Gfx.Y(World.H), w = Math.max(2, Gfx.sx * 0.9);
    for (const x of [Gfx.pf.x, Gfx.pf.x + Gfx.pf.w]) {
      const g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.3, rgba(col, 0.5)); g.addColorStop(1, rgba(col, 0.8));
      ctx.fillStyle = g;
      if (walls === 'WRAP') { for (let y = top; y < bot; y += 12 * Gfx.dpr) ctx.fillRect(x - w / 2, y, w, 6 * Gfx.dpr); }
      else ctx.fillRect(x - w / 2, top, w, bot - top);
    }
  },

  /* ------------------------------------------------ tanks */
  palette(t) {
    let base = c3(t.color);
    const hit = t.hitFlash > 0 && (Math.floor(t.hitFlash * 20) & 1);
    const flash = !hit && t.flash > 0 && (Math.floor(t.flash * 8) & 1);
    if (hit) base = mix3(base, WHITE3, 0.85);
    else if (t.fx) {
      const k = t.fx.k;
      base = k === 'bright' ? mix3(base, WHITE3, 0.45) : k === 'dark' ? mul3(base, 0.5) : k === 'green' ? [60, 255, 60] : [255, 40, 40];
    } else if (flash) base = mix3(base, WHITE3, 0.55);
    return {
      base, hi: mix3(base, WHITE3, 0.45), mid: mix3(base, [0, 0, 0], 0.2), lo: mix3(base, [0, 0, 0], 0.5), deep: mix3(base, [0, 0, 0], 0.7),
      steel: [44, 48, 56], steelHi: [120, 126, 138], tread: [26, 28, 33]
    };
  },
  drawTank(ctx, t, o) {
    o = o || {};
    const P = this.palette(t);
    const rowH = t.sv * Gfx.sy, colW = Gfx.sx;
    // soft contact shadow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(Gfx.X(t.x), Gfx.Y(t.y) + rowH * 0.1, t.w * colW * 0.55, rowH * 0.45, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    // barrels first: turrets sit on top of them
    const n = t.icon.piv.length;
    for (let i = 0; i < n; i++) {
      const spread = t.icon.triple ? (i - 1) * 12 : 0;
      const p = t.pivot(i), m = t.muzzle(i, t.angle + spread);
      const x0 = Gfx.X(p.x), y0 = Gfx.Y(p.y), x1 = Gfx.X(m.x), y1 = Gfx.Y(m.y);
      const bw = Math.max(2, colW * (t.icon.triple ? 1.0 : 1.25));
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(P.deep, 1); ctx.lineWidth = bw + Math.max(1.5, Gfx.dpr * 1.5);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = rgba(mix3(P.steelHi, P.base, 0.25), 1); ctx.lineWidth = bw;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, bw * 0.3);
      ctx.beginPath(); ctx.moveTo(x0, y0 - bw * 0.15); ctx.lineTo(x1, y1 - bw * 0.15); ctx.stroke();
    }
    // the art is drawn on the full-size design's grid; fit it to the battle tank's box
    const art = t.icon.rows, kx = t.w * colW / art[0].length, ky = t.hh * Gfx.sy / art.length;
    ctx.save();
    ctx.translate(Gfx.X(t.left), Gfx.Y(t.top));
    ctx.scale(kx, ky);
    ctx.lineJoin = 'round';
    (TANK_ART[t.iconIdx] || TANK_ART[0])(ctx, P, 1 / Math.min(kx, ky));
    ctx.restore();
  },
  drawShield(ctx, t) {
    const sh = t.shield, it = sh.it;
    const X = Gfx.X(t.cx), Y = Gfx.Y(t.cy), R = t.shieldRx() * Gfx.sx;
    const frac = clamp(sh.energy / it.strength, 0, 1);
    const col = c3(it.color);
    const s = this.state(t);
    if (s.shE !== undefined && sh.energy < s.shE - 0.1) s.shHit = 0.35;
    s.shE = sh.energy;
    s.shHit = Math.max(0, (s.shHit || 0) - 1 / 60);
    if (it.mag) { this.drawMagField(ctx, t, X, Gfx.Y(t.top), R, col, frac, s.shHit, it.mag); return; }
    const pulse = 0.85 + 0.15 * Math.sin(Gfx.t * 3 + t.x);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(X, Y, R * 0.55, X, Y, R);
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.82, rgba(col, (0.08 + 0.12 * frac) * pulse));
    g.addColorStop(1, rgba(col, (0.28 + 0.4 * frac) * pulse + s.shHit));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(1, Gfx.dpr * (it.id === 'heavyShield' ? 2.2 : 1.2));
    if (it.mag) {
      const n = it.mag === 2 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        ctx.setLineDash([R * 0.35, R * 0.22]);
        ctx.lineDashOffset = (Gfx.t * (k ? -40 : 30) * Gfx.dpr) % 1000;
        ctx.strokeStyle = rgba(mix3(col, WHITE3, 0.3), 0.55 + 0.35 * frac);
        ctx.beginPath(); ctx.arc(X, Y, R * (1 + k * 0.12), 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = rgba(mix3(col, WHITE3, 0.35), 0.35 + 0.45 * frac + s.shHit);
      ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.stroke();
      if (it.deflect) {
        ctx.strokeStyle = rgba(col, 0.25 * frac);
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * TAU + Gfx.t * 0.6;
          ctx.beginPath(); ctx.arc(X, Y, R * 0.93, a, a + 0.5); ctx.stroke();
        }
      }
    }
    // glint
    ctx.fillStyle = 'rgba(255,255,255,' + (0.12 + 0.12 * frac) + ')';
    ctx.beginPath(); ctx.ellipse(X - R * 0.35, Y - R * 0.45, R * 0.28, R * 0.12, -0.6, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },
  // mag deflector / super mag: field lines arching over the tank (as 1.5 draws them), flowing outward
  drawMagField(ctx, t, X, top, R, col, frac, hit, n) {
    const lines = n === 2 ? 3 : 2, yc = top + R * 0.25;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let k = 0; k < lines; k++) {
      const rx = R * (0.62 + k * 0.3), ry = rx * 0.62;
      const a = (0.5 + 0.4 * frac) * (1 - k * 0.18) + hit;
      // soft glow, then the line itself with dashes that drift away from the tank
      ctx.strokeStyle = rgba(col, a * 0.28); ctx.lineWidth = Math.max(2, 4.2 * Gfx.dpr);
      ctx.beginPath(); ctx.ellipse(X, yc, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
      ctx.strokeStyle = rgba(mix3(col, WHITE3, 0.35), a); ctx.lineWidth = Math.max(1, 1.5 * Gfx.dpr);
      ctx.setLineDash([rx * 0.32, rx * 0.12]);
      ctx.lineDashOffset = -(Gfx.t * (18 + k * 6) * Gfx.dpr) % 1000;
      ctx.beginPath(); ctx.ellipse(X, yc, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.5); ctx.stroke();
      ctx.lineDashOffset = (Gfx.t * (18 + k * 6) * Gfx.dpr) % 1000;
      ctx.beginPath(); ctx.ellipse(X, yc, rx, ry, 0, Math.PI * 1.94, Math.PI * 1.5, true); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },
  // health bars and names over the tanks
  drawLabels(ctx, B) {
    const mode = Cfg.tankLabels;
    const aim = typeof Hud !== 'undefined' ? B.hudTank() : null;
    for (const t of B.tanks) {
      if (!t.alive) continue;
      if (t.ready && (B.mode === 'SYNCHRONOUS')) this.drawReady(ctx, t);
      if (t.falling && t.chute) this.drawChute(ctx, t);
      if (mode === 'OFF') continue;
      const X = Gfx.X(t.x), Y = Gfx.Y(t.top) - Math.max(10, 7 * Gfx.sy);
      const bw = Math.max(28 * Gfx.dpr, t.w * Gfx.sx * 1.05), bh = Math.max(3, 2.6 * Gfx.dpr);
      const e = clamp(t.energy / 100, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(X - bw / 2 - 1, Y - 1, bw + 2, bh + 2);
      ctx.fillStyle = e > 0.6 ? '#6fe38a' : e > 0.3 ? '#ffd257' : '#ff5a5a';
      ctx.fillRect(X - bw / 2, Y, bw * e, bh);
      if (t.shield) {
        const f = clamp(t.shield.energy / t.shield.it.strength, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(X - bw / 2 - 1, Y + bh + 1, bw + 2, bh * 0.7 + 2);
        ctx.fillStyle = rgba(mix3(c3(t.shield.it.color), WHITE3, 0.2), 1);
        ctx.fillRect(X - bw / 2, Y + bh + 2, bw * f, bh * 0.7);
      }
      if (mode === 'NAMES' || t === aim) {
        ctx.font = '600 ' + Math.round(worldFont(0.9)) + 'px ' + FONT_UI;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(t.p.name, X + Gfx.dpr, Y - 2 * Gfx.dpr + Gfx.dpr);
        ctx.fillStyle = rgba(mix3(c3(t.color), WHITE3, 0.35), 1);
        ctx.fillText(t.p.name, X, Y - 2 * Gfx.dpr);
        ctx.textAlign = 'left';
      }
    }
  },
  drawReady(ctx, t) {
    const X = Gfx.X(t.x), Y = Gfx.Y(t.top) - 18 * Gfx.dpr - Math.sin(Gfx.t * 5) * 2 * Gfx.dpr, s = 5 * Gfx.dpr;
    ctx.fillStyle = rgba(c3(t.color), 1);
    ctx.beginPath(); ctx.moveTo(X - s, Y - s); ctx.lineTo(X + s, Y - s); ctx.lineTo(X, Y + s * 0.6); ctx.closePath(); ctx.fill();
  },
  drawChute(ctx, t) {
    const X = Gfx.X(t.x), top = Gfx.Y(t.top), cy = top - 12 * World.ay * Gfx.sy, rx = 9 * Gfx.sx, ry = 6 * World.ay * Gfx.sy;
    const col = c3(t.color);
    ctx.strokeStyle = 'rgba(230,230,230,0.8)'; ctx.lineWidth = Math.max(1, Gfx.dpr);
    ctx.beginPath();
    for (const f of [-1, -0.33, 0.33, 1]) { ctx.moveTo(X + f * rx, cy); ctx.lineTo(X + f * t.w * Gfx.sx * 0.4, top); }
    ctx.stroke();
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = k & 1 ? '#f2f2f2' : rgba(col, 1);
      ctx.beginPath(); ctx.moveTo(X, cy);
      ctx.ellipse(X, cy, rx, ry, 0, Math.PI + k / 6 * Math.PI, Math.PI + (k + 1) / 6 * Math.PI);
      ctx.closePath(); ctx.fill();
    }
  },
  drawBalloons(ctx, B) {
    for (const b of B.balloons) {
      const t = b.tank;
      const fs = worldFont(0.95);
      ctx.font = '600 ' + fs.toFixed(1) + 'px ' + FONT_UI;
      const lines = Font.wrap(b.text, 24);
      const lw = Math.max(...lines.map(l => ctx.measureText(l).width));
      const pad = fs * 0.55, lh = fs * 1.2;
      const w = lw + pad * 2, h = lines.length * lh + pad * 1.2;
      let x = Gfx.X(t.x) - w / 2, y = Gfx.Y(t.top) - h - 16 * Gfx.dpr;
      x = clamp(x, Gfx.pf.x + 4, Gfx.pf.x + Gfx.pf.w - w - 4);
      const below = y < Gfx.Y(Battle.statusH * Screen.UY + 4);
      if (below) y = Gfx.Y(t.y) + 10 * Gfx.dpr;
      const a = clamp(b.t * 4, 0, 1);
      ctx.globalAlpha = a;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 10 * Gfx.dpr; ctx.shadowOffsetY = 3 * Gfx.dpr;
      VUI.rr(x, y, w, h, fs * 0.5);
      ctx.fillStyle = 'rgba(248,250,255,0.96)'; ctx.fill();
      ctx.restore();
      const tx = clamp(Gfx.X(t.x), x + 10, x + w - 10);
      ctx.fillStyle = 'rgba(248,250,255,0.96)';
      ctx.beginPath();
      if (!below) { ctx.moveTo(tx - 6 * Gfx.dpr, y + h - 1); ctx.lineTo(tx + 6 * Gfx.dpr, y + h - 1); ctx.lineTo(tx, y + h + 8 * Gfx.dpr); }
      else { ctx.moveTo(tx - 6 * Gfx.dpr, y + 1); ctx.lineTo(tx + 6 * Gfx.dpr, y + 1); ctx.lineTo(tx, y - 8 * Gfx.dpr); }
      ctx.fill();
      ctx.fillStyle = '#141824'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad * 0.7 + i * lh));
      ctx.fillStyle = rgba(c3(t.color), 1);
      ctx.fillRect(x + fs * 0.5, y, w - fs, Math.max(2, 2 * Gfx.dpr));
      ctx.globalAlpha = 1;
    }
  },

  /* ------------------------------------------------ damage numbers + kill feed */
  newRound(B) {
    this.tanksRef = B.tanks;
    this.tankInfo = new Map();
    this.parts = []; this.floaters = []; this.feed = [];
    for (const t of B.tanks) this.tankInfo.set(t, { e: t.energy, s: t.shield ? t.shield.energy : 0, alive: t.alive, dying: t.dying, acc: 0, accS: 0, accT: 0 });
  },
  watchTanks(B, dt) {
    for (const t of B.tanks) {
      // a badly damaged tank smokes (and sparks when nearly done)
      if (dt && t.alive && !t.dying && t.energy < 40 && Math.random() < dt * (40 - t.energy) * 0.25 * quality().spawn) {
        const dark = 30 + Math.random() * 30;
        this.add({ k: 'smoke', x: t.x + rand(-3, 3), y: t.top, vx: rand(-3, 3), vy: -rand(10, 22) * World.ay, life: rand(1.2, 2.2), size: 0.8, grow: 4, c: [dark, dark, dark + 4], alpha: 0.35, drag: 0.5, windy: 0.6 });
        if (t.energy < 15 && Math.random() < 0.3) this.add({ k: 'spark', x: t.x + rand(-4, 4), y: t.top + 2, vx: rand(-30, 30), vy: -rand(20, 60), life: 0.35, size: 0.3, c: [255, 200, 120], grav: 0.4, len: 0.03, front: 1 });
      }
      let info = this.tankInfo.get(t);
      if (!info) { info = { e: t.energy, s: t.shield ? t.shield.energy : 0, alive: t.alive, dying: t.dying, acc: 0, accS: 0, accT: 0 }; this.tankInfo.set(t, info); }
      const s = t.shield ? t.shield.energy : 0;
      const de = info.e - t.energy, ds = (t.shield && info.s > 0) ? info.s - s : 0;
      if (de > 0.05) { info.acc += de; info.accT = 0.25; }
      if (ds > 0.05) { info.accS += ds; info.accT = 0.25; }
      if (de < -0.5) this.floater(t, '+' + Math.round(-de), [111, 227, 138]);
      info.e = t.energy; info.s = s;
      if (info.accT > 0) {
        info.accT -= dt;
        if (info.accT <= 0) {
          if (info.acc >= 0.5) this.floater(t, '-' + Math.round(info.acc), info.acc >= 50 ? [255, 90, 70] : [255, 190, 90], info.acc >= 50);
          if (info.accS >= 0.5) this.floater(t, '-' + Math.round(info.accS), [120, 200, 255], false, true);
          info.acc = info.accS = 0;
        }
      }
      if ((t.dying || !t.alive) && !info.dying) {
        info.dying = true;
        this.killed(t);
      }
    }
  },
  floater(t, text, col, big, shield) {
    if (!Cfg.damageNumbers) return;
    this.floaters.push({ x: t.x + (shield ? t.w * 0.6 : rand(-2, 2)), y: t.top, text, col, big: !!big, t: 0, dur: 1.4 });
  },
  drawFloaters(ctx) {
    for (const f of this.floaters) {
      const k = f.t / f.dur;
      const X = Gfx.X(f.x), Y = Gfx.Y(f.y) - (14 + 36 * Math.sqrt(k)) * Gfx.dpr;
      const fs = worldFont(f.big ? 1.6 : 1.2) * (k < 0.12 ? 0.7 + k / 0.12 * 0.3 : 1);
      ctx.font = '700 ' + fs.toFixed(1) + 'px ' + FONT_DISPLAY;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.lineWidth = Math.max(2, fs * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(f.text, X, Y);
      ctx.fillStyle = rgba(f.col, 1);
      ctx.fillText(f.text, X, Y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  },
  killed(t) {
    const k = t.killer;
    let text;
    if (t.retreated) text = t.p.name + ' retreated';
    else if (Battle.massKilled) text = t.p.name + ' was mass killed';
    else if (!k || !k.p) text = t.p.name + ' was destroyed';
    else if (k === t) text = t.p.name + ' self-destructed';
    else {
      const w = k.lastShot && Data.byId[k.lastShot.weapon];
      text = k.p.name + '  ▸  ' + t.p.name + (w ? '   ' + w.name : '');
    }
    this.feed.push({ text, col: k && k.p && k !== t ? c3(k.color) : c3(t.color), t: 0 });
    if (this.feed.length > 5) this.feed.shift();
  },
  // top-right list, in device pixels (called by the HUD)
  drawFeed(ctx, x, y) {
    if (!Cfg.killFeed) return;
    const fs = worldFont(0.85);
    ctx.font = '600 ' + fs.toFixed(1) + 'px ' + FONT_UI;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    this.feed.forEach((f, i) => {
      const a = f.t < 0.2 ? f.t / 0.2 : f.t > 6 ? 7 - f.t : 1;
      const tw = ctx.measureText(f.text).width, h = fs * 1.55, yy = y + i * (h + 3 * Gfx.dpr);
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = 'rgba(8,11,20,0.78)';
      VUI.rr(x - tw - fs * 1.4, yy, tw + fs * 1.4, h, h * 0.3); ctx.fill();
      ctx.fillStyle = rgba(f.col, 1); ctx.fillRect(x - tw - fs * 1.4, yy + h * 0.2, Math.max(2, 2 * Gfx.dpr), h * 0.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#e6eaf2';
      ctx.fillText(f.text, x - fs * 0.6, yy + h / 2);
    });
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  },

  /* ------------------------------------------------ weapons in flight */
  drawEntity(ctx, e) {
    const tr = e.trail && e instanceof Bomblet ? e.trail : e.o && e.o.trail;
    if (tr && tr.length > 3) {
      ctx.strokeStyle = 'rgba(170,180,255,0.45)'; ctx.lineWidth = Math.max(1, Gfx.dpr);
      ctx.beginPath(); ctx.moveTo(Gfx.X(tr[0] + 0.5), Gfx.Y(tr[1] + 0.5));
      for (let i = 2; i < tr.length; i += 2) ctx.lineTo(Gfx.X(tr[i] + 0.5), Gfx.Y(tr[i + 1] + 0.5));
      ctx.stroke();
    }
    if (e instanceof Shot) return this.drawShot(ctx, e);
    if (e instanceof Explosion) return this.drawExplosion(ctx, e);
    if (e instanceof Bomblet) return this.drawOrb(ctx, e.x, e.y, 1.4, c3(e.color), e.delay > 0);
    if (e instanceof Roller) return this.drawRoller(ctx, e);
    if (e instanceof Tunneler) { if (e.delay <= 0) this.drawOrb(ctx, e.x, e.y, 1.1, e.wp.kind === 'sandhog' ? [255, 90, 50] : [255, 240, 170]); return; }
    if (e instanceof Liquid) return this.drawLiquid(ctx, e);
    if (e instanceof DirtSpray) return this.drawDirtSpray(ctx, e);
    if (e instanceof RiotWedge) return this.drawRiot(ctx, e);
    if (e instanceof LaserBeam) return this.drawLaser(ctx, e);
    if (e instanceof PlasmaBlast) return this.drawPlasma(ctx, e);
    if (e instanceof Lightning) return this.drawLightning(ctx, e);
    if (e instanceof Meteor) return this.drawMeteor(ctx, e);
    if (e instanceof Chopper) return this.drawChopper(ctx, e);
    if (typeof NewFx !== 'undefined') NewFx.draw(ctx, e);
  },
  drawOrb(ctx, x, y, r, col, hidden) {
    if (hidden) return;
    const X = Gfx.X(x), Y = Gfx.Y(y), R = r * Gfx.sx;
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(ctx, X, Y, R * 3.2, col, 0.7);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(mix3(col, WHITE3, 0.55), 1);
    ctx.beginPath(); ctx.arc(X, Y, R * 0.6, 0, TAU); ctx.fill();
  },
  shotLook(e) {
    const k = e.wp.kind, id = e.wp.id;
    if (e.color) return { col: c3(e.color), size: 1.1, glow: 1 };
    if (e.wp.airBomb) return { col: [255, 200, 150], size: 1.1, missile: true, dark: true };
    switch (k) {
      case 'missile': return { col: [255, 235, 200], size: id === 'babyMissile' ? 0.9 : 1.2, missile: true };
      case 'nuke': return { col: [255, 230, 90], size: id === 'nuke' ? 1.8 : 1.4, glow: 1.6, pulse: true };
      case 'mirv': return { col: id === 'deathsHead' ? [255, 80, 80] : [255, 160, 110], size: e.sub ? 0.9 : 1.4, missile: !e.sub };
      case 'leapfrog': return { col: [120, 255, 140], size: 1.2, glow: 1 };
      case 'funky': return { col: c3(hsl((Gfx.t * 360) % 360, 1, 0.6)), size: 1.4, glow: 1.2 };
      case 'napalm': return { col: [255, 140, 40], size: 1.3, glow: 1.3 };
      case 'tracer': return { col: e.wp.smoke ? [255, 255, 255] : [210, 225, 255], size: 0.55, glow: 0.6, thin: true };
      case 'roller': return { col: [170, 170, 180], size: 1.3, glow: 0.3 };
      case 'riotbomb': return { col: [120, 190, 255], size: 1.3, glow: 1.2 };
      case 'digger': case 'sandhog': return { col: [255, 210, 120], size: 1.1, glow: 0.8 };
      case 'dirt': case 'liquiddirt': case 'dirtcharge': return { col: [170, 120, 70], size: 1.3, glow: 0.2 };
      case 'disrupter': return { col: [110, 220, 255], size: 1.2, glow: 1.2, pulse: true };
      case 'airstrike': return { col: [255, 70, 50], size: 1.0, glow: 1.3, pulse: true };
      case 'teleport': return { col: [120, 240, 255], size: 1.1, glow: 1.5, pulse: true };
      case 'tesla': return { col: [150, 190, 255], size: 1.2, glow: 1.6, pulse: true };
      case 'buster': return { col: [255, 210, 160], size: 1.35, missile: true, dark: true };
      case 'emp': return { col: [90, 160, 255], size: 1.2, glow: 1.6, pulse: true };
      default: return { col: [255, 235, 200], size: 1.1, glow: 1 };
    }
  },
  drawShot(ctx, e) {
    if (e.delay > 0) return;
    const bi = Cfg.bombIcon;
    if (bi === 'INVISIBLE') return;
    const L = this.shotLook(e), s = this.state(e);
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y);
    // glowing trail
    const tr = s.trail || [];
    if (tr.length >= 4) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const n = tr.length / 2;
      for (let i = 1; i < n; i++) {
        const a = i / n;
        const x0 = tr[(i - 1) * 2], y0 = tr[(i - 1) * 2 + 1], x1 = tr[i * 2], y1 = tr[i * 2 + 1];
        if (Math.abs(x1 - x0) > World.W * 0.5) continue;   // wrapped around
        ctx.strokeStyle = rgba(L.col, 0.55 * a * a);
        ctx.lineWidth = Math.max(1, Gfx.sx * (L.thin ? 0.35 : 0.8) * a);
        ctx.beginPath(); ctx.moveTo(Gfx.X(x0), Gfx.Y(y0)); ctx.lineTo(Gfx.X(x1), Gfx.Y(y1)); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const sz = (bi === 'SMALL' ? 0.6 : 1) * L.size * Gfx.sx;
    if (L.missile) {
      ctx.save(); ctx.translate(X, Y); ctx.rotate(Math.atan2(e.vy * Gfx.sy, e.vx * Gfx.sx));
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(ctx, -sz * 2.4, 0, sz * 2.6, [255, 170, 80], 0.8 + 0.2 * Math.random());
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = L.dark ? '#5a606b' : '#dfe3ea';
      ctx.beginPath(); ctx.moveTo(sz * 2.2, 0); ctx.lineTo(sz * 0.8, -sz * 0.7); ctx.lineTo(-sz * 1.8, -sz * 0.7); ctx.lineTo(-sz * 1.8, sz * 0.7); ctx.lineTo(sz * 0.8, sz * 0.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8483a';
      ctx.beginPath(); ctx.moveTo(sz * 2.2, 0); ctx.lineTo(sz * 1.1, -sz * 0.7); ctx.lineTo(sz * 1.1, sz * 0.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a9099';
      ctx.fillRect(-sz * 1.8, -sz * 1.05, sz * 0.7, sz * 2.1);
      ctx.restore();
    } else {
      ctx.globalCompositeOperation = 'lighter';
      const pulse = L.pulse ? 0.8 + 0.2 * Math.sin(Gfx.t * 18) : 1;
      this.drawGlow(ctx, X, Y, sz * 3.4 * (L.glow || 1) * pulse, L.col, 0.75);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(mix3(L.col, WHITE3, 0.6), 1);
      ctx.beginPath(); ctx.arc(X, Y, Math.max(1, sz * 0.75), 0, TAU); ctx.fill();
    }
    if (e.mode || (e.guid && e.age > 0.05)) {
      ctx.strokeStyle = 'rgba(120,255,200,' + (0.4 + 0.3 * Math.sin(Gfx.t * 20)) + ')';
      ctx.lineWidth = Math.max(1, Gfx.dpr);
      ctx.beginPath(); ctx.arc(X, Y, sz * 2.6, 0, TAU); ctx.stroke();
    }
  },
  drawExplosion(ctx, e) {
    const t = e.vt !== undefined ? e.vt : e.t;
    let k;
    if (t < e.growT) k = t / e.growT;
    else if (t < e.growT + e.holdT) k = 1;
    else k = 1 - (t - e.growT - e.holdT) / e.fadeT;
    k = clamp(k, 0, 1);
    const fade = t > e.growT + e.holdT ? k : 1;
    const R = e.r * (e.type === 'nuke' && t < e.growT ? Math.sqrt(k) : (t < e.growT ? k : 1)) * Gfx.sx;
    if (R < 0.5) return;
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y);
    ctx.globalCompositeOperation = 'lighter';
    if (e.type === 'dirt') { ctx.globalCompositeOperation = 'source-over'; return; }   // the earth itself is the picture
    let inner, outer, deep;
    if (e.type === 'riot') { inner = [220, 240, 255]; outer = [60, 130, 255]; deep = [30, 50, 140]; }
    else if (e.type === 'funky') { const c = c3(e.o.color || rgb(255, 100, 255)); inner = mix3(c, WHITE3, 0.6); outer = c; deep = mul3(c, 0.45); }
    else if (e.type === 'nuke') { inner = [255, 250, 225]; outer = [255, 130, 40]; deep = [150, 40, 30]; }
    else if (e.type === 'hog') { inner = [255, 140, 120]; outer = [235, 30, 30]; deep = [110, 0, 10]; }
    else { inner = [255, 236, 170]; outer = [255, 120, 36]; deep = [140, 36, 20]; }
    const s = this.state(e);
    if (!s.puffs) {
      s.puffs = [];
      const n = e.type === 'nuke' ? 9 : 6;
      for (let i = 0; i < n; i++) s.puffs.push({ a: rand(0, TAU), d: rand(0.12, 0.48), r: rand(0.42, 0.7), ph: rand(0, TAU) });
    }
    // billowing body: overlapping puffs, cooler at the rim
    ctx.globalCompositeOperation = 'source-over';
    for (const p of s.puffs) {
      const pr = p.r * R * (0.92 + 0.08 * Math.sin(t * 18 + p.ph)) * (0.8 + 0.2 * k);
      const px = X + Math.cos(p.a) * p.d * R, py = Y + Math.sin(p.a) * p.d * R * 0.9;
      const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, rgba(mix3(inner, outer, 0.35), 0.9 * fade));
      g.addColorStop(0.55, rgba(outer, 0.75 * fade));
      g.addColorStop(0.85, rgba(deep, 0.45 * fade));
      g.addColorStop(1, rgba(deep, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
    }
    // white-hot core, brightest early on
    ctx.globalCompositeOperation = 'lighter';
    const hot = t < e.growT ? 1 : clamp(1 - (t - e.growT) / (e.holdT + e.fadeT * 0.5), 0, 1);
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, R * 0.55);
    g.addColorStop(0, rgba(inner, 0.85 * hot));
    g.addColorStop(1, rgba(outer, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(X, Y, R * 0.55, 0, TAU); ctx.fill();
    if (e.type === 'nuke' && !Cfg.smallMemory) {
      // rolling rings, a nod to the palette-cycled original
      ctx.lineWidth = Math.max(1, R * 0.06);
      for (let i = 0; i < 3; i++) {
        const rr = R * ((Gfx.t * 0.9 + i / 3) % 1);
        ctx.strokeStyle = rgba(fireAt(rr / R), 0.35 * fade);
        ctx.beginPath(); ctx.arc(X, Y, rr, 0, TAU); ctx.stroke();
      }
    }
    this.drawGlow(ctx, X, Y, R * 2.1, outer, 0.22 * fade);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },
  drawRoller(ctx, e) {
    const r = e.wp.id === 'heavyRoller' ? 2.6 : e.wp.id === 'roller' ? 2 : 1.5;
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y - (r + 0.5) * World.ay), R = r * Gfx.sx;
    const g = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.1, X, Y, R);
    g.addColorStop(0, '#d9dde4'); g.addColorStop(0.5, '#6b717c'); g.addColorStop(1, '#2a2e35');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
    const a = (e.x * 40 / r) * DEG * e.dir;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, R * 0.18);
    ctx.beginPath(); ctx.arc(X, Y, R * 0.62, -a, -a + 1.2); ctx.stroke();
  },
  drawLiquid(ctx, e) {
    const burning = e.phase === 'burn';
    const life = burning ? clamp(1 - e.burnT / e.burnDur, 0, 1) : 1;
    if (!e.napalm) ctx.fillStyle = 'rgb(122,84,44)';
    ctx.globalCompositeOperation = e.napalm ? 'lighter' : 'source-over';
    const r = Math.max(1.2, Gfx.sx * 0.9);
    let i = 0;
    for (const p of e.parts) {
      if (p.gone) continue;
      const x = p.fly ? p.x : p.cx, y = p.fly ? p.y : p.cy;
      const X = Gfx.X(x + 0.5), Y = Gfx.Y(y + 0.5);
      if (!e.napalm) { ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill(); continue; }
      i++;
      if (!burning) { this.drawGlow(ctx, X, Y, r * 3, e.o.hot ? [255, 220, 120] : [255, 130, 30], 0.65); continue; }
      // flames lick upward
      const f = 0.5 + 0.5 * Math.sin(Gfx.t * 14 + i * 1.7);
      const h = (2.5 + f * (e.o.hot ? 5 : 3.5)) * (0.35 + 0.65 * life) * World.ay * Gfx.sy;
      this.drawGlow(ctx, X, Y - h * 0.45, h * 0.75, fireAt(0.25 + f * 0.25), 0.55 * life + 0.15);
      this.drawGlow(ctx, X, Y, r * 2.2, [255, 200, 90], 0.5 * life);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },
  drawDirtSpray(ctx, e) {
    // the cone of loose dirt, each cell a fleck in the land's own colours
    const w = Math.max(1, Gfx.sx), h = Math.max(1, Gfx.sy), pal = World.pal;
    let last = -1;
    e.each((x, y) => {
      const c = pal[World.dirtIndex(x, y)];
      if (c !== last) { ctx.fillStyle = 'rgb(' + cR(c) + ',' + cG(c) + ',' + cB(c) + ')'; last = c; }
      ctx.fillRect(Gfx.X(x), Gfx.Y(y), w, h);
    });
  },
  drawRiot(ctx, e) {
    // a dark red field that spreads out, then a hole sweeps through it from the middle
    const ro = e.outer() * Gfx.sx, ri = e.inner() * Gfx.sx;
    if (ro < 1) return;
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y);
    const a0 = e.full ? 0 : -e.a1 * DEG, a1 = e.full ? TAU : -e.a0 * DEG;
    const shape = () => {
      ctx.beginPath();
      if (e.full) { ctx.arc(X, Y, ro, 0, TAU); if (ri > 0) ctx.arc(X, Y, ri, TAU, 0, true); }
      else { ctx.arc(X, Y, ro, a0, a1); ctx.arc(X, Y, ri, a1, a0, true); ctx.closePath(); }
    };
    const g = ctx.createRadialGradient(X, Y, Math.max(0, ri), X, Y, ro);
    g.addColorStop(0, 'rgba(255,90,80,0.55)'); g.addColorStop(0.3, 'rgba(170,40,45,0.6)'); g.addColorStop(1, 'rgba(120,25,32,0.7)');
    ctx.fillStyle = g; shape(); ctx.fill();
    // combed arcs
    ctx.save(); shape(); ctx.clip();
    ctx.strokeStyle = 'rgba(40,6,10,0.45)'; ctx.lineWidth = Math.max(1, Gfx.dpr);
    const step = Math.max(3, 2.4 * Gfx.sx);
    for (let r = ri + step; r < ro; r += step) { ctx.beginPath(); ctx.arc(X, Y, r, a0, a1); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,150,130,0.7)'; ctx.lineWidth = Math.max(1, 1.2 * Gfx.dpr);
    ctx.beginPath(); ctx.arc(X, Y, ro, a0, a1); ctx.stroke();
    if (ri > 1) { ctx.strokeStyle = 'rgba(255,200,180,0.8)'; ctx.beginPath(); ctx.arc(X, Y, ri, a0, a1); ctx.stroke(); }
  },
  drawLaser(ctx, e) {
    const X0 = Gfx.X(e.x0), Y0 = Gfx.Y(e.y0), X1 = Gfx.X(e.x1), Y1 = Gfx.Y(e.y1);
    const f = clamp(1 - e.t / e.dur, 0, 1), w = (e.width + 1) * Gfx.sx * (0.8 + 0.2 * Math.sin(e.t * 90));
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [ww, col, al] of [[w * 3.2, [255, 40, 90], 0.25], [w * 1.6, [255, 80, 140], 0.55], [w * 0.55, [255, 255, 255], 0.95]]) {
      ctx.strokeStyle = rgba(col, al * f); ctx.lineWidth = Math.max(1, ww);
      ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
    }
    this.drawGlow(ctx, X1, Y1, w * 6, [255, 120, 160], 0.8 * f);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },
  drawPlasma(ctx, e) {
    // 1.5's swelling red disc, as a glowing plasma ball whose brightness follows the same pulse
    const R = Math.max(1, e.radius() * Gfx.sx), v = e.bright();
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, R);
    g.addColorStop(0, 'rgba(255,90,60,' + (0.12 + 0.3 * v) + ')');
    g.addColorStop(0.7, 'rgba(230,20,30,' + (0.18 + 0.4 * v) + ')');
    g.addColorStop(0.96, 'rgba(255,60,50,' + (0.3 + 0.6 * v) + ')');
    g.addColorStop(1, 'rgba(255,60,50,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
    // a crackling rim
    ctx.strokeStyle = 'rgba(255,170,140,' + (0.25 + 0.55 * v) + ')'; ctx.lineWidth = Math.max(1, 1.4 * Gfx.dpr);
    ctx.setLineDash([R * 0.18, R * 0.07]); ctx.lineDashOffset = -Gfx.t * R * 0.8;
    ctx.beginPath(); ctx.arc(X, Y, R * 0.97, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    this.drawGlow(ctx, X, Y, R * 1.25, [255, 40, 30], 0.15 + 0.25 * v);
    ctx.globalCompositeOperation = 'source-over';
  },
  drawLightning(ctx, e) {
    if (Math.floor(e.t * 25) & 1) return;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, a] of [[6, 0.25], [2.5, 0.6], [1, 1]]) {
      ctx.strokeStyle = 'rgba(200,215,255,' + a + ')';
      (e.strands || [e.pts]).forEach((pts, si) => {
        ctx.lineWidth = w * Gfx.dpr * (si ? 0.6 : 1);
        ctx.beginPath();
        pts.forEach(([x, y], i) => { if (i) ctx.lineTo(Gfx.X(x), Gfx.Y(y)); else ctx.moveTo(Gfx.X(x), Gfx.Y(y)); });
        ctx.stroke();
      });
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  drawMeteor(ctx, e) {
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y);
    const TX = X - e.vx * 0.3 * Gfx.sx, TY = Y - e.vy * 0.3 * Gfx.sy;
    ctx.globalCompositeOperation = 'lighter';
    // the tail: a tapering streak from white-hot to smoky red
    const g = ctx.createLinearGradient(X, Y, TX, TY);
    g.addColorStop(0, 'rgba(255,230,180,0.9)'); g.addColorStop(0.3, 'rgba(255,140,50,0.55)'); g.addColorStop(1, 'rgba(160,40,20,0)');
    ctx.strokeStyle = g; ctx.lineCap = 'round';
    for (const [w, a] of [[9, 0.35], [5, 0.7], [2.2, 1]]) {
      ctx.globalAlpha = a; ctx.lineWidth = w * Gfx.dpr * Math.max(1, Gfx.sx / 3);
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(TX, TY); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.drawGlow(ctx, X, Y, 16 * Gfx.sx, [255, 170, 90], 1);
    this.drawGlow(ctx, X, Y, 6 * Gfx.sx, [255, 240, 210], 1);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },
  drawChopper(ctx, e) {
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y), s = Gfx.sx, fl = e.side > 0 ? -1 : 1;
    if (e.phase >= 1) { ctx.strokeStyle = 'rgba(200,200,200,0.8)'; ctx.lineWidth = Math.max(1, Gfx.dpr); ctx.beginPath(); ctx.moveTo(X, Y + 3 * s); ctx.lineTo(X, Gfx.Y(e.tank.top)); ctx.stroke(); }
    ctx.save(); ctx.translate(X, Y); ctx.scale(fl, 1);
    ctx.fillStyle = '#3d6b3a';
    ctx.beginPath(); ctx.ellipse(0, 0, 5 * s, 2.6 * s, 0, 0, TAU); ctx.fill();
    ctx.fillRect(-11 * s, -0.8 * s, 8 * s, 1.4 * s);
    ctx.fillStyle = '#9fd4ff'; ctx.beginPath(); ctx.ellipse(2.4 * s, -0.4 * s, 2 * s, 1.5 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(1, 0.5 * s);
    ctx.beginPath(); ctx.moveTo(-3 * s, 3.2 * s); ctx.lineTo(4 * s, 3.2 * s); ctx.stroke();
    const blade = Math.abs(Math.sin(Gfx.t * 40)) * 9 * s;
    ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.beginPath(); ctx.moveTo(-blade, -3.2 * s); ctx.lineTo(blade, -3.2 * s); ctx.stroke();
    ctx.restore();
  },

  // drawn after the interface (nothing yet: kept for effects that sit above menus)
  drawOverlay() {}
};

/* ---------------- vector tank designs (units: icon cells; x across, y down) ----------------
   Each follows the silhouette of the matching pixel icon so hit boxes and
   turret pivots line up exactly with the simulation. */
function tankFill(ctx, P, y0, y1, a, b) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(a || P.hi, 1)); g.addColorStop(1, rgba(b || P.lo, 1));
  return g;
}
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
function outline(ctx, P, lw) { ctx.strokeStyle = rgba(P.deep, 0.9); ctx.lineWidth = lw * 1.1; ctx.stroke(); }
function treads(ctx, P, x, y, w, h, n, lw) {
  VUI.rr.call({ ctx }, x, y, w, h, h / 2);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba([58, 62, 70], 1)); g.addColorStop(1, rgba(P.tread, 1));
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = lw; ctx.stroke();
  const r = h * 0.3;
  for (let i = 0; i < n; i++) {
    const cx = x + h / 2 + (w - h) * (n === 1 ? 0.5 : i / (n - 1));
    ctx.fillStyle = rgba(P.steelHi, 1); ctx.beginPath(); ctx.arc(cx, y + h / 2, r, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(P.steel, 1); ctx.beginPath(); ctx.arc(cx, y + h / 2, r * 0.45, 0, TAU); ctx.fill();
  }
}
function wheel(ctx, P, cx, cy, r, lw) {
  ctx.fillStyle = rgba(P.tread, 1); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = lw; ctx.stroke();
  ctx.fillStyle = rgba(P.steelHi, 1); ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, TAU); ctx.fill();
}
function dome(ctx, P, cx, cy, rx, ry, lw) {
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, TAU); ctx.closePath();
  const g = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.75, ry * 0.1, cx, cy - ry * 0.2, Math.max(rx, ry) * 1.1);
  g.addColorStop(0, rgba(mix3(P.hi, WHITE3, 0.35), 1)); g.addColorStop(0.45, rgba(P.base, 1)); g.addColorStop(1, rgba(P.lo, 1));
  ctx.fillStyle = g; ctx.fill(); outline(ctx, P, lw);
}
const TANK_ART = [
  // 0 Dome
  (ctx, P, lw) => {
    treads(ctx, P, 1.0, 4.85, 12.0, 2.15, 5, lw);
    poly(ctx, [[0.2, 4.95], [13.8, 4.95], [13.1, 3.3], [0.9, 3.3]]);
    ctx.fillStyle = tankFill(ctx, P, 3.3, 4.95, P.base, P.lo); ctx.fill(); outline(ctx, P, lw);
    ctx.fillStyle = rgba(P.deep, 0.55); ctx.fillRect(0.4, 4.35, 13.2, 0.55);
    dome(ctx, P, 7, 3.45, 3.9, 3.3, lw);
  },
  // 1 Wedge
  (ctx, P, lw) => {
    treads(ctx, P, 1.0, 4.85, 12.0, 2.15, 5, lw);
    poly(ctx, [[0.1, 4.95], [13.9, 4.95], [12.9, 3.3], [8.3, 1.05], [5.9, 1.05], [1.4, 3.3]]);
    ctx.fillStyle = tankFill(ctx, P, 1, 4.95, P.hi, P.lo); ctx.fill(); outline(ctx, P, lw);
    poly(ctx, [[5.9, 1.05], [8.3, 1.05], [12.9, 3.3], [7.1, 3.3]]);
    ctx.fillStyle = rgba(P.lo, 0.35); ctx.fill();
    ctx.fillStyle = rgba(P.deep, 0.5); ctx.fillRect(0.5, 4.35, 13, 0.55);
  },
  // 2 Panzer
  (ctx, P, lw) => {
    treads(ctx, P, 0.1, 4.85, 13.8, 2.15, 6, lw);
    poly(ctx, [[0.3, 4.95], [13.9, 4.95], [13.9, 2.2], [1.2, 2.2], [0.3, 3.1]]);
    ctx.fillStyle = tankFill(ctx, P, 2.2, 4.95, P.base, P.lo); ctx.fill(); outline(ctx, P, lw);
    ctx.fillStyle = rgba(P.deep, 0.5); ctx.fillRect(0.4, 4.2, 13.4, 0.7);
    VUI.rr.call({ ctx }, 3.7, 0.05, 5.6, 2.4, 0.7);
    ctx.fillStyle = tankFill(ctx, P, 0, 2.4, P.hi, P.mid); ctx.fill(); outline(ctx, P, lw);
    ctx.fillStyle = rgba(P.deep, 0.6); ctx.fillRect(7.6, 0.7, 1.0, 0.4);
  },
  // 3 Buggy
  (ctx, P, lw) => {
    wheel(ctx, P, 2.2, 5.75, 1.25, lw); wheel(ctx, P, 9.3, 5.75, 1.25, lw);
    poly(ctx, [[0.1, 4.95], [12.7, 4.95], [12.4, 3.7], [10.8, 2.9], [3.0, 2.2], [1.0, 3.2]]);
    ctx.fillStyle = tankFill(ctx, P, 2.2, 4.95, P.base, P.lo); ctx.fill(); outline(ctx, P, lw);
    poly(ctx, [[3.4, 2.4], [4.4, 0.9], [7.2, 0.4], [8.9, 2.7]]);
    ctx.fillStyle = tankFill(ctx, P, 0.4, 2.7, P.hi, P.mid); ctx.fill(); outline(ctx, P, lw);
    poly(ctx, [[4.7, 2.2], [5.2, 1.3], [7.0, 1.0], [7.9, 2.3]]);
    ctx.fillStyle = 'rgba(160,210,255,0.55)'; ctx.fill();
  },
  // 4 Bunker (fixed)
  (ctx, P, lw) => {
    for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) {
      const x = (r ? -1.4 : 0) + i * 2.8;
      const x0 = Math.max(0, x), x1 = Math.min(14, x + 2.7);
      ctx.fillStyle = rgba(mix3([96, 98, 104], P.base, 0.12), 1);
      ctx.fillRect(x0 + 0.05, 5.0 + r, x1 - x0 - 0.1, 0.92);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 5.0, 14, 0.08);
    ctx.beginPath(); ctx.ellipse(7, 5.02, 6.9, 5.0, 0, Math.PI, TAU); ctx.closePath();
    const g = ctx.createRadialGradient(5, 1.5, 0.3, 7, 3.5, 7.5);
    g.addColorStop(0, rgba(mix3(P.hi, [200, 200, 205], 0.45), 1)); g.addColorStop(0.6, rgba(mix3(P.base, [120, 120, 126], 0.45), 1)); g.addColorStop(1, rgba(mix3(P.lo, [40, 40, 44], 0.4), 1));
    ctx.fillStyle = g; ctx.fill(); outline(ctx, P, lw);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(4.6, 2.6, 4.8, 0.55);
  },
  // 5 Tower (fixed)
  (ctx, P, lw) => {
    poly(ctx, [[2.0, 7.0], [11.0, 7.0], [10.4, 6.0], [2.6, 6.0]]);
    ctx.fillStyle = 'rgb(70,72,80)'; ctx.fill(); outline(ctx, P, lw);
    poly(ctx, [[3.0, 6.05], [10.0, 6.05], [8.8, 5.0], [4.2, 5.0]]);
    ctx.fillStyle = tankFill(ctx, P, 5, 6, P.mid, P.lo); ctx.fill(); outline(ctx, P, lw);
    ctx.fillStyle = tankFill(ctx, P, 1.8, 5, P.base, P.lo);
    ctx.fillRect(5.0, 1.9, 3.0, 3.2); ctx.strokeStyle = rgba(P.deep, 0.9); ctx.lineWidth = lw; ctx.strokeRect(5.0, 1.9, 3.0, 3.2);
    VUI.rr.call({ ctx }, 3.8, 0.05, 5.4, 2.1, 0.8);
    ctx.fillStyle = tankFill(ctx, P, 0, 2.1, P.hi, P.mid); ctx.fill(); outline(ctx, P, lw);
  },
  // 6 Mobile Gun
  (ctx, P, lw) => {
    wheel(ctx, P, 2.2, 5.8, 0.95, lw); wheel(ctx, P, 6.2, 5.8, 0.95, lw); wheel(ctx, P, 10.2, 5.8, 0.95, lw);
    poly(ctx, [[0.0, 4.95], [13.9, 4.95], [13.4, 3.2], [12.2, 2.2], [1.2, 2.2], [0.3, 3.2]]);
    ctx.fillStyle = tankFill(ctx, P, 2.2, 4.95, P.base, P.lo); ctx.fill(); outline(ctx, P, lw);
    ctx.fillStyle = rgba(P.deep, 0.5); ctx.fillRect(0.4, 4.25, 13.2, 0.65);
    poly(ctx, [[0.9, 2.4], [1.3, 0.8], [2.5, 0.05], [4.9, 0.45], [5.5, 2.4]]);
    ctx.fillStyle = tankFill(ctx, P, 0, 2.4, P.hi, P.mid); ctx.fill(); outline(ctx, P, lw);
  },
  // 7 Triple
  (ctx, P, lw) => {
    treads(ctx, P, 1.0, 5.85, 15.0, 2.15, 7, lw);
    poly(ctx, [[0.1, 5.95], [16.9, 5.95], [16.2, 3.2], [0.8, 3.2]]);
    ctx.fillStyle = tankFill(ctx, P, 3.2, 5.95, P.base, P.lo); ctx.fill(); outline(ctx, P, lw);
    ctx.fillStyle = rgba(P.deep, 0.5); ctx.fillRect(0.4, 5.25, 16.2, 0.65);
    dome(ctx, P, 3.0, 3.25, 1.95, 1.75, lw);
    dome(ctx, P, 13.9, 3.25, 1.95, 1.75, lw);
    dome(ctx, P, 8.5, 3.25, 2.4, 3.2, lw);
  }
];

/* ---------------- Remastered looks for the extended arsenal ---------------- */
const NewFx = {
  onSpawn(e) {
    if (e instanceof Teleport) {
      for (let i = 0, n = Fx.n(18); i < n; i++) {
        const a = rand(0, TAU), v = rand(10, 40);
        Fx.add({ k: 'ember', x: e.fromX + rand(-4, 4), y: e.fromY + rand(-4, 4) * World.ay, vx: Math.cos(a) * v, vy: -rand(20, 60) * World.ay, life: rand(0.4, 0.9), size: rand(0.5, 1), c: [140, 240, 255], drag: 1.5, front: 1 });
      }
    } else if (e instanceof AirStrike) {
      for (let i = 0, n = Fx.n(14); i < n; i++) {
        Fx.add({ k: 'smoke', x: e.x + rand(-1, 1), y: e.y - rand(0, 3) * World.ay, vx: rand(-2, 2), vy: -rand(12, 30) * World.ay, life: rand(1.5, 2.6), size: 1, grow: 5, c: [220, 70, 60], alpha: 0.3, drag: 0.4, windy: 0.5 });
      }
    } else if (e instanceof Driller) {
      Fx.debris(e.x, e.y, 4, Fx.landColorAt(e.x, e.y), 10);
    } else if (e instanceof EmpPulse) {
      Fx.add({ k: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.6, size: 1, grow: e.r * 1.1, c: [120, 190, 255], alpha: 0.95, width: 1.6, front: 1 });
      Fx.shock(0.15);
    } else if (e instanceof TeslaArc) {
      Fx.add({ k: 'glow', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.35, size: 6, grow: 8, c: [170, 200, 255], alpha: 0.9, front: 1 });
    }
  },
  light(e, L) {
    if (e instanceof TeslaArc) {
      for (const c of e.chain) if (e.t >= c.at - 0.06 && e.t <= c.at + 0.25) L.push({ x: c.tx, y: c.ty, r: 40, i: 1.6, c: [0.6, 0.75, 1] });
    } else if (e instanceof DeathBeam) {
      const f = Math.min(1, e.t / 0.15) * Math.min(1, (e.dur - e.t) / 0.4);
      if (f > 0) for (let i = 0; i <= 4; i++) L.push({ x: e.x, y: lerp(World.top, e.y, i / 4), r: 34, i: 1.2 * f, c: [0.55, 0.62, 1] });
    } else if (e instanceof EmpPulse) {
      if (e.t < 0.6) L.push({ x: e.x, y: e.y, r: e.r * 1.6, i: 1.3 * (1 - e.t / 0.6), c: [0.35, 0.6, 1] });
    } else if (e instanceof Teleport) {
      L.push({ x: e.done ? e.tx : e.fromX, y: e.done ? e.ty - 4 : e.fromY, r: 26, i: 1.1 * (1 - e.t / 0.9), c: [0.45, 0.95, 1] });
    } else if (e instanceof Driller) {
      L.push({ x: e.x, y: e.y, r: 16, i: 0.9, c: [1, 0.6, 0.3] });
    } else if (e instanceof AirStrike) {
      if (e.t < 1.8) L.push({ x: e.x, y: e.y - 2, r: 22, i: 0.8 * (0.7 + 0.3 * Math.sin(Gfx.t * 20)), c: [1, 0.25, 0.2] });
    }
  },
  draw(ctx, e) {
    if (e instanceof AirStrike) return this.drawStrike(ctx, e);
    if (e instanceof Teleport) return this.drawTeleport(ctx, e);
    if (e instanceof TeslaArc) return this.drawTesla(ctx, e);
    if (e instanceof Driller) {
      Fx.drawOrb(ctx, e.x, e.y, 1.2, [255, 190, 110]);
      if (Math.random() < 0.6) Fx.add({ k: 'spark', x: e.x, y: e.y, vx: rand(-40, 40), vy: -rand(20, 70), life: 0.3, size: 0.3, c: [255, 200, 120], grav: 0.4, len: 0.03, front: 1 });
      return;
    }
    if (e instanceof EmpPulse) return this.drawEmp(ctx, e);
    if (e instanceof DeathBeam) {
      const f = Math.min(1, e.t / 0.15) * Math.min(1, (e.dur - e.t) / 0.4);
      if (f <= 0) return;
      const X = Gfx.X(e.x), top = Gfx.Y(World.top), bot = Gfx.Y(e.y), hw = (e.hw + 1) * Gfx.sx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(X - hw * 2.2, 0, X + hw * 2.2, 0);
      g.addColorStop(0, 'rgba(60,80,255,0)'); g.addColorStop(0.3, 'rgba(90,110,255,' + 0.35 * f + ')');
      g.addColorStop(0.5, 'rgba(235,240,255,' + 0.95 * f + ')'); g.addColorStop(0.7, 'rgba(90,110,255,' + 0.35 * f + ')'); g.addColorStop(1, 'rgba(60,80,255,0)');
      ctx.fillStyle = g; ctx.fillRect(X - hw * 2.2, top, hw * 4.4, bot - top);
      // bright bands drifting up the beam
      ctx.fillStyle = 'rgba(255,255,255,' + 0.25 * f + ')';
      const step = 26 * Gfx.dpr, off = (e.t * 260 * Gfx.dpr) % step;
      for (let y = bot - off; y > top; y -= step) ctx.fillRect(X - hw * 0.6, y - 4 * Gfx.dpr, hw * 1.2, 8 * Gfx.dpr);
      ctx.restore();
      if (Math.random() < 0.5 * f) Fx.add({ k: 'spark', x: e.x + rand(-3, 3), y: rand(World.top, e.y), vx: rand(-8, 8), vy: rand(-30, 10), life: rand(0.3, 0.7), size: 0.3, c: [200, 210, 255], grav: 0.1, len: 0.02, front: 1 });
      return;
    }
    if (e instanceof DirtGeyser) {
      if (!e.col) e.col = Fx.landColorAt(e.x, e.y + 3);
      ctx.fillStyle = rgba(e.col, 1);
      const w = Math.max(1, Gfx.sx * 0.9), h = Math.max(1, Gfx.sy * 0.9);
      for (const p of e.g) if (!p.done && p.d <= 0) ctx.fillRect(Gfx.X(p.x) - w / 2, Gfx.Y(p.y) - h / 2, w, h);
    }
  },
  drawStrike(ctx, e) {
    // flare on the ground
    if (e.t < 1.8) {
      ctx.globalCompositeOperation = 'lighter';
      Fx.drawGlow(ctx, Gfx.X(e.x), Gfx.Y(e.y - 1), Gfx.sx * (3 + Math.sin(Gfx.t * 25)), [255, 60, 40], 0.9);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // the bomber flies along the drop line
    const t0 = 0.8, dt = 0.13, n = e.n;
    const span = (e.xs[n - 1] - e.xs[0]) || e.dir;
    const speed = span / ((n - 1) * dt || 1);
    const px = e.xs[0] + (e.t - t0) * speed;
    if (Math.abs(px - e.x) > World.W * 1.3) return;
    const X = Gfx.X(px), Y = Gfx.Y(e.altitude(px) - 3 * World.ay), s = Gfx.sx * 1.2, d = e.dir;
    ctx.save(); ctx.translate(X, Y); ctx.scale(d, 1);
    ctx.globalCompositeOperation = 'lighter';
    Fx.drawGlow(ctx, -9 * s, 0, 4 * s, [255, 150, 80], 0.8);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#3a404c';
    ctx.beginPath(); ctx.moveTo(9 * s, 0); ctx.lineTo(3 * s, -1.4 * s); ctx.lineTo(-8 * s, -1.2 * s); ctx.lineTo(-9 * s, 1.2 * s); ctx.lineTo(3 * s, 1.4 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a2f38';
    ctx.beginPath(); ctx.moveTo(1 * s, 0); ctx.lineTo(-4 * s, 5 * s); ctx.lineTo(-6 * s, 5 * s); ctx.lineTo(-3 * s, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(1 * s, 0); ctx.lineTo(-4 * s, -4 * s); ctx.lineTo(-6 * s, -4 * s); ctx.lineTo(-3 * s, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6 * s, 0); ctx.lineTo(-9 * s, -3.5 * s); ctx.lineTo(-10 * s, -3.5 * s); ctx.lineTo(-9 * s, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(150,210,255,0.8)'; ctx.fillRect(3.5 * s, -0.9 * s, 2.5 * s, 0.9 * s);
    ctx.restore();
  },
  drawTeleport(ctx, e) {
    ctx.globalCompositeOperation = 'lighter';
    const beam = (x, y, a) => {
      const X = Gfx.X(x), Y = Gfx.Y(y), w = Gfx.sx * 7, h = Gfx.pf.h * 0.3;
      const g = ctx.createLinearGradient(0, Y - h, 0, Y);
      g.addColorStop(0, 'rgba(120,240,255,0)'); g.addColorStop(1, 'rgba(120,240,255,' + 0.55 * a + ')');
      ctx.fillStyle = g; ctx.fillRect(X - w / 2, Y - h, w, h);
      Fx.drawGlow(ctx, X, Y, w * 1.5, [140, 240, 255], 0.8 * a);
    };
    if (!e.done) beam(e.fromX, e.fromY + 3 * World.ay, clamp(e.t / 0.35, 0, 1));
    else beam(e.tx, e.ty, clamp(1 - (e.t - 0.35) / 0.55, 0, 1));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const s = Fx.state(e);
    if (e.done && !s.arrived) {
      s.arrived = true;
      for (let i = 0, n = Fx.n(22); i < n; i++) {
        const a = rand(0, TAU), v = rand(20, 60);
        Fx.add({ k: 'ember', x: e.tx, y: e.ty - 3 * World.ay, vx: Math.cos(a) * v, vy: Math.sin(a) * v * World.ay, life: rand(0.4, 0.9), size: rand(0.5, 1), c: [140, 240, 255], drag: 1.5, front: 1 });
      }
    }
  },
  drawTesla(ctx, e) {
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const c of e.chain) {
      if (e.t < c.at - 0.06 || e.t > c.at + 0.25) continue;
      const f = e.t < c.at ? 0.5 : clamp(1 - (e.t - c.at) / 0.25, 0, 1);
      const pts = [];
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const k = i / n, end = i === 0 || i === n;
        pts.push([Gfx.X(lerp(c.fx, c.tx, k) + (end ? 0 : (Math.random() - 0.5) * 9)), Gfx.Y(lerp(c.fy, c.ty, k) + (end ? 0 : (Math.random() - 0.5) * 9 * World.ay))]);
      }
      for (const [w, a] of [[7, 0.2], [3, 0.55], [1.2, 1]]) {
        ctx.strokeStyle = 'rgba(190,210,255,' + a * f + ')'; ctx.lineWidth = w * Gfx.dpr;
        ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      }
      Fx.drawGlow(ctx, Gfx.X(c.tx), Gfx.Y(c.ty), Gfx.sx * 9, [170, 200, 255], 0.8 * f);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },
  drawEmp(ctx, e) {
    const X = Gfx.X(e.x), Y = Gfx.Y(e.y);
    const k = clamp(e.t / 0.3, 0, 1), R = e.r * k * Gfx.sx, f = clamp(1 - e.t / 0.9, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(X, Y, R * 0.6, X, Y, Math.max(1, R));
    g.addColorStop(0, 'rgba(80,140,255,0)'); g.addColorStop(0.9, 'rgba(90,160,255,' + 0.25 * f + ')'); g.addColorStop(1, 'rgba(200,230,255,' + 0.7 * f + ')');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, Math.max(1, R), 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const s = Fx.state(e);
    if (e.hit && !s.popped) {
      s.popped = true;
      for (const v of e.victims) {
        const col = c3(v.color), t = v.tank;
        for (let i = 0, n = Fx.n(26); i < n; i++) {
          const a = rand(0, TAU), rr = t.shieldRx();
          Fx.add({ k: 'spark', x: t.cx + Math.cos(a) * rr, y: t.cy + Math.sin(a) * rr * World.ay, vx: Math.cos(a) * rand(30, 80), vy: Math.sin(a) * rand(30, 80) * World.ay, life: rand(0.3, 0.6), size: 0.35, c: mix3(col, WHITE3, 0.4), drag: 2, len: 0.04, front: 1 });
        }
      }
    }
  }
};
