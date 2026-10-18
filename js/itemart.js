'use strict';
/* =====================================================================
   Remastered item icons: every weapon and accessory drawn as vector art
   in the same style as the vector tanks (rounded forms, soft gradients,
   a dark outline, a highlight), instead of the 1.5 pixel icons the
   classic look keeps. Each icon is drawn in a 24 x 24 box and scaled to
   wherever it's shown: shop, inventory, panels, HUD. A few are animated,
   like their 1.5 counterparts (funky bomb, death's head, rollers).
   ===================================================================== */

const ItemArt = (() => {
  const C = {
    ink: 'rgba(6,8,14,0.92)',
    steel: ['#f1f4fa', '#a9b2c3', '#566074', '#2a303c'],
    red: ['#ffb4a6', '#ff5a46', '#a8231a'],
    amber: ['#ffe2a1', '#ffb640', '#b06d10'],
    yellow: ['#fff3b0', '#ffd64a', '#a9821a'],
    green: ['#c6f7c1', '#56d36a', '#1f7a35'],
    cyan: ['#d4f1ff', '#6ac2ff', '#1f5d9c'],
    violet: ['#ead7ff', '#b06cff', '#5a2a9c'],
    dirt: ['#e0b27e', '#a8723f', '#5a3518']
  };
  const t = () => performance.now() / 1000;

  // ---------- drawing helpers (24 x 24 design space)
  const lin = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };
  const ink = (ctx, w) => { ctx.lineWidth = w || 1.1; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); };
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
  function ball(ctx, cx, cy, r, pal) {
    const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.08, cx, cy, r * 1.05);
    g.addColorStop(0, pal[0]); g.addColorStop(0.45, pal[1]); g.addColorStop(1, pal[2]);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fillStyle = g; ctx.fill(); ink(ctx);
  }
  function glow(ctx, cx, cy, r, rgb, a) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  }
  function shine(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(x, y, w, h, -0.5, 0, TAU); ctx.fill();
  }
  // a missile lying along +x, centred on the origin
  function missile(ctx, L, R, body, nose, fins) {
    const x0 = -L / 2, xn = L / 2 - R * 1.9;
    // fins
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, -R); ctx.lineTo(x0 - R * 0.6, -R * 2.1); ctx.lineTo(x0 + R * 1.6, -R * 2.0); ctx.lineTo(x0 + R * 2.8, -R); ctx.closePath();
    ctx.moveTo(x0 + 0.5, R); ctx.lineTo(x0 - R * 0.6, R * 2.1); ctx.lineTo(x0 + R * 1.6, R * 2.0); ctx.lineTo(x0 + R * 2.8, R); ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -R * 2, 0, R * 2, [[0, fins[0]], [0.5, fins[1]], [1, fins[2]]]); ctx.fill(); ink(ctx, 0.9);
    // body
    rr(ctx, x0, -R, xn - x0 + 0.6, R * 2, R * 0.45);
    ctx.fillStyle = lin(ctx, 0, -R, 0, R, [[0, body[0]], [0.45, body[1]], [1, body[2]]]); ctx.fill(); ink(ctx);
    // nose cone
    ctx.beginPath(); ctx.moveTo(xn, -R); ctx.quadraticCurveTo(L / 2 + 0.3, -R * 0.35, L / 2 + 0.6, 0); ctx.quadraticCurveTo(L / 2 + 0.3, R * 0.35, xn, R); ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -R, 0, R, [[0, nose[0]], [0.5, nose[1]], [1, nose[2]]]); ctx.fill(); ink(ctx);
    // a band and a glint
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x0 + R * 1.2, -R + 0.4, 0.9, R * 2 - 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x0 + R * 2.6, -R * 0.62, (xn - x0) * 0.55, R * 0.32);
  }
  const tilt = (ctx, a, fn) => { ctx.save(); ctx.translate(12, 12); ctx.rotate(a); fn(); ctx.restore(); };
  function trefoil(ctx, cx, cy, r) {
    ctx.fillStyle = '#141414';
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + k * TAU / 3;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a - 0.5, a + 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, TAU); ctx.fill();
  }
  function bomb(ctx, cx, cy, r, pal, fuse) {
    if (fuse) {
      ctx.beginPath(); ctx.moveTo(cx + r * 0.5, cy - r * 0.8); ctx.quadraticCurveTo(cx + r * 0.9, cy - r * 1.5, cx + r * 1.3, cy - r * 1.35);
      ink(ctx, 1.3); ctx.strokeStyle = '#c9b48a'; ctx.lineWidth = 0.7; ctx.stroke();
      const s = 0.8 + 0.3 * Math.sin(t() * 14);
      glow(ctx, cx + r * 1.35, cy - r * 1.4, 2.6 * s, '255,210,90', 0.95);
    }
    ball(ctx, cx, cy, r, pal);
  }
  function flame(ctx, cx, base, w, h, hot) {
    const f = 0.9 + 0.1 * Math.sin(t() * 9 + cx);
    ctx.beginPath();
    ctx.moveTo(cx - w, base);
    ctx.bezierCurveTo(cx - w * 1.1, base - h * 0.5, cx - w * 0.2, base - h * 0.55, cx, base - h * f);
    ctx.bezierCurveTo(cx + w * 0.3, base - h * 0.6, cx + w * 1.15, base - h * 0.45, cx + w, base);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, base - h, 0, base, hot ? [[0, '#f4fbff'], [0.4, '#8fd8ff'], [1, '#3a6dff']] : [[0, '#fff1a8'], [0.45, '#ffa632'], [1, '#e8401c']]);
    ctx.fill(); ink(ctx, 0.9);
  }
  function arrow(ctx, x0, y0, x1, y1, col, both) {
    const a = Math.atan2(y1 - y0, x1 - x0), h = 5.5;
    const head = (x, y, ang) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang - 0.55) * h, y - Math.sin(ang - 0.55) * h); ctx.lineTo(x - Math.cos(ang + 0.55) * h, y - Math.sin(ang + 0.55) * h); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ink(ctx, 0.8); };
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ink(ctx, 4.6); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
    head(x1, y1, a); if (both) head(x0, y0, a + Math.PI);
  }
  function bubble(ctx, rgb, thick, hex) {
    const g = ctx.createRadialGradient(12, 12, 4, 12, 12, 10.5);
    g.addColorStop(0, 'rgba(' + rgb + ',0.06)'); g.addColorStop(0.75, 'rgba(' + rgb + ',0.28)'); g.addColorStop(1, 'rgba(' + rgb + ',0.75)');
    ctx.beginPath(); ctx.arc(12, 12, 10, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = thick; ctx.strokeStyle = hex; ctx.stroke(); ink(ctx, 0.8);
    shine(ctx, 8.2, 7.6, 2.6, 1.3);
  }
  function magnet(ctx, pal, rings) {
    ctx.beginPath(); ctx.arc(12, 11, 6.5, Math.PI, 0); ctx.lineTo(18.5, 19); ctx.lineTo(14.5, 19); ctx.lineTo(14.5, 11); ctx.arc(12, 11, 2.5, 0, Math.PI, true); ctx.lineTo(9.5, 19); ctx.lineTo(5.5, 19); ctx.closePath();
    ctx.fillStyle = lin(ctx, 5, 4, 19, 19, [[0, pal[0]], [0.5, pal[1]], [1, pal[2]]]); ctx.fill(); ink(ctx);
    ctx.fillStyle = '#e8edf5'; ctx.fillRect(5.6, 16, 3.8, 2.9); ctx.fillRect(14.6, 16, 3.8, 2.9);
    ctx.strokeStyle = 'rgba(255,230,140,0.85)'; ctx.lineWidth = 0.9;
    for (let k = 0; k < rings; k++) { ctx.beginPath(); ctx.arc(12, 12, 9 + k * 2, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke(); }
  }
  function drill(ctx, scale, pal) {
    tilt(ctx, 0.75, () => {
      const L = 9 * scale, R = 3.4 * scale;
      ctx.beginPath(); ctx.moveTo(-L * 0.55, -R); ctx.lineTo(L * 0.25, -R); ctx.lineTo(L * 0.8, 0); ctx.lineTo(L * 0.25, R); ctx.lineTo(-L * 0.55, R); ctx.closePath();
      ctx.fillStyle = lin(ctx, 0, -R, 0, R, [[0, pal[0]], [0.5, pal[1]], [1, pal[2]]]); ctx.fill(); ink(ctx);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.9;
      for (let k = 0; k < 4; k++) { const x = -L * 0.45 + k * L * 0.22; ctx.beginPath(); ctx.moveTo(x, -R); ctx.lineTo(x + R * 0.9, R); ctx.stroke(); }
      rr(ctx, -L * 0.85, -R * 0.6, L * 0.32, R * 1.2, 0.8); ctx.fillStyle = lin(ctx, 0, -R, 0, R, [[0, C.steel[0]], [1, C.steel[2]]]); ctx.fill(); ink(ctx, 0.9);
    });
  }
  function dirtBall(ctx, cx, cy, r) {
    ball(ctx, cx, cy, r, C.dirt);
    ctx.fillStyle = 'rgba(60,32,14,0.6)';
    for (let k = 0; k < 6; k++) { const a = k * 2.4, d = r * (0.25 + (k % 3) * 0.22); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.55 + r * 0.05, 0, TAU); ctx.fill(); }
  }
  function burst(ctx, cx, cy, r0, r1, n, col, a0, a1) {
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const a = a0 + (a1 - a0) * (k / Math.max(1, n - 1));
      ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
  }
  function bolt(ctx, pts, col) {
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ink(ctx, 2.6); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke();
  }
  function roller(ctx, r) {
    const cx = 12, cy = 18.5 - r;
    ctx.strokeStyle = 'rgba(170,190,235,0.55)'; ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(cx - r - 2 - k * 1.6, cy - r * 0.5 + k * r * 0.5); ctx.lineTo(cx - r - 5 - k * 1.6, cy - r * 0.5 + k * r * 0.5); ctx.stroke(); }
    ball(ctx, cx, cy, r, C.steel);
    // a band that turns as it rolls
    const a = t() * 5;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, TAU); ctx.clip();
    ctx.strokeStyle = 'rgba(255,182,64,0.85)'; ctx.lineWidth = r * 0.32;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 1.2); ctx.lineTo(cx - Math.cos(a) * r * 1.2, cy - Math.sin(a) * r * 1.2); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,135,160,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(2, 18.8); ctx.lineTo(22, 18.8); ctx.stroke();
  }

  // ---------- the icons
  const A = {
    babyMissile: ctx => tilt(ctx, -0.42, () => missile(ctx, 15, 1.9, C.steel, C.red, C.red)),
    missile: ctx => tilt(ctx, -0.42, () => missile(ctx, 20, 2.5, C.steel, C.red, C.red)),
    babyNuke: ctx => { tilt(ctx, -0.42, () => missile(ctx, 13, 2.6, C.yellow, C.steel, C.steel)); trefoil(ctx, 11.4, 12.6, 2.3); },
    nuke: ctx => { glow(ctx, 12, 12, 12, '255,214,74', 0.25); tilt(ctx, -0.42, () => missile(ctx, 18, 3.4, C.yellow, C.steel, C.steel)); trefoil(ctx, 11.2, 12.8, 3.1); },
    leapFrog: ctx => {
      ctx.setLineDash([1.6, 1.6]); ctx.strokeStyle = 'rgba(111,227,138,0.85)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(2, 19); ctx.quadraticCurveTo(6, 11, 9, 17); ctx.quadraticCurveTo(12.5, 10, 15, 15); ctx.stroke(); ctx.setLineDash([]);
      tilt(ctx, -0.5, () => { ctx.translate(4, -2.5); missile(ctx, 12, 2, C.green, C.steel, C.green); });
    },
    funkyBomb: ctx => {
      bomb(ctx, 11, 13.5, 7.5, ['#ffffff', '#cfd6e4', '#5b6376'], true);
      ctx.save(); ctx.beginPath(); ctx.arc(11, 13.5, 7, 0, TAU); ctx.clip();
      const h0 = (t() * 140) % 360;
      for (let k = 0; k < 6; k++) { ctx.fillStyle = 'hsl(' + ((h0 + k * 60) % 360) + ',95%,58%)'; ctx.fillRect(3, 6.5 + k * 2.4, 16, 2.5); }
      ctx.restore(); ctx.beginPath(); ctx.arc(11, 13.5, 7.5, 0, TAU); ink(ctx); shine(ctx, 8, 10, 2.2, 1.2);
    },
    mirv: ctx => {
      tilt(ctx, -0.42, () => { ctx.translate(-4, 0); missile(ctx, 10, 2.2, C.steel, C.amber, C.steel); });
      for (const [dx, dy] of [[16.5, 4.5], [19, 9.5], [17.5, 14.5]]) { ctx.save(); ctx.translate(dx, dy); ctx.rotate(Math.atan2(dy - 11, dx - 9)); missile(ctx, 5, 1.1, C.steel, C.red, C.red); ctx.restore(); }
    },
    deathsHead: ctx => {
      ctx.beginPath(); ctx.moveTo(4.5, 11); ctx.bezierCurveTo(4.5, 2.5, 19.5, 2.5, 19.5, 11); ctx.bezierCurveTo(19.5, 14.5, 17.5, 15.5, 16.5, 16.5); ctx.lineTo(16.5, 20); ctx.lineTo(7.5, 20); ctx.lineTo(7.5, 16.5); ctx.bezierCurveTo(6.5, 15.5, 4.5, 14.5, 4.5, 11); ctx.closePath();
      ctx.fillStyle = lin(ctx, 4, 3, 20, 20, [[0, '#ffffff'], [0.6, '#d9dde6'], [1, '#8e95a6']]); ctx.fill(); ink(ctx);
      const pulse = 0.55 + 0.45 * Math.sin(t() * 5);
      for (const ex of [9, 15]) { ctx.beginPath(); ctx.ellipse(ex, 11.5, 2.3, 2.6, 0, 0, TAU); ctx.fillStyle = '#16181f'; ctx.fill(); glow(ctx, ex, 11.6, 2.6, '255,60,40', 0.5 + 0.5 * pulse); }
      ctx.beginPath(); ctx.moveTo(12, 13.8); ctx.lineTo(10.8, 16); ctx.lineTo(13.2, 16); ctx.closePath(); ctx.fillStyle = '#16181f'; ctx.fill();
      ctx.strokeStyle = '#16181f'; ctx.lineWidth = 0.8; for (const x of [9.5, 12, 14.5]) { ctx.beginPath(); ctx.moveTo(x, 17.3); ctx.lineTo(x, 20); ctx.stroke(); }
    },
    napalm: ctx => {
      flame(ctx, 12, 12, 5, 10);
      rr(ctx, 6.5, 11.5, 11, 9, 2); ctx.fillStyle = lin(ctx, 6, 0, 18, 0, [[0, '#7a2a14'], [0.4, '#d8562a'], [1, '#6a2410']]); ctx.fill(); ink(ctx);
      ctx.fillStyle = 'rgba(255,214,74,0.9)'; ctx.fillRect(7.5, 14.5, 9, 1.6);
    },
    hotNapalm: ctx => {
      glow(ctx, 12, 8, 9, '120,200,255', 0.35);
      flame(ctx, 12, 12, 5.5, 11, true);
      rr(ctx, 6.5, 11.5, 11, 9, 2); ctx.fillStyle = lin(ctx, 6, 0, 18, 0, [[0, '#1d2f6e'], [0.4, '#3d6be8'], [1, '#18275c']]); ctx.fill(); ink(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(7.5, 14.5, 9, 1.6);
    },
    tracer: ctx => {
      ctx.setLineDash([2, 2]); ctx.strokeStyle = 'rgba(200,215,255,0.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(3, 20); ctx.quadraticCurveTo(9, 6, 17, 7); ctx.stroke(); ctx.setLineDash([]);
      glow(ctx, 18, 7, 5, '255,255,255', 0.9); ball(ctx, 18, 7, 1.8, ['#ffffff', '#e8edf5', '#9aa4b5']);
    },
    smokeTracer: ctx => {
      for (const [x, y, r] of [[4, 19, 2.6], [7.5, 14.5, 2.3], [11, 10.5, 2], [14, 8, 1.6]]) ball(ctx, x, y, r, ['#ffffff', '#c3c9d6', '#7d8597']);
      glow(ctx, 18.5, 6.5, 4.5, '255,255,255', 0.9); ball(ctx, 18.5, 6.5, 1.7, ['#ffffff', '#e8edf5', '#9aa4b5']);
    },
    babyRoller: ctx => roller(ctx, 3.6),
    roller: ctx => roller(ctx, 5),
    heavyRoller: ctx => roller(ctx, 6.6),
    riotCharge: ctx => { glow(ctx, 6, 17, 13, '106,194,255', 0.3); burst(ctx, 5, 18, 3, 13, 5, '#8fd6ff', -1.25, -0.2); ball(ctx, 5, 18, 2.6, C.cyan); },
    riotBlast: ctx => { glow(ctx, 6, 17, 16, '106,194,255', 0.35); burst(ctx, 5, 18, 3, 17, 7, '#8fd6ff', -1.4, -0.05); ball(ctx, 5, 18, 3.2, C.cyan); },
    riotBomb: ctx => {
      glow(ctx, 12, 12, 12, '106,194,255', 0.35);
      ctx.strokeStyle = '#8fd6ff'; ctx.lineWidth = 1.6; ctx.setLineDash([2.4, 1.6]); ctx.beginPath(); ctx.arc(12, 12, 8.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ball(ctx, 12, 12, 4, C.cyan);
    },
    heavyRiotBomb: ctx => {
      glow(ctx, 12, 12, 12, '106,194,255', 0.45);
      ctx.strokeStyle = '#8fd6ff'; ctx.lineWidth = 1.5; ctx.setLineDash([2.4, 1.6]);
      ctx.beginPath(); ctx.arc(12, 12, 10, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(12, 12, 7.2, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ball(ctx, 12, 12, 4.4, C.cyan);
    },
    babyDigger: ctx => drill(ctx, 1, C.steel),
    digger: ctx => drill(ctx, 1.25, C.steel),
    heavyDigger: ctx => drill(ctx, 1.5, C.steel),
    babySandhog: ctx => drill(ctx, 1, C.amber),
    sandhog: ctx => drill(ctx, 1.25, C.amber),
    heavySandhog: ctx => drill(ctx, 1.5, C.amber),
    dirtClod: ctx => dirtBall(ctx, 12, 14, 4.5),
    dirtBall: ctx => dirtBall(ctx, 12, 13, 6.5),
    tonOfDirt: ctx => { dirtBall(ctx, 12, 12.5, 8.8); ctx.fillStyle = '#fff'; ctx.font = '700 5px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('1T', 12, 14.3); },
    liquidDirt: ctx => {
      ctx.beginPath(); ctx.moveTo(12, 2.5); ctx.bezierCurveTo(13, 7, 18, 10.5, 18, 14.5); ctx.bezierCurveTo(18, 18.5, 15, 21, 12, 21); ctx.bezierCurveTo(9, 21, 6, 18.5, 6, 14.5); ctx.bezierCurveTo(6, 10.5, 11, 7, 12, 2.5); ctx.closePath();
      ctx.fillStyle = lin(ctx, 6, 3, 18, 21, [[0, C.dirt[0]], [0.5, C.dirt[1]], [1, C.dirt[2]]]); ctx.fill(); ink(ctx); shine(ctx, 9.5, 13, 1.6, 2.6);
    },
    dirtCharge: ctx => {
      for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.32, d = 6 + (k % 2) * 3; dirtBall(ctx, 12 + Math.cos(a) * d, 18 + Math.sin(a) * d, 1.6); }
      rr(ctx, 7, 17.5, 10, 4.5, 1.5); ctx.fillStyle = lin(ctx, 0, 17, 0, 22, [[0, C.dirt[0]], [1, C.dirt[2]]]); ctx.fill(); ink(ctx);
    },
    earthDisrupter: ctx => {
      rr(ctx, 3, 14, 18, 7, 1.5); ctx.fillStyle = lin(ctx, 0, 14, 0, 21, [[0, C.dirt[0]], [1, C.dirt[2]]]); ctx.fill(); ink(ctx);
      for (const x of [8, 16]) arrow(ctx, x, 3, x, 12, '#ffb640');
      ctx.strokeStyle = 'rgba(255,214,140,0.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, 17); for (let x = 4; x <= 20; x += 2) ctx.lineTo(x, 17 + ((x / 2) % 2 ? 1.2 : -1.2)); ctx.stroke();
    },
    plasmaBlast: ctx => {
      glow(ctx, 12, 12, 12, '106,230,255', 0.55);
      ctx.strokeStyle = 'rgba(190,245,255,0.85)'; ctx.lineWidth = 1;
      const a = t() * 2;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(12, 12, 9, 3.4, a + k * Math.PI / 3, 0, TAU); ctx.stroke(); }
      ball(ctx, 12, 12, 4.4, ['#ffffff', '#7fe9ff', '#1a7fb0']);
    },
    laser: ctx => {
      ctx.strokeStyle = 'rgba(255,70,90,0.9)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(12, 12); ctx.lineTo(23, 3); ctx.stroke();
      ctx.strokeStyle = '#ffd6dc'; ctx.lineWidth = 0.8; ctx.stroke();
      tilt(ctx, -0.68, () => { rr(ctx, -9, -3.2, 12, 6.4, 1.6); ctx.fillStyle = lin(ctx, 0, -3, 0, 3, [[0, C.steel[0]], [0.5, C.steel[1]], [1, C.steel[3]]]); ctx.fill(); ink(ctx); ctx.fillStyle = '#ff4a5a'; ctx.fillRect(1.5, -1.6, 1.8, 3.2); });
    },
    airStrike: ctx => {
      ctx.beginPath(); ctx.moveTo(2, 9); ctx.lineTo(9, 7.5); ctx.lineTo(13, 3); ctx.lineTo(15.5, 3); ctx.lineTo(13.5, 8); ctx.lineTo(20, 8.5); ctx.lineTo(22, 6.5); ctx.lineTo(23, 6.5); ctx.lineTo(22.5, 10.5); ctx.lineTo(13.5, 11); ctx.lineTo(15.5, 15); ctx.lineTo(13, 15); ctx.lineTo(9, 11); ctx.lineTo(2, 10.5); ctx.closePath();
      ctx.fillStyle = lin(ctx, 0, 3, 0, 15, [[0, C.steel[0]], [0.5, C.steel[1]], [1, C.steel[2]]]); ctx.fill(); ink(ctx);
      for (const [x, y] of [[8, 17], [12, 19.5], [16, 17.5]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2); missile(ctx, 4.5, 1, C.steel, C.red, C.steel); ctx.restore(); }
    },
    teleporter: ctx => {
      const a = t() * 3;
      glow(ctx, 12, 12, 12, '80,220,255', 0.45);
      ctx.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) { ctx.strokeStyle = ['#d4f1ff', '#6ac2ff', '#b06cff'][k]; ctx.beginPath(); ctx.arc(12, 12, 3 + k * 2.6, a + k, a + k + 3.6); ctx.stroke(); }
      ball(ctx, 12, 12, 2, ['#ffffff', '#bff0ff', '#4aa8d8']);
    },
    teslaCoil: ctx => {
      rr(ctx, 9, 9, 6, 12, 1); ctx.fillStyle = lin(ctx, 9, 0, 15, 0, [[0, '#a8723f'], [0.5, '#ffb640'], [1, '#7a4a1a']]); ctx.fill(); ink(ctx);
      ctx.strokeStyle = 'rgba(80,40,10,0.7)'; ctx.lineWidth = 0.6; for (let y = 10.5; y < 20; y += 1.5) { ctx.beginPath(); ctx.moveTo(9, y); ctx.lineTo(15, y); ctx.stroke(); }
      ball(ctx, 12, 7, 3.6, C.steel);
      const j = Math.floor(t() * 8) % 2;
      bolt(ctx, [[8.5, 6], [5, 8 + j], [6, 10], [2, 13]], '#bfe4ff'); bolt(ctx, [[15.5, 6], [19, 7 - j], [18, 9.5], [22.5, 11]], '#bfe4ff');
    },
    bunkerBuster: ctx => tilt(ctx, 1.05, () => missile(ctx, 19, 2.2, ['#8a93a6', '#454c5c', '#20252f'], C.amber, ['#8a93a6', '#454c5c', '#20252f'])),
    portalGun: ctx => {
      // two rings, blue and orange, a shell looping from one to the other
      const spin = t() * 3;
      for (const [cx, rgb, hex] of [[7, '90,160,255', '#6aa6ff'], [17, '255,150,50', '#ff9a3a']]) {
        glow(ctx, cx, 12, 7, rgb, 0.45);
        ctx.beginPath(); ctx.ellipse(cx, 12, 3.6, 8, 0, 0, TAU); ctx.fillStyle = 'rgba(' + rgb + ',0.25)'; ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = hex; ctx.stroke(); ink(ctx, 0.5);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.ellipse(cx, 12, 2, 5, 0, spin, spin + 2.2); ctx.stroke();
      }
      ctx.setLineDash([1.4, 1.4]); ctx.strokeStyle = 'rgba(255,240,200,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(8, 4); ctx.quadraticCurveTo(12, -1, 16, 4); ctx.stroke(); ctx.setLineDash([]);
    },
    empBlast: ctx => {
      glow(ctx, 12, 12, 12, '106,160,255', 0.4);
      ctx.strokeStyle = 'rgba(160,200,255,0.9)'; ctx.lineWidth = 1.2;
      const p = (t() * 0.8) % 1;
      for (const r of [4 + p * 3, 7.5 + p * 3]) { ctx.beginPath(); ctx.arc(12, 12, r, 0, TAU); ctx.stroke(); }
      bolt(ctx, [[13.5, 3.5], [9.5, 12], [13, 12], [10, 20.5]], '#ffe06a');
    },
    heatGuidance: ctx => {
      glow(ctx, 12, 12, 11, '255,90,60', 0.45);
      ctx.strokeStyle = '#ff7a5a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(12, 12, 7, 0, TAU); ctx.stroke(); ink(ctx, 0.6);
      ctx.beginPath(); for (const [a, b] of [[[12, 2], [12, 7]], [[12, 17], [12, 22]], [[2, 12], [7, 12]], [[17, 12], [22, 12]]]) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.strokeStyle = '#ffd0c4'; ctx.lineWidth = 1.4; ctx.stroke();
      ball(ctx, 12, 12, 2.2, C.red);
    },
    ballisticGuidance: ctx => {
      ctx.setLineDash([1.8, 1.4]); ctx.strokeStyle = '#ffb640'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(2.5, 20); ctx.quadraticCurveTo(10, -2, 18, 16); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#ff5a46'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(18.5, 17.5, 3, 0, TAU); ctx.stroke(); ink(ctx, 0.5);
      ctx.beginPath(); ctx.moveTo(18.5, 13); ctx.lineTo(18.5, 22); ctx.moveTo(14, 17.5); ctx.lineTo(23, 17.5); ctx.strokeStyle = '#ffd0c4'; ctx.lineWidth = 0.9; ctx.stroke();
    },
    horzGuidance: ctx => arrow(ctx, 5.5, 12, 18.5, 12, '#6ac2ff', true),
    vertGuidance: ctx => arrow(ctx, 12, 5.5, 12, 18.5, '#6ac2ff', true),
    lazyBoy: ctx => {
      // a recliner: point it at the target and put your feet up
      ctx.beginPath(); ctx.moveTo(4, 7); ctx.lineTo(8, 6.5); ctx.lineTo(9.5, 13); ctx.lineTo(17, 13); ctx.lineTo(21.5, 10.5); ctx.lineTo(22.5, 12.5); ctx.lineTo(18, 16.5); ctx.lineTo(7, 16.5); ctx.closePath();
      ctx.fillStyle = lin(ctx, 4, 6, 22, 17, [[0, '#d39a5e'], [0.6, '#9b5f30'], [1, '#5a3518']]); ctx.fill(); ink(ctx);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(9, 16.5); ctx.lineTo(8, 20.5); ctx.moveTo(16, 16.5); ctx.lineTo(17, 20.5); ctx.stroke();
      ctx.setLineDash([1.4, 1.4]); ctx.strokeStyle = '#ffb640'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(14, 9, 7, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.setLineDash([]);
    },
    parachute: ctx => {
      ctx.beginPath(); ctx.moveTo(2.5, 10); ctx.bezierCurveTo(2.5, 1, 21.5, 1, 21.5, 10);
      for (let k = 4; k >= 0; k--) { const x = 2.5 + k * 3.8; ctx.quadraticCurveTo(x + 1.9 + (k === 4 ? 0 : 0), 8.5, x, 10); }
      ctx.closePath();
      ctx.save(); ctx.clip();
      for (let k = 0; k < 5; k++) { ctx.fillStyle = k % 2 ? '#f4f6fb' : '#ff5a46'; ctx.fillRect(2.5 + k * 3.8, 0, 3.8, 11); }
      ctx.restore(); ink(ctx);
      ctx.strokeStyle = 'rgba(220,226,238,0.85)'; ctx.lineWidth = 0.6; ctx.beginPath(); for (const x of [3, 7.5, 12, 16.5, 21]) { ctx.moveTo(x, 10); ctx.lineTo(12, 18); } ctx.stroke();
      rr(ctx, 9.5, 17.5, 5, 4, 1); ctx.fillStyle = lin(ctx, 0, 17, 0, 22, [[0, C.steel[1]], [1, C.steel[3]]]); ctx.fill(); ink(ctx, 0.9);
    },
    battery: ctx => {
      rr(ctx, 3, 7, 17, 11, 2); ctx.fillStyle = lin(ctx, 0, 7, 0, 18, [[0, C.steel[0]], [0.5, C.steel[1]], [1, C.steel[3]]]); ctx.fill(); ink(ctx);
      rr(ctx, 20, 10, 2, 5, 0.6); ctx.fillStyle = C.steel[1]; ctx.fill(); ink(ctx, 0.8);
      rr(ctx, 4.5, 8.5, 9, 8, 1); ctx.fillStyle = lin(ctx, 0, 8, 0, 16, [[0, C.green[0]], [0.5, C.green[1]], [1, C.green[2]]]); ctx.fill();
      ctx.fillStyle = '#16181f'; ctx.fillRect(15.5, 12, 3, 1); ctx.fillRect(16.5, 11, 1, 3);
    },
    magDeflector: ctx => magnet(ctx, C.yellow, 1),
    shield: ctx => bubble(ctx, '80,176,255', 1.4, '#6ac2ff'),
    forceShield: ctx => {
      bubble(ctx, '176,108,255', 1.6, '#b06cff');
      ctx.strokeStyle = '#ead7ff'; ctx.lineWidth = 1.1;
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.moveTo(12 + Math.cos(a) * 3, 12 + Math.sin(a) * 3); ctx.lineTo(12 + Math.cos(a) * 6.5, 12 + Math.sin(a) * 6.5); ctx.stroke(); }
    },
    heavyShield: ctx => { bubble(ctx, '235,240,250', 3, '#e8edf5'); ctx.beginPath(); ctx.arc(12, 12, 7.6, 0, TAU); ctx.strokeStyle = 'rgba(160,170,190,0.9)'; ctx.lineWidth = 1; ctx.stroke(); },
    superMag: ctx => magnet(ctx, C.red, 3),
    autoDefense: ctx => {
      bubble(ctx, '80,176,255', 1.2, '#6ac2ff');
      rr(ctx, 7, 9, 10, 7, 1.6); ctx.fillStyle = lin(ctx, 0, 9, 0, 16, [[0, C.steel[0]], [1, C.steel[2]]]); ctx.fill(); ink(ctx, 0.9);
      ctx.fillStyle = '#6fe38a'; for (const x of [9.5, 14.5]) { ctx.beginPath(); ctx.arc(x, 12, 1.2, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(12, 9); ctx.lineTo(12, 6); ctx.stroke(); ball(ctx, 12, 5.5, 1.1, C.red);
    },
    fuelTank: ctx => {
      ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(14, 6); ctx.lineTo(18.5, 10); ctx.lineTo(18.5, 21); ctx.lineTo(6, 21); ctx.closePath();
      ctx.fillStyle = lin(ctx, 6, 0, 19, 0, [[0, '#8a1c14'], [0.35, '#ff5a46'], [1, '#7a1810']]); ctx.fill(); ink(ctx);
      rr(ctx, 14, 3, 3, 3.5, 0.6); ctx.fillStyle = C.steel[1]; ctx.fill(); ink(ctx, 0.8);
      ctx.strokeStyle = 'rgba(255,200,190,0.75)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(8, 11); ctx.lineTo(16, 19); ctx.moveTo(16, 11); ctx.lineTo(8, 19); ctx.stroke();
    },
    contactTrigger: ctx => {
      rr(ctx, 4, 13, 16, 8, 1.6); ctx.fillStyle = lin(ctx, 0, 13, 0, 21, [[0, '#d39a5e'], [1, '#6a3d1a']]); ctx.fill(); ink(ctx);
      ctx.fillStyle = C.steel[1]; ctx.fillRect(11, 6, 2, 7); ctx.strokeStyle = C.ink; ctx.lineWidth = 0.8; ctx.strokeRect(11, 6, 2, 7);
      rr(ctx, 6.5, 3.5, 11, 3, 1); ctx.fillStyle = lin(ctx, 0, 3, 0, 7, [[0, C.steel[0]], [1, C.steel[2]]]); ctx.fill(); ink(ctx, 0.9);
      ctx.strokeStyle = '#ff5a46'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(20, 17); ctx.bezierCurveTo(23, 17, 22, 21, 23.5, 22); ctx.stroke();
    },
    // interface glyphs
    gun: ctx => tilt(ctx, -0.35, () => { rr(ctx, -8, -2, 13, 4, 1.4); ctx.fillStyle = lin(ctx, 0, -2, 0, 2, [[0, C.steel[0]], [1, C.steel[2]]]); ctx.fill(); ink(ctx); ball(ctx, -7, 2.5, 3.6, C.amber); }),
    box: ctx => {
      rr(ctx, 4, 7, 16, 13, 1.4); ctx.fillStyle = lin(ctx, 4, 7, 20, 20, [[0, '#e0b27e'], [1, '#8a5a32']]); ctx.fill(); ink(ctx);
      ctx.strokeStyle = 'rgba(70,40,15,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, 11); ctx.lineTo(20, 11); ctx.moveTo(12, 7); ctx.lineTo(12, 20); ctx.stroke();
    },
    computer: ctx => {
      rr(ctx, 3, 4, 18, 12, 1.6); ctx.fillStyle = lin(ctx, 0, 4, 0, 16, [[0, C.steel[1]], [1, C.steel[3]]]); ctx.fill(); ink(ctx);
      rr(ctx, 5, 6, 14, 8, 0.8); ctx.fillStyle = lin(ctx, 5, 6, 19, 14, [[0, '#9fe0ff'], [1, '#1f5d9c']]); ctx.fill();
      ctx.fillStyle = C.steel[2]; ctx.fillRect(10, 16, 4, 3); rr(ctx, 6, 19, 12, 2.4, 1); ctx.fill(); ink(ctx, 0.8);
    },
    human: ctx => {
      ball(ctx, 12, 7, 3.6, ['#ffe1c4', '#e8b48a', '#9a6a44']);
      ctx.beginPath(); ctx.moveTo(5, 21); ctx.bezierCurveTo(5, 13, 19, 13, 19, 21); ctx.closePath();
      ctx.fillStyle = lin(ctx, 0, 12, 0, 21, [[0, '#8fd6ff'], [1, '#2a5fa8']]); ctx.fill(); ink(ctx);
    },
    heli: ctx => {
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(3, 5); ctx.lineTo(19, 5); ctx.moveTo(11, 5); ctx.lineTo(11, 8); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(10, 12, 6.5, 4, 0, 0, TAU); ctx.fillStyle = lin(ctx, 0, 8, 0, 16, [[0, C.green[0]], [1, C.green[2]]]); ctx.fill(); ink(ctx);
      ctx.beginPath(); ctx.moveTo(16, 11); ctx.lineTo(22, 10); ctx.lineTo(22, 13); ctx.lineTo(16, 13.5); ctx.closePath(); ctx.fillStyle = C.green[2]; ctx.fill(); ink(ctx, 0.9);
      ctx.beginPath(); ctx.moveTo(6, 18); ctx.lineTo(15, 18); ctx.moveTo(8, 16); ctx.lineTo(8, 18); ctx.moveTo(13, 16); ctx.lineTo(13, 18); ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
    }
  };

  return {
    has: id => !!A[id],
    // draw icon `id` into a size x size box at (x, y) in canvas pixels
    draw(ctx, id, x, y, size, o) {
      const f = A[id];
      if (!f) return false;
      o = o || {};
      ctx.save();
      ctx.translate(x, y); ctx.scale(size / 24, size / 24);
      if (o.gray) { ctx.globalAlpha *= 0.5; if ('filter' in ctx) ctx.filter = 'grayscale(1)'; }
      try { f(ctx); } catch (e) { /* never let an icon break a frame */ }
      ctx.restore();
      return true;
    }
  };
})();
