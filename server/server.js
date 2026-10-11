#!/usr/bin/env node
'use strict';
/* =====================================================================
   Scorched Opus game server: serves the game and relays network games.
   No dependencies - plain Node (18+).

     PORT=8080 node server/server.js      then open http://localhost:8080

   Players in the same room (a short code) see each other's messages and
   presence. The server keeps no game state: the host player's browser runs
   the game, and this only passes messages along.
   ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const MAX_PEERS = 16;            // per room
const MAX_ROOMS = 5000;
const MAX_MSG = 512 * 1024;      // bytes per message
const MAX_RATE = 240;            // messages per second per connection (extra are dropped)
const MAX_BACKLOG = 8 * 1024 * 1024;
const PUBLIC = new Set(['index.html', 'js', 'dist', 'README.md']);
if (process.env.SCORCH_DEV) PUBLIC.add('tools');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
};

/* ------------------------------------------------ static files */
function serveFile(req, res) {
  let url, rel;
  try { url = new URL(req.url, 'http://localhost'); rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const relPath = path.relative(ROOT, file);
  const top = relPath.split(path.sep)[0];
  if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath) || !PUBLIC.has(top)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}
function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }

/* ------------------------------------------------ WebSocket plumbing (RFC 6455) */
const rooms = new Map();   // code -> Map(peerId -> peer)
let nextId = 1;

function onUpgrade(req, socket) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const peer = {
    id: 'W' + (nextId++).toString(36) + crypto.randomBytes(3).toString('hex'), socket, room: null,
    presence: {}, buf: Buffer.alloc(0), frag: [], fragLen: 0, alive: true, closed: false, count: 0, windowStart: Date.now()
  };
  socket.on('data', d => { try { onData(peer, d); } catch (e) { drop(peer); } });
  socket.on('close', () => drop(peer));
  socket.on('error', () => drop(peer));

  const code = String(url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!code) return refuse(peer, 'A room code is required.');
  let room = rooms.get(code);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return refuse(peer, 'The server is busy. Try again later.');
    room = new Map();
    rooms.set(code, room);
  }
  if (room.size >= MAX_PEERS) return refuse(peer, 'That room is full.');
  peer.room = code;
  room.set(peer.id, peer);
  sendJSON(peer, { op: 'welcome', me: peer.id, peers: [...room.values()].filter(p => p !== peer).map(p => ({ peer: p.id, presence: p.presence })) });
  broadcast(room, peer, { op: 'joined', peer: peer.id });
}

function onData(peer, chunk) {
  if (peer.closed) return;
  peer.buf = peer.buf.length ? Buffer.concat([peer.buf, chunk]) : chunk;
  for (;;) {
    const b = peer.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; if (b.readUInt32BE(2) !== 0) return drop(peer); len = b.readUInt32BE(6); off = 10; }
    if (!masked || len > MAX_MSG) return drop(peer);      // clients must mask; no giant frames
    if (b.length < off + 4 + len) return;                  // wait for the rest of the frame
    const mask = b.subarray(off, off + 4), start = off + 4;
    const data = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) data[i] = b[start + i] ^ mask[i & 3];
    peer.buf = b.subarray(start + len);
    switch (op) {
      case 0x8: sendFrame(peer, Buffer.alloc(0), 0x8); peer.socket.end(); drop(peer); return;   // close
      case 0x9: sendFrame(peer, data, 0xA); break;                                              // ping
      case 0xA: peer.alive = true; break;                                                       // pong
      case 0x0: case 0x1: case 0x2:
        if (op !== 0x0) { peer.frag = []; peer.fragLen = 0; }
        peer.frag.push(data); peer.fragLen += len;
        if (peer.fragLen > MAX_MSG) return drop(peer);
        if (fin) {
          const text = Buffer.concat(peer.frag).toString('utf8');
          peer.frag = []; peer.fragLen = 0;
          onMessage(peer, text);
        }
        break;
      default: return drop(peer);
    }
  }
}

function onMessage(peer, text) {
  const now = Date.now();
  if (now - peer.windowStart > 1000) { peer.windowStart = now; peer.count = 0; }
  if (++peer.count > MAX_RATE) return;
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  const room = rooms.get(peer.room);
  if (!room) return;
  peer.alive = true;
  if (m.op === 'emit') {
    const data = m.data;
    const to = data && typeof data.to === 'string' ? data.to : null;
    const out = JSON.stringify({ op: 'msg', from: peer.id, data });
    if (to) { const p = room.get(to); if (p) sendText(p, out); }
    else for (const p of room.values()) if (p !== peer) sendText(p, out);
  } else if (m.op === 'presence') {
    let pres = m.data && typeof m.data === 'object' && !Array.isArray(m.data) ? m.data : {};
    if (JSON.stringify(pres).length > 8192) pres = {};
    peer.presence = pres;
    broadcast(room, peer, { op: 'presence', peer: peer.id, data: pres });
  }
}

function sendFrame(peer, payload, op) {
  if (peer.closed || peer.socket.destroyed) return;
  if (peer.socket.writableLength > MAX_BACKLOG) { drop(peer); return; }   // a connection that stopped reading
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.allocUnsafe(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.allocUnsafe(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.allocUnsafe(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = 0x80 | op;
  peer.socket.write(Buffer.concat([head, payload]));
}
function sendText(peer, s) { sendFrame(peer, Buffer.from(s, 'utf8'), 0x1); }
function sendJSON(peer, o) { sendText(peer, JSON.stringify(o)); }
function broadcast(room, from, o) {
  const s = JSON.stringify(o);
  for (const p of room.values()) if (p !== from) sendText(p, s);
}
function refuse(peer, msg) {
  sendJSON(peer, { op: 'error', msg });
  sendFrame(peer, Buffer.alloc(0), 0x8);
  peer.socket.end();
  setTimeout(() => drop(peer), 1000);
}
function drop(peer) {
  if (peer.closed) return;
  peer.closed = true;
  try { peer.socket.destroy(); } catch (e) { /* already gone */ }
  const room = rooms.get(peer.room);
  if (!room || !room.has(peer.id)) return;
  room.delete(peer.id);
  if (!room.size) rooms.delete(peer.room);
  else broadcast(room, null, { op: 'left', peer: peer.id });
}

// ping everyone now and then; drop connections that stopped answering
setInterval(() => {
  for (const room of rooms.values()) {
    for (const p of room.values()) {
      if (!p.alive) { drop(p); continue; }
      p.alive = false;
      sendFrame(p, Buffer.alloc(0), 0x9);
    }
  }
}, 25000);

const server = http.createServer(serveFile);
server.on('upgrade', onUpgrade);
server.listen(PORT, HOST, () => {
  console.log('Scorched Opus server on http://localhost:' + PORT + '  (network games at ws://<this host>:' + PORT + '/ws)');
});
