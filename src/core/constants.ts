export const TICK_RATE = 20;
export const FIXED_DT = 1 / TICK_RATE;
export const MAX_FRAME_DELTA = 0.25;

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 80;
export const SEA_LEVEL = 48;
export const DEFAULT_RENDER_DISTANCE_DESKTOP = 4;
export const DEFAULT_RENDER_DISTANCE_MOBILE = 2;

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_SNEAK_HEIGHT = 1.5;
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_SNEAK_EYE_HEIGHT = 1.27;
export const PLAYER_REACH = 5;

export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = 5.612;
export const SNEAK_SPEED = 1.295;
export const WATER_SPEED = 2.2;
export const GRAVITY = 32;
export const WATER_GRAVITY = 5;
export const JUMP_VELOCITY = 8.4;
export const TERMINAL_VELOCITY = 50;

export const DAY_TICKS = 24_000;
export const AUTOSAVE_INTERVAL_SECONDS = 30;

export const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor);
export const positiveMod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;
export const chunkKey = (x: number, z: number): string => `${x},${z}`;
export const blockKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}
