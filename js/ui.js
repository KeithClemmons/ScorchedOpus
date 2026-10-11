'use strict';
/* =====================================================================
   UI toolkit: grey 3D-beveled dialogs, buttons with underlined hotkeys,
   counters (left click / key = next, right click / Shift+key = previous),
   toggles, text fields and a modal stack. All in UI-layer coordinates.
   ===================================================================== */

const UIC = {
  face: vga(42, 42, 42), hi: vga(63, 63, 63), lo: vga(21, 21, 21), black: vga(0, 0, 0),
  text: vga(0, 0, 0), hot: vga(44, 0, 0), dis: vga(29, 29, 29), field: vga(63, 63, 63),
  sel: vga(0, 0, 40), selText: vga(63, 63, 63), light: vga(52, 52, 52), dark: vga(32, 32, 32),
  blue: vga(0, 0, 42), title: vga(0, 0, 0), wind: vga(24, 48, 63), white: vga(63, 63, 63),
  yellow: vga(63, 63, 21), red: vga(63, 16, 16), green: vga(16, 60, 16)
};

function bevel(s, x, y, w, h, raised, face) {
  if (s.vector) { s.bevel(x, y, w, h, raised, face); return; }
  if (face !== undefined) s.fillRect(x, y, w, h, face);
  const a = raised ? UIC.hi : UIC.lo, b = raised ? UIC.lo : UIC.hi;
  s.hline(x, x + w - 1, y, a); s.vline(x, y, y + h - 1, a);
  s.hline(x, x + w - 1, y + h - 1, b); s.vline(x + w - 1, y, y + h - 1, b);
}
function frame(s, x, y, w, h, face) {
  if (s.vector) { s.panel(x, y, w, h); return; }
  s.rect(x, y, w, h, UIC.black);
  bevel(s, x + 1, y + 1, w - 2, h - 2, true, face === undefined ? UIC.face : face);
  bevel(s, x + 2, y + 2, w - 4, h - 4, true);
}
function drawButton(s, x, y, w, h, label, o) {
  o = o || {};
  if (s.vector) { s.button(x, y, w, h, label, o); return; }
  const pressed = !!o.pressed;
  bevel(s, x, y, w, h, !pressed, o.face === undefined ? UIC.face : o.face);
  if (!pressed && h > 8) bevel(s, x + 1, y + 1, w - 2, h - 2, true);
  const col = o.disabled ? UIC.dis : (o.color === undefined ? UIC.text : o.color);
  const ty = y + Math.floor((h - 8) / 2) + (pressed ? 1 : 0);
  const off = pressed ? 1 : 0;
  const hc = o.disabled ? UIC.dis : UIC.hot;
  if (o.value !== undefined) {
    Font.draw(s, label, x + 4 + off, ty, col, { hotColor: hc });
    Font.right(s, String(o.value), x + w - 4 + off, ty, col);
  } else if (o.align === 'left') {
    Font.draw(s, label, x + 4 + off, ty, col, { hotColor: hc });
  } else {
    const tw = Font.width(label);
    Font.draw(s, label, x + Math.floor((w - tw) / 2) + off, ty, col, { hotColor: hc });
  }
}
function drawCheck(s, x, y, on, disabled) {
  if (s.vector) { s.check(x, y, on, disabled); return; }
  bevel(s, x, y, 9, 9, false, disabled ? UIC.face : UIC.field);
  if (on) {
    const c = disabled ? UIC.dis : UIC.black;
    s.pset(x + 2, y + 4, c); s.pset(x + 3, y + 5, c); s.pset(x + 4, y + 6, c);
    s.pset(x + 5, y + 5, c); s.pset(x + 6, y + 4, c); s.pset(x + 7, y + 3, c); s.pset(x + 7, y + 2, c);
    s.pset(x + 2, y + 5, c); s.pset(x + 3, y + 6, c); s.pset(x + 4, y + 7, c); s.pset(x + 5, y + 6, c); s.pset(x + 6, y + 5, c);
  }
}
function drawField(s, x, y, w, text, caret, maxShow) {
  if (s.vector) { s.field(x, y, w, text, caret, maxShow); return; }
  bevel(s, x, y, w, 12, false, UIC.field);
  let t = String(text);
  const mc = maxShow || Math.floor((w - 6) / Font.CW);
  if (t.length > mc) t = t.slice(t.length - mc);
  Font.draw(s, t.replace(/&/g, '&&'), x + 3, y + 2, UIC.black);
  if (caret && (Math.floor(performance.now() / 400) & 1)) s.vline(x + 3 + t.length * Font.CW, y + 2, y + 9, UIC.black);
}
// small raised box with centered text lines (used for popups over the battlefield)
function drawBox(s, lines, cx, cy, o) {
  o = o || {};
  const w = Math.max(...lines.map(l => Font.width(l))) + 16;
  const h = lines.length * 10 + 12;
  const x = clamp(Math.floor(cx - w / 2), 0, Screen.UW - w), y = clamp(Math.floor(cy - h / 2), 0, Screen.UH - h);
  frame(s, x, y, w, h);
  lines.forEach((l, i) => Font.center(s, l, x + w / 2, y + 7 + i * 10, o.color || UIC.text));
  return { x, y, w, h };
}

/* ---------------- controls ---------------- */
class Ctl {
  constructor(o) {
    Object.assign(this, o);
    if (this.hot === undefined && this.label) this.hot = Font.hotkeyOf(this.label);
  }
  inside(mx, my) { return mx >= this.x && my >= this.y && mx < this.x + this.w && my < this.y + this.h; }
}

class Dialog {
  constructor(o) {
    o = o || {};
    this.title = o.title || '';
    this.ctls = [];
    this.w = o.w || 200; this.h = o.h || 100;
    this.x = 0; this.y = 0;
    this.closeOnOutside = o.closeOnOutside !== false;
    this.escCloses = o.escCloses !== false;
    this.onClose = o.onClose || null;
    this.onEnter = o.onEnter || null;
    this.pauses = !!o.pauses;
    this.focus = null;      // text control with caret
    this.pressed = null;    // control under a held mouse button
    this.pressBtn = 0;
    this.holdT = 0;
    this.titleColor = o.titleColor;
    this.face = o.face;
    if (o.center !== false) this.center();
  }
  center() {
    this.x = Math.floor((Screen.UW - this.w) / 2);
    this.y = Math.floor((Screen.UH - this.h) / 2);
  }
  add(o) { const c = new Ctl(o); c.dlg = this; this.ctls.push(c); return c; }
  button(label, x, y, w, h, fn, o) {
    return this.add(Object.assign({
      label, x, y, w, h, kind: 'button', fn,
      draw(s, d) {
        const dis = this.disabled && this.disabled();
        drawButton(s, d.x + this.x, d.y + this.y, this.w, this.h, this.label,
          { pressed: d.pressed === this, disabled: dis, value: this.value ? this.value() : undefined, align: this.align });
      },
      click(b) { if (this.disabled && this.disabled()) { Sound.error(); return; } Sound.click(); this.fn(b); }
    }, o || {}));
  }
  // counter / cycle / toggle / text bound to an object property
  option(def, obj, x, y, w, onChange) {
    const d = this;
    const ctl = this.add({
      label: def.label, x, y, w, h: def.type === 'toggle' ? 12 : 13, kind: def.type, def, obj, repeat: def.type === 'num',
      value() {
        const v = obj[def.key];
        if (def.type === 'toggle') return v ? 'ON' : 'OFF';
        if (def.fmt) return def.fmt(v);
        return String(v);
      },
      step(dir) {
        const v = obj[def.key];
        if (def.type === 'toggle') obj[def.key] = !v;
        else if (def.type === 'cycle') {
          const i = def.values.indexOf(v), n = def.values.length;
          obj[def.key] = def.values[((i < 0 ? 0 : i) + dir + n) % n];
        } else if (def.type === 'num') {
          const st = def.steps;
          let i = 0, best = Infinity;
          st.forEach((sv, k) => { const dd = Math.abs(sv - v); if (dd < best) { best = dd; i = k; } });
          obj[def.key] = st[(i + dir + st.length) % st.length];
        }
        if (def.onChange) def.onChange(obj[def.key]);
        if (onChange) onChange(def.key);
      },
      draw(s) {
        const X = d.x + this.x, Y = d.y + this.y;
        if (def.type === 'toggle') {
          drawCheck(s, X + 2, Y + 1, !!obj[def.key]);
          Font.draw(s, def.label, X + 15, Y + 2, UIC.text, { hotColor: UIC.hot });
        } else if (def.type === 'text') {
          Font.draw(s, def.label, X + 2, Y + 3, UIC.text, { hotColor: UIC.hot });
          const lw = Font.width(def.label) + 8;
          drawField(s, X + lw, Y, this.w - lw, obj[def.key], d.focus === this);
        } else {
          drawButton(s, X, Y, this.w, this.h, def.label, { pressed: d.pressed === this, value: this.value() });
        }
      },
      click(b) {
        if (def.type === 'text') { d.focus = this; this.orig = obj[def.key]; return; }
        Sound.click();
        this.step(b === 2 ? -1 : 1);
      },
      typed(ev) {
        let v = String(obj[def.key]);
        if (ev.k === 'enter') { d.focus = null; if (onChange) onChange(def.key); return; }
        if (ev.k === 'escape') { obj[def.key] = this.orig; d.focus = null; return; }
        if (ev.k === 'backspace') v = v.slice(0, -1);
        else if (ev.ch && v.length < 24) v += ev.ch;
        obj[def.key] = v;
      }
    });
    return ctl;
  }
  text(str, x, y, color, o) {
    return this.add({ x, y, w: 0, h: 0, kind: 'label', str, color, o, draw(s, d) {
      const t = typeof this.str === 'function' ? this.str() : this.str;
      Font.draw(s, t, d.x + this.x, d.y + this.y, this.color === undefined ? UIC.text : this.color, this.o);
    } });
  }
  textField(obj, key, x, y, w, max, onEnter) {
    const d = this;
    return this.add({
      x, y, w, h: 12, kind: 'text', hot: null, max: max || 16,
      draw(s) { drawField(s, d.x + this.x, d.y + this.y, this.w, obj[key], d.focus === this); },
      click() { d.focus = this; },
      typed(ev) {
        let v = String(obj[key]);
        if (ev.k === 'enter') { d.focus = null; if (onEnter) onEnter(); return; }
        if (ev.k === 'escape') { d.focus = null; return; }
        if (ev.k === 'tab') { d.focus = null; return 'pass'; }
        if (ev.k === 'backspace') v = v.slice(0, -1);
        else if (ev.ch && v.length < this.max) v += ev.ch;
        obj[key] = v;
      }
    });
  }
  draw(s) {
    frame(s, this.x, this.y, this.w, this.h, this.face);
    if (this.title) {
      const tc = this.titleColor === undefined ? UIC.text : this.titleColor;
      Font.center(s, this.title, this.x + this.w / 2, this.y + 5, s.vector && this.titleColor !== undefined ? mixc(tc, rgb(255, 255, 255), 0.45) : tc);
    }
    for (const c of this.ctls) if (c.draw && !(c.hidden && c.hidden())) c.draw(s, this);
    if (this.extraDraw) this.extraDraw(s);
  }
  close() {
    UI.remove(this);
    if (this.onClose) this.onClose();
  }
  key(ev) {
    if (this.focus) {
      const r = this.focus.typed(ev);
      if (r !== 'pass') return true;
    }
    if (this.onKey && this.onKey(ev)) return true;
    if (ev.k === 'escape' && this.escCloses) { this.close(); return true; }
    if (ev.k === 'enter' && this.onEnter) { this.onEnter(); return true; }
    if (ev.k.length === 1) {
      for (const c of this.ctls) {
        if (c.hot && c.hot === ev.k && !(c.hidden && c.hidden())) {
          if (c.kind === 'text' || (c.def && c.def.type === 'text')) { c.click(0); return true; }
          if (c.step) { Sound.click(); c.step(ev.shift || ev.alt ? -1 : 1); } else c.click(ev.shift || ev.alt ? 2 : 0);
          return true;
        }
      }
    }
    return false;
  }
  mouse(ev) {
    const mx = ev.ux, my = ev.uy;
    if (ev.kind === 'down') {
      if (this.focus) { const f = this.focus; this.focus = null; if (f.typed) f.typed({ k: 'enter' }); }
      const inside = mx >= this.x && my >= this.y && mx < this.x + this.w && my < this.y + this.h;
      if (!inside) {
        if (this.closeOnOutside) this.close();
        return true;
      }
      for (let i = this.ctls.length - 1; i >= 0; i--) {
        const c = this.ctls[i];
        if (!c.click || (c.hidden && c.hidden())) continue;
        if (c.inside(mx - this.x, my - this.y)) {
          if (c.kind === 'button' || c.kind === 'num' || c.kind === 'cycle' || c.pressable) {
            this.pressed = c; this.pressBtn = ev.button; this.holdT = 0.4;
          }
          if (c.kind !== 'button' || c.fireOnDown) c.click(ev.button, mx - this.x - c.x, my - this.y - c.y);
          return true;
        }
      }
      if (this.onBackgroundClick) this.onBackgroundClick(mx - this.x, my - this.y, ev.button);
      return true;
    }
    if (ev.kind === 'up') {
      const c = this.pressed;
      this.pressed = null;
      if (c && c.kind === 'button' && !c.fireOnDown && c.inside(mx - this.x, my - this.y)) c.click(ev.button);
      return true;
    }
    return true;
  }
  update(dt) {
    if (this.pressed && this.pressed.repeat) {
      this.holdT -= dt;
      if (this.holdT <= 0) {
        this.holdT = 0.08 / Cfg.mouseRate * 0.5;
        this.pressed.click(this.pressBtn);
      }
    }
    if (this.tick) this.tick(dt);
  }
}

/* ---------------- modal stack ---------------- */
const UI = {
  stack: [],
  push(d) { this.stack.push(d); return d; },
  remove(d) { const i = this.stack.indexOf(d); if (i >= 0) this.stack.splice(i, 1); },
  top() { return this.stack[this.stack.length - 1] || null; },
  clear() { this.stack = []; },
  paused() { return this.stack.some(d => d.pauses); },
  key(ev) { const t = this.top(); return t ? (t.key(ev), true) : false; },
  mouse(ev) { const t = this.top(); return t ? t.mouse(ev) : false; },
  update(dt) { const t = this.top(); if (t) t.update(dt); },
  draw(s) { for (const d of this.stack) d.draw(s); }
};

/* ---------------- toasts: short notices that don't stop play ---------------- */
const Toast = {
  items: [],
  show(text) {
    if (!text) return;
    this.items.push({ text, t: 3.5 });
    if (this.items.length > 3) this.items.shift();
    Sound.beep(880, 0.05, 0.3);
  },
  update(dt) { this.items = this.items.filter(n => (n.t -= dt) > 0); },
  draw(s) {
    if (s.vector) { this.drawModern(); return; }
    let y = Math.floor(Screen.UH * 0.3);
    for (const n of this.items) {
      const w = Font.width(n.text.replace(/&/g, '&&')) + 12, x = Math.floor((Screen.UW - w) / 2);
      s.fillRect(x, y, w, 13, UIC.black);
      s.rect(x, y, w, 13, UIC.yellow);
      Font.draw(s, n.text.replace(/&/g, '&&'), x + 6, y + 3, UIC.yellow);
      y += 16;
    }
  }
};

Toast.drawModern = function () {
  const ctx = Gfx.ctx, fs = VUI.fontPx(1.05);
  let y = Gfx.UYp(Screen.UH * 0.3);
  ctx.font = '600 ' + fs.toFixed(1) + 'px ' + FONT_UI;
  for (const n of this.items) {
    const a = Math.min(1, n.t * 3, (3.5 - n.t) * 6 + 0.2);
    const w = ctx.measureText(n.text).width + fs * 2, h = fs * 2, x = Gfx.pf.x + (Gfx.pf.w - w) / 2;
    ctx.globalAlpha = clamp(Math.min(1, n.t * 4), 0, 1) * clamp(a, 0, 1);
    Hud.pill(ctx, x, y, w, h, { fill: 'rgba(12,16,28,0.9)', edge: 'rgba(255,182,64,0.6)' });
    Hud.txt(ctx, n.text, x + w / 2, y + h / 2, fs, '#ffd66e', { align: 'center' });
    y += h + 6 * Gfx.dpr;
  }
  ctx.globalAlpha = 1;
};

/* ---------------- common dialogs ---------------- */
function messageBox(lines, onClose, o) {
  o = o || {};
  const w = Math.max(90, ...lines.map(l => Font.width(l))) + 24;
  const h = lines.length * 10 + (o.noButton ? 16 : 36);
  const d = new Dialog({ w, h, title: '', onClose, pauses: o.pauses, closeOnOutside: true });
  lines.forEach((l, i) => d.text(l, Math.floor((w - Font.width(l)) / 2), 8 + i * 10, o.color));
  if (!o.noButton) d.button('&OK', Math.floor(w / 2 - 25), h - 22, 50, 14, () => d.close());
  d.onEnter = () => d.close();
  d.onKey = ev => { if (o.anyKey && ev.k !== 'escape') { d.close(); return true; } return false; };
  return UI.push(d);
}
function confirmBox(lines, onYes, onNo, o) {
  o = o || {};
  const w = Math.max(120, ...lines.map(l => Font.width(l))) + 24;
  const h = lines.length * 10 + 38;
  const d = new Dialog({ w, h, closeOnOutside: false, pauses: o.pauses });
  lines.forEach((l, i) => d.text(l, Math.floor((w - Font.width(l)) / 2), 8 + i * 10));
  d.button('&Yes', Math.floor(w / 2 - 54), h - 22, 48, 14, () => { UI.remove(d); onYes && onYes(); });
  d.button('&No', Math.floor(w / 2 + 6), h - 22, 48, 14, () => { UI.remove(d); onNo && onNo(); });
  d.onClose = () => { onNo && onNo(); };
  d.onEnter = () => { UI.remove(d); onYes && onYes(); };
  return UI.push(d);
}
