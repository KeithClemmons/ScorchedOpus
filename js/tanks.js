'use strict';
/* =====================================================================
   Tanks: icon designs, color ramps, geometry, drawing.
   '1' light, '2' body, '3' shade, '4' dark, 't'/'T' treads, 'k' black
   rows/piv: the full-size design (menus, the lobby, the Remastered art);
   small/spiv: the tank on the battlefield, at the original's size (9 x 7)
   ===================================================================== */

const TankIcons = [
  { name: 'Dome', mobile: true, piv: [[7, 1]], rows: [
    '.....1112.....',
    '....1122223...',
    '...112222233..',
    '.1122222222233',
    '14444444444444',
    '.tTtTtTtTtTtT.',
    '..tttttttttt..'],
    small: ['....1....', '...112...', '..11223..', '122222223', '444444444', 'tTtTtTtTt', '.ttttttt.'], spiv: [[4, 1]] },
  { name: 'Wedge', mobile: true, piv: [[7, 1]], rows: [
    '..............',
    '......12......',
    '....1122223...',
    '..11222222233.',
    '12222222222233',
    '.tTtTtTtTtTtT.',
    '..tttttttttt..'],
    small: ['.........', '....1....', '...1223..', '.11222233', '122222223', 'tTtTtTtTt', '.ttttttt.'], spiv: [[4, 1]] },
  { name: 'Panzer', mobile: true, piv: [[6, 1]], rows: [
    '....11122.....',
    '....12222.....',
    '.1111222222222',
    '.1222222222223',
    '44444444444444',
    'tTtTtTtTtTtTtT',
    '.tttttttttttt.'],
    small: ['..112....', '..123....', '.12222222', '122222223', '444444444', 'tTtTtTtTt', '.ttttttt.'], spiv: [[3, 1]] },
  { name: 'Buggy', mobile: true, piv: [[6, 1]], rows: [
    '.....112......',
    '....12223.....',
    '..112222223...',
    '.12222222222..',
    '1222222222223.',
    '.kTk....kTk...',
    '..k......k....'],
    small: ['...12....', '..1223...', '.1222223.', '12222222.', '122222223', '.kTk.kTk.', '..k...k..'], spiv: [[3, 1]] },
  { name: 'Bunker', mobile: false, piv: [[7, 1]], rows: [
    '.....1112.....',
    '....1222223...',
    '..1122222233..',
    '.122222222223.',
    '12222222222223',
    '34343434343434',
    '44444444444444'],
    small: ['...112...', '..12223..', '.1222223.', '122222223', '122222223', '343434343', '444444444'], spiv: [[4, 1]] },
  { name: 'Tower', mobile: false, piv: [[6, 1]], rows: [
    '....11122.....',
    '....12223.....',
    '.....123......',
    '.....123......',
    '.....123......',
    '...1122233....',
    '..444444444...'],
    small: ['...112...', '...123...', '....2....', '....2....', '....2....', '..11223..', '.4444444.'], spiv: [[4, 1]] },
  { name: 'Mobile Gun', mobile: true, piv: [[4, 2]], rows: [
    '..112.........',
    '.11223........',
    '.12222222223..',
    '1222222222223.',
    '44444444444444',
    '.kTk.kTk.kTk..',
    '..k...k...k...'],
    small: ['.12......', '1223.....', '1222.....', '122222223', '444444444', '.kTk.kTk.', '..k...k..'], spiv: [[2, 2]] },
  { name: 'Triple', mobile: true, triple: true, piv: [[3, 2], [8, 0], [13, 2]], rows: [
    '.......111.......',
    '..11..12223..11..',
    '.1223.12223.1223.',
    '.122222222222223.',
    '12222222222222223',
    '44444444444444444',
    '.tTtTtTtTtTtTtTt.',
    '..tttttttttttttt.'],
    small: ['..1..1..1..', '.12.122.12.', '.122222223.', '12222222223', '44444444444', 'tTtTtTtTtTt', '.ttttttttt.'], spiv: [[2, 2], [5, 0], [8, 2]] }
];

// light/body/shade/dark ramp for a player color
function tankRamp(c) {
  return {
    '1': mixc(c, vga(63, 63, 63), 0.45),
    '2': c,
    '3': scalec(c, 0.62),
    '4': scalec(c, 0.38),
    't': vga(16, 16, 16), 'T': vga(36, 36, 36), 'k': vga(4, 4, 4)
  };
}
// the tank styles a player can pick: the Triple only with the Extended Arsenal, and never in
// the classic look (1.5 had seven)
function tankChoices(classic) {
  return TankIcons.map((ic, i) => i).filter(i => !TankIcons[i].triple || (Cfg.extendedArsenal && !classic));
}
const tankSpriteCache = {};
// 1.5's mag deflector: two field lines over the tank (10 x 8, drawn from the tank's top left, 10 rows up)
const MAG_FIELD = ['..YYYY....', 'YY....YY..', 'Y......YY.', '..YYYY..Y.', 'YY....YY..', 'Y.......Y.', '.........Y', '.........Y'];

function tankSprite(iconIdx, color, small) {
  const key = iconIdx + ':' + color + (small ? 's' : '');
  if (!tankSpriteCache[key]) {
    const spr = makeSprite(small ? TankIcons[iconIdx].small : TankIcons[iconIdx].rows, tankRamp(color));
    spr.tankIcon = iconIdx; spr.tankColor = color;   // lets the Remastered UI draw the vector tank instead
    tankSpriteCache[key] = spr;
  }
  return tankSpriteCache[key];
}

class Tank {
  constructor(player) {
    this.p = player;
    // the Triple is a Remastered addition: without the Extended Arsenal it fights as a Dome
    this.iconIdx = TankIcons[player.icon] && (!TankIcons[player.icon].triple || Cfg.extendedArsenal) ? player.icon : 0;
    this.icon = TankIcons[this.iconIdx];
    this.sv = 1;                                      // vertical sprite scale (1.5 doesn't stretch them)
    this.w = this.icon.small[0].length;
    this.hh = this.icon.small.length * this.sv;       // height in rows
    this.x = 0; this.y = 0;
    this.angle = 90; this.power = 200;
    this.energy = 100; this.alive = true; this.dead = false; this.dying = false;
    this.shield = null;         // {it, energy}
    this.selShield = null;      // item id chosen with 's'
    this.guidance = null;       // item id chosen with 'g'
    this.triggers = false;      // contact triggers armed
    this.falling = false; this.fallFrom = 0; this.fallDist = 0; this.chute = false; this.fallVel = 0;
    this.flash = 0; this.hitFlash = 0;
    this.lastShot = null;       // {angle, power, impactX, impactY} for Tossers
    this.attackers = {};        // player index -> damage taken (for Cyborgs)
    this.killer = null;
    this.shotsInFlight = 0;
    this.balloon = null;
    this.ready = false;         // synchronous mode
    this.keys = 0;              // simultaneous mode: held turn/power keys (bitmask)
    this.slew = null;           // simultaneous mode: where a computer is swinging its turret
    this.tween = null;          // cosmetic: a computer visibly lining up its shot
    this.busy = false;          // has a shot in the air
    this.fx = null;
  }
  get color() { return this.p.color; }
  // damage costs firing power: ORIGINAL 10 per point of energy (as in 1.5), HALF 5, OFF none
  get maxPower() { return Cfg.powerLimit === 'OFF' ? 1000 : Math.round(Cfg.powerLimit === 'ORIGINAL' ? this.energy * 10 : 500 + this.energy * 5); }
  get cx() { return this.x; }
  get cy() { return this.y - this.hh / 2; }
  get left() { return Math.round(this.x - this.w / 2); }
  get top() { return this.y - this.hh; }
  pivot(i) {
    const pv = this.icon.spiv[i || 0];
    return { x: this.left + pv[0] + 0.5, y: this.top + pv[1] * this.sv + 0.5 };
  }
  barrelLen() { return 5; }
  // muzzle position for barrel i
  muzzle(i, ang) {
    const p = this.pivot(i), a = (ang === undefined ? this.angle : ang) * DEG, L = this.barrelLen();
    return { x: p.x + Math.cos(a) * L, y: p.y - Math.sin(a) * L * Screen.ay };
  }
  contains(px, py, pad) {
    pad = pad || 0;
    return px >= this.x - this.w / 2 - pad && px <= this.x + this.w / 2 + pad && py >= this.top - pad && py <= this.y + pad;
  }
  // shield geometry (an ellipse that looks round on screen)
  shieldRx() { return this.w / 2 + 5; }
  inShield(px, py, extra) {
    const rx = this.shieldRx() + (extra || 0), ry = rx * Screen.ay;
    const dx = (px - this.cx) / rx, dy = (py - this.cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  supported() {
    const W = World.W, land = World.land, y = Math.floor(this.y);
    if (y >= World.H) return true;
    if (y < 0) return false;
    const x0 = Math.floor(this.x - 3), x1 = Math.floor(this.x + 3);
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= W) continue;
      if (land[y * W + x]) return true;
    }
    return false;
  }
  // where would the tank come to rest if it fell now?
  landingY() {
    let y = Math.floor(this.y);
    const W = World.W, land = World.land;
    const x0 = Math.floor(this.x - 3), x1 = Math.floor(this.x + 3);
    for (; y < World.H; y++) {
      for (let x = x0; x <= x1; x++) if (x >= 0 && x < W && land[y * W + x]) return y;
    }
    return World.H;
  }
  draw(s) {
    if (!this.alive) return;
    const spr = tankSprite(this.iconIdx, this.color, true);
    let tint = null;
    if (this.hitFlash > 0 && (Math.floor(this.hitFlash * 20) & 1)) tint = () => vga(63, 63, 63);
    else if (this.fx) {
      const k = this.fx.k;
      tint = k === 'bright' ? c => mixc(c, vga(63, 63, 63), 0.55) : k === 'dark' ? c => scalec(c, 0.4)
        : k === 'green' ? () => vga(10, 63, 10) : () => vga(63, 6, 6);
    } else if (this.flash > 0 && (Math.floor(this.flash * 8) & 1)) tint = c => mixc(c, vga(63, 63, 63), 0.6);
    // barrels
    const bc = this.hitFlash > 0 ? vga(63, 63, 63) : mixc(this.color, vga(63, 63, 63), 0.3);
    const n = this.icon.piv.length;
    for (let i = 0; i < n; i++) {
      const spread = this.icon.triple ? (i - 1) * 12 : 0;
      const p = this.pivot(i), m = this.muzzle(i, this.angle + spread);
      s.line(p.x, p.y, m.x, m.y, bc);
      if (this.sv > 1) s.line(p.x, p.y + 1, m.x, m.y + 1, bc);
    }
    s.blit(spr, this.left, this.top, { sy: this.sv, tint });
    // parachute
    if (this.falling && this.chute) {
      const cx = this.x, cy = this.top - 12 * Screen.ay, rx = 9;
      for (let a = 0; a <= 180; a += 4) {
        const px = cx + Math.cos(a * DEG) * rx, py = cy - Math.sin(a * DEG) * 6 * Screen.ay;
        s.pset(px, py, (Math.floor(a / 30) & 1) ? vga(63, 63, 63) : vga(63, 10, 10));
      }
      s.hline(cx - rx, cx + rx, cy, vga(63, 63, 63));
      s.line(cx - rx, cy, this.left + 1, this.top, vga(50, 50, 50));
      s.line(cx + rx, cy, this.left + this.w - 2, this.top, vga(50, 50, 50));
      s.line(cx, cy, cx, this.top, vga(50, 50, 50));
    }
    // shield
    if (this.shield) {
      const it = this.shield.it, frac = clamp(this.shield.energy / it.strength, 0, 1);
      const rx = this.shieldRx(), ry = rx * Screen.ay;
      const c = mixc(vga(10, 10, 14), it.color, 0.35 + 0.65 * frac);
      const t = performance.now() / 1000;
      if (it.mag) {
        // 1.5: magnetic field lines arching over the tank
        const mc = it.id === 'superMag' ? c : mixc(vga(10, 10, 14), vga(63, 63, 23), 0.35 + 0.65 * frac);
        MAG_FIELD.forEach((row, ry0) => {
          for (let cx0 = 0; cx0 < row.length; cx0++) if (row[cx0] === 'Y') s.pset(this.left + cx0, this.top - 10 + ry0, mc);
        });
      } else {
        // 1.5 draws plain shields as a thin white circle (force: magenta; heavy: a thick ring)
        const sc = it.id === 'forceShield' ? vga(63, 25, 63) : vga(63, 63, 63);
        s.ellipse(this.cx, this.cy, rx, ry, sc);
        if (it.id === 'heavyShield') s.ellipse(this.cx, this.cy, rx - 1, ry - Screen.ay, sc);
      }
    }
  }
}
