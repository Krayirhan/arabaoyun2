// Builds the Ankara city geometry off the main thread so loading never
// freezes the game. Input: the URL of assets/ankara/ankara.json. Output:
// typed arrays per 500 m chunk (walls, roofs, roads and markings share one
// mesh), tree instances, traffic paths, collision records and the
// heightmap, all transferred without copying.
import { ShapeUtils, Vector2 } from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const CHUNK = 500;
const TREE_CHUNK = 1000;
const LEVEL = 3.2;
// Facade atlas cells (see facadeAtlas in game-ankara.js). PLAIN skips the
// texture entirely: roads, domes, canopies.
const STYLE_ROOF = 5;
const PLAIN = 255;
const FACADES = [0xe9dfcf, 0xd8cbb6, 0xf1ede4, 0xcfc6ba, 0xe6d3bd, 0xd9d4cc, 0xc9b9a3, 0xe3c9b0];
const GLASS = [0x8fa3b8, 0x9fb6c9, 0x7f93a8];
const KIND_COLOUR = { 2: 0x8d99a6, 3: 0xe8dfc9, 4: 0xebe6da };
const ASPHALT = 0x4a4d52;
const SIDEWALK = 0xb3aea4;
const PAINT = 0xe9e7df;
const ROOF_BOX = 0xc9c6c0;
const SRGB_TO_LINEAR = Uint8Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 255);
});

export function decodeHeightmap(hm) {
  const bin = atob(hm.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ...hm, heights: new Int16Array(bytes.buffer) };
}

export function groundAt(hm, x, z) {
  const fx = Math.min(Math.max((x - hm.x0) / hm.cell, 0), hm.w - 1.001),
    fz = Math.min(Math.max((z - hm.z0) / hm.cell, 0), hm.h - 1.001);
  const i = Math.floor(fx),
    j = Math.floor(fz),
    tx = fx - i,
    tz = fz - j;
  const H = hm.heights,
    w = hm.w;
  // Follow the terrain mesh's own triangles (split along the b-c diagonal,
  // see buildTerrain) rather than bilinear filtering: on slopes the two
  // differ by up to half a metre, enough to bury roads and cars.
  const a = H[j * w + i],
    b = H[j * w + i + 1],
    c = H[(j + 1) * w + i],
    d = H[(j + 1) * w + i + 1];
  const h = tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  return h / 10;
}

// Deterministic random so the city is identical on every load.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Growable typed-array mesh: indexed, Int8 normals, Uint8 colours, and a
// per-vertex facade style for the atlas shader.
class Builder {
  constructor() {
    const cap = 4096;
    this.pos = new Float32Array(cap * 3);
    this.nrm = new Int8Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
    this.col = new Uint8Array(cap * 3);
    this.sty = new Uint8Array(cap);
    this.idx = new Uint32Array(cap * 2);
    this.v = 0;
    this.i = 0;
  }
  grow(verts, indices) {
    if (this.v + verts > this.sty.length) {
      const cap = Math.max(this.sty.length * 2, this.v + verts);
      const resize = (a, n) => {
        const b = new a.constructor(cap * n);
        b.set(a);
        return b;
      };
      this.pos = resize(this.pos, 3);
      this.nrm = resize(this.nrm, 3);
      this.uv = resize(this.uv, 2);
      this.col = resize(this.col, 3);
      this.sty = resize(this.sty, 1);
    }
    if (this.i + indices > this.idx.length) {
      const b = new Uint32Array(Math.max(this.idx.length * 2, this.i + indices));
      b.set(this.idx);
      this.idx = b;
    }
  }
  vert(x, y, z, nx, ny, nz, u, v, rgb, style = PLAIN) {
    const k = this.v;
    this.pos[k * 3] = x;
    this.pos[k * 3 + 1] = y;
    this.pos[k * 3 + 2] = z;
    this.nrm[k * 3] = Math.round(nx * 127);
    this.nrm[k * 3 + 1] = Math.round(ny * 127);
    this.nrm[k * 3 + 2] = Math.round(nz * 127);
    this.uv[k * 2] = u;
    this.uv[k * 2 + 1] = v;
    // Vertex colours are linear in three.js; palette values are sRGB.
    this.col[k * 3] = SRGB_TO_LINEAR[(rgb >> 16) & 255];
    this.col[k * 3 + 1] = SRGB_TO_LINEAR[(rgb >> 8) & 255];
    this.col[k * 3 + 2] = SRGB_TO_LINEAR[rgb & 255];
    this.sty[k] = style;
    this.v += 1;
    return k;
  }
  tri(a, b, c) {
    this.idx[this.i++] = a;
    this.idx[this.i++] = b;
    this.idx[this.i++] = c;
  }
  // A flat quad lying on the ground; corners in order around the quad.
  flatQuad(p, y, rgb) {
    const base = this.v;
    this.grow(4, 6);
    for (let k = 0; k < 4; k++) this.vert(p[k * 2], y, p[k * 2 + 1], 0, 1, 0, 0, 0, rgb);
    const up = (p[3] - p[1]) * (p[4] - p[0]) - (p[2] - p[0]) * (p[5] - p[1]) > 0;
    if (up) {
      this.tri(base, base + 1, base + 2);
      this.tri(base, base + 2, base + 3);
    } else {
      this.tri(base, base + 2, base + 1);
      this.tri(base, base + 3, base + 2);
    }
  }
  result() {
    return {
      position: this.pos.slice(0, this.v * 3),
      normal: this.nrm.slice(0, this.v * 3),
      uv: this.uv.slice(0, this.v * 2),
      color: this.col.slice(0, this.v * 3),
      style: this.sty.slice(0, this.v),
      index: this.idx.slice(0, this.i),
    };
  }
}

const shade = (rgb, k) =>
  (Math.min(255, ((rgb >> 16) & 255) * k) << 16) |
  (Math.min(255, ((rgb >> 8) & 255) * k) << 8) |
  Math.min(255, (rgb & 255) * k);

function signedArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}

function reversed(r) {
  const out = new Float32Array(r.length);
  for (let i = 0; i < r.length; i += 2) {
    out[i] = r[r.length - 2 - i];
    out[i + 1] = r[r.length - 1 - i];
  }
  return out;
}

function pointInRings(rings, x, z) {
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

// Walls of one ring. Outer rings wind so normals face out; holes (courtyards)
// wind the other way so their walls face into the courtyard. uv is in
// storeys (v) and 4 m bays (u), which the atlas shader tiles.
function walls(b, ring, isHole, y0, y1, rgb, style) {
  const inward = signedArea(ring) > 0;
  const r = inward !== isHole ? reversed(ring) : ring;
  const n = r.length / 2;
  b.grow(n * 4, n * 6);
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = r[i * 2],
      z0 = r[i * 2 + 1],
      x1 = r[j * 2],
      z1 = r[j * 2 + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.01) continue;
    const nx = -(z1 - z0) / len,
      nz = (x1 - x0) / len;
    // Whole bays per wall so windows never get cut at corners.
    const bays = Math.max(1, Math.round(len / 4));
    const u0 = u,
      u1 = u + bays,
      v1 = (y1 - y0) / LEVEL;
    const a = b.vert(x0, y0, z0, nx, 0, nz, u0, 0, rgb, style);
    const c = b.vert(x1, y0, z1, nx, 0, nz, u1, 0, rgb, style);
    const d = b.vert(x1, y1, z1, nx, 0, nz, u1, v1, rgb, style);
    const e = b.vert(x0, y1, z0, nx, 0, nz, u0, v1, rgb, style);
    b.tri(a, c, d);
    b.tri(a, d, e);
    u = u1;
  }
}

// Flat cap (roof, or the underside of a canopy) with courtyard holes.
function cap(b, rings, y, up, rgb, style = PLAIN) {
  const toVec = (r) => {
    const out = [];
    for (let i = 0; i < r.length; i += 2) out.push(new Vector2(r[i], r[i + 1]));
    return out;
  };
  const contour = toVec(rings[0]);
  const holes = rings.slice(1).map(toVec);
  let faces;
  try {
    faces = ShapeUtils.triangulateShape(contour, holes);
  } catch {
    return;
  }
  const pts = contour.concat(...holes);
  const base = b.v;
  b.grow(pts.length, faces.length * 3);
  // Roof texture is laid out in world space, 6 m per tile.
  for (const p of pts) b.vert(p.x, y, p.y, 0, up ? 1 : -1, 0, p.x / 6, p.y / 6, rgb, style);
  for (const [i, j, k] of faces) {
    const A = pts[i],
      B = pts[j],
      C = pts[k];
    const facingUp = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
    if (facingUp === up) b.tri(base + i, base + j, base + k);
    else b.tri(base + i, base + k, base + j);
  }
}

// Axis-aligned box: rooftop water tanks and AC units.
function box(b, cx, y, cz, sx, sy, sz, rgb) {
  const faces = [
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  b.grow(20, 30);
  for (const [nx, ny, nz] of faces) {
    const base = b.v;
    // Two axes spanning the face.
    const ax = ny ? [1, 0, 0] : [-nz, 0, nx];
    const ay = ny ? [0, 0, 1] : [0, 1, 0];
    const c = [cx + (nx * sx) / 2, y + sy / 2 + (ny * sy) / 2, cz + (nz * sz) / 2];
    const hx = ny ? sx / 2 : Math.abs(nz) * sx / 2 + Math.abs(nx) * sz / 2;
    const hy = ny ? sz / 2 : sy / 2;
    for (const [s, t] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      b.vert(
        c[0] + ax[0] * s * hx + ay[0] * t * hy,
        c[1] + ax[1] * s * hx + ay[1] * t * hy,
        c[2] + ax[2] * s * hx + ay[2] * t * hy,
        nx,
        ny,
        nz,
        0,
        0,
        ny ? rgb : shade(rgb, 0.85),
      );
    // With these face axes this winding points every face along its normal.
    b.tri(base, base + 2, base + 1);
    b.tri(base, base + 3, base + 2);
  }
}

function centroidAndRadius(ring) {
  let cx = 0,
    cz = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    cx += ring[i];
    cz += ring[i + 1];
  }
  cx /= n;
  cz /= n;
  return { cx, cz, r: Math.sqrt(Math.abs(signedArea(ring)) / Math.PI) };
}

function dome(b, ring, y, height, rgb) {
  const { cx, cz, r } = centroidAndRadius(ring);
  const seg = 16,
    rows = 6;
  const base = b.v;
  b.grow((seg + 1) * (rows + 1), seg * rows * 6);
  for (let j = 0; j <= rows; j++) {
    const phi = (j / rows) * (Math.PI / 2);
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const nx = Math.cos(phi) * Math.cos(th),
        ny = Math.sin(phi),
        nz = Math.cos(phi) * Math.sin(th);
      b.vert(cx + nx * r, y + ny * height, cz + nz * r, nx, ny, nz, 0, 0, rgb);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i,
        c = a + seg + 1;
      b.tri(a, c, a + 1);
      b.tri(a + 1, c, c + 1);
    }
}

function pyramid(b, ring, y, height, rgb) {
  const { cx, cz } = centroidAndRadius(ring);
  const r = signedArea(ring) > 0 ? reversed(ring) : ring;
  const n = r.length / 2;
  b.grow(n * 3, n * 3);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = r[i * 2],
      z0 = r[i * 2 + 1],
      x1 = r[j * 2],
      z1 = r[j * 2 + 1];
    const ax = x1 - x0,
      az = z1 - z0,
      bx = cx - x0,
      by = height,
      bz = cz - z0;
    let nx = -az * by,
      ny = az * bx - ax * bz,
      nz = ax * by;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const a = b.vert(x0, y, z0, nx, ny, nz, 0, 0, rgb);
    const c = b.vert(x1, y, z1, nx, ny, nz, 0, 0, rgb);
    const t = b.vert(cx, y + height, cz, nx, ny, nz, 0, 0, rgb);
    // Same winding as the wall below it, so the face points outwards.
    b.tri(a, c, t);
  }
}

// Subdivides a polyline so draped geometry follows the terrain.
function densify(pts, step) {
  const dense = [];
  for (let i = 0; i < pts.length; i += 2) {
    if (i) {
      const px = pts[i - 2],
        pz = pts[i - 1];
      const len = Math.hypot(pts[i] - px, pts[i + 1] - pz);
      const steps = Math.ceil(len / step);
      for (let s = 1; s < steps; s++) dense.push(px + ((pts[i] - px) * s) / steps, pz + ((pts[i + 1] - pz) * s) / steps);
    }
    dense.push(pts[i], pts[i + 1]);
  }
  return dense;
}

// Per-point left normal of a polyline, averaged at joints, with the miter
// scale capped so sharp bends don't spike.
function frame(dense) {
  const n = dense.length / 2;
  const out = new Float32Array(n * 3);
  const dir = (a, b) => {
    const dx = dense[b * 2] - dense[a * 2],
      dz = dense[b * 2 + 1] - dense[a * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? dir(i - 1, i) : dir(0, 1);
    const next = i < n - 1 ? dir(i, i + 1) : prev;
    const tx = prev[0] + next[0],
      tz = prev[1] + next[1];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl,
      nz = tx / tl;
    const cos = Math.max(0.5, nx * -next[1] + nz * next[0]);
    out[i * 3] = nx;
    out[i * 3 + 1] = nz;
    out[i * 3 + 2] = 1 / cos;
  }
  return out;
}

// Ribbon between two lateral offsets (left positive) along the polyline.
function ribbon(b, hm, dense, fr, from, to, lift, rgb) {
  const n = dense.length / 2;
  const base = b.v;
  b.grow(n * 2, (n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const x = dense[i * 2],
      z = dense[i * 2 + 1];
    const nx = fr[i * 3],
      nz = fr[i * 3 + 1],
      m = fr[i * 3 + 2];
    const y = groundAt(hm, x, z) + lift;
    b.vert(x + nx * to * m, y, z + nz * to * m, 0, 1, 0, 0, 0, rgb);
    b.vert(x + nx * from * m, y, z + nz * from * m, 0, 1, 0, 0, 0, rgb);
  }
  // Even vertex is on the left (+normal) side, so this winding faces up.
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    b.tri(a, a + 3, a + 1);
    b.tri(a, a + 2, a + 3);
  }
}

// Dashed or solid paint line at a lateral offset.
function paintLine(b, hm, dense, fr, offset, halfWidth, dash, gap) {
  const n = dense.length / 2;
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    const x0 = dense[i * 2],
      z0 = dense[i * 2 + 1],
      x1 = dense[i * 2 + 2],
      z1 = dense[i * 2 + 3];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / (len || 1),
      dz = (z1 - z0) / (len || 1);
    const nx = -dz,
      nz = dx;
    let t = 0;
    while (t < len) {
      const phase = s % (dash + gap);
      const on = !gap || phase < dash;
      const stepLen = Math.min(len - t, on ? (gap ? dash - phase : len - t) : dash + gap - phase);
      if (on && stepLen > 0.2) {
        const ax = x0 + dx * t + nx * offset,
          az = z0 + dz * t + nz * offset;
        const bx = ax + dx * stepLen,
          bz = az + dz * stepLen;
        const y = groundAt(hm, (ax + bx) / 2, (az + bz) / 2) + 0.56;
        b.flatQuad(
          [ax + nx * halfWidth, az + nz * halfWidth, bx + nx * halfWidth, bz + nz * halfWidth, bx - nx * halfWidth, bz - nz * halfWidth, ax - nx * halfWidth, az - nz * halfWidth],
          y,
          PAINT,
        );
      }
      t += Math.max(stepLen, 0.05);
      s += Math.max(stepLen, 0.05);
    }
  }
}

// Road with sidewalks and markings. Returns the dense centreline with
// ground heights, for traffic.
function road(b, hm, pts, halfWidth, cls, oneway) {
  const dense = densify(pts, 8);
  if (dense.length < 4) return null;
  const fr = frame(dense);
  // One-way halves of a dual carriageway only get a sidewalk on their outer
  // (right-hand) side, which leaves the median between them visible.
  const walk = cls <= 3 ? 3 : 1.8;
  ribbon(b, hm, dense, fr, -halfWidth - walk, oneway ? -halfWidth + 0.01 : halfWidth + walk, 0.4, SIDEWALK);
  ribbon(b, hm, dense, fr, -halfWidth, halfWidth, 0.48, ASPHALT);
  if (cls <= 3) {
    if (!oneway) paintLine(b, hm, dense, fr, 0, 0.12, 3, 6);
    else paintLine(b, hm, dense, fr, 0, 0.08, 2, 7);
  }
  if (cls <= 2) {
    paintLine(b, hm, dense, fr, halfWidth - 0.6, 0.1, 1, 0);
    paintLine(b, hm, dense, fr, -halfWidth + 0.6, 0.1, 1, 0);
  }
  const n = dense.length / 2;
  const path = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    path[i * 3] = dense[i * 2];
    path[i * 3 + 1] = groundAt(hm, dense[i * 2], dense[i * 2 + 1]) + 0.48;
    path[i * 3 + 2] = dense[i * 2 + 1];
  }
  return { path, fr };
}

// The main thread imports groundAt from this module too; only listen when
// actually running as a worker.
const isWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
if (isWorker)
  self.onmessage = async ({ data: { url, treeDensity = 1 } }) => {
    try {
      const data = await (await fetch(url)).json();
      const q = data.q;
      const hm = decodeHeightmap(data.heightmap);
      const chunks = new Map();
      const chunkAt = (x, z) => {
        const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
        if (!chunks.has(key)) chunks.set(key, new Builder());
        return chunks.get(key);
      };
      const colliders = [];
      const random = rng(1071);
      data.buildings.forEach(
        ([baseQ, minQ, hQ, kind, colour, roofColour, roofShape, roofHQ, ringsQ, style], index) => {
          const rings = ringsQ.map((r) => Float32Array.from(r, (v) => v / q));
          const outer = rings[0];
          let maxGround = -Infinity;
          for (let i = 0; i < outer.length; i += 2)
            maxGround = Math.max(maxGround, groundAt(hm, outer[i], outer[i + 1]));
          const base = baseQ / q,
            minH = minQ / q;
          // Sink walls a little so sloped ground never shows a gap underneath.
          const y0 = minH > 0 ? base + minH : base - 1.5;
          const top = Math.max(base + hQ / q, maxGround + 3);
          const wallColour =
            colour >= 0
              ? colour
              : KIND_COLOUR[kind] ?? (kind === 1 || style === 1 ? GLASS[index % GLASS.length] : FACADES[index % FACADES.length]);
          const roofRgb = roofColour >= 0 ? roofColour : kind === 3 || kind === 4 ? wallColour : shade(wallColour, 0.62);
          const { cx, cz, r } = centroidAndRadius(outer);
          const b = chunkAt(cx, cz);
          const roofH = roofShape ? Math.min(roofHQ / q || (roofShape === 1 ? r : Math.min(r, 6)), top - y0) : 0;
          const wallTop = top - roofH;
          // Canopies and monuments stay untextured.
          const wallStyle = kind === 2 || kind === 4 || minH > 0 ? PLAIN : style ?? 6;
          rings.forEach((ring, i) => walls(b, ring, i > 0, y0, wallTop, wallColour, wallStyle));
          if (roofShape === 1) {
            cap(b, rings, wallTop, true, roofRgb);
            dome(b, outer, wallTop, roofH, roofRgb);
          } else if (roofShape === 2) pyramid(b, outer, wallTop, roofH, roofRgb);
          else {
            cap(b, rings, top, true, roofRgb, kind === 2 ? PLAIN : STYLE_ROOF);
            // Water tanks and AC units on larger flat roofs, placed only
            // where the centre is actually on the roof.
            const area = Math.abs(signedArea(outer));
            if (kind !== 2 && area > 120 && random() < 0.6 && pointInRings(rings, cx, cz)) {
              const s = 1.6 + random() * 1.4;
              box(b, cx + (random() - 0.5) * r * 0.6, top, cz + (random() - 0.5) * r * 0.6, s, 1.2 + random(), s, ROOF_BOX);
            }
          }
          if (minH > 0) cap(b, rings, y0, false, shade(wallColour, 0.5));
          let bx0 = Infinity,
            bx1 = -Infinity,
            bz0 = Infinity,
            bz1 = -Infinity;
          for (let i = 0; i < outer.length; i += 2) {
            bx0 = Math.min(bx0, outer[i]);
            bx1 = Math.max(bx1, outer[i]);
            bz0 = Math.min(bz0, outer[i + 1]);
            bz1 = Math.max(bz1, outer[i + 1]);
          }
          colliders.push({ rings, y0: minH > 0 ? y0 : -Infinity, top, bx0, bx1, bz0, bz1 });
        },
      );

      // Grid over footprints so trees never grow through buildings.
      const G = 32;
      const grid = new Map();
      colliders.forEach((c, id) => {
        for (let gx = Math.floor(c.bx0 / G); gx <= Math.floor(c.bx1 / G); gx++)
          for (let gz = Math.floor(c.bz0 / G); gz <= Math.floor(c.bz1 / G); gz++) {
            const key = `${gx},${gz}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(id);
          }
      });
      const blocked = (x, z, pad) => {
        for (const id of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) || []) {
          const c = colliders[id];
          if (x < c.bx0 - pad || x > c.bx1 + pad || z < c.bz0 - pad || z > c.bz1 + pad) continue;
          if (pointInRings(c.rings, x, z) || pointInRings(c.rings, x + pad, z) || pointInRings(c.rings, x - pad, z)) return true;
        }
        return false;
      };

      // Road corridors (carriageway + sidewalks), so scattered trees in
      // parks that the roads cross never land on the asphalt.
      const roadGrid = new Map();
      const RG = 40;
      const markRoad = (pts, reach) => {
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const seg = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3], reach];
          const x0 = Math.min(pts[i], pts[i + 2]) - reach,
            x1 = Math.max(pts[i], pts[i + 2]) + reach,
            z0 = Math.min(pts[i + 1], pts[i + 3]) - reach,
            z1 = Math.max(pts[i + 1], pts[i + 3]) + reach;
          for (let gx = Math.floor(x0 / RG); gx <= Math.floor(x1 / RG); gx++)
            for (let gz = Math.floor(z0 / RG); gz <= Math.floor(z1 / RG); gz++) {
              const key = `${gx},${gz}`;
              if (!roadGrid.has(key)) roadGrid.set(key, []);
              roadGrid.get(key).push(seg);
            }
        }
      };
      const onRoad = (x, z) => {
        for (const [ax, az, bx, bz, reach] of roadGrid.get(`${Math.floor(x / RG)},${Math.floor(z / RG)}`) || []) {
          const dx = bx - ax,
            dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          if (Math.hypot(x - ax - t * dx, z - az - t * dz) < reach) return true;
        }
        return false;
      };

      const traffic = [];
      const streetTrees = [];
      // [ax, az, bx, bz, halfWidth, sidewalk] per road segment, so someone
      // walking knows when they are on the raised asphalt or sidewalk.
      const surface = [];
      for (const [wq, flat, cls, oneway] of data.roads) {
        const pts = flat.map((v) => v / q);
        const halfWidth = wq / q / 2;
        // Street trees stand on the sidewalk edge, just outside this reach.
        markRoad(pts, halfWidth + 1.2);
        for (let i = 0; i + 3 < pts.length; i += 2)
          surface.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], halfWidth, cls <= 3 ? 3 : 1.8);
        const r = road(chunkAt(pts[0], pts[1]), hm, pts, halfWidth, cls, oneway);
        if (!r) continue;
        if (cls <= 3) traffic.push({ path: r.path, oneway: !!oneway, halfWidth });
        // Street trees along the sidewalks of main roads, every ~11 m.
        if (cls <= 2) {
          const n = r.path.length / 3;
          let acc = 0;
          for (let i = 1; i < n; i++) {
            acc += Math.hypot(r.path[i * 3] - r.path[i * 3 - 3], r.path[i * 3 + 2] - r.path[i * 3 - 1]);
            if (acc < 11) continue;
            acc = 0;
            for (const side of oneway ? [-1] : [-1, 1]) {
              const off = side * (halfWidth + 1.6) * r.fr[i * 3 + 2];
              streetTrees.push(r.path[i * 3] + r.fr[i * 3] * off, r.path[i * 3 + 2] + r.fr[i * 3 + 1] * off);
            }
          }
        }
      }

      // Trees: [x, y, z, scale, tint, conifer] per 1 km chunk.
      const treeChunks = new Map();
      const addTree = (x, z, conifer, scale) => {
        if (blocked(x, z, 1.5) || onRoad(x, z)) return;
        const key = `${Math.floor(x / TREE_CHUNK)},${Math.floor(z / TREE_CHUNK)}`;
        if (!treeChunks.has(key)) treeChunks.set(key, []);
        treeChunks.get(key).push(x, groundAt(hm, x, z), z, scale, random(), conifer ? 1 : 0);
      };
      const tp = data.trees?.points || [];
      for (let i = 0; i < tp.length; i += 2) addTree(tp[i] / q, tp[i + 1] / q, false, 0.9 + random() * 0.4);
      for (const row of data.trees?.rows || []) {
        const dense = densify(row.map((v) => v / q), 7);
        for (let i = 0; i < dense.length; i += 2) addTree(dense[i], dense[i + 1], false, 0.8 + random() * 0.3);
      }
      for (let i = 0; i < streetTrees.length; i += 2)
        if (random() < treeDensity) addTree(streetTrees[i], streetTrees[i + 1], false, 0.75 + random() * 0.35);
      // Scatter on a jittered grid: forests dense and mostly pine (as on
      // Anıtkabir's hill), parks and cemeteries sparser and leafy.
      const SPACING = { 0: 17, 1: 9.5, 3: 13 };
      for (const [cls, ringsQ] of data.areas) {
        const spacing = SPACING[cls];
        if (!spacing) continue;
        const rings = ringsQ.map((r) => r.map((v) => v / q));
        let x0 = Infinity,
          x1 = -Infinity,
          z0 = Infinity,
          z1 = -Infinity;
        for (let i = 0; i < rings[0].length; i += 2) {
          x0 = Math.min(x0, rings[0][i]);
          x1 = Math.max(x1, rings[0][i]);
          z0 = Math.min(z0, rings[0][i + 1]);
          z1 = Math.max(z1, rings[0][i + 1]);
        }
        const step = spacing / Math.sqrt(treeDensity);
        for (let x = x0; x < x1; x += step)
          for (let z = z0; z < z1; z += step) {
            const px = x + (random() - 0.5) * step * 0.8,
              pz = z + (random() - 0.5) * step * 0.8;
            if (!pointInRings(rings, px, pz)) continue;
            addTree(px, pz, cls === 1 ? random() < 0.65 : random() < 0.15, 0.8 + random() * 0.6);
          }
      }

      const out = [];
      const transfer = [hm.heights.buffer];
      for (const [key, b] of chunks) {
        const r = b.result();
        out.push({ key, ...r });
        transfer.push(r.position.buffer, r.normal.buffer, r.uv.buffer, r.color.buffer, r.style.buffer, r.index.buffer);
      }
      const trees = [...treeChunks.values()].map((list) => Float32Array.from(list));
      trees.forEach((t) => transfer.push(t.buffer));
      traffic.forEach((t) => transfer.push(t.path.buffer));
      const surfaceSegments = Float32Array.from(surface);
      transfer.push(surfaceSegments.buffer);
      for (const c of colliders) for (const r of c.rings) transfer.push(r.buffer);
      self.postMessage(
        {
          chunks: out,
          trees,
          traffic,
          surfaceSegments,
          colliders,
          heightmap: { x0: hm.x0, z0: hm.z0, cell: hm.cell, w: hm.w, h: hm.h, heights: hm.heights },
          areas: data.areas.map(([cls, rings]) => [cls, rings.map((r) => r.map((v) => v / q))]),
          landmarks: data.landmarks.map(([name, x, z]) => ({ name, x: x / q, z: z / q })),
        },
        transfer,
      );
    } catch (error) {
      self.postMessage({ error: String(error?.stack || error) });
    }
  };
