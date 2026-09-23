export const BASE_FOV = 62;
export const BASE_SPEED = 26;
export const MAX_SPEED = 60;
export const LANE_WIDTH = 16;
export const TREE_SPAN = 900;
export const DRAGON_COLLIDER = { x: 1.3, y: 1.1, z: 2 };
// Dragon flight envelope in the endless city. Low blocks top out around 9, so
// flying high clears them; towers are always taller than MAX_Y.
export const DRAGON_MIN_Y = 1;
export const DRAGON_MAX_Y = 24;
export const DRAGON_MAX_X = 36;
// kind: "low" can be flown over, "tall" cannot, "mid" only near the ceiling.
// A kind left out is picked at random per building.
export const OBSTACLE_PATTERNS = [
  [{ lane: -2 }, { lane: 2 }],
  [{ lane: -2 }, { lane: 2 }, { lane: 0, offset: -26 }],
  [{ lane: -2 }, { lane: -1 }, { lane: 1 }, { lane: 2 }],
  [{ lane: -1 }, { lane: 0 }, { lane: 1 }],
  [
    { lane: -2, kind: "tall" },
    { lane: -1, kind: "low" },
    { lane: 0, kind: "tall" },
    { lane: 1, kind: "low" },
    { lane: 2, kind: "tall" },
  ],
  [
    { lane: -2, kind: "low" },
    { lane: -1, kind: "low" },
    { lane: 0, kind: "low" },
    { lane: 1, kind: "low" },
    { lane: 2, kind: "low" },
  ],
  [{ lane: -1, kind: "tall" }, { lane: 0, kind: "low" }, { lane: 1, kind: "tall" }],
];
// Biomes cycle every BIOME_LENGTH metres of flight.
export const BIOME_LENGTH = 1500;
export const BIOMES = [
  {
    name: "ŞEHİR",
    fog: 0x79a9bf,
    ground: 0x4f5f49,
    sky: 0xbfdfff,
    skyGround: 0x2c3454,
    sun: 0xffd09e,
    obstacles: "city",
  },
  {
    name: "ORMAN",
    fog: 0x8fb59a,
    ground: 0x3d6a34,
    sky: 0xd9f2d0,
    skyGround: 0x2f4a2a,
    sun: 0xfff1c9,
    obstacles: "forest",
  },
  {
    name: "GÜN BATIMI",
    fog: 0xe3a27c,
    ground: 0x6b5845,
    sky: 0xffc9a0,
    skyGround: 0x4a2f3a,
    sun: 0xff9a5a,
    obstacles: "city",
  },
];
export const FIRE_COOLDOWN = 6;
export const FIRE_RANGE = 95;
export const BOOST_DURATION = 2.5;
export const BOOST_COOLDOWN = 9;
export const BOOST_FACTOR = 1.6;
export const ANKARA_SPEED = 38;
