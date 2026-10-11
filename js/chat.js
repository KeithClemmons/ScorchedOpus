'use strict';
/* =====================================================================
   Chat for network games (Remastered): press Y, type, Enter. Messages go
   to everyone in the game, show in a log at the bottom left and as a
   speech balloon over the sender's tank. Chat never touches the shared
   simulation, so it travels outside the host's command stream.
   ===================================================================== */

const Chat = {
  log: [], sentT: 0, rate: {},
  clean(s) { return String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80); },
  open() {
    if (!Net.online || UI.stack.some(d => d.isChat)) return;
    const obj = { text: '' }, w = Math.min(Screen.UW - 16, 260), h = 36;
    const d = new Dialog({ w, h, title: 'Say', closeOnOutside: true });
    d.isChat = true;
    d.y = Screen.UH - h - 6;
    const f = d.textField(obj, 'text', 8, 17, w - 16, 60, () => { UI.remove(d); this.send(obj.text); });
    d.focus = f;
    UI.push(d);
  },
  send(text) {
    text = this.clean(text);
    if (!text || !Net.online) return;
    const now = performance.now();
    if (now - this.sentT < 800) { Sound.error(); return; }
    this.sentT = now;
    Net.emit({ t: 'chat', gid: Net.gid, text });
    this.show(Net.me, text);
  },
  // who is this peer in the current game?
  who(peer) {
    if (Net.lobby && Net.lobby.open) {
      const i = Net.lobby.seats.findIndex(s => s.owner === peer);
      if (i >= 0) return { name: Net.lobby.seats[i].name, color: Data.playerColors[i], idx: -1 };
    }
    const p = Game.players.find(q => !q.ai && q.owner === peer);
    return p ? { name: p.name, color: p.color, idx: p.idx } : null;
  },
  receive(from, m) {
    const text = this.clean(m.text);
    if (!text) return;
    const now = performance.now();
    if (now - (this.rate[from] || 0) < 500) return;
    this.rate[from] = now;
    this.show(from, text);
    Sound.beep(1320, 0.04, 0.25);
  },
  show(peer, text) {
    const w = this.who(peer);
    if (!w) return;
    this.log.push({ name: w.name, color: w.color, text, t: 0 });
    if (this.log.length > 6) this.log.shift();
    if (App.scene === BattleScene && w.idx >= 0) {
      const t = Battle.tanks[w.idx];
      if (t && t.alive) Battle.say(t, text, 4);
    }
  },
  update(dt) { this.log = this.log.filter(l => (l.t += dt) < 12); },
  draw(s) {
    if (!Net.online) { this.log = []; return; }
    if (s.vector) return this.drawModern();
    let y = Screen.UH - 14;
    for (let i = this.log.length - 1; i >= 0; i--) {
      const l = this.log[i];
      const name = l.name.replace(/&/g, '&&') + ': ';
      Font.draw(s, name, 3, y, l.color, { shadow: UIC.black });
      Font.draw(s, l.text.replace(/&/g, '&&'), 3 + Font.width(name), y, UIC.white, { shadow: UIC.black });
      y -= 10;
    }
    if (!this.log.length && App.scene === BattleScene) Font.draw(s, 'Y: chat', 3, Screen.UH - 11, UIC.dis, { shadow: UIC.black });
  },
  drawModern() {
    const ctx = Gfx.ctx, fs = worldFont(0.85), h = fs * 1.7;
    let y = Gfx.pf.y + Gfx.pf.h - h - 6 * Gfx.dpr;
    ctx.font = '600 ' + fs.toFixed(1) + 'px ' + FONT_UI;
    for (let i = this.log.length - 1; i >= 0; i--) {
      const l = this.log[i], a = l.t < 0.2 ? l.t / 0.2 : l.t > 10 ? (12 - l.t) / 2 : 1;
      const name = l.name + ':', nw = ctx.measureText(name).width, tw = ctx.measureText(l.text).width;
      const x = Gfx.pf.x + 6 * Gfx.dpr;
      ctx.globalAlpha = clamp(a, 0, 1);
      Hud.pill(ctx, x, y, nw + tw + fs * 1.6, h, { fill: 'rgba(8,11,20,0.75)' });
      Hud.txt(ctx, name, x + fs * 0.6, y + h / 2, fs, rgba(mix3(c3(l.color), WHITE3, 0.3), 1), { weight: 700 });
      Hud.txt(ctx, l.text, x + fs * 1.0 + nw, y + h / 2, fs, '#e6eaf2');
      y -= h + 4 * Gfx.dpr;
    }
    ctx.globalAlpha = 1;
    if (!this.log.length && App.scene === BattleScene) Hud.txt(ctx, 'Y  chat', Gfx.pf.x + 8 * Gfx.dpr, Gfx.pf.y + Gfx.pf.h - fs, fs * 0.85, 'rgba(170,180,205,0.55)', { weight: 600 });
  }
};
