'use strict';
/* =====================================================================
   Menus: main menu + option dialogs, Tank Initialization Panel, round
   standings, game over, System Menu (save / restore / reassign ...).
   ===================================================================== */

// big blocky title letters with a vertical gradient and a hard shadow
function bigText(s, str, x, y, sc, grad, shadow) {
  const draw = (ox, oy, colorFn) => {
    for (let i = 0; i < str.length; i++) {
      const g = Font.glyph(str[i]);
      for (let r = 0; r < 7; r++) {
        const m = g[r];
        if (!m) continue;
        for (let c = 0; c < 5; c++) if (m & (1 << c)) s.fillRect(ox + (i * 6 + c) * sc, oy + r * sc, sc, sc, colorFn(r));
      }
    }
  };
  if (shadow !== undefined) { draw(x + sc, y + sc, () => shadow); draw(x + Math.ceil(sc / 2), y + sc, () => shadow); }
  draw(x, y, grad);
}

const Menus = {
  /* ------------------------------------------------ option sub-menus */
  // the settings that Save Changes stores (volumes and the player list save themselves)
  cfgSnapshot() {
    const o = {};
    for (const k of Object.keys(Data.defaults)) if (k !== 'lastPlayers' && k !== 'musicVolume' && k !== 'sfxVolume') o[k] = Cfg[k];
    return JSON.stringify(o);
  },
  cfgChanged() { return !!this.cfgBase && this.cfgSnapshot() !== this.cfgBase; },
  optionsDialog(key, onClose) {
    const m = Data.menus[key];
    let lw = 0;
    for (const it of m.items) {
      let vw = 0;
      if (it.type === 'cycle') vw = Math.max(...it.values.map(v => Font.width(String(v))));
      else if (it.type === 'num') vw = Math.max(...it.steps.map(v => Font.width(it.fmt ? it.fmt(v) : String(v))));
      else if (it.type === 'text') vw = 90;
      lw = Math.max(lw, Font.width(it.label) + vw + 22);
    }
    const w = Math.min(Screen.UW - 8, Math.max(150, lw + 20));
    const rowH = 15;
    const h = m.items.length * rowH + 26;
    const d = new Dialog({ w, h, title: m.title, onClose: () => { if (onClose) onClose(); } });
    m.items.forEach((it, i) => d.option(it, Cfg, 10, 18 + i * rowH, w - 20));
    UI.push(d);
    return d;
  },

  // Remastered display options, plus the switch between the two looks
  graphicsDialog() {
    const d = this.optionsDialog('graphics');
    d.h += 18; d.center();
    d.button(Gfx.modern ? '&Classic Look  (F2)' : 'Re&mastered Look  (F2)', 10, d.h - 22, d.w - 20, 14, () => { d.close(); Gfx.setModern(!Gfx.modern); });
    return d;
  },

  /* ------------------------------------------------ System Menu */
  systemMenu() {
    if (!Game.active || UI.stack.some(d => d.isSystem)) return;
    const inShop = App.scene instanceof ShopScene;
    const inBattle = App.scene === BattleScene;
    const online = Net.online, boss = !online || Net.isHost();
    const entries = [
      ['&Clear Screen', inBattle, () => { World.clearTraces(); }],
      ['&Mass Kill', inBattle && boss && Battle.state !== 'over' && Battle.state !== 'done', () => confirmBox(['Kill everyone?'], () => Battle.massKill(), null, { pauses: !online })],
      ['&Reassign Players', !online, () => Menus.reassignPlayers()],
      ['Reassign &Teams', !online && Cfg.teams !== 'NONE', () => Menus.reassignTeams()],
      ['&Sound', true, () => { Cfg.sound = !Cfg.sound; if (!Cfg.sound) Sound.flightStop(); }, () => Cfg.sound ? 'ON' : 'OFF'],
      ['Sa&ve Game', inShop && !online, () => Menus.saveGame()],
      ['R&estore Game', !online, () => Menus.restoreGame()],
      online
        ? ['&Leave Game', true, () => confirmBox([Net.isHost() ? 'End the game for everyone?' : 'Leave this network game?'], () => Net.leave())]
        : ['&New Game', true, () => confirmBox(['Abandon this game and', 'start a new one?'], () => Game.toMainMenu(), null, { pauses: true })],
      ['&Quit Game', true, () => confirmBox(['Do you really want to quit?'], () => Game.toMainMenu(), null, { pauses: !online })]
    ];
    const w = 140, h = entries.length * 16 + 24;
    // a network game can't stop for one player's menu
    const d = new Dialog({ w, h, title: 'System Menu', pauses: !online });
    d.isSystem = true;
    entries.forEach(([label, enabled, fn, val], i) => {
      d.button(label, 10, 17 + i * 16, w - 20, 14, () => {
        if (label === '&Sound') { fn(); return; }
        UI.remove(d); fn();
      }, { disabled: () => !enabled, value: val, align: val ? undefined : 'left' });
    });
    UI.push(d);
  },

  reassignPlayers() {
    const ps = Game.players;
    const w = 220, h = ps.length * 15 + 40;
    const d = new Dialog({ w, h, title: 'Reassign Players', pauses: true });
    ps.forEach((p, i) => {
      d.button('&' + ((i + 1) % 10) + ' ' + p.name.replace(/&/g, '&&'), 10, 17 + i * 15, w - 20, 13, () => Menus.editPlayer(p), {
        align: 'left', value: () => p.ai ? p.ai : 'Human'
      });
    });
    d.button('&Done', w / 2 - 30, h - 20, 60, 14, () => d.close());
    UI.push(d);
  },
  editPlayer(p) {
    const types = ['Human'].concat(Data.aiTypes);
    const w = 200, h = 80;
    const d = new Dialog({ w, h, title: 'Player ' + (p.idx + 1), pauses: true });
    const obj = { name: p.name, type: p.ai || 'Human' };
    d.text('&Name:', 10, 20);
    const tf = d.textField(obj, 'name', 50, 17, 140, 16);
    tf.hot = 'n';
    d.option({ key: 'type', label: '&Controlled by', type: 'cycle', values: types }, obj, 10, 36, w - 20);
    d.button('&Done', w / 2 - 30, h - 22, 60, 14, () => {
      p.name = obj.name.trim() || p.name;
      const was = p.ai;
      p.ai = obj.type === 'Human' ? null : obj.type;
      if (p.ai === 'Unknown' && was !== 'Unknown') p.aiHidden = null;
      if (p.ai && !p.aiMem) p.aiMem = {};
      d.close();
    });
    UI.push(d);
  },
  reassignTeams() {
    const ps = Game.players;
    const w = 220, h = ps.length * 15 + 40;
    const d = new Dialog({ w, h, title: 'Reassign Teams', pauses: true });
    ps.forEach((p, i) => {
      d.button('&' + ((i + 1) % 10) + ' ' + p.name.replace(/&/g, '&&'), 10, 17 + i * 15, w - 20, 13, () => { p.team = (p.team + 1) % Game.maxTeams(); }, {
        align: 'left', value: () => 'Team ' + (p.team + 1)
      });
    });
    d.button('&Done', w / 2 - 30, h - 20, 60, 14, () => d.close());
    UI.push(d);
  },

  /* ------------------------------------------------ saved games */
  saveGame() {
    const obj = { name: 'scorch' };
    const w = 200, h = 70;
    const d = new Dialog({ w, h, title: 'Save Game', pauses: true });
    d.text('&File:', 10, 21);
    const tf = d.textField(obj, 'name', 44, 18, 146, 20, () => doSave());
    tf.hot = 'f';
    d.focus = tf;
    const doSave = () => {
      const nm = obj.name.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'scorch';
      const key = 'scorch.save.' + nm;
      const write = () => {
        const ok = Store.set(key, Game.serialize());
        UI.remove(d);
        messageBox([ok ? 'Game saved as "' + nm + '".' : 'Could not save (storage unavailable).'], null, { pauses: true });
      };
      if (Store.get(key, null)) confirmBox(['"' + nm + '" exists. Overwrite it?'], write, null, { pauses: true });
      else write();
    };
    d.button('&Save', w / 2 - 30, h - 22, 60, 14, doSave);
    UI.push(d);
  },
  restoreGame() {
    const keys = Store.keys('scorch.save.').sort();
    if (!keys.length) { messageBox(['There are no saved games.'], null, { pauses: true }); return; }
    const w = 200, h = Math.min(keys.length, 9) * 15 + 40;
    const d = new Dialog({ w, h, title: 'Restore Game', pauses: true });
    keys.slice(0, 9).forEach((k, i) => {
      const data = Store.get(k, null);
      const nm = k.slice('scorch.save.'.length);
      d.button('&' + (i + 1) + ' ' + nm, 10, 17 + i * 15, w - 20, 13, () => {
        UI.remove(d);
        if (data) Game.restore(data); else Sound.error();
      }, { align: 'left', value: () => data ? 'Rd ' + data.round + '/' + data.rounds : '?' });
    });
    d.button('&Cancel', w / 2 - 30, h - 20, 60, 14, () => d.close());
    UI.push(d);
  }
};

/* ================================================================ main menu */
class MainMenuScene {
  constructor() {
    this.pressed = null; this.art = null;
    this.buttons = [
      { label: '&Start', fn: () => Game.start() },
      { label: '&Network...', fn: () => App.set(new NetScene()) },
      { label: '&Players:', value: () => Cfg.players, step: dir => { Cfg.players = ((Cfg.players - 2 + dir + 9) % 9) + 2; } },
      { label: '&Rounds:', value: () => Cfg.rounds, step: dir => {
        const st = Data.roundSteps; let i = st.indexOf(Cfg.rounds); if (i < 0) i = 9;
        Cfg.rounds = st[(i + dir + st.length) % st.length];
      } },
      { label: 'S&ound...', fn: () => Menus.optionsDialog('sound') },
      { label: '&Hardware...', fn: () => Menus.optionsDialog('hardware', () => applyGraphicsMode()) },
      { label: '&Economics...', fn: () => Menus.optionsDialog('economics') },
      { label: 'Ph&ysics...', fn: () => Menus.optionsDialog('physics') },
      { label: '&Landscape...', fn: () => Menus.optionsDialog('landscape') },
      { label: 'Play Op&tions...', fn: () => Menus.optionsDialog('play') },
      { label: '&Weapons...', fn: () => Menus.optionsDialog('weapons') },
      { label: '&Graphics...', fn: () => Menus.graphicsDialog() },
      { label: 'Save &Changes', disabled: () => !Menus.cfgChanged(), fn: () => {
        const ok = saveConfig();
        if (ok) Menus.cfgBase = Menus.cfgSnapshot();
        messageBox([ok ? 'Changes saved.' : 'Could not save (storage unavailable).']);
      } }
    ];
    // as in 1.5, Save Changes stays grey until something has changed
    if (!Menus.cfgBase) Menus.cfgBase = Menus.cfgSnapshot();
    for (const b of this.buttons) b.hot = Font.hotkeyOf(b.label);
  }
  enter() { UI.clear(); Sound.flightStop(); this.art = null; }
  layout() {
    const H = Screen.UH, n = this.buttons.length;
    if (Gfx.modern) {
      const bh = H >= 230 ? 13 : 12, gap = H >= 230 ? 3 : 2, bw = Math.min(112, Math.floor(Screen.UW * 0.34));
      const total = n * bh + (n - 1) * gap, y0 = Math.floor((H - total) / 2) + 2;
      this.buttons.forEach((b, i) => { b.x = 14; b.y = y0 + i * (bh + gap); b.w = bw; b.h = bh; });
      this.panel = { x: 8, y: y0 - 8, w: bw + 12, h: total + 14 };
      return;
    }
    let bh = H >= 230 ? 15 : 13, gap = H >= 230 ? 4 : 3;
    while (n * bh + (n - 1) * gap > H - 8 && bh > 10) { bh--; if (gap > 2) gap--; }
    const total = n * bh + (n - 1) * gap;
    const y0 = Math.floor((H - total) / 2);
    const bw = 96;
    this.buttons.forEach((b, i) => { b.x = 8; b.y = y0 + i * (bh + gap); b.w = bw; b.h = bh; });
    this.panel = { x: bw + 18, y: 6, w: Screen.UW - bw - 24, h: H - 12 };
  }
  activate(b, dir) {
    if (b.disabled && b.disabled()) { Sound.error(); return; }
    Sound.click();
    if (b.step) b.step(dir); else b.fn();
  }
  update() {}
  key(ev) {
    if (ev.k === 'enter') { this.activate(this.buttons[0], 1); return; }
    for (const b of this.buttons) if (b.hot === ev.k) { this.activate(b, ev.shift || ev.alt ? -1 : 1); return; }
  }
  mouse(ev) {
    this.layout();
    if (ev.kind === 'up') {
      const b = this.pressed; this.pressed = null;
      if (b && !b.step && ev.ux >= b.x && ev.ux < b.x + b.w && ev.uy >= b.y && ev.uy < b.y + b.h) this.activate(b, 1);
      return;
    }
    if (ev.kind !== 'down') return;
    for (const b of this.buttons) {
      if (ev.ux >= b.x && ev.ux < b.x + b.w && ev.uy >= b.y && ev.uy < b.y + b.h) {
        this.pressed = b;
        if (b.step) this.activate(b, ev.button === 2 ? -1 : 1);
        return;
      }
    }
  }
  buildArt(w, h) {
    const a = new Surface(w, h);
    const seed = 1234;
    // sunset sky with VGA banding
    const stops = [vga(2, 0, 10), vga(14, 0, 26), vga(36, 4, 36), vga(58, 12, 22), vga(63, 34, 6), vga(63, 54, 18)];
    const horizon = Math.floor(h * 0.78);
    for (let y = 0; y < h; y++) {
      let t = Math.floor(clamp(y / horizon, 0, 1) * 22) / 21;
      const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f));
      a.hline(0, w - 1, y, vgaq(mixc(stops[i], stops[i + 1], f - i)));
    }
    for (let i = 0; i < w * h / 120; i++) {
      const x = Math.floor(hash2(i, 1, seed) * w), y = Math.floor(hash2(i, 2, seed) * h * 0.45);
      const b = 30 + hash2(i, 3, seed) * 33;
      a.pset(x, y, vga(b, b, b));
    }
    // striped retro sun
    const sx = w * 0.72, sy = h * 0.56, sr = h * 0.15;
    for (let y = -sr; y <= sr; y++) {
      if ((Math.floor((y + sr) / 3) & 1) && y > -sr * 0.3) continue;
      const hw = Math.sqrt(Math.max(0, sr * sr - y * y));
      a.hline(sx - hw, sx + hw, sy + y, vga(63, 56 - (y + sr) / sr * 14, 16));
    }
    // two mountain layers
    const ridge = (base, amp, sc, sd, col) => {
      const tops = [];
      for (let x = 0; x < w; x++) {
        const v = fbm2(x / sc, 0.5, sd, 4);
        const top = Math.floor(base - v * amp);
        tops.push(top);
        for (let y = top; y < h; y++) a.pset(x, y, col(y - top, y));
      }
      return tops;
    };
    ridge(horizon + 6, h * 0.55, w * 0.35, seed + 1, (d) => vga(26 - Math.min(20, d * 0.3), 8, 28 - Math.min(20, d * 0.3)));
    const front = ridge(h * 1.02, h * 0.5, w * 0.22, seed + 7, (d) => vga(Math.max(4, 34 - d * 0.5), Math.max(2, 18 - d * 0.35), 4));
    // tanks + a shot in flight + an explosion
    const surf = x => front[clamp(Math.floor(x), 0, w - 1)];
    const tank = (x, col, flip) => {
      const y = surf(x);
      const spr = tankSprite(0, col);
      a.blit(spr, x - 7, y - 7, { flip });
      const ang = flip ? 125 : 55;
      a.line(x, y - 6, x + Math.cos(ang * DEG) * 7, y - 6 - Math.sin(ang * DEG) * 7, mixc(col, vga(63, 63, 63), 0.3));
      return y;
    };
    const x1 = Math.floor(w * 0.16), x2 = Math.floor(w * 0.86);
    const y1 = tank(x1, Data.playerColors[0], false);
    const y2 = tank(x2, Data.playerColors[1], true);
    for (let i = 4; i < 44; i += 2) {
      const t = i / 60;
      const x = x1 + (x2 - x1) * t * 1.05, y = y1 - 10 - Math.sin(t * Math.PI * 1.02) * h * 0.55;
      a.pset(x, y, vga(63, 63, 63));
    }
    const ex = x1 + (x2 - x1) * 0.62, ey = surf(Math.floor(ex));
    for (let r = 11; r >= 1; r--) a.fillEllipse(ex, ey, r, r, FIRE[clamp(Math.floor(8 - r * 0.7), 0, 7)]);
    return a;
  }
  drawModern(dt) {
    this.layout();
    Gfx.backdrop('title', dt);
    const s = Screen.ui, ctx = Gfx.ctx, P = this.panel;
    s.panel(P.x, P.y, P.w, P.h, { top: 'rgba(14,18,30,0.72)', bottom: 'rgba(8,10,18,0.78)' });
    for (const b of this.buttons) {
      const v = b.value ? b.value() : undefined;
      drawButton(s, b.x, b.y, b.w, b.h, b.label, { pressed: this.pressed === b, value: v, align: 'left', disabled: !!(b.disabled && b.disabled()) });
    }
    // the logo sits down in the mountain, just below the lowest ground under it, so it reads against
    // the dark rock and leaves the peaks and sky clear (never lower than the credits allow)
    const cx = Gfx.UXp((P.x + P.w + Screen.UW) / 2);
    const size = Math.min(Gfx.pf.w * 0.085, Gfx.pf.h * 0.12);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = '400 ' + size.toFixed(1) + 'px ' + FONT_DISPLAY;
    const fs = Math.max(10 * Gfx.dpr, size * 0.16);
    let top = Gfx.pf.y + Gfx.pf.h * 0.1;
    const tw = Title.world;
    if (tw) {
      const half = ctx.measureText('SCORCHED').width / 2 + size * 0.2;
      const wx0 = Math.max(0, Math.floor((cx - half - Gfx.pf.x) * tw.W / Gfx.pf.w));
      const wx1 = Math.min(tw.W - 1, Math.ceil((cx + half - Gfx.pf.x) * tw.W / Gfx.pf.w));
      // most of the ground under it (a narrow valley doesn't count)
      const ys = [];
      for (let x = wx0; x <= wx1; x++) ys.push(tw.surfaceY(x));
      ys.sort((p, q) => p - q);
      const low = ys.length ? ys[Math.floor((ys.length - 1) * 0.7)] : tw.top;
      const ground = Gfx.pf.y + low * Gfx.pf.h / tw.H;
      const block = size * 3.1, floor = Gfx.pf.y + Gfx.pf.h - fs * 5 - block;
      top = clamp(ground + size * 0.15, top, Math.max(top, floor));
    }
    const lines = ['SCORCHED', 'OPUS'];
    lines.forEach((l, i) => {
      const y = top + size * (1 + i * 1.02);
      ctx.save();
      ctx.shadowColor = 'rgba(255,90,30,0.55)'; ctx.shadowBlur = size * 0.35;
      const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.45, '#ffb640'); g.addColorStop(1, '#e8482f');
      ctx.fillStyle = g; ctx.fillText(l, cx, y);
      ctx.restore();
      ctx.lineWidth = Math.max(1, size * 0.025); ctx.strokeStyle = 'rgba(60,10,20,0.55)'; ctx.strokeText(l, cx, y);
    });
    const ry = top + size * 2.55;
    ctx.font = '700 ' + (size * 0.26).toFixed(1) + 'px ' + FONT_UI;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = (size * 0.12).toFixed(1) + 'px';
    ctx.fillStyle = '#ffe2a8'; ctx.fillText('REMASTERED', cx, ry);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.font = '600 ' + (size * 0.2).toFixed(1) + 'px ' + FONT_UI;
    ctx.fillStyle = 'rgba(255,230,210,0.8)'; ctx.fillText('The Mother of All Games', cx, ry + size * 0.42);
    // credits + hint
    ctx.font = '600 ' + fs.toFixed(1) + 'px ' + FONT_UI;
    ctx.fillStyle = 'rgba(235,225,240,0.75)';
    ctx.fillText('A tribute to Scorched Earth 1.5  ·  (c) 1991-1995 Wendell Hicken', cx, Gfx.pf.y + Gfx.pf.h - fs * 2.4);
    ctx.fillStyle = 'rgba(255,200,120,0.8)';
    ctx.fillText('F2  classic graphics    ·    Enter  start', cx, Gfx.pf.y + Gfx.pf.h - fs * 1.0);
    ctx.textAlign = 'left';
  }
  draw() {
    this.layout();
    const s = Screen.ui, W = Screen.UW, H = Screen.UH;
    Screen.main.clear(vga(0, 0, 0));
    s.fillRect(0, 0, W, H, UIC.face);
    bevel(s, 0, 0, W, H, true);
    for (const b of this.buttons) {
      const v = b.value ? b.value() : undefined;
      drawButton(s, b.x, b.y, b.w, b.h, b.label, { pressed: this.pressed === b, value: v, align: 'left', disabled: !!(b.disabled && b.disabled()) });
    }
    const P = this.panel;
    if (!this.art || this.art.w !== P.w - 4 || this.art.h !== P.h - 4) this.art = this.buildArt(P.w - 4, P.h - 4);
    bevel(s, P.x, P.y, P.w, P.h, false);
    bevel(s, P.x + 1, P.y + 1, P.w - 2, P.h - 2, false);
    s.blit(this.art, P.x + 2, P.y + 2);
    // title
    const sc = P.w >= 230 ? 3 : 2;
    const grad = r => [vga(63, 63, 40), vga(63, 60, 16), vga(63, 48, 4), vga(63, 34, 0), vga(60, 20, 0), vga(52, 8, 0), vga(40, 2, 0)][r];
    const t1 = 'SCORCHED', t2 = 'OPUS';
    const tw1 = t1.length * 6 * sc - sc, tw2 = t2.length * 6 * sc - sc;
    const ty = P.y + 10;
    bigText(s, t1, Math.floor(P.x + (P.w - tw1) / 2), ty, sc, grad, vga(8, 0, 4));
    bigText(s, t2, Math.floor(P.x + (P.w - tw2) / 2), ty + 8 * sc + 2, sc, grad, vga(8, 0, 4));
    const cy = ty + 16 * sc + 8;
    Font.center(s, '- The Mother of All Games -', P.x + P.w / 2, cy, vga(63, 63, 50), { shadow: vga(10, 0, 10) });
    Font.center(s, 'A tribute to Scorched Earth 1.5', P.x + P.w / 2, P.y + P.h - 22, vga(56, 56, 63), { shadow: vga(0, 0, 0) });
    Font.center(s, '(c) 1991-1995 Wendell Hicken', P.x + P.w / 2, P.y + P.h - 12, vga(44, 44, 56), { shadow: vga(0, 0, 0) });
  }
}

/* ---------------- end-of-game awards (Remastered) ---------------- */
function gameAwards() {
  const ps = Game.players.filter(p => p.stats);
  const best = (f, ok) => {
    let top = null, v = -Infinity;
    for (const p of ps) { const x = f(p.stats, p); if ((!ok || ok(p.stats)) && x > v) { v = x; top = p; } }
    return top && v > 0 ? { p: top, v } : null;
  };
  const out = [];
  const add = (title, r, fmt) => { if (r) out.push({ title, player: r.p, value: fmt(r.v, r.p.stats) }); };
  add('Demolition Expert', best(s => s.dmg), v => Math.round(v) + ' damage dealt');
  add('Grim Reaper', best(s => s.kills), v => v + (v === 1 ? ' kill' : ' kills'));
  add('Sharpshooter', best(s => s.hits / s.shots, s => s.shots >= 4), (v, s) => Math.round(v * 100) + '% of ' + s.shots + ' shots hit');
  add('Heavy Hitter', best(s => s.bestHit), v => Math.round(v) + ' damage in one blast');
  add('Long Shot', best(s => s.longest), v => 'a kill from ' + Math.round(v) + ' paces');
  add('Survivor', best(s => s.survived), v => 'alive at the end of ' + v + (v === 1 ? ' round' : ' rounds'));
  add('Big Spender', best(s => s.spent), v => money(v) + ' spent');
  add('Friendly Fire', best(s => s.selfDmg), v => Math.round(v) + ' damage to self');
  return out.slice(0, 6);
}

/* ================================================================ Tank Initialization Panel */
class PlayerSetupScene {
  constructor(idx, p, onDone) {
    this.idx = idx; this.p = p; this.onDone = onDone;
    this.capture = null;
  }
  enter() {
    UI.clear();
    if (!Gfx.modern) { this.enterClassic(); return; }
    const p = this.p;
    const w = Math.min(Screen.UW - 8, 290), h = Math.min(Screen.UH - 8, 196);
    const d = new Dialog({ w, h, title: 'Player ' + (this.idx + 1), closeOnOutside: false, escCloses: false });
    this.d = d;
    d.titleColor = scalec(p.color, 0.55);
    const isHuman = () => !p.ai;
    // human / computer selector
    const sel = (icon, human, x) => d.add({ x, y: 16, w: 26, h: 24, kind: 'sel', draw(s) {
      const on = isHuman() === human;
      bevel(s, d.x + this.x, d.y + this.y, this.w, this.h, !on, on ? UIC.light : UIC.face);
      Icons.draw(s, icon, d.x + this.x + 7, d.y + this.y + 7);
    }, click: () => this.setHuman(human) });
    sel('human', true, 10);
    sel('computer', false, 40);
    // name
    const nameLbl = d.text(() => isHuman() ? '&Name:' : 'Name:', 74, 20);
    nameLbl.hidden = () => false;
    const tf = d.textField(p, 'name', 110, 17, w - 120, 16, () => {});
    tf.hot = 'n';
    tf.hidden = () => !isHuman();
    d.text(() => isHuman() ? '' : p.name, 112, 20, UIC.blue);
    // computer types
    Data.aiTypes.forEach((t, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      d.add({ label: Data.aiLabels[i], x: 74 + col * 92, y: 36 + row * 12, w: 88, h: 11, kind: 'radio', hidden: () => isHuman(), draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, on = p.ai === t;
        s.ellipse(X + 4, Y + 4, 3, 3, UIC.lo);
        if (on) s.fillEllipse(X + 4, Y + 4, 1.6, 1.6, UIC.black);
        Font.draw(s, this.label, X + 11, Y + 1, UIC.text, { hotColor: UIC.hot });
      }, click: () => { p.ai = t; p.aiHidden = null; Sound.click(); } });
    });
    // simultaneous mode keys
    const keyNames = [['ccw', '↺'], ['cw', '↻'], ['up', '▲'], ['down', '▼'], ['fire', 'Fire'], ['weapon', 'Wpn']];
    const kLabels = ['Turn left', 'Turn right', 'Power up', 'Power dn', 'Fire', 'Weapon'];
    keyNames.forEach(([k], i) => {
      const col = i % 3, row = Math.floor(i / 3);
      d.add({ x: 74 + col * 68, y: 38 + row * 24, w: 64, h: 22, kind: 'key', hidden: () => !isHuman() || Cfg.mode !== 'SIMULTANEOUS', draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, cap = this.dlg.scene.capture === k;
        Font.draw(s, kLabels[i], X, Y, UIC.text);
        bevel(s, X, Y + 9, 60, 12, false, cap ? vga(63, 63, 30) : UIC.field);
        Font.draw(s, cap ? '?' : keyLabel(p.keys[k]), X + 3, Y + 11, UIC.black);
      }, click: () => { this.capture = k; } });
    });
    d.scene = this;
    // team
    d.add({ label: 'T&eam:', x: 74, y: 88, w: 90, h: 13, kind: 'button', hidden: () => Cfg.teams === 'NONE', draw(s) {
      drawButton(s, d.x + this.x, d.y + this.y, this.w, this.h, this.label, { value: p.team + 1, pressed: d.pressed === this });
    }, click: b => { p.team = (p.team + (b === 2 ? Game.maxTeams() - 1 : 1)) % Game.maxTeams(); Sound.click(); } });
    // tank icons
    d.text('Tank:', 10, h - 64);
    const choices = tankChoices(false), n = choices.length, cw = Math.floor((w - 20) / n);
    if (!choices.includes(p.icon)) p.icon = choices[0];
    choices.forEach((i, k) => {
      const ic = TankIcons[i];
      d.add({ x: 10 + k * cw, y: h - 54, w: cw - 2, h: 26, kind: 'icon', draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, on = p.icon === i;
        bevel(s, X, Y, this.w, this.h, !on, on ? vga(20, 20, 24) : vga(12, 12, 14));
        const spr = tankSprite(i, p.color);
        s.blit(spr, X + Math.floor((this.w - spr.w) / 2), Y + Math.floor((this.h - spr.h) / 2) + 1);
        const pv = ic.piv;
        for (let k = 0; k < pv.length; k++) {
          const px = X + Math.floor((this.w - spr.w) / 2) + pv[k][0], py = Y + Math.floor((this.h - spr.h) / 2) + 1 + pv[k][1];
          s.line(px, py, px + 4, py - 4, mixc(p.color, UIC.white, 0.3));
        }
        if (!ic.mobile) Font.draw(s, 'F', X + 2, Y + 1, vga(40, 40, 40));
      }, click: () => { p.icon = i; Sound.click(); } });
    });
    d.text(() => TankIcons[p.icon].name + (TankIcons[p.icon].mobile ? '' : ' (fixed emplacement - no fuel)') + (TankIcons[p.icon].triple ? ' - 3 shots w/ missiles' : ''), 44, h - 64, UIC.dis);
    d.button('&Done', w / 2 - 30, h - 21, 60, 14, () => this.done());
    d.onEnter = () => this.done();
    d.onKey = ev => {
      if (this.capture) {
        if (ev.k !== 'escape') { p.keys[this.capture] = ev.k; Sound.click(); }
        this.capture = null; return true;
      }
      if (ev.k === 'tab') { this.setHuman(!isHuman()); return true; }
      if (ev.k === 'arrowleft' || ev.k === 'arrowright') {
        const k = Math.max(0, choices.indexOf(p.icon));
        p.icon = choices[(k + (ev.k === 'arrowleft' ? n - 1 : 1)) % n]; return true;
      }
      if (!isHuman()) {
        const i = Data.aiLabels.findIndex(l => Font.hotkeyOf(l) === ev.k);
        if (i >= 0) { p.ai = Data.aiTypes[i]; p.aiHidden = null; Sound.click(); return true; }
      }
      if (ev.k === 'd' && !d.focus) { this.done(); return true; }
      return false;
    };
    if (isHuman()) d.focus = tf;
    UI.push(d);
  }
  // classic look: laid out like 1.5's player setup
  enterClassic() {
    const p = this.p, simul = Cfg.mode === 'SIMULTANEOUS', isHuman = () => !p.ai;
    const w = Math.min(Screen.UW - 8, 224), gh = simul ? 58 : 34, h = 18 + gh + 56;
    const d = new Dialog({ w, h, title: 'Player ' + (this.idx + 1) + ' (of ' + Cfg.players + ')', closeOnOutside: false, escCloses: false });
    this.d = d; d.scene = this;
    d.titleColor = scalec(p.color, 0.55);
    // the sunken box: computer types, or a human's name (and keys)
    d.add({ x: 6, y: 13, w: w - 12, h: gh, kind: 'label', draw(s) { bevel(s, d.x + this.x, d.y + this.y, this.w, this.h, false, UIC.face); } });
    const order = ['Moron', 'Tosser', 'Cyborg', 'Shooter', 'Chooser', 'Unknown', 'Poolshark', 'Spoiler'];
    order.forEach((t, j) => {
      const i = Data.aiTypes.indexOf(t);
      if (i < 0) return;
      const col = j % 3, row = Math.floor(j / 3);
      d.add({ label: Data.aiLabels[i], x: 10 + col * 70, y: 16 + row * 10, w: 68, h: 10, kind: 'radio', hidden: () => isHuman(), draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, on = p.ai === t;
        s.fillEllipse(X + 4, Y + 4, 3, 3, on ? UIC.white : UIC.dark);
        s.ellipse(X + 4, Y + 4, 3, 3, UIC.lo);
        Font.draw(s, this.label, X + 10, Y, UIC.text, { hotColor: UIC.hot });
      }, click: () => { p.ai = t; p.aiHidden = null; Sound.click(); } });
    });
    d.text('&Name:', 12, 19).hidden = () => !isHuman();
    const tf = d.textField(p, 'name', 50, 16, w - 62, 16, () => {});
    tf.hot = 'n'; tf.hidden = () => !isHuman();
    const keyNames = ['ccw', 'cw', 'up', 'down', 'fire', 'weapon'], kLabels = ['Left', 'Right', 'Up', 'Down', 'Fire', 'Weapon'];
    keyNames.forEach((k, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      d.add({ x: 12 + col * 68, y: 36 + row * 17, w: 64, h: 15, kind: 'key', hidden: () => !isHuman() || !simul, draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, cap = d.scene.capture === k;
        Font.draw(s, kLabels[i] + ':', X, Y + 2, UIC.text);
        bevel(s, X + 34, Y, 30, 12, false, cap ? vga(63, 63, 30) : UIC.field);
        Font.draw(s, cap ? '?' : keyLabel(p.keys[k]).slice(0, 4), X + 36, Y + 2, UIC.black);
      }, click: () => { this.capture = k; } });
    });
    // tank icons over a slider (1.5's seven: no Triple)
    const choices = tankChoices(true), ty = 16 + gh, n = choices.length, cw = Math.floor((w - 16) / n);
    if (!choices.includes(p.icon)) p.icon = choices[0];
    choices.forEach((i, k) => {
      const ic = TankIcons[i];
      d.add({ x: 8 + k * cw, y: ty, w: cw - 4, h: 11, kind: 'icon', draw(s) {
        const X = d.x + this.x, Y = d.y + this.y;
        bevel(s, X, Y, this.w, this.h, true, UIC.face);
        const spr = tankSprite(i, p.color, true), ox = X + Math.floor((this.w - spr.w) / 2), oy = Y + Math.floor((this.h - spr.h) / 2) + 1;
        for (const pv of ic.spiv) s.line(ox + pv[0], oy + pv[1], ox + pv[0] + 3, oy + pv[1] - 3, mixc(p.color, UIC.white, 0.3));
        s.blit(spr, ox, oy);
      }, click: () => { p.icon = i; Sound.click(); } });
    });
    d.add({ x: 8, y: ty + 13, w: n * cw - 4, h: 8, kind: 'slider', draw(s) {
      const X = d.x + this.x, Y = d.y + this.y;
      s.hline(X, X + this.w - 1, Y + 3, UIC.lo); s.hline(X, X + this.w - 1, Y + 4, UIC.hi);
      bevel(s, X + Math.max(0, choices.indexOf(p.icon)) * cw + Math.floor((cw - 4) / 2) - 2, Y, 5, 8, true, UIC.face);
    }, click: () => { const mx = Input.ux - d.x - 8; p.icon = choices[clamp(Math.floor(mx / cw), 0, n - 1)]; Sound.click(); } });
    d.text(() => TankIcons[p.icon].name + (TankIcons[p.icon].triple ? ' (3 shots)' : TankIcons[p.icon].mobile ? '' : ' (fixed)'), 8, ty + 23, UIC.dis);
    // computer / human: two icons over a little slider
    const sy = h - 22;
    d.add({ x: 8, y: sy, w: 44, h: 19, kind: 'switch', draw(s) {
      const X = d.x + this.x, Y = d.y + this.y;
      Icons.draw(s, 'computer', X + 2, Y, { gray: isHuman() });
      Icons.draw(s, 'human', X + 26, Y, { gray: !isHuman() });
      s.hline(X, X + 40, Y + 14, UIC.lo); s.hline(X, X + 40, Y + 15, UIC.hi);
      bevel(s, X + (isHuman() ? 30 : 4), Y + 11, 5, 8, true, UIC.face);
    }, click: () => this.setHuman(!isHuman()) });
    d.add({ label: 'T&eam:', x: 60, y: h - 19, w: 64, h: 13, kind: 'button', hidden: () => Cfg.teams === 'NONE', draw(s) {
      drawButton(s, d.x + this.x, d.y + this.y, this.w, this.h, this.label, { value: p.team + 1, pressed: d.pressed === this });
    }, click: b => { p.team = (p.team + (b === 2 ? Game.maxTeams() - 1 : 1)) % Game.maxTeams(); Sound.click(); } });
    d.button('&Done', w - 70, h - 19, 60, 13, () => this.done());
    d.onEnter = () => this.done();
    d.onKey = ev => {
      if (this.capture) {
        if (ev.k !== 'escape') { p.keys[this.capture] = ev.k; Sound.click(); }
        this.capture = null; return true;
      }
      if (ev.k === 'tab') { this.setHuman(!isHuman()); return true; }
      if (ev.k === 'arrowleft' || ev.k === 'arrowright') {
        const k = Math.max(0, choices.indexOf(p.icon));
        p.icon = choices[(k + (ev.k === 'arrowleft' ? n - 1 : 1)) % n]; return true;
      }
      if (!isHuman()) {
        const i = Data.aiLabels.findIndex(l => Font.hotkeyOf(l) === ev.k);
        if (i >= 0) { p.ai = Data.aiTypes[i]; p.aiHidden = null; Sound.click(); return true; }
      }
      if (ev.k === 'd' && !d.focus) { this.done(); return true; }
      return false;
    };
    if (isHuman()) d.focus = tf;
    UI.push(d);
  }
  setHuman(h) {
    const p = this.p;
    if (h) { p.ai = null; this.d.focus = this.d.ctls.find(c => c.kind === 'text'); if (!p.humanName) p.name = ''; else p.name = p.humanName; }
    else {
      if (!p.ai) { p.humanName = p.name; p.ai = 'Moron'; }
      p.name = Game.computerName(p);
      this.d.focus = null;
    }
    Sound.click();
  }
  done() {
    const p = this.p;
    if (!p.ai) {
      p.name = p.name.trim() || ('Player ' + (this.idx + 1));
      if (Cfg.mode === 'SIMULTANEOUS') {
        const used = Object.values(p.keys);
        if (new Set(used).size !== used.length) { Sound.error(); messageBox(['Each action needs its own key.']); return; }
      }
    } else if (!p.name) p.name = Game.computerName(p);
    UI.clear();
    Sound.seq([[523, 0.05], [784, 0.08]], 0.4);
    this.onDone();
  }
  update() {}
  key(ev) { UI.key(ev); }
  mouse(ev) { UI.mouse(ev); }
  drawModern(dt) {
    Gfx.backdrop('menu', dt);
    // wash the screen in the player's color
    const ctx = Gfx.ctx, col = c3(this.p.color);
    const g = ctx.createLinearGradient(0, 0, Gfx.cw, Gfx.ch);
    g.addColorStop(0, rgba(col, 0.28)); g.addColorStop(1, rgba(col, 0.06));
    ctx.fillStyle = g; ctx.fillRect(0, 0, Gfx.cw, Gfx.ch);
  }
  draw() {
    const s = Screen.ui, W = Screen.UW, H = Screen.UH, c = this.p.color;
    Screen.main.clear(0);
    // as in 1.5: vertical bands of the player's color, darkest a third of the way across
    for (let x = 0; x < W; x++) {
      const b = Math.floor(x / Math.max(1, W / 36)) / 36, k = 0.18 + 0.82 * Math.min(1, Math.abs(b - 0.3) / 0.7);
      const col = scalec(c, k);
      for (let y = 0; y < H; y++) s.buf[y * W + x] = col;
    }
  }
}
function keyLabel(k) {
  if (!k) return '-';
  const m = { arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', space: 'Space', enter: 'Enter', shift: 'Shift', control: 'Ctrl', tab: 'Tab', backspace: 'Bksp' };
  return m[k] || (k.length === 1 ? k.toUpperCase() : k.slice(0, 7));
}

/* ================================================================ round standings */
class StandingsScene {
  constructor(o) { this.o = o; this.t = 0; }
  enter() { UI.clear(); if (this.o.final) Sound.gameOver(); else Sound.roundOver(); }
  update(dt) { this.t += dt; }
  // in a network game the host decides when the next round starts
  canContinue() { return !this.o.online || this.o.final || Net.isHost(); }
  key(ev) { if (this.t > 0.4 && this.canContinue()) this.o.onContinue(); }
  mouse(ev) { if (ev.kind === 'down' && this.t > 0.4 && this.canContinue()) this.o.onContinue(); }
  drawModern(dt) {
    const ctx = Gfx.ctx, o = this.o;
    if (!o.final && Battle.tanks && Battle.tanks.length && World.W === Screen.W) Fx.drawWorld(ctx, dt, { world: World, battle: Battle, dim: 0.55 });
    else Gfx.backdrop('menu', dt);
    const ps = Game.players.slice().sort((a, b) => Game.rankValue(b) - Game.rankValue(a));
    const greedy = Cfg.scoringMode === 'GREEDY';
    const fs = worldFont(1.05), rowH = fs * 1.9;
    const awards = o.final ? gameAwards() : [];
    const awardRows = Math.ceil(awards.length / 3);
    const W = Math.min(Gfx.pf.w * 0.7, 820 * Gfx.dpr);
    const H = fs * 7.2 + ps.length * rowH + (Cfg.teams !== 'NONE' ? fs * 1.6 : 0) + (awardRows ? fs * 2.4 + awardRows * fs * 4.4 : 0);
    const x = Gfx.pf.x + (Gfx.pf.w - W) / 2, y = Gfx.pf.y + Math.max(fs, (Gfx.pf.h - H) / 2);
    const pop = clamp(this.t * 5, 0, 1);
    ctx.globalAlpha = pop;
    VUI.panel((x - Gfx.pf.x) / Gfx.ux, (y - Gfx.pf.y) / Gfx.uy, W / Gfx.ux, H / Gfx.uy, { accent: o.final ? '#ffb640' : undefined });
    const cx = x + W / 2;
    Hud.txt(ctx, o.final ? 'FINAL STANDINGS' : 'ROUND ' + Game.round + ' OF ' + Game.rounds, cx, y + fs * 1.3, fs * 1.25, '#eef2f8', { align: 'center', display: true, weight: 400 });
    let msg, mcol = '#6ac2ff';
    if (o.final) { msg = ps[0].name + ' wins the game!'; mcol = rgba(mix3(c3(ps[0].color), WHITE3, 0.3), 1); }
    else if (o.mass) msg = 'Mass kill!';
    else if (!o.winners.length) msg = 'Nobody survived!';
    else if (o.winners.length === 1) { msg = o.winners[0].name + ' wins the round!'; mcol = rgba(mix3(c3(o.winners[0].color), WHITE3, 0.3), 1); }
    else msg = 'Team ' + (o.winners[0].team + 1) + ' wins the round!';
    Hud.txt(ctx, msg, cx, y + fs * 2.7, fs * 1.1, mcol, { align: 'center', weight: 700 });
    // table
    const cName = x + W * 0.12, cScore = x + W * 0.62, cCash = x + W * 0.82, cWins = x + W - fs * 1.2;
    let ty = y + fs * 4.3;
    const head = (t, px, al) => Hud.txt(ctx, t, px, ty, fs * 0.72, '#8f9bb5', { align: al, weight: 700 });
    head('PLAYER', cName, 'left'); head(greedy ? 'WORTH' : 'SCORE', cScore, 'right'); head('CASH', cCash, 'right'); head('WINS', cWins, 'right');
    ty += fs * 0.9;
    ctx.fillStyle = 'rgba(160,184,230,0.18)'; ctx.fillRect(x + fs, ty, W - fs * 2, Math.max(1, Gfx.dpr));
    ty += fs * 0.3;
    const won = new Set((o.winners || []).map(p => p.idx));
    ps.forEach((p, i) => {
      const ry = ty + i * rowH, mid = ry + rowH / 2;
      if (won.has(p.idx) || (o.final && i === 0)) { ctx.fillStyle = 'rgba(255,182,64,0.1)'; VUI.rr(x + fs * 0.6, ry + 2, W - fs * 1.2, rowH - 4, rowH * 0.25); ctx.fill(); }
      Hud.txt(ctx, String(i + 1), x + fs * 1.6, mid, fs, '#8f9bb5', { align: 'center', weight: 700 });
      ctx.fillStyle = rgba(c3(p.color), 1);
      ctx.beginPath(); ctx.arc(cName - fs * 0.9, mid, fs * 0.36, 0, TAU); ctx.fill();
      Hud.txt(ctx, p.name, cName, mid, fs, '#eef2f8', { weight: 700 });
      if (p.ai) Hud.txt(ctx, p.ai === 'Unknown' ? '?' : p.ai, cName + ctx.measureText(p.name).width + fs * 0.6, mid, fs * 0.7, '#6f7a93', { weight: 600 });
      Hud.txt(ctx, greedy ? money(Game.netWorth(p)) : commas(p.score), cScore, mid, fs, '#eef2f8', { align: 'right', weight: 600 });
      Hud.txt(ctx, money(Game.cashOf(p)), cCash, mid, fs, '#6ac2ff', { align: 'right', weight: 600 });
      Hud.txt(ctx, String(p.wins), cWins, mid, fs, '#ffb640', { align: 'right', weight: 700 });
    });
    ty += ps.length * rowH;
    if (Cfg.teams !== 'NONE') { Hud.txt(ctx, Cfg.teams.charAt(0) + Cfg.teams.slice(1).toLowerCase() + ' teams', cx, ty + fs * 0.7, fs * 0.8, '#8f9bb5', { align: 'center' }); ty += fs * 1.6; }
    // awards
    if (awardRows) {
      ty += fs * 0.8;
      Hud.txt(ctx, 'AWARDS', cx, ty + fs * 0.5, fs * 0.8, '#ffb640', { align: 'center', weight: 700 });
      ty += fs * 1.6;
      const aw = (W - fs * 2 - fs * 1.2) / 3, ah = fs * 3.9;
      awards.forEach((a, i) => {
        const ax = x + fs + (i % 3) * (aw + fs * 0.6), ay = ty + Math.floor(i / 3) * (ah + fs * 0.5);
        Hud.pill(ctx, ax, ay, aw, ah, { fill: 'rgba(255,255,255,0.04)', accent: rgba(c3(a.player.color), 1) });
        Hud.txt(ctx, a.title, ax + fs * 0.7, ay + fs * 0.95, fs * 0.82, '#ffd27a', { weight: 700 });
        Hud.txt(ctx, a.player.name, ax + fs * 0.7, ay + fs * 2.15, fs * 0.95, rgba(mix3(c3(a.player.color), WHITE3, 0.35), 1), { weight: 700 });
        Hud.txt(ctx, a.value, ax + fs * 0.7, ay + fs * 3.2, fs * 0.72, '#9aa6bf', { weight: 600 });
      });
    }
    // footer
    let foot;
    if (!this.canContinue()) foot = 'Waiting for ' + (Net.lobby && Net.lobby.seats && Net.lobby.seats[0] ? Net.lobby.seats[0].name : 'the host') + '…';
    else if (this.t > 0.4) foot = o.final ? 'Press any key for the main menu' : 'Press any key to continue';
    if (foot) {
      ctx.globalAlpha = pop * (this.canContinue() ? 0.6 + 0.4 * Math.sin(this.t * 4) : 0.8);
      Hud.txt(ctx, foot, cx, y + H - fs * 0.9, fs * 0.8, '#aab4ca', { align: 'center', weight: 600 });
    }
    ctx.globalAlpha = 1;
  }
  // classic look: 1.5's "Rankings" box over the battlefield
  draw() {
    const s = Screen.ui, W = Screen.UW, H = Screen.UH, o = this.o;
    // keep the battlefield visible behind the rankings
    if (!o.final && App.lastBattleFrame) Screen.main.buf.set(App.lastBattleFrame); else Screen.main.clear(0);
    const ps = Game.players.slice().sort((a, b) => Game.rankValue(b) - Game.rankValue(a));
    const rowH = 10, teams = Cfg.teams !== 'NONE';
    const w = Math.min(W - 10, 200), h = 46 + ps.length * rowH + (teams ? 10 : 0) + (o.final ? 10 : 0);
    const x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
    frame(s, x, y, w, h);
    // title between two yellow bars
    const title = o.final ? 'Final Rankings' : 'Rankings', tw = Font.width(title) + 8, by = y + 4;
    const bar = (bx, bw) => { s.fillRect(bx, by, bw, 8, UIC.yellow); s.rect(bx, by, bw, 8, UIC.lo); };
    bar(x + 5, Math.floor((w - tw) / 2) - 7);
    bar(x + Math.floor((w + tw) / 2) + 2, Math.floor((w - tw) / 2) - 7);
    Font.center(s, title, x + w / 2, by, UIC.text);
    let yy = y + 17;
    if (o.final) { Font.center(s, (ps[0].name + ' wins the game!').replace(/&/g, '&&'), x + w / 2, yy, UIC.hot); yy += 10; }
    const cNum = x + 10, cName = x + 32, cWins = x + Math.floor(w * 0.62), cCash = x + w - 12;
    const greedy = Cfg.scoringMode === 'GREEDY';
    ps.forEach((p, i) => {
      Font.draw(s, '#' + (i + 1), cNum, yy, UIC.text);
      Font.draw(s, p.name.slice(0, 10).replace(/&/g, '&&'), cName, yy, UIC.text);
      Font.right(s, String(p.wins), cWins, yy, UIC.text);
      Font.right(s, greedy ? money(Game.netWorth(p)) : money(Game.cashOf(p)), cCash, yy, UIC.text);
      yy += rowH;
    });
    if (teams) { Font.center(s, Cfg.teams.charAt(0) + Cfg.teams.slice(1).toLowerCase() + ' teams', x + w / 2, yy, UIC.dis); yy += 10; }
    const left = Game.rounds - Game.round;
    const line = o.final ? 'The game is over.' : left === 1 ? '1 round remains.' : left > 0 ? left + ' rounds remain.' : 'Last round.';
    Font.center(s, line, x + w / 2, yy, UIC.text);
    if (!this.canContinue()) {
      const host = Net.lobby && Net.lobby.seats && Net.lobby.seats[0] ? Net.lobby.seats[0].name : 'the host';
      Font.center(s, 'Waiting for ' + host.replace(/&/g, '&&') + '...', x + w / 2, y + h - 14, UIC.dis);
    } else drawButton(s, x + Math.floor(w / 2) - 18, y + h - 16, 36, 12, '&OK');
  }

}
