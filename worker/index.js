/* =====================================================================
   Scorched Opus on Cloudflare Workers: serves the game (static assets from
   dist/) and relays network games. Each room code gets its own Durable
   Object holding that room's WebSocket connections - the same protocol as
   server/server.js, so the game connects to either one unchanged.

     client -> server:  {op:'emit', data}    {op:'presence', data}    {op:'ping'}
     server -> client:  {op:'welcome', me, peers}  {op:'joined', peer}  {op:'left', peer}
                        {op:'presence', peer, data}  {op:'msg', from, data}  {op:'error', msg}

   The Worker keeps no game state: the host player's browser runs the game.
   ===================================================================== */
import { DurableObject } from 'cloudflare:workers';

const MAX_PEERS = 16;          // per room
const MAX_MSG = 512 * 1024;    // characters per message
const MAX_RATE = 240;          // messages per second per connection (extra are dropped)
const MAX_PRESENCE = 1500;     // presence rides in the socket attachment (2 KB limit)

function roomCode(url) {
  return String(url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
// answer a WebSocket with an error message and close it
function refuse(msg) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ op: 'error', msg }));
  server.close(1008, msg.slice(0, 100));
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/ws') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 });
      const code = roomCode(url);
      if (!code) return refuse('A room code is required.');
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keep-alive pings are answered without waking the room up
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"op":"ping"}', '{"op":"pong"}'));
    // Per-connection state lives in memory; the socket attachment only keeps what must
    // survive hibernation (id + presence), and is rewritten only when that changes.
    this.state = new Map();
  }
  info(ws) {
    let a = this.state.get(ws);
    if (!a) {
      const saved = ws.deserializeAttachment();
      if (!saved) return null;
      a = { id: saved.id, presence: saved.presence || {}, gone: !!saved.gone, count: 0, win: 0 };
      this.state.set(ws, a);
    }
    return a;
  }
  save(ws, a) { try { ws.serializeAttachment({ id: a.id, presence: a.presence, gone: a.gone }); } catch (e) { /* closed */ } }
  peers(except) {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = this.info(ws);
      if (a && !a.gone) out.push({ ws, a });
    }
    return out;
  }
  send(ws, obj) { try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) { /* closing */ } }
  broadcast(obj, except) { const s = JSON.stringify(obj); for (const p of this.peers(except)) this.send(p.ws, s); }

  async fetch() {
    const others = this.peers();
    if (others.length >= MAX_PEERS) return refuse('That room is full.');
    const [client, server] = Object.values(new WebSocketPair());
    const id = 'C' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    this.ctx.acceptWebSocket(server);
    const a = { id, presence: {}, gone: false, count: 0, win: 0 };
    this.state.set(server, a);
    this.save(server, a);
    this.send(server, { op: 'welcome', me: id, peers: others.map(p => ({ peer: p.a.id, presence: p.a.presence })) });
    this.broadcast({ op: 'joined', peer: id }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MSG) return;
    const a = this.info(ws);
    if (!a || a.gone) return;
    const now = Date.now();
    if (now - a.win > 1000) { a.win = now; a.count = 0; }
    if (++a.count > MAX_RATE) return;
    let m;
    try { m = JSON.parse(message); } catch (e) { return; }
    if (m && m.op === 'emit') {
      const data = m.data, to = data && typeof data.to === 'string' ? data.to : null;
      const out = JSON.stringify({ op: 'msg', from: a.id, data });
      for (const p of this.peers(ws)) if (!to || p.a.id === to) this.send(p.ws, out);
    } else if (m && m.op === 'presence') {
      let pres = m.data && typeof m.data === 'object' && !Array.isArray(m.data) ? m.data : {};
      if (JSON.stringify(pres).length > MAX_PRESENCE) pres = {};
      a.presence = pres;
      this.save(ws, a);
      this.broadcast({ op: 'presence', peer: a.id, data: pres }, ws);
    }
  }
  webSocketClose(ws, code, reason) {
    this.gone(ws);
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch (e) { /* already closed */ }
  }
  webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const a = this.info(ws);
    this.state.delete(ws);
    if (!a || a.gone) return;
    a.gone = true;
    this.save(ws, a);
    this.broadcast({ op: 'left', peer: a.id }, ws);
  }
}
