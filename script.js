// --- 初期設定 ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const myHpBar = document.getElementById('myHpBar');
const opponentHpBar = document.getElementById('opponentHpBar');
const roundDisplay = document.getElementById('roundDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const myScoreDisplay = document.getElementById('myScore');
const opponentScoreDisplay = document.getElementById('opponentScore');
const weaponList = document.getElementById('weaponList');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');

const createOfferBtn = document.getElementById('createOfferBtn');
const acceptOfferBtn = document.getElementById('acceptOfferBtn');
const localSDPTextarea = document.getElementById('localSDP');
const remoteSDPTextarea = document.getElementById('remoteSDP');
const setRemoteSDPBtn = document.getElementById('setRemoteSDPBtn');

let pc;
let dc;

let isOfferer = false;
let connected = false;

// --- ゲーム設定 ---
const MAP_WIDTH = canvas.width;
const MAP_HEIGHT = canvas.height;

const ROUND_LIMIT = 3;
const ROUND_TIME = 60; // 秒

// 障害物(壁)の配列（矩形）
const walls = [
  { x: 300, y: 150, width: 20, height: 200 },
  { x: 500, y: 100, width: 20, height: 300 },
];

// プレイヤー構造体
class Player {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.width = 25; this.height = 25;
    this.color = color;
    this.speed = 4;
    this.maxHp = 10;
    this.hp = this.maxHp;
    this.score = 0;
    this.weapon = 'normal'; // normal or explosion
    this.specialCharge = 0; // 特殊スキルゲージ
    this.isAlive = true;
  }

  get centerX() { return this.x + this.width / 2; }
  get centerY() { return this.y + this.height / 2; }

  move(dx, dy) {
    if (!this.isAlive) return;
    let nx = this.x + dx * this.speed;
    let ny = this.y + dy * this.speed;
    // 壁との当たり判定（矩形）
    if (!isCollidingWithWalls(nx, this.y, this.width, this.height)) this.x = nx;
    if (!isCollidingWithWalls(this.x, ny, this.width, this.height)) this.y = ny;

    // マップ内制限
    this.x = Math.max(0, Math.min(MAP_WIDTH - this.width, this.x));
    this.y = Math.max(0, Math.min(MAP_HEIGHT - this.height, this.y));
  }

  heal(amount) {
    if (!this.isAlive) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  damage(amount) {
    if (!this.isAlive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.isAlive = false;
    }
  }
}

const myPlayer = new Player(50, MAP_HEIGHT / 2 - 12, 'cyan');
const opponent = new Player(MAP_WIDTH - 75, MAP_HEIGHT / 2 - 12, 'orange');

// --- 弾クラス ---
class Bullet {
  constructor(x, y, vx, vy, owner, type='normal') {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.width = (type === 'normal') ? 8 : 12;
    this.height = 4;
    this.owner = owner; // 'me' or 'opponent'
    this.type = type;
    this.color = (type === 'normal') ? (owner === 'me' ? 'cyan' : 'orange') : 'red';
    this.isExploded = false; // 爆発済みフラグ
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
  }

  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}

let bullets = [];
let specialExplosions = [];

// --- 回復アイテムクラス ---
class HealItem {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.width = 20; this.height = 20;
    this.color = '#4caf50';
    this.exists = true;
  }

  draw(ctx) {
    if (!this.exists) return;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x + this.width/2, this.y + this.height/2, 10, 0, Math.PI * 2);
    ctx.fill();
    // +マーク
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x + 10, this.y + 5);
    ctx.lineTo(this.x + 10, this.y + 15);
    ctx.moveTo(this.x + 5, this.y + 10);
    ctx.lineTo(this.x + 15, this.y + 10);
    ctx.stroke();
  }
}

let healItems = [];

// --- 特殊爆発 ---
class Explosion {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = 10;
    this.maxRadius = 60;
    this.growth = 4;
    this.alpha = 0.6;
    this.finished = false;
  }

  update() {
    this.radius += this.growth;
    this.alpha -= 0.05;
    if (this.radius > this.maxRadius) this.finished = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,100,0,${this.alpha})`;
    ctx.shadowColor = 'orange';
    ctx.shadowBlur = 15;
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  checkDamage(player) {
    // プレイヤー中心との距離でダメージ判定
    let dx = player.centerX - this.x;
    let dy = player.centerY - this.y;
    let dist = Math.sqrt(dx*dx + dy*dy);
    return dist < this.radius;
  }
}

// --- マップ衝突判定 ---
function isCollidingWithWalls(x, y, w, h) {
  for (let wall of walls) {
    if (!(x + w < wall.x || x > wall.x + wall.width || y + h < wall.y || y > wall.y + wall.height)) {
      return true;
    }
  }
  return false;
}

// --- 入力 ---
const keys = {};
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  keys[e.key] = true;

  // 武器切替
  if (e.key === '1') changeWeapon('normal');
  else if (e.key === '2') changeWeapon('explosion');

  // チャット送信（Enter）
  if (e.key === 'Enter' && chatInput === document.activeElement) {
    let msg = chatInput.value.trim();
    if(msg && connected) {
      addChatMessage(`あなた: ${msg}`);
      sendData({ type: 'chat', message: msg });
      chatInput.value = '';
    }
  }
});

window.addEventListener('keyup', e => {
  keys[e.key] = false;
});

// --- 武器切替関数 ---
function changeWeapon(wpn) {
  myPlayer.weapon = wpn;
  // UI更新
  for (let el of weaponList.children) {
    el.classList.toggle('active', el.dataset.weapon === wpn);
  }
}

// --- チャットUI ---
function addChatMessage(msg) {
  chatBox.textContent += msg + '\n';
  chatBox.scrollTop = chatBox.scrollHeight;
}

// --- WebRTCシグナリング ---
function setupPeerConnection(isOffer) {
  isOfferer = isOffer;
  pc = new RTCPeerConnection();

  if (isOfferer) {
    dc = pc.createDataChannel('game');
    setupDataChannel();
  } else {
    pc.ondatachannel = e => {
      dc = e.channel;
      setupDataChannel();
    };
  }

  pc.onicecandidate = e => {
    if (!e.candidate) {
      localSDPTextarea.value = JSON.stringify(pc.localDescription);
    }
  };
}

function setupDataChannel() {
  dc.onopen = () => {
    connected = true;
    addChatMessage('[接続完了]');
  };
  dc.onclose = () => {
    connected = false;
    addChatMessage('[切断されました]');
  };
  dc.onerror = err => {
    console.error('DataChannel error', err);
  };
  dc.onmessage = e => {
    let data = JSON.parse(e.data);
    handleData(data);
  };
}

// --- データ送受信 ---
function sendData(data) {
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify(data));
  }
}

function handleData(data) {
  switch(data.type) {
    case 'move':
      opponent.x = data.x;
      opponent.y = data.y;
      break;
    case 'shoot':
      // 弾生成
      if (data.weapon === 'normal') {
        bullets.push(new Bullet(data.x, data.y, data.vx, data.vy, 'opponent', 'normal'));
      } else if (data.weapon === 'explosion') {
        bullets.push(new Bullet(data.x, data.y, data.vx, data.vy, 'opponent', 'explosion'));
      }
      break;
    case 'damage':
      myPlayer.damage(data.amount);
      break;
    case 'heal':
      myPlayer.heal(data.amount);
      break;
    case 'special':
      // 特殊爆発発動
      specialExplosions.push(new Explosion(data.x, data.y));
      break;
    case 'score':
      opponent.score = data.score;
      updateScoresUI();
      break;
    case 'round':
      round = data.round;
      updateRoundUI();
      break;
    case 'chat':
      addChatMessage(`相手: ${data.message}`);
      break;
    case 'healItem':
      // 回復アイテム生成/消失
      if (data.action === 'spawn') {
        healItems.push(new HealItem(data.x, data.y));
      } else if (data.action === 'remove') {
        healItems = healItems.filter(item => !(item.x === data.x && item.y === data.y));
      }
      break;
  }
}

// --- ラウンドとタイマー管理 ---
let round = 1;
let roundTime = ROUND_TIME;
let roundActive = true;

function updateRoundUI() {
  roundDisplay.textContent = round;
}

function updateTimerUI() {
  timerDisplay.textContent = Math.ceil(roundTime);
}

function updateScoresUI() {
  myScoreDisplay.textContent = myPlayer.score;
  opponentScoreDisplay.textContent = opponent.score;
}

// --- ゲーム開始 ---
function startRound() {
  myPlayer.hp = myPlayer.maxHp;
  myPlayer.isAlive = true;
  opponent.hp = opponent.maxHp;
  opponent.isAlive = true;
  bullets = [];
  specialExplosions = [];
  healItems = [];
  roundTime = ROUND_TIME;
  roundActive = true;
  updateRoundUI();
  updateScoresUI();
  sendData({ type: 'round', round: round });
  spawnHealItem();
}

function endRound(winner) {
  roundActive = false;
  if (winner === 'me') {
    myPlayer.score++;
    addChatMessage('ラウンド勝利！');
  } else if (winner === 'opponent') {
    opponent.score++;
    addChatMessage('ラウンド敗北...');
  } else {
    addChatMessage('ラウンド引き分け');
  }
  updateScoresUI();

  if (myPlayer.score >= ROUND_LIMIT) {
    addChatMessage('あなたの勝ちです！ゲーム終了');
    resetGame();
  } else if (opponent.score >= ROUND_LIMIT) {
    addChatMessage('あなたの負けです。ゲーム終了');
    resetGame();
  } else {
    setTimeout(() => {
      round++;
      startRound();
    }, 3000);
  }
}

function resetGame() {
  round = 1;
  myPlayer.score = 0;
  opponent.score = 0;
  startRound();
}

// --- 弾の発射 ---
function shootWeapon() {
  if (!myPlayer.isAlive) return;

  if (myPlayer.weapon === 'normal') {
    // 通常弾
    let b = new Bullet(
      myPlayer.x + myPlayer.width,
      myPlayer.y + myPlayer.height/2 - 2,
      8, 0,
      'me', 'normal'
    );
    bullets.push(b);
    sendData({ type: 'shoot', x: b.x, y: b.y, vx: b.vx, vy: b.vy, weapon: 'normal' });
    myPlayer.specialCharge = Math.min(100, myPlayer.specialCharge + 10);
  } else if (myPlayer.weapon === 'explosion') {
    // 爆発弾は遅いがダメージ大きい
    let b = new Bullet(
      myPlayer.x + myPlayer.width,
      myPlayer.y + myPlayer.height/2 - 3,
      5, 0,
      'me', 'explosion'
    );
    bullets.push(b);
    sendData({ type: 'shoot', x: b.x, y: b.y, vx: b.vx, vy: b.vy, weapon: 'explosion' });
    myPlayer.specialCharge = Math.min(100, myPlayer.specialCharge + 15);
  }
}

// --- 特殊スキル発動 ---
function activateSpecial() {
  if (!myPlayer.isAlive) return;
  if (myPlayer.specialCharge < 100) return;
  myPlayer.specialCharge = 0;

  // プレイヤー中心で爆発を起こす
  specialExplosions.push(new Explosion(myPlayer.centerX, myPlayer.centerY));
  sendData({ type: 'special', x: myPlayer.centerX, y: myPlayer.centerY });
}

// --- 回復アイテム生成 ---
function spawnHealItem() {
  if (!roundActive) return;

  let x = 100 + Math.random() * (MAP_WIDTH - 200);
  let y = 50 + Math.random() * (MAP_HEIGHT - 100);

  // 壁に重ならないように調整
  if (isCollidingWithWalls(x, y, 20, 20)) {
    spawnHealItem(); // 再生成
    return;
  }

  let newItem = new HealItem(x, y);
  healItems.push(newItem);

  // 相手にも生成通知
  sendData({ type: 'healItem', action: 'spawn', x, y });

  // 次は30秒後に生成（単純繰り返し）
  setTimeout(() => {
    if (roundActive) spawnHealItem();
  }, 30000);
}

// --- ゲーム更新 ---
function update() {
  if (!roundActive) return;

  // 移動入力判定をWASDに変更
  let dx = 0, dy = 0;
  if (keys['w'] || keys['W']) dy = -1;
  else if (keys['s'] || keys['S']) dy = 1;
  if (keys['a'] || keys['A']) dx = -1;
  else if (keys['d'] || keys['D']) dx = 1;

  myPlayer.move(dx, dy);

  // 位置送信
  sendData({ type: 'move', x: myPlayer.x, y: myPlayer.y });

  // 弾更新
  bullets.forEach((b, i) => {
    b.update();

    // 壁に当たったら消える（爆発弾は爆発）
    if (isCollidingWithWalls(b.x, b.y, b.width, b.height)) {
      if (b.type === 'explosion' && !b.isExploded) {
        specialExplosions.push(new Explosion(b.x + b.width/2, b.y + b.height/2));
        b.isExploded = true;
      }
      bullets.splice(i,1);
      return;
    }

    // 画面外に出たら消す
    if (b.x > MAP_WIDTH || b.x < 0 || b.y > MAP_HEIGHT || b.y < 0) {
      bullets.splice(i,1);
      return;
    }

    // 弾の当たり判定
    if (b.owner === 'me' && opponent.isAlive && rectIntersect(b, opponent)) {
      if (b.type === 'normal') {
        opponent.damage(1);
        sendData({ type: 'damage', amount: 1 });
      } else if (b.type === 'explosion') {
        opponent.damage(3);
        sendData({ type: 'damage', amount: 3 });
      }
      bullets.splice(i, 1);
      return;
    } else if (b.owner === 'opponent' && myPlayer.isAlive && rectIntersect(b, myPlayer)) {
      if (b.type === 'normal') {
        myPlayer.damage(1);
      } else if (b.type === 'explosion') {
        myPlayer.damage(3);
      }
      bullets.splice(i,1);
      return;
    }
  });

  // 特殊爆発更新と判定
  specialExplosions.forEach((explosion, i) => {
    explosion.update();

    if (!explosion.finished) {
      // 爆発範囲に入ったプレイヤーにダメージ判定（一定間隔で）
      if (explosion.checkDamage(myPlayer) && myPlayer.isAlive) {
        myPlayer.damage(1);
      }
      if (explosion.checkDamage(opponent) && opponent.isAlive) {
        opponent.damage(1);
        sendData({ type: 'damage', amount: 1 });
      }
    } else {
      specialExplosions.splice(i,1);
    }
  });

  // 回復アイテムとの接触判定
  healItems.forEach((item, i) => {
    if (item.exists && myPlayer.isAlive && rectIntersect(myPlayer, item)) {
      myPlayer.heal(3);
      item.exists = false;
      sendData({ type: 'heal', amount: 3 });
      sendData({ type: 'healItem', action: 'remove', x: item.x, y: item.y });
    }
    if (item.exists && opponent.isAlive && rectIntersect(opponent, item)) {
      // 相手も取得していたら除去（実際の相手取得は相手側処理）
      item.exists = false;
    }
  });

  // HPバー更新
  myHpBar.style.width = (myPlayer.hp / myPlayer.maxHp * 100) + '%';
  opponentHpBar.style.width = (opponent.hp / opponent.maxHp * 100) + '%';

  // ラウンドタイマー更新
  roundTime -= 1 / 60;
  updateTimerUI();

  // 回復(時間経過) 1秒ごとに少し回復
  if (Math.floor(roundTime) % 1 === 0) {
    myPlayer.heal(0.02);
  }

  // 勝敗判定
  if (!myPlayer.isAlive) {
    endRound('opponent');
  } else if (!opponent.isAlive) {
    endRound('me');
  } else if (roundTime <= 0) {
    // 時間切れはHP比較
    if (myPlayer.hp > opponent.hp) endRound('me');
    else if (myPlayer.hp < opponent.hp) endRound('opponent');
    else endRound('draw');
  }
}

// --- 描画関数 ---
function draw() {
  ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  // 壁描画
  ctx.fillStyle = '#555';
  for (let wall of walls) {
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
  }

  // 回復アイテム描画
  for (let item of healItems) {
    if (item.exists) item.draw(ctx);
  }

  // プレイヤー描画
  if (myPlayer.isAlive) {
    ctx.fillStyle = myPlayer.color;
    ctx.fillRect(myPlayer.x, myPlayer.y, myPlayer.width, myPlayer.height);
  }
  if (opponent.isAlive) {
    ctx.fillStyle = opponent.color;
    ctx.fillRect(opponent.x, opponent.y, opponent.width, opponent.height);
  }

  // 弾描画
  for (let b of bullets) {
    b.draw(ctx);
  }

  // 特殊爆発描画
  for (let e of specialExplosions) {
    e.draw(ctx);
  }

  // ミニマップ（右下に小さく表示）
  drawMiniMap();
}

function drawMiniMap() {
  const mmWidth = 160;
  const mmHeight = 100;
  const scaleX = mmWidth / MAP_WIDTH;
  const scaleY = mmHeight / MAP_HEIGHT;
  const mmX = MAP_WIDTH - mmWidth - 10;
  const mmY = MAP_HEIGHT - mmHeight - 10;

  // 背景
  ctx.fillStyle = '#111a';
  ctx.fillRect(mmX, mmY, mmWidth, mmHeight);

  // 壁
  ctx.fillStyle = '#555';
  for (let wall of walls) {
    ctx.fillRect(mmX + wall.x * scaleX, mmY + wall.y * scaleY, wall.width * scaleX, wall.height * scaleY);
  }

  // プレイヤー
  ctx.fillStyle = myPlayer.color;
  ctx.fillRect(mmX + myPlayer.x * scaleX, mmY + myPlayer.y * scaleY, myPlayer.width * scaleX, myPlayer.height * scaleY);
  ctx.fillStyle = opponent.color;
  ctx.fillRect(mmX + opponent.x * scaleX, mmY + opponent.y * scaleY, opponent.width * scaleX, opponent.height * scaleY);

  // 回復アイテム
  ctx.fillStyle = '#4caf50';
  for(let item of healItems) {
    if(item.exists) {
      ctx.beginPath();
      ctx.arc(mmX + (item.x + item.width/2)*scaleX, mmY + (item.y + item.height/2)*scaleY, 5, 0, Math.PI*2);
      ctx.fill();
    }
  }
}

// --- 矩形衝突判定関数 ---
function rectIntersect(a, b) {
  return !(a.x + a.width < b.x || a.x > b.x + b.width || a.y + a.height < b.y || a.y > b.y + b.height);
}

// --- メインループ ---
function loop() {
  if (connected) {
    update();
  }
  draw();
  requestAnimationFrame(loop);
}

loop();

// --- 発射キー(スペース)と特殊スキルキー(Z) ---
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (!connected) return;
  if (e.key === ' ') {
    shootWeapon();
  } else if (e.key.toLowerCase() === 'z') {
    activateSpecial();
  }
});

// --- シグナリングUIボタン操作 ---
createOfferBtn.onclick = async () => {
  setupPeerConnection(true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
};

acceptOfferBtn.onclick = async () => {
  setupPeerConnection(false);
  const offer = JSON.parse(remoteSDPTextarea.value);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  localSDPTextarea.value = JSON.stringify(pc.localDescription);
};

setRemoteSDPBtn.onclick = async () => {
  const remoteDesc = JSON.parse(remoteSDPTextarea.value);
  await pc.setRemoteDescription(remoteDesc);
  if (round === 1) startRound();
};
