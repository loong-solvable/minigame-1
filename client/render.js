import {
  WORLD,
  ROADS_X,
  ROADS_Y,
  ROAD_W,
  mapThemes,
  clamp,
  buildMap,
  createArtStore,
  getAvatarImage,
  loadArtAssets
} from "./constants.js";

export function createRenderer(canvas, refs, state) {
  const ctx = canvas.getContext("2d");
  const { roadRects, mapBlocks } = buildMap();
  const art = createArtStore();
  const camera = { x: 0, y: 0 };
  let dpr = 1;
  let viewW = 1;
  let viewH = 1;

  loadArtAssets(art, ({ progress }) => {
    state.assetLoadProgress = progress;
    state.assetsLoaded = progress >= 1;
  });

  function roundedRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getWorldPointer(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left + camera.x, 20, WORLD.w - 20),
      y: clamp(event.clientY - rect.top + camera.y, 20, WORLD.h - 20)
    };
  }

  function updateCamera(dt) {
    const self = state.visualPlayers.get(state.playerId) || null;
    const focusX = self ? self.displayX : WORLD.w * 0.5;
    const focusY = self ? self.displayY : WORLD.h * 0.5;
    const maxX = Math.max(0, WORLD.w - viewW);
    const maxY = Math.max(0, WORLD.h - viewH);
    const targetX = clamp(focusX - viewW * 0.5, 0, maxX);
    const targetY = clamp(focusY - viewH * 0.5, 0, maxY);
    camera.x += (targetX - camera.x) * Math.min(1, dt * 8);
    camera.y += (targetY - camera.y) * Math.min(1, dt * 8);
  }

  function drawRoads() {
    const theme = mapThemes[0];
    const bg = art.background;
    const bgReady = !!(bg && bg.complete && bg.naturalWidth > 0);
    const mapNative = bgReady && bg.naturalWidth >= WORLD.w && bg.naturalHeight >= WORLD.h;

    if (bgReady) {
      if (mapNative) {
        ctx.drawImage(bg, 0, 0, WORLD.w, WORLD.h);
      } else {
        const tw = bg.naturalWidth;
        const th = bg.naturalHeight;
        for (let y = 0; y < WORLD.h; y += th) {
          for (let x = 0; x < WORLD.w; x += tw) {
            ctx.drawImage(bg, x, y, tw, th);
          }
        }
      }
      ctx.fillStyle = mapNative ? "rgba(8,18,28,0.02)" : "rgba(8,18,28,0.05)";
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    } else {
      ctx.fillStyle = theme.grass;
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      for (const block of mapBlocks) {
        ctx.fillStyle = block.tint > 0.6 ? theme.blockB : block.tint > 0.3 ? theme.blockA : theme.blockC;
        ctx.fillRect(block.x, block.y, block.w, block.h);
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(block.x + 6, block.y + 6, block.w - 12, block.h - 12);
      }
    }

    ctx.fillStyle = bgReady ? (mapNative ? "rgba(18,22,30,0.08)" : "rgba(80,90,102,0.72)") : theme.road;
    for (const road of roadRects) {
      ctx.fillRect(road.x, road.y, road.w, road.h);
    }
  }

  function drawCivilians() {
    for (const civilian of state.foods.civilians) {
      const bob = Math.sin(state.elapsed * 6 + civilian.stride) * 1.4;
      const walk = Math.sin(state.elapsed * 10 + civilian.stride) * 0.9;
      const size = civilian.scale;

      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(civilian.x, civilian.y + 10, 5.2 * size, 2.3 * size, 0, 0, Math.PI * 2);
      ctx.fill();

      if (civilian.hat) {
        ctx.fillStyle = "#29354d";
        ctx.beginPath();
        ctx.ellipse(civilian.x, civilian.y - 8 + bob, 4.3 * size, 1.3 * size, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = civilian.hair;
      ctx.beginPath();
      ctx.arc(civilian.x, civilian.y - 5 + bob, 3.9 * size, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = civilian.skin;
      ctx.beginPath();
      ctx.arc(civilian.x, civilian.y - 4 + bob, 3.2 * size, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = civilian.shirt;
      roundedRectPath(civilian.x - 3.8 * size, civilian.y - 1 + bob, 7.6 * size, 8.2 * size, 2.2 * size);
      ctx.fill();

      ctx.strokeStyle = civilian.pants;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(civilian.x - 1.3 * size, civilian.y + 7 + bob);
      ctx.lineTo(civilian.x - 2.5 * size + walk, civilian.y + 11 + bob);
      ctx.moveTo(civilian.x + 1.3 * size, civilian.y + 7 + bob);
      ctx.lineTo(civilian.x + 2.5 * size - walk, civilian.y + 11 + bob);
      ctx.stroke();
    }
  }

  function drawCars() {
    for (const car of state.foods.cars) {
      const pulse = 0.93 + Math.sin(state.elapsed * 3.2 + car.phase) * 0.04;
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.rot);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      roundedRectPath(-car.w * 0.52, -car.h * 0.44, car.w * 1.04, car.h * 0.9, car.h * 0.24);
      ctx.fill();
      ctx.fillStyle = car.body;
      roundedRectPath(-car.w * 0.5, -car.h * 0.52, car.w, car.h * 1.04, car.h * 0.28);
      ctx.fill();

      const roofW = car.model === "van" ? car.w * 0.58 : car.w * 0.48;
      const roofH = car.model === "compact" ? car.h * 0.44 : car.h * 0.54;
      ctx.fillStyle = car.roof;
      roundedRectPath(-roofW * 0.5, -roofH * 0.5, roofW, roofH, car.h * 0.2);
      ctx.fill();

      if (car.stripe) {
        ctx.fillStyle = car.trim;
        roundedRectPath(-car.w * 0.38, -car.h * 0.08, car.w * 0.76, car.h * 0.16, car.h * 0.08);
        ctx.fill();
      }

      ctx.fillStyle = "#20242f";
      roundedRectPath(-car.w * 0.38, -car.h * 0.6, car.w * 0.2, car.h * 0.16, car.h * 0.06);
      ctx.fill();
      roundedRectPath(car.w * 0.18, -car.h * 0.6, car.w * 0.2, car.h * 0.16, car.h * 0.06);
      ctx.fill();
      roundedRectPath(-car.w * 0.38, car.h * 0.44, car.w * 0.2, car.h * 0.16, car.h * 0.06);
      ctx.fill();
      roundedRectPath(car.w * 0.18, car.h * 0.44, car.w * 0.2, car.h * 0.16, car.h * 0.06);
      ctx.fill();

      ctx.fillStyle = "#ffedaa";
      roundedRectPath(car.w * 0.44, -car.h * 0.32, car.w * 0.08 * pulse, car.h * 0.2, car.h * 0.05);
      ctx.fill();
      roundedRectPath(car.w * 0.44, car.h * 0.12, car.w * 0.08 * pulse, car.h * 0.2, car.h * 0.05);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCrates() {
    for (const crate of state.foods.crates) {
      ctx.fillStyle = "#c8843d";
      roundedRectPath(crate.x - crate.r, crate.y - crate.r, crate.r * 2, crate.r * 2, crate.r * 0.35);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      roundedRectPath(crate.x - crate.r * 0.45, crate.y - crate.r * 0.35, crate.r * 0.9, crate.r * 0.7, crate.r * 0.16);
      ctx.fill();
    }
  }

  function drawPickupIcon(pickup) {
    const t = state.elapsed * 2.8 + pickup.phase;
    ctx.save();
    ctx.translate(pickup.x, pickup.y + Math.sin(t) * 2.5);
    ctx.rotate(pickup.rot + state.elapsed * 0.9);
    if (pickup.type === "speed") {
      ctx.fillStyle = "#ffd44d";
      ctx.beginPath();
      ctx.moveTo(-4, -7);
      ctx.lineTo(1, -7);
      ctx.lineTo(-2, 0);
      ctx.lineTo(4, 0);
      ctx.lineTo(-3, 8);
      ctx.lineTo(-1, 2);
      ctx.lineTo(-6, 2);
      ctx.closePath();
      ctx.fill();
    } else if (pickup.type === "magnet") {
      ctx.strokeStyle = "#67ddff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 6, Math.PI * 0.15, Math.PI * 0.85, true);
      ctx.stroke();
      ctx.fillStyle = "#67ddff";
      ctx.fillRect(-7, -2, 3, 6);
      ctx.fillRect(4, -2, 3, 6);
    } else {
      ctx.strokeStyle = "#9ef3ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(7, -4);
      ctx.lineTo(6, 5);
      ctx.lineTo(0, 9);
      ctx.lineTo(-6, 5);
      ctx.lineTo(-7, -4);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPickups() {
    for (const pickup of state.pickups) {
      const pulse = 0.9 + Math.sin(state.elapsed * 6 + pickup.phase) * 0.08;
      const color = pickup.type === "speed"
        ? "rgba(255,212,77,0.4)"
        : pickup.type === "magnet"
          ? "rgba(103,221,255,0.38)"
          : "rgba(158,243,255,0.36)";

      ctx.beginPath();
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.ellipse(pickup.x, pickup.y + 10, pickup.r * 0.9, pickup.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(pickup.x, pickup.y, pickup.r * pulse, 0, Math.PI * 2);
      ctx.fill();
      drawPickupIcon(pickup);
    }
  }

  function findOwnerColor(ownerId) {
    if (!ownerId) return "";
    const player = state.visualPlayers.get(ownerId);
    if (player) return player.color;
    const bot = state.visualBots.get(ownerId);
    return bot ? bot.color : "";
  }

  function drawControlPoints() {
    const turretImg = art.turret && art.turret.complete && art.turret.naturalWidth > 0 ? art.turret : null;
    for (const controlPoint of state.controlPoints) {
      const pulse = 0.92 + Math.sin(state.elapsed * 4 + (controlPoint.pulse || 0)) * 0.08;
      const ownerColor = findOwnerColor(controlPoint.ownerId);
      const ringColor = ownerColor || "rgba(255,255,255,0.42)";
      const captureColor = ownerColor || "#ffd46d";

      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(controlPoint.x, controlPoint.y, controlPoint.r * pulse, 0, Math.PI * 2);
      ctx.stroke();

      if (controlPoint.capture > 0.01) {
        ctx.strokeStyle = captureColor;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(
          controlPoint.x,
          controlPoint.y,
          controlPoint.r + 10,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * controlPoint.capture
        );
        ctx.stroke();
      }

      if (turretImg) {
        const size = controlPoint.ownerId ? 120 : 104;
        ctx.save();
        ctx.translate(controlPoint.x, controlPoint.y - 14);
        if (ownerColor) {
          ctx.shadowColor = ownerColor;
          ctx.shadowBlur = 18;
        }
        ctx.drawImage(turretImg, -size * 0.5, -size * 0.5, size, size);
        ctx.restore();
      } else {
        ctx.fillStyle = ownerColor || "#6d7890";
        roundedRectPath(controlPoint.x - 24, controlPoint.y - 20, 48, 40, 10);
        ctx.fill();
      }
    }
  }

  function drawSupportShots() {
    for (const shot of state.turretShots) {
      const color = shot.color || "#74e6ff";
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawPopups() {
    for (const popup of state.popups) {
      const alpha = clamp((popup.lifeMs || 0) / Math.max(1, popup.maxLifeMs || 1), 0, 1);
      const popScale = 1 + Math.sin((1 - alpha) * Math.PI) * 0.08;
      const fontSize = Math.floor((popup.size || 24) * popScale);

      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${popup.weight || 700} ${fontSize}px Trebuchet MS`;
      ctx.lineWidth = Math.max(2, fontSize * 0.12);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(popup.text, popup.x, popup.y);
      ctx.shadowColor = popup.color || "#ffffff";
      ctx.shadowBlur = fontSize * 0.42;
      ctx.fillStyle = popup.color || "#ffffff";
      ctx.fillText(popup.text, popup.x, popup.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function drawEventOverlay() {
    const banner = state.eventBanner || { text: "", color: "#5ce1ff", ttlMs: 0, flash: 0 };

    if (banner.flash > 0) {
      const flash = clamp(banner.flash, 0, 0.8);
      ctx.save();
      ctx.globalAlpha = flash * 0.72;
      ctx.fillStyle = banner.color || "#5ce1ff";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.globalAlpha = flash * 0.24;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    if (banner.ttlMs <= 0 || !banner.text) {
      return;
    }

    const w = Math.min(700, viewW * 0.93);
    const h = 102;
    const x = (viewW - w) * 0.5;
    const y = 20 + Math.sin(state.elapsed * 12) * 2;
    const pulse = 0.62 + Math.sin(state.elapsed * 19) * 0.38;

    ctx.save();
    const bg = ctx.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, "rgba(8,16,28,0.95)");
    bg.addColorStop(1, "rgba(18,28,46,0.95)");
    ctx.fillStyle = bg;
    roundedRectPath(x, y, w, h, 18);
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.strokeStyle = banner.color || "#5ce1ff";
    roundedRectPath(x, y, w, h, 18);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    roundedRectPath(x + 3, y + 3, w - 6, h - 6, 15);
    ctx.stroke();

    ctx.globalAlpha = 0.18 + pulse * 0.24;
    ctx.fillStyle = banner.color || "#5ce1ff";
    roundedRectPath(x + 8, y + 8, w - 16, h - 16, 13);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = banner.color || "#5ce1ff";
    ctx.shadowBlur = 24;
    ctx.font = "900 44px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(banner.text, viewW * 0.5, y + h * 0.5 - 6);
    ctx.shadowBlur = 0;

    ctx.font = "700 19px Trebuchet MS";
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.fillText("增益已生效", viewW * 0.5, y + h - 21);
    ctx.restore();
  }

  function drawMatchTimerBar() {
    if (state.phase !== "running") {
      return;
    }

    const localTimeLeft = Math.max(0, state.timeLeftMs - (performance.now() - state.timeLeftSyncAt));
    const matchDurationMs = Math.max(localTimeLeft, state.matchDurationMs || localTimeLeft || 1);
    const progress = clamp(localTimeLeft / Math.max(1, matchDurationMs), 0, 1);
    const mm = Math.floor(localTimeLeft / 60000);
    const ss = Math.floor((localTimeLeft % 60000) / 1000).toString().padStart(2, "0");

    const isCritical = localTimeLeft <= 10000;
    const isWarning = !isCritical && localTimeLeft <= 30000;
    const accent = isCritical ? "#ff7c7c" : isWarning ? "#ffd95f" : "#5ce1ff";
    const pulse = isCritical ? 0.72 + Math.sin(state.elapsed * 18) * 0.22 : 0.66;

    const w = Math.min(420, viewW * 0.72);
    const h = 52;
    const x = (viewW - w) * 0.5;
    const y = 10;

    ctx.save();
    ctx.fillStyle = "rgba(7,14,24,0.8)";
    roundedRectPath(x, y, w, h, 14);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    roundedRectPath(x, y, w, h, 14);
    ctx.stroke();

    const barX = x + 14;
    const barY = y + h - 16;
    const barW = w - 28;
    const barH = 7;
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    roundedRectPath(barX, barY, barW, barH, 4);
    ctx.fill();

    if (progress > 0.001) {
      ctx.globalAlpha = pulse;
      ctx.fillStyle = accent;
      roundedRectPath(barX, barY, Math.max(4, barW * progress), barH, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = accent;
    ctx.shadowBlur = isCritical ? 18 : 10;
    ctx.font = "900 30px Trebuchet MS";
    ctx.fillText(`${mm}:${ss}`, viewW * 0.5, y + h * 0.46);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawRespawnOverlay() {
    const self = state.visualPlayers.get(state.playerId) || null;
    if (!self || self.alive || self.respawnMs <= 0) {
      return;
    }

    const remainingMs = Math.max(0, self.respawnMs);
    const totalMs = 3000;
    const progress = clamp(1 - remainingMs / totalMs, 0, 1);
    const countdown = clamp(Math.ceil(remainingMs / 1000), 1, 3);
    const pulse = 1 + Math.sin(state.elapsed * 14) * 0.04;
    const radius = Math.max(90, Math.min(viewW, viewH) * 0.16);

    ctx.save();
    ctx.fillStyle = "rgba(6,10,17,0.7)";
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.lineWidth = 16;
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.arc(viewW * 0.5, viewH * 0.5, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#ff8f8f";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(viewW * 0.5, viewH * 0.5, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#ff8f8f";
    ctx.shadowBlur = 28;
    const countFontSize = Math.floor(Math.max(84, Math.min(viewW, viewH) * 0.18) * pulse);
    ctx.font = `900 ${countFontSize}px Trebuchet MS`;
    ctx.fillText(String(countdown), viewW * 0.5, viewH * 0.5 + 4);
    ctx.shadowBlur = 0;

    ctx.font = "900 36px Trebuchet MS";
    ctx.fillText("即将复活", viewW * 0.5, viewH * 0.5 - radius - 54);
    ctx.font = "700 20px Trebuchet MS";
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.fillText("准备重返战场", viewW * 0.5, viewH * 0.5 + radius + 44);
    ctx.restore();
  }

  function drawDino(unit) {
    if (!unit.alive) return;
    const pulse = 0.96 + Math.sin(state.elapsed * 6 + unit.displayMass) * 0.05;
    const ringR = unit.displayHoleR * pulse;
    const effects = unit.effects || { speedMs: 0, magnetMs: 0, shieldMs: 0 };

    if (effects.magnetMs > 0) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(103,221,255,0.7)";
      ctx.beginPath();
      ctx.arc(unit.displayX, unit.displayY, unit.displayHoleR * 1.62, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (effects.shieldMs > 0) {
      const rr = unit.displayHoleR + 18 + Math.sin(state.elapsed * 9) * 2;
      ctx.fillStyle = "rgba(158,243,255,0.13)";
      ctx.beginPath();
      ctx.arc(unit.displayX, unit.displayY, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(158,243,255,0.75)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(unit.displayX, unit.displayY, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (effects.speedMs > 0) {
      for (let i = 0; i < 3; i++) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(255,212,77,${0.42 - i * 0.1})`;
        ctx.beginPath();
        ctx.arc(unit.displayX, unit.displayY, unit.displayHoleR + 14 + i * 10, state.elapsed * 7 + i, state.elapsed * 7 + i + Math.PI * 0.9);
        ctx.stroke();
      }
    }

    ctx.lineWidth = 7;
    ctx.strokeStyle = unit.color;
    ctx.fillStyle = "rgba(0,0,0,0.92)";
    ctx.beginPath();
    ctx.arc(unit.displayX, unit.displayY, ringR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const avatar = getAvatarImage(art, unit);
    if (avatar) {
      const size = unit.displayBodyR * 2.45;
      ctx.save();
      ctx.translate(unit.displayX, unit.displayY - unit.displayBodyR * 0.06);
      ctx.rotate(clamp(unit.displayAngle * 0.08, -0.35, 0.35));
      ctx.drawImage(avatar, -size * 0.5, -size * 0.5, size, size);
      ctx.restore();
    } else {
      const body = unit.displayBodyR;
      ctx.save();
      ctx.translate(unit.displayX, unit.displayY);
      ctx.rotate(unit.displayAngle);
      ctx.fillStyle = unit.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, body, body * 0.64, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-body * 0.5, 0);
      ctx.lineTo(-body * 1.35, -body * 0.3);
      ctx.lineTo(-body * 1.45, body * 0.23);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(body * 0.64, -body * 0.05, body * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f1420";
      ctx.beginPath();
      ctx.arc(body * 0.9, -body * 0.16, Math.max(2, body * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${unit.isSelf ? 25 : 19}px Trebuchet MS`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(unit.name, unit.displayX, unit.displayY - unit.displayHoleR - 20);
    ctx.font = "700 16px Trebuchet MS";
    ctx.fillText(`Lv.${unit.level}`, unit.displayX, unit.displayY - unit.displayHoleR - 2);

    if (unit.invincibleMs > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(unit.displayX, unit.displayY, unit.displayHoleR + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function renderHud() {
    const self = state.visualPlayers.get(state.playerId) || null;
    const localTimeLeft = Math.max(0, state.timeLeftMs - (performance.now() - state.timeLeftSyncAt));
    const mm = Math.floor(localTimeLeft / 60000);
    const ss = Math.floor((localTimeLeft % 60000) / 1000).toString().padStart(2, "0");

    if (self) {
      const effects = [];
      if (self.effects?.speedMs > 0) effects.push(`Speed ${(self.effects.speedMs / 1000).toFixed(1)}s`);
      if (self.effects?.magnetMs > 0) effects.push(`Magnet ${(self.effects.magnetMs / 1000).toFixed(1)}s`);
      if (self.effects?.shieldMs > 0) effects.push(`Shield ${(self.effects.shieldMs / 1000).toFixed(1)}s`);
      refs.statsEl.innerHTML =
        `<strong style="color:#5ce1ff">Dino Hole Rampage Online</strong><br>` +
        `房间: <strong>${state.roomCode || "-----"}</strong>  对局时间: <strong style="color:#9cff68">${mm}:${ss}</strong><br>` +
        `Lv: <strong>${self.level}</strong>  质量: <strong>${Math.floor(self.displayMass)}</strong><br>` +
        `得分: <strong>${self.score}</strong>  击败: <strong>${self.kills}</strong><br>` +
        `状态: <strong style="color:${self.alive ? "#ffd95f" : "#ff7c7c"}">${self.alive ? "在线战斗中" : `重生 ${(self.respawnMs / 1000).toFixed(1)}s`}</strong><br>` +
        `效果: ${effects.length ? effects.join(" | ") : "无"}`;
    } else {
      refs.statsEl.innerHTML = `<strong style="color:#5ce1ff">Dino Hole Rampage Online</strong><br>创建或加入房间，等待房主开局。`;
    }

    let boardText = "";
    state.ranking.slice(0, 5).forEach((row, index) => {
      const marker = row.id === state.playerId ? ">> " : "   ";
      boardText += `${index + 1}. ${marker}${row.name}${row.isBot ? " [BOT]" : ""}  ${row.score}\n`;
    });
    refs.boardEl.textContent = boardText.trim();
  }

  function updateHint() {
    if (!state.roomCode) {
      refs.hintEl.textContent = "输入昵称，创建房间或输入房间码加入";
      return;
    }
    if (state.phase !== "running") {
      refs.hintEl.textContent = state.playerId === state.hostId ? "分享房间码并点击开始对局" : "等待房主开始对局";
      return;
    }
    const self = state.visualPlayers.get(state.playerId) || null;
    if (!self) {
      refs.hintEl.textContent = "等待服务器同步中";
      return;
    }
    if (!self.alive) {
      refs.hintEl.textContent = `你已被击败，将在 ${(self.respawnMs / 1000).toFixed(1)} 秒后重生`;
      return;
    }
    refs.hintEl.textContent = "按住并拖动控制恐龙黑洞，吃资源、抢拾取、击败对手";
  }

  function frame(dt) {
    updateCamera(dt);
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    drawRoads();
    drawControlPoints();
    drawCars();
    drawCrates();
    drawPickups();
    drawCivilians();
    drawSupportShots();
    for (const bot of state.visualBots.values()) drawDino(bot);
    for (const player of state.visualPlayers.values()) drawDino(player);
    drawPopups();
    ctx.restore();
    drawEventOverlay();
    drawMatchTimerBar();
    drawRespawnOverlay();
    renderHud();
    updateHint();
  }

  return {
    resize,
    frame,
    getWorldPointer
  };
}
