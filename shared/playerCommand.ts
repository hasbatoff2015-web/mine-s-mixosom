/**
 * Movement command: client intent for one predicted physics tick.
 * commandSeq is not a server physics tick. The server ACK names both.
 */

export const COMMAND_QUEUE_MAX = 32;
export const APPLIED_STEPS_MAX = 4;

export interface PlayerCommand {
  readonly commandSeq: number;
  readonly clientTick: number;
  readonly forward: number;
  readonly right: number;
  readonly jump: boolean;
  readonly sneak: boolean;
  readonly sprint: boolean;
  readonly descend: boolean;
  readonly flySprint: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly selectedSlot: number;
  readonly mining?: boolean;
  readonly use?: boolean;
  readonly vehicleForward?: number;
}

export interface AppliedMovementStep {
  readonly serverTick: number;
  readonly commandSeq: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly onGround: boolean;
  readonly flying: boolean;
  readonly sneaking: boolean;
  readonly sprinting: boolean;
}

export function isUnitAxisFace(x: number, y: number, z: number): boolean {
  if (![x, y, z].every(Number.isFinite)) return false;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const max = Math.max(ax, ay, az);
  if (max < 0.5) return false;
  const nx = ax === max ? Math.sign(x) : 0;
  const ny = ay === max ? Math.sign(y) : 0;
  const nz = az === max ? Math.sign(z) : 0;
  return (nx !== 0 ? 1 : 0) + (ny !== 0 ? 1 : 0) + (nz !== 0 ? 1 : 0) === 1;
}

export function snapUnitAxisFace(x: number, y: number, z: number): { x: number; y: number; z: number } | undefined {
  if (!isUnitAxisFace(x, y, z)) return undefined;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ay >= ax && ay >= az) return { x: 0, y: Math.sign(y), z: 0 };
  if (ax >= az) return { x: Math.sign(x), y: 0, z: 0 };
  return { x: 0, y: 0, z: Math.sign(z) };
}
