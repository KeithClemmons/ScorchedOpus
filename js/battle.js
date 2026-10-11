'use strict';
/* =====================================================================
   Battle: one round of play.

   The battlefield is a deterministic simulation advanced in fixed ticks
   (simTick). Everything that changes it is a command, applied by exec().
   The turn logic (control) runs on the host - or on the only machine when
   playing offline - and issues commands through act(); in a network game
   every peer replays the same command stream, so every screen shows the
   same battle. Aiming (turret and power) is local until the shot is fired;
   other players see it live through presence.
   ===================================================================== */

const TICK = 1 / 60;
const KEY_CCW = 1, KEY_CW = 2, KEY_UP = 4, KEY_DOWN = 8;
const ONLINE_KEYS = { ccw: 'arrowleft', cw: 'arrowright', up: 'arrowup', down: 'arrowdown', fire: 'space', weapon: 'tab' };
const WALL_COLORS = {
  NONE: vga(32, 32, 32), CONCRETE: vga(63, 63, 63), PADDED: vga(10, 50, 10),
  RUBBER: vga(56, 8, 8), SPRING: vga(10, 54, 60), WRAP: vga(60, 60, 10)
};
const WALL_TYPES = ['NONE', 'CONCRETE', 'PADDED', 'RUBBER', 'SPRING', 'WRAP'];
const SCORE = {
  STANDARD: { dmg: 30, kill: 2000, survive: 5000 },
  GREEDY: { dmg: 30, kill: 2000, survive: 5000 },
  BASIC: { dmg: 0, kill: 5000, survive: 5000 }
};

const Battle = {
  tanks: [], entities: [], balloons: [], deaths: [], dyingNow: null,
  wind: 0, walls: 'NONE', mode: 'SEQUENTIAL', state: 'idle', t: 0,
  order: [], turnIdx: -1, cur: null, plan: null, statusH: 12, hud: [],
  lastShooter: null, massKilled: false, hold: null, keyHold: {},
  syncWait: new Set(), syncShots: [], adWait: new Set(), turnCount: 0,
  tick: 0, acc: 0, params: null, waitHost: false, pendingMass: false, pendingTurn: null,
  deferred: [], pendingAI: [], localKeys: {}, keySentT: {}, aiT: 0, aiThink: 0, yourTurnT: 0,

  /* =================================================== round setup */
  // the host's (or solo player's) decisions for a new round
  makeParams() {
    let sky = Cfg.sky;
    if (sky === 'RANDOM') sky = pick(['PLAIN', 'STORMY', 'STARS', 'SHADED', 'SUNSET', 'CAVERN', 'SHADED', 'STARS']);
    const walls = (Cfg.effectOfWalls === 'RANDOM' || Cfg.effectOfWalls === 'ERRATIC') ? pick(WALL_TYPES) : Cfg.effectOfWalls;
    return { seed: irand(1, 0x7ffffff0), sky, walls, wind: this.rollWind(null) };
  },
  rollWind(prev) {
    const mx = Cfg.maxWind;
    if (mx === 0) return 0;
    if (prev === null) {
      const r = Math.random();
      return Math.round((chance(0.5) ? 1 : -1) * r * r * mx * (chance(0.1) ? 0 : 1));
    }
    if (!Cfg.changingWind) return prev;
    return Math.round(clamp(prev + rand(-1, 1) * Math.max(3, mx * 0.12), -mx, mx));
  },
  rollWeather() {
    if (!Cfg.hostileEnvironment) return null;
    if (World.skyType === 'STORMY' && chance(0.3)) {
      const al = this.alive();
      const tgt = chance(0.4) && al.length ? pick(al) : null;
      return { kind: 'lightning', x: Math.round(tgt ? tgt.x : rand(10, World.W - 10)) };
    }
    if (World.skyType === 'STARS' && chance(0.06)) {
      return { kind: 'meteor', x: Math.round(rand(0, World.W)), vx: Math.round(rand(-1, 1) * World.W * 0.15) };
    }
    return null;
  },
  start(params) {
    params = params || this.makeParams();
    UI.clear();
    this.params = params;
    this.mode = Cfg.mode;
    this.statusH = Cfg.statusBar ? 23 : 12;
    SR.seed(params.seed);
    World.init(Screen.W, Screen.H, this.statusH * Screen.UY);
    World.generate(params.sky);
    this.walls = params.walls;
    this.wind = params.wind;
    this.entities = []; this.balloons = []; this.deaths = []; this.dyingNow = null;
    this.tanks = Game.players.map(p => new Tank(p));
    this.placeTanks();
    this.orderTanks();
    this.turnIdx = -1; this.cur = null; this.plan = null; this.pendingTurn = null;
    this.syncWait = new Set(); this.syncShots = []; this.adWait = new Set(); this.hold = null;
    this.lastShooter = null; this.massKilled = false; this.turnCount = 0; this.pendingMass = false;
    this.deferred = []; this.pendingAI = []; this.localKeys = {}; this.keySentT = {};
    this.waitHost = false; this.acc = 0; this.yourTurnT = 0;
    this.state = 'intro'; this.t = 0.5;
    this.slowmo = 0; this.slowmoDone = false;
    for (const t of this.tanks) {
      t.angle = t.x < World.W / 2 ? sirand(40, 70) : sirand(110, 140);
      t.power = Math.min(t.maxPower, t.p.lastPower || 200);   // 1.5 starts at 200
      if (!Game.has(t.p, t.p.weapon)) t.p.weapon = 'babyMissile';
      if (t.p.aiMem) { t.p.aiMem.simPlan = null; t.p.aiMem.simWait = undefined; }
    }
    Sound.flightStop();
  },

  placeTanks() {
    const n = this.tanks.length, W = World.W, margin = 10;
    const slot = (W - margin * 2) / n;
    const order = sshuffle(this.tanks.slice());
    order.forEach((t, i) => {
      let x = margin + (i + 0.5) * slot + srand(-0.22, 0.22) * slot;
      x = Math.round(clamp(x, t.w / 2 + 2, W - t.w / 2 - 3));
      t.x = x;
      this.flattenUnder(t);
    });
  },
  flattenUnder(t) {
    const W = World.W, half = Math.ceil(t.w / 2) + 1;
    let y0 = World.surfaceY(t.x);
    // average the footprint so tanks don't perch on needles
    let sum = 0, k = 0;
    for (let c = t.x - half; c <= t.x + half; c++) { if (c >= 0 && c < W) { sum += World.surfaceY(c); k++; } }
    y0 = Math.round((y0 + sum / Math.max(1, k)) / 2);
    y0 = clamp(y0, World.top + t.hh + 4, World.H - 1);
    for (let c = t.x - half; c <= t.x + half; c++) {
      if (c < 0 || c >= W) continue;
      for (let y = y0 - t.hh - 3; y < y0; y++) if (y >= World.top) World.clearPixel(y * W + c);
      for (let y = y0; y < World.H; y++) {
        const i = y * W + c;
        if (World.land[i]) break;
        World.setPixel(i, World.scanned ? World.scannedIndex(c, y, y0, 0, -1) : World.dirtIndex(c, y));
      }
    }
    t.y = y0;
  },
  orderTanks() {
    const ts = this.tanks.slice();
    switch (Cfg.playOrder) {
      case 'LOSERS-FIRST': ts.sort((a, b) => Game.rankValue(a.p) - Game.rankValue(b.p)); break;
      case 'WINNERS-FIRST': ts.sort((a, b) => Game.rankValue(b.p) - Game.rankValue(a.p)); break;
      case 'ROUND-ROBIN': {
        ts.sort((a, b) => a.p.idx - b.p.idx);
        const k = (Game.round - 1) % ts.length;
        this.order = ts.slice(k).concat(ts.slice(0, k));
        return;
      }
      default: sshuffle(ts);
    }
    this.order = ts;
  },

  /* =================================================== helpers */
  alive() { return this.tanks.filter(t => t.alive && !t.dying); },
  teamsOn() { return Cfg.teams !== 'NONE'; },
  freeForAll() {
    if (!this.teamsOn()) return true;
    if (Cfg.teams !== 'VICIOUS') return false;
    const teams = new Set(this.alive().map(t => t.p.team));
    return teams.size <= 1;
  },
  sameTeam(a, b) {
    if (a === b) return true;
    if (!this.teamsOn() || this.freeForAll()) return false;
    return a.p.team === b.p.team;
  },
  humansAlive() { return this.tanks.some(t => t.alive && !t.p.ai); },
  speed() {
    const base = (Cfg.fastComputers && !this.humansAlive()) ? 3 : 1;
    return this.slowmo > 0 ? base * 0.3 : base;   // Remastered: the round-deciding blast in slow motion
  },
  timeScale() {
    const d = Cfg.firingDelay;
    return clamp(130 / Math.max(4, d), 0.25, 30);
  },
  spawn(e) { this.entities.push(e); EventLog.spawned(e); return e; },
  terrainChanged() { /* dirt settles and tanks fall in simTick() */ },
  buried(t) {
    for (const a of [45, 90, 135]) {
      const m = t.muzzle(0, a);
      if (!World.isLand(m.x, m.y)) return false;
    }
    return true;
  },
  tanksByX() { return this.alive().sort((a, b) => a.x - b.x); },
  projectileBusy(t) {
    return this.entities.some(e => e.owner === t && (e instanceof Shot || e instanceof Bomblet || e instanceof Roller || e instanceof Tunneler || e instanceof Liquid || e instanceof DirtSpray));
  },
  settled() {
    return this.entities.length === 0 && !World.needsSettle() && !this.tanks.some(t => t.falling && t.alive && !t.dying) && this.deaths.length === 0 && !this.dyingNow;
  },
  // is this tank steered from this machine?
  isLocal(t) { return !!t && !t.p.ai && (!Net.online || t.p.owner === Net.me); },
  canControl(t, peer) {
    if (!t || t.p.ai) return false;
    return Net.online ? t.p.owner === peer : true;
  },
  keysFor(t) { return Net.online ? ONLINE_KEYS : (t.p.keys || {}); },
  // the tank this machine is aiming right now, if any
  aimTank() {
    if (this.mode === 'SYNCHRONOUS') {
      if (this.state !== 'syncaim') return null;
      for (const t of this.order) if (t.alive && !t.dying && this.syncWait.has(t.p.idx) && this.isLocal(t)) return t;
      return null;
    }
    if (this.mode === 'SIMULTANEOUS') return null;
    const t = this.cur;
    return (this.state === 'human' && this.isLocal(t) && t.alive && !t.dying) ? t : null;
  },
  hudTank() {
    if (this.mode === 'SYNCHRONOUS' && this.state === 'syncaim') return this.aimTank();
    return this.cur;
  },
  nextOwned(list, cur) {
    const i = list.indexOf(cur);
    return list[(i + 1) % list.length];
  },
  nextShieldId(t) { return this.nextOwned([null].concat(Data.shields.filter(s => (t.p.inv[s.id] || 0) > 0).map(s => s.id)), t.selShield); },
  nextGuidId(t) { return this.nextOwned([null].concat(Data.guidances.filter(g => (t.p.inv[g.id] || 0) > 0).map(g => g.id)), t.guidance); },
  nextWeaponId(t, dir) {
    const owned = Data.weapons.filter(w => Game.has(t.p, w.id));
    let i = owned.findIndex(w => w.id === t.p.weapon);
    i = (i + dir + owned.length) % owned.length;
    return owned[i].id;
  },

  /* =================================================== damage & scoring */
  award(p, pts) {
    if (!pts) return;
    p.score += pts; p.roundPts += pts;
    Game.addCash(p, pts);
  },
  scoreDamage(attacker, victim, amount) {
    if (!attacker || !attacker.p) return;
    const sc = SCORE[Cfg.scoringMode] || SCORE.STANDARD;
    if (!sc.dmg) return;
    if (attacker === victim) return;                 // only suicide itself costs you
    // paid per whole point of damage, as in 1.5 ($30 steps); fractions (a burn, a glancing
    // blast) carry over to the next hit
    const p = attacker.p, team = this.sameTeam(attacker, victim), key = team ? 'dmgCarryTeam' : 'dmgCarry';
    const total = (p[key] || 0) + amount, whole = Math.floor(total + 1e-9);
    p[key] = total - whole;
    if (whole) this.award(p, (team ? -whole : whole) * sc.dmg);
  },
  shieldHit(t, amount, attacker) {
    if (!t.shield) return;
    const dealt = Math.min(amount, Math.max(0, t.shield.energy));
    t.shield.energy -= amount;
    this.scoreDamage(attacker, t, dealt * 0.5);
    if (t.shield.energy <= 0.5) this.dropShield(t);
  },
  dropShield(t) {
    t.shield = null;
    Sound.sweep(1200, 200, 0.25, 0.6);
  },
  damage(t, amount, attacker, o) {
    o = o || {};
    if (!t.alive || t.dying || !(amount > 0)) return;
    this.noteDamage(t, amount, attacker);
    let rem = amount;
    const ownShot = attacker === t && o.primary;
    if (t.shield && !o.laser && !ownShot && !o.fall) {
      const it = t.shield.it;
      const absorb = Math.min(t.shield.energy, rem);
      t.shield.energy -= absorb; rem -= absorb;
      this.scoreDamage(attacker, t, absorb * 0.8);
      const frac = t.shield.energy / it.strength;
      if (t.shield.energy <= 0.5) this.dropShield(t);
      else if (!it.noFail && !o.burn && schance(0.02 + 0.12 * (1 - frac))) {
        this.dropShield(t);
        this.say(t, 'Shields failing!', 1.5);
      }
    }
    if (rem <= 0) return;
    const dealt = Math.min(rem, t.energy);           // overkill isn't paid for
    t.energy = Math.max(0, t.energy - rem);
    t.hitFlash = 0.25;
    if (attacker && attacker.p && attacker !== t) t.attackers[attacker.p.idx] = (t.attackers[attacker.p.idx] || 0) + dealt;
    this.scoreDamage(attacker, t, dealt);
    if (t.power > t.maxPower) t.power = t.maxPower;
    if (t.energy <= 0.5) this.killTank(t, attacker, o);
    else if (this.mode === 'SIMULTANEOUS' && t.energy < 91 && (t.p.inv.battery || 0) > 0) {
      while (t.energy < 91 && (t.p.inv.battery || 0) > 0) this.useBattery(t, true);
      t.fx = { k: 'green', t: 0.3 };
    }
  },
  noteDamage(t, amount, attacker) {
    const st = attacker && attacker.p && attacker.p.stats;
    if (!st) return;
    const dealt = Math.min(amount, t.energy + (t.shield ? t.shield.energy : 0));
    if (attacker === t) { st.selfDmg += dealt; return; }
    st.dmg += dealt;
    st.bestHit = Math.max(st.bestHit, dealt);
    if (attacker.hitSeq !== attacker.shotSeq) { attacker.hitSeq = attacker.shotSeq; st.hits++; }
  },
  // explosion damage to every tank in range
  blast(x, y, r, dmg, owner, o) {
    for (const t of this.tanks) {
      if (!t.alive || t.dying) continue;
      const d = adist(x, y, t.cx, t.cy);
      const reach = r + t.w / 2;
      if (d >= reach) continue;
      const f = 1 - d / reach;
      this.damage(t, dmg * (0.25 + 0.75 * f) * f, owner, o);
    }
  },
  killTank(t, killer, o) {
    o = o || {};
    if (!t.alive || t.dying) return;
    t.dying = true;
    t.energy = 0;
    t.killer = killer;
    t.falling = false; t.chute = false;   // blown up in mid-air: it goes up where it is
    const sc = SCORE[Cfg.scoringMode] || SCORE.STANDARD;
    if (!o.retreat && !o.mass) {
      if (killer && killer.p) {
        if (killer === t) { this.award(t.p, -sc.kill * 1.5); }
        else if (this.sameTeam(killer, t)) this.award(killer.p, -sc.kill);
        else {
          this.award(killer.p, sc.kill); killer.p.kills++;
          if (killer.p.stats) { killer.p.stats.kills++; killer.p.stats.longest = Math.max(killer.p.stats.longest, adist(killer.x, killer.y, t.x, t.y)); }
        }
      }
    }
    t.p.deaths++;
    // the last enemy falls: savour it (display speed only, never the outcome)
    if (Gfx.modern && Cfg.slowMotion && !o.mass && !o.retreat && !this.slowmoDone && this.checkRoundOver()) { this.slowmo = 1.6; this.slowmoDone = true; }
    if (o.retreat) { this.deaths.unshift(t); t.silent = true; }
    else this.deaths.push(t);
  },
  processDeaths(dt) {
    if (this.dyingNow) {
      const d = this.dyingNow;
      d.t -= dt;
      d.tank.flash = 1;
      if (d.t <= 0) {
        const t = d.tank;
        t.alive = false;
        this.dyingNow = null;
        this.deathBlast(t);
      }
      return;
    }
    if (!this.deaths.length) return;
    // let the current blast finish before the next tank goes up
    if (this.entities.some(e => e instanceof Explosion && !e.carved)) return;
    const t = this.deaths.shift();
    if (!t.silent) this.talk(t, 'die');
    this.dyingNow = { tank: t, t: t.silent ? 0.05 : 0.9 };
  },

  // as in 1.5, a tank goes out with a random bang: usually a plain blast, sometimes a big one,
  // a blast and then a bigger one, a funky bomb, a beam of light, a geyser of dirt or a burst
  // of flame (all from the shared generator, so every peer agrees)
  // the classic look's ground color for this round (cosmetic: from the terrain seed)
  flatLand() { return World.scanned ? vga(40, 26, 12) : World.cavern ? vga(53, 53, 47) : (World.seed >>> 3) & 1 ? vga(20, 63, 20) : vga(9, 35, 9); },
  deathBlast(t) {
    const sc = scaleFactor(), owner = t.killer && t.killer !== t ? t.killer : null;
    const roll = t.silent ? 0 : srand(0, 1);
    Sound.pos(t.x).bigBoom();
    if (roll < 0.44) {
      const r = srand(15, 32) * sc;
      this.spawn(new Explosion(t.cx, t.cy, r, { dmg: t.silent ? 20 : r * 2.4, owner, type: 'tank' }));
    } else if (roll < 0.56) {
      const r = srand(40, 55) * sc;
      this.spawn(new Explosion(t.cx, t.cy, r, { dmg: r * 2, owner, type: 'tank' }));
    } else if (roll < 0.64) {
      // a blast, then a second, bigger fireball
      const r = srand(15, 25) * sc, r2 = srand(38, 46) * sc, x = t.cx, y = t.cy;
      this.spawn(new Explosion(x, y, r, { dmg: r * 2.4, owner, type: 'tank' }));
      this.spawn(new Delayed(0.6, () => { this.spawn(new Explosion(x, y, r2, { dmg: r2 * 2, owner, type: 'tank' })); Sound.pos(x).bigBoom(); }));
    } else if (roll < 0.74) {
      const R = 80 * sc, n = sirand(6, 10);
      this.spawn(new Explosion(t.cx, t.cy, 14 * sc, { dmg: 45, owner, type: 'funky', color: vgaq(hsl(srand(0, 360), 1, 0.55)) }));
      for (let i = 0; i < n; i++) {
        const ang = srand(20, 160) * DEG, v = Phys.vmax() * srand(0.12, 0.3) * Math.sqrt(R / 80);
        this.spawn(new Bomblet(owner, t.cx, t.cy - 2 * World.ay, Math.cos(ang) * v, -Math.sin(ang) * v * World.ay, srand(12, 20) * sc, 80, t.cx, R));
      }
    } else if (roll < 0.83) {
      // a beam of light straight up
      this.spawn(new Explosion(t.cx, t.cy, 8 * sc, { dmg: 0, owner, type: 'tank' }));
      this.spawn(new DeathBeam(t.x, t.y - 1));
    } else if (roll < 0.92) {
      // a geyser of dirt that rains back down
      this.spawn(new Explosion(t.cx, t.cy, 10 * sc, { dmg: 25, owner, type: 'tank' }));
      this.spawn(new DirtGeyser(t.x, t.y - 2, Math.round(520 * sc)));
    } else {
      this.spawn(new Explosion(t.cx, t.cy, 12 * sc, { dmg: 30, owner, type: 'tank' }));
      this.spawn(new Liquid(t.x, t.y - 1, { owner, napalm: true, amount: 70, heat: 1, hot: false, vx: 0 }));
    }
  },

  /* =================================================== falling tanks */
  fallDamage(dist) { return Math.max(0, dist - 3) * 0.9; },
  restingOnTank(t) {
    for (const o of this.tanks) {
      if (o === t || !o.alive || o.falling) continue;
      if (Math.abs(o.top - t.y) <= 1 && Math.abs(o.x - t.x) < (o.w + t.w) / 2 - 3) return o;
    }
    return null;
  },
  updateFalling(dt) {
    if (!Cfg.tanksFall) return;
    const d = Cfg.fallingDelay;
    const base = d <= 0 ? 1e5 : (1100 / d) * (World.H / 480);
    for (const t of this.tanks) {
      if (!t.alive || t.dying) continue;
      if (!t.falling) {
        if (t.supported() || this.restingOnTank(t)) continue;
        t.falling = true; t.fallFrom = t.y; t.fallAcc = 0; t.chute = false;
        const dist = (t.landingY() - t.y) / World.ay;
        const pred = this.fallDamage(dist);
        const p = t.p;
        if ((p.para.deployed || this.mode === 'SIMULTANEOUS') && (p.inv.parachute || 0) > 0 && pred > p.para.threshold) {
          t.chute = true; p.inv.parachute--; Sound.pos(t.x).parachute();
        }
      }
      t.fallAcc += (t.chute ? base * 0.28 : base) * dt;
      while (t.fallAcc >= 1 && t.falling) {
        t.fallAcc -= 1;
        const on = this.restingOnTank(t);
        if (t.supported() || on) { this.landTank(t, on); break; }
        t.y += 1;
        if (!Cfg.impactDamage && !t.chute) {
          const dd = this.fallDamage((t.y - t.fallFrom) / World.ay) - this.fallDamage((t.y - 1 - t.fallFrom) / World.ay);
          if (dd > 0) this.damage(t, dd, this.lastShooter, { fall: true });
        }
        if (t.y >= World.H) { t.y = World.H; this.landTank(t, null); break; }
      }
    }
  },
  landTank(t, onTank) {
    t.falling = false;
    const dist = (t.y - t.fallFrom) / World.ay;
    let dmg = t.chute ? 0 : this.fallDamage(dist);
    if (onTank) { dmg += 10 + dist * 0.3; this.damage(onTank, 10 + dist * 0.4, this.lastShooter, { fall: true }); }
    t.chute = false;
    if (dmg > 0 && Cfg.impactDamage) { this.damage(t, dmg, this.lastShooter === t ? t : this.lastShooter, { fall: true }); Sound.crunch(0.15, 300, 80, 0.5); }
  },

  /* =================================================== tank state changes (called from exec) */
  useBattery(t, silent) {
    const p = t.p;
    if ((p.inv.battery || 0) <= 0 || t.energy >= 100) { if (!silent) Sound.error(); return false; }
    p.inv.battery--;
    t.energy = Math.min(100, t.energy + 10);
    if (!silent) Sound.charge();
    return true;
  },
  engageShield(t) {
    const p = t.p;
    if (!t.selShield) {
      if (t.shield) { t.shield = null; Sound.sweep(800, 200, 0.2, 0.5); }
      return;
    }
    const it = Data.byId[t.selShield];
    if (!it || it.kind !== 'shield' || (p.inv[it.id] || 0) <= 0) return;
    if (t.shield && t.shield.it === it && t.shield.energy >= it.strength - 0.5) return;
    p.inv[it.id]--;
    t.shield = { it, energy: it.strength };
    Sound.sweep(300, 1500, 0.25, 0.5);
    if (this.isLocal(t) && !t.p.ai) Toast.show(it.name + ' up');
  },

  /* =================================================== firing */
  fire(t, o) {
    o = o || {};
    const p = t.p;
    let wp = Data.byId[o.weapon || p.weapon];
    if (!wp || wp.cat !== 'W' || !Game.has(p, wp.id)) wp = Data.byId.babyMissile;
    Game.consume(p, wp.id, 1);
    p.lastPower = t.power;
    this.lastShooter = t;
    if (p.stats) p.stats.shots++;
    t.shotSeq = (t.shotSeq || 0) + 1;
    // suspended dirt: rolled once per shot
    World.suspended = Cfg.suspendDirt > 0 && schance(Cfg.suspendDirt / 100);
    let guid = null;
    const gid = o.guidance !== undefined ? o.guidance : t.guidance;
    if (gid && !Data.noGuidance[wp.id] && (p.inv[gid] || 0) > 0 && this.mode !== 'SIMULTANEOUS') {
      guid = Data.byId[gid];
      p.inv[gid]--;
    }
    t.guidance = null;
    let trig = false;
    if (t.triggers && (p.inv.contactTrigger || 0) > 0 && this.mode !== 'SIMULTANEOUS') {
      trig = true; p.inv.contactTrigger--;
      if (p.inv.contactTrigger <= 0) t.triggers = false;
    }
    this.talk(t, 'attack');
    t.lastShot = { angle: t.angle, power: t.power, weapon: wp.id };
    const sc = scaleFactor();
    if (wp.kind === 'riot') { const pv = t.pivot(0); this.spawn(new RiotWedge(pv.x, pv.y, wp.r * sc, t.angle - wp.spread, t.angle + wp.spread)); return; }
    if (wp.kind === 'laser' || wp.kind === 'plasma') {
      const n = clamp(o.batteries || 0, 0, Math.min(9, p.inv.battery || 0));
      p.inv.battery = (p.inv.battery || 0) - n;
      this.spawn(wp.kind === 'laser' ? new LaserBeam(t, n) : new PlasmaBlast(t, n));
      return;
    }
    Sound.pos(t.x).fire();
    const triple = t.icon.triple && (wp.id === 'missile' || wp.id === 'babyMissile');
    const barrels = triple ? [0, 1, 2] : [0];
    for (const b of barrels) {
      const ang = t.angle + (triple ? (b - 1) * 12 : 0);
      const bi = triple ? b : 0;
      const m = t.muzzle(bi, ang);
      let power = t.power, angle = ang;
      const target = o.target || null;
      if (guid && guid.id === 'ballisticGuidance' && target && b === 0) {
        const pw = Ballistics.solvePower(m, angle, target.x, target.y, t.maxPower, { wind: this.wind });
        power = pw === null ? srand(100, t.maxPower) : pw;
      }
      if (guid && guid.id === 'lazyBoy' && target) {
        // compute a lofted arc toward the target; terminal homing does the rest
        const dir = target.x >= t.x ? 1 : -1;
        let best = null;
        for (const a0 of [70, 62, 78, 55, 84, 48]) {
          const a = dir > 0 ? a0 : 180 - a0;
          const mm = t.muzzle(bi, a);
          const pw = Ballistics.solvePower(mm, a, target.x, target.y, 1000, { wind: this.wind });
          if (pw !== null) { best = { a, pw }; break; }
        }
        if (best) { angle = best.a; power = best.pw; t.angle = angle; }
      }
      const mm = t.muzzle(bi, angle);
      const v = Phys.launch(angle, power);
      this.spawn(new Shot({
        owner: t, wp, x: mm.x, y: mm.y, vx: v.vx, vy: v.vy, guid, target, trigger: trig, main: b === 0,
        r: (wp.r || 10) * sc, dmg: wp.dmg
      }));
    }
  },
  noteImpact(shot, x) {
    if (!shot.main) return;
    const mem = shot.owner.p.aiMem;
    if (mem && mem.lastImpactX === undefined) mem.lastImpactX = x;
  },
  noteMiss(shot) {
    if (!shot.main) return;
    const mem = shot.owner.p.aiMem;
    if (mem && mem.lastImpactX === undefined) mem.lastImpactX = shot.x < 0 ? -9999 : 99999;
  },

  /* =================================================== talking tanks */
  talk(t, kind) {
    const m = Cfg.talkingTanks;
    if (m === 'OFF' || (m === 'COMPUTERS' && !t.p.ai)) return;
    // draw from the shared RNG the same way on every peer, whatever talk files each one has
    const r1 = SR.next(), r2 = SR.next();
    if (kind === 'attack' && r1 >= Cfg.talkProbability / 100) return;
    const file = String(kind === 'attack' ? Cfg.attackFile : Cfg.dieFile).toLowerCase().trim();
    const lines = Data.talkFiles[file] || Store.get('scorch.talk.' + file, null);
    if (!lines || !lines.length) return;
    const s = lines[Math.floor(r2 * lines.length)];
    if (s) this.say(t, s, kind === 'die' ? 1.6 : 2.2);
  },
  say(t, text, dur) {
    this.balloons = this.balloons.filter(b => b.tank !== t);
    this.balloons.push({ tank: t, text, t: dur || 2 });
  },

  /* =================================================== the shared simulation */
  simTick() {
    const ts = this.timeScale();
    const list = this.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const scaled = e instanceof Shot || e instanceof Bomblet || e instanceof Roller || e instanceof Tunneler || e instanceof DirtSpray;
      if (!e.update(TICK * (scaled ? ts : 1))) e._dead = true;
    }
    if (this.entities.some(e => e._dead)) this.entities = this.entities.filter(e => !e._dead);
    World.settle(Math.max(2, Math.round(4 * World.H / 480)));
    this.updateFalling(TICK);
    this.processDeaths(TICK);
    if (this.mode === 'SIMULTANEOUS') this.simSimul(TICK);
    for (const t of this.tanks) {
      t.flash = Math.max(0, t.flash - TICK); t.hitFlash = Math.max(0, t.hitFlash - TICK);
      if (t.fx && (t.fx.t -= TICK) <= 0) t.fx = null;
    }
    this.tick++;
  },
  // simultaneous mode: held keys turn turrets, computers swing theirs into place
  simSimul(dt) {
    for (const t of this.tanks) {
      if (!t.alive || t.dying) continue;
      t.busy = this.projectileBusy(t);
      const k = t.keys;
      if (k) {
        if (k & KEY_CCW) t.angle = clamp(t.angle + 60 * dt, 0, 180);
        if (k & KEY_CW) t.angle = clamp(t.angle - 60 * dt, 0, 180);
        if (k & KEY_UP) { t.power = clamp(t.power + 400 * dt, 0, t.maxPower); t.fx = { k: 'bright', t: 0.12 }; }
        if (k & KEY_DOWN) { t.power = clamp(t.power - 400 * dt, 0, t.maxPower); t.fx = { k: 'dark', t: 0.12 }; }
      }
      if (t.slew) {
        const da = t.slew.angle - t.angle, dp = Math.min(t.slew.power, t.maxPower) - t.power;
        t.angle += clamp(da, -45 * dt, 45 * dt);
        t.power += clamp(dp, -500 * dt, 500 * dt);
      }
    }
  },

  /* =================================================== commands */
  // issue a command: offline it just happens; a host also broadcasts it; a client asks the host
  act(c) {
    if (Net.isClient()) { Net.request(c); return; }
    if (Net.isHost()) { Net.hostCommand(c); return; }
    Net.dispatch(c);
  },
  // a request from this machine's player
  request(c) {
    if (Net.isClient()) { Net.request(c); return; }
    this.onRequest(Net.online ? Net.me : 'local', c);
  },
  exec(c) {
    const t = c.tank !== undefined ? this.tanks[c.tank] : null;
    const client = Net.isClient();
    switch (c.c) {
      case 'env': this.wind = c.wind; this.walls = c.walls; break;
      case 'weather':
        if (c.kind === 'lightning') this.spawn(new Lightning(c.x));
        else this.spawn(new Meteor(c.x, c.vx));
        if (client) this.state = 'weather';
        break;
      case 'turn':
        this.cur = t;
        this.waitHost = false;
        if (!t) break;
        t.flash = 0.5;
        t.power = Math.min(t.power, t.maxPower);
        if (!Game.has(t.p, t.p.weapon)) t.p.weapon = 'babyMissile';
        this.keyHold = {};
        if (Net.online && this.isLocal(t)) { this.yourTurnT = 2; Sound.seq([[784, 0.06], [1047, 0.08]], 0.35); }
        if (client) this.state = t.p.ai ? 'ai' : (this.isLocal(t) ? 'human' : 'remote');
        break;
      case 'aiaim':
        if (!t) break;
        if (Game.has(t.p, c.weapon)) t.p.weapon = c.weapon;
        t.tween = { a0: t.angle, p0: t.power, a1: c.angle, p1: c.power, t: 0, dur: c.dur || 0.6 };
        break;
      case 'fire':
        if (!t || !t.alive || t.dying) break;
        t.tween = null;
        t.angle = c.angle; t.power = Math.min(c.power, t.maxPower);
        t.guidance = c.guidance || null;
        t.triggers = !!c.triggers && (t.p.inv.contactTrigger || 0) > 0;
        if (Game.has(t.p, c.weapon)) t.p.weapon = c.weapon;   // every screen shows what was fired
        this.fire(t, { weapon: c.weapon, batteries: c.batteries || 0, target: c.target || null, guidance: c.guidance || null });
        if (!Game.has(t.p, t.p.weapon)) t.p.weapon = 'babyMissile';
        t.ready = false;
        if (t === this.cur || this.isLocal(t)) this.waitHost = false;
        if (client) this.state = 'settle';
        break;
      case 'batt': if (t) this.useBattery(t); break;
      case 'para': if (t && (t.p.inv.parachute || 0) > 0) { t.p.para.deployed = !!c.on; Sound.click(); } break;
      case 'thresh': if (t) t.p.para.threshold = clamp(c.v | 0, 1, 100); break;
      case 'selshield': if (t) { t.selShield = c.id || null; Sound.click(); } break;
      case 'shield': if (t) { t.selShield = c.id || null; this.engageShield(t); } break;
      case 'guid': if (t) { t.guidance = c.id || null; Sound.click(); } break;
      case 'trig': if (t) { t.triggers = !!c.on && (t.p.inv.contactTrigger || 0) > 0; Sound.click(); } break;
      case 'move': if (t) for (const d of c.steps || []) if (!this.moveTank(t, d < 0 ? -1 : 1)) break; break;
      case 'retreat':
        if (t && t.alive && !t.dying) this.spawn(new Chopper(t));
        if (client) this.state = 'settle';
        break;
      case 'masskill': this.massKillExec(); break;
      case 'over': if (client) this.state = 'over'; break;
      case 'autodef':
        this.adWait = new Set(c.list);
        if (client) this.state = 'autodef';
        this.openAutoDefense();
        break;
      case 'adone': this.adWait.delete(c.tank); break;
      case 'syncaim':
        this.syncWait = new Set(c.list);
        for (const tk of this.tanks) tk.ready = false;
        this.state = 'syncaim';
        this.keyHold = {}; this.waitHost = false;
        if (Net.online && this.tanks.some(tk => this.syncWait.has(tk.p.idx) && this.isLocal(tk))) { this.yourTurnT = 2; Sound.seq([[784, 0.06], [1047, 0.08]], 0.35); }
        break;
      case 'ready':
        if (!t) break;
        t.ready = true; this.syncWait.delete(c.tank);
        if (this.isLocal(t)) this.waitHost = false;
        break;
      case 'play': this.state = 'play'; break;
      case 'keys': if (t) t.keys = c.k & 15; break;
      case 'nudge':
        if (!t) break;
        t.angle = clamp(Math.round(t.angle) + (c.a || 0), 0, 180);
        t.power = clamp(Math.round(t.power) + (c.p || 0), 0, t.maxPower);
        break;
      case 'splan':
        if (!t) break;
        t.slew = { angle: c.angle, power: c.power };
        if (Game.has(t.p, c.weapon)) t.p.weapon = c.weapon;
        break;
      case 'sfire':
        if (!t || !t.alive || t.dying || t.busy) break;
        t.slew = null;
        t.angle = Math.round(t.angle); t.power = Math.round(Math.min(t.power, t.maxPower));
        this.fire(t, { batteries: c.batteries || 0 });
        t.busy = true;
        break;
      case 'swpn':
        if (!t) break;
        t.p.weapon = this.nextWeaponId(t, 1); t.fx = { k: 'red', t: 0.2 };
        Sound.click();
        break;
    }
  },
  // validate a player's request (host or offline) and turn it into commands
  onRequest(peer, c) {
    const t = c && c.tank !== undefined ? this.tanks[c.tank | 0] : null;
    if (!this.canControl(t, peer) || !t.alive || t.dying) return;
    const lock = this.mode === 'SIMULTANEOUS';
    if (!lock && !this.settled()) { this.deferred.push({ peer, c }); return; }
    const myTurn = this.state === 'human' && this.cur === t;
    const aiming = myTurn || (this.state === 'syncaim' && this.syncWait.has(t.p.idx));
    const autodef = this.state === 'autodef' && this.adWait.has(t.p.idx);
    switch (c.c) {
      case 'fire': if (aiming) this.commitShot(t, c); break;
      case 'batt': case 'para': case 'thresh': case 'selshield': case 'shield':
        if (aiming || autodef) this.act(this.clean(c)); break;
      case 'adone': if (autodef) this.act({ c: 'adone', tank: t.p.idx }); break;
      case 'guid': case 'trig': case 'move':
        if (aiming) this.act(this.clean(c)); break;
      case 'retreat': if (myTurn) this.retreat(t); break;
      case 'keys': case 'nudge': case 'swpn':
        if (lock && this.state === 'play') this.act(this.clean(c)); break;
      // once the round is decided nobody may keep it going by firing
      case 'sfire': if (lock && this.state === 'play' && !t.busy && !this.checkRoundOver()) this.act(this.clean(c)); break;
    }
  },
  // pass on only the fields a command needs (requests from other machines are untrusted)
  clean(c) {
    const o = { c: c.c, tank: c.tank | 0 };
    const item = (id, kind) => (typeof id === 'string' && Data.byId[id] && Data.byId[id].kind === kind) ? id : null;
    switch (c.c) {
      case 'para': case 'trig': o.on = !!c.on; break;
      case 'thresh': o.v = clamp(c.v | 0, 1, 100); break;
      case 'selshield': case 'shield': o.id = item(c.id, 'shield'); break;
      case 'guid': o.id = item(c.id, 'guidance'); break;
      case 'move': o.steps = (Array.isArray(c.steps) ? c.steps : []).slice(0, 60).map(d => d < 0 ? -1 : 1); break;
      case 'keys': o.k = c.k & 15; break;
      case 'nudge': o.a = clamp(c.a | 0, -1, 1); o.p = clamp(c.p | 0, -5, 5); break;
      case 'sfire': o.batteries = clamp(c.batteries | 0, 0, 9); break;
    }
    return o;
  },
  fireCmd(t, o) {
    const has = id => typeof id === 'string' && !!Data.byId[id];
    const weapon = has(o.weapon) && Data.byId[o.weapon].cat === 'W' ? o.weapon : t.p.weapon;
    const g = o.guidance !== undefined ? o.guidance : t.guidance;
    const guidance = has(g) && Data.byId[g].kind === 'guidance' ? g : null;
    const tg = o.target && isFinite(o.target.x) && isFinite(o.target.y) ? { x: +o.target.x, y: +o.target.y } : null;
    return {
      c: 'fire', tank: t.p.idx,
      angle: clamp(Math.round(o.angle !== undefined ? +o.angle : t.angle) || 0, 0, 180),
      power: clamp(Math.round(o.power !== undefined ? +o.power : t.power) || 0, 0, t.maxPower),
      weapon, guidance, target: tg, batteries: clamp(o.batteries | 0, 0, 9),
      triggers: o.triggers !== undefined ? !!o.triggers : !!t.triggers
    };
  },

  /* =================================================== turn logic (host / offline) */
  update(dt) {
    if (!Net.online && UI.paused()) return;
    this.present(dt);
    if (Net.isClient()) { Net.clientPump(dt); return; }
    this.acc += dt * this.speed();
    let n = Math.floor(this.acc / TICK);
    this.acc -= n * TICK;
    const cap = document.hidden ? 150 : 8;
    if (n > cap) { n = cap; this.acc = 0; }
    for (let i = 0; i < n && App.scene === BattleScene; i++) {
      this.simTick();
      this.control(TICK);
      // simultaneous mode: followers may run up to here; now and then with a checksum
      if (Net.isHost() && this.mode === 'SIMULTANEOUS' && this.tick % 6 === 0 && App.scene === BattleScene) {
        Net.hostCommand(this.tick % 180 === 0 ? { c: 'tk', sum: this.checksum() } : { c: 'tk' });
      }
    }
  },
  control(dt) {
    const lock = this.mode === 'SIMULTANEOUS';
    const calm = lock || this.settled();
    if (calm && this.pendingAI.length) this.flushPendingAI();
    if (calm && this.deferred.length) { const d = this.deferred; this.deferred = []; for (const x of d) this.onRequest(x.peer, x.c); }
    if (this.pendingMass && calm && this.state !== 'over' && this.state !== 'done') {
      this.pendingMass = false;
      this.act({ c: 'masskill' });
      this.toOver(1.5);
      return;
    }
    if (lock) this.controlSimul(dt); else this.controlTurns(dt);
  },
  controlTurns(dt) {
    switch (this.state) {
      case 'intro':
        this.t -= dt;
        if (this.t <= 0) this.beginAutoDefense();
        break;
      case 'autodef':
        if (!this.adWait.size) this.state = 'settle';
        break;
      case 'settle':
        if (this.settled()) {
          if (this.checkRoundOver()) { this.toOver(1.2); break; }
          this.nextTurn();
        }
        break;
      case 'weather':
        if (this.settled()) {
          if (this.checkRoundOver()) { this.toOver(1.2); break; }
          if (this.mode === 'SYNCHRONOUS') this.beginSyncCycle(true);
          else this.beginTurn(this.pendingTurn, true);
        }
        break;
      case 'ai': this.updateAI(dt); break;
      case 'syncaim':
        if (!this.syncWait.size) { this.state = 'syncfire'; this.t = 0.4; }
        break;
      case 'syncfire':
        this.t -= dt;
        if (this.t <= 0) this.fireSync();
        break;
      case 'over':
        this.t -= dt;
        if (this.t <= 0 && this.settled()) { this.state = 'done'; this.finishRound(); }
        break;
    }
  },
  toOver(t) { this.state = 'over'; this.t = t; this.act({ c: 'over' }); },
  checkRoundOver() {
    const alive = this.alive();
    if (alive.length <= 1) return true;
    if (this.teamsOn() && Cfg.teams !== 'VICIOUS') {
      const teams = new Set(alive.map(t => t.p.team));
      if (teams.size <= 1) return true;
    }
    return false;
  },
  // players whose people left the game are handed to the computer at a quiet moment
  flushPendingAI() {
    const list = this.pendingAI;
    this.pendingAI = [];
    for (const idx of list) {
      const p = Game.players[idx];
      if (!p || p.ai) continue;
      this.act({ c: 'setai', idx, ai: 'Chooser' });
      const t = this.tanks[idx];
      if (!t || !t.alive || t.dying) continue;
      if (this.state === 'human' && this.cur === t) this.startAITurn(t);
      else if (this.state === 'syncaim' && this.syncWait.has(idx)) this.aiCommitSync(t);
      else if (this.state === 'autodef' && this.adWait.has(idx)) this.act({ c: 'adone', tank: idx });
    }
  },

  // at the start of a round, owners of Auto Defense set up shields/parachutes
  beginAutoDefense() {
    const list = [];
    for (const t of this.tanks) {
      if (!t.alive || !t.p.autoDefense) continue;
      if (t.p.ai) AI.prepare(t); else list.push(t.p.idx);
    }
    this.state = 'autodef';
    if (list.length) this.act({ c: 'autodef', list });
  },
  openAutoDefense() {
    const mine = this.tanks.filter(t => this.adWait.has(t.p.idx) && this.isLocal(t));
    const next = () => {
      const t = mine.shift();
      if (!t) return;
      Panels.tankControl(t, { autoDefense: true, onClose: () => { this.request({ c: 'adone', tank: t.p.idx }); next(); } });
    };
    next();
  },

  nextTurn() {
    if (this.mode === 'SYNCHRONOUS') { this.beginSyncCycle(false); return; }
    const n = this.order.length;
    for (let k = 0; k < n; k++) {
      this.turnIdx = (this.turnIdx + 1) % n;
      const t = this.order[this.turnIdx];
      if (t.alive && !t.dying) { this.beginTurn(t); return; }
    }
    this.toOver(1);
  },
  // walls, wind and weather at the start of a turn (or synchronous volley); true if weather struck
  envAndWeather() {
    this.turnCount++;
    let walls = this.walls, wind = this.wind;
    if (Cfg.effectOfWalls === 'ERRATIC') walls = pick(WALL_TYPES);
    if (this.turnCount > 1) wind = this.rollWind(this.wind);
    if (walls !== this.walls || wind !== this.wind) this.act({ c: 'env', wind, walls });
    const w = this.rollWeather();
    if (w) { this.act(Object.assign({ c: 'weather' }, w)); return true; }
    return false;
  },
  beginTurn(t, afterWeather) {
    if (!afterWeather && this.envAndWeather()) { this.pendingTurn = t; this.state = 'weather'; return; }
    if (!t || !t.alive || t.dying) { this.state = 'settle'; return; }
    this.act({ c: 'turn', tank: t.p.idx, sum: Net.isHost() ? this.checksum() : undefined });
    if (t.p.ai) this.startAITurn(t);
    else this.state = 'human';
  },
  startAITurn(t) {
    AI.prepare(t);
    this.plan = AI.plan(t);
    this.aiT = 0;
    this.aiThink = (Cfg.fastComputers && !this.humansAlive()) ? 0.15 : rand(0.5, 1.0) * Math.min(1, Cfg.firingDelay / 60 + 0.3);
    this.act({ c: 'aiaim', tank: t.p.idx, angle: this.plan.angle, power: Math.min(this.plan.power, t.maxPower), weapon: this.plan.weapon, dur: this.aiThink });
    this.state = 'ai';
  },
  updateAI(dt) {
    const t = this.cur, pl = this.plan;
    if (!t || !t.alive || t.dying) { this.state = 'settle'; return; }
    this.aiT += dt;
    if (this.aiT < this.aiThink) return;
    this.commitShot(t, this.aiShot(pl));
  },
  aiShot(pl) {
    const o = { weapon: pl.weapon, batteries: pl.batteries, guidance: pl.guidance || null, angle: pl.angle, power: pl.power, triggers: false };
    if (pl.guidance && Data.byId[pl.guidance].target && pl.target) o.target = AI.targetPoint(pl.target);
    return o;
  },
  // a finished aim becomes a fire command (sequential) or a queued shot (synchronous)
  commitShot(t, o) {
    const c = this.fireCmd(t, o);
    if (Net.isClient()) { this.waitHost = true; Net.request(c, true); return; }
    if (this.mode === 'SYNCHRONOUS') {
      if (!this.syncWait.has(t.p.idx)) return;
      this.syncShots.push(c);
      this.act({ c: 'ready', tank: t.p.idx });
      return;
    }
    this.act(c);
    this.state = 'settle';
  },
  // synchronous mode: everyone aims (in parallel online), then the whole volley goes off at once
  beginSyncCycle(afterWeather) {
    if (!afterWeather && this.envAndWeather()) { this.pendingTurn = null; this.state = 'weather'; return; }
    const list = this.order.filter(t => t.alive && !t.dying);
    if (!list.length) { this.toOver(1); return; }
    this.syncShots = [];
    this.act({ c: 'syncaim', list: list.map(t => t.p.idx), sum: Net.isHost() ? this.checksum() : undefined });
    this.state = 'syncaim';
    for (const t of list) if (t.p.ai) this.aiCommitSync(t);
  },
  aiCommitSync(t) {
    AI.prepare(t);
    const pl = AI.plan(t);
    this.act({ c: 'aiaim', tank: t.p.idx, angle: pl.angle, power: Math.min(pl.power, t.maxPower), weapon: pl.weapon, dur: 0.6 });
    this.commitShot(t, this.aiShot(pl));
  },
  fireSync() {
    for (const c of this.syncShots) {
      const t = this.tanks[c.tank];
      if (t && t.alive && !t.dying) this.act(c);
    }
    this.syncShots = [];
    this.state = 'settle';
  },
  retreat(t) {
    if (this.state !== 'human' || this.cur !== t) return;
    this.act({ c: 'retreat', tank: t.p.idx });
    this.state = 'settle';
  },

  // simultaneous mode (host / offline)
  controlSimul(dt) {
    switch (this.state) {
      case 'intro': this.t -= dt; if (this.t <= 0) this.beginAutoDefense(); return;
      case 'autodef': if (!this.adWait.size) { this.act({ c: 'play' }); this.state = 'play'; } return;
      case 'over': this.t -= dt; if (this.t <= 0 && this.settled()) { this.state = 'done'; this.finishRound(); } return;
      case 'play': break;
      default: return;
    }
    // this machine's players: held keys become key-state commands
    for (const t of this.tanks) {
      if (!t.alive || t.dying || !this.isLocal(t)) continue;
      const K = this.keysFor(t), H = Input.held;
      const m = UI.top() ? 0 : ((H[K.ccw] ? KEY_CCW : 0) | (H[K.cw] ? KEY_CW : 0) | (H[K.up] ? KEY_UP : 0) | (H[K.down] ? KEY_DOWN : 0));
      if (m !== t.keys) this.act({ c: 'keys', tank: t.p.idx, k: m });
    }
    for (const t of this.tanks) if (t.alive && !t.dying && t.p.ai) this.simulAIControl(t, dt);
    if (this.checkRoundOver() && this.settled()) this.toOver(1.2);
  },
  simulAIControl(t, dt) {
    if (t.busy || !AI.enemies(t).length) return;
    const m = t.p.aiMem;
    if (!m.simPlan || !t.slew) {
      m.simWait = (m.simWait === undefined ? rand(0.5, 2) : m.simWait) - dt;
      if (m.simWait > 0) return;
      AI.prepare(t);
      const pl = AI.plan(t);
      let weapon = pl.weapon;
      const k = Data.byId[weapon].kind;
      if ((k === 'laser' || k === 'plasma') && (t.p.inv.battery || 0) === 0) weapon = 'babyMissile';
      m.simPlan = Object.assign({}, pl, { weapon, power: Math.min(pl.power, t.maxPower) });
      this.act({ c: 'splan', tank: t.p.idx, angle: m.simPlan.angle, power: m.simPlan.power, weapon });
      return;
    }
    const pl = m.simPlan;
    const da = pl.angle - t.angle, dp = Math.min(pl.power, t.maxPower) - t.power;
    if (Math.abs(da) < 0.5 && Math.abs(dp) < 3) {
      this.act({ c: 'sfire', tank: t.p.idx, batteries: pl.batteries || 0 });
      m.simPlan = null; m.simWait = rand(0.6, 2.2);
    }
  },

  /* =================================================== round end */
  massKill() { this.pendingMass = true; },
  massKillExec() {
    const alive = this.alive();
    const sc = SCORE[Cfg.scoringMode] || SCORE.STANDARD;
    const share = alive.length ? Math.round(sc.survive / alive.length) : 0;
    for (const t of alive) { this.award(t.p, share); this.killTank(t, null, { mass: true }); }
    this.massKilled = true;
  },
  finishRound() {
    Sound.flightStop();
    const sc = SCORE[Cfg.scoringMode] || SCORE.STANDARD;
    const alive = this.alive();
    let winners = [];
    if (!this.massKilled && alive.length) {
      const share = Math.round(sc.survive / alive.length);
      for (const t of alive) { this.award(t.p, share); t.p.wins++; if (t.p.stats) t.p.stats.survived++; }
      winners = alive.map(t => t.p.idx);
    }
    Game.roundFinished(winners, this.massKilled);
  },

  /* =================================================== network consistency */
  checksum() {
    let h = 0x811c9dc5 | 0;
    const mix = v => { v |= 0; for (let s = 0; s < 32; s += 8) { h ^= (v >>> s) & 255; h = Math.imul(h, 16777619); } };
    const land = World.land, n = land.length;
    let w = 0, b = 0;
    for (let i = 0; i < n; i++) { if (land[i]) w |= 1 << b; if (++b === 32) { mix(w); w = 0; b = 0; } }
    mix(w);
    for (const t of this.tanks) {
      mix(Math.round(t.x * 4)); mix(t.y); mix(Math.round(t.energy * 100)); mix(t.alive ? 1 : 0);
      mix(t.shield ? 1 + Math.round(t.shield.energy * 100) : 0);
    }
    mix(this.wind); mix(WALL_TYPES.indexOf(this.walls)); mix(SR.s);
    for (const p of Game.players) { mix(Math.round(p.score)); mix(p.fuel | 0); for (const it of Data.items) mix(p.inv[it.id] | 0); }
    return h >>> 0;
  },
  // full state at a quiet moment, for a peer that fell out of step
  snapshot() {
    return {
      params: this.params, k: this.tick, sr: SR.s, wind: this.wind, walls: this.walls,
      state: this.state, cur: this.cur ? this.cur.p.idx : -1, turnIdx: this.turnIdx, turnCount: this.turnCount,
      order: this.order.map(t => t.p.idx), syncWait: [...this.syncWait], adWait: [...this.adWait],
      massKilled: this.massKilled, lastShooter: this.lastShooter ? this.lastShooter.p.idx : -1,
      land: World.encodeLand(), unstable: World.encodeBits(World.unstable), suspended: World.suspended,
      tanks: this.tanks.map(t => ({
        x: t.x, y: t.y, a: t.angle, pw: t.power, e: t.energy, al: t.alive,
        sh: t.shield ? [t.shield.it.id, t.shield.energy] : null, ss: t.selShield, g: t.guidance, tr: t.triggers,
        rd: t.ready, k: t.keys, sl: t.slew, bs: t.busy
      }))
    };
  },
  loadSnapshot(s) {
    this.start(s.params);
    World.decodeLand(s.land);
    World.decodeBits(s.unstable, World.unstable);
    World.suspended = !!s.suspended;
    this.wind = s.wind; this.walls = s.walls; this.turnIdx = s.turnIdx; this.turnCount = s.turnCount;
    this.order = s.order.map(i => this.tanks[i]).filter(Boolean);
    this.syncWait = new Set(s.syncWait); this.adWait = new Set(s.adWait);
    this.massKilled = !!s.massKilled;
    this.lastShooter = s.lastShooter >= 0 ? this.tanks[s.lastShooter] || null : null;
    s.tanks.forEach((d, i) => {
      const t = this.tanks[i];
      if (!t) return;
      t.x = d.x; t.y = d.y; t.angle = d.a; t.power = d.pw; t.energy = d.e; t.alive = !!d.al; t.dying = false;
      t.shield = d.sh && Data.byId[d.sh[0]] ? { it: Data.byId[d.sh[0]], energy: d.sh[1] } : null;
      t.selShield = d.ss || null; t.guidance = d.g || null; t.triggers = !!d.tr; t.ready = !!d.rd;
      t.keys = d.k | 0; t.slew = d.sl || null; t.busy = !!d.bs;
    });
    this.cur = s.cur >= 0 ? this.tanks[s.cur] || null : null;
    this.state = s.state === 'human' ? (this.isLocal(this.cur) ? 'human' : 'remote') : s.state;
    SR.s = s.sr;
    this.tick = s.k;
  },

  /* =================================================== presentation (every frame, every machine) */
  present(dt) {
    Screen.flash = Math.max(0, Screen.flash - dt * 2.5);
    // lightning: the sky lights up after a strike, and in a storm the clouds flicker now and
    // then on their own, often twice (cosmetic: Math.random, every machine for itself)
    this.skyFlash = Math.max(0, (this.skyFlash || 0) - dt);
    this.cloudFlick = Math.max(0, (this.cloudFlick || 0) - dt);
    if (World.skyType === 'STORMY') {
      this.cloudT = (this.cloudT === undefined ? rand(1, 4) : this.cloudT) - dt;
      if (this.cloudT <= 0) { this.cloudFlick = rand(0.03, 0.07); this.cloudT = chance(0.5) ? rand(0.08, 0.14) : rand(2, 7); }
    }
    if (this.slowmo > 0) this.slowmo -= dt;
    this.ambT = (this.ambT || 0) - dt;
    if (this.ambT <= 0) { this.ambT = 0.25; Sound.ambience(Math.abs(this.wind) / Math.max(20, Cfg.maxWind)); }
    this.yourTurnT = Math.max(0, this.yourTurnT - dt);
    this.balloons = this.balloons.filter(b => (b.t -= dt) > 0 && (b.tank.alive || b.tank.dying));
    for (const t of this.tanks) {
      const tw = t.tween;
      if (!tw) continue;
      tw.t += dt;
      const k = clamp(tw.t / Math.max(0.05, tw.dur), 0, 1);
      t.angle = Math.round(lerp(tw.a0, tw.a1, k)); t.power = Math.round(lerp(tw.p0, tw.p1, k));
      if (k >= 1) t.tween = null;
    }
    this.flightSound();
    if (this.mode === 'SIMULTANEOUS') this.localSimulKeys(); else this.updateHuman(dt);
    if (Net.online && this.mode !== 'SIMULTANEOUS') this.syncAimDisplay();
  },
  flightSound() {
    const s = this.entities.find(e => e instanceof Shot && e.delay <= 0);
    if (!s || Cfg.flightSounds === 'OFF') { Sound.flightStop(); return; }
    if (Cfg.flightSounds === 'POS') Sound.flightSet(200 + (1 - clamp(s.y / World.H, -0.5, 1)) * 1400);
    else Sound.flightSet(120 + Math.hypot(s.vx, s.vy / World.ay) / Phys.vmax() * 1600);
  },
  // other players' turrets move live (presence); ours is published the same way
  syncAimDisplay() {
    const aiming = [];
    if (this.mode === 'SYNCHRONOUS' && this.state === 'syncaim') {
      for (const t of this.tanks) if (this.syncWait.has(t.p.idx) && !t.p.ai && !this.isLocal(t)) aiming.push(t);
    } else if ((this.state === 'human' || this.state === 'remote') && this.cur && !this.cur.p.ai && !this.isLocal(this.cur)) {
      aiming.push(this.cur);
    }
    for (const t of aiming) {
      const a = Net.aimOf(t.p.owner);
      if (!a || a.i !== t.p.idx) continue;
      t.angle = clamp(a.a | 0, 0, 180); t.power = clamp(a.p | 0, 0, t.maxPower);
      if (typeof a.w === 'string' && Game.has(t.p, a.w)) t.p.weapon = a.w;
    }
    const mine = this.aimTank();
    Net.publishAim(mine && !this.waitHost ? { i: mine.p.idx, a: Math.round(mine.angle), p: Math.round(mine.power), w: mine.p.weapon } : null);
  },
  // a client in simultaneous mode: send held-key changes to the host (resent until they stick)
  localSimulKeys() {
    if (!Net.isClient() || this.state !== 'play') return;
    const now = performance.now();
    for (const t of this.tanks) {
      if (!t.alive || t.dying || !this.isLocal(t)) continue;
      const K = this.keysFor(t), H = Input.held, i = t.p.idx;
      const m = UI.top() ? 0 : ((H[K.ccw] ? KEY_CCW : 0) | (H[K.cw] ? KEY_CW : 0) | (H[K.up] ? KEY_UP : 0) | (H[K.down] ? KEY_DOWN : 0));
      const changed = m !== (this.localKeys[i] || 0);
      if (changed || (m !== t.keys && now - (this.keySentT[i] || 0) > 400)) {
        this.localKeys[i] = m; this.keySentT[i] = now;
        Net.request({ c: 'keys', tank: i, k: m });
      }
    }
  },

  updateHuman(dt) {
    const t = this.aimTank();
    if (!t || this.waitHost || UI.top()) return;
    const H = Input.held;
    if (H.alt || H.control) return;
    const slow = H.shift ? 0.3 : 1;
    const hold = (k) => {
      if (!H[k]) { this.keyHold[k] = 0; return 0; }
      this.keyHold[k] = (this.keyHold[k] || 0) + dt;
      const ht = this.keyHold[k];
      return ht > 0.22 ? Math.min(1, 0.35 + (ht - 0.22) * 0.8) : 0;
    };
    const a = hold('arrowleft') - hold('arrowright');
    const pw = hold('arrowup') - hold('arrowdown');
    const fastp = hold('pageup') - hold('pagedown');
    if (a) {
      t.angleF = (t.angleF === undefined ? t.angle : t.angleF) + a * 70 * slow * dt;
      t.angleF = clamp(t.angleF, 0, 180); t.angle = Math.round(t.angleF);
    } else t.angleF = undefined;
    if (pw || fastp) {
      t.powerF = (t.powerF === undefined ? t.power : t.powerF) + (pw * 420 + fastp * 1800) * slow * dt;
      t.powerF = clamp(t.powerF, 0, t.maxPower); t.power = Math.round(t.powerF);
    } else t.powerF = undefined;
    // mouse hold on Power / Angle
    if (this.hold) {
      this.hold.t -= dt;
      if (this.hold.t <= 0) { this.hold.t = 0.035 / Cfg.mouseRate * 0.5; this.hudAction(this.hold.id, this.hold.b, true); }
    }
  },

  humanFire() {
    const t = this.aimTank();
    if (!t || this.waitHost) return;
    const p = t.p, wp = Data.byId[p.weapon];
    if ((wp.kind === 'laser' || wp.kind === 'plasma')) {
      if ((p.inv.battery || 0) > 0) { Panels.batteries(t, n => this.commitShot(t, { batteries: n })); return; }
      this.commitShot(t, { batteries: 0 }); return;
    }
    const g = t.guidance ? Data.byId[t.guidance] : null;
    if (g && g.target && !Data.noGuidance[wp.id]) {
      Panels.chooseTarget(t, target => this.commitShot(t, { target }));
      return;
    }
    this.commitShot(t, {});
  },
  // tank-control shortcuts shared by the keyboard, status bar and panels
  tankAction(t, what) {
    const p = t.p, i = p.idx;
    switch (what) {
      case 'batt':
        if ((p.inv.battery || 0) <= 0 || t.energy >= 100) { Sound.error(); return; }
        this.request({ c: 'batt', tank: i }); return;
      case 'para':
        if ((p.inv.parachute || 0) <= 0) { Sound.error(); return; }
        this.request({ c: 'para', tank: i, on: !p.para.deployed }); return;
      case 'selshield': this.request({ c: 'selshield', tank: i, id: this.nextShieldId(t) }); return;
      case 'shield':
        if (t.selShield && (p.inv[t.selShield] || 0) <= 0) { Sound.error(); return; }
        this.request({ c: 'shield', tank: i, id: t.selShield }); return;
      case 'guid': this.request({ c: 'guid', tank: i, id: this.nextGuidId(t) }); return;
      case 'trig':
        if ((p.inv.contactTrigger || 0) <= 0) { Sound.error(); return; }
        this.request({ c: 'trig', tank: i, on: !t.triggers }); return;
    }
  },

  key(ev) {
    const k = ev.k;
    if (this.mode === 'SIMULTANEOUS') { this.keySimul(ev); return; }
    const t = this.aimTank();
    if (!t || this.waitHost) {
      if (k === 'u') Panels.update();
      else if (k === 'k') messageBox(['No kibitzing, please.'], null, { anyKey: true, noButton: true });
      else if (/^[0-9]$/.test(k)) this.tankInfoKey(k);
      return;
    }
    // a tap moves exactly one unit; holding (without Alt/Ctrl) keeps going in updateHuman()
    switch (k) {
      case 'arrowleft': if (!ev.repeat) t.angle = clamp(t.angle + 1, 0, 180); break;
      case 'arrowright': if (!ev.repeat) t.angle = clamp(t.angle - 1, 0, 180); break;
      case 'arrowup': if (!ev.repeat) t.power = clamp(t.power + 1, 0, t.maxPower); break;
      case 'arrowdown': if (!ev.repeat) t.power = clamp(t.power - 1, 0, t.maxPower); break;
      case 'pageup': if (!ev.repeat) t.power = clamp(t.power + 10, 0, t.maxPower); break;
      case 'pagedown': if (!ev.repeat) t.power = clamp(t.power - 10, 0, t.maxPower); break;
      case 'tab': t.p.weapon = this.nextWeaponId(t, ev.shift ? -1 : 1); Sound.click(); break;
      case 'space': case 'enter': this.humanFire(); break;
      case 't': Panels.tankControl(t); break;
      case 'i': Panels.inventory(t); break;
      case 'k': messageBox(['No kibitzing, please.'], null, { anyKey: true, noButton: true }); break;
      case 'r':
        if (this.mode === 'SYNCHRONOUS') { Sound.error(); break; }
        confirmBox(['Do you really want to retreat?'], () => this.request({ c: 'retreat', tank: t.p.idx }));
        break;
      case 'u': Panels.update(); break;
      case 'b': this.tankAction(t, 'batt'); break;
      case 'p': this.tankAction(t, 'para'); break;
      case 's': this.tankAction(t, 'selshield'); break;
      case 'e': this.tankAction(t, 'shield'); break;
      case 'g': this.tankAction(t, 'guid'); break;
      case 'f': Panels.move(t); break;
      case '-': this.tankAction(t, 'trig'); break;
      default:
        if (/^[0-9]$/.test(k)) this.tankInfoKey(k);
    }
  },
  tankInfoKey(k) {
    const n = k === '0' ? 10 : +k;
    const ts = this.tanksByX();
    if (ts[n - 1]) Panels.tankInfo(ts[n - 1]);
  },
  keySimul(ev) {
    if (this.state !== 'play' || ev.repeat) return;
    for (const t of this.tanks) {
      if (!t.alive || t.dying || !this.isLocal(t)) continue;
      const K = this.keysFor(t), i = t.p.idx;
      if (ev.k === K.fire) { if (!t.busy) this.request({ c: 'sfire', tank: i }); }
      else if (ev.k === K.weapon) this.request({ c: 'swpn', tank: i });
      else if (ev.k === K.ccw) this.request({ c: 'nudge', tank: i, a: 1 });
      else if (ev.k === K.cw) this.request({ c: 'nudge', tank: i, a: -1 });
      else if (ev.k === K.up) this.request({ c: 'nudge', tank: i, p: 5 });
      else if (ev.k === K.down) this.request({ c: 'nudge', tank: i, p: -5 });
    }
  },

  mouse(ev) {
    if (Gfx.modern && Hud.mouse(ev)) return;
    if (this.mode === 'SIMULTANEOUS') return;
    if (ev.kind === 'up') { this.hold = null; return; }
    const t = this.aimTank();
    if (!t || this.waitHost) {
      if (ev.kind === 'down') { const tk = this.tankAt(ev.x, ev.y); if (tk) Panels.tankInfo(tk); }
      return;
    }
    if (ev.kind === 'dbl' || (ev.kind === 'down' && ev.both)) {
      if (ev.uy > this.statusH + 2) { this.humanFire(); return; }
    }
    if (ev.kind !== 'down') return;
    for (const r of this.hud) {
      if (ev.ux >= r.x && ev.ux < r.x + r.w && ev.uy >= r.y && ev.uy < r.y + r.h) {
        this.hudAction(r.id, ev.button, false);
        if (r.id === 'power' || r.id === 'angle') this.hold = { id: r.id, b: ev.button, t: 0.35 };
        return;
      }
    }
    const tk = this.tankAt(ev.x, ev.y);
    if (tk && ev.button === 0) Panels.tankInfo(tk);
  },
  tankAt(x, y) {
    return this.tanks.find(t => t.alive && t.contains(x, y, 3)) || null;
  },
  hudAction(id, b, repeat) {
    const t = this.aimTank();
    if (!t || this.waitHost) return;
    const right = b === 2;
    switch (id) {
      case 'power': t.power = clamp(t.power + (right ? 1 : -1) * (repeat ? 5 : 1), 0, t.maxPower); break;
      case 'angle': t.angle = clamp(t.angle + (right ? -1 : 1), 0, 180); break;
      case 'name': if (right) Panels.inventory(t); else Panels.tankControl(t); break;
      case 'weapon': t.p.weapon = this.nextWeaponId(t, right ? 1 : -1); Sound.click(); break;
      case 'batt': this.tankAction(t, 'batt'); break;
      case 'para': this.tankAction(t, 'para'); break;
      case 'shld': this.tankAction(t, 'selshield'); break;
      case 'pct': this.tankAction(t, 'shield'); break;
      case 'guid': this.tankAction(t, 'guid'); break;
      case 'trig': this.tankAction(t, 'trig'); break;
      case 'fuel': Panels.move(t); break;
    }
  },

  /* =================================================== drawing */
  draw() {
    const s = Screen.main;
    s.buf.set(World.comp);
    // classic look: 1.5 paints the ground one flat color (bright or dark green), picked here
    // from the terrain seed - never the shared generator, so looks can differ between peers
    if (!World.scanned) {
      const flat = this.flatLand();
      const land = World.land, buf = s.buf;
      for (let i = 0, n = land.length; i < n; i++) if (land[i]) buf[i] = flat;
    }
    // the sky lit by lightning: strongest high up; a flicker lights only the clouds
    const sf = this.skyFlash || 0, cf = (this.cloudFlick || 0) > 0;
    if (sf > 0 || (cf && World.cloudEdge)) {
      const W = World.W, H = World.H, top = World.top, ph = H - top, land = World.land, buf = s.buf, edge = World.cloudEdge;
      const k = Math.min(1, sf / 0.15);
      for (let y = top; y < H; y++) {
        const add = 57 * k * (1 - (y - top) / ph);
        for (let x = 0, i = y * W; x < W; x++, i++) {
          if (land[i]) continue;
          const cloud = edge && y < edge[x];
          const a = cloud ? (cf ? 80 : 0) + add * 0.6 : add;
          if (a < 1) continue;
          const c = buf[i];
          buf[i] = rgb(cR(c) + a, cG(c) + a, cB(c) + a);
        }
      }
    }
    // walls
    const wc = WALL_COLORS[this.walls] || WALL_COLORS.NONE;
    s.vline(0, World.top, World.H - 1, wc); s.vline(World.W - 1, World.top, World.H - 1, wc);
    for (const t of this.tanks) t.draw(s);
    for (const e of this.entities) e.draw(s);
    const u = Screen.ui, shadow = UIC.black, y = this.statusH + 12;
    this.drawHud(u);
    this.drawBalloons(u);
    if (this.mode === 'SYNCHRONOUS' && this.state === 'syncaim') {
      const t = this.aimTank();
      if (t && !this.waitHost) Font.center(u, t.p.name.replace(/&/g, '&&') + ', aim your weapon', Screen.UW / 2, y, UIC.white, { shadow });
      else Font.center(u, 'Waiting for ' + this.syncWait.size + ' player' + (this.syncWait.size === 1 ? '' : 's') + ' to aim...', Screen.UW / 2, y, UIC.white, { shadow });
    } else if (Net.online && this.mode === 'SEQUENTIAL' && this.cur && (this.state === 'human' || this.state === 'remote')) {
      if (!this.isLocal(this.cur) && !this.cur.p.ai) Font.center(u, 'Waiting for ' + this.cur.p.name.replace(/&/g, '&&') + '...', Screen.UW / 2, y, this.cur.color, { shadow });
      else if (this.isLocal(this.cur) && this.yourTurnT > 0 && (Math.floor(this.yourTurnT * 4) & 1)) Font.center(u, 'Your turn!', Screen.UW / 2, y, this.cur.color, { shadow });
    }
    for (const t of this.tanks) {
      if (t.ready && t.alive) {
        const x = Math.round(t.x / Screen.UX), yy = Math.round(t.top / Screen.UY) - 6;
        Font.center(u, '▼', x, yy, t.color);
      }
    }
  },

  drawHud(u) {
    this.hud = [];
    const reg = (id, x, y, w, h) => this.hud.push({ id, x, y, w, h });
    const shadow = UIC.black;
    // 1.5's grey status bar across the top
    u.fillRect(0, 0, Screen.UW, this.statusH - 1, UIC.face);
    u.hline(0, Screen.UW - 1, 0, UIC.hi); u.hline(0, Screen.UW - 1, this.statusH - 2, UIC.lo);
    if (this.mode === 'SIMULTANEOUS') {
      const n = this.tanks.length, cw = Math.floor(Screen.UW / n);
      this.tanks.forEach((t, i) => {
        const x = i * cw + 2;
        if (!t.alive) { Font.draw(u, '---', x, 2, scalec(t.color, 0.5)); return; }
        Font.draw(u, String(Math.round(t.power)), x, 2, t.color, { shadow });
        Icons.draw(u, t.p.weapon, x, 11);
        if (Cfg.statusBar) Font.draw(u, Math.round(t.energy) + (t.shield ? '+' : ''), x + 14, 13, t.color, { shadow });
      });
      this.drawWind(u, Cfg.statusBar ? 24 : 22);
      return;
    }
    const t = this.hudTank();
    this.drawWind(u, this.statusH + 1);
    if (!t) return;
    const c = t.color, p = t.p;
    const disp = t.angle <= 90 ? t.angle : 180 - t.angle;
    let x = 3;
    const ps = 'Power:' + String(Math.round(t.power)).padStart(5);
    Font.draw(u, ps, x, 2, UIC.text); reg('power', x, 1, Font.width(ps), 10); x += Font.width(ps) + 10;
    const as = 'Angle:' + String(Math.round(disp)).padStart(3);
    Font.draw(u, as, x, 2, UIC.text); reg('angle', x, 1, Font.width(as), 10); x += Font.width(as) + 12;
    const nm = p.name;
    Font.draw(u, nm.replace(/&/g, '&&'), x, 2, c); reg('name', x, 1, Font.width(nm), 10);
    // weapon at the far right: icon, count, name
    const wp = Data.byId[p.weapon];
    const cnt = wp.id === 'babyMissile' ? 99 : (p.inv[wp.id] || 0);
    const ws = cnt + ' ' + wp.name;
    const wx = Screen.UW - 3 - Font.width(ws);
    Font.draw(u, ws.replace(/&/g, '&&'), wx, 2, UIC.text);
    Icons.draw(u, wp.id, wx - 14, 1);
    reg('weapon', wx - 14, 1, Screen.UW - wx + 14, 10);
    if (Cfg.statusBar) this.drawStatusBar(u, t, 12, reg);
  },
  drawStatusBar(u, t, y, reg) {
    const p = t.p, c = t.color, shadow = UIC.black;
    const gray = vga(30, 30, 30);
    let x = 3;
    const ms = 'Max:' + t.maxPower;
    Font.draw(u, ms, x, y + 1, c, { shadow }); x += Font.width(ms) + 8;
    const item = (id, icon, count, on, extra) => {
      const cs = String(count);
      Font.draw(u, cs, x, y + 1, count > 0 ? c : gray, { shadow });
      const ix = x + Font.width(cs) + 1;
      Icons.draw(u, icon, ix, y, { gray: !on });
      reg(id, x, y, Font.width(cs) + 14, 10);
      x = ix + 14;
      if (extra) { Font.draw(u, extra, x, y + 1, c, { shadow }); reg('pct', x, y, Font.width(extra), 10); x += Font.width(extra) + 4; }
      x += 4;
    };
    item('batt', 'battery', p.inv.battery || 0, (p.inv.battery || 0) > 0 && t.energy < 100);
    item('para', 'parachute', p.inv.parachute || 0, p.para.deployed && (p.inv.parachute || 0) > 0);
    const shId = t.selShield || (t.shield ? t.shield.it.id : null);
    const pct = t.shield ? Math.round(t.shield.energy / t.shield.it.strength * 100) + '%' : '0%';
    item('shld', shId || 'none', shId ? (p.inv[shId] || 0) : 0, !!t.shield, pct);
    item('guid', t.guidance || 'none', t.guidance ? (p.inv[t.guidance] || 0) : 0, !!t.guidance);
    if (Screen.UW >= 340) item('trig', 'contactTrigger', p.inv.contactTrigger || 0, t.triggers);
    if (Screen.UW >= 340 && t.icon.mobile) item('fuel', 'fuelTank', Math.ceil((p.fuel || 0) / 10), (p.fuel || 0) > 0);
  },
  drawWind(u, y) {
    const w = this.wind;
    // as 1.5 writes it: "Wind: 36 ▶", or "◀ Wind: 16" when it blows to the left
    const s = w === 0 ? 'No Wind' : w > 0 ? 'Wind: ' + w + ' ▶' : '◀ Wind: ' + (-w);
    Font.right(u, s, Screen.UW - 6, y + 2, vga(37, 37, 63));
  },
  drawBalloons(u) {
    for (const b of this.balloons) {
      const t = b.tank;
      const lines = Font.wrap(b.text, 22);
      const w = Math.max(...lines.map(l => l.length)) * Font.CW + 8, h = lines.length * 10 + 5;
      const tx = t.x / Screen.UX, ty = t.top / Screen.UY;
      let x = Math.round(tx - w / 2), y = Math.round(ty - h - 9);
      x = clamp(x, 1, Screen.UW - w - 1);
      if (y < this.statusH + 2) y = Math.round(t.y / Screen.UY + 6);
      u.fillRect(x, y, w, h, UIC.white);
      u.rect(x, y, w, h, UIC.black);
      lines.forEach((l, i) => Font.draw(u, l.replace(/&/g, '&&'), x + 4, y + 3 + i * 10, UIC.black));
      // tail
      const bx = clamp(Math.round(tx), x + 3, x + w - 4);
      if (y + h < ty) {
        for (let k = 0; k < 5; k++) { u.hline(bx - 2 + Math.floor(k / 2), bx + 2 - Math.floor(k / 2), y + h - 1 + k, UIC.white); u.pset(bx - 3 + Math.floor(k / 2), y + h - 1 + k, UIC.black); u.pset(bx + 3 - Math.floor(k / 2), y + h - 1 + k, UIC.black); }
      }
    }
  }
};

/* =====================================================================
   F9: a log of shots, blasts and terrain changes, for tracking down odd
   happenings. It records all the time (cheaply) and shows on demand.
   ===================================================================== */
const EventLog = {
  on: false, lines: [], base: null, land: null, ver: -1, movedAt: 0, t0: performance.now(),
  add(s) {
    const t = ((performance.now() - this.t0) / 1000).toFixed(1);
    this.lines.push(t + 's  ' + s);
    if (this.lines.length > 40) this.lines.shift();
  },
  who(t) { return t && t.p ? t.p.name || ('#' + t.p.idx) : 'nobody'; },
  spawned(e) {
    try {
      const n = e.constructor.name, x = Math.round(e.x);
      if (n === 'Shot') this.add('shot  ' + this.who(e.owner) + '  ' + (e.wp ? e.wp.id : '?') + (e.sub ? ' (sub)' : '') + '  from x=' + x + (e.owner && !e.sub ? '  angle ' + Math.round(e.owner.angle) + '  power ' + Math.round(e.owner.power) : ''));
      else if (n === 'Explosion') this.add('BLAST  x=' + x + ' y=' + Math.round(e.y) + ' r=' + Math.round(e.r) + '  by ' + this.who(e.o && e.o.owner) + (e.type && e.type !== 'normal' ? '  ' + e.type : ''));
      else if (n !== 'Spark' && n !== 'Ring') this.add(n.toLowerCase() + (isFinite(x) ? '  x=' + x : ''));
    } catch (err) { /* never let the log break the game */ }
  },
  // each frame in battle: once the ground stops moving, note where its surface dropped
  tops() {
    const W = World.W, H = World.H, land = World.land, t = new Int32Array(W);
    for (let x = 0; x < W; x++) { let y = World.top; while (y < H && !land[y * W + x]) y++; t[x] = y; }
    return t;
  },
  watch() {
    if (!World.land) return;
    if (World.land !== this.land) { this.land = World.land; this.base = null; this.ver = World.ver; this.add('--- new battlefield (' + World.W + ' wide) ---'); }
    const now = performance.now();
    if (!this.base) this.base = this.tops();
    if (World.ver !== this.ver) { this.ver = World.ver; this.movedAt = now; return; }
    if (!this.movedAt || now - this.movedAt < 400) return;
    this.movedAt = 0;
    const cur = this.tops(), old = this.base, W = World.W;
    this.base = cur;
    let a = -1, deep = 0;
    for (let x = 0; x <= W; x++) {
      const d = x < W ? cur[x] - old[x] : 0;
      if (d >= 3) { if (a < 0) a = x; deep = Math.max(deep, d); }
      else if (a >= 0) { if (x - a >= 2) this.add('ground lowered  x=' + a + '..' + (x - 1) + '  (' + deep + ' deep)'); a = -1; deep = 0; }
    }
  },
  draw(u) {
    if (!this.on) return;
    const n = Math.min(this.lines.length, 18), x = 4, y0 = Math.round(Screen.UH * 0.3);
    u.fillRect(x - 2, y0 - 3, Math.min(Screen.UW - 4, 300), n * 9 + 16, rgb(10, 12, 20));
    Font.draw(u, 'Event log (F9 to hide)', x, y0, rgb(255, 200, 90));
    this.lines.slice(-n).forEach((l, i) => Font.draw(u, l.replace(/&/g, '&&'), x, y0 + 11 + i * 9, rgb(225, 230, 240)));
  }
};
