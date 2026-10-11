'use strict';
/* =====================================================================
   Remastered sound: the same events as the PC-speaker set in sound.js,
   voiced with layered synthesis instead - filtered noise, sub-bass
   booms, a little reverb, and stereo placement by where things happen
   on the battlefield. Sound > Sound Style switches between the two.
   Nothing is loaded from files.
   ===================================================================== */

const SoundClassic = {};
for (const k of Object.keys(Sound)) if (typeof Sound[k] === 'function') SoundClassic[k] = Sound[k];

const SoundModern = {
  bus: null, verb: null, noise: null, brown: null, wind: null, windGain: null,
  setup() {
    const ctx = Sound.ctx;
    if (this.bus || !ctx) return !!this.bus;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    const master = ctx.createGain(); master.gain.value = 0.55;
    master.connect(comp); comp.connect(Volume.sfx());
    this.bus = master;
    // a small hall: decaying stereo noise as the impulse response
    const len = Math.floor(ctx.sampleRate * 1.9), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.32;
    conv.connect(vg); vg.connect(master);
    this.verb = conv;
    // noise sources
    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, n, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    Booms.warm(Cfg.boomStyle === 'ARCADE' ? 'ARCADE' : 'FILM');
    return true;
  },
  ok() { return Sound.ok() && this.setup(); },
  pan() {
    const x = Sound.px;
    Sound.px = null;
    if (x === null || x === undefined || !World.W) return 0;
    return clamp((x / World.W) * 2 - 1, -1, 1) * 0.75;
  },
  // an output with stereo placement and a reverb send
  out(vol, pan, wet) {
    const ctx = Sound.ctx, g = ctx.createGain();
    g.gain.value = vol;
    let node = g;
    if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(this.bus);
    if (wet) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(this.verb); }
    return g;
  },
  env(g, t, a, peak, dur, curve) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur * (curve || 1));
  },
  noiseHit(dest, t, dur, type, f0, f1, peak, q, brown) {
    const ctx = Sound.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = brown ? this.brown : this.noise; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = type; f.Q.value = q || 0.7;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, 0.004, peak, dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.1);
  },
  tone(dest, t, type, f0, f1, dur, peak, attack) {
    const ctx = Sound.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, attack || 0.005, peak, dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.1);
  },

  /* ---------------- the game's sound events ---------------- */
  beep(freq, dur, vol, when) {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime + (when || 0);
    this.tone(this.out(0.28 * (vol == null ? 1 : vol), this.pan(), 0.1), t, 'triangle', freq, freq, Math.max(0.03, dur), 1, 0.004);
  },
  seq(notes, vol) {
    let t = 0;
    const px = Sound.px;
    for (const [f, d] of notes) { if (f) { Sound.px = px; this.beep(f, d * 0.95, vol, t); } t += d; }
    Sound.px = null;
  },
  sweep(f0, f1, dur, vol, when) {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime + (when || 0);
    this.tone(this.out(0.22 * (vol == null ? 1 : vol), this.pan(), 0.15), t, 'sine', f0, f1, dur, 1, 0.01);
  },
  crunch(dur, fHi, fLo, vol, when) {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime + (when || 0);
    this.noiseHit(this.out(0.5 * (vol == null ? 1 : vol), this.pan(), 0.2), t, dur, 'lowpass', fHi * 2.5, Math.max(60, fLo), 1, 0.8);
  },
  click() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.16, 0, 0);
    this.tone(d, t, 'triangle', 2200, 1400, 0.025, 1, 0.001);
  },
  error() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.22, 0, 0.05);
    this.tone(d, t, 'triangle', 240, 200, 0.09, 1); this.tone(d, t + 0.1, 'triangle', 180, 150, 0.12, 1);
  },
  buy() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.2, 0, 0.25);
    this.tone(d, t, 'sine', 988, 988, 0.12, 1); this.tone(d, t + 0.07, 'sine', 1319, 1319, 0.2, 1);
    this.tone(d, t, 'triangle', 494, 494, 0.18, 0.4);
  },
  fire() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.6, this.pan(), 0.3);
    this.tone(d, t, 'sine', 140, 48, 0.22, 1, 0.003);
    this.noiseHit(d, t, 0.28, 'bandpass', 2200, 500, 0.8, 0.9);
  },
  // explosions play pre-rendered booms (see Booms below); tier 0 small .. 3 nuke
  boom(tier, level, pan) {
    const arcade = Cfg.boomStyle === 'ARCADE';
    const src = Sound.ctx.createBufferSource();
    src.buffer = Booms.get(arcade ? 'ARCADE' : 'FILM', tier);
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    let node = src;
    if (!arcade) {
      // a low shelf for extra weight
      const sh = Sound.ctx.createBiquadFilter();
      sh.type = 'lowshelf'; sh.frequency.value = 160; sh.gain.value = 6;
      src.connect(sh); node = sh;
    }
    node.connect(this.out(level, pan, arcade ? 0.04 : 0.1));
    src.start();
  },
  explosion(r) {
    if (!this.ok()) return;
    this.boom(r < 18 ? 0 : r < 45 ? 1 : 2, 0.95, this.pan());
  },
  nuke() {
    if (!this.ok()) return;
    this.boom(3, 1, this.pan());
  },
  bigBoom() {
    if (!this.ok()) return;
    this.boom(2, 0.9, this.pan());
  },
  laser() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.6, this.pan(), 0.35);
    this.tone(d, t, 'sawtooth', 2600, 420, 0.5, 0.6, 0.004);
    this.tone(d, t, 'square', 1300, 210, 0.5, 0.25, 0.004);
    this.noiseHit(d, t, 0.45, 'highpass', 5000, 2500, 0.35, 0.7);
  },
  plasma() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.65, this.pan(), 0.5);
    this.tone(d, t, 'sawtooth', 110, 1400, 0.6, 0.5, 0.02);
    this.tone(d, t, 'sine', 220, 2600, 0.6, 0.4, 0.02);
    this.noiseHit(d, t + 0.3, 0.5, 'bandpass', 3000, 600, 0.4, 2);
  },
  // a falling rock: a rushing whoosh and a whistle, both dropping as it comes down
  meteor() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.45, this.pan(), 0.25);
    this.noiseHit(d, t, 1.25, 'bandpass', 3000, 350, 0.7, 1.4);
    this.tone(d, t, 'sine', 1500, 260, 1.2, 0.18, 0.15);
  },
  thunder() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.9, this.pan(), 0.6);
    this.noiseHit(d, t, 0.25, 'highpass', 5000, 1800, 0.8, 0.7);
    this.noiseHit(d, t + 0.05, 2.6, 'lowpass', 700, 50, 1, 0.5, true);
  },
  zap() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.5, this.pan(), 0.25);
    const ctx = Sound.ctx, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 900;
    lfo.type = 'sawtooth'; lfo.frequency.value = 57; lg.gain.value = 700;
    lfo.connect(lg); lg.connect(o.frequency);
    this.env(g, t, 0.003, 0.7, 0.22);
    o.connect(g); g.connect(d);
    o.start(t); lfo.start(t); o.stop(t + 0.3); lfo.stop(t + 0.3);
    this.noiseHit(d, t, 0.2, 'highpass', 7000, 3000, 0.4, 0.7);
  },
  dirt() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.9, this.pan(), 0.25);
    this.noiseHit(d, t, 0.35, 'lowpass', 900, 120, 1, 0.8, true);
    this.noiseHit(d, t, 0.15, 'bandpass', 1400, 600, 0.35, 1.5);
  },
  sizzle() {
    if (!this.ok()) return;
    this.noiseHit(this.out(0.25, this.pan(), 0.1), Sound.ctx.currentTime, 0.2, 'highpass', 6000, 3500, 0.6, 0.7);
  },
  shieldHit() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.28, this.pan(), 0.4);
    for (const f of [1568, 2349, 3136]) this.tone(d, t, 'sine', f, f * 1.02, 0.35, 0.5, 0.002);
    this.noiseHit(d, t, 0.06, 'highpass', 8000, 5000, 0.5, 0.7);
  },
  bounce() {
    if (!this.ok()) return;
    this.tone(this.out(0.35, this.pan(), 0.15), Sound.ctx.currentTime, 'sine', 420, 240, 0.08, 1, 0.002);
  },
  parachute() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.8, this.pan(), 0.2);
    this.noiseHit(d, t, 0.45, 'bandpass', 1600, 350, 0.9, 1.5);
  },
  chopper() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.5, this.pan(), 0.2);
    for (let i = 0; i < 14; i++) this.noiseHit(d, t + i * 0.075, 0.06, 'lowpass', 500, 120, 0.9, 0.8, true);
  },
  roundOver() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.22, 0, 0.5);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { this.tone(d, t + i * 0.1, 'triangle', f, f, 0.6, 1, 0.01); this.tone(d, t + i * 0.1, 'sine', f * 2, f * 2, 0.4, 0.25, 0.01); });
  },
  gameOver() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.24, 0, 0.6);
    [392, 311.13, 261.63, 196].forEach((f, i) => this.tone(d, t + i * 0.2, 'triangle', f, f, 0.9, 1, 0.01));
  },
  charge() {
    if (!this.ok()) return;
    const t = Sound.ctx.currentTime, d = this.out(0.25, this.pan(), 0.3);
    this.tone(d, t, 'sine', 300, 1300, 0.3, 1, 0.01);
    this.tone(d, t, 'triangle', 600, 2600, 0.3, 0.3, 0.01);
  },
  // shells in flight: a soft whistle instead of the square wave
  flightSet(freq) {
    if (!this.ok() || Cfg.flightSounds === 'OFF') { this.flightStop(); return; }
    const ctx = Sound.ctx;
    if (!Sound.flight) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; g.gain.value = 0.0001;
      o.connect(g); g.connect(this.bus);
      o.start();
      g.gain.setTargetAtTime(0.05, ctx.currentTime, 0.05);
      Sound.flight = o; Sound.flightGain = g;
    }
    Sound.flight.frequency.setTargetAtTime(clamp(freq * 0.75, 60, 3000), ctx.currentTime, 0.03);
  },
  flightStop() {
    if (Sound.flight) {
      const o = Sound.flight, g = Sound.flightGain;
      Sound.flight = null; Sound.flightGain = null;
      try { g.gain.setTargetAtTime(0.0001, Sound.ctx.currentTime, 0.04); o.stop(Sound.ctx.currentTime + 0.25); } catch (e) { try { o.stop(); } catch (e2) { /* ignore */ } }
    }
  },
  // wind over the battlefield, louder in a gale
  ambience(level) {
    if (!this.ok()) { this.ambienceStop(); return; }
    const ctx = Sound.ctx;
    if (!this.wind) {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.brown; src.loop = true;
      f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 0.8;
      g.gain.value = 0.0001;
      src.connect(f); f.connect(g); g.connect(this.bus);
      src.start();
      this.wind = src; this.windGain = g; this.windFilter = f;
    }
    const tt = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.008 + 0.06 * clamp(level, 0, 1), tt, 0.6);
    this.windFilter.frequency.setTargetAtTime(300 + 900 * clamp(level, 0, 1) + Math.sin(tt * 0.7) * 120, tt, 0.5);
  },
  ambienceStop() {
    if (this.wind) {
      const w = this.wind, g = this.windGain;
      this.wind = null;
      try { g.gain.setTargetAtTime(0.0001, Sound.ctx.currentTime, 0.2); w.stop(Sound.ctx.currentTime + 1); } catch (e) { /* ignore */ }
    }
  }
};

/* =====================================================================
   Booms: explosions computed sample by sample into buffers (three takes
   per size, made the first time each is needed) rather than patched
   together from oscillators and filters - smooth noise and exact
   envelopes, so nothing rings or sounds metallic. Sound > Explosions:
     FILM    a deep blast: a punchy crack of noise that darkens fast, a
             low thump, a rolling rumble and a scatter of debris crackle
     ARCADE  the 8-bit kind: a 15-bit noise register whose clock and
             volume step down together, as on the NES noise channel
   ===================================================================== */
const Booms = {
  cache: {},
  // render every take ahead of time, one per idle moment, so no battle hitches on the first blast
  warm(style) {
    let n = 0;
    const next = () => {
      const tier = n % 4;
      if (n++ >= 12 || !Sound.ctx) return;
      const list = this.cache[style + tier] || (this.cache[style + tier] = []);
      if (list.length < 3) list.push(style === 'ARCADE' ? this.arcade(tier) : this.film(tier));
      setTimeout(next, 60);
    };
    setTimeout(next, 200);
  },
  get(style, tier) {
    const list = this.cache[style + tier] || (this.cache[style + tier] = []);
    if (list.length < 3) { list.push(style === 'ARCADE' ? this.arcade(tier) : this.film(tier)); return list[list.length - 1]; }
    return list[Math.floor(Math.random() * list.length)];
  },
  // soft-clip for punch, normalize, fade the very end
  finish(buf, peakTo, drive) {
    const chans = [];
    let peak = 1e-6;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); chans.push(d); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
    const k = Math.tanh(drive), fade = Math.floor(buf.sampleRate * 0.05);
    for (const d of chans) {
      for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] / peak * drive) / k * peakTo;
      for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
    }
    return buf;
  },
  film(tier) {
    const ctx = Sound.ctx, sr = ctx.sampleRate, k = [0.45, 0.8, 1.25, 2.3][tier];
    const len = Math.floor(sr * (0.9 + k * 1.1)), buf = ctx.createBuffer(2, len, sr);
    const tauPunch = 0.04 + 0.02 * k, tauBody = 0.16 + 0.2 * k, tauTail = 0.3 + 0.55 * k, tauBright = 0.03 + 0.02 * k;
    const f0 = 50 - k * 7 + Math.random() * 6;    // the thump's pitch, lower for bigger blasts
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let l1 = 0, l2 = 0, br = 0, rl = 0, ph = 0, crack = 0, prev = 0;
      const ra = 1 - Math.exp(-2 * Math.PI * 150 / sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr, w = Math.random() * 2 - 1;
        // the blast: noise through a two-pole lowpass that closes from bright to dull
        const fc = 90 + 2000 * Math.exp(-t / tauBright) + 250 * Math.exp(-t / tauBody);
        const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
        l1 += a * (w - l1); l2 += a * (l1 - l2);
        const envB = Math.min(1, t / 0.002) * (0.55 * Math.exp(-t / tauPunch) + 0.45 * Math.exp(-t / tauBody));
        // the rumble: brown noise, slower to rise and slower to go
        br = br * 0.997 + 0.02 * w; rl += ra * (br - rl);
        const envR = (1 - Math.exp(-t / 0.03)) * Math.exp(-t / tauTail);
        // the thump: a low sine that drops into place (starting high enough for small speakers to feel)
        ph += 2 * Math.PI * f0 * (1 + 1.8 * Math.exp(-t / 0.03)) / sr;
        const thump = Math.sin(ph) * Math.min(1, t / 0.003) * Math.exp(-t / (0.16 + 0.1 * k));
        // debris: sparse crackles that thin out
        if (t > 0.015 && Math.random() < 700 * Math.exp(-t / (0.12 + 0.18 * k)) / sr) crack = 0.3 + Math.random() * 0.7;
        crack *= 0.9965;
        const tick = (w - prev) * crack * Math.exp(-t / tauTail); prev = w;
        d[i] = l2 * envB * 2.0 + rl * envR * 4.5 + thump * 0.95 + tick * 0.1;
      }
    }
    return this.finish(buf, 0.9, 1.2);
  },
  arcade(tier) {
    const ctx = Sound.ctx, sr = ctx.sampleRate, k = [0.5, 0.8, 1.2, 2.2][tier];
    const dur = 0.4 + 0.45 * k, len = Math.floor(sr * dur), buf = ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let lfsr = 1, out = 1, acc = 0, lp = 0;
    const la = 1 - Math.exp(-2 * Math.PI * 6000 / sr);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      // both the noise clock and the volume move in steps, like the hardware
      const clock = 9000 * Math.pow(0.07, Math.floor(p * 14) / 14);
      const vol = Math.ceil(15 * Math.pow(1 - p, 1.4)) / 15;
      acc += clock / sr;
      while (acc >= 1) { acc -= 1; const bit = (lfsr ^ (lfsr >> 1)) & 1; lfsr = (lfsr >> 1) | (bit << 14); out = lfsr & 1 ? 1 : -1; }
      lp += la * (out * vol - lp);
      L[i] = R[i] = lp;
    }
    return this.finish(buf, 0.75, 1);
  }
};

// every sound event goes to whichever style is selected
Sound.px = null;
Sound.pos = function (x) { this.px = x; return this; };
Sound.modernOn = function () { return Cfg.soundStyle !== 'CLASSIC'; };
for (const k of Object.keys(SoundClassic)) {
  if (['unlock', 'ok'].includes(k)) continue;
  Sound[k] = function (...a) {
    if (this.modernOn() && SoundModern[k]) return SoundModern[k](...a);
    this.px = null;
    return SoundClassic[k].apply(this, a);
  };
}
Sound.ambience = function (level) { if (this.modernOn() && Cfg.windSound && App.scene === BattleScene) SoundModern.ambience(level); else SoundModern.ambienceStop(); };
