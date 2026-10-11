'use strict';
/* =====================================================================
   PC-speaker style sound: square waves and "random square" crunches.
   ===================================================================== */

const Sound = {
  ctx: null, out: null, flight: null, flightGain: null,
  muted: false,   // set while a network peer fast-forwards to catch up

  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.12;
        this.out.connect(Volume.sfx());   // effects volume (music.js)
      } catch (e) { this.ctx = null; return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  ok() { return Cfg.sound && !this.muted && this.ctx && this.ctx.state === 'running'; },

  beep(freq, dur, vol, when) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol == null ? 1 : vol, t);
    g.gain.setValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.02);
  },
  seq(notes, vol) {
    let t = 0;
    for (const [f, d] of notes) { if (f) this.beep(f, d * 0.95, vol, t); t += d; }
  },
  sweep(f0, f1, dur, vol, when) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol == null ? 1 : vol, t);
    g.gain.setValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.02);
  },
  // random-frequency square wave: the classic PC speaker explosion
  crunch(dur, fHi, fLo, vol, when) {
    if (!this.ok()) return;
    const sr = this.ctx.sampleRate, n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    let i = 0, v = 1;
    while (i < n) {
      const p = i / n;
      const hi = fHi * (1 - p * 0.7), lo = Math.max(20, fLo * (1 - p * 0.8));
      const f = lo + Math.random() * (hi - lo);
      const half = Math.max(1, Math.floor(sr / (2 * f)));
      for (let k = 0; k < half && i < n; k++) d[i++] = v;
      v = -v;
    }
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf;
    const t = this.ctx.currentTime + (when || 0);
    g.gain.setValueAtTime(vol == null ? 1 : vol, t);
    g.gain.linearRampToValueAtTime(0.0, t + dur);
    src.connect(g); g.connect(this.out);
    src.start(t);
  },

  click() { this.beep(1200, 0.012, 0.5); },
  error() { this.beep(220, 0.12, 0.8); },
  buy() { this.seq([[880, 0.04], [1320, 0.05]], 0.6); },
  fire() { this.sweep(900, 120, 0.12, 0.8); },
  explosion(r) {
    const dur = clamp(0.25 + r / 60, 0.25, 1.6);
    this.crunch(dur, 900, 120, 1);
  },
  nuke(r) { this.crunch(clamp(0.8 + r / 50, 1, 2.4), 700, 60, 1); },
  bigBoom() { this.crunch(1.2, 600, 50, 1); },
  laser() { this.sweep(2400, 600, 0.35, 0.7); this.sweep(1800, 400, 0.35, 0.4, 0.05); },
  plasma() { this.sweep(200, 1600, 0.5, 0.7); },
  thunder() { this.crunch(0.9, 400, 40, 1); },
  meteor() { this.sweep(1800, 250, 1.1, 0.35); },
  zap() { this.sweep(3000, 200, 0.15, 0.6); },
  dirt() { this.crunch(0.25, 300, 80, 0.6); },
  sizzle() { this.crunch(0.15, 2400, 1200, 0.25); },
  shieldHit() { this.sweep(1600, 2400, 0.08, 0.6); },
  bounce() { this.beep(700, 0.03, 0.6); },
  parachute() { this.sweep(1400, 700, 0.3, 0.4); },
  chopper() { for (let i = 0; i < 12; i++) this.beep(90, 0.03, 0.8, i * 0.08); },
  roundOver() { this.seq([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]], 0.5); },
  gameOver() { this.seq([[392, 0.2], [330, 0.2], [262, 0.2], [196, 0.5]], 0.5); },
  charge() { this.sweep(300, 1200, 0.25, 0.5); },

  // continuous flight sound: frequency follows height (POS) or velocity (VEL)
  flightSet(freq) {
    if (!this.ok() || Cfg.flightSounds === 'OFF') { this.flightStop(); return; }
    if (!this.flight) {
      this.flight = this.ctx.createOscillator();
      this.flightGain = this.ctx.createGain();
      this.flight.type = 'square';
      this.flightGain.gain.value = 0.35;
      this.flight.connect(this.flightGain); this.flightGain.connect(this.out);
      this.flight.start();
    }
    this.flight.frequency.setTargetAtTime(clamp(freq, 40, 4000), this.ctx.currentTime, 0.01);
  },
  flightStop() {
    if (this.flight) {
      try { this.flight.stop(); } catch (e) { /* ignore */ }
      this.flight.disconnect(); this.flightGain.disconnect();
      this.flight = null; this.flightGain = null;
    }
  }
};
