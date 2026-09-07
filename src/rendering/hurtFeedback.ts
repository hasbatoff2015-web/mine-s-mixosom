import type { PerspectiveCamera } from 'three';
import type { DamageSource } from '../survival';

export const HURT_FLASH_DURATION_MS = 220;
export const HURT_FLASH_PEAK_ALPHA = 0.28;

/** Linear 0→1 decay over the flash window. HUD multiplies this by peak alpha. */
export function hurtFlashEnvelope(elapsedMs: number, durationMs = HURT_FLASH_DURATION_MS): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= durationMs) return 0;
  return 1 - elapsedMs / durationMs;
}

/** Screen overlay alpha. Dim on purpose so the HUD does not wash out the world. */
export function hurtFlashAlpha(elapsedMs: number, durationMs = HURT_FLASH_DURATION_MS): number {
  return HURT_FLASH_PEAK_ALPHA * hurtFlashEnvelope(elapsedMs, durationMs);
}

/** Peak 1.0 envelope for PlayerVisual tint (same duration as the HUD flash). */
export function playerHurtFlashIntensity(elapsedMs: number, durationMs = HURT_FLASH_DURATION_MS): number {
  return hurtFlashEnvelope(elapsedMs, durationMs);
}

export const HURT_KICK_DURATION_MS = 180;
export const HURT_KICK_DEGREES = 2.1;
export const HURT_KICK_DOT_SCALE = 0.42;
export const HURT_KICK_MAX_DEGREES = 3;

const PERIODIC_SOURCES: ReadonlySet<DamageSource> = new Set([
  'fire', 'lava', 'drowning', 'starvation', 'cactus',
]);

export function isPeriodicDamageSource(source: DamageSource): boolean {
  return PERIODIC_SOURCES.has(source);
}

/** Client-only red flash + camera roll. Does not mutate player yaw/pitch. */
export class HurtFeedback {
  private flashStartMs = 0;
  private flashUntilMs = 0;
  private kickStartMs = 0;
  private kickUntilMs = 0;
  private kickSign = 1;
  private kickScale = 1;

  trigger(nowMs: number, options: { readonly periodic?: boolean } = {}): void {
    this.flashStartMs = nowMs;
    this.flashUntilMs = nowMs + HURT_FLASH_DURATION_MS;
    this.kickStartMs = nowMs;
    this.kickUntilMs = nowMs + HURT_KICK_DURATION_MS;
    this.kickSign *= -1;
    this.kickScale = options.periodic ? HURT_KICK_DOT_SCALE : 1;
  }

  flashAlpha(nowMs: number): number {
    if (nowMs >= this.flashUntilMs) return 0;
    return hurtFlashAlpha(nowMs - this.flashStartMs);
  }

  /** Model tint intensity 0–1. HUD overlay stays on flashAlpha. */
  modelIntensity(nowMs: number): number {
    if (nowMs >= this.flashUntilMs) return 0;
    return playerHurtFlashIntensity(nowMs - this.flashStartMs);
  }

  cameraRoll(nowMs: number): number {
    if (nowMs <= this.kickStartMs || nowMs >= this.kickUntilMs) return 0;
    const t = (nowMs - this.kickStartMs) / HURT_KICK_DURATION_MS;
    const envelope = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
    const degrees = Math.min(HURT_KICK_MAX_DEGREES, HURT_KICK_DEGREES * this.kickScale);
    return (this.kickSign * degrees * envelope * Math.PI) / 180;
  }

  applyToCamera(camera: Pick<PerspectiveCamera, 'rotation'>, nowMs: number): void {
    camera.rotation.z = this.cameraRoll(nowMs);
  }
}
