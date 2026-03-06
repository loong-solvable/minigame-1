export const WORLD = { w: 2200, h: 3200 };
export const ROAD_W = 130;
export const ROADS_X = [330, 770, 1210, 1650, 2010];
export const ROADS_Y = [260, 700, 1140, 1580, 2020, 2460, 2900];

export const mapThemes = [
  { grass: "#617a56", road: "rgba(94, 101, 110, 0.7)", blockA: "#61744f", blockB: "#576a48", blockC: "#4f6142" },
  { grass: "#6f6455", road: "rgba(98, 102, 112, 0.78)", blockA: "#76644a", blockB: "#665744", blockC: "#584d3f" }
];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function lerp(current, target, alpha) {
  return current + (target - current) * alpha;
}

export function lerpAngle(current, target, alpha) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

export function buildMap() {
  const roadRects = [];
  const mapBlocks = [];

  for (const rx of ROADS_X) {
    roadRects.push({ x: rx - ROAD_W / 2, y: 0, w: ROAD_W, h: WORLD.h });
  }
  for (const ry of ROADS_Y) {
    roadRects.push({ x: 0, y: ry - ROAD_W / 2, w: WORLD.w, h: ROAD_W });
  }

  const step = 220;
  for (let y = 0; y < WORLD.h; y += step) {
    for (let x = 0; x < WORLD.w; x += step) {
      let isRoad = false;
      for (const r of roadRects) {
        if (x + step * 0.5 > r.x && x + step * 0.5 < r.x + r.w && y + step * 0.5 > r.y && y + step * 0.5 < r.y + r.h) {
          isRoad = true;
          break;
        }
      }
      if (isRoad) continue;
      mapBlocks.push({
        x: x + 8,
        y: y + 8,
        w: step - 16,
        h: step - 16,
        tint: (Math.sin(x * 0.007 + y * 0.005) + 1) * 0.5
      });
    }
  }

  return { roadRects, mapBlocks };
}

export function createArtStore() {
  return {
    background: null,
    turret: null,
    avatars: Object.create(null),
    totalAssets: 0,
    loadedAssets: 0,
    loaded: false
  };
}

export function loadArtAssets(art, onProgress = null) {
  const files = {
    background: "../assets/processed/scene_canyon_map.png",
    turret: "../assets/processed/prop_turret_cannon.png",
    hero_beetle: "../assets/processed/hero_beetle.png",
    hero_mage: "../assets/processed/hero_mage.png",
    hero_archer: "../assets/processed/hero_archer.png",
    hero_guard: "../assets/processed/hero_guard.png",
    enemy_zhamao: "../assets/processed/enemy_zhamao.png",
    enemy_diaomao: "../assets/processed/enemy_diaomao.png",
    enemy_sanmao: "../assets/processed/enemy_sanmao.png",
    enemy_ant_1: "../assets/processed/enemy_ant_1.png"
  };

  let pending = 0;
  art.totalAssets = Object.keys(files).length;
  art.loadedAssets = 0;
  art.loaded = art.totalAssets === 0;
  const done = () => {
    art.loadedAssets += 1;
    pending -= 1;
    if (typeof onProgress === "function") {
      onProgress({
        loaded: art.loadedAssets,
        total: art.totalAssets,
        progress: art.totalAssets > 0 ? art.loadedAssets / art.totalAssets : 1
      });
    }
    if (pending <= 0) {
      art.loaded = true;
    }
  };

  const loadImage = (src, setFn) => {
    const img = new Image();
    pending += 1;
    img.onload = done;
    img.onerror = done;
    img.src = src;
    setFn(img);
  };

  loadImage(files.background, (img) => {
    art.background = img;
  });

  loadImage(files.turret, (img) => {
    art.turret = img;
  });

  for (const key of Object.keys(files)) {
    if (key === "background" || key === "turret") continue;
    loadImage(files[key], (img) => {
      art.avatars[key] = img;
    });
  }
}

export function getAvatarImage(art, unit) {
  if (!unit || !unit.avatarKey) return null;
  const img = art.avatars[unit.avatarKey];
  if (!img || !img.complete || img.naturalWidth === 0) return null;
  return img;
}
