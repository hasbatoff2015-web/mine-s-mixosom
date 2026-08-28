import type { AudioListenerPose, AudioVec3, SoundEventProfile } from './soundEvents';

export const GLOBAL_MAX_SOURCES = 20;

export function distanceSquared(a: AudioVec3, b: AudioVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distanceBetween(a: AudioVec3, b: AudioVec3): number {
  return Math.sqrt(distanceSquared(a, b));
}

/** Linear rolloff used for skip tests and documentation; PannerNode also applies WebAudio attenuation. */
export function linearAttenuation(
  distance: number,
  refDistance: number,
  maxDistance: number,
): number {
  if (!(distance >= 0) || maxDistance <= 0) return 0;
  if (distance <= refDistance) return 1;
  if (distance >= maxDistance) return 0;
  return (maxDistance - distance) / (maxDistance - refDistance);
}

export function shouldSkipDistant(
  distance: number,
  maxDistance: number,
): boolean {
  return !(distance >= 0) || distance > maxDistance;
}

export function chooseVariantIndex(count: number, random: () => number): number {
  if (count <= 1) return 0;
  const value = random();
  const index = Math.floor((Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999) : 0) * count);
  return Math.min(count - 1, Math.max(0, index));
}

export function samplePitch(profile: Pick<SoundEventProfile, 'pitchMin' | 'pitchMax'>, random: () => number): number {
  const min = profile.pitchMin;
  const max = profile.pitchMax;
  if (!(max > min)) return min;
  const t = random();
  const unit = Number.isFinite(t) ? Math.min(Math.max(t, 0), 1) : 0.5;
  return min + (max - min) * unit;
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Equal-power pan −1..1 from a world delta and listener yaw (0 = looking −Z / south in this game). */
export function stereoPan(source: AudioVec3, listener: AudioListenerPose): number {
  const dx = source.x - listener.x;
  const dz = source.z - listener.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-5) return 0;
  const yaw = listener.yaw ?? 0;
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  void forwardX;
  void forwardZ;
  const right = (dx * rightX + dz * rightZ) / length;
  return Math.min(1, Math.max(-1, right));
}

export function canStartVoice(args: {
  globalActive: number;
  busActive: number;
  busLimit: number;
  globalLimit?: number;
  priority: number;
  lowestActivePriority: number;
}): { play: boolean; steal: boolean } {
  const globalLimit = args.globalLimit ?? GLOBAL_MAX_SOURCES;
  if (args.busActive >= args.busLimit) {
    if (args.priority >= 10 && args.busActive > 0) return { play: true, steal: true };
    return { play: false, steal: false };
  }
  if (args.globalActive >= globalLimit) {
    if (args.priority > args.lowestActivePriority) return { play: true, steal: true };
    return { play: false, steal: false };
  }
  return { play: true, steal: false };
}
