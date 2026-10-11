'use strict';
/* =====================================================================
   Music (Remastered): a light score synthesized as it plays. Nothing is
   loaded from files: one piece (a desert march in D minor) is written a
   bar at a time from its chord progression by a handful of parts - pad,
   bass, snare, timpani, marimba, shaker, a distant bugle - with a little
   chance in the details so it doesn't loop note for note. The music
   never restarts between screens; each screen only changes the mix:
     menus   - the full march, snare cadences and bugle calls
     battle  - thinned right down: pad, scattered notes, a quiet pulse
     shop    - brushes, oom-pah bass and a wandering marimba tune
   Music uses Math.random, never the simulation's generator, so network
   games stay in step. Sound > Sound Style CLASSIC plays it on square
   waves, like a PC speaker that learned to count.

   Also here: the on-screen volume control (music / effects), drawn over
   every screen in the bottom-right corner.
   ===================================================================== */

const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);
const CHORD_Q = { M: [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], sus: [0, 5, 7] };
// "D m" -> { root pitch class, intervals }
function chordOf(sym) {
  const [r, q] = sym.split(' ');
  const pc = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 }[r];
  return { pc, iv: CHORD_Q[q || 'M'] };
}
// chord tones inside [lo, hi), ascending
function chordTones(ch, lo, hi) {
  const out = [];
  for (let n = lo; n < hi; n++) if (ch.iv.some(i => (n - ch.pc - i) % 12 === 0)) out.push(n);
  return out;
}
// the chord's root inside [lo, lo + 12)
function rootIn(ch, lo) { let n = lo + ((ch.pc - lo) % 12 + 12) % 12; return n; }

// One score plays for the whole game; screens change the arrangement,
// never the song, so the music carries on from menu to battle to shop.
const MUSIC_SCORE = {
  bpm: 92,
  // A: the D minor march; B: a turn to the relative major and back
  prog: ['D m', 'Bb', 'C', 'D m', 'D m', 'Bb', 'G m', 'A 7', 'F', 'C', 'D m', 'Bb', 'G m', 'C', 'F', 'A 7']
};
// how loud each part is on each kind of screen (they fade over a couple of seconds)
const MUSIC_MIX = {
  menu: { pad: 1, bass: 1, drums: 1, timp: 1, arp: 1, bugle: 1, shaker: 0.35, tune: 0 },
  battle: { pad: 0.6, bass: 0.55, drums: 0.3, timp: 0.55, arp: 0.5, bugle: 0.3, shaker: 0.6, tune: 0 },
  shop: { pad: 0.45, bass: 0.9, drums: 0.7, timp: 0.2, arp: 0.3, bugle: 0, shaker: 1, tune: 0.9 }
};
const MUSIC_PARTS = Object.keys(MUSIC_MIX.menu);

const Music = {
  bus: null, dry: null, wet: null, verb: null, noise: null, parts: null,
  style: 'menu', bar: 0, nextT: 0, playing: false, mel: null, part: 'pad', level: {},
  chip() { return Cfg.soundStyle === 'CLASSIC'; },

  setup() {
    const ctx = Sound.ctx;
    if (this.bus || !ctx) return !!this.bus;
    this.bus = ctx.createGain(); this.bus.gain.value = 0;
    this.bus.connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.bus);
    this.wet = ctx.createGain();
    // a wide, soft hall
    const len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1);
    }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.5;
    this.wet.connect(this.verb); this.verb.connect(vg); vg.connect(this.bus);
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // a fader per part (its dry signal and reverb send move together)
    this.parts = {};
    for (const k of MUSIC_PARTS) {
      const pd = ctx.createGain(), pw = ctx.createGain(), v = MUSIC_MIX[this.style][k];
      pd.gain.value = v; pw.gain.value = v;
      pd.connect(this.dry); pw.connect(this.wet);
      this.parts[k] = { dry: pd, wet: pw };
      this.level[k] = v;
    }
    return true;
  },
  // which arrangement fits the screen we're on
  want() {
    if (App.scene === BattleScene) return 'battle';
    if (typeof ShopScene !== 'undefined' && App.scene instanceof ShopScene) return 'shop';
    return 'menu';
  },
  audible() { return Cfg.sound && Sound.ctx && Sound.ctx.state === 'running' && Cfg.musicVolume > 0; },

  // every frame: follow the volume and the screen, write the bars coming up
  update() {
    Volume.apply();
    if (!this.audible()) { this.playing = false; return; }
    if (!this.setup()) return;
    if (Sound.modernOn() && Cfg.sound) SoundModern.setup();   // (starts rendering the explosions early)
    const ctx = Sound.ctx, now = ctx.currentTime, want = this.want();
    if (want !== this.style) {
      this.style = want;
      for (const k of MUSIC_PARTS) {
        const v = MUSIC_MIX[want][k];
        this.level[k] = v;
        this.parts[k].dry.gain.setTargetAtTime(v, now, 0.8);
        this.parts[k].wet.gain.setTargetAtTime(v, now, 0.8);
      }
    }
    // (re)starting, or the tab slept: carry on from here, same place in the song
    if (!this.playing || this.nextT < now - 0.25) { this.playing = true; this.nextT = now + 0.08; }
    while (this.nextT < now + 0.35) this.writeBar();
  },
  // pick the part the next notes belong to; false when it's faded right out
  on(part) { this.part = part; return this.level[part] > 0.02; },
  sw(s) { return this.style === 'shop' && s % 4 === 2 ? s + 0.35 : s; },
  writeBar() {
    const st = 60 / MUSIC_SCORE.bpm / 4, b = this.bar, t = this.nextT, P = MUSIC_SCORE.prog;
    const ch = chordOf(P[b % P.length]), next = chordOf(P[(b + 1) % P.length]);
    try { this.arrange(b, ch, next, t, st); } catch (e) { console.error(e); }
    this.bar++;
    this.nextT += st * 16;
  },
  arrange(b, ch, next, t, st) {
    const style = this.style, cyc = b % 8, r = rootIn(ch, 33);
    if (this.on('pad')) this.pad(t, chordTones(ch, style === 'battle' ? 52 : 57, style === 'battle' ? 66 : 70).slice(0, 4), st * 16, 0.05, style === 'battle' ? 700 : 1100);
    // bass: root and fifth; in the shop an oom-pah that walks into the next chord
    if (this.on('bass')) {
      if (style === 'shop') {
        this.bass(t, r + 12, 0.18, st * 3, true);
        this.bass(t + st * 8, r + 7, 0.15, st * 3, true);
        if (chance(0.6)) this.bass(t + st * 14, rootIn(next, 33) + 12 + (chance(0.5) ? -1 : 1), 0.1, st * 1.5, true);
      } else {
        this.bass(t, r, 0.2, st * 5);
        if (style !== 'battle' || chance(0.5)) this.bass(t + st * 8, r + 7, 0.15, st * 4);
        if (style === 'menu' && chance(0.5)) this.bass(t + st * 14, r + (chance(0.5) ? 12 : 10), 0.1, st * 2);
      }
    }
    // drums: a march backbeat and ghost notes (brushes in the shop, only ghosts in battle)
    if (this.on('drums')) {
      for (let s = 0; s < 16; s++) {
        if ((s === 4 || s === 12) && style !== 'battle') this.snare(t + s * st, style === 'shop' ? 0.14 : 0.3, style === 'shop');
        else if ([2, 3, 6, 10, 11, 14].includes(s) && chance(style === 'battle' ? 0.25 : 0.35)) this.snare(t + this.sw(s) * st, 0.08, style === 'shop');
      }
      if (b % 4 === 3 && style !== 'shop') for (let s = 0; s < 8; s++) this.snare(t + (12 + s / 2) * st, 0.07 + s * 0.025);
    }
    if (this.on('timp')) {
      if (b % 4 === 0) this.timp(t, r + 12, 0.45);
      if (cyc === 7) this.timp(t + st * 12, r + 19, 0.3);
    }
    if (this.on('shaker')) for (let s = 0; s < 16; s += 2) if (chance(0.75)) this.tick(t + this.sw(s) * st, s % 4 === 0 ? 0.035 : 0.022);
    // marimba: arpeggios, chord stabs in the shop, a few scattered notes under a battle
    if (this.on('arp')) {
      if (style === 'battle') {
        const hi = chordTones(ch, 69, 88);
        for (let s = 0; s < 16; s += 2) if (chance(0.22)) this.mallet(t + s * st, pick(hi), 0.07, 1.2);
      } else if (style === 'shop') {
        const stab = chordTones(ch, 60, 72).slice(0, 3);
        for (const s of [4, 12]) for (const n of stab) this.mallet(t + s * st, n, 0.05, 0.25);
      } else {
        const arp = chordTones(ch, 62, 82), up = b % 2 === 0;
        for (let s = 0; s < 16; s += 2) {
          if (!chance(0.8)) continue;
          const i = up ? (s / 2) % arp.length : arp.length - 1 - (s / 2) % arp.length;
          this.mallet(t + s * st, arp[i], s % 4 === 0 ? 0.11 : 0.07);
        }
      }
    }
    // the shop's tune: steps around the chord tones, with a breath every other bar
    if (this.on('tune')) {
      const tones = chordTones(ch, 67, 86);
      let n = this.mel && tones.includes(this.mel) ? this.mel : pick(tones);
      for (let s = 0; s < 16; s += 2) {
        if (b % 2 === 1 && s >= 10) break;
        if (!chance(s % 4 === 0 ? 0.8 : 0.5)) continue;
        const i = tones.indexOf(n);
        n = tones[clamp(i + pick([-1, 1, 1, -2, 2, 0]), 0, tones.length - 1)];
        this.mallet(t + this.sw(s) * st, n, s % 4 === 0 ? 0.12 : 0.08);
      }
      this.mel = n;
    }
    // bugle calls, far off: twice every eight bars
    if (this.on('bugle') && (cyc === 2 || cyc === 6)) this.bugleCall(t, st, ch, cyc === 6);
  },

  /* ------------------------------------------------ instruments */
  // a voice: gain node into the dry bus, with some sent to the hall
  out(level, wet) {
    const ctx = Sound.ctx, g = ctx.createGain(), p = this.parts[this.part];
    g.gain.value = level;
    g.connect(p.dry);
    if (wet && !this.chip()) { const s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(p.wet); }
    return g;
  },
  osc(type, f, t, end, dest, detune) {
    const o = Sound.ctx.createOscillator();
    o.type = this.chip() && type !== 'sine' ? 'square' : type;
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(end + 0.05);
    return o;
  },
  env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (hold) g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + (hold || 0) + rel);
  },
  pad(t, notes, dur, level, cutoff) {
    const ctx = Sound.ctx, f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 0.5;
    f.frequency.setValueAtTime(cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(cutoff * 0.7, t + dur);
    f.connect(g); g.connect(this.out(1, 0.6));
    const lv = level * (this.chip() ? 0.35 : 1) / Math.max(1, notes.length) * 2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(lv, t + Math.min(0.8, dur * 0.3));
    g.gain.setValueAtTime(lv, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.9);
    for (const n of notes) {
      this.osc('sawtooth', midiHz(n), t, t + dur + 1, f, -7);
      if (!this.chip()) this.osc('triangle', midiHz(n), t, t + dur + 1, f, 6);
    }
  },
  bass(t, n, vel, dur, pluck) {
    const ctx = Sound.ctx, f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = pluck ? 900 : 500; f.Q.value = 0.9;
    f.connect(g); g.connect(this.out(1, 0.12));
    this.env(g, t, 0.008, vel, pluck ? 0 : dur * 0.3, pluck ? 0.35 : dur * 0.8);
    this.osc('triangle', midiHz(n), t, t + dur + 0.4, f);
    if (!this.chip()) this.osc('sine', midiHz(n - 12), t, t + dur + 0.4, f);
  },
  // marimba: a sine with a fast-fading bright overtone
  mallet(t, n, vel, decay) {
    const ctx = Sound.ctx, d = this.out(1, 0.35), g = ctx.createGain(), g2 = ctx.createGain();
    decay = decay || 0.7;
    g.connect(d); g2.connect(d);
    this.env(g, t, 0.004, vel, 0, decay);
    this.env(g2, t, 0.002, vel * 0.35, 0, decay * 0.18);
    this.osc(this.chip() ? 'square' : 'sine', midiHz(n), t, t + decay + 0.1, g);
    if (!this.chip()) this.osc('sine', midiHz(n) * 3.98, t, t + decay * 0.3, g2);
  },
  // a bugle across the dunes: soft brass with a scoop and late vibrato
  bugle(t, n, vel, dur) {
    const ctx = Sound.ctx, f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(2100, t + 0.06);
    f.frequency.linearRampToValueAtTime(1300, t + dur);
    f.connect(g); g.connect(this.out(1, 0.9));
    this.env(g, t, 0.04, vel * (this.chip() ? 0.5 : 1), dur * 0.7, dur * 0.4 + 0.15);
    const o = this.osc('sawtooth', midiHz(n), t, t + dur + 0.5, f);
    o.detune.setValueAtTime(-35, t); o.detune.linearRampToValueAtTime(0, t + 0.07);
    if (dur > 0.3) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + dur);
      l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t + dur + 0.5);
    }
  },
  // a call built on the chord's bugle notes (root, fifth, octave, tenth)
  bugleCall(t, st, ch, answer) {
    const r = rootIn(ch, 62), deg = [r - 5, r, r + (ch.iv[1] || 4), r + 7, r + 12];
    const calls = [
      [[0, 1, 3], [3, 1, 1], [4, 2, 2], [6, 3, 6], [14, 1, 2]],
      [[0, 3, 2], [2, 3, 1], [3, 3, 1], [4, 4, 4], [8, 2, 4], [12, 1, 4]],
      [[0, 1, 1], [1, 2, 1], [2, 3, 2], [4, 4, 3], [7, 3, 1], [8, 1, 8]],
      [[0, 0, 2], [2, 1, 2], [4, 2, 2], [6, 3, 6], [12, 2, 4]]
    ];
    const c = answer ? pick(calls.slice(2)) : pick(calls.slice(0, 2));
    for (const [s, d, len] of c) this.bugle(t + s * st, deg[d], 0.07, len * st * 0.95);
  },
  snare(t, vel, brush) {
    const ctx = Sound.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    f.type = 'bandpass'; f.frequency.value = brush ? 3200 : 2400; f.Q.value = brush ? 0.5 : 0.8;
    src.connect(f); f.connect(g); g.connect(this.out(1, 0.25));
    this.env(g, t, 0.002, vel * 0.6, 0, brush ? 0.16 : 0.1);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.3);
    if (!brush && vel > 0.15) {
      const b = ctx.createGain(); b.connect(this.out(1, 0.1));
      this.env(b, t, 0.002, vel * 0.25, 0, 0.07);
      const o = this.osc('triangle', 190, t, t + 0.12, b);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    }
  },
  tick(t, vel) {
    const ctx = Sound.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = 'highpass'; f.frequency.value = 7000;
    src.connect(f); f.connect(g); g.connect(this.out(1, 0.15));
    this.env(g, t, 0.002, vel, 0, 0.04);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.1);
  },
  // distant artillery drum
  timp(t, n, vel) {
    const ctx = Sound.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 400;
    f.connect(g); g.connect(this.out(1, 0.5));
    this.env(g, t, 0.006, vel * 0.7, 0, 1.4);
    const o = this.osc('sine', midiHz(n) * 1.06, t, t + 1.6, f);
    o.frequency.exponentialRampToValueAtTime(midiHz(n), t + 0.12);
    this.osc('sine', midiHz(n) * 1.5, t, t + 0.6, f);
  }
};

/* =====================================================================
   Volume: music and effects levels (0-100, kept with the settings but
   saved straight away and never sent to other players), and the little
   control in the bottom-right corner: click or drag a bar to set it,
   click the icon to mute / unmute.
   ===================================================================== */
const Volume = {
  sfxNode: null, musicLevel: -1, sfxLevel: -1,
  drag: null, hover: false, rects: [], last: { music: 60, sfx: 100 },
  gain(v, max) { return Math.pow(clamp(v, 0, 100) / 100, 1.7) * max; },
  // push the current levels into the mixer when they change
  apply() {
    const ctx = Sound.ctx;
    if (!ctx) return;
    if (this.sfxNode && this.sfxLevel !== Cfg.sfxVolume) {
      this.sfxLevel = Cfg.sfxVolume;
      this.sfxNode.gain.setTargetAtTime(this.gain(Cfg.sfxVolume, 1), ctx.currentTime, 0.03);
    }
    if (Music.bus && this.musicLevel !== Cfg.musicVolume) {
      this.musicLevel = Cfg.musicVolume;
      Music.bus.gain.setTargetAtTime(this.gain(Cfg.musicVolume, 0.6), ctx.currentTime, 0.05);
    }
  },
  // the node every sound effect passes through (both sound styles)
  sfx() {
    const ctx = Sound.ctx;
    if (!this.sfxNode) {
      this.sfxNode = ctx.createGain();
      this.sfxNode.gain.value = this.gain(Cfg.sfxVolume, 1);
      this.sfxLevel = Cfg.sfxVolume;
      this.sfxNode.connect(ctx.destination);
    }
    return this.sfxNode;
  },
  set(which, v) {
    const k = which === 'music' ? 'musicVolume' : 'sfxVolume';
    v = Math.round(clamp(v, 0, 100));
    if (Cfg[k] === v) return;
    Cfg[k] = v;
    if (v > 0) this.last[which] = v;
    this.save();
  },
  save() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => Store.set('scorch.cfg', Object.assign({}, Store.get('scorch.cfg', {}), { musicVolume: Cfg.musicVolume, sfxVolume: Cfg.sfxVolume })), 300);
  },
  toggle(which) {
    const k = which === 'music' ? 'musicVolume' : 'sfxVolume';
    if (Cfg[k] > 0) { this.last[which] = Cfg[k]; this.set(which, 0); }
    else this.set(which, this.last[which] || (which === 'music' ? 60 : 100));
    if (which === 'sfx') Sound.click();
  },

  /* ------------------------------------------------ the on-screen control */
  // rectangles in canvas pixels (Remastered) or UI units (classic)
  layout() {
    const rows = [], modern = Gfx.modern;
    let x, y, s, w, pad;
    if (modern) {
      const d = Gfx.dpr;
      const coarse = (typeof Hud !== 'undefined' && Hud.touch) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
      s = Math.round(clamp(Math.min(Gfx.cw, Gfx.ch) * 0.03, (coarse ? 22 : 15) * d, (coarse ? 28 : 22) * d));   // finger-sized on phones
      w = Math.round(s * 5.6); pad = Math.round(s * 0.35);
      x = Gfx.cw - w - Math.round(8 * d);
      y = Gfx.ch - (s * 2 + pad * 2) - Math.round(8 * d);
      // keep clear of the touch buttons in battle
      if (App.scene === BattleScene && typeof Hud !== 'undefined' && Hud.touchOn() && Hud.btns.length) {
        const top = Math.min(...Hud.btns.filter(b => b.x + b.w > x).map(b => b.y));
        if (isFinite(top)) y = Math.min(y, top - (s * 2 + pad * 2) - Math.round(8 * d));
      }
    } else {
      s = 8; w = 58; pad = 2;
      x = Screen.UW - w - 2; y = Screen.UH - (s * 2 + pad * 2) - 2;
    }
    const box = { x, y, w, h: s * 2 + pad * 2 };
    for (const [i, which] of ['music', 'sfx'].entries()) {
      const ry = y + pad + i * s;
      const icon = { x: x + pad, y: ry, w: s, h: s };
      const bx = icon.x + s + pad, bw = w - (bx - x) - pad - (modern ? s * 1.5 : 0);
      rows.push({ which, icon, bar: { x: bx, y: ry, w: bw, h: s } });
    }
    return { box, rows, s, modern };
  },
  // the pointer in the same units as layout()
  at(ux, uy) { return Gfx.modern ? { x: Gfx.UXp(ux), y: Gfx.UYp(uy) } : { x: ux, y: uy }; },
  inside(r, p) { return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; },
  // mouse events come here first; true = handled
  mouse(ev) {
    if (Cfg.pointer === 'None' || !this.L) return false;
    const p = this.at(ev.ux, ev.uy);
    if (ev.kind === 'up' && this.drag) { this.drag = null; return true; }
    if ((ev.kind !== 'down' && ev.kind !== 'dbl') || ev.button) return false;
    if (!this.inside(this.L.box, p)) return false;
    if (ev.kind === 'dbl') return true;
    for (const r of this.L.rows) {
      if (this.inside(r.icon, p)) { this.toggle(r.which); return true; }
      const hit = { x: r.bar.x - r.bar.h * 0.4, y: r.bar.y, w: r.bar.w + r.bar.h * 0.8, h: r.bar.h };
      if (this.inside(hit, p)) { this.drag = r.which; this.dragTo(p); return true; }
    }
    return true;
  },
  dragTo(p) {
    const r = this.L.rows.find(q => q.which === this.drag);
    if (r) this.set(this.drag, Math.round((p.x - r.bar.x) / r.bar.w * 20) * 5);
  },
  update() {
    if (!this.L) return;
    const p = this.at(Input.ux, Input.uy);
    this.hover = !!this.drag || (Input.inside !== false && this.inside(this.L.box, p));
    if (this.drag) { if (Input.buttons & 1) this.dragTo(p); else this.drag = null; }
  },
  draw() {
    this.L = this.layout();
    if (this.L.modern) this.drawModern(Gfx.ctx, this.L);
    else this.drawClassic(Screen.ui, this.L);
  },
  drawModern(ctx, L) {
    const d = Gfx.dpr, { box, s } = L;
    const quiet = App.scene === BattleScene && !this.hover;
    ctx.save();
    ctx.globalAlpha = quiet ? 0.55 : 1;
    Hud.pill(ctx, box.x, box.y, box.w, box.h, { fill: 'rgba(9,12,21,0.72)', edge: this.hover ? 'rgba(255,182,64,0.45)' : 'rgba(170,190,235,0.16)' });
    for (const r of L.rows) {
      const v = r.which === 'music' ? Cfg.musicVolume : Cfg.sfxVolume, on = v > 0 && Cfg.sound;
      const col = on ? '#e6eaf2' : 'rgba(150,160,185,0.6)';
      this.glyph(ctx, r.which, r.icon, col, v > 0);
      // the bar: a track, the level, a knob
      const b = r.bar, cy = b.y + b.h / 2, th = Math.max(2 * d, b.h * 0.2), f = v / 100;
      VUI.rr.call({ ctx }, b.x, cy - th / 2, b.w, th, th / 2); ctx.fillStyle = 'rgba(160,175,210,0.22)'; ctx.fill();
      if (f > 0) { VUI.rr.call({ ctx }, b.x, cy - th / 2, b.w * f, th, th / 2); ctx.fillStyle = on ? (r.which === 'music' ? '#6ac2ff' : '#ffb640') : 'rgba(150,160,185,0.5)'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(b.x + b.w * f, cy, b.h * (this.drag === r.which ? 0.34 : 0.27), 0, Math.PI * 2);
      ctx.fillStyle = on ? '#f4f6fb' : 'rgba(170,180,200,0.8)'; ctx.fill();
      Hud.txt(ctx, String(v), b.x + b.w + s * 1.45, cy, s * 0.52, col, { align: 'right', weight: 600 });
    }
    ctx.restore();
  },
  // a music note or a speaker, crossed out when muted
  glyph(ctx, which, r, col, on) {
    const x = r.x, y = r.y, s = r.w;
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, s * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (which === 'music') {
      // two beamed eighth notes
      ctx.beginPath(); ctx.ellipse(x + s * 0.3, y + s * 0.72, s * 0.14, s * 0.1, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + s * 0.72, y + s * 0.62, s * 0.14, s * 0.1, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 0.42, y + s * 0.7); ctx.lineTo(x + s * 0.42, y + s * 0.24); ctx.lineTo(x + s * 0.84, y + s * 0.14); ctx.lineTo(x + s * 0.84, y + s * 0.6); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.12, y + s * 0.38); ctx.lineTo(x + s * 0.3, y + s * 0.38); ctx.lineTo(x + s * 0.52, y + s * 0.18);
      ctx.lineTo(x + s * 0.52, y + s * 0.82); ctx.lineTo(x + s * 0.3, y + s * 0.62); ctx.lineTo(x + s * 0.12, y + s * 0.62); ctx.closePath(); ctx.fill();
      if (on) { ctx.beginPath(); ctx.arc(x + s * 0.56, y + s * 0.5, s * 0.22, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(x + s * 0.56, y + s * 0.5, s * 0.38, -0.9, 0.9); ctx.stroke(); }
    }
    if (!on) { ctx.strokeStyle = '#ff6060'; ctx.beginPath(); ctx.moveTo(x + s * 0.1, y + s * 0.9); ctx.lineTo(x + s * 0.92, y + s * 0.1); ctx.stroke(); }
  },
  drawClassic(u, L) {
    u.fillRect(L.box.x, L.box.y, L.box.w, L.box.h, UIC.face);
    u.rect(L.box.x, L.box.y, L.box.w, L.box.h, this.hover ? UIC.hi : UIC.lo);
    for (const r of L.rows) {
      const v = r.which === 'music' ? Cfg.musicVolume : Cfg.sfxVolume;
      Font.draw(u, r.which === 'music' ? 'M' : 'S', r.icon.x + 1, r.icon.y, v > 0 ? UIC.text : UIC.dis);
      const b = r.bar, n = Math.round(b.w * v / 100);
      u.fillRect(b.x, b.y + 2, b.w, 4, UIC.lo);
      if (n > 0) u.fillRect(b.x, b.y + 2, n, 4, r.which === 'music' ? UIC.wind : UIC.yellow);
    }
  }
};
