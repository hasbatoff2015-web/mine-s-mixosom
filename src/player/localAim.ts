import { Vec3, type Vec3Like } from '../math/vec3';

/** Live look source. Matches first-person `applyImmediateRenderLook(input)`. */
export interface AimLook {
  readonly yaw: number;
  readonly pitch: number;
}

export interface AimEyeHost {
  eyePosition(target?: Vec3): Vec3;
}

export interface LocalAim {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly yaw: number;
  readonly pitch: number;
}

export interface LocalAimHudInfo {
  readonly cameraYaw: number;
  readonly cameraPitch: number;
  readonly playerYaw: number;
  readonly playerPitch: number;
  readonly aimYaw: number;
  readonly aimPitch: number;
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
  readonly normalX?: number;
  readonly normalY?: number;
  readonly normalZ?: number;
}

const BOW_MUZZLE = 0.35;

function queryFlag(name: string, search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const value = params.get(name);
  return value === '1' || value === 'true';
}

export function isAimDiagQueryEnabled(search = '', dev = false): boolean {
  if (!dev) return false;
  return queryFlag('aimDiag', search) || queryFlag('aimdiag', search);
}

/** Same basis as `PlayerController.viewDirection` / first-person camera YXZ look. */
export function viewDirectionFromLook(yaw: number, pitch: number, target = new Vec3()): Vec3 {
  const horizontal = Math.cos(pitch);
  return target.set(
    -Math.sin(yaw) * horizontal,
    Math.sin(pitch),
    -Math.cos(yaw) * horizontal,
  ).normalize();
}

/**
 * Local interaction aim: canonical player eye origin + live look.
 * Does not read `PlayerController.yaw/pitch`, so a stale fixed-tick look cannot
 * steer block pick / bow spawn. Physics still copies look inside `tick()`.
 */
export function localInteractionAim(
  player: AimEyeHost,
  look: AimLook,
  origin = new Vec3(),
  direction = new Vec3(),
): LocalAim {
  player.eyePosition(origin);
  viewDirectionFromLook(look.yaw, look.pitch, direction);
  return { origin, direction, yaw: look.yaw, pitch: look.pitch };
}

export function bowSpawnFromAim(aim: LocalAim, muzzle = BOW_MUZZLE): { origin: Vec3; direction: Vec3 } {
  return {
    origin: aim.origin.clone().addScaledVector(aim.direction, muzzle),
    direction: aim.direction,
  };
}

export function faceNameFromNormal(normal: Vec3Like): string {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ay >= ax && ay >= az) return normal.y >= 0 ? 'up' : 'down';
  if (ax >= az) return normal.x >= 0 ? 'east' : 'west';
  return normal.z >= 0 ? 'south' : 'north';
}

export function formatLocalAimHud(info: LocalAimHudInfo): string {
  const target = info.targetX === undefined
    ? 'tgt=—'
    : `tgt=${info.targetX},${info.targetY},${info.targetZ} n=${(info.normalX ?? 0).toFixed(0)},${(info.normalY ?? 0).toFixed(0)},${(info.normalZ ?? 0).toFixed(0)} ${faceNameFromNormal({
      x: info.normalX ?? 0,
      y: info.normalY ?? 0,
      z: info.normalZ ?? 0,
    })}`;
  return (
    `Aim cam=${info.cameraYaw.toFixed(3)}/${info.cameraPitch.toFixed(3)} `
    + `ply=${info.playerYaw.toFixed(3)}/${info.playerPitch.toFixed(3)} `
    + `look=${info.aimYaw.toFixed(3)}/${info.aimPitch.toFixed(3)} ${target}`
  );
}
