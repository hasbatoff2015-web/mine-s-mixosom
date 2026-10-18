import {
  emoteDurationSeconds,
  type EmoteId,
} from '../../../shared/emotes';

/** Extra world-up on the existing third-person ray so the emote camera sits slightly above the eye line. */
export const EMOTE_CAMERA_LIFT = 0.22;
/** Seed distance when leaving first person. The existing smoother opens the rest of the way. */
export const EMOTE_CAMERA_ENTER_DISTANCE = 0.55;
export const EMOTE_CAMERA_RETURN_SECONDS = 0.16;

export interface EmotePose {
  bodyPitch: number;
  bodyYawOffset: number;
  bodyYOffset: number;
  rightArmX: number;
  rightArmY: number;
  rightArmZ: number;
  leftArmX: number;
  leftArmY: number;
  leftArmZ: number;
}

export function createEmotePose(): EmotePose {
  return {
    bodyPitch: 0,
    bodyYawOffset: 0,
    bodyYOffset: 0,
    rightArmX: 0,
    rightArmY: 0,
    rightArmZ: 0,
    leftArmX: 0,
    leftArmY: 0,
    leftArmZ: 0,
  };
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** 0 at the start and end so every channel returns to the idle pose. */
function envelope(time: number, duration: number, fadeIn: number, fadeOut: number): number {
  if (time <= 0 || time >= duration) return 0;
  const enter = smoothstep(time / fadeIn);
  const leave = smoothstep((duration - time) / fadeOut);
  return Math.min(enter, leave);
}

function writeIdle(out: EmotePose): EmotePose {
  out.bodyPitch = 0;
  out.bodyYawOffset = 0;
  out.bodyYOffset = 0;
  out.rightArmX = 0;
  out.rightArmY = 0;
  out.rightArmZ = 0;
  out.leftArmX = 0;
  out.leftArmY = 0;
  out.leftArmZ = 0;
  return out;
}

/**
 * Procedural pose for the existing arm and torso pivots.
 * +X on an arm reaches forward. Negative torso pitch leans forward.
 * Right-arm −Z and left-arm +Z swing outward.
 */
export function writeEmotePose(id: EmoteId, timeSeconds: number, out: EmotePose): EmotePose {
  const duration = emoteDurationSeconds(id);
  const time = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  if (time <= 0 || time >= duration) return writeIdle(out);
  if (id === 'wave') {
    const amount = envelope(time, duration, 0.22, 0.34);
    const wave = Math.sin(time * Math.PI * 4.4);
    out.rightArmX = 2.55 * amount;
    out.rightArmY = wave * 0.18 * amount;
    out.rightArmZ = wave * 0.5 * amount;
    out.leftArmX = 0.08 * amount;
    out.leftArmY = 0;
    out.leftArmZ = -0.04 * amount;
    out.bodyPitch = Math.sin(time * 3.2) * 0.05 * amount;
    out.bodyYawOffset = wave * 0.1 * amount;
    out.bodyYOffset = 0;
    return out;
  }
  if (id === 'celebrate') {
    const amount = envelope(time, duration, 0.16, 0.32);
    const bounce = Math.sin(time * Math.PI * 5);
    const pulse = 0.5 + 0.5 * Math.sin(time * 11);
    out.rightArmX = (2.25 + pulse * 0.16) * amount;
    out.leftArmX = (2.25 + pulse * 0.16) * amount;
    out.rightArmY = bounce * 0.08 * amount;
    out.leftArmY = -bounce * 0.08 * amount;
    out.rightArmZ = (-0.5 - pulse * 0.12) * amount;
    out.leftArmZ = (0.5 + pulse * 0.12) * amount;
    out.bodyPitch = (-0.06 + bounce * 0.05) * amount;
    out.bodyYawOffset = Math.sin(time * 6) * 0.06 * amount;
    out.bodyYOffset = Math.max(0, bounce) * 0.055 * amount;
    return out;
  }
  if (id === 'point') {
    const amount = envelope(time, duration, 0.2, 0.32);
    out.rightArmX = (Math.PI / 2) * amount;
    out.rightArmY = -0.12 * amount;
    out.rightArmZ = -0.08 * amount;
    out.leftArmX = 0.04 * amount;
    out.leftArmY = 0;
    out.leftArmZ = 0.06 * amount;
    out.bodyPitch = 0.05 * amount;
    out.bodyYawOffset = -0.16 * amount;
    out.bodyYOffset = 0;
    return out;
  }
  const amount = envelope(time, duration, 0.22, 0.36);
  out.rightArmX = -0.42 * amount;
  out.leftArmX = -0.42 * amount;
  out.rightArmY = 0.08 * amount;
  out.leftArmY = -0.08 * amount;
  out.rightArmZ = -0.22 * amount;
  out.leftArmZ = 0.22 * amount;
  out.bodyPitch = -0.72 * amount;
  out.bodyYawOffset = 0;
  out.bodyYOffset = -0.02 * amount;
  return out;
}

export function emotePoseAtRest(id: EmoteId, timeSeconds: number): boolean {
  const pose = writeEmotePose(id, timeSeconds, createEmotePose());
  return pose.bodyPitch === 0
    && pose.bodyYawOffset === 0
    && pose.bodyYOffset === 0
    && pose.rightArmX === 0
    && pose.rightArmY === 0
    && pose.rightArmZ === 0
    && pose.leftArmX === 0
    && pose.leftArmY === 0
    && pose.leftArmZ === 0;
}
