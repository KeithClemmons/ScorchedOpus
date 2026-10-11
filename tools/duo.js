'use strict';
/* Dev-only: drive two copies of the game (tools/duo.html) through a network game from the
   console. Frames are stepped by hand, so it works even when the page is hidden.
     await setup('ROOM1', { mode: 'SYNCHRONOUS', rounds: 3 }, ['Cyborg'])      // tabs of this browser
     await setup('ROOM2', { rounds: 2 }, ['Tosser'], 'ws')                       // through server/server.js
     await pump(120, () => A().__g('Game.finished'))
   Humans play themselves (aimed like a computer), so a whole game runs unattended. */

window.A = () => document.getElementById('a').contentWindow;
window.B = () => document.getElementById('b').contentWindow;
window.errs = [];
window.yieldNow = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

// step both games; o.realtime paces steps to the clock (for timeouts), otherwise as fast as possible
window.pump = async function (sec, until, o) {
  o = o || {};
  const n = Math.round(sec * 60), t0 = performance.now();
  const end = r => { A().__draw(); B().__draw(); return r; };
  for (let i = 0; i < n; i++) {
    for (const [nm, f] of [['A', A()], ['B', B()]]) {
      try { f.__step(1 / 60); f.__auto(); } catch (e) { errs.push(nm + ': ' + (e && e.stack || e)); if (errs.length > 20) return end('too many errors'); }
    }
    if (o.realtime) { const target = t0 + (i + 1) * 1000 / 60; while (performance.now() < target) await yieldNow(); }
    else if (i % (o.every || 2) === 0) await yieldNow();
    if (until && until()) return end('until@' + i);
    if (performance.now() - t0 > (o.maxMs || 30000)) return end('time@' + i);
  }
  return end('done ' + n);
};

window.st = () => JSON.stringify({
  A: A().__g("(App.scene === BattleScene ? 'battle:' + Battle.state + ' cur=' + (Battle.cur && Battle.cur.p.name) + ' tick=' + Battle.tick : App.scene.constructor.name) + ' ui=' + UI.stack.length + ' seq=' + Net.seq"),
  B: B().__g("(App.scene === BattleScene ? 'battle:' + Battle.state + ' cur=' + (Battle.cur && Battle.cur.p.name) + ' tick=' + Battle.tick : App.scene.constructor.name) + ' ui=' + UI.stack.length + ' exp=' + Net.expect + ' q=' + Net.queue.length + ' snap=' + Net.snapWanted"),
  errs
});

// installed into each frame
const AUTO = `
window.__step = dt => { App.last = performance.now(); App.step(dt); };
window.__draw = () => App.render(1 / 60);
window.__g = s => eval(s);
window.__auto = () => {
  if (window.__noauto) return;
  const sc = App.scene;
  if (sc instanceof StandingsScene) { if (sc.t > 0.6 && sc.canContinue() && !sc.o.final) sc.key({}); return; }
  if (sc instanceof ShopScene) {
    sc.__t = (sc.__t || 0) + 1;
    if (sc.__t === 10) for (const id of ['missile', 'parachute', 'battery', 'shield', 'funkyBomb', 'babyNuke', 'napalm', 'mirv']) {
      const it = Data.byId[id];
      if (Shop.visible(sc.p, it) && Shop.price(sc.p, it) <= Game.cashOf(sc.p) && Shop.buy(sc.p, it)) sc.tx.push({ op: 'b', id });
    }
    if (sc.__t === 30) sc.done();
    return;
  }
  if (sc !== BattleScene || UI.top()) return;
  if (Battle.mode === 'SIMULTANEOUS') {
    for (const t of Battle.tanks) {
      if (!t.alive || t.dying || !Battle.isLocal(t) || Battle.state !== 'play') continue;
      const K = Battle.keysFor(t);
      if (!t.__pl) t.__pl = AI.plan(t);
      const da = t.__pl.angle - t.angle, dp = Math.min(t.__pl.power, t.maxPower) - t.power;
      Input.held[K.ccw] = da > 1; Input.held[K.cw] = da < -1; Input.held[K.up] = dp > 8; Input.held[K.down] = dp < -8;
      if (Math.abs(da) <= 1 && Math.abs(dp) <= 8 && !t.busy) {
        Input.held[K.ccw] = Input.held[K.cw] = Input.held[K.up] = Input.held[K.down] = false;
        Battle.keySimul({ type: 'key', k: K.fire }); t.__pl = null;
      }
    }
    return;
  }
  const t = Battle.aimTank();
  if (!t || Battle.waitHost) return;
  t.__at = (t.__at || 0) + 1;
  if (t.__at === 20) { const pl = AI.plan(t); t.angle = pl.angle; t.power = Math.min(pl.power, t.maxPower); if (Game.has(t.p, pl.weapon)) t.p.weapon = pl.weapon; }
  if (t.__at >= 40) { t.__at = 0; Battle.humanFire(); }
};
// record every resync request, and the state at each checkpoint so a drift can be diffed
window.__snaps = [];
const rs = Net.requestSnap.bind(Net);
Net.requestSnap = () => { if (!Net.snapWanted) __snaps.push({ tick: Battle.tick, state: Battle.state, round: Game.round }); rs(); };
window.__parts = () => ({
  land: World.land.slice(),
  tanks: Battle.tanks.map(t => ({ x: t.x, y: t.y, e: t.energy, alive: t.alive, dying: t.dying, sh: t.shield ? t.shield.it.id + ':' + t.shield.energy : null, fall: t.falling })),
  wind: Battle.wind, walls: Battle.walls, sr: SR.s, tick: Battle.tick, state: Battle.state,
  players: Game.players.map(p => ({ score: p.score, fuel: p.fuel, inv: JSON.stringify(Object.keys(p.inv).sort().filter(k => p.inv[k]).map(k => k + p.inv[k])), para: JSON.stringify(p.para), ai: p.ai })),
  sum: Battle.checksum()
});
window.__hp = {}; window.__cp = {};
const checkpoint = c => c && (c.c === 'turn' || c.c === 'syncaim' || (c.c === 'tk' && c.sum !== undefined));
const hc = Net.hostCommand.bind(Net);
Net.hostCommand = c => { const k = Net.seq + 1; hc(c); if (checkpoint(c) && App.scene === BattleScene) { __hp[k] = __parts(); delete __hp[k - 60]; } };
const an = Net.applyNext.bind(Net);
Net.applyNext = lock => { const m = Net.queue[0]; if (m && checkpoint(m.c) && Net.inBattle()) { __cp[m.seq] = __parts(); delete __cp[m.seq - 60]; } an(lock); };
1`;

window.reloadBoth = async () => {
  const fa = document.getElementById('a'), fb = document.getElementById('b');
  const la = new Promise(r => { fa.onload = r; }), lb = new Promise(r => { fb.onload = r; });
  fa.src = '../index.html?p=a&' + Date.now(); fb.src = '../index.html?p=b&' + Date.now();
  await la; await lb; await new Promise(r => setTimeout(r, 300));
  A().eval(AUTO); B().eval(AUTO); errs = [];
};

// host in A, join from B, add computers, apply options, start
window.setup = async (code, cfg, ais, kind, url) => {
  kind = kind || 'local';
  url = url || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  await reloadBoth();
  const o = n => JSON.stringify({ code, name: n, icon: n === 'Hosty' ? 0 : 2, url });
  await A().eval(`Net.open('${kind}', ${o('Hosty')})`);
  A().__g('Net.host(); App.set(new LobbyScene()); 1');
  await B().eval(`Net.open('${kind}', ${o('Joiny')})`);
  B().__g('App.set(new JoinScene()); 1');
  await pump(5, () => A().__g('Net.lobby.seats.length') >= 2 && B().__g('Net.seated'));
  A().__g(`for (const ai of ${JSON.stringify(ais || [])}) { Net.addComputer(); Net.lobby.seats[Net.lobby.seats.length - 1].ai = ai; }
    Object.assign(Cfg, ${JSON.stringify(cfg || {})}); applyGraphicsMode(); Net.publishLobby(); 1`);
  await pump(0.5);
  A().__g('App.scene.start(); 1');
  return st();
};

// where did two machines first disagree?
window.firstBad = () => {
  for (const k of Object.keys(B().__cp).map(Number).sort((a, b) => a - b)) {
    const h = A().__hp[k], c = B().__cp[k];
    if (h && c && h.sum !== c.sum) return k;
  }
  return null;
};
window.compare = seq => {
  const h = A().__hp[seq], c = B().__cp[seq];
  if (!h || !c) return 'missing ' + !!h + ' ' + !!c;
  const out = [], W = A().__g('World.W');
  let nd = 0;
  const first = [];
  for (let i = 0; i < h.land.length; i++) {
    if (!!h.land[i] !== !!c.land[i]) { nd++; if (first.length < 8) first.push(i % W + ',' + Math.floor(i / W) + (h.land[i] ? 'H' : 'C')); }
  }
  if (nd) out.push('land diff ' + nd + ' ' + first.join(' '));
  h.tanks.forEach((t, i) => { const a = JSON.stringify(t), b = JSON.stringify(c.tanks[i]); if (a !== b) out.push('tank' + i + ' H' + a + ' C' + b); });
  for (const k of ['wind', 'walls', 'sr']) if (h[k] !== c[k]) out.push(k + ' H' + h[k] + ' C' + c[k]);
  h.players.forEach((p, i) => { const a = JSON.stringify(p), b = JSON.stringify(c.players[i]); if (a !== b) out.push('player' + i + ' H' + a + ' C' + b); });
  out.push('ticks H' + h.tick + ' C' + c.tick + ' sums H' + h.sum + ' C' + c.sum);
  return out.join('\n');
};
// run a whole game; report how it went
window.game = async (code, cfg, ais, kind, maxMs) => {
  await setup(code, cfg, ais, kind);
  const r = await pump(3000, () => (A().__g('Game.finished') && B().__g('Game.finished')) || B().__snaps.length > 0, { maxMs: maxMs || 36000 });
  return r + ' ' + st() + ' resyncs=' + JSON.stringify(B().__snaps) + ' firstBad=' + firstBad() + ' round=' + A().__g('Game.round') + '/' + A().__g('Game.rounds');
};
