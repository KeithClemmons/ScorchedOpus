'use strict';
/* =====================================================================
   Input: keyboard (held state + event queue), mouse, and a gamepad used
   as the "Joystick" pointer.
   ===================================================================== */

const Input = {
  held: {},
  events: [],
  x: -1, y: -1, ux: -1, uy: -1, buttons: 0, inside: false,
  lastDown: { t: 0, x: 0, y: 0 },
  joyX: -1, joyY: -1, joyButtons: 0,

  norm(e) {
    if (e.code && e.code.startsWith('Key')) return e.code.slice(3).toLowerCase();
    if (e.code && e.code.startsWith('Digit')) return e.code.slice(5);
    if (e.code && e.code.startsWith('Numpad') && /^[0-9]$/.test(e.key)) return e.key;
    const k = (e.key || '').toLowerCase();
    if (k === ' ' || k === 'spacebar') return 'space';
    if (k === 'esc') return 'escape';
    if (k === 'left') return 'arrowleft';
    if (k === 'right') return 'arrowright';
    if (k === 'up') return 'arrowup';
    if (k === 'down') return 'arrowdown';
    return k;
  },

  // phones and tablets: a hidden text box brings up the on-screen keyboard for text fields
  kb: null,
  initKeyboard() {
    const el = document.createElement('input');
    el.type = 'text'; el.autocomplete = 'off'; el.spellcheck = false;
    el.setAttribute('autocapitalize', 'off'); el.setAttribute('autocorrect', 'off'); el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;font-size:16px;border:0;padding:0;margin:0;background:transparent;color:transparent;z-index:-1';
    document.body.appendChild(el);
    const key = (k, ch) => this.events.push({ type: 'key', k, ch: ch || '', shift: false, alt: false, ctrl: false, repeat: false });
    const reset = () => { el.value = ' '; try { el.setSelectionRange(1, 1); } catch (e) { /* ignore */ } };
    el.addEventListener('input', e => {
      if (e.inputType && e.inputType.startsWith('delete')) key('backspace');
      else for (const ch of el.value.slice(1)) if (ch >= ' ' && ch <= '~') key(ch.toLowerCase(), ch);
      reset();
    });
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); key('enter'); }
      else if (e.key === 'Escape') { e.preventDefault(); key('escape'); }
    });
    this.kb = el; this.kbReset = reset;
  },
  showKeyboard() { if (!this.kb) return; this.kbReset(); try { this.kb.focus({ preventScroll: true }); } catch (e) { this.kb.focus(); } },
  hideKeyboard() { if (this.kb && document.activeElement === this.kb) this.kb.blur(); },
  // is there a text field under this touch? (checked inside the tap itself, so the keyboard may open)
  textFieldAt(ux, uy) {
    const d = UI.top();
    if (!d || !d.ctls) return false;
    return d.ctls.some(c => (c.kind === 'text' || (c.def && c.def.type === 'text')) && !(c.hidden && c.hidden()) &&
      ux >= d.x + c.x && uy >= d.y + c.y && ux < d.x + c.x + c.w && uy < d.y + c.y + c.h);
  },

  init(canvas) {
    this.initKeyboard();
    window.addEventListener('keydown', e => {
      Sound.unlock();
      const k = this.norm(e);
      if (e.ctrlKey && !e.altKey && ['r', 'w', 't', 'n', 'l', 'c', 'v', 'x', '+', '-', '=', '0'].includes(k)) return; // leave browser shortcuts alone
      if (e.metaKey) return;
      if (k === 'f5' || k === 'f11' || k === 'f12') return;
      e.preventDefault();
      this.held[k] = true;
      this.events.push({
        type: 'key', k, ch: e.key && e.key.length === 1 ? e.key : '',
        shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, repeat: e.repeat
      });
    });
    window.addEventListener('keyup', e => {
      const k = this.norm(e);
      this.held[k] = false;
      if (k === 'alt') e.preventDefault();
    });
    window.addEventListener('blur', () => { this.held = {}; this.buttons = 0; });

    const pos = e => {
      const p = Screen.toInternal(e.clientX, e.clientY);
      this.x = p.x; this.y = p.y;
      this.ux = p.x / Screen.UX; this.uy = p.y / Screen.UY;
      this.inside = p.x >= 0 && p.y >= 0 && p.x < Screen.W && p.y < Screen.H;
    };
    canvas.addEventListener('pointerdown', e => {
      Sound.unlock();
      if (Cfg.pointer === 'None') return;
      pos(e);
      const b = e.button === 2 ? 2 : e.button === 1 ? 1 : 0;
      this.buttons |= (1 << b);
      const now = performance.now();
      const dbl = b === 0 && now - this.lastDown.t < 350 && Math.abs(this.x - this.lastDown.x) < 6 && Math.abs(this.y - this.lastDown.y) < 6;
      if (b === 0) this.lastDown = { t: dbl ? 0 : now, x: this.x, y: this.y };
      this.events.push({ type: 'mouse', kind: 'down', button: b, x: this.x, y: this.y, ux: this.ux, uy: this.uy, both: (this.buttons & 5) === 5, pointer: e.pointerType });
      if (dbl) this.events.push({ type: 'mouse', kind: 'dbl', button: 0, x: this.x, y: this.y, ux: this.ux, uy: this.uy });
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        if (this.textFieldAt(this.ux, this.uy)) this.showKeyboard();
        else if (typeof Hud !== 'undefined' && Hud.chatTapped && Hud.chatTapped(this.ux, this.uy)) { Chat.open(); this.showKeyboard(); }
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointerup', e => {
      if (Cfg.pointer === 'None') return;
      pos(e);
      const b = e.button === 2 ? 2 : e.button === 1 ? 1 : 0;
      this.buttons &= ~(1 << b);
      this.events.push({ type: 'mouse', kind: 'up', button: b, x: this.x, y: this.y, ux: this.ux, uy: this.uy });
    });
    canvas.addEventListener('pointermove', e => { if (Cfg.pointer !== 'None') pos(e); });
    canvas.addEventListener('pointerleave', () => { this.inside = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      if (Cfg.pointer === 'None') return;
      this.events.push({ type: 'wheel', dy: Math.sign(e.deltaY), ux: this.ux, uy: this.uy });
      e.preventDefault();
    }, { passive: false });
  },

  // gamepad as a pointer: stick moves a cursor, buttons click
  poll(dt) {
    if (Cfg.pointer !== 'Joystick' || !navigator.getGamepads) return;
    let pad = null;
    try { for (const p of navigator.getGamepads()) if (p) { pad = p; break; } } catch (e) { return; }
    if (!pad) return;
    if (this.joyX < 0) { this.joyX = Screen.W / 2; this.joyY = Screen.H / 2; }
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const sp = 260 * Cfg.mouseRate * (Screen.W / 360);
    if (Math.abs(ax) > 0.15) this.joyX = clamp(this.joyX + ax * sp * dt, 0, Screen.W - 1);
    if (Math.abs(ay) > 0.15) this.joyY = clamp(this.joyY + ay * sp * dt * Screen.ay, 0, Screen.H - 1);
    this.x = this.joyX; this.y = this.joyY; this.ux = this.x / Screen.UX; this.uy = this.y / Screen.UY; this.inside = true;
    const btn = (pad.buttons[0] && pad.buttons[0].pressed ? 1 : 0) | (pad.buttons[1] && pad.buttons[1].pressed ? 4 : 0);
    for (const [bit, b] of [[1, 0], [4, 2]]) {
      if ((btn & bit) && !(this.joyButtons & bit)) this.events.push({ type: 'mouse', kind: 'down', button: b, x: this.x, y: this.y, ux: this.ux, uy: this.uy });
      if (!(btn & bit) && (this.joyButtons & bit)) this.events.push({ type: 'mouse', kind: 'up', button: b, x: this.x, y: this.y, ux: this.ux, uy: this.uy });
    }
    this.joyButtons = btn; this.buttons = btn;
  },

  take() { const e = this.events; this.events = []; return e; },
  isHeld(k) { return !!this.held[k]; }
};
