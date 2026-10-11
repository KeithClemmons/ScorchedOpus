'use strict';
/* Dev-only helpers for poking at the game from the console. Not loaded by index.html. */
window.quick = function (n, ai, o) {
  o = o || {};
  Game.players = [];
  for (let i = 0; i < n; i++) {
    const p = Game.newPlayer(i);
    p.ai = i === 0 && !o.allAI ? null : (Array.isArray(ai) ? ai[i % ai.length] : (ai || 'Spoiler'));
    p.name = i === 0 && !o.allAI ? 'Keith' : Game.computerName(p);
    p.icon = o.icon !== undefined ? o.icon : p.icon;
    Game.players.push(p);
  }
  Game.rounds = o.rounds || 10;
  Game.begin();
  return 'ok';
};
window.T = {
  me() { return Battle.tanks.find(t => t.p.idx === 0); },
  him() { return Battle.tanks.find(t => t.p.idx === 1); },
  give(idx) {
    const p = Game.players[idx || 0];
    for (const it of Data.items) if (it.id !== 'babyMissile') p.inv[it.id] = 20;
    p.fuel = 200; p.autoDefense = true;
    return 'given';
  },
  dir() { return this.him().x > this.me().x ? 1 : -1; },
  ang(a) { return this.dir() > 0 ? a : 180 - a; },
  aim(a) {
    const me = this.me(), him = this.him(), m = me.muzzle(0, a);
    return Math.round(Ballistics.solvePower(m, a, him.x, him.y - 2, 1000) || 0);
  },
  fire(w, a, pw, o) {
    const t = this.me();
    t.p.weapon = w; a = this.ang(a); t.angle = a;
    t.power = pw === undefined ? this.aim(a) : pw;
    Battle.cur = t; Battle.fire(t, o || {}); Battle.state = 'settle';
    return w + ' a=' + a + ' p=' + t.power;
  },
  freeze() {
    if (!this.u) { this.u = Battle.update.bind(Battle); Battle.update = dt => { if (!window.P) this.u(dt); }; }
    window.P = true; return 'frozen';
  },
  thaw() { window.P = false; return 'running'; },
  step(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) this.u(1 / 60); return this.info(); },
  until(fn, max) { let n = 0; while (!fn() && n++ < (max || 1200)) this.u(1 / 60); return n; },
  settle(max) { return this.until(() => Battle.settled(), max); },
  info() {
    return JSON.stringify({
      state: Battle.state, cur: Battle.cur && Battle.cur.p.name,
      ents: Battle.entities.map(e => e.constructor.name + (e.phase ? ':' + e.phase : '')),
      en: Battle.tanks.map(t => Math.round(t.energy) + (t.alive ? '' : 'x') + (t.shield ? 's' + Math.round(t.shield.energy) : ''))
    });
  }
};
// advance the whole app (input, dialogs, scene) without requestAnimationFrame
window.adv = function (sec) {
  const n = Math.max(1, Math.round(sec * 60));
  for (let i = 0; i < n; i++) App.step(1 / 60);
  Screen.ui.clear(0); App.scene.draw(); UI.draw(Screen.ui); Toast.draw(Screen.ui); Net.drawOverlay(Screen.ui); Screen.present();
  return (App.scene === BattleScene ? 'battle ' + Battle.state + ' cur=' + (Battle.cur && Battle.cur.p.name) : App.scene.constructor.name) + ' ui=' + UI.stack.length;
};
'testkit loaded';
// all-computer games across modes and settings; results collect in window.SOAK
window.soak = function (games, o) {
  o = o || {};
  const R = window.SOAK = { games: 0, rounds: 0, errors: [], stuck: [], running: true, cfg: [] };
  const modes = ['SEQUENTIAL', 'SYNCHRONOUS', 'SIMULTANEOUS'];
  const ais = ['Moron', 'Shooter', 'Poolshark', 'Tosser', 'Chooser', 'Spoiler', 'Cyborg', 'Unknown'];
  let simT = 0, g = 0, lastState = null, stateT = 0, quietT = 0;
  const saved = JSON.parse(JSON.stringify(Cfg));
  function newGame() {
    UI.clear();
    Cfg.mode = o.mode || modes[g % 3];
    Cfg.fastComputers = true; Cfg.sound = false;
    Cfg.cashAtStart = o.cash !== undefined ? o.cash : pick([0, 20000, 100000, 1000000]);
    Cfg.teams = o.teams || pick(['NONE', 'NONE', 'STANDARD', 'CORPORATE', 'VICIOUS']);
    Cfg.effectOfWalls = o.walls || pick(['NONE', 'CONCRETE', 'PADDED', 'RUBBER', 'SPRING', 'WRAP', 'RANDOM', 'ERRATIC']);
    Cfg.changingWind = chance(0.5); Cfg.tanksFall = chance(0.8); Cfg.armsLevel = irand(0, 4);
    Cfg.scoringMode = pick(['BASIC', 'STANDARD', 'GREEDY']); Cfg.sky = 'RANDOM';
    Cfg.graphicsMode = o.gm || pick(Data.graphicsModes); applyGraphicsMode();
    const n = o.n || irand(2, 8);
    R.cfg.push(Cfg.mode + ' n=' + n + ' $' + Cfg.cashAtStart + ' ' + Cfg.teams + ' ' + Cfg.effectOfWalls + ' ' + Cfg.graphicsMode);
    quick(n, ais, { allAI: true, rounds: o.rounds || 2 });
    simT = 0; g++;
  }
  function chunk() {
    const end = performance.now() + 150;
    try {
      while (performance.now() < end) {
        const sc = App.scene;
        if (sc instanceof StandingsScene) {
          if (sc.t > 0.5) { R.rounds++; if (sc.o.final) { R.games++; if (g >= games) { finish(); return; } newGame(); continue; } sc.key({}); simT = 0; }
        } else if (sc instanceof MainMenuScene) { newGame(); continue; }
        App.step(1 / 60); simT += 1 / 60;
        if (App.scene === BattleScene && Battle.state === lastState) stateT += 1 / 60; else { lastState = Battle.state; stateT = 0; }
        if (App.scene !== BattleScene || Battle.entities.length) quietT = 0; else quietT += 1 / 60;
        if (simT > (o.maxRound || 900) || (stateT > 90 && lastState !== 'play') || quietT > 60) {
          R.stuck.push(R.cfg[R.cfg.length - 1] + ' state=' + Battle.state + ' ' + T.info() + ' ' + JSON.stringify({
            ns: World.needsSettle(), deaths: Battle.deaths.length, dying: Battle.dyingNow, simT: Math.round(simT), stateT: Math.round(stateT),
            scene: App.scene === BattleScene ? 'battle' : App.scene.constructor.name, ui: UI.stack.length, t: Battle.t,
            sw: Battle.syncWait ? [...Battle.syncWait] : null, shots: Battle.syncShots && Battle.syncShots.length,
            ents: Battle.entities.map(e => [Math.round(e.x), Math.round(e.y), +(e.vx || 0).toFixed(1), +(e.vy || 0).toFixed(1), +(e.age || 0).toFixed(1)]),
            fall: Battle.tanks.filter(t => t.falling).map(t => [t.p.idx, Math.round(t.x), Math.round(t.y), t.alive])
          }));
          if (o.stopOnStuck) { finish(true); return; }
          Game.toMainMenu(); simT = 0;
        }
      }
    } catch (e) {
      R.errors.push(R.cfg[R.cfg.length - 1] + ' :: ' + (e && e.stack || e));
      try { Game.toMainMenu(); } catch (e2) { R.errors.push('menu: ' + e2); }
      if (R.errors.length > 5) { finish(); return; }
    }
    setTimeout(chunk, 0);
  }
  function finish(keep) { R.running = false; if (keep) return; Object.assign(Cfg, saved); applyGraphicsMode(); Game.toMainMenu(); }
  newGame();
  setTimeout(chunk, 0);
  return 'soaking';
};
// Remastered: step and draw a frame with whichever renderer is active (works with the page hidden)
window.adv2 = function (sec) {
  const n = Math.max(1, Math.round(sec * 60));
  for (let i = 0; i < n; i++) { App.last = performance.now(); App.step(1 / 60); }
  App.render(1 / 60);
  return App.scene === BattleScene ? 'battle ' + Battle.state : App.scene.constructor.name;
};
// show a magnified crop of the screen canvas on top of the page (for screenshots)
window.zoomShot = function (x, y, w, h, k) {
  let z = document.getElementById('zoomdbg');
  if (!z) { z = document.createElement('canvas'); z.id = 'zoomdbg'; z.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000'; document.body.appendChild(z); }
  const src = document.getElementById('screen');
  z.width = w * k; z.height = h * k;
  z.style.width = (w * k / devicePixelRatio) + 'px'; z.style.height = (h * k / devicePixelRatio) + 'px';
  const g = z.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, x, y, w, h, 0, 0, w * k, h * k);
  return 'zoom ' + z.width + 'x' + z.height;
};
window.unzoom = function () { const z = document.getElementById('zoomdbg'); if (z) z.remove(); return 'ok'; };
