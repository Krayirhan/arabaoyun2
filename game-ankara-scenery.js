import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

// Realism layer for the Ankara level: the facade atlas and its shader,
// ground detail, instanced trees, traffic on the OSM roads and birds.

// ---------------------------------------------------------------- facades
// 4x2 atlas of 256 px cells; each cell is one storey (3.2 m) by one 4 m bay.
// Cells: 0 apartment, 1 glass office, 2 plain, 3 stone, 4 shopfront,
// 5 roof, 6 apartment with balconies, 7 blank. Walls are white/grey so the
// per-building vertex colour tints them.
const CELL = 256;
function cellOrigin(index) {
  // flipY: row 0 sits in the bottom half of the canvas.
  return [(index % 4) * CELL, (1 - Math.floor(index / 4)) * CELL];
}

function drawAtlas(lit) {
  const c = document.createElement("canvas");
  c.width = CELL * 4;
  c.height = CELL * 2;
  const g = c.getContext("2d");
  g.fillStyle = lit ? "#000" : "#fff";
  g.fillRect(0, 0, c.width, c.height);
  const glassDay = "#51606f",
    frame = "#e9e6df",
    warm = "#ffcf8a",
    cool = "#cfe4ff";
  const rect = (i, x, y, w, h, day, night) => {
    const [ox, oy] = cellOrigin(i);
    g.fillStyle = lit ? night : day;
    g.fillRect(ox + x, oy + y, w, h);
  };
  // 0 apartment: two framed windows per bay with sills.
  for (const x of [34, 146]) {
    rect(0, x - 6, 58, 88, 132, frame, "#000");
    rect(0, x, 64, 76, 116, glassDay, warm);
    rect(0, x - 10, 190, 96, 10, "#c9c4ba", "#000");
  }
  // 1 glass office: curtain wall with mullions and a spandrel band.
  rect(1, 0, 0, 256, 256, "#6f8395", "#000");
  rect(1, 0, 200, 256, 56, "#48545f", "#000");
  for (let x = 0; x < 256; x += 64) {
    rect(1, x + 6, 10, 52, 186, "#7f97ab", Math.random() < 0.5 ? cool : "#000");
    rect(1, x, 0, 6, 256, "#3b4650", "#000");
  }
  // 2 plain / industrial: a single small high window.
  rect(2, 92, 70, 72, 60, glassDay, "#000");
  rect(2, 0, 236, 256, 20, "#d4d0c8", "#000");
  // 3 stone: tall window with a lintel, pilasters.
  rect(3, 0, 0, 256, 256, "#f1ece2", "#000");
  rect(3, 0, 0, 22, 256, "#ddd5c6", "#000");
  rect(3, 234, 0, 22, 256, "#ddd5c6", "#000");
  rect(3, 82, 44, 92, 34, "#d9d0bf", "#000");
  rect(3, 90, 78, 76, 150, "#4d5864", warm);
  // 4 shopfront: large display glass under an awning band.
  rect(4, 0, 0, 256, 256, "#d6d2ca", "#000");
  rect(4, 0, 18, 256, 40, "#8e8a84", "#000");
  rect(4, 14, 70, 228, 176, "#3c4652", "#ffe2b0");
  rect(4, 124, 70, 8, 176, "#d6d2ca", "#000");
  // 5 roof: speckled concrete / gravel.
  {
    const [ox, oy] = cellOrigin(5);
    for (let i = 0; i < 2600; i++) {
      const v = lit ? 0 : 150 + Math.floor(Math.random() * 90);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(ox + Math.random() * CELL, oy + Math.random() * CELL, 3, 3);
    }
    if (!lit) {
      g.strokeStyle = "rgba(90,90,90,0.35)";
      g.lineWidth = 3;
      g.strokeRect(ox + 1, oy + 1, CELL - 2, CELL - 2);
    }
  }
  // 6 apartment with balcony: wide door-window and a railing.
  rect(6, 40, 50, 176, 150, frame, "#000");
  rect(6, 48, 58, 160, 142, glassDay, warm);
  rect(6, 24, 170, 208, 10, "#9a968f", "#000");
  rect(6, 24, 200, 208, 26, "#bdb8af", "#000");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Shared by the city material: samples the atlas cell picked by the per-
// vertex style, tiled with fract() and explicit gradients so mip levels
// don't seam at tile edges. Dark window pixels become glossy glass.
export function createFacadeMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: drawAtlas(false),
    emissiveMap: drawAtlas(true),
    emissive: 0x000000,
    roughness: 0.88,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float style;\nvarying float vStyle;\nvarying vec2 vTile;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvStyle = style;\nvTile = uv;");
    const atlasUv = `
      float st = vStyle;
      // Apartments on main roads get shops on the ground floor.
      if (st < 0.5 && vTile.y < 1.0) st = 4.0;
      vec2 cell = vec2(mod(st, 4.0), floor(st / 4.0));
      vec2 inCell = fract(vTile) * 0.96 + 0.02;
      vec2 atlasUv = (cell + inCell) / vec2(4.0, 2.0);
      vec2 gx = dFdx(vTile) * 0.96 / vec2(4.0, 2.0);
      vec2 gy = dFdy(vTile) * 0.96 / vec2(4.0, 2.0);
    `;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vStyle;\nvarying vec2 vTile;")
      .replace(
        "#include <map_fragment>",
        `float glassMask = 0.0;
        #ifdef USE_MAP
        if (vStyle < 7.5) {
          ${atlasUv}
          vec4 facade = textureGrad(map, atlasUv, gx, gy);
          diffuseColor *= facade;
          float luma = dot(facade.rgb, vec3(0.299, 0.587, 0.114));
          glassMask = st == 5.0 ? 0.0 : smoothstep(0.32, 0.18, luma);
        }
        #endif`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#ifdef USE_EMISSIVEMAP
        if (vStyle < 7.5 && vStyle != 5.0) {
          ${atlasUv}
          // Each window (bay x storey) is independently on or off.
          float h = fract(sin(dot(floor(vTile), vec2(12.9898, 78.233)) + vStyle * 7.13) * 43758.5453);
          totalEmissiveRadiance *= textureGrad(emissiveMap, atlasUv, gx, gy).rgb * step(0.42, h);
        } else {
          totalEmissiveRadiance *= 0.0;
        }
        #endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, glassMask);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.45, glassMask);",
      );
  };
  material.customProgramCacheKey = () => "ankara-facade";
  return material;
}

// ---------------------------------------------------------------- ground
// Two octaves of tiled noise multiplied over the painted land-use texture,
// so the ground stays crisp at low altitude where that texture is ~3 m/px.
function detailTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 110 + Math.random() * 145;
    img.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  // Soft blotches for larger-scale variation.
  for (let i = 0; i < 90; i++) {
    const v = Math.random() < 0.5 ? 60 : 255;
    g.fillStyle = `rgba(${v},${v},${v},0.12)`;
    g.beginPath();
    g.arc(Math.random() * size, Math.random() * size, 10 + Math.random() * 30, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function addGroundDetail(material) {
  const detail = detailTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundXZ;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vGroundXZ;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float fine = texture2D(detailMap, vGroundXZ / 6.0).r;
        float broad = texture2D(detailMap, vGroundXZ / 70.0).r;
        diffuseColor.rgb *= 0.78 + 0.3 * fine * 0.6 + 0.3 * broad * 0.8;`,
      );
  };
  material.customProgramCacheKey = () => "ankara-ground";
}

// ---------------------------------------------------------------- trees
function coloured(geometry, rgb) {
  const g = geometry.toNonIndexed();
  const c = new THREE.Color(rgb);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute("uv");
  return g;
}

function merge(parts) {
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const arr = new Float32Array(count * 3);
    let o = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

function treeGeometries() {
  // Kept deliberately cheap (~30 triangles): there are tens of thousands.
  // Trunks are open-ended since their caps are never visible.
  const trunk = (h) => coloured(new THREE.CylinderGeometry(0.22, 0.34, h, 5, 1, true).translate(0, h / 2, 0), 0x6b4f3a);
  const leafy = merge([
    trunk(3.2),
    coloured(new THREE.IcosahedronGeometry(2.6, 0).scale(1, 0.95, 1).translate(0, 5.2, 0), 0x6f9448),
  ]);
  const pine = merge([trunk(2.2), coloured(new THREE.ConeGeometry(2.3, 7, 7, 1, true).translate(0, 5.3, 0), 0x3f6b3a)]);
  return { leafy, pine };
}

export function buildTrees(group, chunks) {
  const { leafy, pine } = treeGeometries();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, envMapIntensity: 0.35 });
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3(),
    p = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0),
    tint = new THREE.Color();
  let total = 0;
  const treeMeshes = [];
  // [x, y, z, scale, conifer] per tree on a 10 m grid, for walking and the
  // on-foot camera.
  const grid = new Map();
  for (const data of chunks) {
    const n = data.length / 6;
    const counts = [0, 0];
    for (let i = 0; i < n; i++) counts[data[i * 6 + 5]] += 1;
    const meshes = [leafy, pine].map((geo, kind) => {
      if (!counts[kind]) return null;
      const mesh = new THREE.InstancedMesh(geo, material, counts[kind]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.next = 0;
      mesh.userData.noAO = true;
      return mesh;
    });
    for (let i = 0; i < n; i++) {
      const [x, y, z, scale, t, kind] = data.subarray(i * 6, i * 6 + 6);
      const cell = `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
      if (!grid.has(cell)) grid.set(cell, []);
      grid.get(cell).push([x, y - 0.2, z, scale, kind]);
      const mesh = meshes[kind];
      q.setFromAxisAngle(up, t * Math.PI * 2);
      p.set(x, y - 0.2, z);
      s.setScalar(scale);
      m.compose(p, q, s);
      const k = mesh.userData.next++;
      mesh.setMatrixAt(k, m);
      // Subtle, near-white tint on top of the vertex colours, so crowns vary
      // without turning the trunks green.
      tint.setHSL(0.22 + (t - 0.5) * 0.1, 0.25, 0.78 + t * 0.18);
      mesh.setColorAt(k, tint);
    }
    for (const mesh of meshes) {
      if (!mesh) continue;
      mesh.computeBoundingSphere();
      group.add(mesh);
      treeMeshes.push(mesh);
      total += mesh.count;
    }
  }
  return { total, meshes: treeMeshes, grid };
}

// Tree chunks beyond viewDistance are hidden: they sit deep in the fog
// anyway, and trees are most of the triangle budget.
export function cullTrees(meshes, cameraPos, viewDistance = 650) {
  for (const m of meshes) {
    const s = m.boundingSphere;
    m.visible = s.center.distanceTo(cameraPos) - s.radius < viewDistance;
  }
}

// ---------------------------------------------------------------- traffic
// Cars follow the densified OSM centrelines, keeping right on two-way
// roads. Each car model sub-mesh is one InstancedMesh.
export class Traffic {
  constructor(group, paths, templates, count) {
    this.paths = paths.map((p) => {
      const n = p.path.length / 3;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++)
        cum[i] = cum[i - 1] + Math.hypot(p.path[i * 3] - p.path[i * 3 - 3], p.path[i * 3 + 2] - p.path[i * 3 - 1]);
      return { ...p, cum, length: cum[n - 1] };
    });
    this.paths = this.paths.filter((p) => p.length > 60);
    this.totalLength = this.paths.reduce((a, p) => a + p.length, 0);
    this.cars = [];
    this.models = templates.map((tpl) => {
      tpl.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(tpl).getSize(new THREE.Vector3());
      const meshes = [];
      const perModel = Math.ceil(count / templates.length);
      tpl.traverse((o) => {
        if (!o.isMesh) return;
        const mesh = new THREE.InstancedMesh(o.geometry, o.material, perModel);
        // The shadow map is cached while the player stays in one area, so
        // moving cars would leave frozen shadows behind: they cast none.
        mesh.castShadow = false;
        mesh.userData.noAO = true;
        mesh.frustumCulled = false;
        // Real cars are ~4.5 m long; the templates are normalised to 6 m.
        const k = 4.5 / Math.max(size.x, size.z);
        // Templates are centred on their bounding box: lift by half the
        // height so the wheels sit on the road instead of in it.
        mesh.userData.local = new THREE.Matrix4()
          .makeTranslation(0, (size.y * k) / 2, 0)
          .multiply(new THREE.Matrix4().makeScale(k, k, k))
          .multiply(o.matrixWorld);
        group.add(mesh);
        meshes.push(mesh);
      });
      return { meshes, count: perModel };
    });
    for (let m = 0; m < this.models.length; m++)
      for (let i = 0; i < this.models[m].count; i++) this.cars.push(this.spawn({ model: m, slot: i }));
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.tmp = new THREE.Matrix4();
  }

  // Busier (longer) roads get proportionally more cars.
  spawn(car) {
    let r = Math.random() * this.totalLength;
    let path = this.paths[0];
    for (const p of this.paths) {
      if (r < p.length) {
        path = p;
        break;
      }
      r -= p.length;
    }
    car.path = path;
    car.dir = path.oneway || Math.random() < 0.5 ? 1 : -1;
    car.s = Math.random() * path.length;
    car.seg = 0;
    car.speed = 9 + Math.random() * 7;
    car.lane = path.oneway ? (Math.random() - 0.5) * path.halfWidth : path.halfWidth * 0.45;
    return car;
  }

  update(dt) {
    const { m, q, p, one, up } = this;
    for (const car of this.cars) {
      car.s += car.speed * dt * car.dir;
      const path = car.path;
      if (car.s < 0 || car.s > path.length) this.spawn(car);
      // Walk to the segment containing s (cars move a little per frame).
      const cum = car.path.cum;
      let i = Math.min(car.seg, cum.length - 2);
      while (i < cum.length - 2 && cum[i + 1] < car.s) i++;
      while (i > 0 && cum[i] > car.s) i--;
      car.seg = i;
      const P = car.path.path;
      const t = (car.s - cum[i]) / (cum[i + 1] - cum[i] || 1);
      const dx = P[i * 3 + 3] - P[i * 3],
        dz = P[i * 3 + 5] - P[i * 3 + 2];
      const len = Math.hypot(dx, dz) || 1;
      // Keep right: (-z, x) of the travel direction points to its right.
      const rx = (-dz / len) * car.dir,
        rz = (dx / len) * car.dir;
      p.set(
        P[i * 3] + dx * t + rx * car.lane,
        P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * t,
        P[i * 3 + 2] + dz * t + rz * car.lane,
      );
      // The car models face +z (headlights); turn +z onto the travel direction.
      q.setFromAxisAngle(up, Math.atan2(dx * car.dir, dz * car.dir));
      m.compose(p, q, one);
      for (const mesh of this.models[car.model].meshes)
        mesh.setMatrixAt(car.slot, this.tmp.multiplyMatrices(m, mesh.userData.local));
    }
    for (const model of this.models) for (const mesh of model.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- birds
// Small flocks circling the landmarks; wings flap in the vertex shader.
export class Birds {
  constructor(group, anchors, groundAt) {
    const geo = new THREE.BufferGeometry();
    // Body plus two wing triangles; |x| drives the flap.
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, -0.6, 0.12, 0, 0.5, -0.12, 0, 0.5, 0, 0, -0.2, 1.1, 0, 0.15, 0, 0, 0.35, 0, 0, -0.2, 0, 0, 0.35, -1.1, 0, 0.15],
        3,
      ),
    );
    geo.computeVertexNormals();
    this.time = { value: 0 };
    const material = new THREE.MeshBasicMaterial({ color: 0x2b2b30, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.flapTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float flapTime;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed.y += abs(position.x) * 0.8 * sin(flapTime * 11.0 + float(gl_InstanceID) * 1.7);",
        );
    };
    material.customProgramCacheKey = () => "ankara-birds";
    this.flocks = anchors.slice(0, 5).map((a, i) => ({
      x: a.x,
      z: a.z,
      y: groundAt(a.x, a.z) + 95 + i * 12,
      radius: 140 + i * 30,
      speed: (0.12 + i * 0.02) * (i % 2 ? 1 : -1),
      phase: i,
    }));
    this.perFlock = 9;
    this.mesh = new THREE.InstancedMesh(geo, material, this.flocks.length * this.perFlock);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noAO = true;
    this.mesh.scale.setScalar(1.6);
    this.offsets = Array.from({ length: this.mesh.count }, () => [
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 14,
    ]);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.one = new THREE.Vector3(1, 1, 1);
    group.add(this.mesh);
  }

  update(time) {
    this.time.value = time;
    const { m, q, p } = this;
    const scale = 1 / this.mesh.scale.x;
    this.flocks.forEach((f, fi) => {
      const a = time * f.speed + f.phase;
      // Birds face -z; point them along the circle's tangent.
      const sgn = Math.sign(f.speed);
      const heading = Math.atan2(Math.sin(a) * sgn, -Math.cos(a) * sgn);
      for (let k = 0; k < this.perFlock; k++) {
        const i = fi * this.perFlock + k;
        const o = this.offsets[i];
        p.set(
          (f.x + Math.cos(a) * f.radius + o[0]) * scale,
          (f.y + Math.sin(time * 0.7 + k) * 2 + o[1]) * scale,
          (f.z + Math.sin(a) * f.radius + o[2]) * scale,
        );
        q.setFromAxisAngle(this.up, heading);
        m.compose(p, q, this.one);
        this.mesh.setMatrixAt(i, m);
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
