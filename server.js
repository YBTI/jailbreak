// 午前1時の大脱走 オンライン対戦サーバー (HTTP + WebSocket)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url === '/' || url.startsWith('/room/')) url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();   // code -> Game
const sockets = new Map(); // ws -> {code, pid}

const rid = n => crypto.randomBytes(n).toString('hex');
function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(c));
  return c;
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast(game) {
  for (const [ws, info] of sockets) {
    if (info.code === game.code) send(ws, { type: 'state', state: game.view(info.pid) });
  }
}

function setConnected(game, pid) {
  const pl = game.p(pid);
  if (!pl) return;
  pl.connected = [...sockets.values()].some(s => s.code === game.code && s.pid === pid);
}

function cleanName(n) {
  n = String(n || '').trim().replace(/[<>]/g, '').slice(0, 12);
  return n || '名無しの囚人';
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      handle(ws, msg);
    } catch (e) {
      send(ws, { type: 'error', message: e.message || 'エラーが発生しました' });
    }
  });

  ws.on('close', () => {
    const info = sockets.get(ws);
    sockets.delete(ws);
    if (!info) return;
    const game = rooms.get(info.code);
    if (!game) return;
    setConnected(game, info.pid);
    broadcast(game);
  });
});

function handle(ws, msg) {
  const info = sockets.get(ws);
  switch (msg.type) {
    case 'create': {
      const code = newCode();
      const game = new Game(code);
      rooms.set(code, game);
      const pid = rid(6), token = rid(16);
      game.addPlayer(pid, token, cleanName(msg.name));
      sockets.set(ws, { code, pid });
      send(ws, { type: 'joined', code, pid, token });
      broadcast(game);
      return;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const game = rooms.get(code);
      if (!game) throw new Error('部屋が見つかりません');
      const pid = rid(6), token = rid(16);
      game.addPlayer(pid, token, cleanName(msg.name));
      sockets.set(ws, { code, pid });
      send(ws, { type: 'joined', code, pid, token });
      broadcast(game);
      return;
    }
    case 'rejoin': {
      const game = rooms.get(String(msg.code || '').toUpperCase());
      const pl = game && game.p(msg.pid);
      if (!pl || pl.token !== msg.token) { send(ws, { type: 'rejoinFailed' }); return; }
      sockets.set(ws, { code: game.code, pid: pl.id });
      pl.connected = true;
      send(ws, { type: 'joined', code: game.code, pid: pl.id, token: pl.token });
      broadcast(game);
      return;
    }
  }

  if (!info) throw new Error('部屋に入っていません');
  const game = rooms.get(info.code);
  if (!game) throw new Error('部屋が見つかりません');
  game.lastActive = Date.now();
  const pid = info.pid;

  switch (msg.type) {
    case 'leave':
      if (game.phase === 'lobby') game.removePlayer(pid);
      sockets.delete(ws);
      send(ws, { type: 'left' });
      if (game.players.length === 0) rooms.delete(game.code);
      break;
    case 'settings': game.updateSettings(pid, msg.settings || {}); break;
    case 'start': game.start(pid); break;
    case 'next': game.nextRound(pid); break;
    case 'lobby': game.backToLobby(pid); break;
    case 'add': game.add(pid, msg.cardId); break;
    case 'play': game.play(pid, msg.cardIds); break;
    case 'pass': game.pass(pid); break;
    case 'take': game.take(pid, msg.cardIds); break;
    case 'ping': return;
    default: throw new Error('不明な操作です');
  }
  broadcast(game);
}

// 接続の生存確認 & 放置部屋の掃除
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, g] of rooms) {
    const anyone = [...sockets.values()].some(s => s.code === code);
    if (!anyone && now - g.lastActive > 60 * 60 * 1000) rooms.delete(code);
  }
}, 30000);

server.listen(PORT, () => console.log(`午前1時の大脱走 server: http://localhost:${PORT}`));
