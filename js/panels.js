'use strict';
/* =====================================================================
   In-game panels: Tank Control Panel, Inventory, Moving Control Panel,
   battery selection, Choose Target, tank info and status update.
   Actions go through Battle.request(), so they work the same offline,
   on the host, and on a networked client.
   ===================================================================== */

/* Remastered panel kit: drawing helpers in dialog-relative UI units (device pixels underneath),
   shared by the Tank Control and Inventory panels */
function modernKit(d) {
  const k = () => Math.min(Gfx.ux, Gfx.uy);
  const X = x => VUI.X(d.x + x), Y = y => VUI.Y(d.y + y);
  const txt = (s, x, y, o) => {
    o = o || {};
    const ctx = VUI.ctx;
    ctx.font = (o.weight || 600) + ' ' + VUI.fontPx(o.size || 1).toFixed(1) + 'px ' + (o.display ? FONT_DISPLAY : FONT_UI);
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = o.track ? (o.track * k()).toFixed(1) + 'px' : '0px';
    ctx.fillStyle = o.color || Theme.ink;
    ctx.fillText(s, X(x), Y(y));
    const tw = ctx.measureText(s).width / Gfx.ux;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
    return tw;
  };
  const box = (x, y, bw, bh, o) => {
    o = o || {};
    const ctx = VUI.ctx;
    VUI.rr(X(x), Y(y), bw * Gfx.ux, bh * Gfx.uy, (o.r || 3) * k());
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
    if (o.stroke) { ctx.lineWidth = (o.lw || 1) * VUI.hair(); ctx.strokeStyle = o.stroke; ctx.stroke(); }
  };
  const card = (x, y, cw, ch) => box(x, y, cw, ch, { fill: 'rgba(255,255,255,0.035)', stroke: 'rgba(150,176,230,0.13)', r: 4 });
  const heading = (s, x, y, dim) => txt(s, x, y, { size: 0.68, weight: 700, track: 1.1, color: dim ? 'rgba(123,132,153,0.55)' : Theme.muted });
  const keycap = (ch, x, y, dim) => {
    box(x, y - 4, 8, 8, { fill: 'rgba(6,9,15,0.7)', stroke: dim ? 'rgba(150,176,230,0.12)' : 'rgba(255,182,64,0.45)', r: 1.6 });
    txt(ch, x + 4, y + 0.2, { size: 0.62, weight: 700, align: 'center', color: dim ? 'rgba(123,132,153,0.6)' : Theme.accent });
  };
  const meter = (x, y, mw, mh, f, col) => {
    box(x, y, mw, mh, { fill: 'rgba(4,6,11,0.85)', stroke: 'rgba(150,176,230,0.12)', r: mh / 2 });
    if (f > 0) {
      const ctx = VUI.ctx, g = ctx.createLinearGradient(X(x), 0, X(x + mw), 0);
      g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
      box(x + 0.6, y + 0.6, Math.max(mh - 1.2, (mw - 1.2) * f), mh - 1.2, { fill: g, r: (mh - 1.2) / 2 });
    }
  };
  const toggle = (x, y, on, ok) => {
    box(x, y, 17, 9, { fill: on && ok ? Theme.accent : 'rgba(6,9,15,0.9)', stroke: on && ok ? 'rgba(255,220,150,0.8)' : 'rgba(150,176,230,0.3)', r: 4.5 });
    const ctx = VUI.ctx, cx = X(x + (on ? 12.5 : 4.5)), cy = Y(y + 4.5);
    ctx.beginPath(); ctx.ellipse(cx, cy, 3.3 * Gfx.ux, 3.3 * Gfx.uy, 0, 0, TAU);
    ctx.fillStyle = on && ok ? '#1a1206' : ok ? 'rgba(200,210,230,0.85)' : 'rgba(123,132,153,0.5)'; ctx.fill();
  };
  const icon = (id, x, y, size, gray) => { const s = size * k(); ItemArt.draw(VUI.ctx, id, X(x) + (size * Gfx.ux - s) / 2, Y(y) + (size * Gfx.uy - s) / 2, s, { gray }); };
  const hov = (x, y, bw, bh) => VUI.hover(d.x + x, d.y + y, bw, bh);
  const btn = (label, x, y, bw, bh, ok, hot) => {
    drawButton(VUI, d.x + x, d.y + y, bw, bh, '', { disabled: !ok, pressed: d.pressed && d.pressed.btnAt === x + ',' + y });
    const tw = VUI.measure(label, { size: 0.8 }) / Gfx.ux;
    txt(label, x + bw / 2 - (hot ? 5 : 0), y + bh / 2 + 0.2, { size: 0.8, weight: 700, align: 'center', color: ok ? Theme.ink : Theme.muted });
    if (hot) keycap(hot.toUpperCase(), x + bw / 2 + tw / 2 - 2, y + bh / 2, !ok);
  };
  const tap = (x, y, bw, bh, fn, extra) => d.add(Object.assign({ x, y, w: bw, h: bh, kind: 'tap', hot: null, click: fn }, extra || {}));
  return { txt, box, card, heading, keycap, meter, toggle, icon, hov, btn, tap, X, Y, k };
}

const Panels = {
  /* ------------------------------------------------ Tank Control Panel */
  tankControl(t, o) {
    o = o || {};
    if (!Gfx.modern) return this.tankControlClassic(t, o);
    const p = t.p, auto = !!o.autoDefense, idx = p.idx;
    const inv = id => p.inv[id] || 0;
    const w = 272, h = 196, pad = 9, iw = w - pad * 2;
    const d = new Dialog({ w, h, title: '', onClose: o.onClose });
    d.editThresh = false; d.threshStr = '';
    const simul = () => Battle.mode === 'SIMULTANEOUS';
    const gOK = () => !auto && !simul();
    const trOK = () => !auto && inv('contactTrigger') > 0 && !simul();
    const fOK = () => !auto && t.icon.mobile && (p.fuel || 0) > 0 && !simul();
    const battOK = () => inv('battery') > 0 && t.energy < 100;
    const startThresh = () => { if (inv('parachute') > 0) { d.editThresh = true; d.threshStr = ''; } else Sound.error(); };

    const { txt, box, card, heading, keycap, meter, toggle, icon, hov, btn, tap, X, Y, k } = modernKit(d);

    // ---- header: the tank, its name, what this panel is
    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw() {
      const ctx = VUI.ctx, base = Fx.palette({ color: t.color, hitFlash: 0, flash: 0, fx: null }).base;
      // a wash of the tank's colour behind the header
      const g = ctx.createLinearGradient(X(0), 0, X(w * 0.75), 0);
      g.addColorStop(0, rgba(base, 0.22)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); VUI.rr(X(0), Y(0), w * Gfx.ux, 26 * Gfx.uy, 4 * k()); ctx.clip();
      ctx.fillStyle = g; ctx.fillRect(X(0), Y(0), w * Gfx.ux, 26 * Gfx.uy); ctx.restore();
      VUI.tank(t.iconIdx, t.color, d.x + pad, d.y + 7, 18, 13);
      txt(p.name, pad + 24, 10.5, { size: 1.25, display: true, weight: 400 });
      txt(auto ? 'AUTOMATIC DEFENSE SYSTEM' : 'TANK CONTROL', pad + 24, 20, { size: 0.62, weight: 700, track: 1.2, color: Theme.muted });
      // round status on the right
      const r = Battle.mode === 'SIMULTANEOUS' ? 'SIMULTANEOUS' : 'ROUND ' + Game.round + ' / ' + Game.rounds;
      txt(r, w - pad, 10.5, { size: 0.62, weight: 700, track: 1, align: 'right', color: Theme.muted });
      box(pad, 26, iw, 0.01, { stroke: 'rgba(150,176,230,0.12)' });
    } });

    // ---- power and batteries
    const cy0 = 31, cw = (iw - 6) / 2, chh = 46;
    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw() {
      const x = pad, y = cy0, e = clamp(t.energy / 100, 0, 1);
      card(x, y, cw, chh);
      const hw = heading('POWER', x + 6, y + 7);
      txt('max ' + t.maxPower, x + 6 + hw + 4, y + 7, { size: 0.66, color: 'rgba(123,132,153,0.85)' });
      txt(Math.round(t.energy) + '%', x + cw - 6, y + 8.5, { size: 1.15, display: true, weight: 400, align: 'right',
        color: e > 0.6 ? '#6fe38a' : e > 0.3 ? '#ffd257' : '#ff6060' });
      meter(x + 6, y + 16, cw - 12, 5, e, e > 0.6 ? ['#2f9e55', '#6fe38a'] : e > 0.3 ? ['#b07a10', '#ffd257'] : ['#a12828', '#ff6060']);
      icon('battery', x + 5, y + 26, 14, inv('battery') <= 0);
      txt('× ' + inv('battery'), x + 20, y + 33, { size: 0.9, weight: 700, color: inv('battery') > 0 ? Theme.ink : Theme.muted });
      btn('Recharge', x + cw - 55, y + 27, 49, 13, battOK(), 'b');
    } });
    tap(pad + cw - 55, cy0 + 27, 49, 13, () => Battle.tankAction(t, 'batt'), { btnAt: (pad + cw - 55) + ',' + (cy0 + 27), pressable: true });

    // ---- parachutes
    const px0 = pad + cw + 6;
    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw() {
      const x = px0, y = cy0, n = inv('parachute'), ok = n > 0;
      card(x, y, cw, chh);
      keycap('P', x + 6 + heading('PARACHUTES', x + 6, y + 7, !ok) + 4, y + 7, !ok);
      icon('parachute', x + 5, y + 12, 15, !ok);
      txt('× ' + n, x + 21, y + 19.5, { size: 0.9, weight: 700, color: ok ? Theme.ink : Theme.muted });
      txt(ok && p.para.deployed ? 'ARMED' : 'OFF', x + cw - 25, y + 19.5, { size: 0.62, weight: 700, track: 0.8, align: 'right', color: ok && p.para.deployed ? Theme.accent : Theme.muted });
      toggle(x + cw - 23, y + 15, p.para.deployed, ok);
      // threshold: opens when a fall would do more damage than this
      txt('Opens if fall dmg >', x + 6, y + 36.5, { size: 0.72, color: ok ? 'rgba(230,234,242,0.75)' : Theme.muted });
      const sx = x + cw - 47 + 4;
      for (const [bx, s] of [[sx, '−'], [sx + 30, '+']]) {
        box(bx, y + 31, 11, 11, { fill: hov(bx, y + 31, 11, 11) && ok ? 'rgba(58,74,108,1)' : 'rgba(30,38,58,0.9)', stroke: 'rgba(150,176,230,0.22)', r: 2.5 });
        txt(s, bx + 5.5, y + 36.7, { size: 0.95, weight: 700, align: 'center', color: ok ? Theme.ink : Theme.muted });
      }
      box(sx + 12.5, y + 31, 16, 11, { fill: 'rgba(4,6,11,0.85)', stroke: d.editThresh ? Theme.edgeHi : 'rgba(150,176,230,0.14)', r: 2.5 });
      const v = d.editThresh ? d.threshStr + ((Math.floor(performance.now() / 450) & 1) ? '_' : ' ') : String(p.para.threshold);
      txt(v, sx + 20.5, y + 36.7, { size: 0.82, weight: 700, align: 'center', color: d.editThresh ? Theme.accent : ok ? Theme.ink : Theme.muted });
    } });
    tap(px0, cy0 + 11, cw, 16, () => Battle.tankAction(t, 'para'));
    const thStep = dv => () => { if (inv('parachute') <= 0) { Sound.error(); return; } Battle.request({ c: 'thresh', tank: idx, v: clamp(p.para.threshold + dv, 1, 100) }); Sound.click(); };
    tap(px0 + cw - 43, cy0 + 31, 11, 11, thStep(-1), { pressable: true, repeat: true });
    tap(px0 + cw - 13, cy0 + 31, 11, 11, thStep(1), { pressable: true, repeat: true });
    tap(px0 + cw - 30.5, cy0 + 31, 16, 11, startThresh);

    // ---- shields
    const sy0 = cy0 + chh + 5, sh = 52;
    const sIds = [null].concat(Data.shields.map(x => x.id));
    const tileW = (iw - 12 - (sIds.length - 1) * 3) / sIds.length;
    const short = { magDeflector: 'Mag', shield: 'Shield', forceShield: 'Force', heavyShield: 'Heavy', superMag: 'Super' };
    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw() {
      const x = pad, y = sy0;
      card(x, y, iw, sh);
      let hx = x + 6 + heading('SHIELD', x + 6, y + 7) + 5;
      keycap('S', hx, y + 7); hx += 10 + txt('pick', hx + 10, y + 7, { size: 0.6, color: Theme.muted }) + 6;
      keycap('E', hx, y + 7); txt('engage', hx + 10, y + 7, { size: 0.6, color: Theme.muted });
      // energy of the shield that's up
      const mx = x + iw - 96, mw = 62;
      if (t.shield) {
        const f = clamp(t.shield.energy / t.shield.it.strength, 0, 1), c = t.shield.it.color;
        const cs = 'rgb(' + cR(c) + ',' + cG(c) + ',' + cB(c) + ')';
        meter(mx, y + 4.5, mw, 5, f, ['rgba(' + cR(c) + ',' + cG(c) + ',' + cB(c) + ',0.55)', cs]);
        txt(Math.round(f * 100) + '%', x + iw - 6, y + 7, { size: 0.82, weight: 700, align: 'right', color: cs });
      } else txt('no shield up', x + iw - 6, y + 7, { size: 0.68, align: 'right', color: Theme.muted });
      sIds.forEach((id, i) => {
        const tx = x + 6 + i * (tileW + 3), ty = y + 14, th = 33;
        const n = id ? inv(id) : 0, active = !!(t.shield && id && t.shield.it.id === id);
        const queued = !t.shield && (t.selShield || null) === id;
        const has = !id || n > 0 || active;
        const c = id ? Data.byId[id].color : 0, rgb3 = id ? cR(c) + ',' + cG(c) + ',' + cB(c) : '150,176,230';
        const ctx = VUI.ctx;
        if (active) {
          ctx.save(); ctx.shadowColor = 'rgba(' + rgb3 + ',0.65)'; ctx.shadowBlur = 10 * Gfx.dpr;
          box(tx, ty, tileW, th, { fill: 'rgba(' + rgb3 + ',0.16)', stroke: 'rgba(' + rgb3 + ',0.95)', lw: 1.5, r: 3 });
          ctx.restore();
        } else box(tx, ty, tileW, th, {
          fill: queued ? 'rgba(255,182,64,0.12)' : hov(tx, ty, tileW, th) && has ? 'rgba(150,176,230,0.12)' : 'rgba(255,255,255,0.03)',
          stroke: queued ? 'rgba(255,182,64,0.7)' : 'rgba(150,176,230,0.12)', r: 3 });
        if (id) icon(id, tx + tileW / 2 - 7.5, ty + 2.5, 15, !has);
        else {
          // "none": an empty ring with a slash
          const cx = X(tx + tileW / 2), cyy = Y(ty + 10), r = 5 * k();
          ctx.lineWidth = 1.4 * Gfx.dpr; ctx.strokeStyle = queued || (!t.shield && !t.selShield) ? 'rgba(230,234,242,0.8)' : 'rgba(123,132,153,0.7)';
          ctx.beginPath(); ctx.arc(cx, cyy, r, 0, TAU); ctx.moveTo(cx - r * 0.7, cyy + r * 0.7); ctx.lineTo(cx + r * 0.7, cyy - r * 0.7); ctx.stroke();
        }
        txt(id ? short[id] || Data.byId[id].code : 'None', tx + tileW / 2, ty + 22, { size: 0.66, weight: 700, align: 'center', color: active ? 'rgb(' + rgb3 + ')' : has ? 'rgba(230,234,242,0.85)' : Theme.muted });
        if (id) {
          if (active) meter(tx + 4, ty + th - 5, tileW - 8, 2.6, clamp(t.shield.energy / t.shield.it.strength, 0, 1), ['rgba(' + rgb3 + ',0.6)', 'rgb(' + rgb3 + ')']);
          else txt('×' + n, tx + tileW / 2, ty + th - 4.2, { size: 0.6, weight: 700, align: 'center', color: n > 0 ? Theme.muted : 'rgba(123,132,153,0.45)' });
        }
      });
    } });
    sIds.forEach((id, i) => tap(pad + 6 + i * (tileW + 3), sy0 + 14, tileW, 33, () => {
      if (!id) { Battle.request({ c: 'selshield', tank: idx, id: null }); return; }
      const active = t.shield && t.shield.it.id === id;
      if (inv(id) > 0 || active) Battle.request({ c: 'shield', tank: idx, id }); else Sound.error();
    }));

    // ---- guidance
    const gy0 = sy0 + sh + 5, gh = 34;
    const gIds = [null].concat(Data.guidances.map(x => x.id));
    const gShort = { heatGuidance: 'Heat', ballisticGuidance: 'Ballistic', horzGuidance: 'Horiz', vertGuidance: 'Vert', lazyBoy: 'Lazy Boy' };
    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw() {
      const x = pad, y = gy0, ok = gOK();
      card(x, y, iw, gh);
      const hx = x + 6 + heading('GUIDANCE', x + 6, y + 7, !ok) + 5;
      keycap('G', hx, y + 7, !ok); txt('next', hx + 10, y + 7, { size: 0.6, color: Theme.muted });
      if (!ok) txt(auto ? 'set it when you fire' : 'not in simultaneous play', x + iw - 6, y + 7, { size: 0.66, align: 'right', color: Theme.muted });
      gIds.forEach((id, i) => {
        const tx = x + 6 + i * (tileW + 3), ty = y + 13, th = 17;
        const n = id ? inv(id) : 0, sel = (t.guidance || null) === id, has = ok && (!id || n > 0);
        box(tx, ty, tileW, th, {
          fill: sel && ok ? 'rgba(106,194,255,0.16)' : hov(tx, ty, tileW, th) && has ? 'rgba(150,176,230,0.12)' : 'rgba(255,255,255,0.03)',
          stroke: sel && ok ? 'rgba(106,194,255,0.85)' : 'rgba(150,176,230,0.12)', lw: sel && ok ? 1.4 : 1, r: 3 });
        if (id) {
          icon(id, tx + 1.5, ty + 1.5, 14, !has);
          txt(String(n), tx + tileW - 4, ty + 6, { size: 0.66, weight: 700, align: 'right', color: n > 0 && ok ? Theme.ink : Theme.muted });
          txt(gShort[id] || Data.byId[id].code, tx + tileW - 4, ty + 12.6, { size: 0.5, weight: 600, align: 'right', color: Theme.muted });
        } else txt('Off', tx + tileW / 2, ty + th / 2 + 0.3, { size: 0.75, weight: 700, align: 'center', color: sel && ok ? Theme.info : Theme.muted });
      });
    } });
    gIds.forEach((id, i) => tap(pad + 6 + i * (tileW + 3), gy0 + 13, tileW, 17, () => {
      if (gOK() && (!id || inv(id) > 0)) Battle.request({ c: 'guid', tank: idx, id }); else Sound.error();
    }));

    // ---- footer: contact triggers, fuel, done
    const fy = gy0 + gh + 5, fh = 17;
    const fw1 = 92, fw2 = 92;
    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw() {
      let x = pad;
      const ok = trOK();
      card(x, fy, fw1, fh);
      icon('contactTrigger', x + 2, fy + 1.5, 14, inv('contactTrigger') <= 0);
      txt('Triggers', x + 17, fy + 6, { size: 0.68, weight: 700, color: ok ? Theme.ink : Theme.muted });
      txt('×' + inv('contactTrigger'), x + 17, fy + 12.4, { size: 0.58, color: Theme.muted });
      keycap('T', x + 52, fy + 8.5, !ok);
      toggle(x + fw1 - 21, fy + 4, t.triggers, ok);
      x += fw1 + 5;
      const fok = fOK();
      card(x, fy, fw2, fh);
      icon('fuelTank', x + 2, fy + 1.5, 14, !fok);
      txt('Fuel', x + 17, fy + 6, { size: 0.68, weight: 700, color: fok ? Theme.ink : Theme.muted });
      txt(t.icon.mobile ? String(p.fuel || 0) : 'fixed tank', x + 17, fy + 12.4, { size: 0.58, color: Theme.muted });
      btn('Move', x + fw2 - 39, fy + 2.5, 36, 12, fok, 'f');
      btn('Done', w - pad - 52, fy + 1, 52, fh - 2, true);
    } });
    tap(pad, fy, fw1, fh, () => { if (trOK()) Battle.tankAction(t, 'trig'); else Sound.error(); });
    tap(pad + fw1 + 5 + fw2 - 39, fy + 2.5, 36, 12, () => { if (fOK()) { UI.remove(d); Panels.move(t); } else Sound.error(); },
      { btnAt: (pad + fw1 + 5 + fw2 - 39) + ',' + (fy + 2.5), pressable: true });
    tap(w - pad - 52, fy + 1, 52, fh - 2, () => { Sound.click(); d.close(); }, { btnAt: (w - pad - 52) + ',' + (fy + 1), pressable: true });

    d.onEnter = () => { if (!d.editThresh) d.close(); };
    d.onKey = ev => {
      if (d.editThresh) {
        if (ev.k === 'enter' || ev.k === 'escape') {
          if (ev.k === 'enter' && d.threshStr) Battle.request({ c: 'thresh', tank: idx, v: clamp(parseInt(d.threshStr, 10) || 1, 1, 100) });
          d.editThresh = false; return true;
        }
        if (ev.k === 'backspace') d.threshStr = d.threshStr.slice(0, -1);
        else if (/^[0-9]$/.test(ev.k) && d.threshStr.length < 3) d.threshStr += ev.k;
        return true;
      }
      switch (ev.k) {
        case 'b': Battle.tankAction(t, 'batt'); return true;
        case 'p': Battle.tankAction(t, 'para'); return true;
        case 'e': Battle.tankAction(t, 'shield'); return true;
        case 's': Battle.tankAction(t, 'selshield'); return true;
        case 't': if (trOK()) Battle.tankAction(t, 'trig'); else Sound.error(); return true;
        case 'g': if (gOK()) Battle.tankAction(t, 'guid'); else Sound.error(); return true;
        case 'f': if (fOK()) { UI.remove(d); Panels.move(t); } else Sound.error(); return true;
        case 'v': startThresh(); return true;
        case 'd': d.close(); return true;
      }
      return false;
    };
    UI.push(d);
    return d;
  },

  // classic look: laid out like 1.5's panel (top left, sliders under icon rows, no Done button:
  // Enter, Escape or a click outside closes it)
  tankControlClassic(t, o) {
    const p = t.p, auto = !!o.autoDefense, idx = p.idx, inv = id => p.inv[id] || 0;
    const w = 216, h = 112, gray = vga(30, 30, 30), green = vga(16, 50, 16);
    const d = new Dialog({ w, h, title: '', onClose: o.onClose, closeOnOutside: true });
    d.x = 14; d.y = Battle.statusH + 4;
    d.editThresh = false; d.threshStr = '';
    // header: the name between two bars of the player's color
    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw(s) {
      const nm = p.name.replace(/&/g, '&&'), tw = Font.width(nm) + 8, X = d.x, Y = d.y + 3;
      const bw = Math.floor((w - tw) / 2) - 7;
      s.fillRect(X + 5, Y, bw, 8, t.color); s.rect(X + 5, Y, bw, 8, UIC.lo);
      s.fillRect(X + w - 5 - bw, Y, bw, 8, t.color); s.rect(X + w - 5 - bw, Y, bw, 8, UIC.lo);
      Font.center(s, nm, X + w / 2, Y, UIC.text);
    } });
    const label = (lbl, x, y, fn, ok) => d.add({ label: lbl, x, y, w: Font.width(lbl) + 2, h: 10, kind: 'label2',
      draw(s) { Font.draw(s, lbl, d.x + x, d.y + y, ok() ? UIC.text : gray, { hotColor: ok() ? UIC.hot : gray }); },
      click() { if (ok()) fn(); else Sound.error(); } });
    // title line: what this panel is for
    if (auto) d.text('Automatic Defense System', Math.floor((w - Font.width('Automatic Defense System')) / 2), 13);
    else {
      d.text(() => 'Power: ' + Math.round(t.energy) + '%', 8, 13);
      label('&Batteries: ', 96, 13, () => Battle.tankAction(t, 'batt'), () => inv('battery') > 0 && t.energy < 100);
      d.text(() => String(inv('battery')), 96 + Font.width('Batteries: '), 13);
    }
    // parachutes, with the threshold box
    const startThresh = () => { if (inv('parachute') > 0) { d.editThresh = true; d.threshStr = ''; } else Sound.error(); };
    d.add({ x: 8, y: 24, w: 150, h: 10, kind: 'label2', draw(s) {
      const ok = inv('parachute') > 0;
      Font.draw(s, '&Parachutes: ' + inv('parachute') + (ok ? (p.para.deployed ? ' (deployed)' : ' (packed)') : ''), d.x + this.x, d.y + this.y, ok ? UIC.text : gray, { hotColor: ok ? UIC.hot : gray });
    }, click() { Battle.tankAction(t, 'para'); } });
    d.add({ x: w - 40, y: 23, w: 32, h: 11, kind: 'thr', draw(s) {
      const X = d.x + this.x, Y = d.y + this.y;
      Icons.draw(s, 'parachute', X - 14, Y - 1);
      bevel(s, X, Y, 30, 11, false, UIC.field);
      Font.draw(s, d.editThresh ? d.threshStr + '_' : String(p.para.threshold), X + 3, Y + 1, UIC.black);
    }, click: startThresh });
    // shield energy
    label('&Energy Left', 8, 35, () => Battle.tankAction(t, 'shield'), () => !!t.shield);
    d.add({ x: 96, y: 35, w: w - 104, h: 9, kind: 'bar', draw(s) {
      const X = d.x + this.x, Y = d.y + this.y;
      bevel(s, X, Y, this.w, this.h, false, UIC.face);
      if (t.shield) s.fillRect(X + 1, Y + 1, Math.round((this.w - 2) * clamp(t.shield.energy / t.shield.it.strength, 0, 1)), this.h - 2, t.shield.it.color);
    }, click() { Battle.tankAction(t, 'shield'); } });
    // a row of choices with icons over a slider (shields, guidance)
    const row = (y, ids, isOn, has, pick) => {
      const cw = Math.floor((w - 16) / ids.length);
      ids.forEach((id, i) => d.add({ x: 8 + i * cw, y, w: cw, h: 10, kind: 'slot', draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, on = isOn(id), ok = has(id);
        if (!id) { Font.draw(s, 'None', X, Y, on ? green : ok ? UIC.text : gray); return; }
        Font.right(s, String(inv(id)), X + 12, Y, on ? green : ok ? UIC.text : gray);
        Icons.draw(s, id, X + 14, Y - 1, { gray: !ok });
      }, click() { if (has(id)) pick(id); else Sound.error(); } }));
      d.add({ x: 8, y: y + 11, w: w - 16, h: 6, kind: 'slider', draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, k = Math.max(0, ids.findIndex(isOn));
        s.hline(X, X + this.w - 1, Y + 2, UIC.lo); s.hline(X, X + this.w - 1, Y + 3, UIC.hi);
        bevel(s, X + k * cw + 2, Y, 5, 6, true, UIC.face);
      } });
    };
    const sIds = [null].concat(Data.shields.map(x => x.id));
    row(46, sIds, id => id ? !!(t.shield && t.shield.it.id === id) || (!t.shield && t.selShield === id) : !t.shield && !t.selShield,
      id => !id || inv(id) > 0 || !!(t.shield && t.shield.it.id === id),
      id => { if (!id) Battle.request({ c: 'selshield', tank: idx, id: null }); else Battle.request({ c: 'shield', tank: idx, id }); });
    d.add({ x: 4, y: 65, w: w - 8, h: 1, kind: 'label', draw(s) { s.hline(d.x + this.x, d.x + this.x + this.w - 1, d.y + this.y, scalec(t.color, 0.8)); } });
    // guidance and triggers
    const gOK = () => !auto && Battle.mode !== 'SIMULTANEOUS';
    const trOK = () => !auto && inv('contactTrigger') > 0 && Battle.mode !== 'SIMULTANEOUS';
    label('&Guidance', 8, 68, () => Battle.tankAction(t, 'guid'), gOK);
    d.add({ x: w - 90, y: 68, w: 84, h: 10, kind: 'chk', draw(s) {
      const lbl = '&Triggers: ' + inv('contactTrigger');
      Font.draw(s, lbl, d.x + this.x, d.y + this.y, trOK() ? UIC.text : gray, { hotColor: trOK() ? UIC.hot : gray });
      drawCheck(s, d.x + this.x + Font.width(lbl) + 4, d.y + this.y, t.triggers, !trOK());
    }, hot: 't', click() { if (trOK()) Battle.tankAction(t, 'trig'); else Sound.error(); } });
    const gIds = [null].concat(Data.guidances.map(x => x.id));
    row(79, gIds, id => (t.guidance || null) === id, id => gOK() && (!id || inv(id) > 0), id => Battle.request({ c: 'guid', tank: idx, id }));
    // fuel
    const fOK = () => !auto && t.icon.mobile && (p.fuel || 0) > 0 && Battle.mode !== 'SIMULTANEOUS';
    label('&Fuel Remaining:', 8, 99, () => { UI.remove(d); Panels.move(t); }, fOK);
    d.text(() => t.icon.mobile ? String(p.fuel || 0) : 'n/a (fixed)', 120, 99, gray);
    d.onEnter = () => { if (!d.editThresh) d.close(); };
    d.onKey = ev => {
      if (d.editThresh) {
        if (ev.k === 'enter' || ev.k === 'escape') {
          if (ev.k === 'enter' && d.threshStr) Battle.request({ c: 'thresh', tank: idx, v: clamp(parseInt(d.threshStr, 10) || 1, 1, 100) });
          d.editThresh = false; return true;
        }
        if (ev.k === 'backspace') d.threshStr = d.threshStr.slice(0, -1);
        else if (/^[0-9]$/.test(ev.k) && d.threshStr.length < 3) d.threshStr += ev.k;
        return true;
      }
      switch (ev.k) {
        case 'b': Battle.tankAction(t, 'batt'); return true;
        case 'p': Battle.tankAction(t, 'para'); return true;
        case 'e': Battle.tankAction(t, 'shield'); return true;
        case 's': Battle.tankAction(t, 'selshield'); return true;
        case 't': if (trOK()) Battle.tankAction(t, 'trig'); else Sound.error(); return true;
        case 'g': if (gOK()) Battle.tankAction(t, 'guid'); else Sound.error(); return true;
        case 'f': if (fOK()) { UI.remove(d); Panels.move(t); } else Sound.error(); return true;
        case 'v': startThresh(); return true;
      }
      return false;
    };
    UI.push(d);
    return d;
  },

  /* ------------------------------------------------ Inventory Panel */
  inventory(t, o) {
    o = o || {};
    const p = o.player || t.p;
    const owned = Data.items.filter(it => it.id === 'babyMissile' || (p.inv[it.id] || 0) > 0 || (it.id === 'fuelTank' && (p.fuel || 0) > 0) || (it.id === 'autoDefense' && p.autoDefense));
    if (Gfx.modern) return this.inventoryModern(t, o, p, owned);
    // classic look: 1.5's grid - five columns of "count icon" cells between red lines
    const classic = !Gfx.modern;
    const cols = classic ? 5 : 7, cw = classic ? 32 : 36, ch = classic ? 12 : 24;
    const rows = Math.max(1, Math.ceil(owned.length / cols));
    const w = cols * cw + 16, h = rows * ch + (classic ? 22 : 34);
    const d = new Dialog({ w, h, title: o.title || 'Inventory', onClose: o.onClose });
    d.flash = null;
    const count = it => it.id === 'babyMissile' ? 99 : it.id === 'fuelTank' ? Math.ceil((p.fuel || 0) / 10) : it.id === 'autoDefense' ? 1 : (p.inv[it.id] || 0);
    if (classic) d.add({ x: 8, y: 14, w: cols * cw, h: rows * ch, kind: 'label', draw(s) {
      const X = d.x + this.x, Y = d.y + this.y, red = vga(50, 6, 6);
      for (let c = 1; c < cols; c++) s.vline(X + c * cw - 1, Y, Y + rows * ch - 1, red);
      for (let r = 1; r < rows; r++) s.hline(X, X + cols * cw - 1, Y + r * ch - 1, red);
    } });
    owned.forEach((it, i) => {
      const cx = 8 + (i % cols) * cw, cy = (classic ? 14 : 16) + Math.floor(i / cols) * ch;
      d.add({ x: cx, y: cy, w: cw - 2, h: ch - 2, kind: 'cell', item: it, draw(s) {
        const X = d.x + this.x, Y = d.y + this.y;
        const fl = d.flash && d.flash.id === it.id && (Math.floor(d.flash.t * 16) & 1);
        if (classic) {
          const hov = Input.ux >= X && Input.ux < X + this.w && Input.uy >= Y && Input.uy < Y + this.h;
          if (fl) s.fillRect(X, Y, this.w, this.h, UIC.white);
          if (hov || (i === 0 && !d.touched)) s.rect(X, Y, this.w, this.h, UIC.lo);
          Font.right(s, String(count(it)), X + 13, Y + 1, UIC.text);
          Icons.draw(s, it.id, X + 15, Y);
          return;
        }
        bevel(s, X, Y, this.w, this.h, true, fl ? UIC.white : UIC.light);
        Icons.draw(s, it.id, X + (this.w - 12) / 2, Y + 2);
        Font.center(s, String(count(it)), X + this.w / 2, Y + 13, UIC.text);
      }, click() {
        d.touched = true;
        if (o.onPick) { o.onPick(it); return; }
        const ok = Panels.obvious(t, it, d);
        if (ok) d.flash = { id: it.id, t: 0.4 }; else Sound.error();
      } });
    });
    d.tick = dt => { if (d.flash && (d.flash.t -= dt) <= 0) d.flash = null; };
    UI.push(d);
    return d;
  },
  // Remastered inventory: the kit grouped by what it does, each item a tile; the bar at the
  // bottom tells what the item under the pointer is and what a click will do
  inventoryModern(t, o, p, owned) {
    const selling = !!o.onPick;
    const groups = [
      { name: 'WEAPONS', test: it => it.cat === 'W' },
      { name: 'DEFENSE', test: it => it.kind === 'shield' || it.kind === 'autodefense' },
      { name: 'GUIDANCE', test: it => it.kind === 'guidance' },
      { name: 'GEAR', test: it => it.cat !== 'W' && it.kind !== 'shield' && it.kind !== 'autodefense' && it.kind !== 'guidance' }
    ].map(g => ({ name: g.name, items: owned.filter(g.test) })).filter(g => g.items.length);
    const w = 300, pad = 9, iw = w - pad * 2, gap = 3, cols = 8;
    const tw = (iw - (cols - 1) * gap) / cols;
    const rowsOf = g => Math.ceil(g.items.length / cols);
    const nRows = groups.reduce((n, g) => n + rowsOf(g), 0);
    const head = 30, gHead = 11, foot = 27;
    // tiles shrink when the kit is big, so the panel always fits the screen
    const maxH = Screen.UH - 8;
    let th = 28;
    const fixed = head + groups.length * (gHead + 4) + foot + 4;
    while (th > 18 && fixed + nRows * (th + gap) > maxH) th--;
    const h = Math.round(fixed + nRows * (th + gap));
    const d = new Dialog({ w, h, title: '', onClose: o.onClose });
    d.flash = null; d.hover = null;
    const { txt, box, card, heading, icon, hov, btn, tap, X, Y } = modernKit(d);

    const count = it => it.id === 'babyMissile' ? '∞' : it.id === 'fuelTank' ? String(p.fuel || 0) : it.id === 'autoDefense' ? 'ON' : String(p.inv[it.id] || 0);
    // what's "on" right now, and what a click does
    const state = it => {
      if (!t || selling) return null;
      if (it.cat === 'W') return p.weapon === it.id ? 'accent' : null;
      if (it.kind === 'shield') return t.shield && t.shield.it.id === it.id ? 'shield' : null;
      if (it.kind === 'guidance') return t.guidance === it.id ? 'info' : null;
      if (it.kind === 'parachute') return p.para.deployed ? 'accent' : null;
      if (it.kind === 'trigger') return t.triggers ? 'accent' : null;
      if (it.kind === 'autodefense') return 'accent';
      return null;
    };
    const action = it => {
      if (selling) return it.id === 'babyMissile' || it.id === 'autoDefense' ? "Can't be sold" : 'Click to sell';
      if (!t) return '';
      const simul = Battle.mode === 'SIMULTANEOUS';
      switch (it.kind) {
        case 'shield': return t.shield && t.shield.it.id === it.id ? 'Up now · click to recharge' : 'Click to raise';
        case 'guidance': return simul ? 'Not in simultaneous play' : t.guidance === it.id ? 'Armed for your next shot' : 'Click to use on your next shot';
        case 'parachute': return p.para.deployed ? 'Armed · click to disarm' : 'Click to arm';
        case 'trigger': return t.triggers ? 'On · click to turn off' : 'Click to turn on';
        case 'battery': return t.energy >= 100 ? 'Power is full' : 'Click to recharge 10%';
        case 'fuel': return t.icon.mobile ? 'Click to drive' : 'This tank can’t move';
        case 'autodefense': return 'Works by itself each round';
        default: return it.cat === 'W' ? (p.weapon === it.id ? 'Loaded' : 'Click to load') : '';
      }
    };
    const tiles = [];
    let y = head;
    for (const g of groups) {
      g.y = y;
      y += gHead;
      g.items.forEach((it, i) => tiles.push({ it, x: pad + (i % cols) * (tw + gap), y: y + Math.floor(i / cols) * (th + gap) }));
      y += rowsOf(g) * (th + gap) + 4;
    }

    d.add({ x: 0, y: 0, w: 0, h: 0, kind: 'label', draw() {
      const ctx = VUI.ctx;
      // header
      if (t) {
        const base = Fx.palette({ color: t.color, hitFlash: 0, flash: 0, fx: null }).base;
        const g = ctx.createLinearGradient(X(0), 0, X(w * 0.75), 0);
        g.addColorStop(0, rgba(base, 0.22)); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save(); VUI.rr(X(0), Y(0), w * Gfx.ux, 26 * Gfx.uy, 4 * Math.min(Gfx.ux, Gfx.uy)); ctx.clip();
        ctx.fillStyle = g; ctx.fillRect(X(0), Y(0), w * Gfx.ux, 26 * Gfx.uy); ctx.restore();
        VUI.tank(t.iconIdx, t.color, d.x + pad, d.y + 7, 18, 13);
      }
      const nx = t ? pad + 24 : pad;
      txt(p.name, nx, 10.5, { size: 1.25, display: true, weight: 400 });
      txt(selling ? 'INVENTORY · CLICK AN ITEM TO SELL' : 'INVENTORY', nx, 20, { size: 0.62, weight: 700, track: 1.2, color: Theme.muted });
      txt(money(p.cash), w - pad, 10.5, { size: 0.95, weight: 700, align: 'right', color: Theme.accent });
      box(pad, 26, iw, 0.01, { stroke: 'rgba(150,176,230,0.12)' });
      // groups and tiles
      for (const g of groups) heading(g.name, pad + 1, g.y + 5.5);
      d.hover = null;
      for (const tl of tiles) {
        const it = tl.it, st = state(it), over = hov(tl.x, tl.y, tw, th);
        if (over) d.hover = it;
        const fl = d.flash && d.flash.id === it.id && (Math.floor(d.flash.t * 16) & 1);
        let fill = over ? 'rgba(150,176,230,0.14)' : 'rgba(255,255,255,0.04)', stroke = over ? 'rgba(150,176,230,0.35)' : 'rgba(150,176,230,0.12)', lw = 1;
        if (st === 'accent') { fill = 'rgba(255,182,64,0.16)'; stroke = 'rgba(255,182,64,0.85)'; lw = 1.4; }
        if (st === 'info') { fill = 'rgba(106,194,255,0.16)'; stroke = 'rgba(106,194,255,0.85)'; lw = 1.4; }
        if (st === 'shield') {
          const c = it.color, c3s = cR(c) + ',' + cG(c) + ',' + cB(c);
          fill = 'rgba(' + c3s + ',0.16)'; stroke = 'rgba(' + c3s + ',0.95)'; lw = 1.5;
          ctx.save(); ctx.shadowColor = 'rgba(' + c3s + ',0.6)'; ctx.shadowBlur = 9 * Gfx.dpr;
          box(tl.x, tl.y, tw, th, { fill, r: 3 }); ctx.restore();
        }
        if (fl) fill = 'rgba(255,214,120,0.55)';
        box(tl.x, tl.y, tw, th, { fill, stroke, lw, r: 3 });
        const is = Math.min(tw - 3, th - 5);
        icon(it.id, tl.x + (tw - is) / 2, tl.y - 0.5, is);
        const cnt = count(it), n = p.inv[it.id] || 0;
        txt(cnt, tl.x + tw / 2, tl.y + th - 4.3, { size: 0.64, weight: 700, align: 'center',
          color: st === 'accent' ? Theme.accent : st === 'info' ? Theme.info : it.id === 'babyMissile' || n > 0 || it.kind === 'fuel' || it.kind === 'autodefense' ? 'rgba(230,234,242,0.9)' : Theme.muted });
      }
      // footer: the item under the pointer (or what's loaded)
      const fy = h - foot;
      const cur = d.hover || (t && !selling ? Data.byId[p.weapon] : null);
      card(pad, fy, iw - 56, 20);
      if (cur) {
        icon(cur.id, pad + 3, fy + 3, 14);
        const nw = txt(cur.name, pad + 20, fy + 6.5, { size: 0.82, weight: 700 });
        const a = action(cur);
        if (a) txt(a, pad + 20 + nw + 6, fy + 6.5, { size: 0.62, weight: 700, color: Theme.accent });
        let ds = cur.desc || '';
        const maxW = iw - 56 - 24;
        ctx.font = '600 ' + VUI.fontPx(0.66).toFixed(1) + 'px ' + FONT_UI;
        while (ds.length > 3 && ctx.measureText(ds).width / Gfx.ux > maxW) ds = ds.slice(0, -2).replace(/\s*\S*$/, '') + '…';
        txt(ds, pad + 20, fy + 14.5, { size: 0.66, color: 'rgba(200,208,224,0.75)' });
      } else txt(selling ? 'Pick something to sell.' : 'Nothing here yet.', pad + 6, fy + 10, { size: 0.72, color: Theme.muted });
      btn('Done', w - pad - 50, fy + 2, 50, 16, true);
    } });

    for (const tl of tiles) tap(tl.x, tl.y, tw, th, () => {
      const it = tl.it;
      if (o.onPick) { o.onPick(it); return; }
      const ok = Panels.obvious(t, it, d);
      if (ok) d.flash = { id: it.id, t: 0.4 }; else Sound.error();
    });
    tap(w - pad - 50, h - foot + 2, 50, 16, () => { Sound.click(); d.close(); }, { btnAt: (w - pad - 50) + ',' + (h - foot + 2), pressable: true });
    d.tick = dt => { if (d.flash && (d.flash.t -= dt) <= 0) d.flash = null; };
    d.onEnter = () => d.close();
    UI.push(d);
    return d;
  },
  // the "obvious" action for an inventory icon
  obvious(t, it, dlg) {
    if (!t) return false;
    const p = t.p, idx = p.idx;
    switch (it.kind) {
      case 'guidance':
        if (Battle.mode === 'SIMULTANEOUS') return false;
        Battle.request({ c: 'guid', tank: idx, id: it.id }); return true;
      case 'shield':
        if (t.shield && t.shield.it === it && t.shield.energy >= it.strength - 0.5) return false;
        Battle.request({ c: 'shield', tank: idx, id: it.id }); return true;
      case 'parachute': Battle.tankAction(t, 'para'); return true;
      case 'trigger': Battle.tankAction(t, 'trig'); return true;
      case 'battery':
        if (t.energy >= 100) return false;
        Battle.tankAction(t, 'batt'); return true;
      case 'fuel':
        if (!t.icon.mobile || !(p.fuel > 0)) return false;
        UI.remove(dlg); Panels.move(t); return true;
      case 'autodefense': return false;
      default:
        if (it.cat === 'W') { p.weapon = it.id; Sound.click(); return true; }
    }
    return false;
  },

  /* ------------------------------------------------ Moving Control Panel */
  move(t) {
    const p = t.p;
    if (!t.icon.mobile || !(p.fuel > 0)) { Sound.error(); return; }
    const w = 150, h = 34;
    const d = new Dialog({ w, h, closeOnOutside: false });
    d.y = Battle.statusH + 14;
    d.pending = []; d.flushT = 0;
    // steps are batched a tenth of a second at a time so a held arrow doesn't flood the network
    const flush = () => {
      if (!d.pending.length) return;
      Battle.request({ c: 'move', tank: p.idx, steps: d.pending });
      d.pending = [];
    };
    const step = dir => {
      if (!(p.fuel > 0) || t.falling) { Sound.error(); return; }
      d.pending.push(dir);
      if (!Net.isClient()) flush();
    };
    d.button('◀', 8, 8, 24, 18, () => step(-1), { repeat: true, fireOnDown: true, click() { step(-1); } });
    d.button('Fuel: ' + (p.fuel || 0), 36, 8, 78, 18, () => { flush(); d.close(); });
    d.ctls[1].draw = function (s) { drawButton(s, d.x + this.x, d.y + this.y, this.w, this.h, 'Fuel: ' + (p.fuel || 0), { pressed: d.pressed === this }); };
    d.button('▶', 118, 8, 24, 18, () => step(1), { repeat: true, fireOnDown: true, click() { step(1); } });
    d.onKey = ev => {
      if (ev.k === 'arrowleft') { step(-1); return true; }
      if (ev.k === 'arrowright') { step(1); return true; }
      return false;
    };
    d.onEnter = () => { flush(); d.close(); };
    d.onClose = flush;
    d.tick = dt => {
      d.flushT += dt;
      if (d.flushT > 0.1) { d.flushT = 0; flush(); }
      if (!(p.fuel > 0) || t.falling || !t.alive) { flush(); UI.remove(d); }
    };
    UI.push(d);
  },

  /* ------------------------------------------------ battery selection for energy weapons */
  batteries(t, cb) {
    const p = t.p, max = Math.min(9, p.inv.battery || 0);
    const w = 200, h = 64;
    const d = new Dialog({ w, h, title: 'Batteries to use', closeOnOutside: false });
    d.n = max;
    for (let i = 0; i < 9; i++) {
      d.add({ x: 12 + i * 20, y: 18, w: 16, h: 16, kind: 'box', draw(s) {
        const X = d.x + this.x, Y = d.y + this.y, on = i < d.n, ok = i < max;
        bevel(s, X, Y, 16, 16, !on, on ? vga(63, 56, 10) : (ok ? UIC.light : UIC.face));
        Font.center(s, String(i + 1), X + 8, Y + 4, ok ? UIC.text : UIC.dis);
      }, click() { if (i < max) { d.n = (d.n === i + 1) ? i : i + 1; Sound.click(); } else Sound.error(); } });
    }
    d.button('&Engage', w / 2 - 35, h - 22, 70, 14, () => { UI.remove(d); cb(d.n); });
    d.onKey = ev => {
      if (/^[0-9]$/.test(ev.k)) { d.n = Math.min(max, +ev.k); Sound.click(); return true; }
      return false;
    };
    d.onEnter = () => { UI.remove(d); cb(d.n); };
    UI.push(d);
  },

  /* ------------------------------------------------ Choose Target */
  chooseTarget(t, cb) {
    const w = 110, h = 22;
    const d = new Dialog({ w, h, closeOnOutside: false });
    d.y = Battle.statusH + 14;
    d.text('Choose Target', 12, 7, UIC.text);
    const done = pt => { UI.remove(d); cb(pt); };
    // aim at the middle of the tank so level (horizontal) runs don't plow into its footing
    const tankPt = tk => ({ x: tk.x, y: Math.round(tk.y - tk.hh / 2) });
    d.onKey = ev => {
      if (/^[0-9]$/.test(ev.k)) {
        const n = ev.k === '0' ? 10 : +ev.k, ts = Battle.tanksByX();
        if (ts[n - 1]) done(tankPt(ts[n - 1])); else Sound.error();
        return true;
      }
      return false;
    };
    d.mouse = function (ev) {
      if (ev.kind !== 'down') return true;
      if (ev.button === 2) {
        let best = null, bd = Infinity;
        for (const tk of Battle.alive()) { const dd = Math.hypot(tk.x - ev.x, tk.y - ev.y); if (dd < bd) { bd = dd; best = tk; } }
        if (best) done(tankPt(best));
      } else done({ x: Math.round(ev.x), y: Math.round(ev.y) });
      return true;
    };
    d.extraDraw = s => {
      // number the tanks so they can be picked from the keyboard
      Battle.tanksByX().forEach((tk, i) => {
        const x = Math.round(tk.x / Screen.UX), y = Math.round(tk.y / Screen.UY) + 2;
        Font.center(s, String((i + 1) % 10), x, Math.min(y, Screen.UH - 9), tk.color, { shadow: UIC.black });
      });
    };
    UI.push(d);
  },

  /* ------------------------------------------------ tank info */
  tankInfo(tk) {
    const p = tk.p;
    const type = p.ai ? (p.ai === 'Unknown' ? 'Computer' : p.ai) : (Net.online ? (Battle.isLocal(tk) ? 'You' : 'Human (online)') : 'Human');
    const lines = [
      p.name.replace(/&/g, '&&') + '  (' + type + ')',
      'Power: ' + Math.round(tk.energy) + '%',
      'Shields: ' + (tk.shield ? tk.shield.it.name + ' ' + Math.round(tk.shield.energy / tk.shield.it.strength * 100) + '%' : 'none'),
      'Parachutes: ' + (p.inv.parachute || 0),
      (Cfg.scoringMode === 'GREEDY' ? 'Net Worth: ' + money(Game.netWorth(p)) : 'Score: ' + commas(p.score)),
      'Wins: ' + p.wins + '   Kills: ' + p.kills
    ];
    if (Battle.teamsOn()) lines.push('Team: ' + (p.team + 1));
    const d = messageBox(lines, null, { noButton: true, anyKey: true });
    d.extraDraw = s => { s.fillRect(d.x + 4, d.y + 4, d.w - 8, 1, tk.color); };
  },

  /* ------------------------------------------------ game status update */
  update() {
    const cap = s => s.charAt(0) + s.slice(1).toLowerCase();
    const left = Game.rounds - Game.round;
    const lines = [
      'Round ' + Game.round + ' of ' + Game.rounds,
      left + ' round' + (left === 1 ? '' : 's') + ' left after this one'
    ];
    const sp = Game.shopPlayer;
    if (sp && App.scene instanceof ShopScene) {
      lines.push('Interest this round: ' + money(sp.interest || 0));
      lines.push('Interest since start: ' + money(sp.interestTotal || 0));
      lines.push('Interest rate: ' + Math.round(Cfg.interestRate * 100) + '%');
    } else {
      lines.push('Walls: ' + cap(Battle.walls) + (Cfg.effectOfWalls === 'ERRATIC' ? ' (erratic)' : Cfg.effectOfWalls === 'RANDOM' ? ' (random)' : ''));
      lines.push(Battle.wind === 0 ? 'No wind' : 'Wind: ' + Math.abs(Battle.wind) + (Battle.wind > 0 ? ' →' : ' ←') + (Cfg.changingWind ? ' (changing)' : ''));
    }
    lines.push('Scoring: ' + cap(Cfg.scoringMode));
    if (Net.online) lines.push('Network game (' + Net.kindLabel() + ')');
    messageBox(lines, null, { noButton: true, anyKey: true });
  }
};

/* tank movement with fuel (applied by the 'move' command) */
Battle.moveTank = function (t, dir) {
  const p = t.p;
  if (!t.icon.mobile || !(p.fuel > 0) || t.falling) return false;
  const nx = t.x + dir;
  if (nx - t.w / 2 < 1 || nx + t.w / 2 > World.W - 2) return false;
  const climbMax = Math.ceil(3 * World.ay);
  const from = t.y - climbMax - 1;
  let ny = World.H;
  for (let c = nx - 3; c <= nx + 3; c++) ny = Math.min(ny, World.groundY(c, from));
  if (ny <= from) return false;   // too steep to climb
  const rise = Math.max(0, (t.y - ny) / World.ay);
  const cost = 1 + Math.ceil(rise);
  if (p.fuel < cost) return false;
  p.fuel -= cost;
  t.x = nx;
  if (ny < t.y) t.y = ny;
  Sound.beep(60 + Math.random() * 30, 0.02, 0.6);
  return true;
};
