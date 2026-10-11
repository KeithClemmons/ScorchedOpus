'use strict';
/* =====================================================================
   Network screens: connect (host or join), game browser, lobby, and a
   waiting screen used between phases of a network game.
   ===================================================================== */

function netBackground() {
  const s = Screen.ui, W = Screen.UW, H = Screen.UH;
  if (s.vector) return;   // Remastered: the title landscape is already behind the dialog
  Screen.main.clear(0);
  for (let y = 0; y < H; y++) {
    const band = Math.floor(y / 6) & 1;
    s.hline(0, W - 1, y, vga(4 + band, 6 + band, 14 + band * 2));
  }
  for (let y = 5; y < H; y += 12) for (let x = (y * 7) % 16; x < W; x += 16) s.pset(x, y, vga(18, 20, 34));
}
function cleanName(n) { return String(n || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 16); }
function cleanCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

/* ------------------------------------------------ connect: host or join */
class NetScene {
  constructor() {
    const kinds = Net.available();
    const saved = Store.get('scorch.net', {}) || {};
    const last = (Cfg.lastPlayers && Cfg.lastPlayers[0]) || {};
    this.form = {
      name: cleanName(saved.name || (last.ai ? '' : last.name) || 'Player'),
      kind: kinds.includes(saved.kind) ? saved.kind : kinds[0],
      url: Net.hosted() && Net.relayHere() ? Net.defaultServer() : saved.url || Net.defaultServer(),
      code: cleanCode(saved.code) || rid(4),
      icon: saved.icon | 0
    };
    this.kinds = kinds;
    this.status = ''; this.busy = false;
  }
  enter() {
    UI.clear();
    if (Net.online) Net.close();
    const f = this.form, W = Math.min(Screen.UW - 8, 300), H = Math.min(Screen.UH - 8, 186);
    const d = new Dialog({ w: W, h: H, title: 'Network Game', closeOnOutside: false, onClose: () => App.set(new MainMenuScene()) });
    this.d = d;
    const fx = 70, fw = W - fx - 10;
    d.text('&Name:', 10, 21);
    const nameF = d.textField(f, 'name', fx, 18, fw, 16);
    nameF.hot = 'n';
    d.option({ key: 'kind', label: 'Play &via', type: 'cycle', values: this.kinds, fmt: k => Net.kindLabel(k) }, f, 10, 34, W - 20);
    const srvL = d.text('&Server:', 10, 55);
    const srvF = d.textField(f, 'url', fx, 52, fw, 80);
    srvF.hot = 's';
    // on the real website the server is the site itself: nothing to type (and no address to mistake for a link)
    srvL.hidden = srvF.hidden = () => f.kind !== 'ws' || (Net.hosted() && Net.relayHere());
    const roomL = d.text('&Room code:', 10, 71);
    const roomF = d.textField(f, 'code', fx, 68, 60, 8, () => { f.code = cleanCode(f.code); });
    roomF.hot = 'r';
    d.button('Ne&w', fx + 64, 68, 36, 12, () => { f.code = rid(4); });
    d.add({ x: 10, y: 86, w: 0, h: 0, kind: 'label', draw: s => {
      const help = {
        ws: Net.hosted() && Net.relayHere()
          ? 'Host: press Host Game and tell your friends the room code. Friends: open this same site, type that room code, then press Join Game.'
          : 'Everyone connects to the same game server and room code. Run server/server.js (npm start) somewhere your friends can reach.',
        peer: 'No server needed: browsers connect directly. Host: press Host Game and tell your friends the room code. Friends: pick peer to peer, type that code, then Join Game.',
        local: 'Links tabs of this browser on this computer - handy for trying it out. Use the same room code in each tab.'
      }[f.kind];
      Font.wrap(help, Math.floor((W - 20) / Font.CW)).forEach((l, i) => Font.draw(s, l, d.x + 10, d.y + 86 + i * 10, UIC.dis));
    } });
    d.add({ x: 10, y: H - 34, w: 0, h: 0, kind: 'label', draw: s => {
      if (this.status) Font.center(s, this.status.replace(/&/g, '&&'), d.x + W / 2, d.y + H - 34, this.busy ? UIC.blue : UIC.hot);
    } });
    const bw = Math.floor((W - 32) / 3);
    d.button('&Host Game', 10, H - 21, bw, 14, () => this.go(true));
    d.button('&Join Game', 16 + bw, H - 21, bw, 14, () => this.go(false));
    d.button('&Back', 22 + bw * 2, H - 21, bw, 14, () => d.close());
    if (!f.name) d.focus = nameF;
    UI.push(d);
  }
  async go(hosting) {
    if (this.busy) return;
    const f = this.form;
    f.name = cleanName(f.name);
    f.code = cleanCode(f.code);
    if (!f.name) { this.status = 'Type your name first.'; Sound.error(); return; }
    if (f.code.length < 3) { this.status = 'The room code needs at least 3 letters.'; Sound.error(); return; }
    if (f.kind === 'ws' && !/^wss?:\/\/.+/i.test(f.url)) { this.status = 'The server address starts with ws:// or wss://'; Sound.error(); return; }
    Store.set('scorch.net', f);
    this.busy = true; this.status = 'Connecting...';
    try {
      await Net.open(f.kind, { url: f.url.trim(), code: f.code, name: f.name, icon: f.icon });
      UI.clear();
      if (hosting) { Net.host(); App.set(new LobbyScene()); }
      else App.set(new JoinScene());
    } catch (e) {
      Net.close();
      this.status = (e && e.message) || 'Could not connect.';
      Sound.error();
    }
    this.busy = false;
  }
  update() {}
  key(ev) { UI.key(ev); }
  mouse(ev) { UI.mouse(ev); }
  draw() { netBackground(); }
}

/* ------------------------------------------------ find a game to join */
class JoinScene {
  constructor() { this.btns = []; this.t = 0; this.auto = true; }
  enter() { UI.clear(); }
  update(dt) {
    this.t += dt;
    const open = Net.games().filter(g => g.open);
    // with a room code there is usually exactly one game: join it straight away
    if (this.auto && this.t > 0.6 && open.length === 1) { this.auto = false; this.pick(open[0]); }
  }
  pick(g) {
    Net.join(g);
    App.set(new LobbyScene());
  }
  back() { Net.close(); App.set(new NetScene()); }
  key(ev) {
    if (ev.k === 'escape' || ev.k === 'b') { this.back(); return; }
    if (/^[1-9]$/.test(ev.k)) { const g = Net.games().filter(x => x.open)[+ev.k - 1]; if (g) this.pick(g); }
  }
  mouse(ev) {
    if (ev.kind !== 'down') return;
    for (const b of this.btns) if (ev.ux >= b.x && ev.uy >= b.y && ev.ux < b.x + b.w && ev.uy < b.y + b.h) { Sound.click(); b.fn(); return; }
  }
  draw() {
    netBackground();
    const s = Screen.ui, W = Math.min(Screen.UW - 8, 280), H = Math.min(Screen.UH - 8, 170);
    const x = Math.floor((Screen.UW - W) / 2), y = Math.floor((Screen.UH - H) / 2);
    frame(s, x, y, W, H);
    Font.center(s, 'Join a Network Game', x + W / 2, y + 6, UIC.text);
    Font.center(s, 'Room ' + Net.code + ' (' + Net.kindLabel() + ')', x + W / 2, y + 18, UIC.dis);
    this.btns = [];
    const games = Net.games();
    const open = games.filter(g => g.open);
    if (!open.length) {
      const lines = games.length ? ['The games here have already started.', 'Wait for the next one, or host your own.']
        : ['Looking for games' + '...'.slice(0, 1 + Math.floor(this.t * 2) % 3), 'Ask the host for the room code.']
          .concat(Net.kind === 'ws' && this.t > 6 ? ['', 'Nothing yet in room ' + Net.code + '.', 'Check the host pressed Host Game with this', 'same room code, on this same website.'] : [])
          .concat(Net.kind === 'peer' && this.t > 6 ? ['', 'Nothing yet in room ' + Net.code + '.', 'Check the host picked peer to peer and', 'pressed Host Game with this same room code.'] : [])
          .concat(Net.kind === 'local' && this.t > 4 ? ['', '"This browser" only finds tabs on this computer.', 'To play a friend, go Back and pick game server.'] : []);
      lines.forEach((l, i) => Font.center(s, l, x + W / 2, y + 44 + i * 11, UIC.text));
    }
    open.slice(0, 8).forEach((g, i) => {
      const by = y + 34 + i * 16, bx = x + 12, bw = W - 24;
      const label = '&' + (i + 1) + ' ' + String(g.name).replace(/&/g, '&&') + "'s game (" + g.n + ' player' + (g.n === 1 ? '' : 's') + ')';
      drawButton(s, bx, by, bw, 14, label, { align: 'left' });
      this.btns.push({ x: bx, y: by, w: bw, h: 14, fn: () => this.pick(g) });
    });
    const bx = x + W / 2 - 30, by = y + H - 20;
    drawButton(s, bx, by, 60, 14, '&Back');
    this.btns.push({ x: bx, y: by, w: 60, h: 14, fn: () => this.back() });
  }
}

/* ------------------------------------------------ the lobby */
class LobbyScene {
  constructor() { this.btns = []; this.t = 0; }
  enter() { UI.clear(); }
  update(dt) {
    this.t += dt;
    if (Net.isClient() && !Net.seated && this.t > 15) {
      Net.hostGone(Net.tr && Net.tr.denied ? 'You need interact access to this page to play online.' : 'The host did not answer.');
    }
  }
  seats() { return (Net.lobby && Net.lobby.seats) || []; }
  cfg() { return Net.isHost() ? syncedCfg() : ((Net.lobby && Net.lobby.cfg) || {}); }
  key(ev) {
    if (UI.top()) { UI.key(ev); return; }
    const host = Net.isHost();
    switch (ev.k) {
      case 'escape': case 'l': this.leave(); break;
      case 'a': if (host) { Sound.click(); Net.addComputer(); } break;
      case 'o': if (host) this.options(); break;
      case 's': if (host) this.start(); break;
      case 'arrowleft': case 'arrowright': this.cycleMyIcon(ev.k === 'arrowleft' ? -1 : 1); break;
      case 't': this.cycleMyIcon(ev.shift ? -1 : 1); break;
    }
  }
  mouse(ev) {
    if (UI.top()) { UI.mouse(ev); return; }
    if (ev.kind !== 'down') return;
    for (const b of this.btns) {
      if (ev.ux >= b.x && ev.uy >= b.y && ev.ux < b.x + b.w && ev.uy < b.y + b.h) { Sound.click(); b.fn(ev.button === 2 ? -1 : 1); return; }
    }
  }
  leave() {
    confirmBox([Net.isHost() ? 'Close this game?' : 'Leave this game?'], () => Net.leave());
  }
  start() {
    if (this.seats().length < 2) { Toast.show('Add a computer or wait for a friend to join.'); return; }
    if (!Net.startGame()) Sound.error();
  }
  cycleMyIcon(dir) {
    const s = this.seats().find(x => x.owner === Net.me);
    if (!s) return;
    const ch = tankChoices(!Gfx.modern), n = ch.length, k = Math.max(0, ch.indexOf(s.icon | 0));
    Net.setIcon(ch[((k + dir) % n + n) % n]);
    Sound.click();
  }
  options() {
    const w = 200, items = [
      ['&Economics...', () => Menus.optionsDialog('economics')],
      ['&Physics...', () => Menus.optionsDialog('physics')],
      ['&Landscape...', () => Menus.optionsDialog('landscape')],
      ['Play Op&tions...', () => Menus.optionsDialog('play')],
      ['&Weapons...', () => Menus.optionsDialog('weapons')]
    ];
    const h = items.length * 16 + 64;
    const d = new Dialog({ w, h, title: 'Game Options', onClose: () => Net.publishLobby() });
    d.option({ key: 'rounds', label: '&Rounds', type: 'num', steps: Data.roundSteps }, Cfg, 10, 17, w - 20, () => Net.publishLobby());
    d.option({ key: 'graphicsMode', label: '&Graphics Mode', type: 'cycle', values: Data.graphicsModes }, Cfg, 10, 32, w - 20, () => { applyGraphicsMode(); d.center(); Net.publishLobby(); });
    items.forEach(([label, fn], i) => d.button(label, 10, 49 + i * 16, w - 20, 14, fn, { align: 'left' }));
    d.button('&Done', w / 2 - 30, h - 20, 60, 14, () => d.close());
    UI.push(d);
  }
  draw() {
    netBackground();
    const s = Screen.ui, W = Screen.UW - 8, H = Screen.UH - 8, x = 4, y = 4;
    const host = Net.isHost(), seats = this.seats(), cfg = this.cfg();
    frame(s, x, y, W, H);
    Font.center(s, 'Network Game Lobby', x + W / 2, y + 6, UIC.text);
    const where = 'Room ' + Net.code + ' - ' + Net.kindLabel();
    Font.center(s, where, x + W / 2, y + 17, UIC.blue);
    this.btns = [];
    const teams = cfg.teams && cfg.teams !== 'NONE';
    const cName = x + 22, cType = x + Math.floor(W * 0.46), cTeam = x + Math.floor(W * 0.7), cTank = x + W - 44, cX = x + W - 16;
    const hy = y + 30;
    Font.draw(s, 'Player', cName, hy, UIC.text);
    Font.draw(s, 'Plays as', cType, hy, UIC.text);
    if (teams) Font.draw(s, 'Team', cTeam, hy, UIC.text);
    Font.draw(s, 'Tank', cTank, hy, UIC.text);
    s.hline(x + 6, x + W - 7, hy + 9, UIC.lo);
    const sy = y + H - 69;   // options summary (and your tank)
    const rowH = clamp(Math.floor((sy - 3 - (hy + 12)) / Math.max(1, seats.length)), 9, 13);
    seats.forEach((st, i) => {
      const ry = hy + 12 + i * rowH;
      s.fillRect(x + 8, ry, 9, 8, Data.playerColors[i]);
      const me = st.owner === Net.me;
      Font.draw(s, (String(st.name) + (me ? ' (you)' : '')).replace(/&/g, '&&').slice(0, 22), cName, ry, me ? UIC.hot : UIC.black);
      const type = st.human ? (i === 0 ? 'Human (host)' : 'Human') : st.ai;
      Font.draw(s, type, cType, ry, st.human ? UIC.text : UIC.blue);
      if (host && !st.human) this.btns.push({ x: cType, y: ry - 1, w: cTeam - cType - 4, h: rowH, fn: dir => {
        const ts = Data.aiTypes, k = ts.indexOf(st.ai);
        st.ai = ts[((k + dir) % ts.length + ts.length) % ts.length]; Net.publishLobby();
      } });
      if (teams) {
        Font.draw(s, String((st.team | 0) + 1), cTeam + 8, ry, UIC.text);
        if (host) this.btns.push({ x: cTeam, y: ry - 1, w: 30, h: rowH, fn: dir => {
          const n = clamp(Math.ceil(seats.length / 2), 2, 5);
          st.team = (((st.team | 0) + dir) % n + n) % n; Net.publishLobby();
        } });
      }
      const spr = tankSprite(st.icon | 0, Data.playerColors[i]);
      s.blit(spr, cTank, ry + 8 - spr.h);
      if (me || (host && !st.human)) this.btns.push({ x: cTank - 2, y: ry - 1, w: 20, h: rowH, fn: dir => {
        if (me) this.cycleMyIcon(dir);
        else { const ch = tankChoices(!Gfx.modern), n = ch.length, k = Math.max(0, ch.indexOf(st.icon | 0)); st.icon = ch[((k + dir) % n + n) % n]; Net.publishLobby(); }
      } });
      if (host && !me) {
        Font.draw(s, 'x', cX, ry, UIC.hot);
        this.btns.push({ x: cX - 2, y: ry - 1, w: 10, h: rowH, fn: () => Net.removeSeat(i) });
      }
    });
    const cap = v => String(v || '').charAt(0) + String(v || '').slice(1).toLowerCase();
    Font.draw(s, (cfg.rounds || '?') + ' rounds, ' + cap(cfg.mode) + ' play, ' + (teams ? cap(cfg.teams) + ' teams' : 'no teams'), x + 8, sy, UIC.text);
    Font.draw(s, 'Arms level ' + cfg.armsLevel + ', cash at start ' + money(cfg.cashAtStart || 0) + ', walls ' + cap(cfg.effectOfWalls), x + 8, sy + 11, UIC.text);
    // your tank, spelled out: clicking the little tank in the list was easy to miss
    const mine = seats.find(q => q.owner === Net.me);
    if (mine) {
      const ic = TankIcons[mine.icon | 0], ty = sy + 23;
      const note = ic.triple ? ' - fires 3 missiles at once' : !ic.mobile ? " - fixed, can't move" : '';
      let tx = x + 8;
      Font.draw(s, 'Your tank:', tx, ty, UIC.text); tx += Font.width('Your tank:') + 6;
      drawButton(s, tx, ty - 2, 12, 11, '<'); this.btns.push({ x: tx, y: ty - 2, w: 12, h: 11, fn: () => this.cycleMyIcon(-1) }); tx += 16;
      Font.draw(s, ic.name, tx, ty, UIC.hot); tx += Font.width(ic.name) + 4;
      drawButton(s, tx, ty - 2, 12, 11, '>'); this.btns.push({ x: tx, y: ty - 2, w: 12, h: 11, fn: () => this.cycleMyIcon(1) }); tx += 16;
      Font.draw(s, (note + '   (or press T)').replace(/&/g, '&&'), tx, ty, UIC.dis);
    }
    // status + buttons
    let status;
    if (host) status = seats.length < 2 ? 'Add computers or wait for friends to join.' : 'Friends join with room code ' + Net.code + '.';
    else if (!Net.lobby) status = 'Contacting the host...';
    else if (!Net.seated) status = 'Joining...';
    else status = 'Waiting for ' + String(seats[0] ? seats[0].name : 'the host').replace(/&/g, '&&') + ' to start the game.';
    Font.center(s, status, x + W / 2, y + H - 34, UIC.dis);
    const labels = host ? [['&Add Computer', () => Net.addComputer()], ['&Options...', () => this.options()], ['&Start Game', () => this.start()], ['&Leave', () => this.leave()]]
      : [['&Leave', () => this.leave()]];
    const bw = Math.min(80, Math.floor((W - 16 - (labels.length - 1) * 4) / labels.length));
    const total = labels.length * bw + (labels.length - 1) * 4;
    labels.forEach(([label, fn], i) => {
      const bx = x + Math.floor((W - total) / 2) + i * (bw + 4), by = y + H - 20;
      drawButton(s, bx, by, bw, 14, label);
      this.btns.push({ x: bx, y: by, w: bw, h: 14, fn });
    });
  }
}

/* ------------------------------------------------ waiting between phases */
class WaitScene {
  constructor(lines, more) { this.lines = lines || []; this.more = more || null; this.btns = []; this.t = 0; }
  enter() { UI.clear(); }
  update(dt) { this.t += dt; }
  key(ev) {
    if (UI.top()) { UI.key(ev); return; }
    if (ev.k === 'escape') confirmBox(['Leave this network game?'], () => Net.leave());
  }
  mouse(ev) {
    if (UI.top()) { UI.mouse(ev); return; }
    if (ev.kind !== 'down') return;
    for (const b of this.btns) if (ev.ux >= b.x && ev.uy >= b.y && ev.ux < b.x + b.w && ev.uy < b.y + b.h) { Sound.click(); b.fn(); }
  }
  draw() {
    netBackground();
    const s = Screen.ui;
    const lines = this.lines.concat(this.more ? this.more() : []);
    const W = Math.min(Screen.UW - 8, Math.max(160, ...lines.map(l => Font.width(l) + 24)));
    const H = lines.length * 11 + 44, x = Math.floor((Screen.UW - W) / 2), y = Math.floor((Screen.UH - H) / 2);
    frame(s, x, y, W, H);
    lines.forEach((l, i) => Font.center(s, l.replace(/&/g, '&&'), x + W / 2, y + 8 + i * 11, i < this.lines.length ? UIC.text : UIC.blue));
    const dots = '.'.repeat(1 + Math.floor(this.t * 2) % 3);
    Font.center(s, dots, x + W / 2, y + H - 34, UIC.dis);
    const bx = x + W / 2 - 40, by = y + H - 20;
    drawButton(s, bx, by, 80, 14, 'Leave Game');
    this.btns = [{ x: bx, y: by, w: 80, h: 14, fn: () => confirmBox(['Leave this network game?'], () => Net.leave()) }];
  }
}
