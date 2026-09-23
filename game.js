import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/OutputPass.js";
import { loadNormalized } from "./game-assets.js";
import {
  BASE_FOV,
  BASE_SPEED as BASE_SPD,
  MAX_SPEED as MAX_SPD,
  TREE_SPAN,
  LANE_WIDTH,
  OBSTACLE_PATTERNS,
  DRAGON_COLLIDER,
  DRAGON_MIN_Y,
  DRAGON_MAX_Y,
  DRAGON_MAX_X,
  BIOME_LENGTH,
  BIOMES,
  FIRE_COOLDOWN,
  FIRE_RANGE,
  BOOST_DURATION,
  BOOST_COOLDOWN,
  BOOST_FACTOR,
  ANKARA_SPEED,
} from "./game-config.js";
import * as audio from "./game-audio.js";
import {
  Particles,
  SpeedLines,
  Shake,
  FIRE_COLORS,
  SMOKE_COLORS,
  SPARKLE_COLORS,
  RING_COLORS,
  SHIELD_COLORS,
} from "./game-fx.js";
import { createDrone, animateDrone, DRONE_HALF, createRing, RING_RADIUS } from "./game-obstacles.js";
import { wallet, saveWallet, applySkin, renderShop, magnetDuration, shieldDuration } from "./game-shop.js";
import { Ankara } from "./game-ankara.js";
const c = document.querySelector("#game"),
  stage = c.parentElement,
  scoreEl = document.querySelector("#score"),
  speedEl = document.querySelector("#speed"),
  bestEl = document.querySelector("#best"),
  coinsEl = document.querySelector("#coins"),
  missionEl = document.querySelector("#mission"),
  missionTitleEl = document.querySelector(".mission-panel small"),
  powerEl = document.querySelector("#powerStatus"),
  comboEl = document.querySelector("#combo"),
  loadingEl = document.querySelector("#loading"),
  pauseBtn = document.querySelector("#pauseBtn"),
  resumeBtn = document.querySelector("#resumeBtn"),
  quitBtn = document.querySelector("#quitBtn"),
  freePanel = document.querySelector("#freePanel"),
  throttleEl = document.querySelector("#throttle"),
  pauseOverlay = document.querySelector("#pauseOverlay"),
  atmosphereBtn = document.querySelector("#atmosphereBtn"),
  qualityBtn = document.querySelector("#qualityBtn"),
  soundBtn = document.querySelector("#soundBtn"),
  fireBtn = document.querySelector("#fireBtn"),
  boostBtn = document.querySelector("#boostBtn"),
  shopEl = document.querySelector("#shop"),
  walletEl = document.querySelector("#walletCoins"),
  walletGainEl = document.querySelector("#walletGain"),
  overTagEl = document.querySelector("#overTag"),
  overTitleEl = document.querySelector("#overTitle"),
  osmCreditEl = document.querySelector("#osmCredit"),
  startBtn = document.querySelector("#startBtn"),
  assetErrorEl = document.querySelector("#assetError"),
  feedbackEl = document.querySelector("#feedback"),
  start = document.querySelector("#start"),
  over = document.querySelector("#over"),
  finalEl = document.querySelector("#final"),
  finalDistanceEl = document.querySelector("#finalDistance");
let s,
  cam,
  r,
  composer,
  bloomPass,
  dragon,
  dragonModel,
  mixer,
  dragonActions = {},
  ground,
  sun,
  hemi,
  skyTexture,
  road,
  particles,
  speedLines,
  ankara,
  ankaraArrow,
  buildings = [],
  drones = [],
  rings = [],
  coins = [],
  coinPool = [],
  powerups = [],
  cityProps = [],
  trees = [],
  clouds = [],
  world = "endless",
  freeThrottle = 1,
  speedMult = 1,
  baseSpeed = BASE_SPD,
  maxSpeed = MAX_SPD,
  run = false,
  score = 0,
  speed = 26,
  displaySpeed = 0,
  velX = 0,
  velY = 0,
  heading = 0,
  tX = 0,
  tY = 0,
  spawnTimer = 0,
  patternIndex = 0,
  spawnCount = 0,
  coinsCollected = 0,
  coinPoints = 0,
  gameTime = 0,
  runDistance = 0,
  passedBuildings = 0,
  magnetTimer = 0,
  shieldTimer = 0,
  fireCooldown = 0,
  fireTimer = 0,
  boostTimer = 0,
  boostCooldown = 0,
  invulnTimer = 0,
  crashTimer = 0,
  slowmoTimer = 0,
  timeScale = 1,
  lives = 0,
  biome = 0,
  paused = false,
  combo = 1,
  comboTimer = 0,
  nightMode = false,
  lowQuality = innerWidth < 700,
  assetsReady = false,
  feedbackTimeout = 0,
  dailyId = localDateId(new Date()),
  dailyBestKey = `ejderha-daily-best-${dailyId}`,
  best = +localStorage.getItem(dailyBestKey) || 0,
  key = {};
const shake = new Shake();
// Worlds: "endless" city, "ankara" gate route, "ankara-free" free roam.
const inAnkara = () => world !== "endless";
const freeRoam = () => world === "ankara-free";
// Free-roam speed steps (Z / X), as multiples of ANKARA_SPEED.
const THROTTLE_STEPS = [0.3, 0.6, 1, 1.5, 2.2];
const CAM_BASE = new THREE.Vector3(0, 4.8, 10);
function localDateId(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
bestEl.textContent = String(best).padStart(6, "0");
if (coinsEl) coinsEl.textContent = "000";
window.addEventListener("asseterror", (event) => {
  if (!assetErrorEl) return;
  assetErrorEl.textContent = `Asset y\xFCklenemedi: ${event.detail.path}`;
  assetErrorEl.classList.remove("gone");
});
function showStartupError(error) {
  loadingEl?.classList.remove("gone");
  const message = error?.message || String(error);
  const title = loadingEl?.querySelector("strong");
  if (title) title.textContent = "OYUN Y\xDCKLENEMEDİ";
  if (assetErrorEl) {
    assetErrorEl.textContent = message;
    assetErrorEl.classList.remove("gone");
  }
}
window.addEventListener("error", (event) => {
  if (!assetsReady) showStartupError(event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  if (!assetsReady) showStartupError(event.reason);
});
const missionKey = `ejderha-missions-${dailyId}`;
let missionState;
try {
  missionState = JSON.parse(localStorage.getItem(missionKey)) || {};
} catch {
  missionState = {};
}
missionState.coins ??= 0;
missionState.distance ??= 0;
missionState.buildings ??= 0;
missionState.rewards ??= { coins: false, distance: false, buildings: false };
function updateMissionUI() {
  if (!missionEl) return;
  if (freeRoam() && run && ankara?.ready) {
    const near = ankara.nearestLandmark(dragon.position);
    missionTitleEl.textContent = "SERBEST UÇUŞ";
    missionEl.textContent = `EN YAKIN: ${near.name}  ·  ${Math.round(near.distance)} m  ·  İRTİFA ${Math.round(
      dragon.position.y - ankara.groundAt(dragon.position.x, dragon.position.z),
    )} m`;
    return;
  }
  if (world === "ankara" && run && ankara?.ready) {
    const target = ankara.nextTarget();
    const dist = target ? Math.round(Math.hypot(target.x - dragon.position.x, target.z - dragon.position.z)) : 0;
    missionTitleEl.textContent = "ANKARA ROTASI";
    missionEl.textContent = target
      ? `KAPI ${ankara.collected}/${ankara.total}  \xB7  SONRAKİ: ${target.name}  \xB7  ${dist} m`
      : `ROTA TAMAM`;
    return;
  }
  missionTitleEl.textContent = "G\xDCNL\xDCK G\xD6REVLER";
  const coins2 = Math.min(10, missionState.coins + coinsCollected);
  const distance = Math.min(500, Math.floor(missionState.distance + runDistance));
  const buildings2 = Math.min(3, missionState.buildings + passedBuildings);
  missionEl.textContent = `COIN ${coins2}/10  \xB7  U\xC7UŞ ${distance}/500  \xB7  GE\xC7İŞ ${buildings2}/3`;
}
function updatePowerUI() {
  if (!powerEl) return;
  const powers = [];
  if (magnetTimer > 0) powers.push(`MANYET ${Math.ceil(magnetTimer)}s`);
  if (shieldTimer > 0) powers.push(`KALKAN ${Math.ceil(shieldTimer)}s`);
  if (lives > 0) powers.push(`CAN x${lives}`);
  powerEl.textContent = powers.length ? powers.join("  \xB7  ") : "G\xDC\xC7LENDİRİCİ YOK";
}
function updateComboUI() {
  if (comboEl) comboEl.textContent = `COMBO x${combo}`;
}
function updateAbilityUI() {
  const setFill = (btn, remaining, total, active) => {
    if (!btn) return;
    const ready = remaining <= 0;
    btn.classList.toggle("ready", ready);
    btn.classList.toggle("active", active);
    btn.style.setProperty("--fill", ready ? "100%" : `${Math.round((1 - remaining / total) * 100)}%`);
  };
  setFill(fireBtn, fireCooldown, FIRE_COOLDOWN, fireTimer > 0);
  setFill(boostBtn, boostCooldown, BOOST_COOLDOWN, boostTimer > 0);
}
function updateWalletUI() {
  if (walletEl) walletEl.textContent = String(wallet.coins).padStart(4, "0");
}
function showFeedback(text, variant = "") {
  if (!feedbackEl) return;
  feedbackEl.textContent = text;
  feedbackEl.className = `feedback ${variant}`;
  window.clearTimeout(feedbackTimeout);
  feedbackTimeout = window.setTimeout(() => feedbackEl.classList.add("gone"), 800);
}
function setPaused(value) {
  if (!run || crashTimer > 0) return;
  paused = value;
  pauseBtn?.classList.toggle("gone", paused);
  pauseOverlay?.classList.toggle("gone", !paused);
  if (paused) {
    audio.stopMusic();
    audio.silenceWind();
  } else {
    audio.startMusic();
    clock.start();
  }
}
function applyNightLighting(root, active) {
  root.traverse((part) => {
    if (!part.isMesh) return;
    const materials = Array.isArray(part.material) ? part.material : [part.material];
    materials.forEach((material) => {
      if (!material.emissive) return;
      material.emissive.set(active ? 5401247 : 0);
      material.emissiveIntensity = active ? 0.38 : 0;
    });
  });
}
function toggleAtmosphere() {
  nightMode = !nightMode;
  if (nightMode) {
    s.background = new THREE.Color(528933);
    s.fog.color.set(528933);
    sun.color.set(7902407);
    sun.intensity = 0.9;
    hemi.intensity = 0.8;
    buildings.forEach((building) => applyNightLighting(building, true));
    cityProps.forEach((prop) => applyNightLighting(prop, true));
    atmosphereBtn.textContent = "G\xDCND\xDCZ";
  } else {
    s.background = skyTexture || new THREE.Color(7973311);
    sun.intensity = 3;
    hemi.intensity = 1.8;
    // Colours ease back to the current biome (or Ankara) palette.
    applyBiomeColors(1, true);
    buildings.forEach((building) => applyNightLighting(building, false));
    cityProps.forEach((prop) => applyNightLighting(prop, false));
    atmosphereBtn.textContent = "GECE";
  }
  cloudMat.color.set(nightMode ? 0x2a3350 : 0xffffff);
  ankara?.setNight(nightMode);
}
function toggleQuality() {
  lowQuality = !lowQuality;
  r.setPixelRatio(lowQuality ? 1 : Math.min(devicePixelRatio, 2));
  r.shadowMap.enabled = !lowQuality;
  // Shader programs bake in the shadow setting, so force a recompile.
  s.traverse((o) => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
  });
  resize();
  qualityBtn.textContent = lowQuality ? "HD" : "D\xDCŞ\xDCK";
  showFeedback(lowQuality ? "MOBİL KALİTE" : "Y\xDCKSEK KALİTE", "coin");
}
function updateSoundButton() {
  if (soundBtn) soundBtn.textContent = audio.isMuted() ? "SESSİZ" : "SES";
}
function toggleSound() {
  audio.unlockAudio();
  audio.setMuted(!audio.isMuted());
  updateSoundButton();
}
function loadDragonModel(target) {
  new GLTFLoader().load(
    "assets/dragon.glb",
    (gltf) => {
      let model = gltf.scene;
      model.scale.setScalar(1.1);
      model.rotation.y = Math.PI;
      model.position.y = -1;
      model.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      target.add(model);
      dragonModel = model;
      applySkin(model);
      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        const find = (name) => gltf.animations.find((a) => a.name.includes(name));
        const flying = find("Flying") || gltf.animations[0];
        dragonActions.flying = mixer.clipAction(flying);
        dragonActions.flying.play();
        for (const [key, name] of [
          ["attack", "Dragon_Attack"],
          ["hit", "Dragon_Hit"],
          ["death", "Dragon_Death"],
        ]) {
          const clip = gltf.animations.find((a) => a.name.endsWith(name));
          if (!clip) continue;
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          dragonActions[key] = action;
        }
        mixer.addEventListener("finished", (e) => {
          if (e.action === dragonActions.death) return;
          e.action.fadeOut(0.2);
          dragonActions.flying.reset().fadeIn(0.2).play();
        });
        mixer.timeScale = 1.2;
      }
    },
    void 0,
    (error) => {
      window.dispatchEvent(
        new CustomEvent("asseterror", {
          detail: { path: "assets/dragon.glb", error },
        }),
      );
    },
  );
}
function playDragon(name) {
  const action = dragonActions[name];
  if (!action || !dragonActions.flying) return;
  dragonActions.flying.fadeOut(0.15);
  action.reset().fadeIn(0.15).play();
}
function resetDragonAnimation() {
  if (!mixer) return;
  mixer.stopAllAction();
  dragonActions.flying?.reset().play();
}
// Building templates are sorted by shape so patterns can ask for a height
// class: squat blocks can be flown over, skyscrapers cannot.
let buildingTpls = { low: [], mid: [], tall: [] },
  treeTpls = [],
  cloudTpl;
function loadBuildingTpls() {
  let l = new GLTFLoader();
  [
    "assets/kaykit-city/building_A.gltf",
    "assets/kaykit-city/building_B.gltf",
    "assets/kaykit-city/building_C.gltf",
    "assets/kaykit-city/building_D.gltf",
    "assets/kaykit-city/building_E.gltf",
    "assets/kaykit-city/building_F.gltf",
    "assets/kaykit-city/building_G.gltf",
    "assets/kaykit-city/building_H.gltf",
    "assets/kenney/city/building-skyscraper-a.glb",
    "assets/kenney/city/building-skyscraper-b.glb",
    "assets/kenney/city/building-skyscraper-c.glb",
    "assets/kenney/city/building-skyscraper-d.glb",
    "assets/kenney/city/building-skyscraper-e.glb",
    "assets/kenney/city/building-a.glb",
    "assets/kenney/city/building-c.glb",
    "assets/kenney/city/building-e.glb",
  ].forEach((path) =>
    l.load(
      path,
      (gltf) => {
        let m = gltf.scene,
          box = new THREE.Box3().setFromObject(m),
          size = box.getSize(new THREE.Vector3());
        m.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        const ratio = size.y / Math.max(size.x, size.z);
        const kind = ratio < 1 ? "low" : ratio < 2 ? "mid" : "tall";
        buildingTpls[kind].push({ scene: m, w: size.x, h: size.y, d: size.z });
      },
      void 0,
      (error) => {
        window.dispatchEvent(new CustomEvent("asseterror", { detail: { path, error } }));
      },
    ),
  );
}
const TREE_COUNT = 6;
const TREE_SIDE_MIN = 58;
const TREE_SIDE_RANGE = 24;
function loadTrees() {
  let l = new GLTFLoader(),
    names = ["tree_default.glb", "tree_cone.glb"],
    SCALES = [4, 3.6];
  names.forEach((n, k) =>
    l.load(
      "assets/kenney/" + n,
      (g) => {
        g.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            o.frustumCulled = true;
          }
        });
        const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
        treeTpls.push({ scene: g.scene, w: size.x, h: size.y, d: size.z });
        for (let i = 0; i < TREE_COUNT; i++) {
          let o = g.scene.clone(true),
            side = i % 2 ? -1 : 1;
          o.scale.setScalar(SCALES[k]);
          o.userData.baseX = side * (TREE_SIDE_MIN + Math.random() * TREE_SIDE_RANGE);
          o.userData.baseZ = -30 - i * 70 - k * 15;
          o.userData.baseRotY = Math.random() * Math.PI * 2;
          o.position.set(o.userData.baseX, 0, o.userData.baseZ);
          o.rotation.y = o.userData.baseRotY;
          s.add(o);
          trees.push(o);
        }
      },
      void 0,
      (error) => {
        window.dispatchEvent(
          new CustomEvent("asseterror", {
            detail: { path: "assets/kenney/" + n, error },
          }),
        );
      },
    ),
  );
}
// Shared so night mode can dim every cloud at once.
const cloudMat = new THREE.MeshBasicMaterial({ color: 16777215, fog: true });
function loadCloudTpl() {
  loadNormalized("assets/cloud.glb", 16, (m) => {
    m.traverse((o) => {
      if (o.isMesh) o.material = cloudMat;
    });
    cloudTpl = m;
  });
}
let coinTpl;
function loadCoinTpl() {
  loadNormalized("assets/coin/coin.glb", 1.7, (m) => {
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    coinTpl = m;
  });
}
const powerupTemplates = {};
function loadPowerupTemplates() {
  const assets = [
    ["magnet", "assets/powerups/magnet.glb", 3.8],
    ["shield", "assets/powerups/shield.glb", 4.2],
  ];
  assets.forEach(([kind, path, size]) => {
    loadNormalized(path, size, (model) => {
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      powerupTemplates[kind] = model;
    });
  });
}
const cityTemplates = {};
function loadCityProps() {
  const props = [
    ["streetlight", "assets/kaykit-city/streetlight.gltf", 5],
    ["trafficlight", "assets/kaykit-city/trafficlight_A.gltf", 4],
    ["car", "assets/kaykit-city/car_sedan.gltf", 6],
    ["taxi", "assets/kaykit-city/car_taxi.gltf", 6],
  ];
  props.forEach(([name, path, size]) => {
    loadNormalized(path, size, (model) => {
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      cityTemplates[name] = model;
      if (Object.keys(cityTemplates).length === props.length) seedCityProps();
    });
  });
}
function seedCityProps() {
  if (!road || cityProps.length) return;
  const place = (prop, x, y, localZ, speedFactor = 1) => {
    prop.position.set(x, y, road.position.z + localZ);
    prop.userData.baseZ = prop.position.z;
    prop.userData.speedFactor = speedFactor;
    applyNightLighting(prop, nightMode);
    prop.visible = world === "endless";
    s.add(prop);
    cityProps.push(prop);
  };
  for (let z = 1300, index = 0; z > -1300; z -= 90, index += 1) {
    const side = index % 2 ? -1 : 1;
    const light = cityTemplates.streetlight.clone(true);
    light.position.set(0, 0, 0);
    light.userData.kind = "streetlight";
    light.rotation.y = side < 0 ? Math.PI : 0;
    place(light, side * 13, 2.5, z, 0.95);
    if (index % 2 === 0) {
      const traffic = cityTemplates.trafficlight.clone(true);
      traffic.position.set(0, 0, 0);
      traffic.userData.kind = "traffic";
      place(traffic, -side * 10, 2, z - 12, 1);
    }
    const car = (index % 3 === 0 ? cityTemplates.taxi : cityTemplates.car).clone(true);
    car.position.set(0, 0, 0);
    car.userData.kind = "car";
    car.rotation.y = index % 2 ? Math.PI : 0;
    place(car, index % 2 ? -4 : 4, 0.9, z - 38, 1.05 + (index % 3) * 0.08);
  }
}
function resize() {
  let w = stage.clientWidth,
    h = stage.clientHeight;
  if (!w || !h) return;
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  r.setSize(w, h, false);
  if (composer) {
    composer.setPixelRatio(r.getPixelRatio());
    composer.setSize(w, h);
  }
}
function recycleTrees() {
  trees.forEach((o) => {
    if (o.position.z > dragon.position.z + 30) {
      o.position.z -= TREE_SPAN;
      o.position.x = (Math.random() > 0.5 ? 1 : -1) * (TREE_SIDE_MIN + Math.random() * TREE_SIDE_RANGE);
      o.rotation.y = Math.random() * Math.PI * 2;
    }
  });
}
function buildRoad() {
  road = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({
    color: 4541266,
    roughness: 0.86,
  });
  const shoulder = new THREE.MeshStandardMaterial({
    color: 12170662,
    roughness: 0.95,
  });
  const lanePaint = new THREE.MeshBasicMaterial({ color: 16773565 });
  const surface = new THREE.Mesh(new THREE.BoxGeometry(20, 0.12, 3e3), asphalt);
  surface.position.y = 0.12;
  surface.renderOrder = 3;
  road.add(surface);
  for (const x of [-12, 12]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 3e3), shoulder);
    curb.position.set(x, 0.3, 0);
    curb.renderOrder = 4;
    road.add(curb);
  }
  for (const x of [-9, 9]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 3e3), lanePaint);
    edge.position.set(x, 0.27, 0);
    edge.renderOrder = 4;
    road.add(edge);
  }
  for (let z = -12; z > -2980; z -= 28) {
    for (const x of [-5, 0, 5]) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.035, 16), lanePaint);
      marker.position.set(x, 0.27, z);
      marker.renderOrder = 4;
      road.add(marker);
    }
  }
  road.position.z = -1400;
  s.add(road);
}
function trackAssetLoading() {
  // Every GLTFLoader/TextureLoader here uses the default manager. A glTF can
  // queue its .bin/.png only after the .gltf itself finishes, so onLoad may
  // fire briefly before the real end; re-check after a short delay.
  const manager = THREE.DefaultLoadingManager;
  const progressEl = loadingEl?.querySelector("span");
  let loaded = 0,
    total = 0,
    settleTimer = 0;
  const finish = () => {
    if (assetsReady) return;
    assetsReady = true;
    loadingEl?.classList.add("gone");
  };
  manager.onProgress = (_url, itemsLoaded, itemsTotal) => {
    loaded = itemsLoaded;
    total = itemsTotal;
    if (progressEl && !assetsReady) progressEl.textContent = `Varlıklar yükleniyor... ${itemsLoaded}/${itemsTotal}`;
  };
  manager.onLoad = () => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      if (loaded >= total) finish();
    }, 200);
  };
  // Never leave the player stuck on the loading screen if a request hangs.
  window.setTimeout(finish, 20000);
}
function setupComposer() {
  composer = new EffectComposer(r);
  composer.addPass(new RenderPass(s, cam));
  // High threshold: only lights, fire and rings glow, not lit facades.
  bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 0.92);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}
function build() {
  trackAssetLoading();
  s = new THREE.Scene();
  s.background = new THREE.Color(7973311);
  s.fog = new THREE.Fog(7973311, 65, 260);
  cam = new THREE.PerspectiveCamera(62, 1, 0.1, 450);
  r = new THREE.WebGLRenderer({ canvas: c, antialias: true });
  const pixelRatio = lowQuality ? 1 : Math.min(devicePixelRatio, 2);
  r.setPixelRatio(pixelRatio);
  r.setSize(stage.clientWidth, stage.clientHeight, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.15;
  r.shadowMap.enabled = !lowQuality;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  hemi = new THREE.HemisphereLight(12574975, 2896980, 1.8);
  s.add(hemi);
  sun = new THREE.DirectionalLight(16764830, 3);
  sun.position.set(-25, 45, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.bias = -5e-4;
  s.add(sun);
  s.add(sun.target);
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 3e3),
    new THREE.MeshStandardMaterial({ color: 5201737, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, -1400);
  ground.receiveShadow = true;
  s.add(ground);
  buildRoad();
  new THREE.TextureLoader().load("assets/skyboxes-pack/Skyboxes/skybox-day.png", (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    skyTexture = t;
    if (!nightMode) s.background = t;
  });
  loadBuildingTpls();
  loadTrees();
  loadCloudTpl();
  loadCoinTpl();
  loadPowerupTemplates();
  loadCityProps();
  dragon = new THREE.Group();
  // Yaw first, then pitch and bank, so turning in Ankara feels like flying.
  dragon.rotation.order = "YXZ";
  dragon.position.set(0, 6, 4);
  s.add(dragon);
  cam.position.copy(CAM_BASE);
  cam.rotation.set(-0.12, 0, 0);
  dragon.add(cam);
  loadDragonModel(dragon);
  particles = new Particles(s);
  speedLines = new SpeedLines(dragon);
  ankaraArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.6, 12).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd36a, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  ankaraArrow.renderOrder = 30;
  ankaraArrow.visible = false;
  s.add(ankaraArrow);
  ankara = new Ankara(s);
  setupComposer();
  pauseBtn?.classList.add("gone");
  if (qualityBtn) qualityBtn.textContent = lowQuality ? "HD" : "D\xDCŞ\xDCK";
  updateSoundButton();
  updateWalletUI();
  resize();
  new ResizeObserver(resize).observe(stage);
}
const DRAG_HX = DRAGON_COLLIDER.x,
  DRAG_HY = DRAGON_COLLIDER.y,
  DRAG_HZ = DRAGON_COLLIDER.z,
  GROUND_Y = 0;
// Target heights per class, tuned against DRAGON_MAX_Y so "low" is always
// clearable and "tall" never is.
const HEIGHT_RANGE = { low: [6, 8.5], mid: [11, 16], tall: [30, 42] };
function pickKind(kind) {
  if (kind) return kind;
  const roll = Math.random();
  return roll < 0.4 ? "tall" : roll < 0.75 ? "mid" : "low";
}
function setCollider(o) {
  o.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(o);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  o.userData.hx = (size.x / 2) * 0.78;
  o.userData.hy = (size.y / 2) * 0.8;
  o.userData.hz = (size.z / 2) * 0.78;
  o.userData.cx = center.x;
  o.userData.cy = center.y;
  o.userData.cz = center.z;
}
function addBuildingAt(x, z, rotation, kind) {
  const forest = BIOMES[biome].obstacles === "forest" && treeTpls.length;
  const pool = forest ? treeTpls : buildingTpls[kind].length ? buildingTpls[kind] : buildingTpls.mid;
  if (!pool.length) return null;
  let tpl = pool[Math.floor(Math.random() * pool.length)],
    o = tpl.scene.clone(true);
  const [minH, maxH] = HEIGHT_RANGE[kind];
  const targetH = minH + Math.random() * (maxH - minH);
  if (forest) {
    // Trees scale uniformly by height; their footprint follows.
    o.scale.setScalar(targetH / tpl.h);
  } else {
    const footprint = 7 + Math.random() * 3;
    const scale = footprint / Math.max(tpl.w, tpl.d, 0.001);
    // Stretch or squash vertically into the height class.
    o.scale.set(scale, targetH / tpl.h, scale);
  }
  o.position.set(x, GROUND_Y, z);
  o.rotation.y = rotation;
  setCollider(o);
  o.userData.kind = kind;
  o.userData.nearMissAwarded = false;
  applyNightLighting(o, nightMode);
  buildings.push(o);
  s.add(o);
  return o;
}
function addCoin(x, y, z, phase = 0) {
  if (!coinTpl) return;
  const coin = coinPool.pop() || coinTpl.clone(true);
  coin.position.set(x, y, z);
  coin.userData.baseY = y;
  coin.userData.phase = phase;
  coin.userData.radius = 3.8;
  coins.push(coin);
  s.add(coin);
}
function recycleCoin(coin) {
  s.remove(coin);
  coinPool.push(coin);
}
function addPowerup(kind, x, y, z) {
  const template = powerupTemplates[kind];
  if (!template) return;
  const group = template.clone(true);
  group.position.set(x, y, z);
  group.rotation.y = kind === "magnet" ? Math.PI / 2 : 0;
  group.userData.kind = kind;
  group.userData.baseY = y;
  group.userData.phase = spawnCount;
  powerups.push(group);
  s.add(group);
}
function addRing(x, y, z) {
  const ring = createRing();
  ring.position.set(x, y, z);
  rings.push(ring);
  s.add(ring);
}
function addDrone(z) {
  const drone = createDrone();
  drone.userData.baseX = (Math.random() - 0.5) * 2 * LANE_WIDTH;
  drone.userData.amp = 14 + Math.random() * 16;
  drone.userData.freq = 0.7 + Math.random() * 0.7;
  drone.userData.phase = Math.random() * Math.PI * 2;
  drone.userData.hx = DRONE_HALF.x;
  drone.userData.hy = DRONE_HALF.y;
  drone.userData.hz = DRONE_HALF.z;
  drone.userData.nearMissAwarded = false;
  drone.position.set(drone.userData.baseX, 5 + Math.random() * 13, z);
  drone.userData.cy = drone.position.y;
  drone.userData.cz = z;
  drones.push(drone);
  s.add(drone);
}
function spawnObstaclePattern() {
  if (!buildingTpls.mid.length && !buildingTpls.tall.length) return;
  // Random pattern, but never the same one twice in a row.
  const nextIndex = Math.floor(Math.random() * (OBSTACLE_PATTERNS.length - 1));
  patternIndex = nextIndex >= patternIndex ? nextIndex + 1 : nextIndex;
  const pattern = OBSTACLE_PATTERNS[patternIndex];
  const baseZ = dragon.position.z - 150;
  const lowLanes = [];
  pattern.forEach(({ lane, offset = 0, kind }, index) => {
    const k = pickKind(kind);
    addBuildingAt(lane * LANE_WIDTH, baseZ + offset, ((patternIndex + index) % 2) * (Math.PI / 2), k);
    if (k === "low") lowLanes.push(lane);
  });
  const blocked = new Set(pattern.map(({ lane }) => lane));
  const safeLanes = [-2, -1, 0, 1, 2].filter((lane) => !blocked.has(lane));
  // Rings reward the vertical route: above a low block when there is one.
  if (lowLanes.length && Math.random() < 0.8) {
    const lane = lowLanes[Math.floor(Math.random() * lowLanes.length)];
    addRing(lane * LANE_WIDTH, 14 + Math.random() * 4, baseZ);
  } else if (Math.random() < 0.45) {
    const lane = safeLanes.length ? safeLanes[Math.floor(Math.random() * safeLanes.length)] : 0;
    addRing(lane * LANE_WIDTH, 5 + Math.random() * 12, baseZ - 20);
  }
  const coinLanes = safeLanes.length ? safeLanes : lowLanes;
  if (coinLanes.length) {
    const lane = coinLanes[Math.floor(Math.random() * coinLanes.length)];
    const coinY = safeLanes.length ? 6.5 : 12.5;
    for (let index = 0; index < 2; index += 1) {
      addCoin(lane * LANE_WIDTH, coinY, baseZ - 15 - index * 18, spawnCount + index);
    }
    if (spawnCount % 4 === 1) {
      addPowerup("magnet", lane * LANE_WIDTH, 7.2, baseZ - 62);
    } else if (spawnCount % 4 === 3) {
      addPowerup("shield", lane * LANE_WIDTH, 7.2, baseZ - 62);
    }
  }
  // Drones join once the player has warmed up, between building rows.
  if (runDistance > 300 && Math.random() < Math.min(0.6, 0.25 + runDistance / 6000)) addDrone(baseZ - 75);
  spawnCount += 1;
}
function addCloud() {
  let g = cloudTpl ? cloudTpl.clone(true) : new THREE.Group();
  g.position.set((Math.random() - 0.5) * 50, 16 + Math.random() * 10, dragon.position.z - 140 - Math.random() * 100);
  g.rotation.y = Math.random() * Math.PI * 2;
  clouds.push(g);
  s.add(g);
}
const tmpColor = new THREE.Color();
function applyBiomeColors(k, instant = false) {
  if (nightMode) return;
  const target =
    inAnkara()
      ? { fog: 0xc9d6df, ground: 5201737, sky: 0xbfdfff, skyGround: 0x5a5046, sun: 0xffe2bd }
      : BIOMES[biome];
  const t = instant ? 1 : k;
  s.fog.color.lerp(tmpColor.setHex(target.fog), t);
  ground.material.color.lerp(tmpColor.setHex(target.ground), t);
  hemi.color.lerp(tmpColor.setHex(target.sky), t);
  hemi.groundColor.lerp(tmpColor.setHex(target.skyGround), t);
  sun.color.lerp(tmpColor.setHex(target.sun), t);
}
function setWorld(next) {
  world = next;
  const endless = world === "endless";
  road.visible = ground.visible = endless;
  trees.forEach((o) => (o.visible = endless));
  cityProps.forEach((o) => (o.visible = endless));
  ankara.setVisible(!endless);
  ankaraArrow.visible = world === "ankara";
  freePanel?.classList.toggle("gone", !freeRoam());
  osmCreditEl?.classList.toggle("gone", endless);
  s.fog.near = endless ? 65 : 160;
  s.fog.far = endless ? 260 : 1000;
  // Far plane just past the fog: anything beyond it is invisible anyway.
  cam.near = endless ? 0.1 : 0.5;
  cam.far = endless ? 450 : 1100;
  // The city is too big for the dragon's shadow map to pay off there.
  sun.castShadow = endless;
  cam.updateProjectionMatrix();
  applyBiomeColors(1, true);
}
let ankaraLoading = null;
function ensureAnkara() {
  if (ankara.ready) return Promise.resolve(true);
  // Share one in-flight load between the world button and the start button.
  if (ankaraLoading) return ankaraLoading;
  startBtn.disabled = true;
  const label = startBtn.innerHTML;
  startBtn.innerHTML = "ANKARA Y\xDCKLENİYOR...";
  ankaraLoading = ankara
    .load("assets/ankara/ankara.json", coinTpl, { textureSize: lowQuality ? 1024 : 2048 })
    .then(() => {
      ankara.setNight(nightMode);
      return true;
    })
    .catch((error) => {
      showFeedback("ANKARA Y\xDCKLENEMEDİ", "danger");
      console.error(error);
      return false;
    })
    .finally(() => {
      ankaraLoading = null;
      startBtn.disabled = false;
      startBtn.innerHTML = label;
    });
  return ankaraLoading;
}
function explode(position, big = false) {
  particles.burst(position, big ? 90 : 55, { speed: big ? 22 : 16, life: 0.9, size: big ? 3 : 2.2, colors: FIRE_COLORS, spread: 3 });
  particles.burst(position, big ? 40 : 25, { speed: 7, life: 1.6, size: 4, colors: SMOKE_COLORS, gravity: -3, spread: 4 });
  shake.add(big ? 1.6 : 0.8);
  audio.play("explosion");
}
function fire() {
  if (!run || paused || crashTimer > 0 || fireCooldown > 0) return;
  fireCooldown = FIRE_COOLDOWN;
  fireTimer = 0.55;
  playDragon("attack");
  audio.play("fire");
  audio.buzz(20);
  if (world !== "endless") return;
  // Burn the nearest obstacle straight ahead in the dragon's corridor.
  const targets = buildings.concat(drones).filter((o) => {
    const ahead = dragon.position.z - o.userData.cz;
    return (
      ahead > 0 &&
      ahead < FIRE_RANGE &&
      Math.abs(o.userData.cx - dragon.position.x) < o.userData.hx + 3 &&
      Math.abs(o.userData.cy - dragon.position.y) < o.userData.hy + 3
    );
  });
  targets.sort((a, b) => b.userData.cz - a.userData.cz);
  const target = targets[0];
  if (!target) return;
  window.setTimeout(() => {
    if (!run || !target.parent) return;
    explode(new THREE.Vector3(target.userData.cx, target.userData.cy, target.userData.cz), true);
    removeObstacle(target);
    score += 30;
    showFeedback("YAKILDI +30", "danger");
  }, 180);
}
function boost() {
  if (!run || paused || crashTimer > 0 || boostCooldown > 0) return;
  boostTimer = BOOST_DURATION;
  boostCooldown = BOOST_COOLDOWN;
  audio.play("boost");
  audio.buzz(15);
  shake.add(0.4);
  showFeedback("HIZ!", "coin");
}
function removeObstacle(o) {
  s.remove(o);
  buildings = buildings.filter((b) => b !== o);
  drones = drones.filter((d) => d !== o);
}
// Called when the dragon touches something solid. Shield and spare lives
// absorb the hit; otherwise the crash sequence starts.
function hit(obstacle) {
  if (invulnTimer > 0) return;
  if (shieldTimer > 0 || lives > 0) {
    const usedLife = shieldTimer <= 0;
    if (usedLife) {
      lives -= 1;
      wallet.lives = Math.max(0, wallet.lives - 1);
      saveWallet();
      showFeedback("YEDEK CAN!", "danger");
    } else {
      shieldTimer = 0;
      showFeedback("KALKAN KIRILDI", "coin");
    }
    invulnTimer = 2;
    particles.burst(dragon.position, 50, { speed: 14, life: 0.7, size: 2.2, colors: SHIELD_COLORS });
    if (obstacle) {
      explode(new THREE.Vector3(obstacle.userData.cx, obstacle.userData.cy, obstacle.userData.cz));
      removeObstacle(obstacle);
    } else {
      // Ankara: bounce up and away from the wall.
      dragon.position.y += 10;
      shake.add(1);
    }
    playDragon("hit");
    audio.play("shield");
    audio.buzz(60);
    updatePowerUI();
    return;
  }
  crash();
}
function crash() {
  crashTimer = 1.5;
  timeScale = 0.35;
  // Blow up just ahead of the dragon so the camera isn't inside the fireball.
  dragon.getWorldDirection(forward).multiplyScalar(-4);
  explode(dragon.position.clone().add(forward));
  audio.play("crash");
  audio.buzz([60, 40, 140]);
  audio.stopMusic();
  audio.silenceWind();
  playDragon("death");
  pauseBtn?.classList.add("gone");
}
function slowmo(seconds) {
  slowmoTimer = Math.max(slowmoTimer, seconds);
}
function end(completed = false) {
  run = false;
  paused = false;
  crashTimer = 0;
  pauseBtn?.classList.add("gone");
  pauseOverlay?.classList.add("gone");
  audio.stopMusic();
  audio.silenceWind();
  missionState.coins = Math.min(10, missionState.coins + coinsCollected);
  missionState.distance = Math.min(500, missionState.distance + runDistance);
  missionState.buildings = Math.min(3, missionState.buildings + passedBuildings);
  const rewards = missionState.rewards;
  if (missionState.coins >= 10 && !rewards.coins) {
    score += 250;
    rewards.coins = true;
  }
  if (missionState.distance >= 500 && !rewards.distance) {
    score += 250;
    rewards.distance = true;
  }
  if (missionState.buildings >= 3 && !rewards.buildings) {
    score += 250;
    rewards.buildings = true;
  }
  localStorage.setItem(missionKey, JSON.stringify(missionState));
  let n = Math.floor(score);
  finalEl.textContent = n;
  if (finalDistanceEl) finalDistanceEl.textContent = Math.floor(runDistance);
  // Free roam has no goal, so it must not be able to set the daily record.
  if (!freeRoam()) {
    best = Math.max(best, n);
    localStorage.setItem(dailyBestKey, best);
  }
  bestEl.textContent = String(best).padStart(6, "0");
  // Coin points go into the persistent wallet for the shop.
  wallet.coins += coinPoints;
  saveWallet();
  updateWalletUI();
  if (walletGainEl) walletGainEl.textContent = coinPoints ? `+${coinPoints} ◈ c\xFCzdana eklendi` : "";
  const free = freeRoam();
  if (overTagEl) overTagEl.textContent = free ? "SERBEST UÇUŞ" : completed ? "ROTA TAMAMLANDI" : "UÇUŞ SONA ERDİ";
  overTagEl?.classList.toggle("red", !completed && !free);
  if (overTitleEl) overTitleEl.textContent = free ? "İyi gezintiler!" : completed ? "Ankara fethedildi!" : "Bir kez daha?";
  freePanel?.classList.add("gone");
  // This run is now folded into missionState; don't count it twice.
  coinsCollected = 0;
  runDistance = 0;
  passedBuildings = 0;
  updateMissionUI();
  over.classList.remove("gone", "hidden");
}
let starting = false;
async function begin() {
  if (starting || run) return;
  audio.unlockAudio();
  starting = true;
  const ok = !inAnkara() || (await ensureAnkara());
  starting = false;
  if (!ok) return;
  shopEl?.classList.add("gone");
  run = true;
  pauseBtn?.classList.remove("gone");
  pauseOverlay?.classList.add("gone");
  score = 0;
  baseSpeed = BASE_SPD * speedMult;
  maxSpeed = MAX_SPD * speedMult;
  speed = baseSpeed;
  velX = 0;
  velY = 0;
  spawnTimer = 0;
  patternIndex = Math.floor(Math.random() * OBSTACLE_PATTERNS.length);
  spawnCount = 0;
  coinsCollected = 0;
  coinPoints = 0;
  gameTime = 0;
  runDistance = 0;
  passedBuildings = 0;
  magnetTimer = 0;
  shieldTimer = 0;
  fireCooldown = 0;
  fireTimer = 0;
  boostTimer = 0;
  boostCooldown = 0;
  invulnTimer = 0;
  crashTimer = 0;
  slowmoTimer = 0;
  timeScale = 1;
  lives = wallet.lives;
  biome = 0;
  paused = false;
  combo = 1;
  comboTimer = 0;
  if (coinsEl) coinsEl.textContent = "000";
  setWorld(world);
  updateMissionUI();
  updatePowerUI();
  updateComboUI();
  cam.fov = BASE_FOV;
  cam.position.copy(CAM_BASE);
  cam.rotation.set(-0.12, 0, 0);
  cam.updateProjectionMatrix();
  dragon.rotation.set(0, 0, 0);
  if (dragonModel) {
    dragonModel.rotation.z = 0;
    dragonModel.visible = true;
  }
  dragon.position.set(0, 6, 4);
  heading = 0;
  resetDragonAnimation();
  shake.reset();
  particles.clear();
  buildings.forEach((o) => s.remove(o));
  buildings = [];
  drones.forEach((o) => s.remove(o));
  drones = [];
  rings.forEach((o) => s.remove(o));
  rings = [];
  coins.forEach(recycleCoin);
  coins = [];
  powerups.forEach((o) => s.remove(o));
  powerups = [];
  clouds.forEach((o) => s.remove(o));
  clouds = [];
  cityProps.forEach((o) => {
    o.position.z = o.userData.baseZ;
  });
  trees.forEach((o) => {
    o.position.set(o.userData.baseX, 0, o.userData.baseZ);
    o.rotation.y = o.userData.baseRotY;
  });
  if (inAnkara()) {
    ankara.coinTemplate ??= coinTpl;
    const spawn = ankara.reset({ free: freeRoam() });
    dragon.position.set(spawn.x, spawn.y, spawn.z);
    heading = spawn.heading;
    dragon.rotation.y = heading;
    freeThrottle = 1;
    updateThrottleUI();
    buildFreePanel();
    showFeedback(freeRoam() ? "SERBEST UÇUŞ" : "KIZILAY'DAN KALKIŞ", "coin");
  }
  start.classList.add("gone", "hidden");
  over.classList.add("gone", "hidden");
  audio.startMusic();
  clock.start();
}
// Simulate in small fixed steps so low frame rates neither slow the game down
// nor let the dragon tunnel through a building between two frames.
const MAX_STEP = 1 / 60;
const MAX_FRAME = 0.25;
// Must match the lane marker spacing in buildRoad().
const ROAD_MARK_SPACING = 28;
// A building only counts as "passed" if the dragon flew this close beside it.
const PASS_COUNT_GAP = 8;
let clock = new THREE.Clock();
const forward = new THREE.Vector3();
function readInput() {
  let kx = (key.ArrowRight || key.KeyD ? 1 : 0) - (key.ArrowLeft || key.KeyA ? 1 : 0),
    ky = (key.ArrowUp || key.KeyW ? 1 : 0) - (key.ArrowDown || key.KeyS ? 1 : 0);
  return [THREE.MathUtils.clamp(kx + tX, -1, 1), THREE.MathUtils.clamp(ky + tY, -1, 1)];
}
function tickTimers(dt) {
  gameTime += dt;
  magnetTimer = Math.max(0, magnetTimer - dt);
  shieldTimer = Math.max(0, shieldTimer - dt);
  comboTimer = Math.max(0, comboTimer - dt);
  fireCooldown = Math.max(0, fireCooldown - dt);
  fireTimer = Math.max(0, fireTimer - dt);
  boostTimer = Math.max(0, boostTimer - dt);
  boostCooldown = Math.max(0, boostCooldown - dt);
  invulnTimer = Math.max(0, invulnTimer - dt);
  if (comboTimer === 0 && combo !== 1) {
    combo = 1;
    updateComboUI();
  }
}
function emitFireBreath() {
  if (fireTimer <= 0) return;
  // Flame cone out of the mouth, travelling ahead of the dragon.
  dragon.getWorldDirection(forward).multiplyScalar(-1);
  const mouth = dragon.position.clone().addScaledVector(forward, 3.5);
  mouth.y += 0.8;
  for (let i = 0; i < 6; i++) {
    const spread = 0.18;
    const v = 55 + Math.random() * 25;
    particles.emit(
      mouth.x,
      mouth.y,
      mouth.z,
      (forward.x + (Math.random() - 0.5) * spread) * v,
      (forward.y + (Math.random() - 0.5) * spread) * v,
      (forward.z + (Math.random() - 0.5) * spread) * v,
      0.45,
      1.4 + Math.random() * 1.6,
      FIRE_COLORS[i % FIRE_COLORS.length],
    );
  }
}
function collectCoinFx(position, reward) {
  particles.burst(position, 14, { speed: 8, life: 0.5, size: 2.5, colors: SPARKLE_COLORS });
  audio.play("coin");
  audio.buzz(8);
  coinsCollected += 1;
  coinPoints += 25;
  score += reward;
  if (coinsEl) coinsEl.textContent = String(coinPoints).padStart(3, "0");
}
function stepFlight(dt, x, y) {
  const boostK = boostTimer > 0 ? BOOST_FACTOR : 1;
  velX = THREE.MathUtils.lerp(velX, x * 22, dt * 6);
  velY = THREE.MathUtils.lerp(velY, y * 9, dt * 6);
  dragon.position.x = THREE.MathUtils.clamp(dragon.position.x + velX * dt, -DRAGON_MAX_X, DRAGON_MAX_X);
  dragon.position.y = THREE.MathUtils.clamp(dragon.position.y + velY * dt, DRAGON_MIN_Y, DRAGON_MAX_Y);
  // The world stands still and only the dragon moves, so every piece of
  // scenery scrolls past at the same rate.
  dragon.position.z -= (2 * speed + 5) * boostK * dt;
  dragon.rotation.z = THREE.MathUtils.lerp(dragon.rotation.z, -x * 0.11, dt * 7);
  dragon.rotation.x = THREE.MathUtils.lerp(dragon.rotation.x, y * 0.07, dt * 7);
  cam.rotation.z = THREE.MathUtils.lerp(cam.rotation.z, -x * 0.045, dt * 5);
  cam.rotation.y = THREE.MathUtils.lerp(cam.rotation.y, x * 0.025, dt * 5);
  runDistance += speed * boostK * dt;
  score += dt * speed * 0.7 * (boostTimer > 0 ? 2 : 1);
  // Speed ramps with distance flown, not with bonus points.
  speed = Math.min(maxSpeed, baseSpeed + (runDistance / 570) * speedMult);
  displaySpeed = speed * 5 * boostK;
  const nextBiome = Math.floor(runDistance / BIOME_LENGTH) % BIOMES.length;
  if (nextBiome !== biome) {
    biome = nextBiome;
    showFeedback(`${BIOMES[biome].name} B\xD6LGESİ`, "coin");
    audio.play("checkpoint");
  }
  spawnTimer -= dt * boostK;
  if (spawnTimer <= 0) {
    spawnObstaclePattern();
    spawnTimer = Math.max(0.9, 1.45 - Math.min(0.4, runDistance / 8500));
  }
  if (Math.random() < dt * 0.4) addCloud();
  recycleTrees();
  if (ground) ground.position.z = dragon.position.z - 1400;
  if (road) road.position.z = Math.round((dragon.position.z - 1400) / ROAD_MARK_SPACING) * ROAD_MARK_SPACING;
  drones.forEach((d) => {
    d.position.x = d.userData.baseX + Math.sin(gameTime * d.userData.freq + d.userData.phase) * d.userData.amp;
    d.position.x = THREE.MathUtils.clamp(d.position.x, -DRAGON_MAX_X - 4, DRAGON_MAX_X + 4);
    d.userData.cx = d.position.x;
    d.rotation.z = Math.cos(gameTime * d.userData.freq + d.userData.phase) * -0.25;
    animateDrone(d, gameTime);
  });
  const obstacles = buildings.concat(drones);
  obstacles.forEach((o) => {
    const lateralGap = Math.abs(o.userData.cx - dragon.position.x) - o.userData.hx - DRAG_HX;
    const depthGap = Math.abs(o.userData.cz - dragon.position.z) - o.userData.hz - DRAG_HZ;
    const verticalGap = Math.abs(o.userData.cy - dragon.position.y) - o.userData.hy - DRAG_HY;
    const nearSide = lateralGap > 0 && lateralGap < 4 && verticalGap < 2;
    const nearTop = verticalGap > 0 && verticalGap < 3 && lateralGap < 0;
    if (!o.userData.nearMissAwarded && depthGap < 2 && (nearSide || nearTop)) {
      o.userData.nearMissAwarded = true;
      const nearMissReward = 40 * combo;
      combo = Math.min(5, combo + 1);
      comboTimer = 3;
      score += nearMissReward;
      showFeedback(nearTop ? "\xDcSTTEN GE\xC7İŞ" : "YAKIN GE\xC7İŞ", "danger");
      updateComboUI();
      shake.add(0.35);
      slowmo(0.28);
      audio.play("nearMiss");
      audio.buzz(15);
    }
    if (!o.userData.passed && o.userData.cz - o.userData.hz > dragon.position.z + DRAG_HZ) {
      o.userData.passed = true;
      if (buildings.includes(o) && lateralGap < PASS_COUNT_GAP && verticalGap < 0) passedBuildings += 1;
    }
  });
  buildings = buildings.filter((o) => {
    if (o.position.z > dragon.position.z + 25) {
      s.remove(o);
      return false;
    }
    return true;
  });
  drones = drones.filter((o) => {
    if (o.position.z > dragon.position.z + 25) {
      s.remove(o);
      return false;
    }
    return true;
  });
  if (buildings.length > 24) {
    const oldest = buildings.shift();
    s.remove(oldest);
  }
  cityProps.forEach((o) => {
    // Street furniture is fixed to the ground; only cars drive.
    if (o.userData.kind === "car") o.position.z += (speed + 5) * dt * (o.userData.speedFactor - 1);
    if (o.position.z > dragon.position.z + 35) {
      o.position.z -= 2600;
    }
  });
  rings = rings.filter((ring) => {
    ring.rotation.z += dt * 1.5;
    const dz = Math.abs(ring.position.z - dragon.position.z);
    const d2 = Math.hypot(ring.position.x - dragon.position.x, ring.position.y - dragon.position.y);
    if (dz < 2.5 && d2 < RING_RADIUS - 0.3) {
      const reward = 50 * combo;
      score += reward;
      combo = Math.min(5, combo + 1);
      comboTimer = 3;
      showFeedback(`HALKA +${reward}`, "coin");
      updateComboUI();
      particles.burst(ring.position, 40, { speed: 10, life: 0.6, size: 3, colors: RING_COLORS, spread: 5 });
      audio.play("ring");
      audio.buzz(10);
      s.remove(ring);
      return false;
    }
    if (ring.position.z > dragon.position.z + 30) {
      s.remove(ring);
      return false;
    }
    return true;
  });
  coins.forEach((coin) => {
    if (magnetTimer > 0 && Math.abs(coin.position.z - dragon.position.z) < 80) {
      coin.position.x = THREE.MathUtils.lerp(coin.position.x, dragon.position.x, dt * 5);
      // Pull the bob centre, otherwise the bob below overwrites the pull.
      coin.userData.baseY = THREE.MathUtils.lerp(coin.userData.baseY, dragon.position.y, dt * 5);
    }
    coin.rotation.y += dt * 4;
    coin.position.y = coin.userData.baseY + Math.sin(gameTime * 4 + coin.userData.phase) * 0.45;
  });
  coins = coins.filter((coin) => {
    const collected =
      Math.abs(coin.position.x - dragon.position.x) < coin.userData.radius &&
      Math.abs(coin.position.y - dragon.position.y) < 3.6 &&
      Math.abs(coin.position.z - dragon.position.z) < 4.5;
    if (collected) {
      const coinReward = 25 * combo;
      combo = Math.min(5, combo + 1);
      comboTimer = 3;
      showFeedback("+25 COIN", "coin");
      updateComboUI();
      collectCoinFx(coin.position, coinReward);
      recycleCoin(coin);
      return false;
    }
    if (coin.position.z > dragon.position.z + 35) {
      recycleCoin(coin);
      return false;
    }
    return true;
  });
  powerups.forEach((powerup) => {
    powerup.rotation.y += dt * 2.5;
    powerup.position.y = powerup.userData.baseY + Math.sin(gameTime * 3 + powerup.userData.phase) * 0.5;
  });
  powerups = powerups.filter((powerup) => {
    const collected =
      Math.abs(powerup.position.x - dragon.position.x) < 3.8 &&
      Math.abs(powerup.position.y - dragon.position.y) < 3.8 &&
      Math.abs(powerup.position.z - dragon.position.z) < 4.5;
    if (collected) {
      if (powerup.userData.kind === "magnet") {
        magnetTimer = magnetDuration();
        showFeedback("MANYET AKTİF", "coin");
      }
      if (powerup.userData.kind === "shield") {
        shieldTimer = shieldDuration();
        showFeedback("KALKAN AKTİF", "coin");
      }
      particles.burst(powerup.position, 30, { speed: 9, life: 0.6, size: 3, colors: SHIELD_COLORS });
      audio.play("powerup");
      s.remove(powerup);
      return false;
    }
    if (powerup.position.z > dragon.position.z + 35) {
      s.remove(powerup);
      return false;
    }
    return true;
  });
  // Clouds drift forward a little so they read as far away (parallax).
  clouds.forEach((o) => (o.position.z -= (speed * 0.4 + 2) * dt));
  clouds = clouds.filter((o) => {
    if (o.position.z > dragon.position.z + 40) {
      s.remove(o);
      return false;
    }
    return true;
  });
  const hitObstacle = buildings
    .concat(drones)
    .find(
      (o) =>
        Math.abs(o.userData.cz - dragon.position.z) < o.userData.hz + DRAG_HZ &&
        Math.abs(o.userData.cx - dragon.position.x) < o.userData.hx + DRAG_HX &&
        Math.abs(o.userData.cy - dragon.position.y) < o.userData.hy + DRAG_HY,
    );
  if (hitObstacle) hit(hitObstacle);
}
function stepAnkara(dt, x, y) {
  const boostK = boostTimer > 0 ? 1.7 : 1;
  speed = ANKARA_SPEED * speedMult * boostK * (freeRoam() ? freeThrottle : 1);
  displaySpeed = speed * 3.6;
  heading -= x * 1.25 * dt;
  velY = THREE.MathUtils.lerp(velY, y * 18, dt * 4);
  dragon.rotation.y = heading;
  dragon.rotation.z = THREE.MathUtils.lerp(dragon.rotation.z, -x * 0.32, dt * 4);
  dragon.rotation.x = THREE.MathUtils.lerp(dragon.rotation.x, y * 0.12, dt * 4);
  cam.rotation.z = THREE.MathUtils.lerp(cam.rotation.z, x * 0.12, dt * 4);
  cam.rotation.y = 0;
  dragon.position.x -= Math.sin(heading) * speed * dt;
  dragon.position.z -= Math.cos(heading) * speed * dt;
  // Fly over the real terrain: never below the ground, capped well above Atakule.
  const floor = ankara.groundAt(dragon.position.x, dragon.position.z) + 3;
  dragon.position.y = THREE.MathUtils.clamp(dragon.position.y + velY * dt, floor, 480);
  if (ankara.clampToBounds(dragon.position) && Math.random() < dt * 2) showFeedback("HARİTA SINIRI", "danger");
  runDistance += speed * dt;
  score += dt * speed * 0.15;
  const events = ankara.update(dt, dragon.position, gameTime, magnetTimer > 0);
  for (let i = 0; i < events.coins; i++) {
    collectCoinFx(dragon.position, 25 * combo);
    combo = Math.min(5, combo + 1);
    comboTimer = 3;
    updateComboUI();
  }
  if (events.gate) {
    score += 500;
    showFeedback(`${events.gate.name} +500`, "coin");
    particles.burst(events.gate.gate.position, 80, { speed: 20, life: 0.9, size: 5, colors: SPARKLE_COLORS, spread: 12 });
    audio.play("checkpoint");
    audio.buzz([20, 30, 20]);
    shake.add(0.5);
    // Every other gate hands out a power-up to keep the route lively.
    if (ankara.collected % 2 === 1) {
      magnetTimer = magnetDuration();
      showFeedback(`${events.gate.name} \xB7 MANYET`, "coin");
    }
  }
  if (events.finished) {
    // Faster routes score more.
    score += Math.max(0, Math.round(4000 - gameTime * 12));
    end(true);
    return;
  }
  const target = ankara.nextTarget();
  if (target) {
    // Float the arrow just ahead of the dragon, below the camera's eye line.
    ankaraArrow.position.set(
      dragon.position.x - Math.sin(heading) * 7,
      dragon.position.y + 2.5,
      dragon.position.z - Math.cos(heading) * 7,
    );
    ankaraArrow.lookAt(target.gate.position);
  }
  if (ankara.collides(dragon.position)) {
    if (freeRoam()) bounce();
    else hit(null);
  }
}
// Free roam: walls push the dragon back instead of ending the flight.
function bounce() {
  if (invulnTimer > 0) return;
  dragon.position.x += Math.sin(heading) * 14;
  dragon.position.z += Math.cos(heading) * 14;
  dragon.position.y += 10;
  heading += Math.PI * 0.35;
  invulnTimer = 0.8;
  shake.add(0.8);
  particles.burst(dragon.position, 30, { speed: 10, life: 0.6, size: 2.2, colors: SHIELD_COLORS });
  playDragon("hit");
  audio.play("shield");
  audio.buzz(40);
  showFeedback("DİKKAT!", "danger");
}
function updateThrottleUI() {
  if (throttleEl) throttleEl.textContent = `x${freeThrottle.toFixed(1)}`;
}
function changeThrottle(dir) {
  if (!run || !freeRoam()) return;
  const i = THROTTLE_STEPS.indexOf(freeThrottle);
  freeThrottle = THROTTLE_STEPS[THREE.MathUtils.clamp(i + dir, 0, THROTTLE_STEPS.length - 1)];
  updateThrottleUI();
  showFeedback(`HIZ x${freeThrottle.toFixed(1)}`, "coin");
}
function teleport(name) {
  if (!run || !freeRoam() || crashTimer > 0) return;
  const pose = ankara.viewpoint(name);
  dragon.position.set(pose.x, pose.y, pose.z);
  heading = pose.heading;
  dragon.rotation.set(0, heading, 0);
  velY = 0;
  invulnTimer = 1;
  particles.burst(dragon.position, 40, { speed: 12, life: 0.7, size: 2.5, colors: RING_COLORS, spread: 4 });
  audio.play("checkpoint");
  showFeedback(name, "coin");
}
// One button per landmark, numbered to match the 1-7 keys.
function buildFreePanel() {
  const spots = freePanel?.querySelector(".free-spots");
  if (!spots || spots.childElementCount || !ankara.landmarks) return;
  ankara.landmarks.forEach((lm, i) => {
    const btn = document.createElement("button");
    btn.innerHTML = `<b>${i + 1}</b>${lm.name}`;
    btn.addEventListener("click", () => teleport(lm.name));
    spots.appendChild(btn);
  });
}
function step(dt) {
  tickTimers(dt);
  const [x, y] = readInput();
  if (inAnkara()) stepAnkara(dt, x, y);
  else stepFlight(dt, x, y);
  if (!run || crashTimer > 0) return;
  if (mixer) {
    mixer.timeScale = 1.15 + Math.min(0.45, speed / MAX_SPD) + (boostTimer > 0 ? 0.5 : 0);
    mixer.update(dt);
  }
  const speedK = world === "endless" ? (speed - baseSpeed) / Math.max(1, maxSpeed - baseSpeed) : 0.3;
  cam.fov = THREE.MathUtils.lerp(cam.fov, BASE_FOV + Math.min(14, speedK * 14) + (boostTimer > 0 ? 10 : 0), dt * 3);
  if (sun) {
    sun.position.set(dragon.position.x - 25, dragon.position.y + 45, dragon.position.z + 15);
    sun.target.position.copy(dragon.position);
  }
  emitFireBreath();
  // Blink while invulnerable after a shield/life save.
  if (dragonModel) dragonModel.visible = invulnTimer <= 0 || Math.sin(gameTime * 30) > 0;
}
function crashStep(dt) {
  crashTimer -= dt;
  // The camera rides on the dragon group, so only the model tumbles.
  dragon.position.y = Math.max(0.5, dragon.position.y - dt * 12);
  if (dragonModel) dragonModel.rotation.z += dt * 2.5;
  if (Math.random() < dt * 20)
    particles.burst(dragon.position, 3, { speed: 3, life: 1.2, size: 3, colors: SMOKE_COLORS, gravity: -4 });
  mixer?.update(dt);
  if (crashTimer <= 0) end(false);
}
function loop() {
  requestAnimationFrame(loop);
  const realDt = Math.min(clock.getDelta(), MAX_FRAME);
  if (run && !paused) {
    // Near misses and crashes briefly slow time for impact.
    slowmoTimer = Math.max(0, slowmoTimer - realDt);
    const targetScale = crashTimer > 0 ? 0.35 : slowmoTimer > 0 ? 0.4 : 1;
    timeScale = THREE.MathUtils.lerp(timeScale, targetScale, Math.min(1, realDt * 12));
    let remaining = realDt * timeScale;
    if (crashTimer > 0) crashStep(realDt);
    else
      while (remaining > 0 && run && crashTimer <= 0) {
        const dt = Math.min(MAX_STEP, remaining);
        remaining -= dt;
        step(dt);
      }
    particles.update(realDt * timeScale);
    const intensity =
      world === "endless"
        ? Math.max(0, (speed - baseSpeed) / Math.max(1, maxSpeed - baseSpeed)) * 0.5 + (boostTimer > 0 ? 0.8 : 0)
        : 0.2 + (boostTimer > 0 ? 0.8 : 0);
    speedLines.update(realDt, world === "endless" ? 2 * speed + 5 : speed, crashTimer > 0 ? 0 : intensity);
    if (crashTimer <= 0) audio.setWind(Math.min(1, intensity));
    cam.position.copy(CAM_BASE).add(shake.update(realDt));
    cam.updateProjectionMatrix();
    applyBiomeColors(Math.min(1, realDt * 0.8));
    updatePowerUI();
    updateMissionUI();
    updateAbilityUI();
    scoreEl.textContent = String(Math.floor(score)).padStart(6, "0");
    speedEl.textContent = String(Math.floor(displaySpeed)).padStart(3, "0");
  } else if (!run) {
    particles.update(realDt);
    cam.position.copy(CAM_BASE).add(shake.update(realDt));
  }
  // Bloom only pays off at night, and costs too much on low quality.
  if (nightMode && !lowQuality) composer.render();
  else r.render(s, cam);
}
startBtn.onclick = begin;
document.querySelector("#again").onclick = begin;
pauseBtn?.addEventListener("click", () => setPaused(!paused));
resumeBtn?.addEventListener("click", () => setPaused(false));
quitBtn?.addEventListener("click", () => {
  if (run) end(false);
});
freePanel?.querySelectorAll("[data-throttle]").forEach((b) =>
  b.addEventListener("click", () => changeThrottle(+b.dataset.throttle)),
);
atmosphereBtn?.addEventListener("click", toggleAtmosphere);
qualityBtn?.addEventListener("click", toggleQuality);
soundBtn?.addEventListener("click", toggleSound);
fireBtn?.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  fire();
});
boostBtn?.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  boost();
});
document.querySelectorAll(".shop-btn").forEach((b) =>
  b.addEventListener("click", () => {
    audio.unlockAudio();
    shopEl.classList.remove("gone");
    renderShop(shopEl, {
      sound: audio.play,
      onChange: () => {
        applySkin(dragonModel);
        updateWalletUI();
        lives = run ? lives : wallet.lives;
      },
    });
  }),
);
document.querySelectorAll(".mode-btn").forEach(
  (b) =>
    (b.onclick = () => {
      document.querySelectorAll(".mode-btn").forEach((o) => o.classList.remove("active"));
      b.classList.add("active");
      speedMult = +b.dataset.mult;
    }),
);
document.querySelectorAll(".world-btn").forEach(
  (b) =>
    (b.onclick = () => {
      document.querySelectorAll(".world-btn").forEach((o) => o.classList.remove("active"));
      b.classList.add("active");
      world = b.dataset.world;
      // Start fetching the map as soon as it is chosen.
      if (inAnkara()) ensureAnkara();
    }),
);
addEventListener("keydown", (e) => {
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  key[e.code] = true;
  if (e.repeat) return;
  if (e.key.toLowerCase() === "p" || e.key === "Escape") setPaused(!paused);
  if (e.code === "Space") {
    if (!run && shopEl.classList.contains("gone")) begin();
    else fire();
  }
  if (e.code === "KeyF") fire();
  if (e.code === "KeyZ") changeThrottle(-1);
  if (e.code === "KeyX") changeThrottle(1);
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && freeRoam() && ankara.landmarks?.[digit[1] - 1]) teleport(ankara.landmarks[digit[1] - 1].name);
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") boost();
});
addEventListener("keyup", (e) => (key[e.code] = false));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && run && !paused) setPaused(true);
});
let touchId = null,
  touchX = 0,
  touchY = 0;
function touchDelta(x, y) {
  let dx = x - touchX,
    dy = y - touchY;
  tX = THREE.MathUtils.clamp(dx / 60, -1, 1);
  tY = THREE.MathUtils.clamp(-dy / 60, -1, 1);
}
function touchEnd(e) {
  for (let t of e.changedTouches)
    if (t.identifier === touchId) {
      touchId = null;
      tX = 0;
      tY = 0;
    }
}
c.addEventListener(
  "touchstart",
  (e) => {
    let t = e.changedTouches[0];
    touchId = t.identifier;
    touchX = t.clientX;
    touchY = t.clientY;
    e.preventDefault();
  },
  { passive: false },
);
c.addEventListener(
  "touchmove",
  (e) => {
    for (let t of e.changedTouches)
      if (t.identifier === touchId) {
        touchDelta(t.clientX, t.clientY);
        e.preventDefault();
      }
  },
  { passive: false },
);
c.addEventListener("touchend", touchEnd);
c.addEventListener("touchcancel", touchEnd);
try {
  build();
  loop();
} catch (error) {
  showStartupError(error);
}
