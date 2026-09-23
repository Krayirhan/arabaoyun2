// Converts raw OpenStreetMap + terrain downloads into the compact
// assets/ankara/ankara.json the game loads. See assets/ankara/README.md for
// where each input comes from. Usage:
//   node tools/build-ankara.mjs <main.json> <landmarks.json> <extra.json> <terrain-dir>
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";

const [mainPath, landmarkPath, extraPath, terrainDir] = process.argv.slice(2);
if (!terrainDir) {
  console.error("usage: node tools/build-ankara.mjs <main.json> <landmarks.json> <extra.json> <terrain-dir>");
  process.exit(1);
}
const elements = [mainPath, landmarkPath, extraPath].flatMap((p) => JSON.parse(readFileSync(p, "utf8")).elements);
// The same way can arrive from several queries.
const unique = new Map();
for (const e of elements) unique.set(`${e.type}${e.id}`, e);
const all = [...unique.values()];

// Kızılay square is the world origin. x = east, z = south (Three.js forward is -z).
const LAT0 = 39.9208,
  LON0 = 32.8541;
const M_PER_LAT = 110574;
const M_PER_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
// Coordinates are stored as integers in 0.5 m units to keep the file small.
const Q = 2;
const toXZ = ({ lat, lon }) => [(lon - LON0) * M_PER_LON, -(lat - LAT0) * M_PER_LAT];

// ---------------------------------------------------------------- terrain
// Terrarium PNG tiles: elevation = R*256 + G + B/256 - 32768 metres.
function decodePng(buf) {
  let pos = 8,
    width = 0,
    height = 0,
    channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("unsupported PNG");
      channels = { 2: 3, 6: 4 }[data[9]];
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

const tiles = new Map();
let tileZoom = 0;
for (const name of readdirSync(terrainDir).filter((n) => n.endsWith(".png"))) {
  const [z, x, y] = name.replace(".png", "").split("_").map(Number);
  tileZoom = z;
  tiles.set(`${x},${y}`, decodePng(readFileSync(join(terrainDir, name))));
}
function elevationAt(lat, lon) {
  const n = 2 ** tileZoom;
  const fx = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const sample = (px, py) => {
    const tx = Math.floor(px / 256),
      ty = Math.floor(py / 256);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return null;
    const i = ((py - ty * 256) * 256 + (px - tx * 256)) * t.channels;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const px = fx * 256 - 0.5,
    py = fy * 256 - 0.5;
  const x0 = Math.floor(px),
    y0 = Math.floor(py),
    tx = px - x0,
    ty = py - y0;
  const e00 = sample(x0, y0),
    e10 = sample(x0 + 1, y0),
    e01 = sample(x0, y0 + 1),
    e11 = sample(x0 + 1, y0 + 1);
  if ([e00, e10, e01, e11].includes(null)) return null;
  return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
}

// ---------------------------------------------------------------- rings
// Multipolygon outers/inners can be split over several ways; stitch them.
function stitch(ways) {
  const rings = [];
  const pool = ways.map((w) => w.slice());
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (grew && !samePoint(ring[0], ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const end = ring[ring.length - 1];
        if (samePoint(end, w[0])) ring = ring.concat(w.slice(1));
        else if (samePoint(end, w[w.length - 1])) ring = ring.concat(w.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}
const samePoint = (a, b) => a.lat === b.lat && a.lon === b.lon;

function quantizeRing(geometry) {
  const out = [];
  for (const g of geometry) {
    const [x, z] = toXZ(g);
    const qx = Math.round(x * Q),
      qz = Math.round(z * Q);
    const n = out.length;
    if (n && out[n - 2] === qx && out[n - 1] === qz) continue;
    out.push(qx, qz);
  }
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out.length >= 6 ? out : null;
}

// Returns [outerFlat, ...holeFlats] rings for a way or multipolygon relation.
function polygonsOf(e) {
  if (e.type === "way" && e.geometry) {
    const r = quantizeRing(e.geometry);
    return r ? [[r]] : [];
  }
  if (e.type !== "relation" || !e.members) return [];
  const outers = stitch(e.members.filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry));
  const inners = stitch(e.members.filter((m) => m.role === "inner" && m.geometry).map((m) => m.geometry));
  const polys = outers.map((o) => [quantizeRing(o)]).filter((p) => p[0]);
  for (const inner of inners) {
    const q = quantizeRing(inner);
    if (!q) continue;
    const host = polys.find((p) => pointInRing(p[0], q[0], q[1]));
    if (host) host.push(q);
  }
  return polys;
}

function pointInRing(ring, x, z) {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i],
      zi = ring[i + 1],
      xj = ring[j],
      zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function centroid(ring) {
  let x = 0,
    z = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i];
    z += ring[i + 1];
  }
  return [x / (ring.length / 2), z / (ring.length / 2)];
}

// ---------------------------------------------------------------- heights
const num = (v) => {
  const f = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(f) ? f : null;
};
const LEVEL = 3.2;
const TYPE_LEVELS = {
  house: 2,
  detached: 2,
  garage: 1,
  garages: 1,
  shed: 1,
  kiosk: 1,
  service: 1,
  hut: 1,
  mosque: 4,
  hospital: 6,
  university: 5,
  school: 4,
  office: 8,
  commercial: 6,
  hotel: 8,
  government: 6,
  public: 5,
  train_station: 2,
  construction: 2,
  retail: 3,
};
function taggedHeight(t) {
  const h = num(t.height);
  if (h) return h;
  const lv = num(t["building:levels"]);
  if (lv) return lv * LEVEL + (num(t["roof:levels"]) || 0) * LEVEL * 0.5 + 1;
  return null;
}
function taggedMin(t) {
  const m = num(t.min_height);
  if (m !== null) return m;
  const ml = num(t["building:min_level"]);
  return ml ? ml * LEVEL : 0;
}
// Deterministic jitter from the OSM id so rebuilding gives the same city.
const hash = (id) => (((id * 2654435761) >>> 0) % 1000) / 1000;

const COLOURS = {
  white: 0xf2f2ee,
  black: 0x333333,
  grey: 0x9a9a9a,
  gray: 0x9a9a9a,
  red: 0xb5483a,
  brown: 0x8a5a3c,
  beige: 0xe0d2b4,
  yellow: 0xe6c85a,
  blue: 0x5a7ea8,
  green: 0x5c8a5a,
  orange: 0xd98a4a,
};
function colourOf(v) {
  if (!v) return -1;
  const s = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return parseInt(s.slice(1), 16);
  if (/^#[0-9a-f]{3}$/.test(s)) return parseInt(s[1] + s[1] + s[2] + s[2] + s[3] + s[3], 16);
  return COLOURS[s] ?? -1;
}

const underground = (t) => num(t.layer) < 0 || /underground/.test(t.location || "") || t.building === "no";

// ---------------------------------------------------------------- collect
const partFeatures = [];
const buildingFeatures = [];
for (const e of all) {
  const t = e.tags || {};
  if (underground(t)) continue;
  if (t["building:part"] && t["building:part"] !== "no") partFeatures.push(e);
  else if (t.building) buildingFeatures.push(e);
}

// Neighbourhood estimate for buildings with no height tag: median of tagged
// buildings within 150 m, which follows Ankara's real density (tall Kızılay
// office blocks, low houses on the hills) far better than a flat guess.
const tagged = [];
for (const e of buildingFeatures) {
  const h = taggedHeight(e.tags);
  const polys = polygonsOf(e);
  if (h && polys.length) tagged.push({ c: centroid(polys[0][0]), h });
}
const CELL = 150 * Q;
const tagGrid = new Map();
for (const t of tagged) {
  const key = `${Math.floor(t.c[0] / CELL)},${Math.floor(t.c[1] / CELL)}`;
  if (!tagGrid.has(key)) tagGrid.set(key, []);
  tagGrid.get(key).push(t);
}
function estimateHeight(c, e) {
  const t = e.tags;
  const typeLevels = TYPE_LEVELS[t.building];
  // Small structures keep their type-based height.
  if (typeLevels !== undefined && typeLevels <= 2) return typeLevels * LEVEL + 1;
  const near = [];
  const gx = Math.floor(c[0] / CELL),
    gz = Math.floor(c[1] / CELL);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      for (const n of tagGrid.get(`${gx + dx},${gz + dz}`) || [])
        if (Math.hypot(n.c[0] - c[0], n.c[1] - c[1]) < CELL) near.push(n.h);
  if (near.length >= 3) {
    near.sort((a, b) => a - b);
    const median = near[near.length >> 1];
    // ±1 storey of variation so blocks don't look cloned.
    return Math.max(LEVEL + 1, median + (hash(e.id) - 0.5) * 2 * LEVEL);
  }
  return ((typeLevels ?? 4) + Math.floor(hash(e.id) * 3)) * LEVEL + 1;
}

// Kinds drive the base palette in the game: 0 facade, 1 glass tower,
// 2 canopy roof, 3 stone monument, 4 mosque.
function kindOf(t, h) {
  if (t.building === "roof") return 2;
  if (t.building === "mosque" || t.amenity === "place_of_worship") return 4;
  if (t.historic || t.tourism === "attraction" || t.memorial) return 3;
  return h > 45 ? 1 : 0;
}
const ROOF_SHAPE = { dome: 1, pyramidal: 2, cone: 2, onion: 1 };

const parts = [];
for (const e of partFeatures) {
  for (const rings of polygonsOf(e)) {
    const t = e.tags;
    parts.push({ e, rings, c: centroid(rings[0]), h: taggedHeight(t) || estimateHeight(centroid(rings[0]), e) });
  }
}

const buildings = [];
let skippedOutlines = 0;
function emit(e, rings, h, minH, tags) {
  const rs = tags["roof:shape"];
  buildings.push({
    id: e.id,
    rings,
    h,
    minH,
    kind: kindOf(tags, h),
    colour: colourOf(tags["building:colour"] || tags.colour),
    roofColour: colourOf(tags["roof:colour"]),
    roof: ROOF_SHAPE[rs] || 0,
    roofH: num(tags["roof:height"]) || 0,
  });
}
for (const e of buildingFeatures) {
  const t = e.tags;
  for (const rings of polygonsOf(e)) {
    // Simple 3D Buildings rule: an outline with parts is drawn by its parts.
    if (parts.some((p) => pointInRing(rings[0], p.c[0], p.c[1]))) {
      skippedOutlines += 1;
      continue;
    }
    const c = centroid(rings[0]);
    let h = taggedHeight(t) || estimateHeight(c, e);
    let minH = taggedMin(t);
    // Canopies (petrol stations, platforms) float: a thin slab on posts.
    if (t.building === "roof") {
      h = taggedHeight(t) || 4.5;
      minH = Math.max(minH, h - 0.8);
    }
    emit(e, rings, h, minH, t);
  }
}
for (const p of parts) emit(p.e, p.rings, p.h, taggedMin(p.e.tags), p.e.tags);

// ---------------------------------------------------------------- areas
const AREA_CLASS = (t) => {
  if (t.natural === "water" || t.water) return 2;
  if (t.natural === "wood" || t.landuse === "forest" || t.natural === "scrub") return 1;
  if (t.landuse === "cemetery") return 3;
  if (
    ["park", "garden"].includes(t.leisure) ||
    ["grass", "meadow", "recreation_ground", "village_green"].includes(t.landuse) ||
    t.natural === "grassland"
  )
    return 0;
  return -1;
};
const areas = [];
for (const e of all) {
  const t = e.tags || {};
  if (t.building || t["building:part"]) continue;
  const cls = AREA_CLASS(t);
  if (cls < 0) continue;
  for (const rings of polygonsOf(e)) areas.push([cls, rings]);
}
// Draw big areas first so small parks on top of forests stay visible.
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return Math.abs(a / 2);
};
areas.sort((a, b) => ringArea(b[1][0]) - ringArea(a[1][0]));

// ---------------------------------------------------------------- roads
const ROAD_WIDTH = { motorway: 24, trunk: 22, primary: 18, secondary: 14, tertiary: 11, residential: 7 };
const roads = [];
for (const e of all) {
  const t = e.tags || {};
  if (e.type !== "way" || !e.geometry || !ROAD_WIDTH[t.highway]) continue;
  // Tunnels (Kızılay underpasses) are not visible from the air.
  if (t.tunnel === "yes" || num(t.layer) < 0) continue;
  const flat = [];
  for (const g of e.geometry) {
    const [x, z] = toXZ(g);
    flat.push(Math.round(x * Q), Math.round(z * Q));
  }
  const w = num(t.width) || ROAD_WIDTH[t.highway] * (t.oneway === "yes" ? 0.6 : 1);
  roads.push([Math.round(w * Q), flat]);
}

// ---------------------------------------------------------------- heightmap
let minX = Infinity,
  maxX = -Infinity,
  minZ = Infinity,
  maxZ = -Infinity;
for (const b of buildings)
  for (let i = 0; i < b.rings[0].length; i += 2) {
    minX = Math.min(minX, b.rings[0][i]);
    maxX = Math.max(maxX, b.rings[0][i]);
    minZ = Math.min(minZ, b.rings[0][i + 1]);
    maxZ = Math.max(maxZ, b.rings[0][i + 1]);
  }
const MARGIN = 400;
const HM_CELL = 20;
const hx0 = Math.floor(minX / Q - MARGIN),
  hz0 = Math.floor(minZ / Q - MARGIN);
const hw = Math.ceil((maxX / Q + MARGIN - hx0) / HM_CELL) + 1;
const hh = Math.ceil((maxZ / Q + MARGIN - hz0) / HM_CELL) + 1;
const originElevation = elevationAt(LAT0, LON0);
const heights = new Int16Array(hw * hh);
let missing = 0;
for (let j = 0; j < hh; j++)
  for (let i = 0; i < hw; i++) {
    const x = hx0 + i * HM_CELL,
      z = hz0 + j * HM_CELL;
    const e = elevationAt(LAT0 - z / M_PER_LAT, LON0 + x / M_PER_LON);
    if (e === null) missing += 1;
    // Decimetres relative to Kızılay, so the origin sits at y = 0.
    heights[j * hw + i] = Math.round(((e ?? originElevation) - originElevation) * 10);
  }
function groundAt(x, z) {
  const fx = Math.min(Math.max((x - hx0) / HM_CELL, 0), hw - 1.001),
    fz = Math.min(Math.max((z - hz0) / HM_CELL, 0), hh - 1.001);
  const i = Math.floor(fx),
    j = Math.floor(fz),
    tx = fx - i,
    tz = fz - j;
  const h = (a, b) => heights[b * hw + a] / 10;
  return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz;
}

// Buildings stand on the lowest ground under their footprint.
const outBuildings = buildings.map((b) => {
  let base = Infinity;
  for (let i = 0; i < b.rings[0].length; i += 2) base = Math.min(base, groundAt(b.rings[0][i] / Q, b.rings[0][i + 1] / Q));
  return [
    Math.round(base * Q),
    Math.round(b.minH * Q),
    Math.round(b.h * Q),
    b.kind,
    b.colour,
    b.roofColour,
    b.roof,
    Math.round(b.roofH * Q),
    b.rings,
  ];
});

// ---------------------------------------------------------------- landmarks
const centerOfElement = (e) => {
  if (e.lat) return toXZ(e);
  if (e.bounds) return toXZ({ lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lon: (e.bounds.minlon + e.bounds.maxlon) / 2 });
  return null;
};
const LANDMARKS = [
  ["KIZILAY", null],
  ["GÜVENPARK", (e) => e.type === "relation" && e.id === 11927069],
  ["TBMM", (e) => e.tags?.name === "Türkiye Büyük Millet Meclisi" && e.tags.building],
  ["KUĞULU PARK", (e) => e.id === 10126955],
  ["ATAKULE", (e) => e.id === 72079962 && e.type === "way"],
  ["KOCATEPE CAMİİ", (e) => e.id === 6276462 && e.type === "relation"],
  // The mausoleum itself, not the ceremonial square beside it.
  ["ANITKABİR", (e) => e.type === "way" && e.tags?.name === "Mustafa Kemal Atatürk Türbesi"],
];
const landmarks = [];
for (const [name, match] of LANDMARKS) {
  const c = match ? centerOfElement(all.find(match) || {}) : [0, 0];
  if (!c) {
    console.warn("landmark not found:", name);
    continue;
  }
  landmarks.push([name, Math.round(c[0] * Q), Math.round(c[1] * Q)]);
}

const out = {
  q: Q,
  origin: [LAT0, LON0],
  heightmap: {
    x0: hx0,
    z0: hz0,
    cell: HM_CELL,
    w: hw,
    h: hh,
    // Int16 decimetres, little-endian, base64.
    data: Buffer.from(heights.buffer).toString("base64"),
  },
  buildings: outBuildings,
  areas,
  roads,
  landmarks,
};
mkdirSync("assets/ankara", { recursive: true });
const json = JSON.stringify(out);
writeFileSync("assets/ankara/ankara.json", json);
const hs = outBuildings.map((b) => (b[2] - b[1]) / Q);
console.log(
  `buildings ${outBuildings.length} (parts ${parts.length}, outlines replaced by parts ${skippedOutlines}), ` +
    `areas ${areas.length}, roads ${roads.length}, landmarks ${landmarks.length}, ` +
    `heightmap ${hw}x${hh} (${missing} cells without data), ${(json.length / 1024).toFixed(0)} KB`,
);
console.log(
  "terrain range m:",
  heights.reduce((a, b) => Math.min(a, b)) / 10,
  "to",
  heights.reduce((a, b) => Math.max(a, b)) / 10,
  "| origin elevation",
  originElevation.toFixed(1),
  "| max building",
  hs.reduce((a, b) => Math.max(a, b)).toFixed(1),
);
for (const [name, x, z] of landmarks) console.log(" ", name, "ground", groundAt(x / Q, z / Q).toFixed(1), "m");
