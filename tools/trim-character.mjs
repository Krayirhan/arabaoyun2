// Shrinks a character .glb for the game: keeps only the listed animations,
// drops the meshes of the listed nodes (props such as weapons) and repacks
// the binary buffer without the data nothing references any more.
//   node tools/trim-character.mjs in.glb out.glb
import { readFileSync, writeFileSync } from "node:fs";

const KEEP_ANIMATIONS = [
  "Idle",
  "Walking_A",
  "Walking_Backwards",
  "Running_A",
  "Jump_Start",
  "Jump_Idle",
  "Jump_Land",
  "Cheer",
  "Interact",
];
const DROP_NODES = ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Knife", "Throwable"];

const [input, output] = process.argv.slice(2);
if (!output) {
  console.error("usage: node tools/trim-character.mjs <in.glb> <out.glb>");
  process.exit(1);
}
const glb = readFileSync(input);
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
const binStart = 20 + jsonLength + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLength));

json.animations = (json.animations || []).filter((a) => KEEP_ANIMATIONS.includes(a.name));
for (const node of json.nodes) if (DROP_NODES.includes(node.name)) delete node.mesh;

// Meshes still used by a node, renumbered.
const meshMap = new Map();
const meshes = [];
for (const node of json.nodes) {
  if (node.mesh === undefined) continue;
  if (!meshMap.has(node.mesh)) {
    meshMap.set(node.mesh, meshes.length);
    meshes.push(json.meshes[node.mesh]);
  }
  node.mesh = meshMap.get(node.mesh);
}
json.meshes = meshes;

// Every accessor still referenced, renumbered in first-use order.
const accessorMap = new Map();
const use = (i) => {
  if (i === undefined) return i;
  if (!accessorMap.has(i)) accessorMap.set(i, accessorMap.size);
  return accessorMap.get(i);
};
for (const mesh of json.meshes)
  for (const prim of mesh.primitives) {
    for (const k of Object.keys(prim.attributes)) prim.attributes[k] = use(prim.attributes[k]);
    if (prim.indices !== undefined) prim.indices = use(prim.indices);
    for (const target of prim.targets || []) for (const k of Object.keys(target)) target[k] = use(target[k]);
  }
for (const skin of json.skins || []) skin.inverseBindMatrices = use(skin.inverseBindMatrices);
for (const anim of json.animations)
  for (const s of anim.samplers) {
    s.input = use(s.input);
    s.output = use(s.output);
  }

// Rebuild buffer views: one per kept accessor plus any embedded images.
const chunks = [];
let offset = 0;
const bufferViews = [];
const copyView = (view) => {
  const data = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  const out = { ...view, buffer: 0, byteOffset: offset };
  chunks.push(data);
  offset += data.length;
  bufferViews.push(out);
  return bufferViews.length - 1;
};
const viewMap = new Map();
const accessors = [];
for (const [oldIndex] of [...accessorMap.entries()].sort((a, b) => a[1] - b[1])) {
  const acc = { ...json.accessors[oldIndex] };
  if (acc.bufferView !== undefined) {
    if (!viewMap.has(acc.bufferView)) viewMap.set(acc.bufferView, copyView(json.bufferViews[acc.bufferView]));
    acc.bufferView = viewMap.get(acc.bufferView);
  }
  accessors.push(acc);
}
for (const image of json.images || [])
  if (image.bufferView !== undefined) {
    if (!viewMap.has(image.bufferView)) viewMap.set(image.bufferView, copyView(json.bufferViews[image.bufferView]));
    image.bufferView = viewMap.get(image.bufferView);
  }
json.accessors = accessors;
json.bufferViews = bufferViews;
const binOut = Buffer.concat([...chunks, Buffer.alloc((4 - (offset % 4)) % 4)]);
json.buffers = [{ byteLength: binOut.length }];

let jsonOut = Buffer.from(JSON.stringify(json), "utf8");
jsonOut = Buffer.concat([jsonOut, Buffer.alloc((4 - (jsonOut.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonOut.length + 8 + binOut.length, 8);
const chunk = (type, data) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
};
writeFileSync(output, Buffer.concat([header, chunk(0x4e4f534a, jsonOut), chunk(0x004e4942, binOut)]));
console.log(
  `${input}: ${(glb.length / 1024).toFixed(0)} KB -> ${output}: ${((12 + 16 + jsonOut.length + binOut.length) / 1024).toFixed(0)} KB, ` +
    `animations: ${json.animations.map((a) => a.name).join(", ")}`,
);
