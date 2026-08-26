export type GameMode = 'survival' | 'creative';

export interface WorldSummary {
  id: string;
  name: string;
  seed: string;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  playTimeSeconds: number;
}

export interface SerializedPlayerState {
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  selectedSlot: number;
  spawnPoint?: [number, number, number];
  inventory: unknown;
}

export interface SerializedWorldState {
  schemaVersion: 1;
  summary: WorldSummary;
  timeOfDay: number;
  weather: 'clear';
  player: SerializedPlayerState;
  modifications: Record<string, Record<string, number>>;
  chests: Record<string, unknown>;
  furnaces: Record<string, unknown>;
  droppedItems: unknown[];
  mobs?: unknown[];
  redstone?: unknown;
  blockStates?: Record<string, unknown>;
  minecarts?: unknown[];
  fallingBlocks?: unknown[];
}
