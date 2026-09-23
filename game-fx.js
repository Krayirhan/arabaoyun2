import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

// One pooled point cloud for every particle effect (fire, explosions, debris,
// sparkles). Particles live in world space; dead ones are parked out of view.
const MAX_PARTICLES = 900;

function makeDotTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.baseSize = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    this.baseCol = new Float32Array(MAX_PARTICLES * 3);
    this.next = 0;
    this.pos.fill(1e6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("size_attr", new THREE.BufferAttribute(this.size, 1));
    const material = new THREE.PointsMaterial({
      size: 1,
      map: makeDotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    // PointsMaterial has no per-vertex size, so patch one in.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("uniform float size;", "uniform float size;\nattribute float size_attr;")
        .replace("gl_PointSize = size;", "gl_PointSize = size * size_attr;");
    };
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, color, gravity = 0) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.gravity[i] = gravity;
    this.baseCol.set([color.r, color.g, color.b], i * 3);
  }

  burst(origin, count, { speed = 12, life = 0.8, size = 3, colors, gravity = 0, spread = 1 }) {
    for (let n = 0; n < count; n++) {
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.emit(
        origin.x + (Math.random() - 0.5) * spread,
        origin.y + (Math.random() - 0.5) * spread,
        origin.z + (Math.random() - 0.5) * spread,
        r * Math.cos(theta) * s,
        u * s,
        r * Math.sin(theta) * s,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8),
        c,
        gravity,
      );
    }
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k] = this.pos[k + 1] = this.pos[k + 2] = 1e6;
        this.size[i] = 0;
        continue;
      }
      this.vel[k + 1] -= this.gravity[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
      this.col[k] = this.baseCol[k] * t;
      this.col[k + 1] = this.baseCol[k + 1] * t;
      this.col[k + 2] = this.baseCol[k + 2] * t;
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size_attr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.pos.fill(1e6);
    this.size.fill(0);
  }
}

export const FIRE_COLORS = [
  new THREE.Color(1, 0.55, 0.1),
  new THREE.Color(1, 0.8, 0.2),
  new THREE.Color(1, 0.3, 0.05),
];
// Particles blend additively, so "smoke" must stay dark to read as haze.
export const SMOKE_COLORS = [new THREE.Color(0.12, 0.1, 0.09), new THREE.Color(0.08, 0.07, 0.07)];
export const SPARKLE_COLORS = [new THREE.Color(1, 0.85, 0.3), new THREE.Color(1, 1, 0.7)];
export const RING_COLORS = [new THREE.Color(0.35, 0.9, 0.95), new THREE.Color(0.8, 1, 1)];
export const SHIELD_COLORS = [new THREE.Color(0.4, 0.7, 1), new THREE.Color(0.8, 0.9, 1)];

// Streaks around the camera that stretch and brighten with speed. They live in
// the dragon's local space so they always frame the flight path.
export class SpeedLines {
  constructor(parent, count = 70) {
    this.count = count;
    this.seeds = [];
    const positions = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    for (let i = 0; i < count; i++) this.seeds.push(this.spawn({}, true));
    parent.add(this.lines);
  }

  spawn(seed, anywhere) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 5 + Math.random() * 9;
    seed.x = Math.cos(angle) * radius;
    seed.y = 3 + Math.sin(angle) * radius * 0.7;
    seed.z = anywhere ? -Math.random() * 90 : -80 - Math.random() * 20;
    return seed;
  }

  // intensity 0..1
  update(dt, relSpeed, intensity) {
    this.material.opacity = Math.min(0.55, intensity * 0.55);
    this.lines.visible = intensity > 0.02;
    if (!this.lines.visible) return;
    const pos = this.lines.geometry.attributes.position.array;
    const length = 2 + relSpeed * 0.12;
    this.seeds.forEach((s, i) => {
      s.z += relSpeed * 1.4 * dt;
      if (s.z > 12) this.spawn(s, false);
      pos.set([s.x, s.y, s.z, s.x, s.y, s.z - length], i * 6);
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// Additive, decaying screen shake applied as a camera offset.
export class Shake {
  constructor() {
    this.amount = 0;
    this.offset = new THREE.Vector3();
  }
  add(amount) {
    this.amount = Math.min(2.5, this.amount + amount);
  }
  update(dt) {
    this.amount = Math.max(0, this.amount - dt * 3.5);
    const a = this.amount * this.amount;
    this.offset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0);
    return this.offset;
  }
  reset() {
    this.amount = 0;
    this.offset.set(0, 0, 0);
  }
}
