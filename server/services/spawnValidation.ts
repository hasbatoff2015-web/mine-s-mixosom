import { volumeContains, type SelectionVolume } from './selection';

export interface SpawnValidationContext {
  readonly storeReads: number;
  readonly claimVolumes: readonly SelectionVolume[];
  readonly autoMineVolumes: readonly SelectionVolume[];
  readonly specialVolumes: readonly SelectionVolume[];
  homes: readonly { readonly x: number; readonly z: number }[];
  players: readonly { readonly x: number; readonly y: number; readonly z: number }[];
}

export function emptyValidationContext(
  extra: Partial<SpawnValidationContext> = {},
): SpawnValidationContext {
  return {
    storeReads: extra.storeReads ?? 0,
    claimVolumes: extra.claimVolumes ?? [],
    autoMineVolumes: extra.autoMineVolumes ?? [],
    specialVolumes: extra.specialVolumes ?? [],
    homes: extra.homes ?? [],
    players: extra.players ?? [],
  };
}

export function reservedAt(context: SpawnValidationContext, x: number, y: number, z: number): boolean {
  for (const volume of context.claimVolumes) {
    if (volumeContains(volume, x, y, z)) return true;
  }
  for (const volume of context.autoMineVolumes) {
    if (volumeContains(volume, x, y, z)) return true;
  }
  for (const volume of context.specialVolumes) {
    if (volumeContains(volume, x, y, z)) return true;
  }
  return false;
}
