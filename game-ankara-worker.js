// Builds the Ankara city geometry off the main thread so loading never
// freezes the game. Input: the URL of assets/ankara/ankara.json. Output:
// typed arrays per 500 m chunk (walls, roofs and roads share one mesh),
// collision records and the heightmap, all transferred without copying.
import { ShapeUtils, Vector2 } from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const CHUNK = 500;
const LEVEL = 3.2;
// uv of a plain white texel in the window texture: roofs and roads sample it
// so they can share the wall material without showing windows.
const PLAIN_UV = 0.02;
const FACADES = [0xe9dfcf, 0xd8cbb6, 0xf1ede4, 0xcfc6ba, 0xe6d3bd, 0xd9d4cc, 0xc9b9a3, 0xe3c9b0];
const GLASS = [0x8fa3b8, 0x9fb6c9, 0x7f93a8];
const KIND_COLOUR = { 2: 0x8d99a6, 3: 0xe8dfc9, 4: 0xebe6da };
const ASPHALT = 0x55585e;
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
  return (
    ((H[j * w + i] * (1 - tx) + H[j * w + i + 1] * tx) * (1 - tz) +
      (H[(j + 1) * w + i] * (1 - tx) + H[(j + 1) * w + i + 1] * tx) * tz) /
    10
  );
}

// Growable typed-array mesh: indexed, Int8 normals, Uint8 colours.
class Builder {
  constructor() {
    this.pos = new Float32Array(4096 * 3);
    this.nrm = new Int8Array(4096 * 3);
    this.uv = new Float32Array(4096 * 2);
    this.col = new Uint8Array(4096 * 3);
    this.idx = new Uint32Array(8192);
    this.v = 0;
    this.i = 0;
  }
  grow(verts, indices) {
    if (this.v + verts > this.pos.length / 3) {
      const cap = Math.max((this.pos.length / 3) * 2, this.v + verts);
      const resize = (a, n) => {
        const b = new a.constructor(cap * n);
        b.set(a);
        return b;
      };
      this.pos = resize(this.pos, 3);
      this.nrm = resize(this.nrm, 3);
      this.uv = resize(this.uv, 2);
      this.col = resize(this.col, 3);
    }
    if (this.i + indices > this.idx.length) {
      const b = new Uint32Array(Math.max(this.idx.length * 2, this.i + indices));
      b.set(this.idx);
      this.idx = b;
    }
  }
  vert(x, y, z, nx, ny, nz, u, v, rgb) {
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
    this.v += 1;
    return k;
  }
  tri(a, b, c) {
    this.idx[this.i++] = a;
    this.idx[this.i++] = b;
    this.idx[this.i++] = c;
  }
  result() {
    return {
      position: this.pos.slice(0, this.v * 3),
      normal: this.nrm.slice(0, this.v * 3),
      uv: this.uv.slice(0, this.v * 2),
      color: this.col.slice(0, this.v * 3),
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

// Walls of one ring. Outer rings wind so normals face out; holes (courtyards)
// wind the other way so their walls face into the courtyard.
function walls(b, ring, isHole, y0, y1, rgb) {
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
    const u0 = u / 4,
      u1 = (u + len) / 4,
      v1 = (y1 - y0) / LEVEL;
    const a = b.vert(x0, y0, z0, nx, 0, nz, u0, 0, rgb);
    const c = b.vert(x1, y0, z1, nx, 0, nz, u1, 0, rgb);
    const d = b.vert(x1, y1, z1, nx, 0, nz, u1, v1, rgb);
    const e = b.vert(x0, y1, z0, nx, 0, nz, u0, v1, rgb);
    b.tri(a, c, d);
    b.tri(a, d, e);
    u += len;
  }
}

// Flat cap (roof, or the underside of a canopy) with courtyard holes.
function cap(b, rings, y, up, rgb) {
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
  for (const p of pts) b.vert(p.x, y, p.y, 0, up ? 1 : -1, 0, PLAIN_UV, PLAIN_UV, rgb);
  for (const [i, j, k] of faces) {
    const A = pts[i],
      B = pts[j],
      C = pts[k];
    const facingUp = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
    if (facingUp === up) b.tri(base + i, base + j, base + k);
    else b.tri(base + i, base + k, base + j);
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
      b.vert(cx + nx * r, y + ny * height, cz + nz * r, nx, ny, nz, PLAIN_UV, PLAIN_UV, rgb);
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
    // Face normal of the sloped triangle.
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
    const a = b.vert(x0, y, z0, nx, ny, nz, PLAIN_UV, PLAIN_UV, rgb);
    const c = b.vert(x1, y, z1, nx, ny, nz, PLAIN_UV, PLAIN_UV, rgb);
    const t = b.vert(cx, y + height, cz, nx, ny, nz, PLAIN_UV, PLAIN_UV, rgb);
    // Same winding as the wall below it, so the face points outwards.
    b.tri(a, c, t);
  }
}

// Roads as continuous ribbons draped on the terrain, with mitred joins.
function road(b, hm, pts, halfWidth) {
  // Subdivide so the ribbon follows the terrain between OSM nodes.
  const dense = [];
  for (let i = 0; i < pts.length; i += 2) {
    if (i) {
      const px = pts[i - 2],
        pz = pts[i - 1];
      const len = Math.hypot(pts[i] - px, pts[i + 1] - pz);
      const steps = Math.ceil(len / 15);
      for (let s = 1; s < steps; s++) dense.push(px + ((pts[i] - px) * s) / steps, pz + ((pts[i + 1] - pz) * s) / steps);
    }
    dense.push(pts[i], pts[i + 1]);
  }
  const n = dense.length / 2;
  if (n < 2) return;
  const base = b.v;
  b.grow(n * 2, (n - 1) * 6);
  const dir = (a, b) => {
    const dx = dense[b * 2] - dense[a * 2],
      dz = dense[b * 2 + 1] - dense[a * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  for (let i = 0; i < n; i++) {
    const x = dense[i * 2],
      z = dense[i * 2 + 1];
    const prev = i > 0 ? dir(i - 1, i) : dir(0, 1);
    const next = i < n - 1 ? dir(i, i + 1) : prev;
    const tx = prev[0] + next[0],
      tz = prev[1] + next[1];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl,
      nz = tx / tl;
    // Miter length, capped so sharp bends don't spike.
    const cos = Math.max(0.5, nx * -next[1] + nz * next[0]);
    const m = halfWidth / cos;
    const y = groundAt(hm, x, z) + 0.35;
    b.vert(x + nx * m, y, z + nz * m, 0, 1, 0, PLAIN_UV, PLAIN_UV, ASPHALT);
    b.vert(x - nx * m, y, z - nz * m, 0, 1, 0, PLAIN_UV, PLAIN_UV, ASPHALT);
  }
  for (let i = 0; i < n - 1; i++) {
    // Left (+normal) vertex is even, so this winding always faces up.
    const a = base + i * 2;
    b.tri(a, a + 3, a + 1);
    b.tri(a, a + 2, a + 3);
  }
}

// The main thread imports groundAt from this module too; only listen when
// actually running as a worker.
const isWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
if (isWorker) self.onmessage = async ({ data: { url } }) => {
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
    data.buildings.forEach(([baseQ, minQ, hQ, kind, colour, roofColour, roofShape, roofHQ, ringsQ], index) => {
      const rings = ringsQ.map((r) => Float32Array.from(r, (v) => v / q));
      const outer = rings[0];
      let maxGround = -Infinity;
      for (let i = 0; i < outer.length; i += 2) maxGround = Math.max(maxGround, groundAt(hm, outer[i], outer[i + 1]));
      const base = baseQ / q,
        minH = minQ / q;
      // Sink walls a little so sloped ground never shows a gap underneath.
      const y0 = minH > 0 ? base + minH : base - 1.5;
      const top = Math.max(base + hQ / q, maxGround + 3);
      const wallColour =
        colour >= 0 ? colour : KIND_COLOUR[kind] ?? (kind === 1 ? GLASS[index % GLASS.length] : FACADES[index % FACADES.length]);
      const roofRgb = roofColour >= 0 ? roofColour : kind === 3 || kind === 4 ? wallColour : shade(wallColour, 0.62);
      const { cx, cz, r } = centroidAndRadius(outer);
      const b = chunkAt(cx, cz);
      const roofH = roofShape ? Math.min(roofHQ / q || (roofShape === 1 ? r : Math.min(r, 6)), top - y0) : 0;
      const wallTop = top - roofH;
      rings.forEach((ring, i) => walls(b, ring, i > 0, y0, wallTop, wallColour));
      if (roofShape === 1) {
        cap(b, rings, wallTop, true, roofRgb);
        dome(b, outer, wallTop, roofH, roofRgb);
      } else if (roofShape === 2) pyramid(b, outer, wallTop, roofH, roofRgb);
      else cap(b, rings, top, true, roofRgb);
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
    });
    for (const [wq, flat] of data.roads) {
      const pts = flat.map((v) => v / q);
      road(chunkAt(pts[0], pts[1]), hm, pts, wq / q / 2);
    }
    const out = [];
    const transfer = [hm.heights.buffer];
    for (const [key, b] of chunks) {
      const r = b.result();
      out.push({ key, ...r });
      transfer.push(r.position.buffer, r.normal.buffer, r.uv.buffer, r.color.buffer, r.index.buffer);
    }
    for (const c of colliders) for (const r of c.rings) transfer.push(r.buffer);
    self.postMessage(
      {
        chunks: out,
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
