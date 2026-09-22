export const BASE_FOV = 62;
export const BASE_SPEED = 26;
export const MAX_SPEED = 60;
export const LANE_WIDTH = 16;
export const TREE_SPAN = 900;
export const DRAGON_COLLIDER = { x: 1.3, y: 1.1, z: 2 };
export const OBSTACLE_PATTERNS = [
  [{ lane: -2 }, { lane: 2 }],
  [{ lane: -2 }, { lane: 2 }, { lane: 0, offset: -26 }],
  [{ lane: -2 }, { lane: -1 }, { lane: 1 }, { lane: 2 }],
  [{ lane: -1 }, { lane: 0 }, { lane: 1 }],
];
