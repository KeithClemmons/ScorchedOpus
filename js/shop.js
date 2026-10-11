'use strict';
/* =====================================================================
   Buying Equipment screen, selling panel and the free market.
   ===================================================================== */

const Market = {
  mult: Object.assign({}, Store.get('scorch.mkt', {})),
  override: null,     // a network game uses the host's prices
  bought: {},
  m(id) { return Cfg.freeMarket ? ((this.override || this.mult)[id] || 1) : 1; },
  note(id) { this.bought[id] = (this.bought[id] || 0) + 1; },
  // supply and demand: bought items get pricier, ignored ones drift down (with a little bounce)
  settle() {
    if (!Cfg.freeMarket) { this.bought = {}; return; }
    for (const it of Data.items) {
      if (it.id === 'babyMissile') continue;
      let m = this.mult[it.id] || 1;
      const b = this.bought[it.id] || 0;
      m *= 1 + 0.05 * Math.min(b, 6) - 0.02 + rand(-0.025, 0.025);
      this.mult[it.id] = Math.round(clamp(m, 0.5, 2.2) * 1000) / 1000;
    }
    this.bought = {};
    Store.set('scorch.mkt', this.mult);
  }
};

const Shop = {
  useless(p, it) {
    switch (it.id) {
      case 'smokeTracer': return Cfg.tracePaths;
      case 'earthDisrupter': return Cfg.suspendDirt === 0;
      case 'contactTrigger': return !Cfg.tunneling || Cfg.mode === 'SIMULTANEOUS';
      case 'parachute': return !Cfg.tanksFall;
      case 'fuelTank': return Cfg.mode === 'SIMULTANEOUS';
    }
    if (it.kind === 'guidance' && Cfg.mode === 'SIMULTANEOUS') return true;
    return false;
  },
  visible(p, it) {
    if (it.arms > Cfg.armsLevel) return false;
    if (it.ext && !Cfg.extendedArsenal) return false;
    if (it.id === 'fuelTank' && !TankIcons[p.icon].mobile) return false;   // fixed emplacements can't use fuel
    if (it.id === 'autoDefense' && p.autoDefense) return false;
    if (!Cfg.uselessItems && this.useless(p, it)) return false;
    return true;
  },
  price(p, it) {
    // as in 1.5: $1500 for each round left, each later round discounted at the interest rate
    // (10 rounds at 5%: 1500 x (1 + 1/1.05 + ... + 1/1.05^9) = \$12,161)
    if (it.id === 'autoDefense') {
      const n = Math.max(1, Game.rounds - Game.round), r = Cfg.interestRate;
      let f = 0;
      for (let k = 0; k < n; k++) f += Math.pow(1 + r, -k);
      return Math.floor(it.cost * f);
    }
    return Math.round(it.cost * Market.m(it.id));
  },
  owned(p, it) {
    if (it.id === 'babyMissile') return 99;
    if (it.id === 'fuelTank') return Math.ceil((p.fuel || 0) / 10);
    if (it.id === 'autoDefense') return p.autoDefense ? 1 : 0;
    return p.inv[it.id] || 0;
  },
  // what a purchase would cost right now (respecting the 99 cap and its ~20% markup)
  quote(p, it) {
    const have = this.owned(p, it), room = 99 - have;
    if (it.id === 'babyMissile' || room <= 0) return null;
    if (it.id === 'autoDefense') return { qty: 1, cost: this.price(p, it) };
    const qty = Math.min(it.bundle, room);
    let cost = this.price(p, it);
    if (qty < it.bundle) cost = Math.round(cost * qty / it.bundle * 1.2);
    return { qty, cost };
  },
  buy(p, it, silent) {
    const q = this.quote(p, it);
    if (!q || q.cost > Game.cashOf(p)) { if (!silent) Sound.error(); return false; }
    Game.addCash(p, -q.cost);
    if (p.stats) p.stats.spent += q.cost;
    if (it.id === 'fuelTank') p.fuel = (p.fuel || 0) + q.qty * 10;
    else if (it.id === 'autoDefense') p.autoDefense = true;
    else p.inv[it.id] = (p.inv[it.id] || 0) + q.qty;
    Market.note(it.id);
    if (!silent) Sound.buy();
    return true;
  },
  // the computer's offer for `qty` items; stable for the whole round
  offer(p, it, qty) {
    if (qty <= 0) return 0;
    const unit = this.price(p, it) / it.bundle;
    const mood = 0.9 + hash2(Game.round, it.index, Game.seed) * 0.2;
    const base = Cfg.freeMarket ? 0.85 : 0.55;
    const bulk = 1 - 0.18 * (qty / 99);
    return Math.max(1, Math.round(qty * unit * base * bulk * mood));
  },
  sell(p, it, qty, silent) {
    const have = this.owned(p, it);
    qty = Math.min(qty, have);
    if (qty <= 0) return;
    const cash = this.offer(p, it, qty);
    if (it.id === 'fuelTank') p.fuel = Math.max(0, (p.fuel || 0) - qty * 10);
    else p.inv[it.id] -= qty;
    Game.addCash(p, cash);
    if (!silent) Sound.buy();
  }
};

/* ------------------------------------------------ the buying screen (a scene) */
class ShopScene {
  constructor(p, onDone) {
    this.p = p; this.onDone = onDone;
    this.group = 'W'; this.page = 0; this.sel = 0;
    this.layout();
    this.flashRow = -1; this.flashT = 0;
    this.btns = [];
    this.tx = [];   // what was bought and sold, so a network host can replay it
  }
  // list geometry: the classic look follows 1.5's shop, Remastered has its own
  layout() {
    if (!Gfx.modern) { this.listX = 9; this.listW = 187; this.listY = 25; this.rowH = 10; }
    else { this.listX = 4; this.listY = 18; this.rowH = 12; this.listW = Math.min(232, Screen.UW - 106); }
    this.perPage = Math.max(4, Math.floor((Screen.UH - this.listY - (Gfx.modern ? 6 : 4)) / this.rowH));
  }
  enter() { UI.clear(); Sound.seq([[660, 0.05], [880, 0.05]], 0.4); }
  items() {
    const p = this.p, cash = Game.cashOf(p);
    return Data.items.filter(it => it.cat === this.group && Shop.visible(p, it) &&
      (it.id === 'babyMissile' || Shop.price(p, it) <= cash || (Shop.quote(p, it) && Shop.quote(p, it).cost <= cash)));
  }
  pages() { return Math.max(1, Math.ceil(this.items().length / this.perPage)); }
  pageItems() { const all = this.items(); return all.slice(this.page * this.perPage, (this.page + 1) * this.perPage); }
  clampSel() {
    if (this.page >= this.pages()) this.page = this.pages() - 1;
    const n = this.pageItems().length;
    if (this.sel >= n) this.sel = Math.max(0, n - 1);
  }
  buySel() {
    const it = this.pageItems()[this.sel];
    if (!it) return;
    if (it.id === 'babyMissile') { Sound.error(); return; }
    if (Shop.buy(this.p, it)) { this.tx.push({ op: 'b', id: it.id }); this.flashRow = this.sel; this.flashT = 0.25; }
    this.clampSel();
  }
  done() {
    UI.clear();
    this.onDone(this.tx);
  }
  inventory() {
    const p = this.p;
    Panels.inventory(null, { player: p, title: 'Inventory - click to sell', onPick: it => {
      if (it.id === 'babyMissile' || it.id === 'autoDefense') { Sound.error(); return; }
      UI.remove(UI.top());
      this.sellPanel(it);
    } });
  }
  sellPanel(it) {
    const p = this.p;
    const w = 200, h = 96;
    const d = new Dialog({ w, h, title: 'Sell ' + it.name, closeOnOutside: false });
    d.qty = 1;
    const have = () => Shop.owned(p, it);
    d.text(() => 'In stock: ' + have(), 12, 18);
    d.add({ label: '&Quantity: ', x: 12, y: 30, w: 120, h: 12, kind: 'num', repeat: true, draw(s) {
      drawButton(s, d.x + this.x, d.y + this.y, this.w, this.h, this.label, { pressed: d.pressed === this, value: d.qty });
    }, step(dir) { const m = have(); d.qty = ((d.qty - 1 + dir + m) % m) + 1; }, click(b) { Sound.click(); this.step(b === 2 ? -1 : 1); } });
    d.text(() => 'Offer: ' + money(Shop.offer(p, it, d.qty)), 12, 48);
    d.button('&Accept', 20, h - 24, 70, 14, () => { Shop.sell(p, it, d.qty); this.tx.push({ op: 's', id: it.id, q: d.qty }); UI.remove(d); });
    d.button('&Reject', w - 90, h - 24, 70, 14, () => UI.remove(d));
    d.onKey = ev => {
      const m = have();
      if (ev.k === 'arrowup') { d.qty = d.qty >= m ? 1 : d.qty + 1; return true; }
      if (ev.k === 'arrowdown') { d.qty = d.qty <= 1 ? m : d.qty - 1; return true; }
      if (ev.k === 'q') { d.qty = ev.alt || ev.shift ? (d.qty <= 1 ? m : d.qty - 1) : (d.qty >= m ? 1 : d.qty + 1); return true; }
      return false;
    };
    UI.push(d);
  }
  update(dt) {
    if (this.flashT > 0) this.flashT -= dt;
  }
  key(ev) {
    if (UI.top()) { UI.key(ev); return; }
    const n = this.pageItems().length;
    switch (ev.k) {
      case 'pagedown': this.page = (this.page + 1) % this.pages(); this.clampSel(); Sound.click(); break;
      case 'pageup': this.page = (this.page - 1 + this.pages()) % this.pages(); this.clampSel(); Sound.click(); break;
      case 'arrowup': this.sel = (this.sel - 1 + n) % Math.max(1, n); break;
      case 'arrowdown': this.sel = (this.sel + 1) % Math.max(1, n); break;
      case 'home': this.sel = 0; break;
      case 'end': this.sel = Math.max(0, n - 1); break;
      case 'tab': this.group = this.group === 'W' ? 'M' : 'W'; this.page = 0; this.sel = 0; Sound.click(); break;
      case 'space': case 'enter': case 'b': this.buySel(); break;
      case 'i': this.inventory(); break;
      case 'u': Panels.update(); break;
      case 'escape': case 'd': this.done(); break;
      case 'f1': Menus.systemMenu(); break;
      case 's': if (ev.alt) Menus.systemMenu(); break;
    }
  }
  // which list row is under the pointer (-1: none)
  rowAt(mx, my) {
    if (mx < this.listX || mx >= this.listX + this.listW || my < this.listY) return -1;
    const r = Math.floor((my - this.listY) / this.rowH);
    return r >= 0 && r < this.pageItems().length ? r : -1;
  }
  mouse(ev) {
    if (UI.top()) { UI.mouse(ev); return; }
    if (ev.kind !== 'down') return;
    const mx = ev.ux, my = ev.uy;
    for (const b of this.btns) {
      if (mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h) { Sound.click(); b.fn(ev.button); return; }
    }
    const r = this.rowAt(mx, my);
    if (r >= 0) {
      if (!Gfx.modern && ev.button === 0) { this.sel = r; this.buySel(); }   // 1.5: a click buys
      else if (r === this.sel && ev.button === 0) this.buySel();
      else { this.sel = r; Sound.click(); }
    }
  }
  drawModern(dt) {
    Gfx.backdrop('menu', dt);
    const ctx = Gfx.ctx, col = c3(this.p.color);
    const g = ctx.createLinearGradient(0, 0, Gfx.cw, Gfx.ch);
    g.addColorStop(0, rgba(col, 0.22)); g.addColorStop(1, rgba(col, 0.05));
    ctx.fillStyle = g; ctx.fillRect(0, 0, Gfx.cw, Gfx.ch);
    this.draw();
  }
  // classic look: laid out like 1.5's shop
  drawClassic() {
    const s = Screen.ui, p = this.p, W = Screen.UW, H = Screen.UH;
    this.btns = [];
    Screen.main.clear(0);
    s.fillRect(0, 0, W, H, UIC.face);
    // top line: who, cash, rounds left
    Font.draw(s, p.name.replace(/&/g, '&&'), 4, 1, p.color);
    Font.draw(s, 'Cash: ' + money(Game.cashOf(p)) + (Cfg.teams === 'CORPORATE' ? ' (team)' : ''), Math.floor(W * 0.3), 1, UIC.text);
    const left = Math.max(0, Game.rounds - Game.round);
    Font.right(s, left === 1 ? '1 round remains' : left + ' rounds remain', W - 4, 1, UIC.text);
    s.hline(0, W - 1, 11, UIC.lo); s.hline(0, W - 1, 12, UIC.hi);
    // the list: a sunken row per slot, filled or not
    const lx = this.listX, lw = this.listW, items = this.pageItems(), np = this.pages();
    Font.draw(s, this.group === 'W' ? 'Weapons' : 'Miscellaneous', lx + 12, 14, UIC.text);   // 1.5 shows no page number
    for (let i = 0; i < this.perPage; i++) {
      const y = this.listY + i * this.rowH, it = items[i];
      const flash = it && i === this.flashRow && this.flashT > 0;
      bevel(s, lx, y, lw, this.rowH - 1, false, flash ? UIC.white : UIC.face);
      if (!it) continue;
      if (i === this.sel) Font.draw(s, '▶', lx - 8, y, UIC.text);
      Font.draw(s, String(Shop.owned(p, it)), lx + 2, y, UIC.text);
      Icons.draw(s, it.id, lx + 16, y);
      Font.draw(s, it.name.replace(/&/g, '&&'), lx + 31, y, UIC.text);
      const q = Shop.quote(p, it);
      Font.draw(s, q ? '$' + q.cost + '/' + q.qty : it.id === 'babyMissile' ? 'free' : 'max', lx + 128, y, UIC.text);
    }
    if (!items.length) Font.draw(s, 'Nothing you can afford', lx + 31, this.listY, UIC.dis);
    // scroll buttons at the top and bottom of the list
    const ax = lx + lw + 14, arrow = (y, up) => {
      bevel(s, ax, y, 15, 8, true, UIC.face);
      for (let k = 0; k < 3; k++) s.hline(ax + 7 - k, ax + 7 + k, up ? y + 2 + k : y + 5 - k, np > 1 ? UIC.text : UIC.dis);
    };
    const yTop = this.listY, yBot = this.listY + (this.perPage - 1) * this.rowH;
    arrow(yTop, true); arrow(yBot, false);
    this.btns.push({ x: ax, y: yTop, w: 15, h: 9, fn: () => this.key({ k: 'pageup' }) });
    this.btns.push({ x: ax, y: yBot, w: 15, h: 9, fn: () => this.key({ k: 'pagedown' }) });
    // Update / Inventory / Done
    const bx = W - 110, bw = 61;
    [['&Update', () => Panels.update()], ['&Inventory', () => this.inventory()], ['&Done', () => this.done()]].forEach(([label, fn], i) => {
      const by = 24 + i * 14;
      drawButton(s, bx, by, bw, 12, label, { align: 'left' });
      this.btns.push({ x: bx, y: by, w: bw, h: 12, fn });
    });
    // weapons / miscellaneous switch: gun and box over a little slider
    const sx = ax - 2, sy = Math.floor(H * 0.45);
    Icons.draw(s, 'gun', sx, sy, { gray: this.group !== 'W' });
    Icons.draw(s, 'box', sx + 20, sy, { gray: this.group !== 'M' });
    bevel(s, sx, sy + 12, 30, 4, false, UIC.dark);
    bevel(s, this.group === 'W' ? sx : sx + 22, sy + 10, 8, 8, true, UIC.face);
    this.btns.push({ x: sx, y: sy, w: 30, h: 19, fn: () => { this.group = this.group === 'W' ? 'M' : 'W'; this.page = 0; this.sel = 0; } });
    // what the item under the pointer (or the selected one) does - quietly, in the empty corner
    const hov = Input.inside ? this.rowAt(Input.ux, Input.uy) : -1;
    const it = this.pageItems()[hov >= 0 ? hov : this.sel];
    if (it) {
      const dx = sx, cols = Math.max(10, Math.floor((W - 4 - dx) / Font.CW));
      let y = sy + 26;
      Font.draw(s, it.name.replace(/&/g, '&&'), dx, y, UIC.text); y += 11;
      const q = Shop.quote(p, it);
      const text = [it.desc || ''];
      if (it.r && it.dmg) text.push('Blast ' + it.r + ', damage ' + it.dmg + '.');
      if (q && q.cost <= Game.cashOf(p) && it.id !== 'babyMissile') text.push('Click to buy.');
      for (const para of text) for (const l of Font.wrap(para, cols)) { if (y > H - 12) break; Font.draw(s, l.replace(/&/g, '&&'), dx, y, UIC.dis); y += 10; }
    }
  }
  draw() {
    this.layout();
    this.clampSel();
    if (!Gfx.modern) return this.drawClassic();
    const s = Screen.ui, p = this.p, modern = !!s.vector;
    const W = Screen.UW, H = Screen.UH;
    if (!modern) {
      // background in shades of the player's color
      Screen.main.clear(vga(0, 0, 0));
      for (let y = 0; y < H; y++) s.hline(0, W - 1, y, scalec(p.color, 0.12 + 0.1 * ((y >> 3) & 1)));
    }
    this.btns = [];
    // item list
    const lx = this.listX, lw = this.listW;
    frame(s, lx - 2, 2, lw + 4, H - 4);
    const np = this.pages();
    Font.center(s, (this.group === 'W' ? 'Weapons' : 'Miscellaneous') + (np > 1 ? '  ' + (this.page + 1) + '/' + np : ''), lx + lw / 2, 6, UIC.text);
    const items = this.pageItems();
    items.forEach((it, i) => {
      const y = this.listY + i * this.rowH;
      const flash = i === this.flashRow && this.flashT > 0;
      if (modern) s.row(lx + 8, y, lw - 10, this.rowH - 1, { sel: i === this.sel, flash, odd: i & 1 });
      else bevel(s, lx + 8, y, lw - 10, this.rowH - 1, true, flash ? UIC.white : UIC.light);
      if (i === this.sel) Font.draw(s, '▶', lx + 1, y + 2, UIC.hot);
      Icons.draw(s, it.id, lx + 10, y + 1);
      Font.draw(s, it.name.replace(/&/g, '&&'), lx + 25, y + 2, UIC.text);
      const q = Shop.quote(p, it);
      const pr = it.id === 'babyMissile' ? 'unlimited' : (q ? money(q.cost) + '/' + q.qty : 'max');
      const own = Shop.owned(p, it);
      Font.right(s, pr, lx + lw - 26, y + 2, it.id === 'babyMissile' ? UIC.dis : UIC.blue);
      Font.right(s, String(own), lx + lw - 4, y + 2, UIC.text);
    });
    if (!items.length) Font.center(s, 'Nothing you can afford', lx + lw / 2, this.listY + 20, UIC.dis);
    // right panel
    const rx = lx + lw + 6, rw = W - rx - 4;
    frame(s, rx, 2, rw, H - 4);
    let y = 8;
    Font.center(s, p.name.replace(/&/g, '&&'), rx + rw / 2, y, modern ? mixc(p.color, rgb(255, 255, 255), 0.3) : scalec(p.color, 0.6)); y += 12;
    Font.center(s, 'Cash ' + money(Game.cashOf(p)), rx + rw / 2, y, UIC.blue); y += 12;
    if (Cfg.teams === 'CORPORATE') { Font.center(s, '(team account)', rx + rw / 2, y, UIC.dis); y += 10; }
    Font.center(s, 'Round ' + Game.round + '/' + Game.rounds, rx + rw / 2, y, UIC.text); y += 14;
    // category slide bar: gun = weapons, box = miscellaneous
    const bx = rx + Math.floor((rw - 52) / 2);
    bevel(s, bx, y, 52, 16, false, UIC.dark);
    const selX = this.group === 'W' ? bx + 2 : bx + 26;
    bevel(s, selX, y + 2, 24, 12, true, UIC.light);
    Icons.draw(s, 'gun', bx + 8, y + 3, { gray: this.group !== 'W' });
    Icons.draw(s, 'box', bx + 32, y + 3, { gray: this.group !== 'M' });
    this.btns.push({ x: bx, y, w: 52, h: 16, fn: () => { this.group = this.group === 'W' ? 'M' : 'W'; this.page = 0; this.sel = 0; } });
    y += 20;
    // page arrows
    const pages = this.pages();
    const ax = rx + Math.floor((rw - 52) / 2);
    drawButton(s, ax, y, 24, 14, '▲', { disabled: pages <= 1 });
    drawButton(s, ax + 28, y, 24, 14, '▼', { disabled: pages <= 1 });
    this.btns.push({ x: ax, y, w: 24, h: 14, fn: () => this.key({ k: 'pageup' }) });
    this.btns.push({ x: ax + 28, y, w: 24, h: 14, fn: () => this.key({ k: 'pagedown' }) });
    y += 20;
    const bw = Math.min(80, rw - 12), bxx = rx + Math.floor((rw - bw) / 2);
    const btn = (label, fn, o) => { drawButton(s, bxx, y, bw, 14, label, o); this.btns.push({ x: bxx, y, w: bw, h: 14, fn }); y += 18; };
    const selIt = this.pageItems()[this.sel], selQ = selIt ? Shop.quote(p, selIt) : null;
    const canBuy = !!selQ && selQ.cost <= Game.cashOf(p);
    btn(selQ ? '&Buy  ' + money(selQ.cost) : '&Buy', () => { if (canBuy) this.buySel(); else Sound.error(); }, { disabled: !canBuy });
    btn('&Inventory', () => this.inventory());
    btn('&Update', () => Panels.update());
    btn('&Done', () => this.done());
    // what the item under the pointer (or the selected one) does
    const hov = Input.inside ? this.rowAt(Input.ux, Input.uy) : -1;
    const it = this.pageItems()[hov >= 0 ? hov : this.sel];
    if (it && y < H - 30) {
      y += 4;
      s.hline(rx + 8, rx + rw - 9, y, UIC.lo);
      y += 5;
      Font.center(s, it.name.replace(/&/g, '&&'), rx + rw / 2, y, UIC.hot); y += 11;
      const cols = Math.max(10, Math.floor((rw - 10) / (modern ? 5 : Font.CW)));
      const lines = Font.wrap(it.desc || '', cols);
      if (it.r && it.dmg) lines.push('Blast ' + it.r + '  Damage ' + it.dmg);
      for (const l of lines) { if (y > H - 14) break; Font.center(s, l.replace(/&/g, '&&'), rx + rw / 2, y, UIC.dis); y += 10; }
      if (y <= H - 14 && it === selIt && canBuy) Font.center(s, 'Click again to buy', rx + rw / 2, y + 2, UIC.hot);
    }
  }
}
