'use strict';
/* =====================================================================
   Extended arsenal (Remastered): five new weapons on top of the original
   33. Like everything that touches the battlefield they only use the
   seeded RNG, so network games stay in step. Weapons > Extended Arsenal
   turns them off for a purely classic shop.
     Air Strike     - a flare that calls in a stick of bombs
     Teleporter     - moves your tank to wherever the shot lands
     Tesla Coil     - lightning that jumps between up to three tanks
     Bunker Buster  - drills through dirt, then detonates
     EMP Blast      - knocks out shields and drains batteries nearby
   ===================================================================== */

// the bombs an air strike drops (not sold in the shop)
const AIR_BOMB = { id: 'airBomb', name: 'Air Strike', kind: 'missile', cat: 'W', r: 16, dmg: 80, airBomb: true };

const Arsenal = {
  // Shot.impact() hands the new kinds over here
  impact(shot, x, y, hitTank) {
    const wp = shot.wp, o = shot.owner, sc = scaleFactor();
    switch (wp.kind) {
      case 'airstrike': Battle.spawn(new AirStrike(o, wp, x, y)); break;
      case 'teleport': Battle.spawn(new Teleport(o, x, y)); break;
      case 'tesla':
        Battle.spawn(new Explosion(x, y, 7 * sc, { dmg: 22, owner: o, primary: true, type: 'riot', zap: true }));
        Battle.spawn(new TeslaArc(o, wp, x, y));
        break;
      case 'buster':
        if (hitTank) Battle.spawn(new Explosion(x, y, wp.r * sc, { dmg: wp.dmg, owner: o, primary: true }));
        else Battle.spawn(new Driller(o, wp, x, y, shot.vx, shot.vy));
        break;
      case 'emp': Battle.spawn(new EmpPulse(o, wp, x, y)); break;
    }
  }
};

class AirStrike {
  constructor(owner, wp, x, y) {
    this.owner = owner; this.wp = wp; this.t = 0; this.dropped = 0; this.n = wp.n;
    this.x = clamp(x, 0, World.W - 1); this.y = y;
    this.dir = schance(0.5) ? 1 : -1;
    const sc = scaleFactor();
    this.xs = [];
    for (let i = 0; i < this.n; i++) this.xs.push(clamp(this.x + (i - (this.n - 1) / 2) * 9 * sc + srand(-2, 2), 1, World.W - 2));
    if (this.dir < 0) this.xs.reverse();
    Sound.pos(this.x).seq([[880, 0.12], [660, 0.12], [880, 0.12], [660, 0.12]], 0.35);
  }
  update(dt) {
    this.t += dt;
    const sc = scaleFactor();
    while (this.dropped < this.n && this.t >= 0.8 + this.dropped * 0.13) {
      const bx = this.xs[this.dropped];
      Battle.spawn(new Shot({
        owner: this.owner, wp: AIR_BOMB, x: bx, y: this.altitude(bx),
        vx: this.dir * 10, vy: 30 * World.ay, r: AIR_BOMB.r * sc, dmg: AIR_BOMB.dmg
      }));
      this.dropped++;
    }
    return this.dropped < this.n || this.t < 0.8 + this.n * 0.13 + 0.4;
  }
  // bombs leave the plane below the status line (and under a cavern's roof)
  altitude(x) {
    const y = World.top + 16 * World.ay;
    return World.cavern ? Math.max(y, World.ceil[clamp(Math.floor(x), 0, World.W - 1)] + 3 * World.ay) : y;
  }
  draw(s) {
    // the flare smoke marking the target
    if (this.t < 1.6 && (Math.floor(this.t * 10) & 1)) s.pset(this.x, this.y - 2, vga(63, 10, 10));
  }
}

class Teleport {
  constructor(owner, x, y) {
    this.owner = owner; this.t = 0; this.done = false;
    this.fromX = owner.x; this.fromY = owner.cy;
    const half = Math.ceil(owner.w / 2) + 2;
    let tx = clamp(Math.round(x), half, World.W - half - 1);
    // don't land on top of another tank
    const clear = c => Battle.tanks.every(o => o === owner || !o.alive || Math.abs(o.x - c) >= (o.w + owner.w) / 2 + 1);
    for (let k = 1; k < 60 && !clear(tx); k++) {
      const c = clamp(Math.round(x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2, half, World.W - half - 1);
      if (clear(c)) { tx = c; break; }
    }
    this.tx = tx;
    this.ty = this.landing(tx);
    Sound.pos(owner.x).sweep(300, 2400, 0.35, 0.5);
  }
  landing(x) {
    let y = World.H;
    for (let c = x - 3; c <= x + 3; c++) y = Math.min(y, World.surfaceY(clamp(c, 0, World.W - 1)));
    return y;
  }
  update(dt) {
    this.t += dt;
    if (!this.done && this.t >= 0.35) {
      this.done = true;
      const t = this.owner;
      if (t.alive && !t.dying) {
        t.x = this.tx;
        t.y = this.landing(this.tx);
        t.falling = false;
        Sound.pos(this.tx).sweep(2400, 400, 0.25, 0.5);
      }
    }
    return this.t < 0.9;
  }
  draw(s) {
    const c = vga(40, 63, 63);
    for (let k = 0; k < 6; k++) {
      const a = this.t * 12 + k;
      if (!this.done) s.pset(this.fromX + Math.cos(a) * 6, this.fromY - Math.abs(Math.sin(a)) * 10 * World.ay, c);
      s.pset(this.tx + Math.cos(a) * 6, this.ty - 4 * World.ay - Math.abs(Math.sin(a)) * 10 * World.ay, c);
    }
  }
}

class TeslaArc {
  constructor(owner, wp, x, y) {
    this.owner = owner; this.wp = wp; this.x = x; this.y = y; this.t = 0;
    this.chain = [];
    const R = wp.r * scaleFactor(), hit = new Set();
    let fx = x, fy = y;
    for (let i = 0; i < wp.dmgs.length; i++) {
      let best = null, bd = Infinity;
      for (const t of Battle.tanks) {
        if (!t.alive || t.dying || t === owner || hit.has(t)) continue;
        const d = adist(fx, fy, t.cx, t.cy);
        if (d < (i === 0 ? R : R * 0.85) && d < bd) { bd = d; best = t; }
      }
      if (!best) break;
      hit.add(best);
      this.chain.push({ tank: best, fx, fy, tx: best.cx, ty: best.cy, dmg: wp.dmgs[i], at: 0.1 + i * 0.22, done: false });
      fx = best.cx; fy = best.cy;
    }
    this.end = this.chain.length ? this.chain[this.chain.length - 1].at + 0.35 : 0.45;
    Sound.pos(x).zap();
  }
  update(dt) {
    this.t += dt;
    for (const c of this.chain) {
      if (c.done || this.t < c.at) continue;
      c.done = true;
      if (c.tank.alive && !c.tank.dying) { Battle.damage(c.tank, c.dmg, this.owner, { primary: true }); Sound.pos(c.tank.x).zap(); }
    }
    return this.t < this.end;
  }
  draw(s) {
    for (const c of this.chain) {
      if (this.t < c.at - 0.06 || this.t > c.at + 0.25) continue;
      const n = 8;
      let px = c.fx, py = c.fy;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const x = lerp(c.fx, c.tx, k) + (i < n ? (hash2(i, Math.floor(this.t * 30), 3) - 0.5) * 8 : 0);
        const y = lerp(c.fy, c.ty, k) + (i < n ? (hash2(i, Math.floor(this.t * 30), 9) - 0.5) * 8 * World.ay : 0);
        s.line(px, py, x, y, vga(40, 50, 63));
        px = x; py = y;
      }
    }
  }
}

class Driller {
  constructor(owner, wp, x, y, vx, vy) {
    this.owner = owner; this.wp = wp; this.x = x; this.y = y; this.t = 0;
    let dx = vx, dy = vy / World.ay;
    const sp = Math.hypot(dx, dy) || 1;
    dx /= sp; dy /= sp;
    if (dy < 0.4) { dy = 0.4; const k = Math.hypot(dx, dy); dx /= k; dy /= k; }   // always heads into the ground
    this.dx = dx; this.dy = dy;
    this.dist = 0; this.len = wp.len * scaleFactor();
    this.speed = 70 * World.W / 360;
    Sound.pos(x).crunch(0.5, 420, 90, 0.6);
  }
  update(dt) {
    this.t += dt;
    let move = this.speed * dt;
    while (move > 0) {
      const st = Math.min(1, move); move -= st;
      this.x += this.dx * st; this.y += this.dy * st * World.ay;
      this.dist += st;
      if (this.x < 0 || this.x >= World.W || this.y >= World.H - 1) return this.boom();
      for (const t of Battle.tanks) if (t.alive && t !== this.owner && t.contains(this.x, this.y, 1)) return this.boom();
      World.carveEllipse(this.x, this.y, 1.3, 1.3 * World.ay);
      if (this.dist >= this.len) return this.boom();
    }
    return true;
  }
  boom() {
    this.y = Math.min(this.y, World.H - 1);
    Battle.spawn(new Explosion(this.x, this.y, this.wp.r * scaleFactor(), { dmg: this.wp.dmg, owner: this.owner, primary: true }));
    Battle.terrainChanged();
    return false;
  }
  draw(s) { s.pset(this.x, this.y, vga(63, 50, 20)); }
}

class EmpPulse {
  constructor(owner, wp, x, y) {
    this.owner = owner; this.x = x; this.y = y; this.t = 0; this.hit = false;
    this.r = wp.r * scaleFactor(); this.victims = [];
    Sound.pos(x).plasma();
  }
  update(dt) {
    this.t += dt;
    if (!this.hit && this.t >= 0.25) {
      this.hit = true;
      for (const t of Battle.tanks) {
        if (!t.alive || t.dying) continue;
        if (adist(this.x, this.y, t.cx, t.cy) > this.r + t.w / 2) continue;
        let hurt = false;
        if (t.shield) { this.victims.push({ tank: t, color: t.shield.it.color }); t.shield = null; hurt = true; }
        const b = t.p.inv.battery || 0;
        if (b > 0) { t.p.inv.battery = Math.max(0, b - 2); hurt = true; }
        if (hurt) t.fx = { k: 'dark', t: 0.4 };
      }
      Sound.pos(this.x).sweep(1400, 90, 0.45, 0.6);
    }
    return this.t < 0.9;
  }
  draw(s) {
    const r = this.r * clamp(this.t / 0.3, 0, 1);
    if (this.t < 0.6) s.ellipse(this.x, this.y, r, r * World.ay, vga(20, 40, 63));
  }
}
