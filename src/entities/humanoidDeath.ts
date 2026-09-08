/** Shared humanoid death pose. Same numbers as the zombie/mob death animation. */

export const HUMANOID_DEATH_ANIMATION_SECONDS = 0.7;

export function humanoidDeathProgress(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(1, seconds / HUMANOID_DEATH_ANIMATION_SECONDS);
}

export function humanoidDeathRotationZ(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * Math.PI * 0.5;
}

export function humanoidDeathScale(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - clamped * 0.25;
}
