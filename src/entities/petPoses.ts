import type { EntityVisual, MobModel } from './EntityHost';
import {
  type LegacyVector,
  legacyRotationPointToWorld,
  legacyRotationToThree,
} from './legacySpace';

function numberData(part: EntityVisual, key: string, fallback: number): number {
  const value = part.userData[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resetPartToBase(part: EntityVisual): void {
  part.position.x = numberData(part, 'basePositionX', part.position.x);
  part.position.y = numberData(part, 'basePositionY', part.position.y);
  part.position.z = numberData(part, 'basePositionZ', part.position.z);
  part.rotation.x = numberData(part, 'baseRotationX', part.rotation.x);
  part.rotation.y = numberData(part, 'baseRotationY', part.rotation.y);
  part.rotation.z = numberData(part, 'baseRotationZ', part.rotation.z);
}

function applyLegacyPivot(part: EntityVisual, pivot: LegacyVector, rotation: LegacyVector): void {
  const position = legacyRotationPointToWorld(pivot);
  const euler = legacyRotationToThree(rotation);
  part.position.x = position[0];
  part.position.y = position[1];
  part.position.z = position[2];
  part.rotation.x = euler[0];
  part.rotation.y = euler[1];
  part.rotation.z = euler[2];
}

function offsetLegacyPivot(part: EntityVisual, offset: LegacyVector, rotation?: LegacyVector): void {
  const base: LegacyVector = [
    numberData(part, 'baseLegacyPivotX', 0),
    numberData(part, 'baseLegacyPivotY', 0),
    numberData(part, 'baseLegacyPivotZ', 0),
  ];
  const pivot: LegacyVector = [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
  const position = legacyRotationPointToWorld(pivot);
  part.position.x = position[0];
  part.position.y = position[1];
  part.position.z = position[2];
  if (rotation) {
    const euler = legacyRotationToThree(rotation);
    part.rotation.x = euler[0];
    part.rotation.y = euler[1];
    part.rotation.z = euler[2];
  }
}

/** Vanilla ModelWolf wild tail pitch. Keeps the 8px tail behind the rump. */
export const WOLF_TAIL_WILD_PITCH = Math.PI / 5;
/** Vanilla ModelWolf angry tail pitch; lateral wag is suppressed. */
export const WOLF_TAIL_ANGRY_PITCH = 1.5393804;
export const WOLF_TAIL_STANDING_PIVOT: LegacyVector = [-1, 12, 8];
export const WOLF_TAIL_SITTING_PIVOT: LegacyVector = [-1, 21, 6];

export interface WolfTailPoseState {
  readonly sitting?: boolean;
  readonly angry?: boolean;
  readonly ownerId?: string;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly walkPhase: number;
  readonly locomotionSpeed: number;
}

/**
 * Minecraft-like tail rotation in legacy Y-down space.
 * Convert with `legacyRotationToThree` before writing Three.js euler.
 */
export function wolfTailLegacyRotation(state: WolfTailPoseState): LegacyVector {
  const tamed = Boolean(state.ownerId);
  const maxHealth = state.maxHealth && state.maxHealth > 0 ? state.maxHealth : 1;
  const health = state.health ?? maxHealth;
  const healthRatio = Math.max(0, Math.min(1, health / maxHealth));
  const pitch = state.angry === true
    ? WOLF_TAIL_ANGRY_PITCH
    : tamed
      ? (0.55 - (1 - healthRatio) * 0.4) * Math.PI
      : WOLF_TAIL_WILD_PITCH;
  const wag = state.angry === true
    ? 0
    : Math.cos(state.walkPhase * 0.6662) * 1.4 * Math.min(1, Math.max(0, state.locomotionSpeed));
  return [pitch, wag, 0];
}

export function applyWolfVisualPose(
  model: MobModel,
  sitting: boolean,
  walkPhase: number,
  locomotionSpeed: number,
  state: Omit<WolfTailPoseState, 'sitting' | 'walkPhase' | 'locomotionSpeed'> = {},
): void {
  const body = model.parts.get('body');
  const mane = model.mane ?? model.parts.get('mane');
  const tail = model.tail ?? model.parts.get('tail');
  const head = model.head;
  for (const part of model.parts.values()) resetPartToBase(part);
  const tailRotation = wolfTailLegacyRotation({
    sitting,
    walkPhase,
    locomotionSpeed,
    angry: state.angry,
    ownerId: state.ownerId,
    health: state.health,
    maxHealth: state.maxHealth,
  });

  if (sitting) {
    if (mane) applyLegacyPivot(mane, [-1, 16, -3], [(Math.PI * 2) / 5, 0, 0]);
    if (body) applyLegacyPivot(body, [0, 18, 0], [Math.PI / 4, 0, 0]);
    if (tail) applyLegacyPivot(tail, WOLF_TAIL_SITTING_PIVOT, tailRotation);
    const legs = model.legs;
    if (legs[0]) applyLegacyPivot(legs[0], [-2.5, 22, 2], [(Math.PI * 3) / 2, 0, 0]);
    if (legs[1]) applyLegacyPivot(legs[1], [0.5, 22, 2], [(Math.PI * 3) / 2, 0, 0]);
    if (legs[2]) applyLegacyPivot(legs[2], [-2.49, 17, -4], [5.811947, 0, 0]);
    if (legs[3]) applyLegacyPivot(legs[3], [0.51, 17, -4], [5.811947, 0, 0]);
    return;
  }

  const swing = Math.sin(walkPhase) * Math.min(0.65, locomotionSpeed * 0.22);
  model.legs.forEach((leg, index) => {
    leg.rotation.x = numberData(leg, 'baseRotationX', 0)
      + swing * (model.legSwingSigns[index] ?? (index % 2 === 0 ? 1 : -1));
  });
  if (tail) applyLegacyPivot(tail, WOLF_TAIL_STANDING_PIVOT, tailRotation);
  void head;
}

export function applyCatVisualPose(
  model: MobModel,
  sitting: boolean,
  walkPhase: number,
  locomotionSpeed: number,
): void {
  for (const part of model.parts.values()) resetPartToBase(part);
  const body = model.parts.get('body');
  const head = model.head;
  const tail1 = model.tail ?? model.parts.get('tail1');
  const tail2 = model.tail2 ?? model.parts.get('tail2');
  const backLeft = model.parts.get('backLeftLeg') ?? model.legs[0];
  const backRight = model.parts.get('backRightLeg') ?? model.legs[1];
  const frontLeft = model.parts.get('frontLeftLeg') ?? model.legs[2];
  const frontRight = model.parts.get('frontRightLeg') ?? model.legs[3];

  if (sitting) {
    if (body) offsetLegacyPivot(body, [0, -4, 5], [Math.PI / 4, 0, 0]);
    if (head) offsetLegacyPivot(head, [0, -3.3, 1]);
    if (tail1) offsetLegacyPivot(tail1, [0, 8, -2], [1.7278761, 0, 0]);
    if (tail2) offsetLegacyPivot(tail2, [0, 2, -0.8], [2.670354, 0, 0]);
    if (frontLeft) applyLegacyPivot(frontLeft, [1.2, 15.8, -7], [-0.15707964, 0, 0]);
    if (frontRight) applyLegacyPivot(frontRight, [-1.2, 15.8, -7], [-0.15707964, 0, 0]);
    if (backLeft) applyLegacyPivot(backLeft, [1.1, 21, 1], [Math.PI / 2, 0, 0]);
    if (backRight) applyLegacyPivot(backRight, [-1.1, 21, 1], [Math.PI / 2, 0, 0]);
    return;
  }

  const swing = Math.sin(walkPhase) * Math.min(0.55, locomotionSpeed * 0.24);
  model.legs.forEach((leg, index) => {
    const sign = model.legSwingSigns[index] ?? (index % 2 === 0 ? 1 : -1);
    const euler = legacyRotationToThree([swing * sign, 0, 0]);
    leg.rotation.x = numberData(leg, 'baseRotationX', 0) + euler[0];
  });
  if (tail1) {
    const wag = Math.sin(walkPhase * 0.7) * Math.min(0.18, locomotionSpeed * 0.1);
    tail1.rotation.x = numberData(tail1, 'baseRotationX', 0) + wag;
  }
  if (tail2) {
    const wag = Math.sin(walkPhase * 0.7) * Math.min(0.16, locomotionSpeed * 0.09);
    tail2.rotation.x = numberData(tail2, 'baseRotationX', 0) + wag;
  }
}
