'use strict';
/* =====================================================================
   Game flow (players, rounds, shopping, interest, save/restore), the
   network game flow the host drives, the scene manager / main loop, and
   boot.
   ===================================================================== */

const DEFAULT_KEYS = [
  { ccw: 'a', cw: 'd', up: 'w', down: 's', fire: 'space', weapon: 'tab' },
  { ccw: 'arrowleft', cw: 'arrowright', up: 'arrowup', down: 'arrowdown', fire: 'enter', weapon: 'shift' },
  { ccw: 'j', cw: 'l', up: 'i', down: 'k', fire: 'u', weapon: 'o' },
  { ccw: '4', cw: '6', up: '8', down: '5', fire: '0', weapon: '.' }
];

// per-game numbers behind the end-of-game awards (updated by the shared simulation)
function newStats() { return { shots: 0, hits: 0, dmg: 0, kills: 0, selfDmg: 0, bestHit: 0, longest: 0, survived: 0, spent: 0 }; }

const Game = {
  players: [], round: 0, rounds: 10, active: false, online: false, finished: false, seed: 1,
  teamCash: {}, teamBank: {}, shopPlayer: null, interestTotal: 0, shopWait: null, netWaitList: [],

  newPlayer(idx) {
    const prev = (Cfg.lastPlayers && Cfg.lastPlayers[idx]) || {};
    const ai = prev.ai !== undefined ? prev.ai : (idx === 0 ? null : 'Moron');
    return {
      idx, name: prev.name || '', color: Data.playerColors[idx], ai, aiHidden: null, owner: null,
      icon: prev.icon !== undefined ? clamp(prev.icon, 0, TankIcons.length - 1) : 0,
      team: prev.team !== undefined ? prev.team : idx % 2,
      cash: 0, score: 0, roundPts: 0, kills: 0, deaths: 0, wins: 0,
      inv: {}, fuel: 0, para: { deployed: true, threshold: 5 }, autoDefense: false,
      keys: Object.assign({}, DEFAULT_KEYS[idx % 4], prev.keys || {}),
      weapon: 'babyMissile', lastPower: 200, aiMem: {}, bank: 0, interest: 0, interestTotal: 0,
      humanName: prev.ai ? '' : (prev.name || ''), stats: newStats()
    };
  },
  computerName(p) {
    const used = new Set(this.players.filter(q => q !== p).map(q => q.name));
    const avail = Data.computerNames.filter(n => !used.has(n));
    return pick(avail.length ? avail : Data.computerNames);
  },
  maxTeams() { return clamp(Math.ceil(this.players.length / 2), 2, 5); },

  /* ---------------- flow (offline) ---------------- */
  start() {
    UI.clear();
    this.players = []; this.rounds = Cfg.rounds; this.round = 0; this.seed = irand(1, 1e6);
    this.online = false; this.finished = false;
    const n = Cfg.players;
    let i = 0;
    const next = () => {
      if (i >= n) { this.saveRoster(); this.begin(); return; }
      const p = this.newPlayer(i);
      if (p.ai && (!p.name || this.players.some(q => q.name === p.name))) p.name = this.computerName(p);
      this.players.push(p);
      App.set(new PlayerSetupScene(i++, p, next));
    };
    next();
  },
  saveRoster() {
    Cfg.lastPlayers = this.players.map(p => ({ name: p.name, ai: p.ai, icon: p.icon, team: p.team, keys: p.keys }));
    Store.set('scorch.cfg', Object.assign({}, Store.get('scorch.cfg', {}), { lastPlayers: Cfg.lastPlayers }));
  },
  begin() {
    if (!Net.online) applyGraphicsMode();   // FIT SCREEN: fit the window as it is now
    this.active = true; this.round = 1; this.teamCash = {}; this.interestTotal = 0;
    for (const p of this.players) { p.cash = Cfg.cashAtStart; p.inv = {}; p.fuel = 0; p.stats = newStats(); }
    if (Cfg.teams === 'CORPORATE') for (const p of this.players) this.teamCash[p.team] = (this.teamCash[p.team] || 0) + Cfg.cashAtStart;
    if (Cfg.cashAtStart > 0) this.shopPhase(() => this.battle());
    else this.battle();
  },
  shopPhase(then) {
    const queue = this.players.slice();
    const next = () => {
      const p = queue.shift();
      if (!p) { this.shopPlayer = null; Market.settle(); then(); return; }
      if (p.ai) { if (Cfg.computersBuy) AI.shop(p); next(); return; }
      if (!this.canShop(p)) { next(); return; }
      this.shopPlayer = p;
      App.set(new ShopScene(p, next));
    };
    next();
  },
  canShop(p) {
    return this.cashOf(p) > 0 || Data.items.some(it => it.id !== 'babyMissile' && (p.inv[it.id] || 0) > 0);
  },
  battle() {
    for (const p of this.players) { p.bank = this.cashOf(p); p.roundPts = 0; p.dmgCarry = 0; p.dmgCarryTeam = 0; }
    this.teamBank = Object.assign({}, this.teamCash);
    if (Net.isHost()) { this.roundOnline(); return; }
    Battle.start(Battle.makeParams());
    App.set(BattleScene);
  },
  // called by the battle when a round ends (offline or on the host); winners are player indexes
  roundFinished(winners, mass) {
    if (Net.isHost()) {
      Net.hostCommand({ c: 'roundover', winners, mass, players: this.players.map(p => this.netPlayer(p)), teamCash: this.teamCash });
      return;
    }
    App.lastBattleFrame = World.comp.slice();
    App.set(new StandingsScene({ winners: winners.map(i => this.players[i]).filter(Boolean), mass, onContinue: () => this.afterRound() }));
  },
  afterRound() {
    if (this.round >= this.rounds) {
      if (Net.isHost()) { Net.hostCommand({ c: 'gameover', players: this.players.map(p => this.netPlayer(p)) }); return; }
      this.finished = true;
      App.set(new StandingsScene({ final: true, winners: [], onContinue: () => this.toMainMenu() }));
      return;
    }
    // interest on the money that sat in the bank through the round
    const r = Cfg.interestRate;
    if (Cfg.teams === 'CORPORATE') {
      for (const tm in this.teamBank) {
        const i = Math.floor(this.teamBank[tm] * r);
        this.teamCash[tm] = (this.teamCash[tm] || 0) + i;
        for (const p of this.players) if (String(p.team) === String(tm)) { p.interest = i; p.interestTotal += i; }
      }
    } else {
      for (const p of this.players) { const i = Math.floor(p.bank * r); p.cash += i; p.interest = i; p.interestTotal += i; }
    }
    this.round++;
    if (Net.isHost()) this.shopOnline();
    else this.shopPhase(() => this.battle());
  },
  toMainMenu() {
    if (Net.online) { Net.leave(); return; }
    this.active = false;
    UI.clear();
    Sound.flightStop();
    App.set(new MainMenuScene());
  },

  /* ---------------- network game: the host drives, everyone follows ---------------- */
  netPlayer(p) {
    return {
      idx: p.idx, name: p.name, ai: p.ai, icon: p.icon, team: p.team, owner: p.owner || null,
      cash: p.cash, score: p.score, roundPts: p.roundPts, kills: p.kills, deaths: p.deaths, wins: p.wins,
      dmgCarry: p.dmgCarry || 0, dmgCarryTeam: p.dmgCarryTeam || 0,
      inv: Object.assign({}, p.inv), fuel: p.fuel, para: Object.assign({}, p.para), autoDefense: p.autoDefense,
      weapon: p.weapon, lastPower: p.lastPower, interest: p.interest, interestTotal: p.interestTotal,
      stats: Object.assign(newStats(), p.stats)
    };
  },
  // update players in place: tanks keep references to them
  applyNetPlayers(list) {
    for (const q of list || []) {
      const p = this.players[q.idx];
      if (!p) continue;
      const mine = Net.isClient() && p.owner === Net.me && App.scene === BattleScene && Battle.aimTank() && Battle.aimTank().p === p;
      const w = p.weapon;
      Object.assign(p, q);
      if (mine && Game.has(p, w)) p.weapon = w;   // don't yank the weapon you're aiming with
    }
  },
  netState() {
    return { round: this.round, rounds: this.rounds, seed: this.seed, teamCash: this.teamCash, players: this.players.map(p => this.netPlayer(p)) };
  },
  applyNetState(s) {
    this.round = s.round; this.rounds = s.rounds; this.seed = s.seed; this.teamCash = s.teamCash || {};
    this.applyNetPlayers(s.players);
  },
  exec(c) {
    switch (c.c) {
      case 'start': this.netStart(c); break;
      case 'shop': this.netShop(c); break;
      case 'shopwait': this.netShopWait(c); break;
      case 'round':
        this.round = c.round;
        this.applyNetPlayers(c.players); this.teamCash = c.teamCash || {};
        Battle.start(c.params);
        App.set(BattleScene);
        break;
      case 'roundover':
        this.applyNetPlayers(c.players); this.teamCash = c.teamCash || {};
        App.lastBattleFrame = World.comp.slice();
        App.set(new StandingsScene({
          winners: (c.winners || []).map(i => this.players[i]).filter(Boolean), mass: c.mass, online: true,
          onContinue: () => { if (Net.isHost()) this.afterRound(); }
        }));
        break;
      case 'gameover':
        this.applyNetPlayers(c.players);
        this.finished = true;
        App.set(new StandingsScene({ final: true, online: true, winners: [], onContinue: () => Net.leave() }));
        break;
      case 'setai': {
        const p = this.players[c.idx];
        if (p) { p.ai = c.ai; p.owner = null; p.aiMem = p.aiMem || {}; }
        break;
      }
      case 'msg': Toast.show(String(c.text || '')); break;
    }
  },
  netStart(c) {
    Net.saveCfg();
    for (const k of SYNC_KEYS) if (c.cfg && c.cfg[k] !== undefined) Cfg[k] = c.cfg[k];
    applyGraphicsMode();
    this.players = c.players.map(q => {
      const p = this.newPlayer(q.idx);
      Object.assign(p, q);
      p.color = Data.playerColors[q.idx]; p.aiMem = {}; p.aiHidden = null;
      return p;
    });
    this.rounds = Cfg.rounds; this.seed = c.seed; this.round = 0;
    this.active = true; this.online = true; this.finished = false;
    this.teamCash = {}; this.interestTotal = 0; this.shopWait = null;
    if (Cfg.teams === 'CORPORATE') for (const p of this.players) this.teamCash[p.team] = (this.teamCash[p.team] || 0) + Cfg.cashAtStart;
    if (Net.isHost()) { this.round = 1; if (Cfg.cashAtStart > 0) this.shopOnline(); else this.battle(); }
    else App.set(new WaitScene(['Starting the game...']));
  },
  // host: computers shop at once; people shop in parallel on their own screens
  shopOnline() {
    for (const p of this.players) if (p.ai && Cfg.computersBuy) AI.shop(p);
    const wait = this.players.filter(p => !p.ai && p.owner && this.canShop(p)).map(p => p.idx);
    this.shopWait = new Set(wait);
    Net.hostCommand({
      c: 'shop', round: this.round, wait, players: this.players.map(p => this.netPlayer(p)),
      teamCash: this.teamCash, market: Cfg.freeMarket ? Object.assign({}, Market.mult) : null
    });
    if (!this.shopWait.size) this.shopsDone();
  },
  netShop(c) {
    this.round = c.round;
    this.applyNetPlayers(c.players); this.teamCash = c.teamCash || {};
    if (!Net.isHost()) Market.override = c.market || null;
    this.netWaitList = (c.wait || []).slice();
    const me = Net.myPlayer();
    const waitScene = () => new WaitScene(['Waiting for the other players', 'to finish shopping...'], () => this.shopWaitNames());
    if (me && this.netWaitList.includes(me.idx)) {
      this.shopPlayer = me;
      App.set(new ShopScene(me, tx => {
        this.shopPlayer = null;
        App.set(waitScene());
        if (Net.isHost()) this.onShopDone(Net.me, { tx });
        else Net.request({ c: 'shopdone', tx }, true);
      }));
    } else App.set(waitScene());
  },
  netShopWait(c) {
    this.netWaitList = (c.list || []).slice();
    const me = Net.myPlayer();
    if (Net.pendingReq && Net.pendingReq.m.c.c === 'shopdone' && (!me || !this.netWaitList.includes(me.idx))) Net.pendingReq = null;
  },
  shopWaitNames() {
    const names = this.netWaitList.map(i => this.players[i] && this.players[i].name).filter(Boolean);
    return names.length ? ['Still shopping: ' + names.join(', ')] : [];
  },
  onShopDone(peer, c) {
    const p = this.players.find(q => !q.ai && q.owner === peer);
    if (!p || !this.shopWait || !this.shopWait.has(p.idx)) return;
    if (peer !== Net.me) this.applyTx(p, c.tx);   // the host's own screen already applied its purchases
    this.shopWait.delete(p.idx);
    Net.hostCommand({ c: 'shopwait', list: [...this.shopWait] });
    if (!this.shopWait.size) this.shopsDone();
  },
  applyTx(p, tx) {
    if (!Array.isArray(tx)) return;
    for (const t of tx.slice(0, 600)) {
      const it = t && typeof t.id === 'string' ? Data.byId[t.id] : null;
      if (!it || it.id === 'babyMissile') continue;
      if (t.op === 'b') { if (Shop.visible(p, it)) Shop.buy(p, it, true); }
      else if (t.op === 's') Shop.sell(p, it, clamp(t.q | 0, 1, 99), true);
    }
  },
  shopsDone() {
    this.shopWait = null;
    Market.settle();
    this.battle();
  },
  roundOnline() {
    const params = Battle.makeParams();
    Net.hostCommand({ c: 'round', round: this.round, params, players: this.players.map(p => this.netPlayer(p)), teamCash: this.teamCash });
  },
  // host: someone disconnected mid-game - a computer takes over their tank
  onPlayerLeft(p) {
    Net.hostCommand({ c: 'msg', text: p.name + ' left - a computer takes over.' });
    if (App.scene === BattleScene) { Battle.pendingAI.push(p.idx); return; }
    Net.hostCommand({ c: 'setai', idx: p.idx, ai: 'Chooser' });
    if (this.shopWait && this.shopWait.has(p.idx)) {
      this.shopWait.delete(p.idx);
      Net.hostCommand({ c: 'shopwait', list: [...this.shopWait] });
      if (!this.shopWait.size) this.shopsDone();
    }
  },

  /* ---------------- inventory & money ---------------- */
  has(p, id) { return id === 'babyMissile' || (p.inv[id] || 0) > 0; },
  consume(p, id, n) { if (id !== 'babyMissile') p.inv[id] = Math.max(0, (p.inv[id] || 0) - n); },
  cashOf(p) { return Cfg.teams === 'CORPORATE' ? (this.teamCash[p.team] || 0) : p.cash; },
  addCash(p, a) {
    if (Cfg.teams === 'CORPORATE') this.teamCash[p.team] = Math.max(0, (this.teamCash[p.team] || 0) + a);
    else p.cash = Math.max(0, p.cash + a);
  },
  netWorth(p) {
    let w = this.cashOf(p);
    for (const id in p.inv) {
      const it = Data.byId[id];
      if (it && id !== 'babyMissile') w += (p.inv[id] || 0) * it.cost / it.bundle * 0.5;
    }
    w += (p.fuel || 0) / 10 * 1000 * 0.5;
    return Math.round(w);
  },
  rankValue(p) { return Cfg.scoringMode === 'GREEDY' ? this.netWorth(p) : p.score; },

  /* ---------------- saved games ---------------- */
  serialize() {
    return {
      v: 1, round: this.round, rounds: this.rounds, seed: this.seed, teamCash: this.teamCash,
      players: this.players.map(p => ({
        idx: p.idx, name: p.name, ai: p.ai, aiHidden: p.aiHidden, icon: p.icon, team: p.team, cash: p.cash,
        score: p.score, kills: p.kills, deaths: p.deaths, wins: p.wins, inv: p.inv, fuel: p.fuel, para: p.para,
        autoDefense: p.autoDefense, keys: p.keys, weapon: p.weapon, lastPower: p.lastPower, interestTotal: p.interestTotal,
        stats: p.stats
      }))
    };
  },
  restore(d) {
    try {
      this.players = d.players.map(q => Object.assign(this.newPlayer(q.idx), q, { color: Data.playerColors[q.idx], aiMem: {}, owner: null }));
      this.round = d.round; this.rounds = d.rounds; this.seed = d.seed || 1;
      this.teamCash = d.teamCash || {};
      Cfg.players = this.players.length; Cfg.rounds = this.rounds;
      this.active = true; this.online = false; this.finished = false;
      UI.clear();
      Sound.flightStop();
      this.shopPhase(() => this.battle());
    } catch (e) {
      messageBox(['That saved game could not be read.']);
    }
  }
};

const BattleScene = {
  enter() { /* Battle.start() is called by whoever opens a round */ },
  update(dt) { Battle.update(dt); },
  draw() { Battle.draw(); },
  drawModern(dt) {
    Hud.update(dt);
    Fx.drawWorld(Gfx.ctx, dt, { world: World, battle: Battle });
    Hud.draw(Gfx.ctx);
  },
  key(ev) { Battle.key(ev); },
  mouse(ev) { Battle.mouse(ev); }
};
Battle.wheel = function (ev) {
  const t = this.aimTank();
  if (!t || this.waitHost) return;
  t.power = clamp(t.power - ev.dy * 5, 0, t.maxPower);
};

/* ---------------- main loop ---------------- */
const App = {
  scene: null, last: 0, lastBattleFrame: null,
  set(s) {
    Screen.flash = 0;
    if (s !== BattleScene) { Sound.flightStop(); Sound.ambience(0); }
    this.scene = s;
    if (s.enter) s.enter();
  },
  dispatch(ev) {
    if (ev.type === 'key' && ev.k === 'f2' && !ev.repeat) { Gfx.setModern(!Gfx.modern); Sound.click(); return; }
    if (ev.type === 'key' && ev.k === 'f9' && !ev.repeat) { EventLog.on = !EventLog.on; return; }
    if (ev.type === 'key' && ev.k === 'y' && !ev.repeat && Net.online && !UI.top() && Net.gid) { Chat.open(); return; }
    if (ev.type === 'key') {
      if ((ev.k === 'f1' || (ev.alt && ev.k === 's')) && Game.active && !UI.stack.some(d => d.isSystem)) { Menus.systemMenu(); return; }
      if (UI.top()) UI.key(ev); else if (this.scene.key) this.scene.key(ev);
    } else if (ev.type === 'mouse') {
      if (Volume.mouse(ev)) return;
      if (UI.top()) UI.mouse(ev); else if (this.scene.mouse) this.scene.mouse(ev);
    } else if (ev.type === 'wheel') {
      if (!UI.top() && this.scene === BattleScene) Battle.wheel(ev);
    }
  },
  // everything but drawing: also run from a timer while the tab is hidden in a network game
  step(dt) {
    Input.poll(dt);
    for (const ev of Input.take()) this.dispatch(ev);
    Net.update(dt);
    UI.update(dt);
    if (this.scene.update) this.scene.update(dt);
    if (this.scene === BattleScene) EventLog.watch();
    Toast.update(dt);
    Chat.update(dt);
    Volume.update();
    Music.update();
    if (Input.kb && document.activeElement === Input.kb && !UI.stack.some(d => d.focus)) Input.hideKeyboard();
  },
  frame(ts) {
    let dt = (ts - this.last) / 1000;
    this.last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    try {
      this.step(dt);
      this.render(dt);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(t => this.frame(t));
  },
  // draw one frame with whichever renderer is active
  render(dt) {
    if (Gfx.modern) { Gfx.frame(dt); return; }
    Screen.ui.clear(0);
    this.scene.draw();
    UI.draw(Screen.ui);
    Toast.draw(Screen.ui);
    Chat.draw(Screen.ui);
    Net.drawOverlay(Screen.ui);
    EventLog.draw(Screen.ui);
    Volume.draw();
    if (Cfg.pointer === 'Joystick' && Input.x >= 0) drawSoftCursor(Screen.ui, Input.ux, Input.uy);
    Screen.present();
  }
};

const CURSOR = [
  'X...........',
  'XX..........',
  'XwX.........',
  'XwwX........',
  'XwwwX.......',
  'XwwwwX......',
  'XwwwwwX.....',
  'XwwwwwwX....',
  'XwwwwwwwX...',
  'XwwwwwXXXX..',
  'XwwXwwX.....',
  'XwX.XwwX....',
  'XX..XwwX....',
  'X....XwwX...',
  '.....XwwX...',
  '......XX....'
];
function drawSoftCursor(s, x, y) {
  const spr = makeSprite(CURSOR, { X: vga(0, 0, 0), w: vga(63, 63, 63) });
  s.blit(spr, Math.floor(x), Math.floor(y));
}
function installCursor(canvas) {
  try {
    const c = document.createElement('canvas'), k = 2;
    c.width = 12 * k; c.height = 16 * k;
    const g = c.getContext('2d');
    CURSOR.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = ch === 'X' ? '#000' : '#fff';
      g.fillRect(x * k, y * k, k, k);
    }));
    canvas.style.cursor = 'url(' + c.toDataURL() + ') 0 0, default';
  } catch (e) { /* default cursor */ }
}

function applyGraphicsMode() {
  const AY = 16 / 9;   // 360x480's pixel shape
  let w, h, aspect;
  if (Cfg.graphicsMode === 'FIT SCREEN') {
    const a = clamp(window.innerWidth / Math.max(1, window.innerHeight), 4 / 3, 2.6);
    h = 480; w = Math.round(h * a / AY); aspect = w * AY / h;
  } else {
    // 'WxH', 'WxH WIDE' (16:9) or 'WxH FIT' (a host's FIT SCREEN, sent to everyone in a network game)
    const m = /^(\d+)x(\d+)( WIDE| FIT)?$/.exec(Cfg.graphicsMode) || [0, '360', '480', ''];
    w = +m[1]; h = +m[2]; aspect = m[3] === ' WIDE' ? 16 / 9 : m[3] === ' FIT' ? w * AY / h : 4 / 3;
  }
  if (!Screen.main || Screen.W !== w || Screen.H !== h || Math.abs(Screen.aspect - aspect) > 1e-9) Screen.setMode(w, h, aspect);
}

function boot() {
  const canvas = document.getElementById('screen');
  Screen.init(canvas);
  if (!Data.graphicsModes.includes(Cfg.graphicsMode)) Cfg.graphicsMode = Data.defaults.graphicsMode;
  // first visit: a battlefield that fills the window, whatever its shape
  if (!(Store.get('scorch.cfg', {}) || {}).graphicsMode) Cfg.graphicsMode = 'FIT SCREEN';
  // FIT SCREEN follows the window between games (never mid-game: everyone's battlefield must match)
  let fitT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(fitT);
    fitT = setTimeout(() => { if (Cfg.graphicsMode === 'FIT SCREEN' && !Game.active && !Net.online) applyGraphicsMode(); }, 250);
  });
  applyGraphicsMode();
  Input.init(canvas);
  installCursor(canvas);
  Gfx.init(canvas);
  canvas.addEventListener('pointerdown', () => { try { canvas.focus(); } catch (e) { /* ignore */ } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Sound.flightStop(); });
  // a hidden tab gets no animation frames; keep a network game moving anyway
  setInterval(() => {
    if (!document.hidden || !Net.online) return;
    const now = performance.now();
    const dt = Math.min(1.5, Math.max(0, (now - App.last) / 1000));
    App.last = now;
    try { App.step(dt); } catch (e) { console.error(e); }
  }, 500);
  // drop a text file on the game to use it as a talk file (one comment per line)
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (f.size > 256 * 1024) { messageBox(['That file is too big for a talk file.']); return; }
    const r = new FileReader();
    r.onload = () => {
      const lines = String(r.result).split(/\r?\n/).map(s => s.replace(/\s+$/, '').slice(0, 60)).slice(0, 3000);
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      const name = f.name.toLowerCase();
      Data.talkFiles[name] = lines;
      Store.set('scorch.talk.' + name, lines);
      messageBox(['Loaded talk file "' + f.name.replace(/&/g, '&&') + '"', lines.filter(Boolean).length + ' comments.', 'Set it as the Attack File or', 'Die File under Play Options.']);
    };
    r.readAsText(f);
  });
  window.addEventListener('beforeunload', () => { if (Net.online) { try { Net.leave(true); } catch (e) { /* ignore */ } } });
  App.set(new MainMenuScene());
  requestAnimationFrame(t => { App.last = t; App.frame(t); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
