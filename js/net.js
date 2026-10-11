'use strict';
/* =====================================================================
   Network play: host-authoritative deterministic lockstep.

   The host runs the game (turn order, computer players, weather, shop
   phases) and broadcasts a numbered stream of commands. Every machine
   applies the same commands to the same seeded, fixed-tick simulation, so
   every screen shows the same battle. Checksums at turn boundaries catch
   drift; a machine that drifts is sent a snapshot.

   Transports all look like "a room": broadcast messages plus a small
   presence object per participant.
     WsTransport    - server/server.js relay, rooms by code
     PeerTransport  - browser to browser (WebRTC), rooms by code, no server
     LocalTransport - BroadcastChannel between tabs of one browser
   ===================================================================== */

const NET_V = 29;   // Remastered: new weapons and rules make it a different game from Classic (v1); v3 Power Limit, v4 1.5-sized tanks and terrain, v5 varied terrain + power 200, v6 random death blasts, v7 1.5 damage pay, v8 1.5 bundle sizes, v9 dirt geyser deaths, v10 death beam, v11 deeper cavern roofs, v12 blasts cool before they go, v13 double-blast deaths, v14 Triple needs the Extended Arsenal, v15 1.5 auto defense price, v16 FIT SCREEN + shells gone off the side, v17 mag deflectors push shells aside, v18 mag shields have no bubble, v19 1.5 dirt charge cone + plasma disc, v20 1.5 dirt balls, liquid dirt, diggers, v21 1.5 sandhogs, v22 measured sizes at Normal scale, v23 1.5 riot weapons + zigzag sandhogs, v24 1.5 fireball timing + rolling, v25 1.5 leapfrog + napalm, v26 fireball volleys pulse together, v27 1.5 nukes + funky bomb, v28 fireball growth capped at 3s, v29 funky bomblets once a second
const GAME_CMDS = new Set(['start', 'shop', 'shopwait', 'round', 'roundover', 'gameover', 'setai', 'msg']);
// options that shape the shared game (sound, pointer and the like stay personal)
const SYNC_KEYS = ['rounds', 'graphicsMode', 'firingDelay', 'fallingDelay', 'interestRate', 'cashAtStart', 'computersBuy',
  'freeMarket', 'scoringMode', 'airViscosity', 'gravity', 'suspendDirt', 'tanksFall', 'bordersExtend', 'effectOfWalls',
  'sky', 'maxWind', 'changingWind', 'hostileEnvironment', 'bumpiness', 'slope', 'flattenPeaks', 'randomLand',
  'scannedMountains', 'mode', 'teams', 'statusBar', 'playOrder', 'fastComputers', 'talkingTanks', 'talkProbability',
  'attackFile', 'dieFile', 'armsLevel', 'bombIcon', 'tunneling', 'scale', 'tracePaths', 'extraDirt', 'uselessItems', 'impactDamage', 'extendedArsenal', 'powerLimit'];
function syncedCfg() {
  const o = {};
  for (const k of SYNC_KEYS) o[k] = Cfg[k];
  // FIT SCREEN depends on the window: everyone plays the host's exact battlefield
  if (o.graphicsMode === 'FIT SCREEN') o.graphicsMode = Screen.W + 'x' + Screen.H + ' FIT';
  return o;
}

/* ------------------------------------------------ transports */
// tabs of this browser (BroadcastChannel); presence rides on heartbeats
class LocalTransport {
  constructor(code) { this.code = code; this.me = 'L' + rid(10); this.map = new Map(); this.pres = {}; this.maxMsg = 1e7; }
  connect() {
    try { this.ch = new BroadcastChannel('scorched-opus-' + this.code); } catch (e) { return Promise.reject(new Error('This browser cannot link tabs here.')); }
    this.ch.onmessage = e => this.recv(e.data);
    this.hb = setInterval(() => this.beat(), 800);
    this.beat();
    return new Promise(r => setTimeout(r, 300));
  }
  beat() {
    this.post({ op: 'hb', p: this.pres });
    const now = Date.now();
    let changed = false;
    for (const [id, v] of this.map) if (now - v.seen > 3500) { this.map.delete(id); changed = true; }
    if (changed) this.fire();
  }
  post(d) { d.from = this.me; try { this.ch.postMessage(d); } catch (e) { /* closed */ } }
  recv(d) {
    if (!d || d.from === this.me) return;
    const had = this.map.get(d.from);
    if (d.op === 'bye') { this.map.delete(d.from); this.fire(); return; }
    if (d.op === 'hb' || d.op === 'pres') {
      this.map.set(d.from, { peer: d.from, presence: d.p || {}, seen: Date.now() });
      if (!had || d.op === 'pres') this.fire();
      return;
    }
    if (!had) { this.map.set(d.from, { peer: d.from, presence: {}, seen: Date.now() }); this.fire(); }
    else had.seen = Date.now();
    if (d.op === 'msg' && this.onmessage) this.onmessage(d.data, d.from);
  }
  fire() { if (this.onpeers) this.onpeers(); }
  peers() { return [...this.map.values()].map(v => ({ peer: v.peer, presence: v.presence })); }
  emit(data) { this.post({ op: 'msg', data }); }
  presence(patch, full) { this.pres = full; this.post({ op: 'pres', p: full }); }
  close() { this.post({ op: 'bye' }); clearInterval(this.hb); try { this.ch.close(); } catch (e) { /* ignore */ } }
}

// the Node relay in server/server.js
class WsTransport {
  constructor(url, code) { this.url = url; this.code = code; this.map = new Map(); this.me = null; this.maxMsg = 400000; }
  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      const u = this.url + (this.url.indexOf('?') >= 0 ? '&' : '?') + 'room=' + encodeURIComponent(this.code);
      try { ws = new WebSocket(u); } catch (e) { reject(new Error('That server address is not valid.')); return; }
      this.ws = ws;
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('The server did not answer.')); try { ws.close(); } catch (e) { /* ignore */ } } }, 8000);
      ws.onmessage = e => {
        let d;
        try { d = JSON.parse(e.data); } catch (err) { return; }
        switch (d.op) {
          case 'welcome':
            this.me = d.me;
            clearInterval(this.ka);
            this.ka = setInterval(() => this.send({ op: 'ping' }), 25000);
            for (const p of d.peers || []) this.map.set(p.peer, { peer: p.peer, presence: p.presence || {} });
            if (!done) { done = true; clearTimeout(timer); resolve(); }
            this.fire();
            break;
          case 'joined': this.map.set(d.peer, { peer: d.peer, presence: {} }); this.fire(); break;
          case 'left': this.map.delete(d.peer); this.fire(); break;
          case 'presence': {
            const p = this.map.get(d.peer);
            if (p) p.presence = d.data || {}; else this.map.set(d.peer, { peer: d.peer, presence: d.data || {} });
            this.fire();
            break;
          }
          case 'msg': if (this.onmessage) this.onmessage(d.data, d.from); break;
          case 'error': if (!done) { done = true; clearTimeout(timer); reject(new Error(d.msg || 'The server refused.')); } break;
        }
      };
      ws.onclose = () => {
        clearInterval(this.ka);
        if (!done) { done = true; clearTimeout(timer); reject(new Error('Could not connect to the server.')); }
        if (this.onstatus) this.onstatus(false);
      };
      ws.onerror = () => { /* onclose follows */ };
    });
  }
  fire() { if (this.onpeers) this.onpeers(); }
  peers() { return [...this.map.values()]; }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  emit(data) { this.send({ op: 'emit', data }); }
  presence(patch, full) { this.send({ op: 'presence', data: full }); }
  close() { clearInterval(this.ka); try { this.ws.close(); } catch (e) { /* ignore */ } }
}

// peer to peer (WebRTC through PeerJS, bundled in vendor/): no game server at all. The free public
// PeerJS service only introduces the players (it also lends a relay to players on strict networks);
// game messages then go browser to browser. The first browser in a room code becomes its hub:
// everyone else connects to it, and it passes messages and presence on, so the room behaves like
// the server's.
function loadPeerJs() {
  return window.Peer ? Promise.resolve() : Promise.reject(new Error('Peer to peer is missing from this copy of the game.'));
}
class PeerTransport {
  constructor(code) {
    this.code = code; this.map = new Map(); this.me = null; this.pres = {};
    this.maxMsg = 60000; this.conns = new Map(); this.hubConn = null; this.isHub = false;
  }
  hubId() { return 'scorched-opus-room-' + String(this.code).toLowerCase(); }
  async connect() {
    await loadPeerJs();
    try {
      this.peer = await this.start(this.hubId());
      this.isHub = true;
      this.peer.on('connection', c => this.addMember(c));
    } catch (e) {
      if (!e || e.type !== 'unavailable-id') throw this.nice(e);
      // someone already holds the room: join them
      this.peer = await this.start(undefined);
      await this.join();
    }
    this.me = this.peer.id;
    // losing the introduction service doesn't break open connections; get it back for newcomers
    this.peer.on('disconnected', () => { try { if (!this.peer.destroyed) this.peer.reconnect(); } catch (e) { /* ignore */ } });
  }
  nice(e) {
    const t = e && e.type;
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return new Error('Could not reach the peer to peer service (are you online?).');
    if (t === 'browser-incompatible') return new Error('This browser cannot play peer to peer.');
    return new Error((e && e.message) || 'Peer to peer failed.');
  }
  start(id) {
    return new Promise((resolve, reject) => {
      const p = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch (e) { /* ignore */ } reject(new Error('The peer to peer service did not answer.')); } }, 10000);
      p.on('open', () => { if (!done) { done = true; clearTimeout(timer); resolve(p); } });
      p.on('error', e => {
        if (!done) { done = true; clearTimeout(timer); try { p.destroy(); } catch (x) { /* ignore */ } reject(e); return; }
        if (e && e.type === 'peer-unavailable') return;   // someone we tried to reach left
      });
    });
  }
  join() {
    return new Promise((resolve, reject) => {
      const c = this.peer.connect(this.hubId(), { reliable: true, serialization: 'json' });
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('Could not reach the other players. Your network may block direct connections.')); } }, 15000);
      c.on('data', d => {
        if (d && d.op === 'welcome' && !done) {
          done = true; clearTimeout(timer);
          this.hubConn = c;
          for (const p of d.peers || []) if (p.peer !== this.peer.id) this.map.set(p.peer, { peer: p.peer, presence: p.presence || {} });
          resolve(); this.fire();
          return;
        }
        this.fromHub(d);
      });
      c.on('close', () => { this.map.clear(); this.fire(); if (this.onstatus) this.onstatus(false); });
      c.on('error', () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('Could not reach the other players.')); } });
    });
  }
  // ---- the hub's side
  addMember(c) {
    c.on('open', () => {
      this.conns.set(c.peer, c);
      this.map.set(c.peer, { peer: c.peer, presence: {} });
      const peers = [{ peer: this.peer.id, presence: this.pres }].concat([...this.map.values()].filter(p => p.peer !== c.peer));
      this.send(c, { op: 'welcome', peers });
      this.toMembers({ op: 'joined', peer: c.peer }, c.peer);
      this.fire();
    });
    c.on('data', d => {
      if (!d || typeof d !== 'object') return;
      if (d.op === 'emit') {
        if (this.onmessage) this.onmessage(d.data, c.peer);
        this.toMembers({ op: 'msg', from: c.peer, data: d.data }, c.peer);
      } else if (d.op === 'presence') {
        const p = this.map.get(c.peer);
        if (p) p.presence = d.data || {};
        this.toMembers({ op: 'presence', peer: c.peer, data: d.data || {} }, c.peer);
        this.fire();
      }
    });
    const gone = () => {
      if (!this.conns.has(c.peer)) return;
      this.conns.delete(c.peer); this.map.delete(c.peer);
      this.toMembers({ op: 'left', peer: c.peer });
      this.fire();
    };
    c.on('close', gone); c.on('error', gone);
  }
  toMembers(o, except) { for (const [id, c] of this.conns) if (id !== except) this.send(c, o); }
  send(c, o) { try { if (c.open) c.send(o); } catch (e) { /* closing */ } }
  // ---- everyone else's side
  fromHub(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.op) {
      case 'joined': if (d.peer !== this.me) { this.map.set(d.peer, { peer: d.peer, presence: {} }); this.fire(); } break;
      case 'left': this.map.delete(d.peer); this.fire(); break;
      case 'presence': {
        if (d.peer === this.me) break;
        const p = this.map.get(d.peer);
        if (p) p.presence = d.data || {}; else this.map.set(d.peer, { peer: d.peer, presence: d.data || {} });
        this.fire();
        break;
      }
      case 'msg': if (d.from !== this.me && this.onmessage) this.onmessage(d.data, d.from); break;
    }
  }
  fire() { if (this.onpeers) this.onpeers(); }
  peers() { return [...this.map.values()]; }
  emit(data) {
    if (this.isHub) this.toMembers({ op: 'msg', from: this.me, data });
    else if (this.hubConn) this.send(this.hubConn, { op: 'emit', data });
  }
  presence(patch, full) {
    this.pres = full;
    if (this.isHub) this.toMembers({ op: 'presence', peer: this.me, data: full });
    else if (this.hubConn) this.send(this.hubConn, { op: 'presence', data: full });
  }
  close() {
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    try { if (this.hubConn) this.hubConn.close(); } catch (e) { /* ignore */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
  }
}

/* ------------------------------------------------ the protocol */
const Net = {
  online: false, role: null, me: null, kind: null, code: null, tr: null, connected: false,
  gid: null, hostPeer: null, lobby: null, myName: '', myIcon: 0,
  // host
  seq: 0, log: [], out: [], flushQ: false, flushLater: false, lastFlush: 0, seenReq: {}, hbT: 0, lobbyT: 0, snapTo: new Set(), goneT: {},
  // client
  expect: 1, pend: new Map(), queue: [], lastK: -1, horizon: 0, acc: 0, nackT: 0, reqId: 0,
  pendingReq: null, snapWanted: false, snapT: 0, joinT: 0, seated: false, hostSeenT: 0,
  parts: {}, partId: 0, pres: {}, aimWant: undefined, aimKey: '', aimT: 0, savedCfg: null,

  isHost() { return this.online && this.role === 'host'; },
  isClient() { return this.online && this.role === 'client'; },
  kindLabel(k) {
    k = k || this.kind;
    return k === 'ws' ? 'game server' : k === 'peer' ? 'peer to peer' : 'this browser';
  },
  // ways to connect from here
  available() {
    // a site with our relay behind it offers that first; a plain static copy (GitHub Pages, a file)
    // has no server, so peer to peer comes first there
    const k = this.relayHere() ? ['ws', 'peer'] : ['peer', 'ws'];
    // tabs of one browser: only offered when testing locally - on a real website it only
    // strands friends in a room nobody else can reach
    if (!this.hosted()) k.push('local');
    return k;
  },
  // is this page served by a game server (server/server.js or the Cloudflare Worker)? Static hosts
  // like GitHub Pages and files opened from disk have no relay
  relayHere() {
    return /^https?:$/.test(location.protocol) && !/\.github\.io$/i.test(location.hostname);
  },
  // served from a real website (not a file on disk or this computer's own dev server)?
  hosted() {
    return /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\]|0\.0\.0\.0|.*\.localhost$)/.test(location.hostname);
  },
  defaultServer() {
    if (location.protocol === 'http:' || location.protocol === 'https:') return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return '';
  },

  async open(kind, o) {
    this.close();
    const tr = kind === 'ws' ? new WsTransport(o.url, o.code) : kind === 'peer' ? new PeerTransport(o.code) : new LocalTransport(o.code);
    tr.onmessage = (m, from) => { try { this.onMessage(m, from); } catch (e) { console.error(e); } };
    tr.onpeers = () => {};
    tr.onstatus = up => { this.connected = up; };
    await tr.connect();
    this.tr = tr; this.kind = kind; this.code = o.code || null; this.me = tr.me; this.connected = true;
    this.myName = o.name; this.myIcon = o.icon | 0;
    this.pres = {};
    this.setPresence({ v: NET_V, name: o.name });
  },
  close() {
    if (this.tr) { try { this.tr.close(); } catch (e) { /* ignore */ } }
    this.tr = null; this.online = false; this.role = null; this.me = null; this.gid = null; this.hostPeer = null; this.lobby = null;
    this.seq = 0; this.log = []; this.out = []; this.flushQ = false; this.flushLater = false; this.seenReq = {}; this.snapTo = new Set(); this.goneT = {};
    this.expect = 1; this.pend = new Map(); this.queue = []; this.lastK = -1; this.horizon = 0; this.acc = 0;
    this.pendingReq = null; this.snapWanted = false; this.seated = false; this.parts = {}; this.aimWant = undefined; this.aimKey = '';
    this.connected = false;
  },
  setPresence(patch) {
    const send = {};
    for (const k in patch) {
      const v = patch[k];
      if (v === null || v === undefined) { delete this.pres[k]; send[k] = null; }
      else { this.pres[k] = v; send[k] = v; }
    }
    if (this.tr) this.tr.presence(send, Object.assign({}, this.pres));
  },
  peers() { return this.tr ? this.tr.peers() : []; },
  peer(id) { return this.peers().find(p => p.peer === id) || null; },
  aimOf(peer) { const p = this.peer(peer); return (p && p.presence && p.presence.aim) || null; },
  publishAim(a) { if (this.online) this.aimWant = a; },
  games() {
    return this.peers()
      .filter(p => p.presence && p.presence.v === NET_V && p.presence.game)
      .map(p => Object.assign({ peer: p.peer }, p.presence.game));
  },
  myPlayer() { return Game.players.find(p => !p.ai && p.owner === this.me) || null; },

  /* ---------- sending ---------- */
  emit(m) {
    if (!this.tr) return;
    const s = JSON.stringify(m), max = this.tr.maxMsg || 3500;
    if (s.length <= max) { this.tr.emit(m); return; }
    // too big for the transport in one go: send it in parts (quoting can double a part's size)
    const size = Math.floor((max - 300) / 2), id = (++this.partId) + '.' + Math.floor(Math.random() * 1e6), n = Math.ceil(s.length / size);
    for (let i = 0; i < n; i++) this.tr.emit({ t: 'part', id, i, n, to: m.to, s: s.slice(i * size, (i + 1) * size) });
  },

  /* ---------- receiving ---------- */
  onMessage(m, from) {
    if (!m || typeof m !== 'object' || typeof from !== 'string') return;
    if (m.to && m.to !== this.me) return;
    if (m.t === 'part') {
      const key = from + '/' + m.id;
      let p = this.parts[key];
      if (!p) {
        const n = m.n | 0;
        if (n <= 0 || n > 1000) return;
        p = this.parts[key] = { n, got: 0, s: [], t: performance.now() };
      }
      if (typeof m.s === 'string' && p.s[m.i | 0] === undefined) { p.s[m.i | 0] = m.s; p.got++; }
      if (p.got >= p.n) {
        delete this.parts[key];
        let full;
        try { full = JSON.parse(p.s.join('')); } catch (e) { return; }
        this.onMessage(full, from);
      }
      return;
    }
    if (m.gid && this.gid && m.gid !== this.gid) return;
    switch (m.t) {
      case 'join': if (this.isHost() && m.gid === this.gid) this.onJoin(from, m); break;
      case 'seat': if (this.isHost()) this.onSeat(from, m); break;
      case 'leave': if (this.isHost()) this.peerGone(from); break;
      case 'req': if (this.isHost()) this.onReq(from, m); break;
      case 'nack': if (this.isHost()) this.resend(from, m.from | 0); break;
      case 'snapreq': if (this.isHost()) this.snapTo.add(from); break;
      case 'lobby': if (this.isClient() && from === this.hostPeer) this.onLobby(m); break;
      case 'kick': if (this.isClient() && from === this.hostPeer) this.hostGone(String(m.reason || 'The host turned you away.')); break;
      case 'bye': if (this.isClient() && from === this.hostPeer) this.hostGone('The host ended the game.'); break;
      case 'cmd': if (this.isClient() && from === this.hostPeer) this.onCmd(m); break;
      case 'cmds':
        if (this.isClient() && from === this.hostPeer && Array.isArray(m.ms)) for (const x of m.ms) if (x && typeof x === 'object') this.onCmd(x);
        break;
      case 'hb': if (this.isClient() && from === this.hostPeer) { this.hostSeenT = performance.now(); if ((m.seq | 0) >= this.expect) this.nack(true); } break;
      case 'snap': if (this.isClient() && from === this.hostPeer) this.onSnap(m); break;
      case 'chat': Chat.receive(from, m); break;
    }
  },

  /* ---------- host: lobby ---------- */
  host() {
    this.role = 'host'; this.online = true; this.gid = rid(8); this.hostPeer = this.me;
    this.lobby = { open: true, seats: [{ human: true, owner: this.me, name: this.myName, icon: this.myIcon, team: 0 }] };
    this.publishLobby();
  },
  publishLobby() {
    if (!this.isHost() || !this.lobby) return;
    this.lobby.cfg = syncedCfg();
    this.emit({ t: 'lobby', gid: this.gid, lobby: this.lobby });
    this.setPresence({ game: { gid: this.gid, name: this.myName, open: this.lobby.open, n: this.lobby.seats.length } });
    this.lobbyT = performance.now();
  },
  uniqueName(n, self) {
    n = String(n || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 16) || 'Player';
    let name = n, k = 2;
    while (this.lobby.seats.some(s => s !== self && s.name === name)) name = n.slice(0, 13) + ' ' + (k++);
    return name;
  },
  onJoin(from, m) {
    if (!this.lobby.open) {
      if (!Game.players.some(p => p.owner === from)) this.emit({ t: 'kick', gid: this.gid, to: from, reason: 'That game has already started.' });
      return;
    }
    const seats = this.lobby.seats;
    let s = seats.find(x => x.owner === from);
    if (!s) {
      if (seats.length >= 10) { this.emit({ t: 'kick', gid: this.gid, to: from, reason: 'That game is full.' }); return; }
      s = { human: true, owner: from, name: '', icon: clamp(m.icon | 0, 0, TankIcons.length - 1), team: seats.length % 2 };
      seats.push(s);
      Sound.seq([[660, 0.05], [990, 0.06]], 0.3);
    }
    s.name = this.uniqueName(m.name, s);
    this.publishLobby();
  },
  onSeat(from, m) {
    if (!this.lobby || !this.lobby.open) return;
    const s = this.lobby.seats.find(x => x.owner === from);
    if (!s) return;
    if (m.icon !== undefined) s.icon = clamp(m.icon | 0, 0, TankIcons.length - 1);
    this.publishLobby();
  },
  addComputer() {
    if (this.lobby.seats.length >= 10) { Sound.error(); return; }
    const taken = new Set(this.lobby.seats.map(s => s.name));
    const names = Data.computerNames.filter(n => !taken.has(n));
    this.lobby.seats.push({ human: false, owner: null, ai: 'Tosser', name: pick(names.length ? names : Data.computerNames), icon: 0, team: this.lobby.seats.length % 2 });
    this.publishLobby();
  },
  removeSeat(i) {
    const s = this.lobby.seats[i];
    if (!s || s.owner === this.me) { Sound.error(); return; }
    if (s.human) this.emit({ t: 'kick', gid: this.gid, to: s.owner, reason: 'The host removed you from the game.' });
    this.lobby.seats.splice(i, 1);
    this.publishLobby();
  },
  startGame() {
    const seats = this.lobby.seats;
    if (seats.length < 2) { Sound.error(); return false; }
    this.lobby.open = false;
    this.publishLobby();
    const players = seats.map((s, i) => {
      const p = Game.newPlayer(i);
      Object.assign(p, { name: s.name, ai: s.human ? null : s.ai, icon: s.icon | 0, team: s.team | 0, owner: s.human ? s.owner : null, cash: Cfg.cashAtStart, inv: {}, fuel: 0 });
      return Game.netPlayer(p);
    });
    this.hostCommand({ c: 'start', players, cfg: syncedCfg(), seed: irand(1, 1e6) });
    return true;
  },

  /* ---------- host: the command stream ---------- */
  // Commands issued during one task (a frame, or one incoming request) leave together, so a
  // follower always gets a same-moment batch (a synchronous volley) whole.
  hostCommand(c) {
    c.k = Battle.tick;
    const m = { t: 'cmd', gid: this.gid, seq: ++this.seq, c };
    this.log.push(m);
    this.out.push(m);
    if (!this.flushQ) { this.flushQ = true; queueMicrotask(() => this.flush()); }
    this.dispatch(c);
  },
  flush(now) {
    this.flushQ = false;
    const gap = (this.tr && this.tr.minGap) || 0;
    if (!now && gap && performance.now() - this.lastFlush < gap) { this.flushLater = true; return; }   // Net.update sends it
    this.flushLater = false;
    const ms = this.out;
    if (!ms.length) return;
    this.out = [];
    this.lastFlush = performance.now();
    if (ms.length === 1) this.emit(ms[0]);
    else this.emit({ t: 'cmds', gid: this.gid, ms });
  },
  dispatch(c) {
    if (GAME_CMDS.has(c.c)) Game.exec(c);
    else if (c.c !== 'tk') Battle.exec(c);
  },
  resend(to, from) {
    if (from < 1 || from > this.seq) return;
    this.flush(true);
    // everything from there on, in one message (split into parts if it is big)
    let end = Math.min(this.seq, from + 399);
    while (end < this.seq && this.log[end].c.k === this.log[end - 1].c.k) end++;   // never split a same-moment batch
    this.emit({ t: 'cmds', gid: this.gid, to, ms: this.log.slice(from - 1, end) });
  },
  onReq(from, m) {
    const c = m.c;
    if (!c || typeof c !== 'object' || typeof c.c !== 'string') return;
    const seen = this.seenReq[from] || (this.seenReq[from] = []);
    const id = m.id | 0;
    if (seen.includes(id)) return;
    seen.push(id);
    if (seen.length > 200) seen.shift();
    if (c.c === 'shopdone') { Game.onShopDone(from, c); return; }
    if (App.scene === BattleScene) Battle.onRequest(from, c);
  },
  // send snapshots to machines that drifted, at a quiet moment
  serveSnaps() {
    if (!this.snapTo.size) return;
    const inB = this.inBattle();
    if (inB && !Battle.settled()) return;
    const snap = { t: 'snap', gid: this.gid, seq: this.seq, game: Game.netState(), battle: inB ? Battle.snapshot() : null };
    for (const to of this.snapTo) this.emit(Object.assign({}, snap, { to }));
    this.snapTo.clear();
  },
  checkPeers(now) {
    const here = new Set(this.peers().map(p => p.peer));
    const owners = this.lobby && this.lobby.open
      ? this.lobby.seats.filter(s => s.human && s.owner !== this.me).map(s => s.owner)
      : Game.players.filter(p => !p.ai && p.owner && p.owner !== this.me).map(p => p.owner);
    for (const o of new Set(owners)) {
      if (here.has(o)) { delete this.goneT[o]; continue; }
      if (!this.goneT[o]) this.goneT[o] = now;
      else if (now - this.goneT[o] > 4000) { delete this.goneT[o]; this.peerGone(o); }
    }
  },
  peerGone(peer) {
    if (!this.isHost()) return;
    if (this.lobby && this.lobby.open) {
      const before = this.lobby.seats.length;
      this.lobby.seats = this.lobby.seats.filter(s => s.owner !== peer);
      if (this.lobby.seats.length !== before) this.publishLobby();
      return;
    }
    for (const p of Game.players) if (!p.ai && p.owner === peer) { p.owner = null; Game.onPlayerLeft(p); }
  },

  /* ---------- client ---------- */
  join(game) {
    this.role = 'client'; this.online = true; this.gid = game.gid; this.hostPeer = game.peer;
    this.seated = false; this.lobby = null; this.hostSeenT = performance.now();
    this.expect = 1; this.pend = new Map(); this.queue = [];
    this.sendJoin();
  },
  sendJoin() {
    this.emit({ t: 'join', gid: this.gid, to: this.hostPeer, name: this.myName, icon: this.myIcon });
    this.joinT = performance.now();
  },
  setIcon(i) {
    this.myIcon = i;
    if (this.isClient()) this.emit({ t: 'seat', gid: this.gid, to: this.hostPeer, icon: i });
    else if (this.isHost() && this.lobby) { const s = this.lobby.seats.find(x => x.owner === this.me); if (s) s.icon = i; this.publishLobby(); }
  },
  onLobby(m) {
    if (!m.lobby || !Array.isArray(m.lobby.seats)) return;
    this.lobby = m.lobby; this.hostSeenT = performance.now();
    this.seated = this.lobby.seats.some(s => s.owner === this.me);
  },
  request(c, important) {
    const m = { t: 'req', gid: this.gid, to: this.hostPeer, id: ++this.reqId, c };
    this.emit(m);
    if (important) this.pendingReq = { m, t: performance.now() };
  },
  onCmd(m) {
    this.hostSeenT = performance.now();
    const seq = m.seq | 0;
    if (!m.c || seq < this.expect || this.pend.has(seq)) return;
    this.pend.set(seq, m);
    while (this.pend.has(this.expect)) {
      const x = this.pend.get(this.expect);
      this.pend.delete(this.expect);
      this.expect++;
      // any command says the host got that far (after a round ends no more 'tk' markers come)
      this.horizon = Math.max(this.horizon, x.c.k | 0);
      if (x.c.c !== 'tk' || x.c.sum !== undefined) this.queue.push(x);
    }
    if (this.pend.size) this.nack();
  },
  nack(force) {
    const now = performance.now();
    if (!force && now - this.nackT < 600) return;
    if (now - this.nackT < 250) return;
    this.nackT = now;
    this.emit({ t: 'nack', gid: this.gid, to: this.hostPeer, from: this.expect });
  },
  inBattle() { return App.scene === BattleScene && Battle.tanks.length > 0; },
  canApply(m, lock) {
    if (!this.inBattle()) return true;
    const c = m.c;
    if (lock) return c.k <= Battle.tick;
    if (c.k === this.lastK) return true;    // same-moment batch (a synchronous volley)
    return Battle.settled();
  },
  applyNext(lock) {
    const m = this.queue.shift(), c = m.c;
    if (c.c === 'round') Battle.tick = c.k;
    else if (this.inBattle() && !lock && c.k > Battle.tick && Battle.settled()) Battle.tick = c.k;   // idle ticks change nothing
    if ((c.c === 'turn' || c.c === 'syncaim' || c.c === 'tk') && c.sum !== undefined && this.inBattle() && Battle.checksum() !== c.sum) this.requestSnap();
    this.lastK = c.k;
    this.clearPending(c);
    this.dispatch(c);
  },
  clearPending(c) {
    const p = this.pendingReq;
    if (!p) return;
    const pc = p.m.c;
    if (['turn', 'syncaim', 'round', 'roundover', 'shop', 'gameover'].includes(c.c) ||
      (c.tank !== undefined && c.tank === pc.tank && (c.c === pc.c || c.c === 'ready' || c.c === 'fire'))) this.pendingReq = null;
  },
  // run the shared simulation on a client: follow the host's commands (called from Battle.update)
  clientPump(dt) {
    const lock = Battle.mode === 'SIMULTANEOUS';
    this.acc += dt * Battle.speed();
    let budget = Math.floor(this.acc / TICK);
    this.acc -= budget * TICK;
    if (budget > 8) budget = 8;
    if (lock) {
      // keep about a tenth of a second behind the host: enough to ride out jitter
      const lag = this.horizon - Battle.tick;
      if (lag > 12) budget = Math.max(budget, lag - 6);
    }
    let guard = 0;
    while (guard++ < 8000) {
      while (this.queue.length && this.canApply(this.queue[0], lock)) {
        this.applyNext(lock);
        if (!this.inBattle()) { Sound.muted = false; return; }
      }
      if (lock) { if (Battle.tick >= this.horizon) break; }
      else if (Battle.settled() || this.pend.size) break;   // a gap: what is missing may belong to this moment
      const behind = !lock && this.queue.length > 0;
      if (budget <= 0 && !behind) break;
      if (budget > 0) budget--; else Sound.muted = true;
      Battle.simTick();
    }
    Sound.muted = false;
  },
  requestSnap() {
    if (this.snapWanted) return;
    this.snapWanted = true; this.snapT = performance.now();
    this.emit({ t: 'snapreq', gid: this.gid, to: this.hostPeer });
  },
  onSnap(m) {
    this.snapWanted = false;
    const seq = m.seq | 0;
    this.queue = this.queue.filter(x => x.seq > seq);
    for (const s of [...this.pend.keys()]) if (s <= seq) this.pend.delete(s);
    if (this.expect <= seq) this.expect = seq + 1;
    if (m.game) Game.applyNetState(m.game);
    if (m.battle) {
      Battle.loadSnapshot(m.battle);
      if (App.scene !== BattleScene) App.set(BattleScene);
      this.lastK = m.battle.k;
      this.horizon = Math.max(this.horizon, m.battle.k);
    }
  },
  hostGone(msg) {
    const quiet = Game.finished;
    this.leave(false);
    if (!quiet) messageBox([msg]);
  },

  /* ---------- both ---------- */
  leave(notify) {
    if (this.isHost()) this.flush(true);
    if (notify !== false && this.tr) {
      if (this.isHost()) this.emit({ t: 'bye', gid: this.gid });
      else if (this.isClient()) this.emit({ t: 'leave', gid: this.gid, to: this.hostPeer });
    }
    this.close();
    this.restoreCfg();
    Market.override = null;
    Game.active = false; Game.online = false;
    UI.clear();
    Sound.flightStop();
    App.set(new MainMenuScene());
  },
  saveCfg() { if (!this.savedCfg) this.savedCfg = JSON.parse(JSON.stringify(Cfg)); },
  restoreCfg() {
    if (!this.savedCfg) return;
    for (const k of SYNC_KEYS) Cfg[k] = this.savedCfg[k];
    this.savedCfg = null;
    applyGraphicsMode();
  },
  // every frame
  update(dt) {
    if (!this.tr) return;
    const now = performance.now();
    if (this.aimWant !== undefined && now - this.aimT > 60) {
      const a = this.aimWant, key = a ? [a.i, a.a, a.p, a.w].join(':') : '';
      if (key !== this.aimKey) { this.aimKey = key; this.aimT = now; this.setPresence({ aim: a }); }
    }
    for (const k in this.parts) if (now - this.parts[k].t > 20000) delete this.parts[k];
    if (this.isHost()) {
      if (this.lobby && this.lobby.open && now - this.lobbyT > 2500) this.publishLobby();
      if (this.flushLater && now - this.lastFlush >= ((this.tr && this.tr.minGap) || 0)) this.flush();
      // (commands still waiting to go out don't count yet, or followers would ask for them)
      if (this.lobby && !this.lobby.open && now - this.hbT > 1500) { this.hbT = now; this.emit({ t: 'hb', gid: this.gid, seq: this.seq - this.out.length }); }
      this.serveSnaps();
      this.checkPeers(now);
    } else if (this.isClient()) {
      if (!this.seated && (!this.lobby || this.lobby.open) && now - this.joinT > 2000) this.sendJoin();
      if (this.pendingReq && now - this.pendingReq.t > 2000) { this.emit(this.pendingReq.m); this.pendingReq.t = now; }
      if (this.snapWanted && now - this.snapT > 3000) { this.snapT = now; this.emit({ t: 'snapreq', gid: this.gid, to: this.hostPeer }); }
      if (this.pend.size) this.nack();
      if (!this.inBattle()) {
        let n = 0;
        while (this.queue.length && !this.inBattle() && n++ < 200) this.applyNext(false);
      }
      const hostHere = this.peer(this.hostPeer);
      if (hostHere) this.hostSeenT = Math.max(this.hostSeenT, now - 1);
      if (now - this.hostSeenT > 6000 && !hostHere) this.hostGone('Lost contact with the host.');
    }
  },
  // connection status in the corner of every screen during a network game
  drawOverlay(u) {
    if (!this.online) return;
    if (!this.connected) Font.draw(u, 'Connection lost...', 3, Screen.UH - 11, UIC.red, { shadow: UIC.black });
    else if (this.snapWanted) Font.draw(u, 'Resynchronizing...', 3, Screen.UH - 11, UIC.yellow, { shadow: UIC.black });
  }
};
