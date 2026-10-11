'use strict';
/* =====================================================================
   Remastered battle HUD: player panel, power / angle gauges, weapon card,
   wind, status items, kill feed, banners, the aim guide, drag-to-aim and
   on-screen touch controls. Hit regions go into Battle.hud (UI units) so
   clicks work exactly like the original status line.
   ===================================================================== */

const Hud = {
  touch: false, drag: null, btns: [], held: null, heldT: 0,

  // item icon at (x, y) device px, h device px tall: the vector art (pixel sprite as a fallback)
  icon(ctx, id, x, y, h, gray) {
    if (ItemArt.has(id)) {
      const w = 12 * h / 10 * (Gfx.ux / Gfx.uy), sz = h * 1.12;
      ItemArt.draw(ctx, id, x + (w - sz) / 2, y + (h - sz) / 2, sz, { gray });
      return;
    }
    const spr = Icons.sprites[id];
    if (!spr) return;
    const img = spriteCanvas(spr, gray ? { tint: c => { const v = (cR(c) + cG(c) + cB(c)) / 3; return rgb(v * 0.5 + 60, v * 0.5 + 60, v * 0.5 + 60); } } : null);
    const k = h / 10;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y + (10 - spr.h) / 2 * k, spr.w * k * (Gfx.ux / Gfx.uy), spr.h * k);
    ctx.imageSmoothingEnabled = true;
  },
  pill(ctx, x, y, w, h, o) {
    o = o || {};
    VUI.rr.call({ ctx }, x, y, w, h, Math.min(h * 0.32, 10 * Gfx.dpr));
    ctx.fillStyle = o.fill || 'rgba(9,12,21,0.72)'; ctx.fill();
    ctx.lineWidth = Math.max(1, Gfx.dpr);
    ctx.strokeStyle = o.edge || 'rgba(170,190,235,0.16)'; ctx.stroke();
    if (o.accent) { ctx.fillStyle = o.accent; ctx.fillRect(x + h * 0.3, y, w - h * 0.6, Math.max(2, 2 * Gfx.dpr)); }
  },
  txt(ctx, s, x, y, size, col, o) {
    o = o || {};
    ctx.font = (o.weight || 600) + ' ' + size.toFixed(1) + 'px ' + (o.display ? FONT_DISPLAY : FONT_UI);
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'middle';
    if (o.shadow) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(s, x + Gfx.dpr, y + Gfx.dpr); }
    ctx.fillStyle = col; ctx.fillText(s, x, y);
    const w = ctx.measureText(s).width;
    ctx.textAlign = 'left';
    return w;
  },
  reg(id, x, y, w, h) { Battle.hud.push({ id, x: (x - Gfx.pf.x) / Gfx.ux, y: (y - Gfx.pf.y) / Gfx.uy, w: w / Gfx.ux, h: h / Gfx.uy }); },

  /* ------------------------------------------------ per frame */
  update(dt) {
    // drag-to-aim
    const t = Battle.aimTank();
    if (this.drag) {
      const d = this.drag;
      if (!t || t !== d.tank || Battle.waitHost || !(Input.buttons & 1)) { this.drag = null; Gfx.canvas.style.cursor = 'default'; }
      else {
        // a plain click (or the first half of a double-click) doesn't re-aim; a drag does
        if (!d.moved && Math.hypot(Input.x - d.x, (Input.y - d.y) / World.ay) > World.W * 0.015) d.moved = true;
        const p = t.pivot(0);
        const dx = Input.x - p.x, dy = (p.y - Input.y) / World.ay;
        if (d.moved && Math.hypot(dx, dy) > 3) {
          let a = Math.atan2(Math.max(0, dy), dx) / DEG;
          if (dy < 0) a = dx >= 0 ? 0 : 180;
          t.angle = clamp(Math.round(a), 0, 180);
          const pw = Math.hypot(dx, dy) / (World.W * 0.45) * 1000;
          t.power = clamp(Math.round(pw), 0, t.maxPower);
        }
      }
    }
    // held touch buttons repeat
    if (this.held) {
      if (!(Input.buttons & 1)) this.held = null;
      else {
        this.heldT -= dt;
        if (this.heldT <= 0) { this.heldT = 0.045; this.press(this.held, true); }
      }
    }
  },
  mouse(ev) {
    if (ev.kind === 'down' && ev.pointer === 'touch') this.touch = true;
    // on-screen buttons
    if (this.touchOn() && (ev.kind === 'down' || ev.kind === 'up')) {
      const dx = Gfx.UXp(ev.ux), dy = Gfx.UYp(ev.uy);
      for (const b of this.btns) {
        if (dx >= b.x && dx < b.x + b.w && dy >= b.y && dy < b.y + b.h) {
          if (ev.kind === 'down') {
            Sound.click();
            this.press(b.id, false);
            if (b.repeat) { this.held = b.id; this.heldT = 0.35; }
          }
          return true;
        }
      }
    }
    if (ev.kind === 'up') {
      if (this.drag) {
        const d = this.drag; this.drag = null; Gfx.canvas.style.cursor = 'default';
        if (!d.moved) { const tk = Battle.tankAt(ev.x, ev.y); if (tk && tk !== d.tank) Panels.tankInfo(tk); }
        return true;
      }
      return false;
    }
    if (ev.kind !== 'down' || ev.button !== 0) return false;
    const t = Battle.aimTank();
    if (!t || Battle.waitHost || UI.top()) return false;
    // HUD regions keep their classic behavior
    for (const r of Battle.hud) if (ev.ux >= r.x && ev.ux < r.x + r.w && ev.uy >= r.y && ev.uy < r.y + r.h) return false;
    if (ev.uy <= Battle.statusH + 1 || ev.ux < 0 || ev.ux > Screen.UW || ev.uy > Screen.UH) return false;
    if (Cfg.dragAim === false) return false;
    this.drag = { tank: t, moved: false, x: ev.x, y: ev.y };
    Gfx.canvas.style.cursor = 'crosshair';
    return true;
  },
  press(id, repeat) {
    const t = Battle.aimTank();
    if (Battle.mode === 'SIMULTANEOUS') {
      const mine = Battle.tanks.find(tk => tk.alive && !tk.dying && Battle.isLocal(tk));
      if (!mine) return;
      const i = mine.p.idx;
      if (id === 'fire') { if (!mine.busy) Battle.request({ c: 'sfire', tank: i }); }
      else if (id === 'weapon') Battle.request({ c: 'swpn', tank: i });
      else if (id === 'angL') Battle.request({ c: 'nudge', tank: i, a: 1 });
      else if (id === 'angR') Battle.request({ c: 'nudge', tank: i, a: -1 });
      else if (id === 'powU') Battle.request({ c: 'nudge', tank: i, p: 5 });
      else if (id === 'powD') Battle.request({ c: 'nudge', tank: i, p: -5 });
      return;
    }
    if (!t || Battle.waitHost) return;
    switch (id) {
      case 'fire': if (!repeat) Battle.humanFire(); break;
      case 'weapon': if (!repeat) { t.p.weapon = Battle.nextWeaponId(t, 1); } break;
      case 'angL': t.angle = clamp(t.angle + 1, 0, 180); break;
      case 'angR': t.angle = clamp(t.angle - 1, 0, 180); break;
      case 'powU': t.power = clamp(t.power + (repeat ? 6 : 2), 0, t.maxPower); break;
      case 'powD': t.power = clamp(t.power - (repeat ? 6 : 2), 0, t.maxPower); break;
      case 'tank': if (!repeat) Panels.tankControl(t); break;
      case 'chat': break;   // opened from the tap itself (see chatTapped)
    }
  },
  // the chat button is handled inside the tap itself so the phone keyboard can open
  chatTapped(ux, uy) {
    if (!this.touchOn()) return false;
    const dx = Gfx.UXp(ux), dy = Gfx.UYp(uy);
    return this.btns.some(b => b.id === 'chat' && dx >= b.x && dx < b.x + b.w && dy >= b.y && dy < b.y + b.h);
  },
  touchOn() { return Cfg.touchControls === 'ON' || (Cfg.touchControls !== 'OFF' && this.touch); },

  /* ------------------------------------------------ drawing */
  draw(ctx) {
    Battle.hud = [];
    const B = Battle;
    if (B.mode === 'SIMULTANEOUS') this.drawSimul(ctx);
    else this.drawTop(ctx);
    // kill feed under the wind readout, right side
    Fx.drawFeed(ctx, Gfx.pf.x + Gfx.pf.w - 6 * Gfx.dpr, this.bottomY + 4 * Gfx.dpr);
    this.drawBanner(ctx);
    if (this.touchOn()) this.drawTouch(ctx);
    else this.btns = [];
  },
  // where the top panels go: one row across the top of the playfield or, on tall screens
  // with room to spare above it (phones held upright), two bigger rows in that space
  layoutTop() {
    const d = Gfx.dpr, pf = Gfx.pf, gap = 6 * d;
    if (pf.y > 2 * 44 * d + 3 * gap) {
      const H = clamp((pf.y - 3 * gap) / 2, 40 * d, 60 * d);
      const x0 = 8 * d, W = Gfx.cw - 16 * d, y1 = pf.y - 2 * H - 2 * gap, y2 = y1 + H + gap;
      const half = (W - gap) / 2, pw = W * 0.58;
      return {
        H, below: pf.y + 6 * d,
        rects: { name: [x0, y1, half, H], weapon: [x0 + half + gap, y1, half, H], power: [x0, y2, pw - gap / 2, H], angle: [x0 + pw + gap / 2, y2, W - pw - gap / 2, H] }
      };
    }
    const H = clamp(pf.h * 0.062, 30 * d, 64 * d);
    const x0 = pf.x + 6 * d, W = pf.w - 12 * d, top = pf.y + 3 * d;
    const w1 = W * 0.27, w2 = W * 0.26, w3 = W * 0.17, w4 = W - w1 - w2 - w3 - 3 * gap;
    return {
      H, below: top + H + 5 * d,
      rects: { name: [x0, top, w1, H], power: [x0 + w1 + gap, top, w2, H], angle: [x0 + w1 + w2 + 2 * gap, top, w3, H], weapon: [x0 + w1 + w2 + w3 + 3 * gap, top, w4, H] }
    };
  },
  drawTop(ctx) {
    const t = Battle.hudTank(), L = this.layoutTop(), d = Gfx.dpr;
    let y = L.below;
    const wh = this.drawWind(ctx, y);
    y += wh + 5 * d;
    const wl = this.drawWallsTag(ctx, y);
    if (wl) y += wl + 5 * d;
    if (t && Cfg.statusBar) { this.drawStatus(ctx, t, y, L.H * 0.72); y += L.H * 0.72 + 5 * d; }
    this.bottomY = y;
    if (!t) return;
    const R = L.rects;
    this.drawName(ctx, t, R.name);
    this.drawPower(ctx, t, R.power);
    this.drawAngle(ctx, t, R.angle);
    this.drawWeapon(ctx, t, R.weapon);
  },
  drawName(ctx, t, [x, top, pw, H]) {
    const col = c3(t.color), big = H * 0.5;
    this.pill(ctx, x, top, pw, H, { accent: rgba(col, 1) });
    ctx.fillStyle = rgba(col, 1);
    ctx.beginPath(); ctx.arc(x + H * 0.36, top + H * 0.42, H * 0.15, 0, TAU); ctx.fill();
    const name = t.p.name.length > 14 ? t.p.name.slice(0, 13) + '…' : t.p.name;
    this.txt(ctx, name, x + H * 0.62, top + H * 0.4, big * 0.78, '#eef2f8', { weight: 700 });
    const e = clamp(t.energy / 100, 0, 1), bx = x + H * 0.62, bw = pw - H * 0.62 - H * 0.3, by = top + H * 0.72;
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(bx, by, bw, Math.max(2, H * 0.09));
    ctx.fillStyle = e > 0.6 ? '#6fe38a' : e > 0.3 ? '#ffd257' : '#ff5a5a'; ctx.fillRect(bx, by, bw * e, Math.max(2, H * 0.09));
    if (t.shield) {
      const sc = rgba(mix3(c3(t.shield.it.color), WHITE3, 0.35), 1), f = clamp(t.shield.energy / t.shield.it.strength, 0, 1);
      ctx.fillStyle = sc; ctx.fillRect(bx, by + H * 0.12, bw * f, Math.max(1, H * 0.05));
      this.txt(ctx, 'SHIELD ' + Math.round(f * 100) + '%', x + pw - H * 0.3, top + H * 0.4, big * 0.5, sc, { weight: 700, align: 'right' });
    }
    this.reg('name', x, top, pw, H);
  },
  drawPower(ctx, t, [x, top, pww, H]) {
    const col = c3(t.color), colCss = rgba(mix3(col, WHITE3, 0.2), 1), fs = H * 0.27, big = H * 0.5;
    this.pill(ctx, x, top, pww, H);
    this.txt(ctx, 'POWER', x + H * 0.3, top + H * 0.3, fs, '#8f9bb5', { weight: 700 });
    this.txt(ctx, String(Math.round(t.power)), x + pww - H * 0.3, top + H * 0.34, big, colCss, { align: 'right', display: true });
    const gx = x + H * 0.3, gw = pww - H * 0.6, gy = top + H * 0.68, gh = Math.max(3, H * 0.13);
    ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(gx, gy, gw, gh);
    const pg = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    pg.addColorStop(0, rgba(mix3(col, [0, 0, 0], 0.3), 1)); pg.addColorStop(1, rgba(mix3(col, WHITE3, 0.4), 1));
    ctx.fillStyle = pg; ctx.fillRect(gx, gy, gw * clamp(t.power / 1000, 0, 1), gh);
    ctx.fillStyle = '#ff5a5a'; ctx.fillRect(gx + gw * clamp(t.maxPower / 1000, 0, 1) - Gfx.dpr, gy - gh * 0.4, Math.max(2, 2 * Gfx.dpr), gh * 1.8);
    this.reg('power', x, top, pww, H);
  },
  drawAngle(ctx, t, [x, top, aw, H]) {
    const colCss = rgba(mix3(c3(t.color), WHITE3, 0.2), 1), fs = H * 0.27, big = H * 0.5;
    this.pill(ctx, x, top, aw, H);
    const disp = t.angle <= 90 ? t.angle : 180 - t.angle;
    this.txt(ctx, 'ANGLE', x + H * 0.3, top + H * 0.3, fs, '#8f9bb5', { weight: 700 });
    this.txt(ctx, Math.round(disp) + '°', x + H * 0.3, top + H * 0.68, big * 0.9, colCss, { display: true });
    const dcx = x + aw - H * 0.55, dcy = top + H * 0.72, dr = H * 0.38;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(1, Gfx.dpr);
    ctx.beginPath(); ctx.arc(dcx, dcy, dr, Math.PI, TAU); ctx.stroke();
    ctx.strokeStyle = colCss; ctx.lineWidth = Math.max(2, 2 * Gfx.dpr); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(dcx, dcy); ctx.lineTo(dcx + Math.cos(t.angle * DEG) * dr, dcy - Math.sin(t.angle * DEG) * dr); ctx.stroke();
    this.reg('angle', x, top, aw, H);
  },
  drawWeapon(ctx, t, [x, top, ww, H]) {
    const fs = H * 0.27, big = H * 0.5;
    const wp = Data.byId[t.p.weapon];
    const cnt = wp.id === 'babyMissile' ? '∞' : String(t.p.inv[wp.id] || 0);
    this.pill(ctx, x, top, ww, H);
    this.icon(ctx, wp.id, x + H * 0.25, top + H * 0.18, H * 0.64);
    const nx = x + H * 0.25 + 13 * Gfx.ux * (H * 0.064);
    // long names shrink to fit the card
    let size = big * 0.62;
    ctx.font = '700 ' + size.toFixed(1) + 'px ' + FONT_UI;
    const room = x + ww - H * 0.25 - nx, tw = ctx.measureText(wp.name).width;
    if (tw > room) size = Math.max(size * 0.55, size * room / tw);
    this.txt(ctx, wp.name, nx, top + H * 0.36, size, '#eef2f8', { weight: 700 });
    this.txt(ctx, '× ' + cnt, nx, top + H * 0.72, fs * 1.05, '#ffb640', { weight: 700 });
    this.txt(ctx, '◀ ▶', x + ww - H * 0.3, top + H * 0.72, fs * 0.9, 'rgba(160,175,205,0.7)', { align: 'right' });
    this.reg('weapon', x, top, ww, H);
  },
  drawStatus(ctx, t, y, h) {
    const p = t.p;
    let x = Gfx.pf.x + 6 * Gfx.dpr;
    const fs = h * 0.42;
    const item = (id, icon, count, on, extra) => {
      const label = String(count) + (extra ? '  ' + extra : '');
      ctx.font = '700 ' + fs.toFixed(1) + 'px ' + FONT_UI;
      const w = h * 1.5 + ctx.measureText(label).width + h * 0.3;
      this.pill(ctx, x, y, w, h, { fill: on ? 'rgba(40,52,80,0.8)' : 'rgba(9,12,21,0.65)', edge: on ? 'rgba(255,182,64,0.55)' : undefined });
      this.icon(ctx, icon, x + h * 0.2, y + h * 0.12, h * 0.76, !on);
      this.txt(ctx, label, x + h * 1.45, y + h * 0.52, fs, on ? '#eef2f8' : '#8f9bb5', { weight: 700 });
      this.reg(id, x, y, w, h);
      x += w + 4 * Gfx.dpr;
    };
    item('batt', 'battery', p.inv.battery || 0, (p.inv.battery || 0) > 0 && t.energy < 100);
    item('para', 'parachute', p.inv.parachute || 0, p.para.deployed && (p.inv.parachute || 0) > 0);
    const shId = t.selShield || (t.shield ? t.shield.it.id : null);
    const pct = t.shield ? Math.round(t.shield.energy / t.shield.it.strength * 100) + '%' : '0%';
    item('shld', shId || 'none', shId ? (p.inv[shId] || 0) : 0, !!t.shield, pct);
    item('guid', t.guidance || 'none', t.guidance ? (p.inv[t.guidance] || 0) : 0, !!t.guidance);
    item('trig', 'contactTrigger', p.inv.contactTrigger || 0, t.triggers);
    if (t.icon.mobile) item('fuel', 'fuelTank', Math.ceil((p.fuel || 0) / 10), (p.fuel || 0) > 0);
    // max power
    this.txt(ctx, 'MAX ' + t.maxPower, x + 4 * Gfx.dpr, y + h * 0.52, fs, '#8f9bb5', { weight: 700 });
  },
  drawWind(ctx, y) {
    const w = Battle.wind;
    const h = clamp(Gfx.pf.h * 0.03, 16 * Gfx.dpr, 30 * Gfx.dpr), fs = h * 0.56;
    const label = w === 0 ? 'CALM' : 'WIND ' + Math.abs(w);
    ctx.font = '700 ' + fs.toFixed(1) + 'px ' + FONT_UI;
    const tw = ctx.measureText(label).width, aw = w === 0 ? 0 : h * 1.6;
    const W = tw + aw + h * 0.9, x = Gfx.pf.x + Gfx.pf.w - 6 * Gfx.dpr - W;
    this.windH = h;
    this.pill(ctx, x, y, W, h);
    this.txt(ctx, label, x + h * 0.45, y + h * 0.53, fs, '#7fe0ff', { weight: 700 });
    if (w !== 0) {
      const ax = x + h * 0.45 + tw + h * 0.35, cy = y + h / 2, len = aw * 0.9, dir = w > 0 ? 1 : -1;
      const x0 = dir > 0 ? ax : ax + len, x1 = dir > 0 ? ax + len : ax;
      ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = Math.max(1.5, 1.5 * Gfx.dpr); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, cy); ctx.lineTo(x1 - dir * h * 0.28, cy - h * 0.22); ctx.moveTo(x1, cy); ctx.lineTo(x1 - dir * h * 0.28, cy + h * 0.22); ctx.stroke();
      // moving streak shows strength
      const k = (Gfx.t * (0.4 + Math.abs(w) / 120)) % 1;
      ctx.fillStyle = 'rgba(200,245,255,0.8)';
      ctx.fillRect(x0 + (x1 - x0) * k - Gfx.dpr, cy - h * 0.12, 2 * Gfx.dpr, h * 0.24);
    }
    return h;
  },
  // what the lines at the battlefield's edges mean
  drawWallsTag(ctx, y) {
    const w = Battle.walls;
    const info = { CONCRETE: ['WALLS: CONCRETE', '#c8c8d2'], PADDED: ['WALLS: PADDED', '#8ab8ff'], RUBBER: ['WALLS: RUBBER', '#6fe38a'],
      SPRING: ['WALLS: SPRING', '#ffd257'], WRAP: ['WALLS: WRAP \u21C4', '#c89bff'] }[w];
    if (!info) return 0;
    const h = clamp(Gfx.pf.h * 0.026, 14 * Gfx.dpr, 26 * Gfx.dpr), fs = h * 0.56;
    ctx.font = '700 ' + fs.toFixed(1) + 'px ' + FONT_UI;
    const W = ctx.measureText(info[0]).width + h * 0.9, x = Gfx.pf.x + Gfx.pf.w - 6 * Gfx.dpr - W;
    this.pill(ctx, x, y, W, h);
    this.txt(ctx, info[0], x + h * 0.45, y + h * 0.53, fs, info[1], { weight: 700 });
    return h;
  },
  drawSimul(ctx) {
    const B = Battle, n = B.tanks.length;
    const top = Gfx.pf.y + 3 * Gfx.dpr, W = Gfx.pf.w - 12 * Gfx.dpr, gap = 4 * Gfx.dpr;
    const cw = (W - gap * (n - 1)) / n, H = clamp(Gfx.pf.h * 0.055, 26 * Gfx.dpr, 56 * Gfx.dpr);
    B.tanks.forEach((t, i) => {
      const x = Gfx.pf.x + 6 * Gfx.dpr + i * (cw + gap);
      const col = c3(t.color);
      this.pill(ctx, x, top, cw, H, { accent: t.alive ? rgba(col, 1) : 'rgba(80,80,90,1)', fill: t.alive ? undefined : 'rgba(9,12,21,0.45)' });
      if (!t.alive) { this.txt(ctx, t.p.name.slice(0, 8), x + cw / 2, top + H / 2, H * 0.3, '#5d6477', { align: 'center' }); return; }
      this.icon(ctx, t.p.weapon, x + H * 0.15, top + H * 0.2, H * 0.55);
      this.txt(ctx, String(Math.round(t.power)), x + cw - H * 0.2, top + H * 0.38, H * 0.36, rgba(mix3(col, WHITE3, 0.25), 1), { align: 'right', display: true });
      const e = clamp(t.energy / 100, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + H * 0.15, top + H * 0.8, cw - H * 0.3, Math.max(2, H * 0.08));
      ctx.fillStyle = e > 0.6 ? '#6fe38a' : e > 0.3 ? '#ffd257' : '#ff5a5a'; ctx.fillRect(x + H * 0.15, top + H * 0.8, (cw - H * 0.3) * e, Math.max(2, H * 0.08));
    });
    const wh = this.drawWind(ctx, top + H + 5 * Gfx.dpr);
    this.bottomY = top + H + 10 * Gfx.dpr + wh;
  },
  drawBanner(ctx) {
    const B = Battle;
    let msg = null, col = '#ffffff', pulse = false;
    if (B.mode === 'SYNCHRONOUS' && B.state === 'syncaim') {
      const t = B.aimTank();
      if (t && !B.waitHost) { msg = t.p.name + ', aim your weapon'; col = rgba(mix3(c3(t.color), WHITE3, 0.3), 1); }
      else msg = 'Waiting for ' + B.syncWait.size + ' player' + (B.syncWait.size === 1 ? '' : 's') + ' to aim…';
    } else if (Net.online && B.mode === 'SEQUENTIAL' && B.cur && (B.state === 'human' || B.state === 'remote')) {
      if (!B.isLocal(B.cur) && !B.cur.p.ai) { msg = 'Waiting for ' + B.cur.p.name + '…'; col = rgba(mix3(c3(B.cur.color), WHITE3, 0.3), 1); }
      else if (B.isLocal(B.cur) && B.yourTurnT > 0) { msg = 'Your turn!'; col = rgba(mix3(c3(B.cur.color), WHITE3, 0.3), 1); pulse = true; }
    }
    if (!msg) return;
    const fs = worldFont(pulse ? 1.7 : 1.1);
    const y = Math.max(this.bottomY || 0, Gfx.pf.y) + fs * 1.6;
    ctx.globalAlpha = pulse ? 0.75 + 0.25 * Math.sin(Gfx.t * 10) : 1;
    ctx.font = (pulse ? '400 ' : '600 ') + fs.toFixed(1) + 'px ' + (pulse ? FONT_DISPLAY : FONT_UI);
    const w = ctx.measureText(msg).width + fs * 1.6;
    this.pill(ctx, Gfx.pf.x + (Gfx.pf.w - w) / 2, y - fs * 0.85, w, fs * 1.7);
    this.txt(ctx, msg, Gfx.pf.x + Gfx.pf.w / 2, y, fs, col, { align: 'center', weight: pulse ? 400 : 600, display: pulse });
    ctx.globalAlpha = 1;
  },

  /* ------------------------------------------------ aim guide */
  drawAimGuide(ctx) {
    const mode = Cfg.aimGuide;
    if (!mode || mode === 'OFF') return;
    const B = Battle;
    const list = [];
    if (B.mode === 'SIMULTANEOUS') { if (B.state === 'play') for (const t of B.tanks) if (t.alive && !t.dying && B.isLocal(t)) list.push(t); }
    else { const t = B.aimTank(); if (t && !B.waitHost) list.push(t); }
    for (const t of list) {
      const m = t.muzzle(0), v = Phys.launch(t.angle, Math.min(t.power, t.maxPower));
      const full = mode === 'FULL';
      const g = Phys.g(), wa = full ? Phys.windAcc(B.wind) : 0, drag = full ? Phys.drag() : 0;
      let x = m.x, y = m.y, vx = v.vx, vy = v.vy;
      const h = 1 / 120, maxT = full ? 12 : 0.5;
      const pts = [];
      let hit = null;
      for (let s = 0, time = 0; time < maxT; s++, time += h) {
        vx += (wa - drag * vx) * h; vy += (g - drag * vy) * h;
        x += vx * h; y += vy * h;
        if (full) {
          const o = { x, y, vx, vy };
          const r = applyWalls(o, B.walls);
          x = o.x; y = o.y; vx = o.vx; vy = o.vy;
          if (r !== 'ok' || y >= World.H) { hit = { x, y }; break; }
          if (y >= World.top && x >= 0 && x < World.W && World.isLand(x, y)) { hit = { x, y }; break; }
          let th = null;
          for (const tk of B.tanks) if (tk.alive && tk !== t && tk.contains(x, y)) th = tk;
          if (th) { hit = { x, y, tank: th }; break; }
        }
        if (s % 5 === 0) pts.push(x, y, time);
      }
      const col = rgba(mix3(c3(t.color), WHITE3, 0.45), 1);
      ctx.fillStyle = col;
      for (let i = 0; i < pts.length; i += 3) {
        const a = full ? 0.75 : 0.85 * (1 - pts[i + 2] / maxT);
        if (pts[i] < -World.W * 0.2 || pts[i] > World.W * 1.2) continue;
        ctx.globalAlpha = Math.max(0.08, a);
        ctx.beginPath(); ctx.arc(Gfx.X(pts[i]), Gfx.Y(pts[i + 1]), Math.max(1.2, Gfx.sx * 0.38), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (hit) {
        const X = Gfx.X(hit.x), Y = Gfx.Y(hit.y), r = 5 * Gfx.dpr + Math.sin(Gfx.t * 6) * Gfx.dpr;
        ctx.strokeStyle = hit.tank ? '#ff6060' : col; ctx.lineWidth = Math.max(1.5, 1.5 * Gfx.dpr);
        ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.moveTo(X - r * 1.6, Y); ctx.lineTo(X - r * 0.5, Y); ctx.moveTo(X + r * 0.5, Y); ctx.lineTo(X + r * 1.6, Y); ctx.stroke();
      }
      if (this.drag && this.drag.tank === t) {
        const p = t.pivot(0);
        ctx.setLineDash([4 * Gfx.dpr, 4 * Gfx.dpr]);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, Gfx.dpr);
        ctx.beginPath(); ctx.moveTo(Gfx.X(p.x), Gfx.Y(p.y)); ctx.lineTo(Gfx.X(Input.x), Gfx.Y(Input.y)); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  },

  /* ------------------------------------------------ touch controls */
  drawTouch(ctx) {
    const B = Battle;
    const mine = B.mode === 'SIMULTANEOUS' ? B.tanks.find(tk => tk.alive && !tk.dying && B.isLocal(tk) && B.state === 'play') : B.aimTank();
    this.btns = [];
    const aiming = mine && !B.waitHost;
    if (!aiming && !Net.online) return;
    const s = Math.round(clamp(Math.min(Gfx.cw, Gfx.ch) * 0.11, 44 * Gfx.dpr, 76 * Gfx.dpr));
    const gap = s * 0.18;
    const below = Gfx.ch - (Gfx.pf.y + Gfx.pf.h) > s * 2.4;
    const by = below ? Gfx.pf.y + Gfx.pf.h + (Gfx.ch - Gfx.pf.y - Gfx.pf.h - s * 2 - gap) / 2 : Gfx.ch - s * 2 - gap - 10 * Gfx.dpr;
    const lx = 10 * Gfx.dpr + (below ? 0 : 0), rx = Gfx.cw - 10 * Gfx.dpr;
    const add = (id, x, y, w, h, label, o) => {
      o = o || {};
      this.btns.push({ id, x, y, w, h, repeat: !!o.repeat });
      ctx.globalAlpha = 0.9;
      VUI.rr.call({ ctx }, x, y, w, h, Math.min(w, h) * 0.28);
      ctx.fillStyle = o.fill || 'rgba(12,16,28,0.72)'; ctx.fill();
      ctx.lineWidth = Math.max(1, Gfx.dpr); ctx.strokeStyle = o.edge || 'rgba(170,190,235,0.3)'; ctx.stroke();
      ctx.globalAlpha = 1;
      this.txt(ctx, label, x + w / 2, y + h / 2, (o.size || 0.38) * Math.min(w, h * 1.3), o.col || '#eef2f8', { align: 'center', weight: 700, display: !!o.display });
    };
    const fw = s * 1.9;
    if (Net.online) add('chat', rx - fw, by + s * 0.35 - s * 0.62 - gap, fw, s * 0.62, 'CHAT', { size: 0.34 });
    if (!aiming) return;
    // left cluster: angle and power
    add('angL', lx, by + s + gap, s, s, '⟲', { repeat: true, size: 0.5 });
    add('angR', lx + (s + gap) * 2, by + s + gap, s, s, '⟳', { repeat: true, size: 0.5 });
    add('powU', lx + s + gap, by, s, s, '▲', { repeat: true });
    add('powD', lx + s + gap, by + s + gap, s, s, '▼', { repeat: true });
    // right cluster: weapon, tank panel, fire
    add('fire', rx - fw, by + s * 0.35, fw, s * 1.65, 'FIRE', { fill: 'rgba(200,60,40,0.85)', edge: 'rgba(255,190,150,0.7)', size: 0.3, display: true });
    add('weapon', rx - fw - gap - s, by, s, s, '↻', { size: 0.5 });
    if (B.mode !== 'SIMULTANEOUS') add('tank', rx - fw - gap - s, by + s + gap, s, s, '⚙', { size: 0.5 });
  }
};
