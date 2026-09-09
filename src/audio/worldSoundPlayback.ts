import { getSoundProfile } from './soundCatalog';
import type { PlaySoundOptions, SoundEventId } from './soundEvents';

/**
 * Catalog `positional: false` is for local SP one-shots (`playLocal`).
 * Server `world_sound` always has a world position and must not bypass distance.
 */
export function worldSoundPlayOptions(extra?: PlaySoundOptions): PlaySoundOptions {
  return { ...extra, positional: true };
}

export function worldSoundMaxDistance(event: string): number {
  const profile = getSoundProfile(event as SoundEventId);
  return profile?.maxDistance ?? 48;
}

export function listenerHearsWorldSound(
  listener: { readonly x: number; readonly y: number; readonly z: number },
  sound: { readonly x: number; readonly y: number; readonly z: number },
  maxDistance: number,
): boolean {
  if (!(maxDistance >= 0)) return false;
  const dx = listener.x - sound.x;
  const dy = listener.y - sound.y;
  const dz = listener.z - sound.z;
  return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
}
