const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

const WORLD = {
  width: 1280,
  height: 720,
  groundY: 650,
  netX: 640,
  netHeight: 190,
  netWidth: 26,
  playerRadius: 36,
  ballRadius: 22,
  gravity: 2100,
  playerSpeed: 420,
  jumpVelocity: 850,
  diveVelocity: 1150,
  dashSpeed: 1040,
  dashDuration: 0.16,
  dashCooldown: 0.34,
  scoreLimit: 13,
  serveDelay: 1.15,
};

const INPUT_KEYS = ['left', 'right', 'up', 'down'];
const rooms = new Map();
let nextClientId = 1;

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let requested = decodeURIComponent(url.pathname);
  if (requested === '/') requested = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function makePlayer(side) {
  const leftSide = side === 'left';
  return {
    side,
    x: leftSide ? 260 : 1020,
    y: WORLD.groundY - WORLD.playerRadius,
    vx: 0,
    vy: 0,
    radius: WORLD.playerRadius,
    color: leftSide ? '#18a8ff' : '#ff6262',
    onGround: true,
    dashTime: 0,
    dashCooldown: 0,
    dashX: 0,
    dashY: 0,
  };
}

function makeBall(servingSide = 'left') {
  const dir = servingSide === 'left' ? 1 : -1;
  return {
    x: servingSide === 'left' ? 360 : 920,
    y: 230,
    vx: 260 * dir,
    vy: -130,
    radius: WORLD.ballRadius,
  };
}

function createRoom(code) {
  const room = {
    code,
    players: [null, null],
    spectators: new Set(),
    inputs: [{ left: false, right: false, up: false, down: false }, { left: false, right: false, up: false, down: false }],
    state: {
      players: [makePlayer('left'), makePlayer('right')],
      ball: makeBall('left'),
      scores: [0, 0],
      winner: null,
      paused: true,
      countdown: WORLD.serveDelay,
      message: 'Waiting for second player...',
    },
    lastTick: Date.now(),
    interval: null,
  };

  room.interval = setInterval(() => tickRoom(room), 1000 / 60);
  rooms.set(code, room);
  return room;
}

function roomSnapshot(room) {
  return {
    type: 'state',
    world: WORLD,
    code: room.code,
    playersConnected: room.players.map(Boolean),
    state: room.state,
  };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room, payload) {
  const raw = JSON.stringify(payload);
  for (const ws of [...room.players, ...room.spectators]) {
    if (ws && ws.readyState === ws.OPEN) ws.send(raw);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resetRound(room, servingSide, message) {
  room.state.players = [makePlayer('left'), makePlayer('right')];
  room.state.ball = makeBall(servingSide);
  room.state.paused = true;
  room.state.countdown = WORLD.serveDelay;
  room.state.message = message;
  room.inputs = [{ left: false, right: false, up: false, down: false }, { left: false, right: false, up: false, down: false }];
}

function scorePoint(room, scorerIndex) {
  room.state.scores[scorerIndex] += 1;
  if (room.state.scores[scorerIndex] >= WORLD.scoreLimit) {
    room.state.winner = scorerIndex;
    room.state.paused = true;
    room.state.message = `Player ${scorerIndex + 1} wins!`;
    return;
  }

  const servingSide = scorerIndex === 0 ? 'right' : 'left';
  resetRound(room, servingSide, `Point for Player ${scorerIndex + 1}!`);
}

function updatePlayer(player, input, dt) {
  if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);

  if (player.dashTime > 0) {
    player.dashTime = Math.max(0, player.dashTime - dt);
    player.vx = player.dashX * WORLD.dashSpeed;
    player.vy = player.dashY * WORLD.dashSpeed;
  } else {
    const move = Number(input.right) - Number(input.left);
    player.vx = move * WORLD.playerSpeed;

    if (input.up && player.onGround) {
      player.vy = -WORLD.jumpVelocity;
      player.onGround = false;
    }

    if (input.down && !player.onGround) {
      player.vy = Math.max(player.vy, WORLD.diveVelocity);
    }

    player.vy += WORLD.gravity * dt;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  const half = player.side === 'left'
    ? [player.radius, WORLD.netX - WORLD.netWidth / 2 - player.radius]
    : [WORLD.netX + WORLD.netWidth / 2 + player.radius, WORLD.width - player.radius];
  player.x = clamp(player.x, half[0], half[1]);

  if (player.y >= WORLD.groundY - player.radius) {
    player.y = WORLD.groundY - player.radius;
    player.vy = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }
}

function resolveCircleCollision(a, b, bounce) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 0.0001;
  const minDistance = a.radius + b.radius;
  if (distance >= minDistance) return false;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relativeVelocity < 0) {
    const impulse = -(1 + bounce) * relativeVelocity;
    b.vx += impulse * nx + a.vx * 0.18;
    b.vy += impulse * ny + a.vy * 0.18;
  }

  return true;
}

function updateBall(room, dt) {
  const ball = room.state.ball;
  ball.vy += WORLD.gravity * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < ball.radius) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx) * 0.82;
  }
  if (ball.x > WORLD.width - ball.radius) {
    ball.x = WORLD.width - ball.radius;
    ball.vx = -Math.abs(ball.vx) * 0.82;
  }
  if (ball.y < ball.radius) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy) * 0.82;
  }

  const netTop = WORLD.groundY - WORLD.netHeight;
  const netLeft = WORLD.netX - WORLD.netWidth / 2;
  const netRight = WORLD.netX + WORLD.netWidth / 2;
  if (ball.y + ball.radius > netTop && ball.x + ball.radius > netLeft && ball.x - ball.radius < netRight) {
    if (ball.y < netTop && ball.vy > 0) {
      ball.y = netTop - ball.radius;
      ball.vy = -Math.abs(ball.vy) * 0.72;
    } else if (ball.x < WORLD.netX) {
      ball.x = netLeft - ball.radius;
      ball.vx = -Math.abs(ball.vx) * 0.78;
    } else {
      ball.x = netRight + ball.radius;
      ball.vx = Math.abs(ball.vx) * 0.78;
    }
  }

  for (const player of room.state.players) {
    resolveCircleCollision(player, ball, 0.72);
  }

  ball.vx *= Math.pow(0.996, dt * 60);

  if (ball.y >= WORLD.groundY - ball.radius) {
    const scorerIndex = ball.x < WORLD.netX ? 1 : 0;
    scorePoint(room, scorerIndex);
  }
}

function tickRoom(room) {
  const now = Date.now();
  const dt = Math.min((now - room.lastTick) / 1000, 0.05);
  room.lastTick = now;

  if (room.players[0] && room.players[1] && !room.state.winner) {
    if (room.state.paused) {
      room.state.countdown -= dt;
      if (room.state.countdown <= 0) {
        room.state.paused = false;
        room.state.message = '';
      }
    } else {
      room.state.players.forEach((player, index) => updatePlayer(player, room.inputs[index], dt));
      updateBall(room, dt);
    }
  }

  broadcast(room, roomSnapshot(room));

  if (!room.players[0] && !room.players[1] && room.spectators.size === 0) {
    clearInterval(room.interval);
    rooms.delete(room.code);
  }
}

function startDash(room, playerIndex, direction) {
  const player = room.state.players[playerIndex];
  if (!player || player.dashCooldown > 0 || room.state.paused || room.state.winner !== null) return;

  const vector = {
    left: [-1, 0],
    right: [1, 0],
    up: [0, -1],
    down: [0, 1],
  }[direction];

  player.dashX = vector[0];
  player.dashY = vector[1];
  player.dashTime = WORLD.dashDuration;
  player.dashCooldown = WORLD.dashCooldown;
  player.onGround = false;
}

function normalizeRoomCode(value) {
  return String(value || 'beach').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || 'BEACH';
}

function getLanHints() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => `http://${info.address}:${PORT}`);
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.clientId = nextClientId++;
  ws.room = null;
  ws.playerIndex = null;

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      send(ws, { type: 'error', message: 'Invalid JSON message.' });
      return;
    }

    if (message.type === 'join') {
      const code = normalizeRoomCode(message.room);
      const room = rooms.get(code) || createRoom(code);
      const requested = message.side === 'right' ? 1 : message.side === 'left' ? 0 : -1;
      let playerIndex = requested;
      if (playerIndex < 0 || room.players[playerIndex]) {
        playerIndex = room.players[0] ? (room.players[1] ? -1 : 1) : 0;
      }

      ws.room = room;
      if (playerIndex === -1) {
        room.spectators.add(ws);
        send(ws, { type: 'joined', role: 'spectator', room: code });
      } else {
        room.players[playerIndex] = ws;
        ws.playerIndex = playerIndex;
        send(ws, { type: 'joined', role: 'player', playerIndex, room: code });
        if (room.players[0] && room.players[1] && room.state.message === 'Waiting for second player...') {
          resetRound(room, 'left', 'Match starts!');
        }
      }
      send(ws, roomSnapshot(room));
      return;
    }

    const room = ws.room;
    if (!room || ws.playerIndex === null) return;

    if (message.type === 'input') {
      for (const key of INPUT_KEYS) {
        room.inputs[ws.playerIndex][key] = Boolean(message.keys && message.keys[key]);
      }
      return;
    }

    if (message.type === 'dash' && INPUT_KEYS.includes(message.direction)) {
      startDash(room, ws.playerIndex, message.direction);
      return;
    }

    if (message.type === 'restart' && room.state.winner !== null) {
      room.state.scores = [0, 0];
      room.state.winner = null;
      resetRound(room, 'left', 'New match!');
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;

    if (ws.playerIndex !== null && room.players[ws.playerIndex] === ws) {
      room.players[ws.playerIndex] = null;
      room.state.paused = true;
      room.state.message = 'Opponent disconnected. Waiting...';
    } else {
      room.spectators.delete(ws);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Beachball server running on http://localhost:${PORT}`);
  const hints = getLanHints();
  if (hints.length) console.log(`LAN/Radmin VPN addresses: ${hints.join(', ')}`);
});
