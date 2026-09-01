import type { GameMode } from '../../shared/protocol';
import { SEA_LEVEL } from '../core/constants';
import { collectSpawnColumns } from './Generator';
import type { VoxelWorld } from './World';

export function estimateWorldSpawn(world: VoxelWorld): [number, number, number] {
  const best = collectSpawnColumns(world.generator)[0];
  if (best) return [best.x + 0.5, best.height + 1.01, best.z + 0.5];
  const fallback = world.generator.columnAt(0, 0);
  return [0.5, Math.max(SEA_LEVEL + 2, fallback.height + 2), 0.5];
}

export function isGameMode(value: unknown): value is GameMode {
  return value === 'survival' || value === 'creative';
}
