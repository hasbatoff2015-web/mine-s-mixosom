import { distanceSquared } from './audioMath';
import type { AudioVec3 } from './soundEvents';

export const EXPLOSION_DEDUPE_RADIUS = 1.5;
export const EXPLOSION_DEDUPE_TICKS = 2;
export const MAX_EXPLOSIONS_PER_TICK = 2;

export interface ExplosionRecord {
  x: number;
  y: number;
  z: number;
  tick: number;
}

export interface ExplosionLog {
  recent: ExplosionRecord[];
  playedThisTick: number;
  tick: number;
}

export function createExplosionLog(): ExplosionLog {
  return { recent: [], playedThisTick: 0, tick: -1 };
}

export function shouldPlayExplosion(
  log: ExplosionLog,
  position: AudioVec3,
  tick: number,
): boolean {
  if (log.tick !== tick) {
    log.tick = tick;
    log.playedThisTick = 0;
    const minTick = tick - EXPLOSION_DEDUPE_TICKS;
    log.recent = log.recent.filter((entry) => entry.tick >= minTick);
  }
  if (log.playedThisTick >= MAX_EXPLOSIONS_PER_TICK) return false;
  const radiusSq = EXPLOSION_DEDUPE_RADIUS * EXPLOSION_DEDUPE_RADIUS;
  for (const entry of log.recent) {
    if (distanceSquared(entry, position) <= radiusSq) return false;
  }
  log.recent.push({ x: position.x, y: position.y, z: position.z, tick });
  log.playedThisTick += 1;
  return true;
}
