'use strict';
/* =====================================================================
   Physics, projectiles and weapon effects.
   Coordinates are screen pixels. Horizontal distances are in columns;
   vertical motion is multiplied by Screen.ay so shots arc the same on
   every graphics mode (non-square pixels included).
   ===================================================================== */

const Phys = {
  vmax() { return 0.59 * World.W; },
  g() { return 0.278 * World.W * (Cfg.gravity / 0.2) * World.ay; },
  windAcc(w) { return w * 0.00045 * World.W; },
  drag() { return Cfg.airViscosity * 0.025; },
  launch(angle, power) {
    const v = power / 1000 * this.vmax();
    return { vx: Math.cos(angle * DEG) * v, vy: -Math.sin(angle * DEG) * v * World.ay };
  }
};

// distance in "columns" (vertical rows scaled back by the aspect)
function adist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, (y2 - y1) / World.ay); }

const FIRE = [vga(20, 0, 0), vga(40, 0, 0), vga(58, 6, 0), vga(63, 20, 0), vga(63, 36, 0), vga(63, 50, 4), vga(63, 60, 20), vga(63, 63, 48)];
const NUKE = [vga(63, 63, 63), vga(63, 60, 24), vga(63, 44, 0), vga(63, 24, 0), vga(56, 4, 0), vga(40, 0, 16), vga(24, 0, 34), vga(40, 10, 50), vga(63, 30, 40), vga(63, 50, 20)];

/* ------------------------------ wall handling ------------------------------ */
// returns 'ok' | 'explode' | 'gone'
function applyWalls(o, walls) {
  const W = World.W;
  if (walls === 'OPEN') return 'ok';     // aiming math: an unbounded sky
  if (walls === 'WRAP') {
    if (o.x < 0) o.x += W; else if (o.x >= W) o.x -= W;
    return 'ok';
  }
  if (walls === 'NONE') {
    const b = Cfg.bordersExtend;
    if (o.x < -b || o.x > W + b) return 'gone';
    return 'ok';
  }
  const hitL = o.x < 0, hitR = o.x >= W, hitT = o.y < 0;
  if (!hitL && !hitR && !hitT) return 'ok';
  if (walls === 'CONCRETE') { o.x = clamp(o.x, 0, W - 1); o.y = Math.max(0, o.y); return 'explode'; }
  const k = walls === 'PADDED' ? 0.5 : walls === 'SPRING' ? 1.35 : 1;
  if (hitL) { o.x = -o.x; o.vx = Math.abs(o.vx) * k; }
  if (hitR) { o.x = 2 * (W - 1) - o.x; o.vx = -Math.abs(o.vx) * k; }
  if (hitT) { o.y = -o.y; o.vy = Math.abs(o.vy) * k; }
  if (walls === 'PADDED') { o.vy *= 0.85; }
  if (walls === 'SPRING') {
    // the kick is real, but it can't pump a shell up forever
    const vm = Phys.vmax() * 1.4, sp = Math.hypot(o.vx, o.vy / World.ay);
    if (sp > vm) { o.vx *= vm / sp; o.vy *= vm / sp; }
  }
  o.bounced = true;
  return 'ok';
}

/* ------------------------------ ballistics (AI / guidance) ------------------------------ */
const Ballistics = {
  // o: {wind, drag, targetY, land, walls, owner, maxT}
  sim(x, y, vx, vy, o) {
    o = o || {};
    const g = Phys.g(), wa = Phys.windAcc(o.wind === undefined ? Battle.wind : o.wind);
    const drag = o.drag ? Phys.drag() : 0, walls = o.walls || 'NONE';
    const h = 1 / 90, maxT = o.maxT || 30;
    const s = { x, y, vx, vy, bounced: false };
    let t = 0, apex = y;
    while (t < maxT) {
      s.vx += (wa - drag * s.vx) * h; s.vy += (g - drag * s.vy) * h;
      const nx = s.x + s.vx * h, ny = s.y + s.vy * h;
      if (o.land) {
        // walk the segment so thin ridges are not skipped
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(nx - s.x), Math.abs(ny - s.y))));
        for (let i = 1; i <= steps; i++) {
          const px = s.x + (nx - s.x) * i / steps, py = s.y + (ny - s.y) * i / steps;
          if (py >= World.top && px >= 0 && px < World.W && World.isLand(px, py)) return { x: px, y: py, t, land: true, apex, bounced: s.bounced };
          if (o.tanks) {
            for (const tk of Battle.tanks) {
              if (!tk.alive || (tk === o.owner && t < 0.25)) continue;
              if (tk.contains(px, py)) return { x: px, y: py, t, tank: tk, apex, bounced: s.bounced };
            }
          }
        }
      }
      s.x = nx; s.y = ny; t += h;
      if (s.y < apex) apex = s.y;
      const r = applyWalls(s, walls);
      if (r === 'gone') return { x: s.x, y: s.y, t, off: true, apex };
      if (r === 'explode') return { x: s.x, y: s.y, t, wall: true, apex };
      if (o.targetY !== undefined && s.vy > 0 && s.y >= o.targetY) return { x: s.x, y: s.y, t, cross: true, apex, bounced: s.bounced };
      if (s.y >= World.H) return { x: s.x, y: s.y, t, off: true, bottom: true, apex };
    }
    return { x: s.x, y: s.y, t, off: true, apex };
  },
  // x position where a shot at (angle, power) comes down through targetY
  landX(from, angle, power, targetY, o) {
    const v = Phys.launch(angle, power);
    const r = this.sim(from.x, from.y, v.vx, v.vy, Object.assign({ targetY, walls: 'OPEN' }, o || {}));
    return r.cross ? r.x : null;
  },
  // binary search the power needed to hit (tx, ty) at a fixed angle; null if impossible
  solvePower(from, angle, tx, ty, maxPower, o) {
    const dir = Math.cos(angle * DEG) >= 0 ? 1 : -1;
    let lo = 0, hi = maxPower;
    const fx = p => { const x = this.landX(from, angle, p, ty, o); return x === null ? null : (x - from.x) * dir; };
    const need = (tx - from.x) * dir;
    const fHi = fx(hi);
    if (fHi === null || fHi < need) return null;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2, f = fx(mid);
      if (f === null || f < need) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
};

/* ------------------------------ projectile ------------------------------ */
class Shot {
  constructor(o) {
    this.owner = o.owner; this.wp = o.wp;
    this.x = o.x; this.y = o.y; this.vx = o.vx; this.vy = o.vy;
    this.guid = o.guid || null; this.target = o.target || null;
    this.trigger = !!o.trigger; this.stage = o.stage || 0; this.sub = !!o.sub;
    this.r = o.r; this.dmg = o.dmg; this.color = o.color || null;
    this.delay = o.delay || 0; this.age = 0;
    this.inDirt = false; this.split = false; this.dead = false;
    this.leftOwner = false; this.mode = null; this.main = !!o.main;
    this.trail = o.trail || null; this.smokeHue = rand(0, 360);
    this.lazyArmed = false;
    this.walls = Battle.walls;
  }
  // a copy of this shell in flight (Sky Gates x2 / x3 / x5)
  clone() {
    const c = new Shot({ owner: this.owner, wp: this.wp, x: this.x, y: this.y, vx: this.vx, vy: this.vy, guid: this.guid, target: this.target,
      trigger: this.trigger, stage: this.stage, sub: this.sub, r: this.r, dmg: this.dmg, color: this.color, main: false });
    c.age = this.age; c.leftOwner = true; c.split = this.split; c.mode = this.mode; c.walls = this.walls; c.top = this.top;
    c.heatT = this.heatT; c.lazyArmed = this.lazyArmed;
    return c;
  }
  get vmax() { return Phys.vmax(); }
  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return true; }
    const g = Phys.g(), wa = Phys.windAcc(Battle.wind), drag = Phys.drag();
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-6 && !this.dead && guard++ < 4000) {
      const sp = Math.max(Math.abs(this.vx), Math.abs(this.vy), 1);
      const h = Math.min(remaining, 0.9 / sp);
      remaining -= h;
      this.age += h;
      this.steer(h);
      if (!this.mode) {
        this.vx += (wa - drag * this.vx) * h;
        this.vy += (g - drag * this.vy) * h;
        this.magField(h);
      }
      const ox = this.x, oy = this.y;
      this.x += this.vx * h; this.y += this.vy * h;
      Gates.cross(this, ox, oy);
      if (this.wp.kind === 'portalgun' && (!this.top || this.y < this.top.y)) this.top = { x: this.x, y: this.y, dir: this.vx >= 0 ? 1 : -1 };
      // MIRV / Death's Head split at apogee
      if ((this.wp.kind === 'mirv') && !this.sub && !this.split && this.vy >= 0 && this.age > 0.05) { this.doSplit(); return false; }
      const wr = applyWalls(this, this.walls);
      if (wr === 'gone') { this.finish(false); return false; }
      if (wr === 'explode') { this.impact(this.x, Math.max(this.y, 0), null); return false; }
      if (this.age > 30) { this.finish(false); return false; }
      if (this.y >= World.H) {
        // off the side of the battlefield there is no ground: it's simply gone
        if (this.x < 0 || this.x >= World.W) { this.finish(false); return false; }
        this.impact(this.x, World.H - 1, null); return false;
      }
      if (this.y < 0 || this.x < 0 || this.x >= World.W) continue;
      this.drawTrail(ox, oy);
      if (this.checkHits()) return false;
    }
    return !this.dead;
  }
  drawTrail(ox, oy) {
    if (this.wp.id === 'smokeTracer') {
      this.smokeHue = (this.smokeHue + 3) % 360;
      const c = vgaq(hsl(this.smokeHue, 1, 0.55));
      World.tracePixel(this.x, this.y, c); World.tracePixel(this.x + 1, this.y, c);
      World.tracePixel(this.x, this.y + 1, c);
    } else if (Cfg.tracePaths) {
      World.tracePixel(this.x, this.y, this.owner.color);
    }
  }
  magField(h) {
    for (const t of Battle.tanks) {
      if (!t.alive || !t.shield || !t.shield.it.mag || t === this.owner) continue;
      const dx = Math.abs(this.x - t.cx), up = (t.cy - this.y) / World.ay;
      if (dx < 26 && up > 0 && up < 110) {
        const k = t.shield.it.mag === 2 ? 2.4 : 1.4;
        const a = Phys.g() * k * (1 - up / 110) * (1 - dx / 26);
        // mostly sideways, away from the tank, and a little upward
        const side = this.x >= t.cx ? 1 : -1;
        this.vx += side * a * 1.3 * h / World.ay;
        this.vy -= a * 0.55 * h;
      }
    }
  }
  steer(h) {
    const gd = this.guid;
    if (!gd) return;
    const sp = Math.max(Math.hypot(this.vx, this.vy / World.ay), this.vmax * 0.35);
    const aim = (tx, ty) => {
      const dx = tx - this.x, dy = (ty - this.y) / World.ay, d = Math.hypot(dx, dy) || 1;
      this.vx = dx / d * sp; this.vy = dy / d * sp * World.ay;
    };
    if (gd.id === 'heatGuidance') {
      if (!this.mode) {
        for (const t of Battle.tanks) {
          if (!t.alive || t === this.owner) continue;
          if (adist(this.x, this.y, t.cx, t.cy) < 55) { this.mode = 'heat'; this.heatT = t; break; }
        }
      }
      if (this.mode === 'heat') { if (this.heatT.alive) aim(this.heatT.cx, this.heatT.cy); else this.mode = null; }
    } else if (this.target) {
      const tx = this.target.x, ty = this.target.y;
      if (gd.id === 'horzGuidance') {
        if (!this.mode && ((this.vy > 0 && this.y >= ty) || (this.vy < 0 && this.y <= ty && this.age > 0.2)) && this.age > 0.05) { this.mode = 'horz'; this.y = ty; }
        if (this.mode === 'horz') { this.vy = 0; this.vx = sign(tx - this.x || 1) * sp; }
      } else if (gd.id === 'vertGuidance') {
        const crossed = (this.lastSide !== undefined) && sign(tx - this.x) !== this.lastSide;
        this.lastSide = sign(tx - this.x);
        if (!this.mode && crossed && this.y < ty) { this.mode = 'vert'; this.x = tx; }
        if (this.mode === 'vert') { this.vx = 0; this.vy = sp * World.ay; }
      } else if (gd.id === 'lazyBoy') {
        // ride the computed arc, then home in once coming down near the target
        if (!this.mode && this.vy > 0 && adist(this.x, this.y, tx, ty) < Math.max(60, World.W * 0.18)) this.mode = 'lazy';
        if (!this.mode && this.age > 8) this.mode = 'lazy';
        if (this.mode === 'lazy') {
          aim(tx, ty);
          if (adist(this.x, this.y, tx, ty) < 1.5) { this.impact(tx, ty, null); }
        }
      }
    }
  }
  checkHits() {
    const x = this.x, y = this.y;
    // shields (never your own)
    for (const t of Battle.tanks) {
      // mag deflectors have no bubble (as in 1.5): their field pushes shells aside in magField(),
      // and whatever still gets through is soaked up by the shield's energy when it hits
      if (!t.alive || !t.shield || t === this.owner || t.shield.it.mag) continue;
      if (t.inShield(x, y)) {
        if (this.wp.kind === 'roller' && this.onGroundRoll) continue;
        // extended arsenal: pulses, coils, flares and teleports go off against the shield itself
        if (this.wp.onShield) { this.impact(x, y, null); return true; }
        const it = t.shield.it;
        if (it.deflect) {
          // force shield: bounce the projectile away from the tank
          const nx = x - t.cx, ny = (y - t.cy) / World.ay, nl = Math.hypot(nx, ny) || 1;
          const ux = nx / nl, uy = ny / nl;
          const vx = this.vx, vy = this.vy / World.ay, dot = vx * ux + vy * uy;
          if (dot < 0) {
            this.vx = (vx - 2 * dot * ux) * 0.9; this.vy = (vy - 2 * dot * uy) * 0.9 * World.ay;
            this.x = t.cx + ux * (t.shieldRx() + 1.5); this.y = t.cy + uy * (t.shieldRx() + 1.5) * World.ay;
            Battle.shieldHit(t, 3 + (this.dmg || 20) * 0.05, this.owner);
            Sound.pos(x).shieldHit();
          }
          return false;
        }
        // shield absorbs a direct hit without the warhead exploding
        Battle.shieldHit(t, 3 + (this.dmg || 20) * 0.06, this.owner);
        Battle.spawn(new Spark(x, y, it.color));
        Sound.pos(x).shieldHit();
        this.finish(true);
        return true;
      }
    }
    // tanks
    for (const t of Battle.tanks) {
      if (!t.alive) continue;
      if (t === this.owner && !this.leftOwner) {
        if (!t.contains(x, y, 2)) this.leftOwner = true;
        continue;
      }
      if (t.contains(x, y)) { this.impact(x, y, t); return true; }
    }
    // land
    if (y >= World.top || World.cavern) {
      const hit = World.isLand(x, y);
      if (hit) {
        const k = this.wp.kind;
        const tunnels = Cfg.tunneling && !this.trigger && !this.mode && k !== 'roller' && k !== 'digger' && k !== 'sandhog' && k !== 'tracer';
        if (!tunnels) { this.impact(x, y, null); return true; }
        if (!this.inDirt) { this.inDirt = true; this.enterSpeed = Math.hypot(this.vx, this.vy / World.ay); }
        this.vx *= 0.86; this.vy *= 0.86;
        if (Math.hypot(this.vx, this.vy / World.ay) < this.vmax * 0.12) { this.impact(x, y, null); return true; }
      } else if (this.inDirt) {
        this.inDirt = false;   // popped out the far side of a thin ridge
      }
    }
    return false;
  }
  doSplit() {
    this.split = true;
    this.dead = true;
    const n = this.wp.n, sc = scaleFactor();
    const spreadV = Phys.vmax() * (this.wp.id === 'deathsHead' ? 0.075 : 0.06);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * spreadV;
      Battle.spawn(new Shot({
        owner: this.owner, wp: this.wp, x: this.x, y: this.y, vx: this.vx + off, vy: this.vy,
        sub: true, r: this.wp.subR * sc, dmg: this.wp.dmg, trigger: this.trigger
      }));
    }
    Sound.beep(1500, 0.05, 0.5);
  }
  finish(silent) {
    this.dead = true;
    if (!silent && this.main) Battle.noteMiss(this);
  }
  impact(x, y, hitTank) {
    if (this.dead) return;
    this.dead = true;
    const wp = this.wp, sc = scaleFactor(), o = this.owner;
    x = clamp(x, -1, World.W); y = Math.min(y, World.H - 1);
    Battle.noteImpact(this, x, y, hitTank);
    switch (wp.kind) {
      case 'missile':
        Battle.spawn(new Explosion(x, y, wp.r * sc, { dmg: wp.dmg, owner: o, primary: true }));
        break;
      case 'nuke':
        Battle.spawn(new Explosion(x, y, wp.r * sc, { dmg: wp.dmg, owner: o, type: 'nuke', primary: true }));
        break;
      case 'mirv':
        if (!this.sub) { Battle.spawn(new Spark(x, y, vga(40, 40, 40))); Sound.beep(160, 0.08, 0.6); break; } // dud
        Battle.spawn(new Explosion(x, y, this.r, { dmg: this.dmg, owner: o, primary: true, small: true }));
        break;
      case 'leapfrog': {
        const st = this.stage;
        const ex = new Explosion(x, y, wp.radii[st] * sc, { dmg: wp.dmgs[st], owner: o, primary: true });
        Battle.spawn(ex);
        if (st < 2) {
          const sp = Math.hypot(this.vx, this.vy / World.ay);
          const dir = this.vx >= 0 ? 1 : -1;
          const hop = Math.max(sp * 0.55, Phys.vmax() * 0.25);
          Battle.spawn(new Shot({
            owner: o, wp, stage: st + 1, x: x - dir * 2, y: y - 3 * World.ay,
            vx: dir * hop * 0.55, vy: -hop * 0.8 * World.ay, trigger: this.trigger, main: this.main,
            // 1.5: it hops on from the crater only once the blast is over
            delay: ex.growT + ex.holdT + ex.fadeT + 0.5
          }));
        }
        break;
      }
      case 'funky': {
        // 1.5 (four recordings): a blast where it lands (anywhere from small to bomblet-sized), then
        // 6-9 bomblets go up from there about once a second
        Battle.spawn(new Explosion(x, y, srand(6, 18) * sc, { dmg: 45, owner: o, primary: true, type: 'funky', color: vgaq(hsl(rand(0, 360), 1, 0.55)) }));
        const n = sirand(6, 9), R = wp.r * sc;
        // a fast shell digs a few rows in before it registers the hit: the bomblets go up from the
        // surface above it (starting underground, they all burst at once in the same spot)
        let gy = Math.floor(y);
        while (gy > World.top && World.isLand(x, gy)) gy--;
        for (let i = 0; i < n; i++) {
          const ang = srand(20, 160) * DEG, v = Phys.vmax() * srand(0.12, 0.3) * Math.sqrt(R / 80);
          const b = new Bomblet(o, x, gy - World.ay, Math.cos(ang) * v, -Math.sin(ang) * v * World.ay, srand(15, 22) * sc, wp.dmg, x, R);
          b.delay = 0.3 + i * 0.95;
          Battle.spawn(b);
        }
        break;
      }
      case 'napalm':
        Battle.spawn(new Liquid(x, y, { owner: o, napalm: true, amount: wp.amount, heat: wp.heat, hot: wp.id === 'hotNapalm', vx: this.vx }));
        break;
      case 'tracer':
        Battle.spawn(new Spark(x, y, wp.smoke ? vga(63, 63, 63) : vga(50, 50, 50)));
        break;
      case 'roller':
        if (hitTank) { Battle.spawn(new Explosion(x, y, wp.r * sc, { dmg: wp.dmg, owner: o, primary: true })); break; }
        Battle.spawn(new Roller(o, wp, x, y, this.vx));
        break;
      case 'riotbomb':
        Battle.spawn(new RiotWedge(x, y, wp.r * sc, 0, 360));
        break;
      case 'digger':
      case 'sandhog':
        if (hitTank) {
          if (wp.kind === 'sandhog') Battle.spawn(new Explosion(x, y, wp.r * sc, { dmg: wp.dmg, owner: o, primary: true, small: true }));
          else { Battle.spawn(new Spark(x, y, vga(40, 40, 40))); Sound.beep(200, 0.06, 0.5); }
          break;
        }
        spawnTunnelers(o, wp, x, y, this.vx, this.vy);
        break;
      case 'dirt':
        Battle.spawn(new Explosion(x, y, wp.r * sc, { dmg: 0, owner: o, type: 'dirt' }));
        break;
      case 'liquiddirt':
        Battle.spawn(new LiquidDirt(x, y, Math.round(wp.amount * sc * (Cfg.extraDirt ? 1.3 : 1))));
        break;
      case 'dirtcharge':
        Battle.spawn(new DirtSpray(x, y, wp.r * sc, wp.spread, Cfg.extraDirt ? 2 : 1));
        break;
      case 'portalgun':
        Gates.portalShot(this, x, y);
        break;
      case 'airstrike': case 'teleport': case 'tesla': case 'buster': case 'emp':
        Arsenal.impact(this, x, y, hitTank);
        break;
      case 'disrupter':
        Battle.spawn(new Ring(x, y, vga(30, 50, 63)));
        World.suspended = false;
        World.unstable.fill(1);
        Sound.pos(x).plasma();
        break;
      default:
        Battle.spawn(new Explosion(x, y, 10, { dmg: 40, owner: o, primary: true }));
    }
  }
  draw(s) {
    if (this.mult && this.mult !== 1 && this.delay <= 0) {
      const c = this.mult < 1 ? vga(63, 20, 20) : this.mult >= 5 ? vga(63, 52, 16) : this.mult >= 3 ? vga(18, 53, 63) : vga(24, 58, 32);
      Font.draw(s, this.mult < 1 ? '/' + Math.round(1 / this.mult) : 'X' + (Math.round(this.mult * 10) / 10), Math.round(this.x) + 4, Math.round(this.y) - 10, c);
    }
    if (this.delay > 0) return;
    const bi = Cfg.bombIcon;
    if (bi === 'INVISIBLE') return;
    const c = this.color || (this.wp.kind === 'nuke' ? vga(63, 63, 20) : vga(63, 63, 63));
    if (bi === 'SMALL') s.pset(this.x, this.y, c);
    else {
      const sy = Math.max(1, Math.round(World.ay));
      s.fillRect(this.x - 1, this.y - sy, 2, 2 * sy, c);
    }
  }
}

/* ------------------------------ explosion ------------------------------ */
class Explosion {
  constructor(x, y, r, o) {
    o = o || {};
    // Sky Gates: x damage, x blast area
    const M = Battle.multNow();
    if (M !== 1) { r *= Math.sqrt(M); if (o.dmg) o = Object.assign({}, o, { dmg: o.dmg * M }); }
    this.x = x; this.y = y; this.r = Math.max(2, r); this.o = o;
    this.type = o.type || 'normal';
    this.t = 0;
    const small = Cfg.smallMemory;
    const nuke = this.type === 'nuke' && !small;
    this.growT = nuke ? 0.45 + this.r / 110 : 0.1 + this.r / 220;
    this.holdT = nuke ? 0.55 + this.r / 90 : this.type === 'tank' ? 0.35 : 0.12 + this.r / 350;
    // 1.5's dirt: real earth growing outward (about 1500 square pixels a second), hanging 0.3s before it settles
    if (this.type === 'dirt') { this.growT = clamp(this.r * this.r / 1500, 0.08, 1); this.holdT = 0.3; }
    // 1.5 lets a blast cool at full size (dark red, cracking black) before it goes
    this.fadeT = nuke ? 0.25 : this.r >= 6 && this.type !== 'riot' && this.type !== 'dirt' && this.type !== 'hog' ? 0.3 : 0.08;
    // 1.5's fireball (measured): a red ball that grows ever slower the bigger it is, a 0.73s pulse,
    // then a black disc that splits open from the middle to show the crater
    if ((this.type === 'normal' || this.type === 'nuke' || this.type === 'funky') && !small) {
      const q = this.r / 32;
      // (capped: 1.5's Nuke takes ~12s to grow at Large, which drags in play)
      this.growT = clamp(0.5 * Math.pow(q, 2.5), 0.08, 3);
      this.holdT = 0.8;
      this.fadeT = clamp(0.2 * Math.pow(q, 1.6), 0.06, 2.5);
      // 1.5 (measured from MIRV / Death's Head): each ball grows on its own, the finished ones wait
      // at full glow until every ball in the air is grown, then all pulse together, all go black, and
      // the black discs open one at a time in the order they came
      this.ball = true; this.stage = 'grow'; this.st = 0;
    }
    this.vt = 0;   // where the picture is in grow/hold/fade terms (the Remastered look reads it)
    this.hit = false; this.carved = false;
    this.seed = irand(0, 999);
    Sound.pos(this.x);
    if (this.type === 'nuke') {
      if (o.small) Sound.explosion(this.r); else Sound.nuke(this.r);
      if (!small && !o.small) { Screen.flash = Math.max(Screen.flash, this.r >= 60 ? 0.55 : 0.35); Screen.flashColor = vga(63, 63, 50); }
    }
    else if (this.type === 'dirt') Sound.dirt();
    else if (this.type === 'riot') Sound.crunch(0.3, 1400, 400, 0.6);
    else Sound.explosion(this.r);
  }
  update(dt) {
    this.t += dt;
    if (this.ball) return this.updateBall(dt);
    this.vt = this.t;
    if (this.type === 'dirt') {
      const R = this.r * clamp(this.t / this.growT, 0, 1);
      if (R >= 0.5) World.addEllipse(this.x, this.y, R, R * World.ay, undefined, true);
      if (this.t >= this.growT + this.holdT) {
        World.markUnstable(this.x - this.r - 1, this.x + this.r + 1);
        Battle.terrainChanged();
        return false;
      }
      return true;
    }
    if (!this.hit && this.t >= this.growT) {
      this.hit = true;
      if (this.o.dmg > 0) Battle.blast(this.x, this.y, this.r, this.o.dmg, this.o.owner, { primary: this.o.primary });
    }
    if (!this.carved && this.t >= this.growT + this.holdT) {
      this.carved = true;
      const ry = this.r * World.ay;
      if (this.type === 'dirt') {
        World.addEllipse(this.x, this.y, this.r, ry);
      } else {
        // underground warheads leave their craters standing until the whole volley is done
        World.carveEllipse(this.x, this.y, this.r, ry, !!this.o.dig, this.o.residue || 0, this.seed);
        if (this.o.dig) { this.o.dig.note(this.x, this.r); this.o.dig.live--; }
      }
      Battle.terrainChanged();
    }
    return this.t < this.growT + this.holdT + this.fadeT;
  }
  draw(s) {
    if (this.type === 'dirt') return;   // the earth itself is the picture
    const t = this.t, ay = World.ay;
    let k;
    if (t < this.growT) k = t / this.growT;
    else if (t < this.growT + this.holdT) k = 1;
    else k = 1 - (t - this.growT - this.holdT) / this.fadeT;
    k = clamp(k, 0, 1);
    if (this.ball) return this.drawBall(s);
    // cooling: the last stage of a fireball, at full size
    const cool = this.fadeT > 0.2 && this.type !== 'nuke' && t >= this.growT + this.holdT ? clamp((t - this.growT - this.holdT) / this.fadeT, 0, 1) : -1;
    if (cool >= 0) k = 1;
    const R = this.r * (this.type === 'nuke' && t < this.growT ? Math.sqrt(k) : k);
    if (R < 0.5) return;
    const x0 = Math.max(0, Math.floor(this.x - R)), x1 = Math.min(World.W - 1, Math.ceil(this.x + R));
    const y0 = Math.floor(this.y - R * ay), y1 = Math.ceil(this.y + R * ay);
    const phase = t * (this.type === 'nuke' ? 14 : 22);
    const small = Cfg.smallMemory;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= World.H) continue;
      const dy = (y - this.y) / ay;
      for (let x = x0; x <= x1; x++) {
        const dx = x - this.x, d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const d = Math.sqrt(d2) / this.r;
        let c;
        if (cool >= 0) {
          // dark red (or the bomblet's color) veined with black cracks that widen as it cools
          const n = noise2(x / 5, y / (5 * ay), this.seed);
          if (Math.abs(n - 0.5) < 0.012 + cool * 0.05 || hash2(x, y, this.seed) < cool * cool * 0.35) c = vga(0, 0, 0);
          else {
            const base = this.type === 'funky' ? this.o.color : vga(58, 6, 4);
            c = scalec(base, 0.7 + 0.3 * hash2(x >> 1, y >> 1, this.seed + 7) - cool * 0.25);
          }
          s.buf[y * s.w + x] = c;
          continue;
        }
        switch (this.type) {
          case 'nuke': {
            if (small) { c = FIRE[5 - Math.min(5, Math.floor(d * 5))]; break; }
            const i = Math.floor(d * 7 - phase) % NUKE.length;
            c = NUKE[(i + NUKE.length) % NUKE.length];
            break;
          }
          case 'riot': {
            const i = Math.floor(d * 6 - phase) & 3;
            c = [vga(63, 63, 63), vga(40, 56, 63), vga(20, 40, 63), vga(50, 60, 63)][i];
            break;
          }
          case 'dirt': {
            const i = Math.floor(d * 5 + hash2(x, y, this.seed) * 2) % 3;
            c = [vga(40, 26, 12), vga(30, 18, 8), vga(48, 34, 18)][i];
            break;
          }
          case 'hog': {
            // 1.5's underground blast: flickering bands of red specks
            if (!(((y >> 1) + Math.floor(phase)) & 1) || hash2(x, y, this.seed + (phase | 0)) > 0.7) continue;
            c = vga(63, 4, 4);
            break;
          }
          case 'funky': {
            const i = Math.floor(d * 5 - phase) & 1;
            c = i ? this.o.color : mixc(this.o.color, vga(63, 63, 63), 0.6);
            break;
          }
          case 'tank': {
            // 1.5: a tank's fireball is a churning red plasma, black to bright red
            const n = fbm2(x / 7 + phase * 0.05, y / (7 * ay) - phase * 0.04, this.seed, 3);
            const v = clamp((n - 0.28) * 2.2 + (1 - d) * 0.25, 0, 1);
            c = vga(Math.floor(v * 8) / 8 * 63, 0, 0);
            break;
          }
          default: {
            // fireball: hot core, orange mid, red rim, flickering bands
            const f = (1 - d) * 7 + Math.sin(phase + d * 9) * 1.2 + (hash2(x >> 1, y >> 1, this.seed + (phase | 0)) - 0.5);
            c = FIRE[clamp(Math.floor(f), 0, 7)];
          }
        }
        s.buf[y * s.w + x] = c;
      }
    }
  }
}

// the fireball's stages: grow, wait for the rest of the volley, pulse together, black, open in turn
Explosion.prototype.updateBall = function (dt) {
  const balls = Battle.entities.filter(e => e instanceof Explosion && e.ball);
  switch (this.stage) {
    case 'grow':
      if (this.t >= this.growT) {
        this.stage = 'wait';
        if (this.o.dmg > 0) Battle.blast(this.x, this.y, this.r, this.o.dmg, this.o.owner, { primary: this.o.primary });
      }
      this.vt = Math.min(this.t, this.growT);
      break;
    case 'wait':
      this.vt = this.growT;
      // (and while the rest of the volley is still in the air: MIRV warheads, funky bomblets)
      if (!balls.some(e => e !== this && e.stage === 'grow') &&
          !Battle.entities.some(e => e instanceof Bomblet || (e instanceof Shot && e.delay <= 0 && !e.dead))) {
        // everyone grown: the whole volley pulses from this tick
        for (const e of balls) if (e.stage === 'wait') { e.stage = 'pulse'; e.st = 0; }
      }
      break;
    case 'pulse':
      this.st += dt;
      this.vt = this.growT + Math.min(this.st, this.holdT);
      if (this.st >= this.holdT) this.stage = 'black';
      break;
    case 'black':
      this.vt = this.growT + this.holdT;
      // the black discs open one at a time, oldest first
      if (balls.find(e => e.stage === 'black' || e.stage === 'open') === this) {
        this.stage = 'open'; this.st = 0;
        World.carveEllipse(this.x, this.y, this.r, this.r * World.ay);
        Battle.terrainChanged();
      }
      break;
    case 'open':
      this.st += dt;
      this.vt = this.growT + this.holdT + Math.min(this.st, this.fadeT);
      if (this.st >= this.fadeT) return false;
      break;
  }
  return true;
};
// 1.5's fireball, stage by stage (see updateBall)
Explosion.prototype.drawBall = function (s) {
  if (this.o.trail) drawTrail(s, this.o.trail);
  const ay = World.ay, g = this.growT, st = this.stage;
  const R = this.r * (st === 'grow' ? Math.pow(Math.min(1, this.t / g), 0.4) : 1);
  if (R < 0.5) return;
  const x0 = Math.max(0, Math.floor(this.x - R)), x1 = Math.min(World.W - 1, Math.ceil(this.x + R));
  const y0 = Math.max(0, Math.floor(this.y - R * ay)), y1 = Math.min(World.H - 1, Math.ceil(this.y + R * ay));
  const t = st === 'grow' ? this.t : g;
  // last stages: black, then opening from the middle row up and down
  const er = st === 'black' ? 0 : st === 'open' ? clamp(this.st / this.fadeT, 0, 1) : -1;
  const gap = er >= 0 ? er * R * ay : 0;
  // the pulse: brightness rings that run outward and back
  const p = st === 'pulse' ? clamp(this.st / this.holdT, 0, 1) : -1;
  for (let y = y0; y <= y1; y++) {
    const dy = (y - this.y) / ay;
    if (er >= 0 && Math.abs(y - this.y) < gap) continue;
    for (let x = x0; x <= x1; x++) {
      const dx = x - this.x, d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      let c;
      if (er >= 0) c = vga(0, 0, 0);
      else {
        const d = Math.sqrt(d2) / R;
        if (this.type === 'funky') {
          // 1.5's funky blast: rings of its colour, light and dark, that run outward in the pulse
          const ring = Math.floor(d * 6 - (p >= 0 ? p * 6 : 0)) & 1;
          c = scalec(this.o.color, ring ? 0.55 + 0.45 * (1 - d) : 0.18 + 0.3 * (1 - d));
        } else {
          // bright red heart, darkening to black at the rim (the rim darkens as it nears full size)
          let v = Math.pow(1 - d, 0.55 + (t < g ? 0.6 * t / g : 0.6));
          if (p >= 0) v *= 0.5 + 0.5 * Math.cos(TAU * (p * 1.25 - d * 0.6));
          v = Math.floor(v * 20) / 20;
          c = vga(63 * v, 0, 4 * v);
        }
      }
      s.buf[y * s.w + x] = c;
    }
  }
};

// a funky bomblet's flight path, as 1.5 draws it: a thin pale line
function drawTrail(s, pts) {
  const c = vga(40, 40, 63);
  for (let i = 0; i < pts.length; i += 2) s.pset(pts[i], pts[i + 1], c);
}

// does something after a pause on the game clock (a second blast, say)
class Delayed {
  constructor(t, fn) { this.t = t; this.fn = fn; }
  update(dt) { this.t -= dt; if (this.t > 0) return true; this.fn(); return false; }
  draw() {}
}

// a dying tank's beam of light straight up to the top of the screen: all show, as in 1.5 it
// harms nothing and leaves the ground alone
class DeathBeam {
  constructor(x, y) {
    this.x = x; this.y = y; this.t = 0; this.dur = 1.6; this.hw = 4.5;
    Sound.pos(x).laser();
  }
  update(dt) {
    this.t += dt;
    return this.t < this.dur;
  }
  draw(s) {
    // light at the core, deep blue at the edges, bands drifting upward
    const f = Math.min(1, this.t / 0.15) * Math.min(1, (this.dur - this.t) / 0.4);
    if (f <= 0) return;
    for (let dx = -5; dx <= 5; dx++) {
      const k = 1 - Math.abs(dx) / 6;
      for (let y = World.top; y < this.y; y++) {
        const band = 0.82 + 0.18 * Math.sin(y * 0.35 + this.t * 26);
        const v = k * band * f;
        s.pset(this.x + dx, y, vga(22 + 38 * v, 22 + 38 * v, 52 + 11 * v));
      }
    }
  }
}

// a dying tank's last gasp: a cone of dirt thrown into the air that rains back down as new ground
class DirtGeyser {
  constructor(x, y, n) {
    this.x = x; this.y = y; this.g = [];
    const v0 = Phys.vmax();
    for (let i = 0; i < n; i++) {
      const a = srand(40, 140) * DEG, v = v0 * srand(0.08, 0.3);
      this.g.push({ x: x + srand(-2, 2), y: y - 1, vx: Math.cos(a) * v, vy: -Math.sin(a) * v * World.ay, d: srand(0, 0.6) });
    }
    Sound.pos(x).dirt();
  }
  update(dt) {
    const gr = Phys.g() * 0.3, W = World.W, H = World.H;   // loose dirt: it floats down slowly
    let live = 0;
    for (const p of this.g) {
      if (p.done) continue;
      if (p.d > 0) { p.d -= dt; live++; continue; }
      for (let k = 0; k < 3 && !p.done; k++) {
        p.vy += gr * dt / 3; p.x += p.vx * dt / 3; p.y += p.vy * dt / 3;
        if (p.x < 0 || p.x >= W) { p.done = true; break; }
        if (p.vy > 0 && (p.y >= H - 1 || (p.y > World.top && World.isLand(p.x, p.y + 1)))) {
          // settle: on top of whatever is here
          const x = Math.floor(p.x);
          let y = Math.min(Math.floor(p.y), H - 1);
          while (y > World.top && World.isLand(x, y)) y--;
          World.addPixel(x, y);
          p.done = true;
        }
      }
      if (!p.done) live++;
    }
    return live > 0;
  }
  draw(s) {
    const c = Battle.flatLand();
    for (const p of this.g) if (!p.done && p.d <= 0) s.pset(p.x, p.y, c);
  }
}

// funky bomb sub-munition: short hop, random-colored blast
class Bomblet {
  constructor(owner, x, y, vx, vy, r, dmg, ox, R) {
    this.owner = owner; this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.r = r; this.dmg = dmg;
    this.ox = ox; this.R = R; this.age = 0; this.color = vgaq(hsl(rand(0, 360), 1, 0.55));
    this.delay = srand(0, 0.25);
    this.trail = []; this.trailT = 0;
  }
  clone() {
    const c = new Bomblet(this.owner, this.x, this.y, this.vx, this.vy, this.r, this.dmg, this.ox, this.R);
    c.delay = 0; c.age = this.age;
    return c;
  }
  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return true; }
    const g = Phys.g();
    let rem = dt;
    while (rem > 1e-6) {
      const sp = Math.max(Math.abs(this.vx), Math.abs(this.vy), 1), h = Math.min(rem, 0.9 / sp);
      rem -= h; this.age += h;
      const ox = this.x, oy = this.y;
      this.vy += g * h; this.x += this.vx * h; this.y += this.vy * h;
      Gates.cross(this, ox, oy);
      if ((this.trailT -= h) <= 0) { this.trailT = 0.012; this.trail.push(Math.floor(this.x), Math.floor(this.y)); }
      if (Math.abs(this.x - this.ox) > this.R) this.vx *= -0.6;  // stays near where it hit
      let hit = this.y >= World.H - 1 || World.isLand(this.x, this.y) || this.age > 3;
      for (const t of Battle.tanks) if (t.alive && t.contains(this.x, this.y)) hit = true;
      if (hit) {
        Battle.spawn(new Explosion(this.x, Math.min(this.y, World.H - 1), this.r, { dmg: this.dmg, owner: this.owner, type: 'funky', color: this.color, trail: this.trail }));
        return false;
      }
    }
    return true;
  }
  draw(s) { if (this.delay <= 0) { drawTrail(s, this.trail); s.fillRect(this.x - 1, this.y - 1, 2, 2, this.color); } }
}

/* ------------------------------ rollers ------------------------------ */
class Roller {
  constructor(owner, wp, x, y, vx) {
    this.owner = owner; this.wp = wp;
    this.x = Math.floor(clamp(x, 0, World.W - 1));
    this.y = World.groundY(this.x, Math.max(World.top, y - 3 * World.ay));
    const l = World.groundY(this.x - 2, this.y - 6 * World.ay), r = World.groundY(this.x + 2, this.y - 6 * World.ay);
    this.dir = l > r + 1 ? -1 : r > l + 1 ? 1 : (vx >= 0 ? 1 : -1);
    this.sk = World.W / 360;
    this.speed = 30 * this.sk; this.acc = 0; this.age = 0; this.bounces = 0;
  }
  explode() {
    Battle.spawn(new Explosion(this.x, this.y - 1, this.wp.r * scaleFactor(), { dmg: this.wp.dmg, owner: this.owner, primary: true }));
  }
  update(dt) {
    this.age += dt;
    this.acc += dt * this.speed;
    const ay = World.ay, maxStep = Math.max(1, Math.round(ay));
    for (;;) {
      let nx = this.x + this.dir;
      if (nx < 0 || nx >= World.W) {
        if (this.acc < 1) break;
        const w = Battle.walls;
        if (w === 'WRAP') nx = (nx + World.W) % World.W;
        else if (w === 'RUBBER' || w === 'SPRING' || w === 'PADDED') { this.dir = -this.dir; nx = this.x + this.dir; }
        else { this.explode(); return false; }
      }
      // speed is measured along the ground: a step down a steep face is a long way
      const ny0 = World.groundY(nx, this.y - maxStep - 1);
      const cost = Math.hypot(1, Math.max(0, ny0 - this.y) / ay);
      if (this.acc < cost) break;
      this.acc -= cost;
      // tanks and their shields
      for (const t of Battle.tanks) {
        if (!t.alive) continue;
        if (t.shield && !t.shield.it.mag && t !== this.owner && t.inShield(nx, this.y - 1)) {
          this.dir = -this.dir; this.bounces++; Sound.pos(this.x).bounce();
          if (this.bounces > 3) { this.explode(); return false; }
          return true;
        }
        if (t.contains(nx, this.y - 1, 1) && (t !== this.owner || this.age > 0.4)) { this.x = nx; this.explode(); return false; }
      }
      const ny = ny0;
      if (ny < this.y - maxStep) { this.explode(); return false; } // uphill: valley reached
      this.x = nx;
      // gravity: dropping h columns' worth adds speed like a falling body (v^2 += 2gh); the flat slows it
      if (ny > this.y) this.speed = Math.min(Math.sqrt(this.speed * this.speed + 2 * 220 * this.sk * this.sk * (ny - this.y) / ay), 200 * this.sk);
      else this.speed = Math.max(this.speed * 0.985, 22 * this.sk);
      this.y = ny;
      if (this.y >= World.H) { this.explode(); return false; }
    }
    if (this.age > 10) { this.explode(); return false; }
    return true;
  }
  draw(s) {
    const r = this.wp.id === 'heavyRoller' ? 2.6 : this.wp.id === 'roller' ? 2 : 1.5;
    const ay = World.ay, cy = this.y - (r + 0.5) * ay;
    s.fillEllipse(this.x, cy, r, r * ay, vga(34, 34, 34));
    s.fillEllipse(this.x - 0.4, cy - 0.4 * ay, r * 0.6, r * 0.6 * ay, vga(56, 56, 56));
    // the spinning highlight shows which way it's rolling
    const a = (this.x * 40 / r) * DEG * this.dir;
    s.pset(this.x + Math.cos(a) * r * 0.6, cy - Math.sin(a) * r * 0.6 * ay, vga(63, 63, 63));
  }
}

/* ------------------------------ diggers / sandhogs ------------------------------ */
function spawnTunnelers(owner, wp, x, y, vx, vy) {
  const sc = scaleFactor();
  const n = wp.n, dir = vx >= 0 ? 0 : 180, hog = wp.kind === 'sandhog';
  // 1.5: the tunnels (and a sandhog's craters) stand open a moment before the ground above caves in
  const dig = new DigCollapse(hog ? 0.4 : 0.6);
  Battle.spawn(dig);
  // 1.5: sandhogs zigzag on in the direction the shot was going, fanned out, free to climb or dive
  const head = (vx || 0) >= 0 ? 0 : 180;
  for (let i = 0; i < n; i++) {
    let a;
    if (hog) a = head + Math.round((i - (n - 1) / 2) * (180 / Math.max(1, n)) / 45) * 45;
    else a = 270 + srand(-80, 80);
    // heavy diggers are temperamental
    let len = wp.len * sc * srand(0.7, 1.15);
    if (wp.id === 'heavyDigger' && schance(0.35)) len *= srand(0.2, 0.5);
    // 1.5: a sandhog's tunnels are thin and dug at once; its warheads then go off one after another
    const tn = new Tunneler(owner, wp, x, y, a, len, hog ? 1 : wp.width, dir, hog ? 0 : i * 0.015, dig, hog ? i * 0.12 : 0);
    tn.head = head;
    Battle.spawn(tn);
  }
  Sound.pos(x).crunch(0.5, 300, 60, 0.6);
}
// waits for a digger's tunnels to finish, then lets the ground over them fall in
class DigCollapse {
  constructor(wait) { this.live = 0; this.x0 = Infinity; this.x1 = -Infinity; this.wait = wait; }
  note(x, r) { this.x0 = Math.min(this.x0, x - r); this.x1 = Math.max(this.x1, x + r); }
  update(dt) {
    if (this.live > 0) return true;
    if ((this.wait -= dt) > 0) return true;
    if (this.x1 >= this.x0) World.markUnstable(this.x0 - 2, this.x1 + 2);
    Battle.terrainChanged();
    return false;
  }
  draw() {}
}
class Tunneler {
  constructor(owner, wp, x, y, ang, len, width, dir, delay, dig, boom) {
    len *= Battle.multNow();
    this.owner = owner; this.wp = wp; this.x = x; this.y = y; this.ang = ang; this.len = len;
    this.width = width; this.dist = 0; this.air = 0; this.delay = delay;
    this.dig = dig || null; this.forks = 0; this.boom = boom || 0;
    this.head = 0; this.seg = 0;
    if (this.dig) this.dig.live++;
    // 1.5 digs a digger's whole network in about 0.4s; sandhogs zigzag along a little slower
    this.speed = (wp.kind === 'sandhog' ? 160 : 140) * World.W / 360;
  }
  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return true; }
    let move = this.speed * dt;
    while (move > 0) {
      const st = Math.min(1, move); move -= st;
      if (this.wp.kind === 'sandhog') {
        // straight runs with sharp turns: a new heading every few pixels, within 90 degrees of the way it's going
        if ((this.seg -= st) <= 0) { this.ang = this.head + sirand(-2, 2) * 45; this.seg = srand(5, 14); }
      } else this.ang += srand(-9, 9);
      this.x += Math.cos(this.ang * DEG) * st;
      this.y -= Math.sin(this.ang * DEG) * st * World.ay;
      this.dist += st;
      if (this.x < 0 || this.x >= World.W || this.y >= World.H - 1) return this.end();
      for (const t of Battle.tanks) {
        if (t.alive && t !== this.owner && t.contains(this.x, this.y, 1)) {
          if (this.wp.kind === 'sandhog') return this.end();
          Battle.spawn(new Spark(this.x, this.y, vga(40, 40, 40)));
          return this.end(); // diggers fizzle on tanks
        }
      }
      // look past our own freshly dug hole to see whether we are still in dirt
      const ahead = this.width / 2 + 1.5;
      const lx = this.x + Math.cos(this.ang * DEG) * ahead, ly = this.y - Math.sin(this.ang * DEG) * ahead * World.ay;
      if (World.isLand(lx, ly) || World.isLand(this.x, this.y)) this.air = 0;
      else if (++this.air > 8) return this.end();
      const r = this.width / 2 + 0.3;
      World.carveEllipse(this.x, this.y, r, r * World.ay, !!this.dig);
      if (this.dig) {
        this.dig.note(this.x, r);
        // a digger's network branches as it goes
        if (this.wp.kind === 'digger' && this.forks < 2 && this.dist > 6 && schance(0.035)) {
          this.forks++;
          Battle.spawn(new Tunneler(this.owner, this.wp, this.x, this.y, this.ang + (schance(0.5) ? 1 : -1) * srand(35, 70), (this.len - this.dist) * srand(0.5, 0.8), this.width, 0, 0, this.dig));
        }
      }
      if (this.dist >= this.len) return this.end();
    }
    return true;
  }
  end() {
    if (this.wp.kind === 'sandhog') {
      const x = this.x, y = this.y, wp = this.wp, owner = this.owner, dig = this.dig;
      if (dig) dig.live++;   // held open for the blast to come
      const go = () => Battle.spawn(new Explosion(x, y, wp.r * scaleFactor(), { dmg: wp.dmg, owner, primary: true, small: true, type: 'hog', dig, residue: 0.14 }));
      if (this.boom > 0) Battle.spawn(new Delayed(this.boom, go)); else go();
    }
    if (this.dig) this.dig.live--;
    Battle.terrainChanged();
    return false;
  }
  draw(s) {
    if (this.delay > 0) return;
    s.pset(this.x, this.y, this.wp.kind === 'sandhog' ? vga(63, 20, 10) : vga(63, 63, 40));
  }
}

/* ------------------------------ liquid dirt ------------------------------ */
// 1.5 (measured from a recording): the dirt runs downhill and fills the hollows around the impact
// level, in about a tenth of a second. Water-fill: always fill the lowest open cell next to what
// is already filled.
function waterFill(x, y, amount) {
  const W = World.W;
  let x0 = clamp(Math.floor(x), 0, W - 1), y0 = Math.floor(y);
  while (y0 > World.top && World.isLand(x0, y0)) y0--;
  const f = Object.create(LiquidDirt.prototype);
  f.heap = []; f.seen = new Set(); f.n = 0;
  f.push(x0, y0);
  const out = [];
  while (out.length < amount && f.heap.length) {
    const c = f.pop();
    out.push(c);
    f.push(c.x, c.y + 1); f.push(c.x - 1, c.y); f.push(c.x + 1, c.y); f.push(c.x, c.y - 1);
  }
  return out;
}
class LiquidDirt {
  constructor(x, y, amount) {
    amount = Math.max(1, Math.round(amount * Battle.multNow()));
    this.left = amount; this.t = 0; this.dur = 0.1;
    this.per = Math.max(1, Math.ceil(amount / (this.dur * 60)));
    const W = World.W;
    let x0 = clamp(Math.floor(x), 0, W - 1), y0 = Math.floor(y);
    while (y0 > World.top && World.isLand(x0, y0)) y0--;
    this.heap = []; this.seen = new Set(); this.n = 0;
    this.push(x0, y0);
    Sound.pos(x).dirt();
  }
  // max-heap on depth (y), first come first served among equals
  push(x, y) {
    const W = World.W;
    if (x < 0 || x >= W || y < World.top || y >= World.H) return;
    const i = y * W + x;
    if (this.seen.has(i) || World.land[i]) return;
    this.seen.add(i);
    const h = this.heap, e = { x, y, k: this.n++ };
    h.push(e);
    let c = h.length - 1;
    while (c > 0) { const p = (c - 1) >> 1; if (this.above(h[p], h[c])) break; [h[p], h[c]] = [h[c], h[p]]; c = p; }
  }
  above(a, b) { return a.y > b.y || (a.y === b.y && a.k < b.k); }
  pop() {
    const h = this.heap, top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < h.length && this.above(h[l], h[m])) m = l;
        if (r < h.length && this.above(h[r], h[m])) m = r;
        if (m === c) break;
        [h[m], h[c]] = [h[c], h[m]]; c = m;
      }
    }
    return top;
  }
  update(dt) {
    this.t += dt;
    const W = World.W;
    for (let k = 0; k < this.per && this.left > 0 && this.heap.length; k++) {
      const c = this.pop();
      const i = c.y * W + c.x;
      if (World.land[i]) continue;
      World.setPixel(i, World.dirtIndex(c.x, c.y));
      this.left--;
      this.push(c.x, c.y + 1); this.push(c.x - 1, c.y); this.push(c.x + 1, c.y); this.push(c.x, c.y - 1);
    }
    if (this.left <= 0 || !this.heap.length) { Battle.terrainChanged(); return false; }
    return true;
  }
  draw() {}
}

/* ------------------------------ liquids: napalm & liquid dirt ------------------------------ */
class Liquid {
  constructor(x, y, o) {
    const M = Battle.multNow();
    if (M !== 1) o = Object.assign({}, o, { amount: Math.max(1, Math.round(o.amount * M)) });
    this.o = o; this.owner = o.owner;
    this.napalm = o.napalm;
    this.parts = [];
    this.occ = new Set();
    this.toSpawn = o.amount;
    this.x = clamp(Math.floor(x), 0, World.W - 1);
    // start just above the ground where it hit
    let yy = Math.floor(y);
    while (yy > World.top && World.isLand(this.x, yy)) yy--;
    this.y = yy;
    this.phase = 'flow'; this.t = 0; this.burnT = 0;
    this.burnDur = o.napalm ? (o.hot ? 1.45 : 1.25) : 0;
    // 1.5: napalm runs downhill and fills the hollows at once (a tenth of a second), lowest first
    this.cells = o.napalm ? waterFill(this.x, this.y, o.amount) : null;
    this.seed = sirand(1, 1e9);
    this.spawnRate = o.napalm ? 400 : 700;
    this.vx = o.vx || 0;
    Sound.pos(this.x);
    if (o.napalm) Sound.crunch(0.5, 1800, 300, 0.5); else Sound.dirt();
  }
  free(x, y) {
    if (x < 0 || x >= World.W || y >= World.H) return false;
    if (y < World.top) return true;
    if (World.land[y * World.W + x]) return false;
    return !this.occ.has(y * World.W + x);
  }
  spawn(n) {
    for (let i = 0; i < n && this.toSpawn > 0; i++) {
      const splash = this.napalm ? 0.6 : 0.4;
      const p = {
        x: this.x + srand(-1, 1), y: this.y - srand(0, 2), fx: 0,
        vx: srand(-40, 40) * splash * World.W / 360 + this.vx * 0.1, vy: -srand(20, 60) * splash * World.ay,
        fly: true, side: 0, stuck: 0, dir: schance(0.5) ? 1 : -1, done: false, cx: 0, cy: 0
      };
      this.parts.push(p);
      this.toSpawn--;
    }
  }
  update(dt) {
    this.t += dt;
    if (this.phase === 'flow' && this.cells) {
      const per = Math.max(1, Math.ceil(this.cells.length / 6));
      for (let k = 0; k < per && this.cells.length; k++) {
        const c = this.cells.shift();
        this.parts.push({ x: c.x, y: c.y, cx: c.x, cy: c.y, fly: false, done: true, side: 0, stuck: 0, dir: 1 });
        this.occ.add(c.y * World.W + c.x);
      }
      this.toSpawn = 0;
      if (!this.cells.length) { this.phase = 'burn'; Sound.pos(this.x).crunch(this.burnDur * 0.8, 2600, 700, 0.35); }
      return true;
    }
    if (this.phase === 'flow') {
      if (this.toSpawn > 0) this.spawn(Math.ceil(this.spawnRate * dt));
      const g = Phys.g();
      let active = 0;
      for (const p of this.parts) {
        if (p.done) continue;
        if (p.fly) {
          p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          const ix = Math.floor(p.x), iy = Math.floor(p.y);
          if (ix < 0 || ix >= World.W) { p.done = true; p.gone = true; continue; }
          if (iy >= World.H - 1 || (iy >= World.top && !this.free(ix, iy))) {
            // land: settle into the nearest free cell above
            let yy = Math.min(iy, World.H - 1);
            while (yy > 0 && !this.free(ix, yy)) yy--;
            p.fly = false; p.cx = ix; p.cy = yy; this.occ.add(yy * World.W + ix);
          }
          active++;
          continue;
        }
        // cellular flow: down, diagonal, then sideways (limited) so pools form in hollows
        const W = World.W;
        const tryMove = (nx, ny) => {
          if (this.free(nx, ny)) {
            this.occ.delete(p.cy * W + p.cx); p.cx = nx; p.cy = ny; this.occ.add(ny * W + nx); return true;
          }
          return false;
        };
        let movedAny = false;
        const maxSide = this.napalm ? 30 : 60;
        for (let step = 0; step < 3; step++) {
          let moved = false;
          if (tryMove(p.cx, p.cy + 1)) moved = true;
          else if (tryMove(p.cx + p.dir, p.cy + 1)) moved = true;
          else if (tryMove(p.cx - p.dir, p.cy + 1)) { p.dir = -p.dir; moved = true; }
          else if (p.side < maxSide && tryMove(p.cx + p.dir, p.cy)) { p.side++; moved = true; }
          else if (p.side < maxSide && tryMove(p.cx - p.dir, p.cy)) { p.dir = -p.dir; p.side++; moved = true; }
          if (!moved) break;
          movedAny = true;
        }
        // a drop only comes to rest after it has been stuck for a while (others may move out of its way)
        if (movedAny) { p.stuck = 0; active++; }
        else if (++p.stuck > 25) p.done = true;
        else active++;
      }
      if (this.toSpawn <= 0 && (active === 0 || this.t > 6)) {
        if (this.napalm) { this.phase = 'burn'; Sound.pos(this.x).crunch(this.burnDur * 0.8, 2600, 700, 0.35); }
        else { this.solidify(); return false; }
      }
    } else if (this.phase === 'burn') {
      this.burnT += dt;
      // heat damage: deep pools next to a tank burn hottest
      const heat = this.o.heat;
      for (const t of Battle.tanks) {
        if (!t.alive) continue;
        let n = 0;
        for (const p of this.parts) {
          if (p.gone) continue;
          const dx = Math.abs(p.cx - t.x), dy = (t.y - p.cy) / World.ay;
          if (dx < t.w / 2 + 3 && dy > -4 && dy < t.hh / World.ay + 5) n++;
        }
        if (n > 0) Battle.damage(t, n * heat * 0.55 * dt, this.owner, { secondary: true, burn: true });
      }
      if (this.burnT >= this.burnDur) {
        for (const p of this.parts) if (!p.gone && chance(0.35)) World.scorch(p.cx, p.cy + 1, 1.5, 0.55);
        return false;
      }
    }
    return true;
  }
  solidify() {
    for (const p of this.parts) {
      if (p.gone) continue;
      const x = p.fly ? Math.floor(p.x) : p.cx, y = p.fly ? Math.floor(p.y) : p.cy;
      World.addPixel(x, y);
    }
    Battle.terrainChanged();
  }
  draw(s) {
    const burning = this.phase === 'burn';
    const tt = Math.floor(performance.now() / 70);
    const hot = this.o.hot;
    for (const p of this.parts) {
      if (p.gone) continue;
      const x = Math.floor(p.fly ? p.x : p.cx), y = Math.floor(p.fly ? p.y : p.cy);
      if (!this.napalm) { s.pset(x, y, vga(38, 24, 10)); continue; }
      if (!burning) { s.pset(x, y, vga(63, 12, 8)); continue; }   // 1.5: a red film the moment it lands
      s.pset(x, y, vga(63, 12, 8));
      if (hash2(x >> 2, y >> 2, this.seed) > 0.55) continue;
      // a flickering tongue of flame above the burning patches
      const life = clamp(1 - this.burnT / this.burnDur, 0, 1);
      const hgt = Math.max(1, Math.floor((2 + hash2(x, tt, 7) * (hot ? 10 : 7)) * (0.3 + 0.7 * life) * World.ay));
      for (let k = 0; k < hgt; k++) {
        const f = k / hgt;
        let idx = 7 - Math.floor(f * 6.5) - (hash2(x, k, tt) < 0.3 ? 1 : 0);
        if (!hot) idx = Math.min(idx, 6);
        const jx = f > 0.6 && hash2(x, tt, k) < 0.4 ? (hash2(k, x, tt) < 0.5 ? -1 : 1) : 0;
        s.pset(x + jx, y - k, FIRE[clamp(idx, 1, 7)]);
      }
    }
  }
}

/* ------------------------------ dirt charge spray ------------------------------ */
// Dirt Charge (1.5, measured from a recording): an upside-down cone of loose dirt opens upward
// from where it lands - about 41 degrees each side of vertical, half its cells filled - then hangs
// a moment and falls as ordinary dirt
class DirtSpray {
  constructor(x, y, r, spread, mult) {
    r *= Math.sqrt(Battle.multNow());
    this.x = Math.round(x); this.y = Math.floor(World.isLand(x, y) ? y - World.ay : y);
    this.h = r;                                   // height, in columns
    this.slope = Math.tan(spread * DEG);          // half-width per column of height
    this.dens = mult > 1 ? 0.7 : 0.48;
    this.seed = sirand(1, 1e9);
    this.t = 0; this.grow = 0.55; this.hold = 0.4; this.released = false;
    Sound.pos(x).crunch(0.6, 500, 100, 0.7);
  }
  // is there dirt in the cone's cell (x, y)?
  cell(x, y) { return hash2(x, y, this.seed) < this.dens && !World.isLand(x, y); }
  // rows of the cone shown so far (0..1)
  frac() { return clamp(this.t / this.grow, 0, 1); }
  each(fn) {
    const ay = World.ay, rows = Math.floor(this.h * ay * this.frac());
    for (let dy = 0; dy <= rows; dy++) {
      const y = this.y - dy;
      if (y < World.top) break;
      const hw = Math.floor(dy / ay * this.slope);
      for (let x = Math.max(0, this.x - hw); x <= Math.min(World.W - 1, this.x + hw); x++) if (this.cell(x, y)) fn(x, y);
    }
  }
  update(dt) {
    this.t += dt;
    if (!this.released && this.t >= this.grow + this.hold) {
      this.released = true;
      // the cone becomes loose dirt, and falls like any other
      this.each((x, y) => World.addPixel(x, y));
      Battle.terrainChanged();
      return false;
    }
    return true;
  }
  draw(s) {
    const W = World.W;
    this.each((x, y) => s.pset(x, y, World.pal[World.dirtIndex(x, y)]));
  }
}

/* ------------------------------ riot charge / blast ------------------------------ */
// Riot Charge / Blast (a wedge from the tank) and Riot Bombs (a full circle), as 1.5 does them
// (measured from recordings): a dark red field spreads out to full size, then a hole opens from
// the middle and sweeps outward, dissolving the dirt as it passes and leaving loose specks that
// fall once it has gone. Both stages take time in proportion to the area they cover.
class RiotWedge {
  constructor(x, y, r, a0, a1) {
    r *= Math.sqrt(Battle.multNow());
    this.x = x; this.y = y; this.r = r; this.a0 = a0; this.a1 = a1;
    this.full = a1 - a0 >= 359;
    const area = r * r * (this.full ? 360 : a1 - a0);
    this.growT = Math.max(0.08, area / 1.45e6);
    this.sweepT = Math.max(0.12, area / 0.95e6);
    this.t = 0; this.done = 0; this.seed = sirand(1, 1e9);
    Sound.pos(this.x).crunch(0.45 + this.growT * 0.5, 1600, 300, 0.7);
  }
  outer() { return this.r * clamp(this.t / this.growT, 0, 1); }
  inner() { return this.r * clamp((this.t - this.growT) / this.sweepT, 0, 1); }
  update(dt) {
    this.t += dt;
    const rr = this.inner();
    if (rr > this.done + 0.5 || (rr >= this.r && this.done < this.r)) {
      World.carveSector(this.x, this.y, rr, this.a0, this.a1, Math.max(0, this.done - 1), true, 0.06, this.seed, this.full);
      this.done = rr;
    }
    if (this.t >= this.growT + this.sweepT) {
      World.markUnstable(this.x - this.r - 1, this.x + this.r + 1);
      Battle.terrainChanged();
      return false;
    }
    return true;
  }
  inside(x, y) {
    const dx = x - this.x, dy = (this.y - y) / World.ay, d = Math.hypot(dx, dy);
    if (d > this.outer() || d < this.inner()) return -1;
    if (!this.full && !angleIn(Math.atan2(dy, dx) / DEG, this.a0, this.a1)) return -1;
    return d;
  }
  draw(s) {
    const R = this.outer(), ay = World.ay;
    if (R < 0.5) return;
    const x0 = Math.max(0, Math.floor(this.x - R)), x1 = Math.min(World.W - 1, Math.ceil(this.x + R));
    const y0 = Math.max(0, Math.floor(this.y - R * ay)), y1 = Math.min(World.H - 1, Math.ceil(this.y + R * ay));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = this.inside(x, y);
        if (d < 0) continue;
        // dark red, combed with darker arcs
        const dark = (Math.floor(d * 1.3) % 3 === 0) && hash2(x, y, this.seed) < 0.55;
        s.buf[y * s.w + x] = dark ? vga(22, 7, 9) : vga(39, 14, 15);
      }
    }
  }
}

/* ------------------------------ energy weapons ------------------------------ */
class LaserBeam {
  constructor(tank, batteries) {
    this.tank = tank; this.b = batteries; this.t = 0; this.dur = 0.7 + batteries * 0.05;
    const m = tank.muzzle(0);
    this.x0 = m.x; this.y0 = m.y;
    const a = tank.angle * DEG, dx = Math.cos(a), dy = -Math.sin(a) * World.ay;
    // trace the beam until it leaves the screen or hits a Super Mag
    let x = m.x, y = m.y, stop = null;
    this.hitTanks = [];
    for (let i = 0; i < 4000; i++) {
      x += dx * 0.7; y += dy * 0.7;
      if (x < 0 || x >= World.W || y < 0 || y >= World.H) break;
      for (const t of Battle.tanks) {
        if (!t.alive || t === tank) continue;
        if (t.shield && t.shield.it.laserProof && t.inShield(x, y)) { stop = t; break; }
        if (t.contains(x, y, 1) && !this.hitTanks.includes(t)) this.hitTanks.push(t);
      }
      if (stop) break;
    }
    this.x1 = x; this.y1 = y;
    this.width = 1 + Math.floor(batteries / 3);
    this.cut = false;
    Sound.pos(this.x0).laser();
  }
  update(dt) {
    this.t += dt;
    if (!this.cut && this.t > 0.15) {
      this.cut = true;
      const n = Math.ceil(Math.hypot(this.x1 - this.x0, (this.y1 - this.y0) / World.ay));
      for (let i = 0; i <= n; i++) {
        const x = lerp(this.x0, this.x1, i / n), y = lerp(this.y0, this.y1, i / n);
        World.carveEllipse(x, y, this.width / 2 + 0.4, (this.width / 2 + 0.4) * World.ay);
      }
      const dmg = 12 + this.b * 11;
      for (const t of this.hitTanks) Battle.damage(t, dmg, this.tank, { primary: true, laser: true });
      Battle.terrainChanged();
    }
    return this.t < this.dur;
  }
  draw(s) {
    const flick = Math.floor(this.t * 30) & 1;
    const n = Math.ceil(Math.hypot(this.x1 - this.x0, this.y1 - this.y0));
    const w = this.width + 1;
    for (let i = 0; i <= n; i++) {
      const x = lerp(this.x0, this.x1, i / n), y = lerp(this.y0, this.y1, i / n);
      for (let k = -w; k <= w; k++) {
        const c = Math.abs(k) <= this.width / 2 ? vga(63, 63, 63) : (flick ? vga(63, 10, 10) : vga(63, 30, 50));
        if (Math.abs(Math.cos(this.tank.angle * DEG)) > 0.7) s.pset(x, y + k, c); else s.pset(x + k, y, c);
      }
    }
  }
}
// Plasma Blast (1.5, measured from a recording): a solid red disc swells around the tank behind the
// land - about 21 pixels of radius with no batteries at Normal scale, more with each one - fading bright to
// black and back as it grows, then pulsing quickly before it vanishes. Tanks it reaches are hit.
class PlasmaBlast {
  constructor(tank, batteries) {
    this.tank = tank; this.b = batteries; this.t = 0;
    this.R = (21 + batteries * 4) * scaleFactor();
    this.dmg = 35 + batteries * 18;
    this.grow = 3.7; this.dur = this.grow + 2.2;
    this.x = tank.cx; this.y = tank.cy;
    this.hit = new Set();
    Sound.pos(this.x).plasma();
  }
  radius() { return this.R * Math.pow(clamp(this.t / this.grow, 0, 1), 0.47); }
  // brightness 0..1: up, down to black and slowly back while it grows; then fast pulses
  bright() {
    const t = this.t;
    if (t < 0.3) return t / 0.3;
    if (t < 1.4) return 1 - (t - 0.3) / 1.1;
    if (t < this.grow) return (t - 1.4) / (this.grow - 1.4);
    const p = ((t - this.grow) / 0.66) % 1;
    return p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
  }
  update(dt) {
    this.t += dt;
    const r = this.radius();
    for (const t of Battle.tanks) {
      if (!t.alive || t === this.tank || this.hit.has(t)) continue;
      const d = adist(this.x, this.y, t.cx, t.cy);
      if (d < r + t.w / 2) {
        this.hit.add(t);
        Battle.damage(t, this.dmg * (1 - d / (this.R + t.w / 2) * 0.6), this.tank, { primary: true });
      }
    }
    return this.t < this.dur;
  }
  draw(s) {
    const r = this.radius(), v = this.bright(), c = vga(63 * v, 0, 4 * v);
    const W = World.W, land = World.land, ay = World.ay;
    const y0 = Math.max(0, Math.floor(this.y - r * ay)), y1 = Math.min(World.H - 1, Math.ceil(this.y + r * ay));
    for (let y = y0; y <= y1; y++) {
      const dy = (y - this.y) / ay, q = r * r - dy * dy;
      if (q < 0) continue;
      const hw = Math.sqrt(q);
      const xa = Math.max(0, Math.round(this.x - hw)), xb = Math.min(W - 1, Math.round(this.x + hw));
      for (let x = xa; x <= xb; x++) if (!land[y * W + x]) s.pset(x, y, c);
    }
  }
}

/* ------------------------------ misc effects ------------------------------ */
class Spark {
  constructor(x, y, c) { this.x = x; this.y = y; this.c = c; this.t = 0; }
  update(dt) { this.t += dt; return this.t < 0.3; }
  draw(s) {
    const r = this.t * 20;
    for (let a = 0; a < 360; a += 45) s.pset(this.x + Math.cos(a * DEG) * r, this.y - Math.sin(a * DEG) * r * World.ay, this.c);
  }
}
class Ring {
  constructor(x, y, c) { this.x = x; this.y = y; this.c = c; this.t = 0; }
  update(dt) { this.t += dt; return this.t < 0.8; }
  draw(s) { const r = this.t * World.W * 0.4; s.ellipse(this.x, this.y, r, r * World.ay, this.c); }
}
class Lightning {
  constructor(tx, owner) {
    this.t = 0;
    const gy = World.surfaceY(clamp(Math.floor(tx), 0, World.W - 1));
    const target = Battle.tanks.find(t => t.alive && Math.abs(t.x - tx) < t.w / 2 + 1);
    const endY = target ? target.cy : gy;
    // (cosmetic randomness only: where it strikes came from the host)
    const zig = (x, y, toX, toY) => {
      const pts = [[x, y]];
      while (y < toY - 3) {
        y = Math.min(toY, y + rand(5, 12) * World.ay);
        x += rand(-5, 5) + (toX - x) * 0.18;
        pts.push([x, y]);
      }
      pts.push([toX, toY]);
      return pts;
    };
    const ph = World.H - World.top, y0 = Math.min(endY - 30 * World.ay, World.top + ph * rand(0.18, 0.45));
    const trunk = zig(tx + rand(-20, 20), y0, tx + rand(-3, 3), endY);
    this.strands = [trunk];
    for (let i = 0, n = irand(2, 5); i < n; i++) {
      const p = trunk[Math.floor(trunk.length * rand(0.25, 0.75))];
      this.strands.push(zig(p[0], p[1], tx + rand(-24, 24), endY + rand(-2, 2)));
    }
    this.pts = trunk;
    this.tx = tx; this.ty = endY; this.target = target; this.done = false;
    if (Gfx.modern) { Screen.flash = 0.7; Screen.flashColor = vga(50, 50, 63); }
    Battle.skyFlash = 0.35;
    Sound.pos(tx).thunder();
  }
  update(dt) {
    this.t += dt;
    if (!this.done && this.t > 0.08) {
      this.done = true;
      const dmg = Cfg.hostileEnvironment ? 35 : 0;
      Battle.spawn(new Explosion(this.tx, this.ty, 7, { dmg, owner: null, type: 'normal' }));
    }
    return this.t < 0.45;
  }
  draw(s) {
    if (this.t > 0.22 || (Math.floor(this.t * 25) & 1)) return;
    const c = vga(63, 63, 11);
    for (const pts of this.strands) for (let i = 1; i < pts.length; i++) s.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c);
  }

}
class Meteor {
  // x and vx come from the host's weather roll so every peer sees the same rock
  constructor(x, vx) {
    this.x = x; this.y = 0; this.t = 0;
    this.vx = vx; this.vy = World.H * 0.7;
    Toast.show('Incoming meteor!');
    Sound.pos(x).meteor();
  }
  update(dt) {
    this.t += dt;
    const n = 6;
    for (let i = 0; i < n; i++) {
      this.x += this.vx * dt / n; this.y += this.vy * dt / n;
      if (this.y >= World.H - 1 || World.isLand(this.x, this.y) || Battle.tanks.some(t => t.alive && t.contains(this.x, this.y))) {
        Battle.spawn(new Explosion(this.x, Math.min(this.y, World.H - 1), 12, { dmg: Cfg.hostileEnvironment ? 45 : 0, owner: null }));
        return false;
      }
      if (this.x < 0 || this.x >= World.W) return false;
    }
    return true;
  }
  draw(s) {
    for (let k = 0; k < 10; k++) s.pset(this.x - this.vx * k * 0.004, this.y - this.vy * k * 0.004, FIRE[7 - Math.min(7, k)]);
  }
}
// emergency helicopter (model G.N.A.T.) for retreating tanks
class Chopper {
  constructor(tank) {
    this.tank = tank; this.t = 0; this.side = tank.x < World.W / 2 ? -1 : 1;
    this.x = this.side < 0 ? -20 : World.W + 20; this.y = tank.top - 30 * World.ay;
    this.phase = 0; this.blown = false;
    Sound.pos(tank.x).chopper();
  }
  update(dt) {
    this.t += dt;
    const t = this.tank;
    if (this.phase === 0) {
      this.x += (t.x - this.x) * Math.min(1, dt * 2.5);
      this.y += ((t.top - 14 * World.ay) - this.y) * Math.min(1, dt * 2.5);
      if (Math.abs(this.x - t.x) < 1.5 && this.t > 0.6) { this.phase = 1; this.t = 0; }
    } else if (this.phase === 1) {
      if (this.t > 0.5) { this.phase = 2; this.t = 0; t.retreated = true; Sound.pos(t.x).chopper(); }
    } else {
      this.y -= 90 * World.ay * dt; this.x -= this.side * 80 * dt;
      if (!this.blown && this.t > 0.5) { this.blown = true; Battle.killTank(t, null, { retreat: true }); }
      if (this.y < -40) return false;
    }
    return true;
  }
  draw(s) {
    const spr = Icons.sprites.heli;
    s.blit(spr, this.x - 6, this.y - 8, { flip: this.side > 0, sy: Math.max(1, Math.round(World.ay)) });
    if (this.phase >= 1) s.vline(this.x, this.y, this.tank.top, vga(50, 50, 50));
  }
}
