export const TICK_RATE = 20;
export const FIXED_DT = 1 / TICK_RATE;
export const MAX_FRAME_DELTA = 0.25;
/** Drop excess accumulated time after this many catch-up ticks so a hitch cannot spiral. */
export const MAX_CATCH_UP_TICKS = 4;
export const TARGET_FRAME_MS = 1000 / 60;
export const WORLD_JOB_BUDGET_MS = 4;
export const WORLD_LOADING_JOB_BUDGET_MS = 10;
/** Dedicated lighting slice while PLAYING. Must never wrap a 30 ms job. */
export const WORLD_LIGHT_BUDGET_MS = 2;
/** Loading screen can spend more; the overlay still animates between slices. */
export const WORLD_LOADING_LIGHT_BUDGET_MS = 8;
/** Bounded fluid simulation slice. Must stay well below the mesh/light budgets. */
export const FLUID_JOB_BUDGET_MS = 1.5;
/** Extra generated+lit ring so visible chunks mesh with neighbor light context. */
export const LIGHTING_HALO_CHUNKS = 1;
/** Visual interpolation snap: teleport/spawn/corrections larger than this skip lerp. */
export const ENTITY_SNAP_DISTANCE = 6;

export const CHUNK_SIZE = 16;
/**
 * Vertical world size in blocks (Y in `0 .. WORLD_HEIGHT-1`).
 * Raised 96 → 256 so imported structures can occupy build space up to Y=255.
 * Procedural terrain does **not** scale with this bound; see MAX_GENERATED_SURFACE.
 * Indexing is `y * 16 * 16 + z * 16 + x` and does not embed WORLD_HEIGHT, so old
 * modification deltas remain valid.
 */
export const MIN_WORLD_Y = 0;
export const WORLD_HEIGHT = 256;
export const MAX_WORLD_Y = WORLD_HEIGHT - 1;
/** Still ~1 block below typical plains, shifted +15 with the terrain stack. */
export const SEA_LEVEL = 63;
/**
 * Historical generated-mountain headroom vs the old 96-high world.
 * Not `WORLD_HEIGHT - 12` — generated peaks stay pinned so empty sky is cheap.
 */
export const TERRAIN_HEADROOM = 12;
/** Inclusive generated surface cap. Ordinary terrain stays around Y 58–84. */
export const MAX_GENERATED_SURFACE = 84;
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
export const CREATIVE_FLY_SPEED = 10.9;
export const CREATIVE_SPRINT_FLY_SPEED = 21.6;
export const CREATIVE_VERTICAL_SPEED = 7.5;
export const CREATIVE_FLY_DOUBLE_TAP_TICKS = 7;

export const DAY_TICKS = 24_000;
export const AUTOSAVE_INTERVAL_SECONDS = 30;

export const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor);
export const positiveMod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;
export const chunkKey = (x: number, z: number): string => `${x},${z}`;
export const blockKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export function parseBlockKey(key: string): { x: number; y: number; z: number } {
  const [x = 0, y = 0, z = 0] = key.split(',').map(Number);
  return { x, y, z };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Inclusive block Y in `0 .. 255`. Y=256 and Y&lt;0 are invalid. */
export function isValidWorldY(y: number): boolean {
  return Number.isInteger(y) && y >= MIN_WORLD_Y && y <= MAX_WORLD_Y;
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}
