const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const introPanel = document.getElementById('introPanel');
const joinForm = document.getElementById('joinForm');
const serverUrlInput = document.getElementById('serverUrl');
const roomCodeInput = document.getElementById('roomCode');
const sideSelect = document.getElementById('sideSelect');
const statusText = document.getElementById('statusText');
const scoreLeft = document.getElementById('scoreLeft');
const scoreRight = document.getElementById('scoreRight');
const restartButton = document.getElementById('restartButton');

const keyMap = {
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
const keyLabels = { left: 'A', right: 'D', up: 'W', down: 'S' };
const keys = { left: false, right: false, up: false, down: false };
const lastTap = { left: 0, right: 0, up: 0, down: 0 };
const dashTapWindow = 250;

let socket;
let playerIndex = null;
let role = 'offline';
let latest = null;
let world = {
  width: 1280,
  height: 720,
  groundY: 650,
  netX: 640,
  netHeight: 190,
  netWidth: 26,
  playerRadius: 36,
  ballRadius: 22,
  scoreLimit: 13,
};

serverUrlInput.value = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function updateInput() {
  send({ type: 'input', keys });
}

function setStatus(text) {
  statusText.textContent = text;
}

function joinGame(event) {
  event.preventDefault();
  const url = serverUrlInput.value.trim() || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const room = roomCodeInput.value.trim() || 'BEACH';
  playerIndex = null;
  role = 'connecting';
  setStatus('Подключение...');

  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    send({ type: 'join', room, side: sideSelect.value });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'joined') {
      role = message.role;
      playerIndex = message.playerIndex ?? null;
      introPanel.hidden = true;
      setStatus(role === 'player' ? `Ты Игрок ${playerIndex + 1}, комната ${message.room}` : `Наблюдатель, комната ${message.room}`);
      return;
    }

    if (message.type === 'state') {
      world = message.world;
      latest = message.state;
      scoreLeft.textContent = latest.scores[0];
      scoreRight.textContent = latest.scores[1];
      restartButton.hidden = latest.winner === null || role !== 'player';
      const connected = message.playersConnected.filter(Boolean).length;
      if (latest.winner !== null) {
        setStatus(`Победил Игрок ${latest.winner + 1}! Нажми «Новый матч».`);
      } else if (latest.message) {
        const countdown = latest.paused && latest.countdown > 0 && connected === 2 ? ` ${Math.ceil(latest.countdown)}` : '';
        setStatus(`${latest.message}${countdown}`);
      } else {
        setStatus(role === 'player' ? `Ты Игрок ${playerIndex + 1}. Игра до ${world.scoreLimit}.` : 'Наблюдение за матчем.');
      }
    }
  });
  socket.addEventListener('close', () => {
    setStatus('Соединение закрыто. Проверь IP Radmin VPN и перезайди.');
    introPanel.hidden = false;
    role = 'offline';
  });
  socket.addEventListener('error', () => {
    setStatus('Ошибка подключения. Используй ws://RADMIN-IP:3000');
  });
}

function handleKeyDown(event) {
  const direction = keyMap[event.code];
  if (!direction) return;
  event.preventDefault();

  if (!keys[direction]) {
    const now = performance.now();
    if (now - lastTap[direction] <= dashTapWindow) {
      send({ type: 'dash', direction });
      lastTap[direction] = 0;
    } else {
      lastTap[direction] = now;
    }
    keys[direction] = true;
    updateInput();
  }
}

function handleKeyUp(event) {
  const direction = keyMap[event.code];
  if (!direction) return;
  event.preventDefault();
  keys[direction] = false;
  updateInput();
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, world.height);
  sky.addColorStop(0, '#69d6ef');
  sky.addColorStop(0.52, '#dff8ff');
  sky.addColorStop(0.53, '#22bde0');
  sky.addColorStop(0.66, '#61e1e5');
  sky.addColorStop(0.67, '#ffe8b3');
  sky.addColorStop(1, '#ffd98a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, world.width, world.height);

  drawSun(210, 90, 70);
  drawCloud(930, 120, 1.3);
  drawCloud(270, 250, 0.85);

  ctx.fillStyle = '#ffffff88';
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.ellipse(170 + i * 230, 560 + Math.sin(i) * 18, 120, 9, -0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#2c8f38';
  ctx.beginPath();
  ctx.moveTo(0, 520);
  ctx.lineTo(90, 495);
  ctx.lineTo(145, 520);
  ctx.lineTo(0, 520);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(world.width, 520);
  ctx.lineTo(world.width - 95, 498);
  ctx.lineTo(world.width - 170, 520);
  ctx.lineTo(world.width, 520);
  ctx.fill();
}

function drawSun(x, y, radius) {
  const glow = ctx.createRadialGradient(x, y, radius * 0.35, x, y, radius * 1.45);
  glow.addColorStop(0, '#fff989');
  glow.addColorStop(1, '#fff98900');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloud(x, y, scale) {
  ctx.fillStyle = '#ffffffdd';
  ctx.shadowColor = '#9bc8d760';
  ctx.shadowBlur = 8;
  for (const [dx, dy, radius] of [[0, 12, 46], [45, -10, 58], [105, -2, 70], [165, 7, 52], [215, 16, 40]]) {
    ctx.beginPath();
    ctx.arc(x + dx * scale, y + dy * scale, radius * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawNet() {
  const top = world.groundY - world.netHeight;
  const x = world.netX;
  ctx.fillStyle = '#8b4a08';
  roundRect(x - 13, top - 16, 26, world.netHeight + 58, 10, true);
  roundRect(x - 35, top - 4, 18, world.netHeight + 38, 8, true);
  ctx.strokeStyle = '#fff4c9';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 30, top + 18);
  ctx.lineTo(x + 3, top + 6);
  ctx.lineTo(x + 3, world.groundY + 15);
  ctx.lineTo(x - 30, world.groundY - 8);
  ctx.closePath();
  ctx.stroke();

  ctx.lineWidth = 2;
  for (let i = 1; i < 6; i += 1) {
    const y = top + (world.netHeight / 6) * i;
    ctx.beginPath();
    ctx.moveTo(x - 29, y);
    ctx.lineTo(x + 3, y - 8);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i += 1) {
    const nx = x - 30 + i * 8;
    ctx.beginPath();
    ctx.moveTo(nx, top + 14);
    ctx.lineTo(nx + 10, world.groundY + 7);
    ctx.stroke();
  }
}

function drawPlayer(player, index) {
  ctx.save();
  ctx.translate(player.x, player.y);
  const gradient = ctx.createRadialGradient(-12, -16, 8, 0, 0, player.radius);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.18, player.color);
  gradient.addColorStop(1, index === 0 ? '#0754aa' : '#a81421');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffffcc';
  ctx.stroke();

  ctx.fillStyle = '#21170f';
  ctx.beginPath();
  ctx.arc(-12, -8, 5, 0, Math.PI * 2);
  ctx.arc(12, -8, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#21170f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 6, 16, 0.2, Math.PI - 0.2);
  ctx.stroke();

  if (index === playerIndex && role === 'player') {
    ctx.strokeStyle = '#fff200';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius + 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(ball) {
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate((ball.x + ball.y) / 45);
  const colors = ['#ff1515', '#fff', '#ffe600', '#24f53a', '#1340ff', '#ff8c00'];
  for (let i = 0; i < colors.length; i += 1) {
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, ball.radius, (i * Math.PI * 2) / colors.length, ((i + 1) * Math.PI * 2) / colors.length);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8d6b00';
  ctx.beginPath();
  ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, ball.radius * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawControlsHint() {
  if (role !== 'player') return;
  ctx.fillStyle = '#3c332ccc';
  ctx.font = '700 20px Trebuchet MS, sans-serif';
  ctx.textAlign = playerIndex === 0 ? 'left' : 'right';
  const x = playerIndex === 0 ? 24 : world.width - 24;
  ctx.fillText(`Ты: ${Object.values(keyLabels).join('/')} + двойное нажатие = dash`, x, 36);
}

function drawOverlay() {
  if (!latest) return;
  if (latest.paused || latest.winner !== null) {
    ctx.fillStyle = '#00000030';
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.fillStyle = '#ffe3aae8';
    ctx.strokeStyle = '#9a5a0a';
    ctx.lineWidth = 5;
    roundRect(world.width / 2 - 250, 245, 500, 135, 18, true, true);
    ctx.fillStyle = '#3c332c';
    ctx.font = '900 34px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    const text = latest.winner !== null ? `Игрок ${latest.winner + 1} победил!` : (latest.message || 'Пауза');
    ctx.fillText(text, world.width / 2, 300);
    if (latest.paused && latest.countdown > 0 && latest.winner === null) {
      ctx.font = '900 44px Trebuchet MS, sans-serif';
      ctx.fillText(Math.ceil(latest.countdown), world.width / 2, 352);
    }
  }
}

function roundRect(x, y, width, height, radius, fill, stroke = false) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawNet();

  if (latest) {
    latest.players.forEach(drawPlayer);
    drawBall(latest.ball);
  } else {
    ctx.fillStyle = '#ffe3aae8';
    ctx.strokeStyle = '#9a5a0a';
    ctx.lineWidth = 5;
    roundRect(world.width / 2 - 250, 250, 500, 140, 18, true, true);
    ctx.fillStyle = '#3c332c';
    ctx.font = '900 42px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BEACHBALL', world.width / 2, 315);
    ctx.font = '700 24px Trebuchet MS, sans-serif';
    ctx.fillText('LAN / Radmin VPN', world.width / 2, 352);
  }

  drawControlsHint();
  drawOverlay();
  requestAnimationFrame(draw);
}

joinForm.addEventListener('submit', joinGame);
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
restartButton.addEventListener('click', () => send({ type: 'restart' }));
draw();
