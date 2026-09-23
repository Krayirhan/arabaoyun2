import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";
import { groundAt } from "./game-ankara-worker.js";

// Free-flight Ankara level built from OpenStreetMap buildings and AWS terrain
// tiles (assets/ankara, produced by tools/build-ankara.mjs). Units are metres
// and Kızılay square is the origin. The heavy geometry work runs in
// game-ankara-worker.js.
const CHUNK = 500;
const GRID = 64;
const ROUTE = ["KIZILAY", "GÜVENPARK", "TBMM", "KUĞULU PARK", "ATAKULE", "KOCATEPE CAMİİ", "ANITKABİR"];
const GATE_RADIUS = 16;
const AREA_COLOURS = ["#86a862", "#557f43", "#5f8fb9", "#8ea676"];
const GROUND_COLOUR = "#b8ad97";

function windowTextures() {
  const make = (lit) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = lit ? "#000" : "#fff";
    g.fillRect(0, 0, 64, 64);
    // Windows stay clear of the 8 px border, which is the plain texel that
    // roofs and roads sample (PLAIN_UV in the worker).
    for (const x of [10, 36]) {
      const on = !lit || Math.random() > 0.35;
      g.fillStyle = lit ? (on ? "#ffd27a" : "#000") : "#6f7e90";
      g.fillRect(x, 14, 18, 30);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  return { day: make(false), night: make(true) };
}

function label(text) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.font = "800 64px 'Barlow Condensed', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(5,9,19,0.85)";
  g.strokeText(text, 256, 64);
  g.fillStyle = "#5de1e6";
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(80, 20, 1);
  sprite.renderOrder = 20;
  return sprite;
}

// Even-odd point test across all rings, so courtyards count as open air.
function inside(rings, x, z) {
  let hit = false;
  for (const poly of rings)
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i],
        zi = poly[i + 1],
        xj = poly[j],
        zj = poly[j + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
  return hit;
}

function runWorker(url) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./game-ankara-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(e.error || new Error(e.message));
    };
    worker.postMessage({ url: new URL(url, location.href).href });
  });
}

export class Ankara {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.colliders = [];
    this.grid = new Map();
    this.ready = false;
    this.coinTemplate = null;
  }

  async load(url, coinTemplate, { textureSize = 2048 } = {}) {
    const data = await runWorker(url);
    this.coinTemplate = coinTemplate;
    this.hm = data.heightmap;
    this.landmarks = data.landmarks;
    const tex = windowTextures();
    // One material for walls, roofs and roads: one draw call per chunk.
    this.cityMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: tex.day,
      emissiveMap: tex.night,
      emissive: 0x000000,
      roughness: 0.85,
    });
    for (const c of data.chunks) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(c.position, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(c.normal, 3, true));
      geo.setAttribute("uv", new THREE.BufferAttribute(c.uv, 2));
      geo.setAttribute("color", new THREE.BufferAttribute(c.color, 3, true));
      geo.setIndex(new THREE.BufferAttribute(c.index, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.cityMat);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.colliders = data.colliders;
    this.colliders.forEach((b, id) => {
      for (let gx = Math.floor(b.bx0 / GRID); gx <= Math.floor(b.bx1 / GRID); gx++)
        for (let gz = Math.floor(b.bz0 / GRID); gz <= Math.floor(b.bz1 / GRID); gz++) {
          const key = `${gx},${gz}`;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(id);
        }
    });
    const hm = this.hm;
    // Flight area: the mapped city plus a margin, inside the terrain.
    this.bounds = {
      minX: hm.x0 + 250,
      maxX: hm.x0 + (hm.w - 1) * hm.cell - 250,
      minZ: hm.z0 + 250,
      maxZ: hm.z0 + (hm.h - 1) * hm.cell - 250,
    };
    this.buildTerrain(data.areas, textureSize);
    this.buildLandmarks();
    this.buildRoute();
    this.ready = true;
  }

  groundAt(x, z) {
    return groundAt(this.hm, x, z);
  }

  buildTerrain(areas, textureSize) {
    const hm = this.hm;
    const width = (hm.w - 1) * hm.cell,
      depth = (hm.h - 1) * hm.cell;
    // Parks, forests and water are painted into the ground texture: cheaper
    // than draped polygons and it follows the terrain exactly.
    const scale = textureSize / Math.max(width, depth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(depth * scale);
    const g = canvas.getContext("2d");
    g.fillStyle = GROUND_COLOUR;
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (const [cls, rings] of areas) {
      g.beginPath();
      for (const r of rings) {
        g.moveTo((r[0] - hm.x0) * scale, (r[1] - hm.z0) * scale);
        for (let i = 2; i < r.length; i += 2) g.lineTo((r[i] - hm.x0) * scale, (r[i + 1] - hm.z0) * scale);
        g.closePath();
      }
      g.fillStyle = AREA_COLOURS[cls];
      g.fill("evenodd");
    }
    const groundTex = new THREE.CanvasTexture(canvas);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = 8;
    const positions = new Float32Array(hm.w * hm.h * 3);
    const uvs = new Float32Array(hm.w * hm.h * 2);
    for (let j = 0; j < hm.h; j++)
      for (let i = 0; i < hm.w; i++) {
        const k = j * hm.w + i;
        positions[k * 3] = hm.x0 + i * hm.cell;
        positions[k * 3 + 1] = hm.heights[k] / 10;
        positions[k * 3 + 2] = hm.z0 + j * hm.cell;
        uvs[k * 2] = i / (hm.w - 1);
        uvs[k * 2 + 1] = 1 - j / (hm.h - 1);
      }
    const full = new THREE.BufferGeometry();
    full.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    full.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    // Pushed back in depth so draped roads never z-fight with it.
    const terrainMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    // One index per 500 m block over the shared vertex buffer, so frustum
    // culling skips terrain behind the camera.
    const block = Math.round(CHUNK / hm.cell);
    const blocks = [];
    for (let bj = 0; bj < hm.h - 1; bj += block)
      for (let bi = 0; bi < hm.w - 1; bi += block) {
        const index = [];
        for (let j = bj; j < Math.min(bj + block, hm.h - 1); j++)
          for (let i = bi; i < Math.min(bi + block, hm.w - 1); i++) {
            const a = j * hm.w + i,
              b = a + 1,
              c = a + hm.w,
              d = c + 1;
            index.push(a, c, b, b, c, d);
          }
        blocks.push(index);
      }
    full.setIndex(blocks.flat());
    full.computeVertexNormals();
    for (const index of blocks) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", full.getAttribute("position"));
      geo.setAttribute("normal", full.getAttribute("normal"));
      geo.setAttribute("uv", full.getAttribute("uv"));
      geo.setIndex(index);
      // computeBoundingSphere() would span the whole shared buffer; bound
      // only this block's vertices so culling actually works.
      const box = new THREE.Box3();
      const p = new THREE.Vector3();
      for (const k of index) box.expandByPoint(p.fromArray(positions, k * 3));
      geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      const terrain = new THREE.Mesh(geo, terrainMat);
      terrain.matrixAutoUpdate = false;
      this.group.add(terrain);
    }
    // A wide skirt under the heightmap so the world never ends in a void. It
    // must sit below the lowest edge point: an average would put it above
    // low-lying Kızılay and hide the whole city under it.
    let edge = Infinity;
    for (let i = 0; i < hm.w; i++) edge = Math.min(edge, hm.heights[i], hm.heights[(hm.h - 1) * hm.w + i]);
    for (let j = 0; j < hm.h; j++) edge = Math.min(edge, hm.heights[j * hm.w], hm.heights[j * hm.w + hm.w - 1]);
    edge /= 10;
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshStandardMaterial({ color: GROUND_COLOUR, roughness: 1 }),
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.set(hm.x0 + width / 2, edge - 4, hm.z0 + depth / 2);
    this.group.add(skirt);
  }

  // Tallest roof within r metres, using the collision grid.
  topNear(x, z, r) {
    let max = this.groundAt(x, z);
    const seen = new Set();
    for (let gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++)
      for (let gz = Math.floor((z - r) / GRID); gz <= Math.floor((z + r) / GRID); gz++)
        for (const id of this.grid.get(`${gx},${gz}`) || []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const b = this.colliders[id];
          if (b.bx1 > x - r && b.bx0 < x + r && b.bz1 > z - r && b.bz0 < z + r) max = Math.max(max, b.top);
        }
    return max;
  }

  buildLandmarks() {
    for (const lm of this.landmarks) {
      const sprite = label(lm.name);
      sprite.position.set(lm.x, Math.max(this.groundAt(lm.x, lm.z) + 55, this.topNear(lm.x, lm.z, 80) + 30), lm.z);
      this.group.add(sprite);
    }
  }

  buildRoute() {
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0xffd36a,
      emissive: 0xffb020,
      emissiveIntensity: 1.2,
      roughness: 0.4,
    });
    const gateGeo = new THREE.TorusGeometry(GATE_RADIUS, 1.2, 12, 48);
    const points = ROUTE.map((name) => this.landmarks.find((l) => l.name === name)).filter(Boolean);
    this.route = points.map((lm, i) => {
      // Gates hang in front of each landmark, on the approach side, not on
      // top of it: a ring above Atakule's 125 m tower was a trap, since
      // players climbing towards it hit the dome first.
      const from = points[i - 1] || points[i + 1];
      const len = Math.hypot(lm.x - from.x, lm.z - from.z) || 1;
      const offset = i === 0 ? 0 : 70;
      const x = lm.x - ((lm.x - from.x) / len) * offset,
        z = lm.z - ((lm.z - from.z) / len) * offset;
      const y = Math.max(this.groundAt(x, z) + 45, this.topNear(x, z, 40) + 24);
      const gate = new THREE.Mesh(gateGeo, gateMat);
      gate.position.set(x, y, z);
      // Face the direction the player arrives from.
      gate.rotation.y = Math.atan2(lm.x - from.x, lm.z - from.z);
      this.group.add(gate);
      return { name: lm.name, gate, x, y, z };
    });
  }

  // Coins between gates share one InstancedMesh per coin sub-mesh.
  placeCoins() {
    this.coinMeshes?.forEach((m) => {
      this.group.remove(m);
      m.dispose();
    });
    this.coinMeshes = [];
    this.coins = [];
    if (!this.coinTemplate) return;
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1],
        b = this.route[i];
      const count = Math.floor(Math.hypot(b.x - a.x, b.z - a.z) / 55);
      for (let k = 1; k < count; k++) {
        const t = k / count;
        const x = a.x + (b.x - a.x) * t,
          z = a.z + (b.z - a.z) * t;
        const y = Math.max(a.y + (b.y - a.y) * t, this.topNear(x, z, 8) + 10);
        this.coins.push({ pos: new THREE.Vector3(x, y, z), baseY: y, alive: true });
      }
    }
    this.coinTemplate.updateMatrixWorld(true);
    this.coinTemplate.traverse((o) => {
      if (!o.isMesh) return;
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, this.coins.length);
      mesh.userData.local = o.matrixWorld.clone();
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.coinMeshes.push(mesh);
    });
    this.updateCoinMatrices(0);
  }

  updateCoinMatrices(time) {
    const m = new THREE.Matrix4(),
      rot = new THREE.Matrix4().makeRotationY(time * 4),
      scale = new THREE.Matrix4().makeScale(2.2, 2.2, 2.2),
      hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of this.coinMeshes) {
      this.coins.forEach((c, i) => {
        if (!c.alive) return mesh.setMatrixAt(i, hidden);
        m.makeTranslation(c.pos.x, c.pos.y, c.pos.z).multiply(rot).multiply(scale).multiply(mesh.userData.local);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Starts a run: returns the spawn pose facing the first gate. Free roam
  // has no gates or coins and starts over Kızılay looking up Atatürk Bulvarı.
  reset({ free = false } = {}) {
    if (free) {
      this.nextIndex = this.route.length;
      this.route.forEach((r) => (r.gate.visible = false));
      this.coins = [];
      this.coinMeshes?.forEach((m) => this.group.remove(m));
      this.coinMeshes = [];
      return this.viewpoint("KIZILAY");
    }
    this.nextIndex = 1;
    this.route.forEach((r, i) => (r.gate.visible = i > 0));
    this.placeCoins();
    const start = this.route[0],
      first = this.route[1];
    return {
      x: start.x,
      y: start.y,
      z: start.z,
      heading: Math.atan2(-(first.x - start.x), -(first.z - start.z)),
    };
  }

  // A pose 250 m south of a landmark, facing it, high enough to clear the
  // blocks in between and see the whole building.
  viewpoint(name) {
    const lm = this.landmarks.find((l) => l.name === name) || this.landmarks[0];
    const x = lm.x,
      z = lm.z + 250;
    const tall = this.topNear(lm.x, lm.z, 40) - this.groundAt(lm.x, lm.z);
    const y = Math.max(this.groundAt(x, z) + 60, this.topNear(x, z, 120) + 20, this.groundAt(lm.x, lm.z) + tall * 0.7);
    return { x, y, z, heading: 0 };
  }

  // Closest landmark to a point, for the free-roam HUD.
  nearestLandmark(pos) {
    let best = null,
      bestD = Infinity;
    for (const lm of this.landmarks) {
      const d = Math.hypot(lm.x - pos.x, lm.z - pos.z);
      if (d < bestD) (best = lm), (bestD = d);
    }
    return { name: best.name, distance: bestD };
  }

  get total() {
    return this.route.length - 1;
  }

  get collected() {
    return this.nextIndex - 1;
  }

  nextTarget() {
    return this.route[this.nextIndex] || null;
  }

  setVisible(value) {
    this.group.visible = value;
  }

  setNight(active) {
    if (!this.cityMat) return;
    this.cityMat.emissive.set(active ? 0xffffff : 0x000000);
    this.cityMat.emissiveIntensity = active ? 0.9 : 0;
  }

  collides(pos, radius = 1.4) {
    const cells = new Set();
    for (const dx of [-radius, radius])
      for (const dz of [-radius, radius])
        cells.add(`${Math.floor((pos.x + dx) / GRID)},${Math.floor((pos.z + dz) / GRID)}`);
    for (const key of cells) {
      for (const id of this.grid.get(key) || []) {
        const b = this.colliders[id];
        if (pos.y - 1 > b.top || pos.y + 1 < b.y0) continue;
        if (pos.x + radius < b.bx0 || pos.x - radius > b.bx1 || pos.z + radius < b.bz0 || pos.z - radius > b.bz1)
          continue;
        if (
          inside(b.rings, pos.x, pos.z) ||
          inside(b.rings, pos.x + radius, pos.z) ||
          inside(b.rings, pos.x - radius, pos.z) ||
          inside(b.rings, pos.x, pos.z + radius) ||
          inside(b.rings, pos.x, pos.z - radius)
        )
          return true;
      }
    }
    return false;
  }

  clampToBounds(pos) {
    const b = this.bounds;
    const out = pos.x < b.minX || pos.x > b.maxX || pos.z < b.minZ || pos.z > b.maxZ;
    pos.x = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
    pos.z = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
    return out;
  }

  // Returns what happened this step: gate passed, coins picked up, finished.
  update(dt, pos, time, magnet) {
    const events = { gate: null, coins: 0, finished: false };
    this.route.forEach((r) => r.gate.visible && (r.gate.rotation.z = time * 0.6));
    const target = this.route[this.nextIndex];
    if (target && pos.distanceTo(target.gate.position) < GATE_RADIUS + 2) {
      target.gate.visible = false;
      events.gate = target;
      this.nextIndex += 1;
      if (this.nextIndex >= this.route.length) events.finished = true;
    }
    for (const c of this.coins) {
      if (!c.alive) continue;
      const d = c.pos.distanceTo(pos);
      if (magnet && d < 60) {
        c.pos.lerp(pos, dt * 5);
        c.baseY = c.pos.y;
      } else c.pos.y = c.baseY + Math.sin(time * 4 + c.pos.x) * 0.6;
      if (d < 4.5) {
        c.alive = false;
        events.coins += 1;
      }
    }
    this.updateCoinMatrices(time);
    return events;
  }
}
