import { MEGA_ZOMBIE_DEATH_SECONDS } from './megaZombie';

/**
 * Pose for the ported Mutant Zombie rig.
 * Angles are authored in legacy Y-down space (the Java model's rotateAngle*)
 * and written to Three as (-x, y, -z), matching `legacyRotationToThree`.
 * Values come from MutantZombieModel.setAngles / animate / animateMelee.
 */

export interface MegaZombiePoseInput {
  readonly walkPhase: number;
  readonly locomotionSpeed: number;
  readonly visualAge: number;
  readonly state: string;
  readonly stateSeconds: number;
  readonly deathSeconds: number;
}

export interface MegaZombiePoseResult {
  readonly shake: number;
  readonly fall: number;
  readonly tint: number;
}

interface Angles {
  x: number;
  y: number;
  z: number;
}

interface Rig {
  waist: Angles;
  chest: Angles;
  head: Angles;
  arm1: Angles;
  arm2: Angles;
  forearm1: Angles;
  forearm2: Angles;
  leg1: Angles;
  leg2: Angles;
  foreleg1: Angles;
  foreleg2: Angles;
}

type PosePart = { rotation: { x: number; y: number; z: number } };

const SHAKE_SECONDS = 0.28;

function angles(x = 0, y = 0, z = 0): Angles {
  return { x, y, z };
}

function baseRig(): Rig {
  return {
    waist: angles(0.19634955, 0, 0),
    chest: angles(0.5235988, 0, 0),
    head: angles(-0.71994835, 0, 0),
    arm1: angles(-0.32724923, 0, 0.3926991),
    arm2: angles(-0.32724923, 0, -0.3926991),
    forearm1: angles(-1.0471976, 0, 0),
    forearm2: angles(-1.0471976, 0, 0),
    leg1: angles(-0.7853982, 0, 0),
    leg2: angles(-0.7853982, 0, 0),
    foreleg1: angles(0.7853982, 0, 0),
    foreleg2: angles(0.7853982, 0, 0),
  };
}

function addMelee(rig: Rig, fullTick: number): void {
  rig.arm1.z = 0;
  rig.arm2.z = 0;
  if (fullTick < 8) {
    const tick = fullTick / 8;
    const f = -Math.sin(tick * Math.PI / 2);
    const f1 = Math.cos(tick * Math.PI / 2);
    rig.waist.x += f * 0.2;
    rig.chest.x += f * 0.2;
    rig.arm1.x += f * 2.3;
    rig.arm1.z += f1 * Math.PI / 8;
    rig.arm2.x += f * 2.3;
    rig.arm2.z -= f1 * Math.PI / 8;
    rig.forearm1.x += f * 0.8;
    rig.forearm2.x += f * 0.8;
    return;
  }
  if (fullTick < 12) {
    const tick = (fullTick - 8) / 4;
    const f = -Math.cos(tick * Math.PI / 2);
    const f1 = Math.sin(tick * Math.PI / 2);
    rig.waist.x += f * 0.9 + 0.7;
    rig.chest.x += f * 0.9 + 0.7;
    rig.arm1.x += f * 0.2 - 2.1;
    rig.arm1.z += f1 * 0.3;
    rig.arm2.x += f * 0.2 - 2.1;
    rig.arm2.z -= f1 * 0.3;
    rig.forearm1.x += f * 1.0 + 0.2;
    rig.forearm2.x += f * 1.0 + 0.2;
    return;
  }
  if (fullTick < 16) {
    rig.waist.x += 0.7;
    rig.chest.x += 0.7;
    rig.arm1.x -= 2.1;
    rig.arm1.z += 0.3;
    rig.arm2.x -= 2.1;
    rig.arm2.z -= 0.3;
    rig.forearm1.x += 0.2;
    rig.forearm2.x += 0.2;
    return;
  }
  if (fullTick < 24) {
    const tick = (fullTick - 16) / 8;
    const f = Math.cos(tick * Math.PI / 2);
    rig.waist.x += f * 0.7;
    rig.chest.x += f * 0.7;
    rig.arm1.x -= f * 2.1;
    rig.arm1.z += f * -0.09269908 + 0.3926991;
    rig.arm2.x -= f * 2.1;
    rig.arm2.z -= f * -0.09269908 + 0.3926991;
    rig.forearm1.x += f * 0.2;
    rig.forearm2.x += f * 0.2;
    return;
  }
  rig.arm1.z += 0.3926991;
  rig.arm2.z += -0.3926991;
}

function writePart(part: PosePart | undefined, angle: Angles): void {
  if (!part) return;
  part.rotation.x = -angle.x;
  part.rotation.y = angle.y;
  part.rotation.z = -angle.z;
}

export function applyMegaZombiePose(
  parts: { get(name: string): PosePart | undefined },
  input: MegaZombiePoseInput,
): MegaZombiePoseResult {
  const rig = baseRig();
  const dying = input.state === 'die';
  const deathSeconds = Math.max(0, input.deathSeconds);
  let shake = 0;
  let fall = 0;
  if (dying) {
    if (deathSeconds < SHAKE_SECONDS) {
      shake = Math.sin(deathSeconds * 46) * 0.08;
    } else {
      const span = Math.max(0.05, MEGA_ZOMBIE_DEATH_SECONDS - SHAKE_SECONDS);
      fall = Math.min(1, (deathSeconds - SHAKE_SECONDS) / span);
    }
    rig.waist.x -= fall * (Math.PI / 10);
    rig.chest.x -= fall * (Math.PI / 12);
    rig.head.x -= fall * (Math.PI / 10);
    rig.arm1.x -= fall * (Math.PI / 2);
    rig.arm2.x -= fall * (Math.PI / 2);
    rig.leg1.z += fall * (Math.PI / 12);
    rig.leg2.z -= fall * (Math.PI / 12);
  } else {
    if (input.state === 'attack') addMelee(rig, Math.max(0, input.stateSeconds) * 20);
    const amount = Math.min(1, Math.max(0, input.locomotionSpeed) * 0.45);
    const phase = input.walkPhase;
    const walkAnim = Math.sin(phase * 0.4) * amount;
    const walkAnim1 = (Math.sin((phase - 0.7) * 0.4) + 0.7) * amount;
    const walkAnim2 = -(Math.sin((phase + 0.7) * 0.4) - 0.7) * amount;
    const breathe = Math.sin(input.visualAge * 0.1);
    rig.chest.x += breathe * 0.02;
    rig.arm1.z -= breathe * 0.05;
    rig.arm2.z += breathe * 0.05;
    rig.chest.y -= walkAnim * 0.1;
    rig.arm1.x -= walkAnim * 0.6;
    rig.arm2.x += walkAnim * 0.6;
    rig.leg1.x += walkAnim1 * 0.9;
    rig.leg2.x += walkAnim2 * 0.9;
  }
  writePart(parts.get('waist'), rig.waist);
  writePart(parts.get('chest'), rig.chest);
  writePart(parts.get('head'), rig.head);
  writePart(parts.get('arm1'), rig.arm1);
  writePart(parts.get('arm2'), rig.arm2);
  writePart(parts.get('forearm1'), rig.forearm1);
  writePart(parts.get('forearm2'), rig.forearm2);
  writePart(parts.get('leg1'), rig.leg1);
  writePart(parts.get('leg2'), rig.leg2);
  writePart(parts.get('foreleg1'), rig.foreleg1);
  writePart(parts.get('foreleg2'), rig.foreleg2);
  return { shake, fall, tint: fall };
}
