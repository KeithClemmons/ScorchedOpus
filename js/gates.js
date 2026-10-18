'use strict';
/* =====================================================================
   Sky Gates (Remastered, Landscape > Sky Gates): frames hung in the air
   between the tanks. A shell that flies through one is changed by it,
   once per gate:
     x2 / x3 / x5   damage x, blast area x (radius by the square root);
                    a shell's bomblets, warheads and hops inherit it
     /2             half the damage and blast area
     boost / brake  1.5x or half the speed
     portal         one way: in the blue frame, out of the orange one,
                    same heading and speed
   Gates are laid out at the start of a round from the shared seeded
   random numbers (so every machine agrees); with Gates Move: SHUFFLE the
   host lays them out again at each turn and sends them to everyone.
   ===================================================================== */

const GATE_KINDS = {
  x2: { m: 2, label: '×2', tag: 'X2', col: [96, 232, 128] },
  x3: { m: 3, label: '×3', tag: 'X3', col: [72, 214, 255] },
  x5: { m: 5, label: '×5', tag: 'X5', col: [255, 206, 64] },
  half: { m: 0.5, label: '÷2', tag: '/2', col: [255, 86, 86] },
  boost: { v: 1.5, label: 'BOOST', tag: 'FAST', col: [190, 120, 255] },
  brake: { v: 0.5, label: 'BRAKE', tag: 'SLOW', col: [255, 150, 60] },
  pin: { label: 'IN', tag: 'IN', col: [80, 150, 255] },
  pout: { label: 'OUT', tag: 'OUT', col: [255, 150, 40] }
};
// how often each kind is picked (x2 and x3 are the common ones)
const GATE_WEIGHTS = [['x2', 30], ['x3', 30], ['x5', 5], ['half', 12], ['boost', 10], ['brake', 8], ['portal', 9]];

const Gates = {
  // rng(a, b): a uniform number in [a, b) - srand for the shared layout, rand on the host for shuffles
  place(rng) {
    const W = World.W, ay = World.ay;
    const picks = Cfg.skyGates === 'MANY' ? 6 : Cfg.skyGates === 'FEW' ? 3 : 0;
    if (!picks) return [];
    const tanks = Battle.tanks.filter(t => t.alive && !t.dying);
    let x0 = 30, x1 = W - 30;
    if (tanks.length >= 2) {
      const xs = tanks.map(t => t.x);
      const a = Math.min(...xs), b = Math.max(...xs);
      if (b - a > 90) { x0 = a + 20; x1 = b - 20; }
    }
    const out = [];
    let id = 1;
    const spot = h => {
      for (let tries = 0; tries < 60; tries++) {
        const x = Math.round(rng(x0, x1));
        if (tanks.some(t => Math.abs(t.x - x) < 24) || out.some(g => Math.abs(g.x - x) < 30)) continue;
        let ground = World.H;
        for (let dx = -6; dx <= 6; dx += 3) ground = Math.min(ground, World.surfaceY(clamp(x + dx, 0, W - 1)));
        const lo = World.top + h + 14 * ay, hi = ground - h - 16 * ay;
        if (hi <= lo) continue;
        const y = Math.round(rng(lo, hi));
        // never hung in rock (a cavern roof, an overhang)
        let clear = true;
        for (let yy = y - h; yy <= y + h && clear; yy += 2) for (const dx of [-3, 0, 3]) if (World.isLand(x + dx, yy)) { clear = false; break; }
        if (clear) return { x, y };
      }
      return null;
    };
    const weightSum = GATE_WEIGHTS.reduce((s, w) => s + w[1], 0);
    for (let n = 0; n < picks; n++) {
      let r = rng(0, weightSum), kind = 'x2';
      for (const [k, w] of GATE_WEIGHTS) { if ((r -= w) < 0) { kind = k; break; } }
      const h = Math.round(rng(13, 20) * ay);
      if (kind === 'portal') {
        const a = spot(h);
        if (!a) continue;
        out.push({ id: id++, k: 'pin', x: a.x, y: a.y, h });
        const inG = out[out.length - 1];
        let b = null;
        for (let tries = 0; tries < 8 && !b; tries++) { const s = spot(h); if (s && Math.abs(s.x - a.x) >= 70) b = s; }
        if (!b) { out.pop(); continue; }
        out.push({ id: id++, k: 'pout', x: b.x, y: b.y, h });
        inG.to = id - 1;
        continue;
      }
      const s = spot(h);
      if (s) out.push({ id: id++, k: kind, x: s.x, y: s.y, h });
    }
    return out;
  },
  // gates arriving from the host: keep only well-formed ones
  clean(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 16).filter(g => g && GATE_KINDS[g.k]).map(g => {
      const o = { id: g.id | 0, k: g.k, x: +g.x || 0, y: +g.y || 0, h: clamp(+g.h || 20, 4, 80) };
      if (g.k === 'pin') o.to = g.to | 0;
      return o;
    });
  },
  // a projectile moved from (ox, oy) to (p.x, p.y): did it fly through a gate?
  cross(p, ox, oy) {
    const list = Battle.gates;
    if (!list || !list.length || p.x === ox) return;
    for (const g of list) {
      if ((ox - g.x) * (p.x - g.x) > 0) continue;
      if (p.used && p.used.has(g.id)) continue;
      const t = (g.x - ox) / (p.x - ox), yc = oy + t * (p.y - oy);
      if (Math.abs(yc - g.y) > g.h) continue;
      if (!p.used) p.used = new Set();
      p.used.add(g.id);
      g.flash = performance.now();   // (cosmetic)
      const K = GATE_KINDS[g.k];
      if (K.m) p.mult = clamp((p.mult || 1) * K.m, 0.25, 10);
      if (K.v) { p.vx *= K.v; p.vy *= K.v; }
      if (g.k === 'pin') {
        const to = list.find(o => o.id === g.to);
        if (to) {
          p.used.add(to.id); to.flash = g.flash;
          p.x = to.x + (p.vx >= 0 ? 1.2 : -1.2);
          p.y = to.y + clamp(yc - g.y, -to.h, to.h);
          p.warps = (p.warps || 0) + 1;
        }
      }
      Sound.pos(g.x).beep(g.k === 'half' || g.k === 'brake' ? 300 : g.k === 'x5' ? 1400 : g.k === 'pin' ? 600 : 950, 0.09, 0.5);
      return;   // one gate per step (a portal has just moved it)
    }
  },
  // classic look: pixel frames with a tag over them
  drawClassic(s) {
    const list = Battle.gates;
    if (!list || !list.length) return;
    const now = performance.now();
    for (const g of list) {
      const K = GATE_KINDS[g.k];
      const lit = g.flash && now - g.flash < 400;
      const c = lit ? vga(63, 63, 63) : vga(K.col[0] / 4, K.col[1] / 4, K.col[2] / 4);
      const x0 = Math.round(g.x - 3), x1 = Math.round(g.x + 3), y0 = Math.round(g.y - g.h), y1 = Math.round(g.y + g.h);
      s.vline(x0, y0, y1, c); s.vline(x1, y0, y1, c);
      s.hline(x0, x1, y0, c); s.hline(x0, x1, y1, c);
      Font.center(s, K.tag, Math.round(g.x), y0 - 9, c);
    }
  }
};
