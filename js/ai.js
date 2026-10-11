'use strict';
/* =====================================================================
   Computer players.
     Moron     - picks an angle and power and shoots
     Shooter   - deadly with a straight line of fire
     Poolshark - banks shots off rebounding walls
     Tosser    - starts rough, refines aim shot after shot
     Chooser   - picks whichever of the above looks best
     Spoiler   - near-perfect shots with wind and gravity (not viscosity)
     Cyborg    - Spoiler aim, nasty target selection
     Unknown   - one of the above, secretly
   ===================================================================== */

const AI = {
  personality(p) {
    if (p.ai !== 'Unknown') return p.ai;
    if (!p.aiHidden) p.aiHidden = pick(['Moron', 'Shooter', 'Poolshark', 'Tosser', 'Chooser', 'Spoiler', 'Cyborg']);
    return p.aiHidden;
  },

  enemies(tank) { return Battle.tanks.filter(t => t.alive && !t.dying && t !== tank && !Battle.sameTeam(t, tank)); },

  chooseTarget(tank) {
    const type = this.personality(tank.p), en = this.enemies(tank);
    if (!en.length) return null;
    const mem = tank.p.aiMem;
    if (type === 'Tosser' && mem.target && mem.target.alive && en.includes(mem.target)) return mem.target;
    if (type === 'Cyborg') {
      let best = null, bs = -Infinity;
      for (const t of en) {
        let s = (100 - t.energy) * 1.2 + (t.p.score - tank.p.score) / 400 + (tank.attackers[t.p.idx] || 0) * 1.5;
        if (t.shield) s -= 25;
        s -= Math.abs(t.x - tank.x) / World.W * 30;
        s += rand(0, 15);
        if (s > bs) { bs = s; best = t; }
      }
      return best;
    }
    if (type === 'Moron') return pick(en);
    // others: favour nearer tanks
    const sorted = en.slice().sort((a, b) => Math.abs(a.x - tank.x) - Math.abs(b.x - tank.x));
    return chance(0.65) ? sorted[0] : pick(sorted);
  },

  // defensive housekeeping at the start of a turn (host only; issued as commands so everyone sees it)
  prepare(tank) {
    const p = tank.p, type = this.personality(p), idx = p.idx;
    if (type === 'Moron') { if (!tank.shield && chance(0.3)) this.engageBestShield(tank); return; }
    // top up with batteries when hurt
    let guard = 0;
    while (tank.energy < 70 && (p.inv.battery || 0) > 0 && !this.hasEnergyWeapon(p, 3) && guard++ < 10) {
      Battle.act({ c: 'batt', tank: idx });
    }
    if (!tank.shield || tank.shield.energy < tank.shield.it.strength * 0.25) this.engageBestShield(tank);
    if (!p.para.deployed && (p.inv.parachute || 0) > 0) Battle.act({ c: 'para', tank: idx, on: true });
  },
  hasEnergyWeapon(p, minBatt) {
    return ((p.inv.laser || 0) + (p.inv.plasmaBlast || 0)) > 0 && (p.inv.battery || 0) <= minBatt;
  },
  engageBestShield(tank) {
    const p = tank.p;
    for (const id of ['superMag', 'heavyShield', 'forceShield', 'shield', 'magDeflector']) {
      if ((p.inv[id] || 0) > 0) {
        if (tank.shield && tank.shield.it.id === id && tank.shield.energy > tank.shield.it.strength * 0.5) return;
        Battle.act({ c: 'shield', tank: p.idx, id }); return;
      }
    }
  },

  targetPoint(t) {
    if (this.aimAt && this.aimAt.tank === t) return { x: this.aimAt.x, y: this.aimAt.y };
    return { x: t.x, y: Math.round(t.y - t.hh / 2) };
  },
  // shields swallow direct hits, so smarter players land the blast right beside them
  besideShield(tank, target) {
    const side = tank.x < target.x ? -1 : 1;
    const x = clamp(Math.round(target.x + side * (target.shieldRx() + 3)), 1, World.W - 2);
    return { tank: target, x, y: Math.min(World.surfaceY(x), World.H - 1) - 1 };
  },

  // --------------------------------------------------------------- aiming
  plan(tank) {
    const type = this.personality(tank.p), mem = tank.p.aiMem;
    const target = this.chooseTarget(tank);
    mem.target = target;
    if (!target) return { angle: tank.angle, power: tank.power, weapon: 'babyMissile' };
    // the same target still unhurt after our last few shots: we're stuck in a rut
    const hp = target.energy + (target.shield ? target.shield.energy : 0);
    mem.stale = mem.last && mem.last.target === target && Math.abs(mem.last.hp - hp) < 0.5 ? (mem.stale || 0) + 1 : 0;
    mem.last = { target, hp };
    const rut = mem.stale >= 3;
    if (rut && type === 'Tosser') mem.tossTarget = null;
    let method = type;
    if (type === 'Chooser') method = this.chooseMethod(tank, target);
    if (type === 'Cyborg') method = 'Cyborg';
    this.aimAt = null;
    const shielded = target.shield && !target.shield.it.deflect && type !== 'Moron' && type !== 'Shooter';
    if (shielded && !rut && (type === 'Cyborg' || type === 'Spoiler' || type === 'Chooser' || chance(0.5))) this.aimAt = this.besideShield(tank, target);
    let plan;
    switch (method) {
      case 'Moron': plan = this.aimMoron(tank, target); break;
      case 'Shooter': plan = this.aimShooter(tank, target); break;
      case 'Poolshark': plan = this.aimPoolshark(tank, target); break;
      case 'Tosser': plan = this.aimTosser(tank, target); break;
      case 'Spoiler': plan = this.aimSpoiler(tank, target, false); break;
      default: plan = this.aimSpoiler(tank, target, true); break;
    }
    plan.target = target;
    if (rut) {
      // shake it up: the longer the rut, the wilder the change
      const k = Math.min(mem.stale - 2, 5);
      plan.angle += rand(-4, 4) * k;
      plan.power *= 1 + rand(-0.06, 0.06) * k;
    }
    this.pickWeapon(tank, target, plan, type);
    plan.angle = clamp(Math.round(plan.angle), 0, 180);
    plan.power = clamp(Math.round(plan.power), 0, tank.maxPower);
    return plan;
  },

  chooseMethod(tank, target) {
    const w = Battle.walls;
    if (w === 'RUBBER' || w === 'SPRING' || w === 'PADDED') { if (!this.lineOfSight(tank, target)) return 'Poolshark'; }
    if (this.lineOfSight(tank, target)) return 'Shooter';
    return chance(0.5) ? 'Spoiler' : 'Tosser';
  },

  lineOfSight(tank, target) {
    const m = tank.muzzle(0, target.x > tank.x ? 30 : 150);
    const tp = this.targetPoint(target);
    const n = Math.ceil(Math.hypot(tp.x - m.x, tp.y - m.y));
    for (let i = 2; i < n - 3; i++) {
      const x = lerp(m.x, tp.x, i / n), y = lerp(m.y, tp.y, i / n);
      if (World.isLand(x, y)) return false;
    }
    return true;
  },

  side(tank, target) { return target.x >= tank.x ? 1 : -1; },
  angleToward(dir, a) { return dir > 0 ? a : 180 - a; },

  aimMoron(tank, target) {
    const dir = this.side(tank, target);
    // wild, but always at least toward the enemy (a shot flying off the other way looked like a bug)
    const angle = Math.round(this.angleToward(dir, chance(0.25) ? rand(12, 88) : rand(25, 80)));
    return { angle, power: rand(150, Math.min(950, tank.maxPower)) };
  },

  aimShooter(tank, target) {
    const tp = this.targetPoint(target), dir = this.side(tank, target);
    const dx = Math.abs(tp.x - tank.x), dy = (tank.cy - tp.y) / World.ay;
    const base = Math.atan2(dy, dx) / DEG;
    for (const elev of [8, 14, 20, 28, 36, 45, 55]) {
      const a = Math.round(this.angleToward(dir, clamp(base + elev, 2, 88)));
      const m = tank.muzzle(0, a);
      const p = Ballistics.solvePower(m, a, tp.x, tp.y, tank.maxPower, { wind: Battle.wind });
      if (p !== null) return { angle: a, power: p * (1 + rand(-0.015, 0.015)) };
    }
    return this.aimMoron(tank, target);
  },

  aimPoolshark(tank, target) {
    const w = Battle.walls;
    if (!(w === 'RUBBER' || w === 'SPRING' || w === 'PADDED')) return this.aimShooter(tank, target);
    const tp = this.targetPoint(target);
    let best = null, be = Infinity;
    for (let a = 10; a <= 170; a += 8) {
      for (let pw = 150; pw <= tank.maxPower; pw += 50) {
        const m = tank.muzzle(0, a), v = Phys.launch(a, pw);
        const r = Ballistics.sim(m.x, m.y, v.vx, v.vy, { land: true, tanks: true, owner: tank, walls: w, drag: true, maxT: 12 });
        if (!r.bounced) continue;
        const e = r.tank === target ? 0 : Math.hypot(r.x - tp.x, (r.y - tp.y) / World.ay);
        if (r.tank === tank) continue;
        if (e < be) { be = e; best = { angle: a, power: pw }; }
      }
    }
    if (best && be < 25) return best;
    return this.aimShooter(tank, target);
  },

  aimTosser(tank, target) {
    const mem = tank.p.aiMem, tp = this.targetPoint(target), dir = this.side(tank, target);
    if (mem.tossTarget === target && mem.lastImpactX !== undefined && mem.tossAngle !== undefined) {
      const want = (tp.x - tank.x) * dir, got = (mem.lastImpactX - tank.x) * dir;
      let power = mem.tossPower;
      if (Math.abs(want - got) > 3) {
        const ratio = clamp((want + 5) / Math.max(5, got + 5), 0.5, 1.8);
        power = mem.tossPower * Math.sqrt(ratio) * (1 + rand(-0.03, 0.03));
      }
      mem.lastImpactX = undefined;
      mem.tossPower = clamp(power, 50, tank.maxPower);
      return { angle: mem.tossAngle, power: mem.tossPower };
    }
    const angle = Math.round(this.angleToward(dir, rand(40, 65)));
    const dist = Math.abs(tp.x - tank.x);
    const est = Math.sqrt(dist / (World.W * 1.2)) * 1000 * rand(0.75, 1.3);
    mem.tossTarget = target; mem.tossAngle = angle; mem.tossPower = clamp(est, 100, tank.maxPower);
    mem.lastImpactX = undefined;
    return { angle, power: mem.tossPower };
  },

  // exact ballistic solution (Spoiler ignores terrain; Cyborg checks the path)
  aimSpoiler(tank, target, careful) {
    const tp = this.targetPoint(target), dir = this.side(tank, target);
    const angles = careful ? [45, 52, 60, 67, 74, 80, 38, 30, 85] : [shuffle([50, 55, 60, 65])[0], 45, 70, 75, 80];
    // "a perfect shot almost every time"
    const miss = () => careful ? (chance(0.1) ? rand(-0.035, 0.035) : 0) : (chance(0.15) ? rand(-0.05, 0.05) : rand(-0.006, 0.006));
    let fallback = null;
    for (const a0 of angles) {
      const a = this.angleToward(dir, a0);
      const m = tank.muzzle(0, a);
      const p = Ballistics.solvePower(m, a, tp.x, tp.y, tank.maxPower, { wind: Battle.wind });
      if (p === null) continue;
      if (!fallback) fallback = { angle: a, power: p };
      if (!careful) break;
      // make sure nothing is in the way
      const v = Phys.launch(a, p);
      const r = Ballistics.sim(m.x, m.y, v.vx, v.vy, { land: true, tanks: true, owner: tank, walls: Battle.walls, drag: false });
      if (r.tank === target || (!r.tank && Math.hypot(r.x - tp.x, (r.y - tp.y) / World.ay) < 6)) return { angle: a, power: p * (1 + miss()) };
    }
    if (!fallback) return this.aimShooter(tank, target);
    return { angle: fallback.angle, power: fallback.power * (1 + miss()) };
  },

  // --------------------------------------------------------------- weapons
  pickWeapon(tank, target, plan, type) {
    const p = tank.p, inv = p.inv;
    const has = id => id === 'babyMissile' || (inv[id] || 0) > 0;
    const dist = Math.abs(target.x - tank.x);
    plan.weapon = 'babyMissile';
    // buried? dig out first
    if (Battle.buried(tank) && type !== 'Moron') {
      for (const id of ['riotBlast', 'riotCharge', 'babyDigger', 'digger']) {
        if (has(id)) { plan.weapon = id; plan.angle = 90; plan.power = 300; return; }
      }
    }
    const sc = scaleFactor();
    const reach = { airStrike: 40, teslaCoil: 10, empBlast: 64, teleporter: 0 };
    const safe = id => { const it = Data.byId[id]; const r = (reach[id] !== undefined ? reach[id] : (it.r || (it.subR ? it.subR * 2.2 : 20))) * sc; return dist > r + 18; };
    if (type === 'Moron') {
      const owned = Data.weapons.filter(w => has(w.id) && !['tracer', 'smokeTracer', 'earthDisrupter'].includes(w.id));
      plan.weapon = pick(owned).id;
    } else {
      // energy weapons at close range / clear line
      const batt = inv.battery || 0;
      if (has('plasmaBlast') && batt >= 3 && dist < (18 + batt * 4) * scaleFactor()) { plan.weapon = 'plasmaBlast'; plan.batteries = Math.min(9, batt); return; }
      if (has('laser') && batt >= 2 && this.laserLine(tank, target)) {
        // lasers cut straight through shields: aim at the tank itself
        plan.weapon = 'laser'; plan.batteries = Math.min(9, batt);
        const m = tank.muzzle(0, target.x > tank.x ? 20 : 160);
        plan.angle = Math.atan2((m.y - target.cy) / World.ay, target.x - m.x) / DEG;
        return;
      }
      // extended arsenal: knock out a strong shield, or chain lightning through a crowd
      if (Cfg.extendedArsenal) {
        if (target.shield && target.shield.energy > 70 && has('empBlast') && safe('empBlast') && chance(0.55)) { plan.weapon = 'empBlast'; return; }
        const crowd = this.enemies(tank).filter(e => e !== target && adist(e.cx, e.cy, target.cx, target.cy) < 60).length;
        if (has('teslaCoil') && (crowd > 0 || chance(0.3))) { plan.weapon = 'teslaCoil'; return; }
      }
      const prefs = target.shield
        ? ['hotNapalm', 'deathsHead', 'nuke', 'bunkerBuster', 'leapFrog', 'funkyBomb', 'airStrike', 'napalm', 'heavySandhog', 'mirv', 'babyNuke', 'sandhog', 'heavyRoller', 'missile']
        : ['deathsHead', 'nuke', 'bunkerBuster', 'funkyBomb', 'airStrike', 'babyNuke', 'mirv', 'hotNapalm', 'leapFrog', 'heavyRoller', 'napalm', 'missile', 'roller', 'babySandhog', 'babyRoller'];
      const pickable = prefs.filter(id => has(id) && safe(id));
      if (pickable.length) {
        // save the big stuff sometimes
        plan.weapon = (pickable.length > 1 && chance(0.25)) ? pickable[1] : pickable[0];
      }
      // MIRVs need a real arc to split
      if ((plan.weapon === 'mirv' || plan.weapon === 'deathsHead')) {
        const a = plan.angle > 90 ? 180 - plan.angle : plan.angle;
        if (a < 35) plan.weapon = has('missile') && safe('missile') ? 'missile' : 'babyMissile';
      }
    }
    // guidance (smart ones only)
    if ((type === 'Cyborg' || type === 'Chooser' || type === 'Spoiler') && !Data.noGuidance[plan.weapon]) {
      for (const id of ['lazyBoy', 'ballisticGuidance', 'heatGuidance']) {
        if ((inv[id] || 0) > 0 && chance(0.6)) { plan.guidance = id; break; }
      }
    }
  },
  laserLine(tank, target) {
    const m = tank.muzzle(0, target.x > tank.x ? 20 : 160);
    const a = Math.atan2((m.y - target.cy) / World.ay, target.x - m.x) / DEG;
    if (a < 0 || a > 180) return false;
    if (target.shield && target.shield.it.laserProof) return false;
    return true;
  },

  // --------------------------------------------------------------- shopping
  shop(p) {
    const type = this.personality(p);
    const buy = id => Shop.buy(p, Data.byId[id], true);
    const avail = it => Shop.visible(p, it) && Shop.price(p, it) <= Game.cashOf(p);
    let guard = 0;
    const budget = () => Game.cashOf(p) * (type === 'Moron' ? 0.95 : 0.8);
    if (type === 'Moron') {
      while (guard++ < 30) {
        const opts = Data.items.filter(it => it.id !== 'babyMissile' && avail(it) && Shop.price(p, it) <= budget());
        if (!opts.length) break;
        if (!buy(pick(opts).id)) break;
      }
      return;
    }
    const plan = [];
    const cash = Game.cashOf(p);
    if (cash > 60000) plan.push('heavyShield', 'superMag');
    if (cash > 35000) plan.push('forceShield', 'shield');
    if (cash > 25000 && Cfg.tanksFall) plan.push('parachute');
    if ((p.inv.plasmaBlast || p.inv.laser) && (p.inv.battery || 0) < 6) plan.push('battery');
    plan.push('deathsHead', 'nuke', 'babyNuke', 'funkyBomb', 'hotNapalm', 'mirv', 'bunkerBuster', 'teslaCoil', 'airStrike', 'leapFrog', 'heavyRoller', 'missile', 'napalm', 'riotCharge');
    if (type === 'Cyborg' || type === 'Chooser' || type === 'Spoiler') plan.push('empBlast');
    if (type === 'Cyborg' || type === 'Chooser') plan.unshift('lazyBoy', 'ballisticGuidance');
    if (type === 'Cyborg' && cash > 50000) plan.push('plasmaBlast', 'battery', 'laser');
    for (const id of plan) {
      const it = Data.byId[id];
      if (!it || !avail(it)) continue;
      if (it.kind === 'shield' && (p.inv[id] || 0) >= 2) continue;
      if (id === 'parachute' && (p.inv.parachute || 0) >= 4) continue;
      if (Shop.price(p, it) > budget()) continue;
      buy(id);
      if (guard++ > 40) break;
    }
    // spend a little more on missiles if rich
    while (guard++ < 60 && Game.cashOf(p) > 30000 && avail(Data.byId.missile) && (p.inv.missile || 0) < 20) buy('missile');
  }
};
