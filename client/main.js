import { WORLD, clamp, dist2, lerp, lerpAngle } from "./constants.js";
import { createRenderer } from "./render.js";

const refs = {
  statsEl: document.getElementById("stats"),
  boardEl: document.getElementById("leaderboard"),
  hintEl: document.getElementById("hint"),
  menuOverlay: document.getElementById("menuOverlay"),
  landingSection: document.getElementById("landingSection"),
  roomSection: document.getElementById("roomSection"),
  nameInput: document.getElementById("nameInput"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  roomCodeBadge: document.getElementById("roomCodeBadge"),
  playersList: document.getElementById("playersList"),
  startMatchBtn: document.getElementById("startMatchBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  copyRoomBtn: document.getElementById("copyRoomBtn"),
  hostStatusEl: document.getElementById("hostStatus"),
  phaseStatusEl: document.getElementById("phaseStatus"),
  menuErrorEl: document.getElementById("menuError"),
  resultOverlay: document.getElementById("resultOverlay"),
  resultSummary: document.getElementById("resultSummary"),
  resultBoard: document.getElementById("resultBoard"),
  rematchBtn: document.getElementById("rematchBtn"),
  leaveAfterMatchBtn: document.getElementById("leaveAfterMatchBtn"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingStatus: document.getElementById("loadingStatus"),
  loadingProgressFill: document.getElementById("loadingProgressFill"),
  loadingProgressText: document.getElementById("loadingProgressText")
};

const canvas = document.getElementById("game");
const state = {
  socket: null,
  socketOpen: false,
  pendingMessages: [],
  playerId: "",
  roomCode: "",
  hostId: "",
  phase: "menu",
  roomPlayers: [],
  ranking: [],
  finalRanking: [],
  foods: { civilians: [], cars: [], crates: [] },
  pickups: [],
  controlPoints: [],
  turretShots: [],
  popups: [],
  eventBanner: { text: "", color: "#5ce1ff", ttlMs: 0, flash: 0 },
  assetsLoaded: false,
  assetLoadProgress: 0,
  hasSnapshot: false,
  loadingProgress: 0,
  matchDurationMs: 0,
  timeLeftMs: 0,
  timeLeftSyncAt: performance.now(),
  elapsed: 0,
  pointer: null,
  pointerActive: false,
  lastInputSentAt: 0,
  visualPlayers: new Map(),
  visualBots: new Map()
};

const renderer = createRenderer(canvas, refs, state);

let lastTs = 0;
refs.nameInput.value = localStorage.getItem("dino-hole-name") || "";

function ensureSocket() {
  if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.socket = socket;
  state.socketOpen = false;

  socket.addEventListener("open", () => {
    state.socketOpen = true;
    flushPendingMessages();
    setMenuError("");
  });

  socket.addEventListener("message", (event) => {
    try {
      handleServerMessage(JSON.parse(event.data));
    } catch {
      setMenuError("收到无效服务器消息。");
    }
  });

  socket.addEventListener("close", () => {
    state.socketOpen = false;
    state.socket = null;
    if (state.roomCode) {
      setMenuError("连接已断开，请刷新页面后重新加入房间。");
      resetClientState();
    }
  });
}

function send(payload) {
  ensureSocket();
  if (state.socketOpen) {
    state.socket.send(JSON.stringify(payload));
  } else {
    state.pendingMessages.push(payload);
  }
}

function flushPendingMessages() {
  while (state.pendingMessages.length && state.socketOpen) {
    state.socket.send(JSON.stringify(state.pendingMessages.shift()));
  }
}

function setMenuError(message) {
  refs.menuErrorEl.textContent = message || "";
}

function saveName() {
  const value = refs.nameInput.value.trim().slice(0, 14);
  refs.nameInput.value = value;
  localStorage.setItem("dino-hole-name", value);
  return value;
}

function resetClientState() {
  state.playerId = "";
  state.roomCode = "";
  state.hostId = "";
  state.phase = "menu";
  state.roomPlayers = [];
  state.ranking = [];
  state.finalRanking = [];
  state.foods = { civilians: [], cars: [], crates: [] };
  state.pickups = [];
  state.controlPoints = [];
  state.turretShots = [];
  state.popups = [];
  state.eventBanner = { text: "", color: "#5ce1ff", ttlMs: 0, flash: 0 };
  state.hasSnapshot = false;
  state.loadingProgress = 0;
  state.matchDurationMs = 0;
  state.timeLeftMs = 0;
  state.timeLeftSyncAt = performance.now();
  state.pointer = null;
  state.pointerActive = false;
  state.visualPlayers.clear();
  state.visualBots.clear();
  refs.resultOverlay.classList.add("hidden");
  refs.loadingOverlay.classList.add("hidden");
  updateOverlays();
}

function createOrJoinRoom(isCreate) {
  const name = saveName();
  if (!name) {
    setMenuError("请输入昵称。");
    refs.nameInput.focus();
    return;
  }

  if (isCreate) {
    send({ type: "create_room", name });
    return;
  }

  const roomCode = refs.roomCodeInput.value.trim().toUpperCase();
  refs.roomCodeInput.value = roomCode;
  if (roomCode.length < 5) {
    setMenuError("请输入 5 位房间码。");
    refs.roomCodeInput.focus();
    return;
  }
  send({ type: "join_room", name, roomCode });
}

function handleServerMessage(message) {
  if (message.type === "hello") {
    return;
  }

  if (message.type === "joined_room") {
    state.playerId = message.playerId;
    state.roomCode = message.roomCode;
    state.hostId = message.hostId;
    state.phase = "lobby";
    state.hasSnapshot = false;
    state.loadingProgress = 0;
    state.matchDurationMs = 0;
    state.finalRanking = [];
    setMenuError("");
    updateOverlays();
    return;
  }

  if (message.type === "room_state") {
    const prevPhase = state.phase;
    state.roomCode = message.roomCode || state.roomCode;
    state.hostId = message.hostId || "";
    state.roomPlayers = message.players || [];
    state.phase = message.phase || state.phase;
    if (prevPhase !== "running" && state.phase === "running") {
      state.hasSnapshot = false;
      state.loadingProgress = Math.min(state.loadingProgress, 0.08);
    }
    if (state.phase === "finished") {
      state.finalRanking = message.ranking || [];
      showResults();
    } else if (state.phase !== "running") {
      refs.resultOverlay.classList.add("hidden");
    }
    renderRoomPlayers();
    updateOverlays();
    return;
  }

  if (message.type === "snapshot") {
    applySnapshot(message);
    return;
  }

  if (message.type === "match_over") {
    state.phase = "finished";
    state.finalRanking = message.ranking || [];
    showResults();
    updateOverlays();
    return;
  }

  if (message.type === "left_room") {
    resetClientState();
    return;
  }

  if (message.type === "error") {
    setMenuError(message.message || "操作失败。");
  }
}

function applySnapshot(snapshot) {
  const previousTimeLeftMs = state.timeLeftMs;
  state.phase = "running";
  state.roomCode = snapshot.roomCode;
  state.ranking = snapshot.ranking || [];
  state.foods = snapshot.foods || { civilians: [], cars: [], crates: [] };
  state.pickups = snapshot.pickups || [];
  state.controlPoints = (snapshot.controlPoints || []).map((controlPoint) => ({ ...controlPoint }));
  state.turretShots = (snapshot.turretShots || []).map((shot) => ({ ...shot }));
  state.popups = (snapshot.popups || []).map((popup) => ({ ...popup }));
  state.eventBanner = {
    text: snapshot.eventBanner?.text || "",
    color: snapshot.eventBanner?.color || "#5ce1ff",
    ttlMs: Math.max(0, snapshot.eventBanner?.ttlMs || 0),
    flash: Math.max(0, snapshot.eventBanner?.flash || 0)
  };
  state.hasSnapshot = true;
  state.timeLeftMs = snapshot.timeLeftMs || 0;
  if (state.matchDurationMs <= 0 || state.timeLeftMs > previousTimeLeftMs + 2000) {
    state.matchDurationMs = state.timeLeftMs;
  } else if (state.timeLeftMs > state.matchDurationMs) {
    state.matchDurationMs = state.timeLeftMs;
  }
  state.timeLeftSyncAt = performance.now();
  refs.resultOverlay.classList.add("hidden");
  syncVisualMap(state.visualPlayers, snapshot.players || []);
  syncVisualMap(state.visualBots, snapshot.bots || []);
  updateOverlays();
}

function syncVisualMap(store, incoming) {
  const seen = new Set();
  for (const unit of incoming) {
    seen.add(unit.id);
    const existing = store.get(unit.id);
    if (!existing) {
      store.set(unit.id, {
        ...unit,
        displayX: unit.x,
        displayY: unit.y,
        displayAngle: unit.angle,
        displayMass: unit.mass,
        displayBodyR: unit.bodyR,
        displayHoleR: unit.holeR,
        targetX: unit.x,
        targetY: unit.y,
        targetAngle: unit.angle,
        targetMass: unit.mass,
        targetBodyR: unit.bodyR,
        targetHoleR: unit.holeR
      });
      continue;
    }

    const teleported = dist2(existing.targetX, existing.targetY, unit.x, unit.y) > 460 * 460;
    const respawned = !existing.alive && unit.alive;
    existing.targetX = unit.x;
    existing.targetY = unit.y;
    existing.targetAngle = unit.angle;
    existing.targetMass = unit.mass;
    existing.targetBodyR = unit.bodyR;
    existing.targetHoleR = unit.holeR;
    Object.assign(existing, unit);
    if (teleported || respawned) {
      existing.displayX = unit.x;
      existing.displayY = unit.y;
      existing.displayAngle = unit.angle;
      existing.displayMass = unit.mass;
      existing.displayBodyR = unit.bodyR;
      existing.displayHoleR = unit.holeR;
    }
  }

  for (const id of Array.from(store.keys())) {
    if (!seen.has(id)) {
      store.delete(id);
    }
  }
}

function stepVisuals(dt) {
  const alpha = 1 - Math.exp(-dt * 12);
  const dtMs = dt * 1000;
  for (const store of [state.visualPlayers, state.visualBots]) {
    for (const unit of store.values()) {
      unit.displayX = lerp(unit.displayX, unit.targetX, alpha);
      unit.displayY = lerp(unit.displayY, unit.targetY, alpha);
      unit.displayAngle = lerpAngle(unit.displayAngle, unit.targetAngle, alpha);
      unit.displayMass = lerp(unit.displayMass, unit.targetMass, alpha);
      unit.displayBodyR = lerp(unit.displayBodyR, unit.targetBodyR, alpha);
      unit.displayHoleR = lerp(unit.displayHoleR, unit.targetHoleR, alpha);
      if (unit.invincibleMs > 0) {
        unit.invincibleMs = Math.max(0, unit.invincibleMs - dtMs);
      }
      if (!unit.alive && unit.respawnMs > 0) {
        unit.respawnMs = Math.max(0, unit.respawnMs - dtMs);
      }
      if (unit.effects) {
        if (unit.effects.speedMs > 0) unit.effects.speedMs = Math.max(0, unit.effects.speedMs - dtMs);
        if (unit.effects.magnetMs > 0) unit.effects.magnetMs = Math.max(0, unit.effects.magnetMs - dtMs);
        if (unit.effects.shieldMs > 0) unit.effects.shieldMs = Math.max(0, unit.effects.shieldMs - dtMs);
      }
    }
  }

  if (state.eventBanner.ttlMs > 0) {
    state.eventBanner.ttlMs = Math.max(0, state.eventBanner.ttlMs - dtMs);
  }
  if (state.eventBanner.flash > 0) {
    state.eventBanner.flash = Math.max(0, state.eventBanner.flash - dt * 0.38);
  }

  for (let i = state.popups.length - 1; i >= 0; i--) {
    const popup = state.popups[i];
    const rise = 22 + (popup.size || 24) * 0.85;
    popup.y -= rise * dt;
    popup.lifeMs -= dtMs;
    if (popup.lifeMs <= 0) {
      state.popups.splice(i, 1);
    }
  }
}

function renderRoomPlayers() {
  refs.playersList.innerHTML = "";
  for (const player of state.roomPlayers) {
    const row = document.createElement("div");
    row.className = "playerRow";
    row.innerHTML = `
      <div class="playerSwatch" style="background:${player.color}"></div>
      <div>
        <div class="playerName">${player.id === state.hostId ? "[房主] " : ""}${player.name}${player.id === state.playerId ? " (你)" : ""}</div>
        <div class="playerMeta">${state.phase === "finished" ? "等待下一局" : "准备完毕"}</div>
      </div>
      <div class="playerMeta">${player.connected ? "在线" : "离线"}</div>
    `;
    refs.playersList.append(row);
  }
}

function updateOverlays() {
  const inRoom = !!state.roomCode;
  const isRunning = state.phase === "running";
  const isHost = state.playerId && state.playerId === state.hostId;
  const hostPlayer = state.roomPlayers.find((player) => player.id === state.hostId);

  refs.menuOverlay.classList.toggle("hidden", isRunning);
  refs.landingSection.classList.toggle("hidden", inRoom);
  refs.roomSection.classList.toggle("hidden", !inRoom);

  if (!inRoom) return;

  refs.roomCodeBadge.textContent = state.roomCode;
  refs.hostStatusEl.textContent = isHost ? "你是房主" : `房主: ${hostPlayer ? hostPlayer.name : "-"}`;
  refs.phaseStatusEl.textContent = state.phase === "finished" ? "等待下一局" : "等待开局";
  refs.startMatchBtn.disabled = !isHost;
  refs.startMatchBtn.textContent = state.phase === "finished" ? "再开一局" : "开始对局";
  refs.rematchBtn.disabled = !isHost;
}

function updateLoadingOverlay(dt = 0) {
  if (!refs.loadingOverlay || !refs.loadingProgressFill || !refs.loadingProgressText || !refs.loadingStatus) return;

  if (state.phase !== "running") {
    state.loadingProgress = 0;
    refs.loadingOverlay.classList.add("hidden");
    return;
  }

  const waitingForAssets = !state.assetsLoaded;
  const waitingForSnapshot = !state.hasSnapshot;
  const waiting = waitingForAssets || waitingForSnapshot;
  const targetProgress = waiting
    ? clamp(0.08 + state.assetLoadProgress * 0.68 + (waitingForSnapshot ? 0.12 : 0.24), 0.08, 0.95)
    : 1;
  const alpha = dt > 0 ? 1 - Math.exp(-dt * 8) : 1;
  state.loadingProgress = lerp(state.loadingProgress, targetProgress, alpha);

  if (!waiting && state.loadingProgress >= 0.995) {
    refs.loadingOverlay.classList.add("hidden");
    return;
  }

  refs.loadingOverlay.classList.remove("hidden");
  refs.loadingProgressFill.style.width = `${Math.round(clamp(state.loadingProgress, 0, 1) * 100)}%`;
  refs.loadingProgressText.textContent = `${Math.round(clamp(state.loadingProgress, 0, 1) * 100)}%`;
  refs.loadingStatus.textContent = waitingForAssets
    ? "正在准备资源..."
    : waitingForSnapshot
      ? "正在同步战场..."
      : "即将进入对局...";
}

function showResults() {
  if (!state.finalRanking.length) return;
  const rank = state.finalRanking.findIndex((row) => row.id === state.playerId) + 1;
  const self = state.finalRanking.find((row) => row.id === state.playerId);
  refs.resultSummary.textContent = rank
    ? `你的排名: ${rank}/${state.finalRanking.length}  |  得分: ${self.score}  |  质量: ${self.mass}  |  击败: ${self.kills}`
    : `房间 ${state.roomCode} 对局结束。`;
  refs.resultBoard.innerHTML = "";
  state.finalRanking.forEach((row, index) => {
    const div = document.createElement("div");
    div.className = "resultRow";
    div.innerHTML = `
      <div class="playerSwatch" style="background:${row.color}"></div>
      <div>
        <div class="resultName">${index + 1}. ${row.name}${row.id === state.playerId ? " (你)" : ""}${row.isBot ? " [BOT]" : ""}</div>
        <div class="resultMeta">得分 ${row.score}  |  质量 ${row.mass}  |  击败 ${row.kills}</div>
      </div>
      <div class="resultMeta">${index === 0 ? "冠军" : ""}</div>
    `;
    refs.resultBoard.append(div);
  });
  refs.resultOverlay.classList.remove("hidden");
}

function sendPointer(force = false) {
  if (state.phase !== "running" || !state.pointer) return;
  const now = performance.now();
  if (!force && now - state.lastInputSentAt < 45) return;
  state.lastInputSentAt = now;
  send({
    type: "input",
    targetX: state.pointer.x,
    targetY: state.pointer.y
  });
}

function onPointerDown(event) {
  if (state.phase !== "running") return;
  state.pointerActive = true;
  state.pointer = renderer.getWorldPointer(event);
  sendPointer(true);
}

function onPointerMove(event) {
  if (!state.pointerActive && event.pointerType !== "mouse") return;
  if (state.phase !== "running") return;
  state.pointer = renderer.getWorldPointer(event);
  if (state.pointerActive) sendPointer();
}

function onPointerUp() {
  state.pointerActive = false;
}

function copyRoomCode() {
  if (!state.roomCode) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(state.roomCode).then(() => {
      setMenuError("房间码已复制。");
    }).catch(() => {
      setMenuError(`房间码: ${state.roomCode}`);
    });
  } else {
    setMenuError(`房间码: ${state.roomCode}`);
  }
}

function copyByExecCommand(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

async function copyRoomCodeSafe() {
  if (!state.roomCode) return;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(state.roomCode);
      setMenuError("房间码已复制。");
      return;
    } catch {
      // Fall through to the compatibility path.
    }
  }

  if (copyByExecCommand(state.roomCode)) {
    setMenuError("房间码已复制。");
    return;
  }

  try {
    window.prompt("复制失败，请手动复制房间码：", state.roomCode);
  } catch {
    // Ignore prompt errors.
  }
  setMenuError(`房间码: ${state.roomCode}`);
}

function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.033, (ts - lastTs) / 1000);
  lastTs = ts;
  state.elapsed += dt;
  stepVisuals(dt);
  updateLoadingOverlay(dt);
  renderer.frame(dt);
  requestAnimationFrame(loop);
}

refs.createRoomBtn.addEventListener("click", () => createOrJoinRoom(true));
refs.joinRoomBtn.addEventListener("click", () => createOrJoinRoom(false));
refs.startMatchBtn.addEventListener("click", () => send({ type: "start_match" }));
refs.rematchBtn.addEventListener("click", () => send({ type: "start_match" }));
refs.leaveRoomBtn.addEventListener("click", () => send({ type: "leave_room" }));
refs.leaveAfterMatchBtn.addEventListener("click", () => send({ type: "leave_room" }));
refs.copyRoomBtn.addEventListener("click", copyRoomCodeSafe);
refs.roomCodeInput.addEventListener("input", () => {
  refs.roomCodeInput.value = refs.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
});
refs.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    createOrJoinRoom(true);
  }
});
refs.roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    createOrJoinRoom(false);
  }
});

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
window.addEventListener("resize", () => renderer.resize());
window.setInterval(() => {
  if (state.pointerActive) sendPointer();
}, 50);

renderer.resize();
updateOverlays();
updateLoadingOverlay();
requestAnimationFrame(loop);
