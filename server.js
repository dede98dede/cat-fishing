/**
 * 桌面摸鱼猫 — 零依赖 Node.js 实时联机服务端 (HTTP + RFC 6455 WebSocket)
 * 启动方式: node server.js
 * 默认端口: process.env.PORT || 3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// rooms: Map<roomId, { clients: Map<clientId, ClientObj>, sharedFish: Array, messages: Array }>
const rooms = new Map();

function getRoom(roomId) {
  const cleanId = String(roomId || 'public').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'public';
  if (!rooms.has(cleanId)) {
    rooms.set(cleanId, {
      id: cleanId,
      clients: new Map(),
      sharedFish: [],
      messages: [
        { sender: '系统', text: `欢迎来到联机鱼塘「${cleanId}」🎣`, time: nowTime(), system: true }
      ]
    });
  }
  return rooms.get(cleanId);
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- Minimal RFC 6455 WebSocket Framing ----------
function encodeFrame(str, opcode = 0x1) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function sendJson(client, obj) {
  if (!client || client.closed || client.socket.destroyed) return;
  try {
    client.socket.write(encodeFrame(JSON.stringify(obj), 0x1));
  } catch (e) {}
}

function broadcastRoom(room, obj, excludeId = null) {
  const frame = encodeFrame(JSON.stringify(obj), 0x1);
  for (const [id, c] of room.clients.entries()) {
    if (excludeId && id === excludeId) continue;
    if (!c.closed && !c.socket.destroyed) {
      try { c.socket.write(frame); } catch (e) {}
    }
  }
}

function serializeRoom(room) {
  const players = [];
  for (const c of room.clients.values()) {
    players.push({
      id: c.id,
      nickname: c.nickname,
      skin: c.skin,
      level: c.level,
      coins: c.coins,
      fishingPhase: c.fishingPhase,
      bobberX: c.bobberX
    });
  }
  return {
    type: 'room_sync',
    roomId: room.id,
    players,
    sharedFish: room.sharedFish.slice(-16),
    messages: room.messages.slice(-25)
  };
}


// ---------- Global Real-Time Fish Market Engine ----------
const MARKET_RARITIES = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
const MARKET_EVENTS = [
  { text: '📈 国际海鲜美食节开幕！传说/神话海鱼需求大涨', bias: { legendary: 0.16, mythic: 0.18 } },
  { text: '🌊 暖流来袭鱼群大丰收，普通/优良鱼价小幅回调', bias: { common: -0.10, uncommon: -0.08, rare: 0.08 } },
  { text: '👑 神秘富豪高价收购史诗与传说海鱼！', bias: { epic: 0.15, legendary: 0.14 } },
  { text: '⚡ 深海航线波动，全线海鱼行情剧烈震荡', bias: { common: 0.06, rare: -0.09, mythic: 0.14 } },
  { text: '🍣 顶级寿司店紧急补货，稀有/史诗海鱼拉升！', bias: { rare: 0.14, epic: 0.12 } }
];
const globalMarket = {
  news: '📊 全服实时鱼市已开盘！所有玩家交易共同影响行情',
  indices: {
    common:    { mult: 1.00, prev: 1.00, history: [0.96, 1.02, 0.99, 1.00] },
    uncommon:  { mult: 1.05, prev: 1.00, history: [0.98, 1.01, 1.00, 1.05] },
    rare:      { mult: 1.12, prev: 1.06, history: [1.00, 1.04, 1.06, 1.12] },
    epic:      { mult: 0.94, prev: 0.98, history: [1.05, 1.01, 0.98, 0.94] },
    legendary: { mult: 1.18, prev: 1.10, history: [1.02, 1.07, 1.10, 1.18] },
    mythic:    { mult: 1.25, prev: 1.15, history: [1.04, 1.11, 1.15, 1.25] }
  }
};

function broadcastAllRooms(obj) {
  const frame = encodeFrame(JSON.stringify(obj), 0x1);
  for (const room of rooms.values()) {
    for (const c of room.clients.values()) {
      if (!c.closed && !c.socket.destroyed) {
        try { c.socket.write(frame); } catch (e) {}
      }
    }
  }
}

setInterval(() => {
  let evBias = {};
  if (Math.random() < 0.25) {
    const ev = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
    globalMarket.news = ev.text;
    evBias = ev.bias || {};
  }
  for (const r of MARKET_RARITIES) {
    const idx = globalMarket.indices[r];
    idx.prev = idx.mult;
    const meanPull = (1.05 - idx.mult) * 0.12;
    const noise = (Math.random() - 0.49) * 0.16;
    const next = Math.max(0.55, Math.min(2.40, +(idx.mult + meanPull + noise + (evBias[r] || 0)).toFixed(2)));
    idx.mult = next;
    idx.history.push(next);
    if (idx.history.length > 18) idx.history.shift();
  }
  broadcastAllRooms({ type: 'market_sync', news: globalMarket.news, indices: globalMarket.indices });
}, 4000);

function leaveCurrentRoom(client) {
  if (!client.room) return;
  const room = client.room;
  room.clients.delete(client.id);
  client.room = null;
  if (room.clients.size === 0) {
    if (room.id !== 'public') rooms.delete(room.id);
  } else {
    broadcastRoom(room, serializeRoom(room));
  }
}

function handleMessage(client, rawText) {
  let msg;
  try { msg = JSON.parse(rawText); } catch (e) { return; }
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'join') {
    leaveCurrentRoom(client);
    client.nickname = String(msg.nickname || '摸鱼达人').trim().slice(0, 12) || '摸鱼达人';
    client.skin = String(msg.skin || 'orange').slice(0, 16);
    client.level = Math.max(1, Math.min(999, Number(msg.level) || 1));
    client.coins = Math.max(0, Math.floor(Number(msg.coins) || 0));
    client.fishingPhase = msg.fishingPhase === 'waiting' ? 'waiting' : 'idle';

    const room = getRoom(msg.roomId);
    client.room = room;
    room.clients.set(client.id, client);

    sendJson(client, { type: 'welcome', clientId: client.id, roomId: room.id });
    sendJson(client, { type: 'market_sync', news: globalMarket.news, indices: globalMarket.indices });
    broadcastRoom(room, serializeRoom(room));
    return;
  }

  const room = client.room;
  if (!room) return;

  if (msg.type === 'state') {
    if (msg.nickname) client.nickname = String(msg.nickname).trim().slice(0, 12) || client.nickname;
    if (msg.skin) client.skin = String(msg.skin).slice(0, 16);
    if (typeof msg.level === 'number') client.level = Math.max(1, Math.min(999, Math.floor(msg.level)));
    if (typeof msg.coins === 'number') client.coins = Math.max(0, Math.floor(msg.coins));
    if (msg.fishingPhase) client.fishingPhase = msg.fishingPhase === 'waiting' ? 'waiting' : 'idle';
    if (typeof msg.bobberX === 'number') client.bobberX = Math.max(0.48, Math.min(0.92, msg.bobberX));
    broadcastRoom(room, serializeRoom(room));
  } else if (msg.type === 'add_fish') {
    const speciesId = String(msg.speciesId || 'goldfish').slice(0, 20);
    room.sharedFish.push({
      uid: 'sf_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
      owner: client.nickname,
      ownerId: client.id,
      speciesId,
      x: 0.15 + Math.random() * 0.7,
      y: 0.56 + Math.random() * 0.32,
      vx: (Math.random() > 0.5 ? 1 : -1) * (0.04 + Math.random() * 0.04),
      vy: (Math.random() - 0.5) * 0.015,
      phase: Math.random() * 6.28,
      growth: 50
    });
    if (room.sharedFish.length > 16) room.sharedFish.shift();
    broadcastRoom(room, serializeRoom(room));
  } else if (msg.type === 'chat') {
    const text = String(msg.text || '').trim().slice(0, 40);
    if (!text) return;
    const item = { sender: client.nickname, text, time: nowTime(), system: false };
    room.messages.push(item);
    if (room.messages.length > 30) room.messages.shift();
    broadcastRoom(room, { type: 'chat_broadcast', item, senderId: client.id });
  } else if (msg.type === 'pet_friend') {
    const target = room.clients.get(String(msg.targetId || ''));
    if (!target) return;
    const item = {
      sender: '系统',
      text: `🐾 ${client.nickname} 摸了摸 ${target.nickname} 的小猫！`,
      time: nowTime(),
      system: true
    };
    room.messages.push(item);
    if (room.messages.length > 30) room.messages.shift();
    broadcastRoom(room, {
      type: 'pet_event',
      fromId: client.id,
      fromName: client.nickname,
      targetId: target.id,
      targetName: target.nickname,
      item
    });
  } else if (msg.type === 'market_trade') {
    const r = String(msg.rarity || '');
    const idx = globalMarket.indices[r];
    if (!idx) return;
    const delta = msg.side === 'buy' ? 0.03 : -0.03;
    idx.prev = idx.mult;
    idx.mult = Math.max(0.55, Math.min(2.40, +(idx.mult + delta).toFixed(2)));
    idx.history.push(idx.mult);
    if (idx.history.length > 18) idx.history.shift();
    broadcastAllRooms({ type: 'market_sync', news: globalMarket.news, indices: globalMarket.indices });
  }
}

// ---------- HTTP Static Server ----------
const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const safePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(fullPath);
  const mime = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(fullPath).pipe(res);
});

// ---------- WebSocket Upgrade Handler ----------
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const client = {
    id: 'p_' + crypto.randomBytes(4).toString('hex'),
    socket,
    closed: false,
    room: null,
    nickname: '摸鱼达人',
    skin: 'orange',
    level: 1,
    coins: 50,
    fishingPhase: 'idle',
    bobberX: 0.65 + Math.random() * 0.2,
    buffer: Buffer.alloc(0)
  };

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const b0 = client.buffer[0];
      const b1 = client.buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (client.buffer.length < 4) return;
        payloadLen = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (client.buffer.length < 10) return;
        payloadLen = Number(client.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (client.buffer.length < offset + maskLen + payloadLen) return;

      const maskKey = masked ? client.buffer.subarray(offset, offset + 4) : null;
      offset += maskLen;
      const payload = Buffer.from(client.buffer.subarray(offset, offset + payloadLen));
      client.buffer = client.buffer.subarray(offset + payloadLen);

      if (masked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i & 3];
        }
      }

      if (opcode === 0x8) {
        client.closed = true;
        leaveCurrentRoom(client);
        socket.end();
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        try { socket.write(encodeFrame(payload.toString('utf8'), 0xA)); } catch (e) {}
      } else if (opcode === 0x1) {
        handleMessage(client, payload.toString('utf8'));
      }
    }
  });

  const onClose = () => {
    if (client.closed) return;
    client.closed = true;
    leaveCurrentRoom(client);
  };
  socket.on('close', onClose);
  socket.on('error', onClose);
});

server.listen(PORT, () => {
  console.log(`🐱 桌面摸鱼猫联机服务已启动: http://localhost:${PORT}`);
});
