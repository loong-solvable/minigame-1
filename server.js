const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const DEFAULT_CONFIG = {
  port: Number(process.env.PORT || 3000),
  tickMs: 50,
  snapshotEveryTicks: 2,
  matchDurationSec: 120,
  maxHumansPerRoom: 8,
  targetCompetitors: 6,
  initialPickupCount: 5,
  pickupMinCount: 4,
  minSpawnDistance: 240,
  startMass: 24,
  playerRespawnDelayMs: 3000,
  playerRespawnInvincibleMs: 3000,
  botRespawnInvincibleMs: 1200,
  foodReplenishIntervalMs: 1000,
  foods: {
    civilians: 140,
    cars: 30,
    crates: 20
  },
  minFoods: {
    civilians: 95,
    cars: 20,
    crates: 12
  }
};

const WORLD = { w: 2200, h: 3200 };
const ROAD_W = 130;
const ROADS_X = [330, 770, 1210, 1650, 2010];
const ROADS_Y = [260, 700, 1140, 1580, 2020, 2460, 2900];
const PLAYER_COLORS = ["#ff39a2", "#58e0ff", "#8ff06d", "#ffd95f", "#ff8c3a", "#9c8dff", "#56d3ff", "#ff73ba"];
const PLAYER_AVATAR_KEYS = ["hero_beetle", "hero_mage", "hero_archer", "hero_guard", "enemy_zhamao", "enemy_diaomao", "enemy_sanmao", "enemy_ant_1"];
const BOT_COLORS = ["#ffe34a", "#58e0ff", "#ff8c3a", "#8f7bff", "#8ff06d", "#ff73ba", "#5ce1ff", "#ffc857"];
const BOT_NAMES = ["Alias", "Chikkernoth", "Butterfang", "Certron", "Megabite", "Crankjaw", "Hexscale", "Rifttooth"];
const BOT_AVATAR_KEYS = ["hero_archer", "hero_guard", "enemy_zhamao", "enemy_diaomao", "enemy_sanmao", "enemy_ant_1"];
const SKIN_TONES = ["#f8d8b7", "#ecc3a4", "#d9a67f", "#bf8b63", "#8d5c3f"];
const OUTFIT_COLORS = ["#56d3ff", "#ff8f63", "#72f39f", "#ffd95f", "#9c8dff", "#ff73ba"];
const CAR_PAINTS = [
  { body: "#fb5f5f", roof: "#fce2e2", trim: "#a32222" },
  { body: "#4b79ff", roof: "#dce7ff", trim: "#1f3b88" },
  { body: "#f7b438", roof: "#fff2d0", trim: "#956100" },
  { body: "#31c289", roof: "#d6fff0", trim: "#0f6b4b" },
  { body: "#aa77ff", roof: "#eee2ff", trim: "#5a2ca2" }
];
const PICKUP_TYPES = ["speed", "magnet", "shield"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function nowMs() {
  return Date.now();
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function randomRoadPos(rng) {
  if (rng() < 0.52) {
    const rx = ROADS_X[Math.floor(rng() * ROADS_X.length) % ROADS_X.length];
    return {
      x: clamp(rx + rand(rng, -ROAD_W * 0.42, ROAD_W * 0.42), 20, WORLD.w - 20),
      y: rand(rng, 20, WORLD.h - 20)
    };
  }

  const ry = ROADS_Y[Math.floor(rng() * ROADS_Y.length) % ROADS_Y.length];
  return {
    x: rand(rng, 20, WORLD.w - 20),
    y: clamp(ry + rand(rng, -ROAD_W * 0.42, ROAD_W * 0.42), 20, WORLD.h - 20)
  };
}

function syncSize(unit) {
  unit.level = clamp(1 + Math.floor(unit.mass / 20), 1, 14);
  unit.bodyR = 17 + unit.level * 3.15;
  unit.holeR = unit.bodyR + 9 + Math.sqrt(unit.mass) * 1.3;
  unit.speed = clamp(250 - unit.level * 8, 140, 280);
}

function createCompetitorBase({ id, name, color, avatarKey, isBot }) {
  const base = {
    id,
    name,
    color,
    avatarKey,
    isBot,
    x: WORLD.w * 0.5,
    y: WORLD.h * 0.5,
    tx: WORLD.w * 0.5,
    ty: WORLD.h * 0.5,
    angle: -Math.PI / 2,
    speed: 230,
    mass: 24,
    level: 1,
    bodyR: 26,
    holeR: 38,
    invincibleUntil: 0,
    speedUntil: 0,
    magnetUntil: 0,
    shieldUntil: 0,
    kills: 0,
    deaths: 0,
    score: 0,
    alive: true,
    respawnAt: 0,
    aiThinkMs: 0
  };
  syncSize(base);
  return base;
}

function createHumanPlayer(id, name, index) {
  return {
    ...createCompetitorBase({
      id,
      name,
      color: PLAYER_COLORS[index % PLAYER_COLORS.length],
      avatarKey: PLAYER_AVATAR_KEYS[index % PLAYER_AVATAR_KEYS.length],
      isBot: false
    }),
    connected: true,
    socket: null
  };
}

function createBot(room, index) {
  const bot = createCompetitorBase({
    id: `bot_${room.code}_${index}_${room.nextEntityId++}`,
    name: BOT_NAMES[index % BOT_NAMES.length],
    color: BOT_COLORS[index % BOT_COLORS.length],
    avatarKey: BOT_AVATAR_KEYS[index % BOT_AVATAR_KEYS.length],
    isBot: true
  });
  bot.mass = room.app.config.startMass + rand(room.rng, 4, 18) + index * 2;
  syncSize(bot);
  return bot;
}

function safeName(name, fallback) {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 14) || fallback;
}

function createRoom(app, code) {
  const seed = (hashString(code) ^ Date.now()) >>> 0;
  return {
    app,
    code,
    hostId: "",
    phase: "lobby",
    createdAt: nowMs(),
    seed,
    rng: mulberry32(seed),
    nextEntityId: 1,
    tickCount: 0,
    elapsedMs: 0,
    timeLeftMs: app.config.matchDurationSec * 1000,
    lastFoodRefillAt: 0,
    players: new Map(),
    bots: [],
    foods: {
      civilians: [],
      cars: [],
      crates: []
    },
    pickups: [],
    controlPoints: [],
    turretShots: [],
    popups: [],
    eventBanner: {
      text: "",
      color: "#5ce1ff",
      ttlMs: 0,
      flash: 0
    },
    ranking: []
  };
}

function generateRoomCode(rooms) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error("Failed to generate room code");
}

function send(ws, payload) {
  if (!ws || ws.readyState !== 1) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function broadcastRoom(room, payload) {
  for (const player of room.players.values()) {
    send(player.socket, payload);
  }
}

function buildRoomState(room) {
  return {
    type: "room_state",
    roomCode: room.code,
    phase: room.phase,
    hostId: room.hostId,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      avatarKey: player.avatarKey,
      connected: player.connected
    })),
    ranking: room.ranking
  };
}

function getCompetitors(room) {
  return [...room.players.values(), ...room.bots];
}

function getCompetitorById(room, id) {
  if (!id) return null;
  if (room.players.has(id)) {
    return room.players.get(id);
  }
  for (const bot of room.bots) {
    if (bot.id === id) return bot;
  }
  return null;
}

function chooseSafeSpawn(room, unit, ignoreId = "") {
  for (let attempt = 0; attempt < 32; attempt++) {
    const point = randomRoadPos(room.rng);
    let safe = true;
    for (const other of getCompetitors(room)) {
      if (!other.alive || other.id === ignoreId) {
        continue;
      }
      const minDist = room.app.config.minSpawnDistance + other.bodyR + unit.bodyR;
      if (dist2(point.x, point.y, other.x, other.y) < minDist * minDist) {
        safe = false;
        break;
      }
    }
    if (safe) {
      return point;
    }
  }
  return randomRoadPos(room.rng);
}

function resetCompetitor(room, unit, mass, invincibleMs) {
  unit.mass = mass;
  unit.alive = true;
  unit.respawnAt = 0;
  unit.speedUntil = 0;
  unit.magnetUntil = 0;
  unit.shieldUntil = 0;
  syncSize(unit);
  const spawn = chooseSafeSpawn(room, unit, unit.id);
  unit.x = spawn.x;
  unit.y = spawn.y;
  unit.tx = spawn.x;
  unit.ty = spawn.y;
  unit.angle = -Math.PI / 2;
  unit.invincibleUntil = nowMs() + invincibleMs;
}

function createCivilian(room) {
  const p = randomRoadPos(room.rng);
  const rare = room.rng() < 0.12;
  return {
    id: `civ_${room.nextEntityId++}`,
    x: p.x,
    y: p.y,
    r: rand(room.rng, 4.8, 6.3),
    value: rare ? 4 : room.rng() < 0.28 ? 3 : 2,
    skin: pick(room.rng, SKIN_TONES),
    shirt: pick(room.rng, OUTFIT_COLORS),
    pants: pick(room.rng, OUTFIT_COLORS),
    hair: room.rng() < 0.65 ? "#3a2a22" : "#6d4c34",
    hat: room.rng() < 0.18,
    bag: room.rng() < 0.2,
    stride: rand(room.rng, 0, Math.PI * 2),
    scale: rand(room.rng, 0.92, 1.08)
  };
}

function createCar(room) {
  const p = randomRoadPos(room.rng);
  const style = pick(room.rng, CAR_PAINTS);
  const k = room.rng();
  const model = k < 0.36 ? "compact" : k < 0.74 ? "sedan" : "van";
  const w = model === "van" ? rand(room.rng, 34, 40) : model === "sedan" ? rand(room.rng, 30, 36) : rand(room.rng, 25, 31);
  const h = model === "van" ? rand(room.rng, 15, 18) : model === "sedan" ? rand(room.rng, 13, 16) : rand(room.rng, 12, 15);
  return {
    id: `car_${room.nextEntityId++}`,
    x: p.x,
    y: p.y,
    w,
    h,
    rot: rand(room.rng, 0, Math.PI * 2),
    value: model === "van" ? 5 : model === "sedan" ? 4 : 3,
    model,
    body: style.body,
    roof: style.roof,
    trim: style.trim,
    stripe: room.rng() < 0.4,
    blink: room.rng() < 0.26,
    phase: rand(room.rng, 0, Math.PI * 2)
  };
}

function createCrate(room) {
  const p = randomRoadPos(room.rng);
  return {
    id: `crate_${room.nextEntityId++}`,
    x: p.x,
    y: p.y,
    r: rand(room.rng, 10, 14),
    value: Math.floor(rand(room.rng, 5, 9))
  };
}

function createControlPoints(room) {
  const slots = [
    { x: ROADS_X[1], y: ROADS_Y[1] },
    { x: ROADS_X[3], y: ROADS_Y[3] },
    { x: ROADS_X[2], y: ROADS_Y[5] }
  ];
  room.controlPoints = slots.map((slot) => ({
    id: `cp_${room.nextEntityId++}`,
    x: slot.x,
    y: slot.y,
    r: 58,
    pulse: rand(room.rng, 0, Math.PI * 2),
    ownerId: "",
    capture: 0,
    fireCdMs: rand(room.rng, 1000, 1800)
  }));
}

function triggerBanner(room, text, color = "#5ce1ff", ttlMs = 3200, flash = 0.34) {
  room.eventBanner.text = text;
  room.eventBanner.color = color;
  room.eventBanner.ttlMs = Math.max(room.eventBanner.ttlMs, ttlMs);
  room.eventBanner.flash = Math.max(room.eventBanner.flash, flash);
}

function addPopup(room, x, y, text, color = "#ffffff", lifeMs = 900, size = 24, weight = 700) {
  room.popups.push({
    id: `popup_${room.nextEntityId++}`,
    x,
    y,
    text,
    color,
    lifeMs,
    maxLifeMs: lifeMs,
    size,
    weight
  });
}

function updateRoomEffects(room, dtMs) {
  room.eventBanner.ttlMs = Math.max(0, room.eventBanner.ttlMs - dtMs);
  room.eventBanner.flash = Math.max(0, room.eventBanner.flash - (dtMs / 1000) * 0.38);

  for (let i = room.popups.length - 1; i >= 0; i--) {
    const popup = room.popups[i];
    const rise = 22 + (popup.size || 24) * 0.85;
    popup.y -= rise * (dtMs / 1000);
    popup.lifeMs -= dtMs;
    if (popup.lifeMs <= 0) {
      room.popups.splice(i, 1);
    }
  }
}

function spawnPickup(room, forceType = "") {
  const p = randomRoadPos(room.rng);
  const roll = room.rng();
  const type = forceType || (roll < 0.34 ? "speed" : roll < 0.67 ? "magnet" : "shield");
  room.pickups.push({
    id: `pickup_${room.nextEntityId++}`,
    x: p.x,
    y: p.y,
    r: rand(room.rng, 16, 19),
    type,
    rot: rand(room.rng, 0, Math.PI * 2),
    phase: rand(room.rng, 0, Math.PI * 2)
  });
}

function fillFoods(room) {
  room.foods.civilians.length = 0;
  room.foods.cars.length = 0;
  room.foods.crates.length = 0;
  for (let i = 0; i < room.app.config.foods.civilians; i++) {
    room.foods.civilians.push(createCivilian(room));
  }
  for (let i = 0; i < room.app.config.foods.cars; i++) {
    room.foods.cars.push(createCar(room));
  }
  for (let i = 0; i < room.app.config.foods.crates; i++) {
    room.foods.crates.push(createCrate(room));
  }
}

function initializeMatch(room) {
  room.phase = "running";
  room.tickCount = 0;
  room.elapsedMs = 0;
  room.timeLeftMs = room.app.config.matchDurationSec * 1000;
  room.lastFoodRefillAt = 0;
  room.rng = mulberry32((room.seed ^ nowMs()) >>> 0);
  room.nextEntityId = 1;
  room.ranking = [];
  room.turretShots = [];
  room.popups = [];
  room.eventBanner = {
    text: "",
    color: "#5ce1ff",
    ttlMs: 0,
    flash: 0
  };

  for (const player of room.players.values()) {
    player.connected = true;
    player.kills = 0;
    player.deaths = 0;
    player.score = 0;
    resetCompetitor(room, player, room.app.config.startMass, room.app.config.playerRespawnInvincibleMs);
  }

  room.bots = [];
  const botCount = Math.max(0, room.app.config.targetCompetitors - room.players.size);
  for (let i = 0; i < botCount; i++) {
    const bot = createBot(room, i);
    bot.kills = 0;
    bot.deaths = 0;
    bot.score = 0;
    resetCompetitor(room, bot, bot.mass, room.app.config.botRespawnInvincibleMs);
    room.bots.push(bot);
  }

  fillFoods(room);
  createControlPoints(room);
  room.pickups.length = 0;
  for (let i = 0; i < room.app.config.initialPickupCount; i++) {
    spawnPickup(room, PICKUP_TYPES[i % PICKUP_TYPES.length]);
  }

  triggerBanner(room, "MATCH START", "#5ce1ff", 2800, 0.45);
  broadcastRoom(room, buildRoomState(room));
  broadcastSnapshots(room);
}

function moveUnit(unit, dt, targetX, targetY, speedMul) {
  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const distance = Math.hypot(dx, dy) || 1;
  const step = unit.speed * speedMul * dt;
  const ratio = step >= distance ? 1 : step / distance;
  unit.x += dx * ratio;
  unit.y += dy * ratio;
  unit.x = clamp(unit.x, unit.bodyR + 10, WORLD.w - unit.bodyR - 10);
  unit.y = clamp(unit.y, unit.bodyR + 10, WORLD.h - unit.bodyR - 10);
  unit.angle = Math.atan2(dy, dx);
}

function gain(unit, amount) {
  unit.mass += amount;
  syncSize(unit);
  if (!unit.isBot) {
    unit.score += amount * 2;
  }
}

function absorbFoods(room, unit, now) {
  let hole = unit.holeR;
  if (unit.magnetUntil > now) {
    hole *= 1.9;
  }
  const hole2 = hole * hole;
  const carHole = (hole - 4) * (hole - 4);
  const crateHole = (hole - 2) * (hole - 2);

  for (let i = room.foods.civilians.length - 1; i >= 0; i--) {
    const food = room.foods.civilians[i];
    if (dist2(unit.x, unit.y, food.x, food.y) < hole2) {
      room.foods.civilians.splice(i, 1);
      gain(unit, food.value);
    }
  }

  for (let i = room.foods.cars.length - 1; i >= 0; i--) {
    const car = room.foods.cars[i];
    if (dist2(unit.x, unit.y, car.x, car.y) < carHole) {
      room.foods.cars.splice(i, 1);
      gain(unit, car.value);
    }
  }

  if (unit.level >= 4) {
    for (let i = room.foods.crates.length - 1; i >= 0; i--) {
      const crate = room.foods.crates[i];
      if (dist2(unit.x, unit.y, crate.x, crate.y) < crateHole) {
        room.foods.crates.splice(i, 1);
        gain(unit, crate.value);
      }
    }
  }
}

function applyPickup(room, unit, type, now) {
  if (type === "speed") {
    unit.speedUntil = Math.max(unit.speedUntil, now + 12000);
    addPopup(room, unit.x, unit.y, "Speed x1.78", "#ffd44d", 2200, 30, 900);
    triggerBanner(room, "SPEED BOOST", "#ffd44d", 3000, 0.32);
  } else if (type === "magnet") {
    unit.magnetUntil = Math.max(unit.magnetUntil, now + 14000);
    addPopup(room, unit.x, unit.y, "Magnet x1.90", "#67ddff", 2200, 30, 900);
    triggerBanner(room, "MEGA MAGNET", "#67ddff", 3000, 0.32);
  } else if (type === "shield") {
    unit.shieldUntil = Math.max(unit.shieldUntil, now + 24000);
    addPopup(room, unit.x, unit.y, "Shield Ready", "#9ef3ff", 2300, 32, 900);
    triggerBanner(room, "SHIELD ON", "#9ef3ff", 3200, 0.35);
  }
  if (!unit.isBot) {
    unit.score += 26;
  }
}

function collectPickups(room, unit, now) {
  for (let i = room.pickups.length - 1; i >= 0; i--) {
    const pickup = room.pickups[i];
    const rr = (unit.holeR + pickup.r) * (unit.holeR + pickup.r);
    if (dist2(unit.x, unit.y, pickup.x, pickup.y) <= rr) {
      room.pickups.splice(i, 1);
      applyPickup(room, unit, pickup.type, now);
    }
  }
}

function findNearestEnemy(room, x, y, ownerId, maxDistance = 820) {
  let best = null;
  let bestD2 = maxDistance * maxDistance;
  for (const unit of getCompetitors(room)) {
    if (!unit.alive || unit.id === ownerId) {
      continue;
    }
    const d2 = dist2(x, y, unit.x, unit.y);
    if (d2 < bestD2) {
      best = unit;
      bestD2 = d2;
    }
  }
  return best;
}

function spawnSupportShot(room, ownerId, x, y, tx, ty, color = "#74e6ff", damage = 8.5, radius = 10) {
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy) || 1;
  room.turretShots.push({
    id: `shot_${room.nextEntityId++}`,
    ownerId,
    x,
    y,
    vx: (dx / len) * 860,
    vy: (dy / len) * 860,
    ttlMs: 1100,
    damage,
    r: radius,
    color
  });
}

function markHumanDefeat(room, loser, now, scorePenalty = 25) {
  loser.deaths += 1;
  loser.alive = false;
  loser.respawnAt = now + room.app.config.playerRespawnDelayMs;
  loser.score = Math.max(0, loser.score - scorePenalty);
  loser.mass = room.app.config.startMass;
  syncSize(loser);
  loser.speedUntil = 0;
  loser.magnetUntil = 0;
  loser.shieldUntil = 0;
  loser.invincibleUntil = 0;
}

function applyTurretDamage(room, ownerId, target, damage, now, x, y, color) {
  if (!target.alive || target.invincibleUntil > now) {
    return;
  }

  if (target.shieldUntil > now) {
    target.shieldUntil = 0;
    target.invincibleUntil = now + 1200;
    addPopup(room, x, y, "BLOCK", "#9ef3ff", 850, 20, 800);
    return;
  }

  const previousMass = target.mass;
  target.mass = Math.max(14, target.mass - damage);
  syncSize(target);
  if (!target.isBot) {
    target.score = Math.max(0, target.score - 2);
  }

  addPopup(room, x, y, `-${Math.max(1, Math.floor(damage))}`, color || "#74e6ff", 850, 20, 700);

  if (target.mass > 14.2) {
    return;
  }

  const owner = getCompetitorById(room, ownerId);
  if (owner && owner.alive) {
    owner.kills += 1;
    owner.mass += Math.max(5, Math.floor(previousMass * 0.12));
    syncSize(owner);
    if (!owner.isBot) {
      owner.score += 24;
    }
  }

  addPopup(room, target.x, target.y, "KO!", "#9cff68", 1100, 25, 900);

  if (target.isBot) {
    respawnBot(room, target);
    return;
  }

  markHumanDefeat(room, target, now, 20);
}

function updateTurretShots(room, dt, now) {
  for (let i = room.turretShots.length - 1; i >= 0; i--) {
    const shot = room.turretShots[i];
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.ttlMs -= dt * 1000;

    let hit = false;
    for (const unit of getCompetitors(room)) {
      if (!unit.alive || unit.id === shot.ownerId) {
        continue;
      }
      const rr = (unit.bodyR + shot.r) * (unit.bodyR + shot.r);
      if (dist2(shot.x, shot.y, unit.x, unit.y) <= rr) {
        applyTurretDamage(room, shot.ownerId, unit, shot.damage, now, shot.x, shot.y, shot.color);
        hit = true;
        break;
      }
    }

    if (hit || shot.ttlMs <= 0 || shot.x < -40 || shot.y < -40 || shot.x > WORLD.w + 40 || shot.y > WORLD.h + 40) {
      room.turretShots.splice(i, 1);
    }
  }
}

function updateControlPoints(room, dt, now) {
  const dtMs = dt * 1000;
  for (const controlPoint of room.controlPoints) {
    controlPoint.pulse += dt * 2.2;

    const pressure = new Map();
    for (const unit of getCompetitors(room)) {
      if (!unit.alive) {
        continue;
      }
      const rr = controlPoint.r + unit.bodyR;
      if (dist2(unit.x, unit.y, controlPoint.x, controlPoint.y) <= rr * rr) {
        pressure.set(unit.id, (pressure.get(unit.id) || 0) + 1);
      }
    }

    let topId = "";
    let topCount = 0;
    let secondCount = 0;
    for (const [unitId, count] of pressure.entries()) {
      if (count > topCount) {
        secondCount = topCount;
        topCount = count;
        topId = unitId;
      } else if (count > secondCount) {
        secondCount = count;
      }
    }

    const contested = topCount > 0 && topCount === secondCount;
    const prevOwnerId = controlPoint.ownerId;
    if (!topId || contested) {
      controlPoint.capture = clamp(controlPoint.capture - dt * (controlPoint.ownerId ? 0.07 : 0.04), 0, 1);
      if (controlPoint.capture <= 0.02) {
        controlPoint.ownerId = "";
      }
    } else if (controlPoint.ownerId === topId) {
      controlPoint.capture = clamp(controlPoint.capture + dt * 0.22, 0, 1);
    } else if (!controlPoint.ownerId) {
      controlPoint.capture = clamp(controlPoint.capture + dt * 0.16, 0, 1);
      if (controlPoint.capture >= 0.98) {
        controlPoint.ownerId = topId;
        controlPoint.capture = 1;
      }
    } else {
      controlPoint.capture = clamp(controlPoint.capture - dt * 0.22, 0, 1);
      if (controlPoint.capture <= 0.02) {
        controlPoint.ownerId = topId;
        controlPoint.capture = 0.12;
      }
    }

    if (prevOwnerId !== controlPoint.ownerId && controlPoint.ownerId) {
      const owner = getCompetitorById(room, controlPoint.ownerId);
      addPopup(room, controlPoint.x, controlPoint.y - controlPoint.r - 24, "OUTPOST ONLINE", "#67ddff", 2200, 34, 900);
      triggerBanner(room, "OUTPOST CAPTURED", "#67ddff", 3600, 0.34);
      if (owner && !owner.isBot) {
        owner.score += 18;
      }
    }

    if (controlPoint.ownerId) {
      const owner = getCompetitorById(room, controlPoint.ownerId);
      if (!owner) {
        controlPoint.ownerId = "";
        controlPoint.capture = 0;
        continue;
      }
      if (owner && owner.alive && !owner.isBot) {
        owner.score += dt * 4.2;
      }
      controlPoint.fireCdMs -= dtMs;
      if (controlPoint.fireCdMs <= 0) {
        controlPoint.fireCdMs = rand(room.rng, 1000, 1800);
        const target = findNearestEnemy(room, controlPoint.x, controlPoint.y, controlPoint.ownerId, 820);
        if (target) {
          spawnSupportShot(room, controlPoint.ownerId, controlPoint.x, controlPoint.y, target.x, target.y, "#74e6ff", 8.5, 10);
        }
      }
    }
  }
}

function chooseBotTarget(room, bot) {
  const opponents = getCompetitors(room).filter((unit) => unit.id !== bot.id && unit.alive);
  let nearestThreat = null;
  let nearestThreatD2 = Infinity;
  let nearestPrey = null;
  let nearestPreyD2 = Infinity;

  for (const opponent of opponents) {
    const d2 = dist2(bot.x, bot.y, opponent.x, opponent.y);
    if (opponent.mass > bot.mass * 1.18 && d2 < nearestThreatD2) {
      nearestThreat = opponent;
      nearestThreatD2 = d2;
    }
    if (opponent.mass < bot.mass * 0.96 && d2 < nearestPreyD2) {
      nearestPrey = opponent;
      nearestPreyD2 = d2;
    }
  }

  if (nearestThreat && nearestThreatD2 < 420 * 420) {
    const dx = bot.x - nearestThreat.x;
    const dy = bot.y - nearestThreat.y;
    const len = Math.hypot(dx, dy) || 1;
    bot.tx = clamp(bot.x + (dx / len) * rand(room.rng, 260, 360), 20, WORLD.w - 20);
    bot.ty = clamp(bot.y + (dy / len) * rand(room.rng, 260, 360), 20, WORLD.h - 20);
    return;
  }

  if (nearestPrey && (nearestPreyD2 < 760 * 760 || room.rng() < 0.38)) {
    bot.tx = clamp(nearestPrey.x + rand(room.rng, -45, 45), 20, WORLD.w - 20);
    bot.ty = clamp(nearestPrey.y + rand(room.rng, -45, 45), 20, WORLD.h - 20);
    return;
  }

  if (room.foods.civilians.length && room.rng() < 0.55) {
    const food = room.foods.civilians[Math.floor(room.rng() * room.foods.civilians.length) % room.foods.civilians.length];
    bot.tx = food.x + rand(room.rng, -18, 18);
    bot.ty = food.y + rand(room.rng, -18, 18);
    return;
  }

  if (room.foods.cars.length && room.rng() < 0.45) {
    const car = room.foods.cars[Math.floor(room.rng() * room.foods.cars.length) % room.foods.cars.length];
    bot.tx = car.x;
    bot.ty = car.y;
    return;
  }

  const point = randomRoadPos(room.rng);
  bot.tx = point.x;
  bot.ty = point.y;
}

function resolveShieldBlock(unit, attacker) {
  unit.shieldUntil = 0;
  unit.invincibleUntil = nowMs() + 1700;
  attacker.invincibleUntil = nowMs() + 900;
  const dx = unit.x - attacker.x;
  const dy = unit.y - attacker.y;
  const len = Math.hypot(dx, dy) || 1;
  unit.x = clamp(unit.x + (dx / len) * 150, unit.bodyR + 10, WORLD.w - unit.bodyR - 10);
  unit.y = clamp(unit.y + (dy / len) * 150, unit.bodyR + 10, WORLD.h - unit.bodyR - 10);
}

function respawnBot(room, bot) {
  bot.deaths += 1;
  const respawnMass = room.app.config.startMass + rand(room.rng, 4, 15);
  resetCompetitor(room, bot, respawnMass, room.app.config.botRespawnInvincibleMs);
}

function killHuman(room, winner, loser, now) {
  if (loser.shieldUntil > now) {
    resolveShieldBlock(loser, winner);
    addPopup(room, loser.x, loser.y - 14, "SHIELD BLOCK", "#9ef3ff", 1800, 28, 900);
    return;
  }

  winner.mass += Math.max(8, Math.floor(loser.mass * 0.22));
  syncSize(winner);
  winner.kills += 1;
  if (!winner.isBot) {
    winner.score += 42;
  }
  addPopup(room, loser.x, loser.y, "KO!", "#9cff68", 1000, 25, 900);
  markHumanDefeat(room, loser, now, 25);
}

function handleBattles(room, now) {
  const units = getCompetitors(room).filter((unit) => unit.alive);
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      const rr = a.bodyR + b.bodyR;
      if (dist2(a.x, a.y, b.x, b.y) > rr * rr) {
        continue;
      }
      if (a.invincibleUntil > now || b.invincibleUntil > now) {
        continue;
      }

      const aPower = a.mass * 1.03 + a.level * 7;
      const bPower = b.mass * 1.03 + b.level * 7;
      if (Math.abs(aPower - bPower) < 4) {
        continue;
      }

      const winner = aPower > bPower ? a : b;
      const loser = winner === a ? b : a;

      if (loser.isBot) {
        winner.mass += Math.max(6, Math.floor(loser.mass * 0.16));
        syncSize(winner);
        winner.kills += 1;
        if (!winner.isBot) {
          winner.score += 30;
        }
        respawnBot(room, loser);
      } else {
        killHuman(room, winner, loser, now);
      }
    }
  }
}

function updateRespawns(room) {
  const now = nowMs();
  for (const player of room.players.values()) {
    if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
      resetCompetitor(room, player, room.app.config.startMass, room.app.config.playerRespawnInvincibleMs);
    }
  }
}

function refillFoods(room) {
  if (room.elapsedMs - room.lastFoodRefillAt < room.app.config.foodReplenishIntervalMs) {
    return;
  }
  room.lastFoodRefillAt = room.elapsedMs;

  while (room.foods.civilians.length < room.app.config.minFoods.civilians) {
    room.foods.civilians.push(createCivilian(room));
  }
  while (room.foods.cars.length < room.app.config.minFoods.cars) {
    room.foods.cars.push(createCar(room));
  }
  while (room.foods.crates.length < room.app.config.minFoods.crates) {
    room.foods.crates.push(createCrate(room));
  }
  while (room.pickups.length < room.app.config.pickupMinCount) {
    spawnPickup(room, pick(room.rng, PICKUP_TYPES));
  }
}

function calculateRanking(room) {
  const ranking = getCompetitors(room).map((unit) => ({
    id: unit.id,
    name: unit.name,
    isBot: unit.isBot,
    color: unit.color,
    score: Math.floor(unit.score),
    mass: Math.floor(unit.mass),
    kills: unit.kills
  }));
  ranking.sort((a, b) => b.score - a.score || b.mass - a.mass || b.kills - a.kills || a.name.localeCompare(b.name));
  return ranking;
}

function endMatch(room) {
  room.phase = "finished";
  room.ranking = calculateRanking(room);
  broadcastRoom(room, buildRoomState(room));
  broadcastRoom(room, {
    type: "match_over",
    roomCode: room.code,
    ranking: room.ranking
  });
}

function stepRoom(room) {
  if (room.phase !== "running") {
    return;
  }

  const dt = room.app.config.tickMs / 1000;
  const dtMs = room.app.config.tickMs;
  const now = nowMs();
  room.tickCount += 1;
  room.elapsedMs += dtMs;
  room.timeLeftMs -= dtMs;
  updateRoomEffects(room, dtMs);

  if (room.timeLeftMs <= 0) {
    room.timeLeftMs = 0;
    endMatch(room);
    return;
  }

  for (const player of room.players.values()) {
    if (!player.alive) {
      continue;
    }
    const speedMul = 1 + (player.speedUntil > now ? 0.78 : 0);
    moveUnit(player, dt, player.tx, player.ty, speedMul);
    absorbFoods(room, player, now);
    collectPickups(room, player, now);
  }

  for (const bot of room.bots) {
    bot.aiThinkMs -= dtMs;
    if (bot.aiThinkMs <= 0 || dist2(bot.x, bot.y, bot.tx, bot.ty) < 40 * 40) {
      chooseBotTarget(room, bot);
      bot.aiThinkMs = rand(room.rng, 220, 560);
    }
    moveUnit(bot, dt, bot.tx, bot.ty, 1);
    absorbFoods(room, bot, now);
  }

  updateControlPoints(room, dt, now);
  updateTurretShots(room, dt, now);
  handleBattles(room, now);
  updateRespawns(room);
  refillFoods(room);

  if (room.tickCount % room.app.config.snapshotEveryTicks === 0) {
    broadcastSnapshots(room);
  }
}

function serializeCompetitor(unit, selfId, now) {
  return {
    id: unit.id,
    name: unit.name,
    color: unit.color,
    avatarKey: unit.avatarKey,
    isBot: unit.isBot,
    isSelf: unit.id === selfId,
    alive: unit.alive,
    x: round1(unit.x),
    y: round1(unit.y),
    angle: round2(unit.angle),
    mass: round1(unit.mass),
    level: unit.level,
    bodyR: round1(unit.bodyR),
    holeR: round1(unit.holeR),
    kills: unit.kills,
    score: Math.floor(unit.score),
    invincibleMs: Math.max(0, unit.invincibleUntil - now),
    respawnMs: unit.alive ? 0 : Math.max(0, unit.respawnAt - now),
    effects: unit.isBot
      ? { speedMs: 0, magnetMs: 0, shieldMs: 0 }
      : {
          speedMs: Math.max(0, unit.speedUntil - now),
          magnetMs: Math.max(0, unit.magnetUntil - now),
          shieldMs: Math.max(0, unit.shieldUntil - now)
        }
  };
}

function broadcastSnapshots(room) {
  if (room.phase !== "running") {
    return;
  }
  const now = nowMs();
  const base = {
    type: "snapshot",
    roomCode: room.code,
    phase: room.phase,
    serverTime: now,
    world: WORLD,
    timeLeftMs: room.timeLeftMs,
    ranking: calculateRanking(room).slice(0, 8),
    foods: {
      civilians: room.foods.civilians.map((food) => ({
        ...food,
        x: round1(food.x),
        y: round1(food.y),
        r: round1(food.r),
        scale: round2(food.scale),
        stride: round2(food.stride)
      })),
      cars: room.foods.cars.map((car) => ({
        ...car,
        x: round1(car.x),
        y: round1(car.y),
        w: round1(car.w),
        h: round1(car.h),
        rot: round2(car.rot),
        phase: round2(car.phase)
      })),
      crates: room.foods.crates.map((crate) => ({
        ...crate,
        x: round1(crate.x),
        y: round1(crate.y),
        r: round1(crate.r)
      }))
    },
    pickups: room.pickups.map((pickup) => ({
      ...pickup,
      x: round1(pickup.x),
      y: round1(pickup.y),
      r: round1(pickup.r),
      phase: round2(pickup.phase),
      rot: round2(pickup.rot)
    })),
    controlPoints: room.controlPoints.map((controlPoint) => ({
      id: controlPoint.id,
      x: round1(controlPoint.x),
      y: round1(controlPoint.y),
      r: round1(controlPoint.r),
      pulse: round2(controlPoint.pulse),
      ownerId: controlPoint.ownerId,
      capture: round2(controlPoint.capture)
    })),
    turretShots: room.turretShots.map((shot) => ({
      id: shot.id,
      x: round1(shot.x),
      y: round1(shot.y),
      r: round1(shot.r),
      color: shot.color
    })),
    popups: room.popups.map((popup) => ({
      id: popup.id,
      x: round1(popup.x),
      y: round1(popup.y),
      text: popup.text,
      color: popup.color,
      lifeMs: Math.max(0, Math.floor(popup.lifeMs)),
      maxLifeMs: popup.maxLifeMs,
      size: popup.size,
      weight: popup.weight
    })),
    eventBanner: {
      text: room.eventBanner.text,
      color: room.eventBanner.color,
      ttlMs: Math.max(0, Math.floor(room.eventBanner.ttlMs)),
      flash: round2(room.eventBanner.flash)
    }
  };

  for (const player of room.players.values()) {
    send(player.socket, {
      ...base,
      selfId: player.id,
      players: Array.from(room.players.values()).map((unit) => serializeCompetitor(unit, player.id, now)),
      bots: room.bots.map((bot) => serializeCompetitor(bot, player.id, now))
    });
  }
}

function removePlayerFromRoom(app, room, playerId) {
  if (!room.players.has(playerId)) {
    return;
  }

  room.players.delete(playerId);
  if (room.hostId === playerId) {
    const nextHost = room.players.values().next().value;
    room.hostId = nextHost ? nextHost.id : "";
  }

  if (room.players.size === 0) {
    app.rooms.delete(room.code);
    return;
  }

  broadcastRoom(room, buildRoomState(room));
}

function handleJoinRoom(app, ws, message, isCreate) {
  const name = safeName(message.name, `Player${String(app.playerCounter++).padStart(2, "0")}`);
  let room;

  leaveCurrentRoom(app, ws);

  if (isCreate) {
    const code = generateRoomCode(app.rooms);
    room = createRoom(app, code);
    app.rooms.set(code, room);
  } else {
    const roomCode = String(message.roomCode || "").trim().toUpperCase();
    room = app.rooms.get(roomCode);
    if (!room) {
      send(ws, { type: "error", message: "Room not found." });
      return;
    }
    if (room.phase === "running") {
      send(ws, { type: "error", message: "Room already started." });
      return;
    }
    if (room.players.size >= app.config.maxHumansPerRoom) {
      send(ws, { type: "error", message: "Room is full." });
      return;
    }
  }

  const playerId = randomUUID();
  const player = createHumanPlayer(playerId, name, room.players.size);
  player.socket = ws;
  room.players.set(playerId, player);
  if (!room.hostId) {
    room.hostId = playerId;
  }

  ws.playerId = playerId;
  ws.roomCode = room.code;

  send(ws, {
    type: "joined_room",
    playerId,
    roomCode: room.code,
    hostId: room.hostId
  });

  broadcastRoom(room, buildRoomState(room));
}

function leaveCurrentRoom(app, ws) {
  if (!ws.roomCode || !ws.playerId) {
    return;
  }
  const room = app.rooms.get(ws.roomCode);
  if (!room) {
    ws.roomCode = "";
    ws.playerId = "";
    return;
  }
  removePlayerFromRoom(app, room, ws.playerId);
  ws.roomCode = "";
  ws.playerId = "";
}

function handleMessage(app, ws, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    send(ws, { type: "error", message: "Invalid message payload." });
    return;
  }

  if (!message || typeof message.type !== "string") {
    send(ws, { type: "error", message: "Invalid message type." });
    return;
  }

  if (message.type === "create_room") {
    handleJoinRoom(app, ws, message, true);
    return;
  }

  if (message.type === "join_room") {
    handleJoinRoom(app, ws, message, false);
    return;
  }

  if (!ws.roomCode || !ws.playerId) {
    send(ws, { type: "error", message: "Join a room first." });
    return;
  }

  const room = app.rooms.get(ws.roomCode);
  if (!room) {
    send(ws, { type: "error", message: "Room expired. Join again." });
    ws.roomCode = "";
    ws.playerId = "";
    return;
  }

  const player = room.players.get(ws.playerId);
  if (!player) {
    send(ws, { type: "error", message: "Player missing from room." });
    ws.roomCode = "";
    ws.playerId = "";
    return;
  }

  if (message.type === "start_match") {
    if (room.hostId !== player.id) {
      send(ws, { type: "error", message: "Only the host can start the match." });
      return;
    }
    if (room.phase === "running") {
      return;
    }
    initializeMatch(room);
    return;
  }

  if (message.type === "input") {
    if (room.phase !== "running" || !player.alive) {
      return;
    }
    player.tx = clamp(Number(message.targetX) || player.tx, 20, WORLD.w - 20);
    player.ty = clamp(Number(message.targetY) || player.ty, 20, WORLD.h - 20);
    return;
  }

  if (message.type === "leave_room") {
    leaveCurrentRoom(app, ws);
    send(ws, { type: "left_room" });
  }
}

function createHttpHandler(rootDir) {
  return (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let pathname = url.pathname;
    if (pathname === "/") {
      pathname = "/index.html";
    }

    const decoded = decodeURIComponent(pathname);
    const safePath = path
      .normalize(decoded)
      .replace(/^(\.\.[/\\])+/, "")
      .replace(/^([/\\])+/, "");
    const filePath = path.join(rootDir, safePath);

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        const status = error.code === "ENOENT" ? 404 : 500;
        res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(status === 404 ? "Not found" : "Server error");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  };
}

function createAppServer(options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options,
    foods: { ...DEFAULT_CONFIG.foods, ...(options.foods || {}) },
    minFoods: { ...DEFAULT_CONFIG.minFoods, ...(options.minFoods || {}) }
  };

  const app = {
    config,
    rooms: new Map(),
    playerCounter: 1,
    tickHandle: null
  };

  const rootDir = path.resolve(__dirname);
  const server = http.createServer(createHttpHandler(rootDir));
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    ws.playerId = "";
    ws.roomCode = "";
    send(ws, { type: "hello" });

    ws.on("message", (raw) => {
      handleMessage(app, ws, raw);
    });

    ws.on("close", () => {
      leaveCurrentRoom(app, ws);
    });
  });

  function start(port = config.port) {
    return new Promise((resolve) => {
      server.listen(port, () => {
        const address = server.address();
        app.tickHandle = setInterval(() => {
          for (const room of app.rooms.values()) {
            stepRoom(room);
          }
        }, config.tickMs);
        resolve({
          port: typeof address === "object" && address ? address.port : port
        });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (app.tickHandle) {
        clearInterval(app.tickHandle);
        app.tickHandle = null;
      }
      for (const client of wss.clients) {
        client.close();
      }
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  }

  return { app, server, wss, start, stop };
}

if (require.main === module) {
  const instance = createAppServer();
  instance.start().then(({ port }) => {
    console.log(`Multiplayer server listening on http://0.0.0.0:${port}`);
  });
}

module.exports = { createAppServer, WORLD, ROADS_X, ROADS_Y, ROAD_W };
