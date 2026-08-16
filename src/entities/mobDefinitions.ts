import { ItemId } from '../items';

export type MobKind =
  | 'cow'
  | 'pig'
  | 'chicken'
  | 'sheep'
  | 'zombie'
  | 'skeleton'
  | 'creeper'
  | 'spider';

export type MobDisposition = 'passive' | 'hostile';
export type MobState = 'idle' | 'wander' | 'chase' | 'attack' | 'hurt' | 'die';

export interface MobLootEntry {
  readonly itemId: string;
  readonly min: number;
  readonly max: number;
  readonly chance?: number;
}

export interface MobDefinition {
  readonly kind: MobKind;
  readonly disposition: MobDisposition;
  readonly maxHealth: number;
  readonly width: number;
  readonly height: number;
  readonly eyeHeight: number;
  readonly speed: number;
  readonly detectionRange: number;
  readonly attackRange: number;
  readonly attackDamage: number;
  readonly attackCooldownSeconds: number;
  readonly loot: readonly MobLootEntry[];
}

export const MOB_DEFINITIONS: Readonly<Record<MobKind, MobDefinition>> = Object.freeze({
  cow: Object.freeze({
    kind: 'cow', disposition: 'passive', maxHealth: 10, width: 0.9, height: 1.4,
    eyeHeight: 1.25, speed: 2.1, detectionRange: 0, attackRange: 0,
    attackDamage: 0, attackCooldownSeconds: 1,
    loot: Object.freeze([
      { itemId: ItemId.Beef, min: 1, max: 3 },
      { itemId: ItemId.Leather, min: 0, max: 2 },
    ]),
  }),
  pig: Object.freeze({
    kind: 'pig', disposition: 'passive', maxHealth: 10, width: 0.9, height: 1.15,
    eyeHeight: 1, speed: 2, detectionRange: 0, attackRange: 0,
    attackDamage: 0, attackCooldownSeconds: 1,
    loot: Object.freeze([{ itemId: ItemId.Porkchop, min: 1, max: 3 }]),
  }),
  chicken: Object.freeze({
    kind: 'chicken', disposition: 'passive', maxHealth: 4, width: 0.45, height: 0.75,
    eyeHeight: 0.68, speed: 1.8, detectionRange: 0, attackRange: 0,
    attackDamage: 0, attackCooldownSeconds: 1,
    loot: Object.freeze([
      { itemId: ItemId.Chicken, min: 1, max: 1 },
      { itemId: ItemId.Feather, min: 0, max: 2 },
    ]),
  }),
  sheep: Object.freeze({
    kind: 'sheep', disposition: 'passive', maxHealth: 8, width: 0.9, height: 1.35,
    eyeHeight: 1.2, speed: 2, detectionRange: 0, attackRange: 0,
    attackDamage: 0, attackCooldownSeconds: 1,
    // Deliberately white only: coloured wool remains creative-only in this alpha.
    loot: Object.freeze([{ itemId: 'white_wool', min: 1, max: 1 }]),
  }),
  zombie: Object.freeze({
    kind: 'zombie', disposition: 'hostile', maxHealth: 20, width: 0.6, height: 1.8,
    eyeHeight: 1.62, speed: 2.3, detectionRange: 16, attackRange: 1.45,
    attackDamage: 3, attackCooldownSeconds: 1,
    loot: Object.freeze([{ itemId: ItemId.IronIngot, min: 1, max: 1, chance: 0.025 }]),
  }),
  skeleton: Object.freeze({
    kind: 'skeleton', disposition: 'hostile', maxHealth: 20, width: 0.6, height: 1.8,
    eyeHeight: 1.62, speed: 2.35, detectionRange: 18, attackRange: 14,
    attackDamage: 4, attackCooldownSeconds: 1.6,
    loot: Object.freeze([
      { itemId: ItemId.Arrow, min: 0, max: 2 },
      { itemId: ItemId.Bow, min: 1, max: 1, chance: 0.04 },
    ]),
  }),
  creeper: Object.freeze({
    kind: 'creeper', disposition: 'hostile', maxHealth: 20, width: 0.6, height: 1.7,
    eyeHeight: 1.45, speed: 2.15, detectionRange: 16, attackRange: 3,
    attackDamage: 0, attackCooldownSeconds: 1,
    loot: Object.freeze([{ itemId: ItemId.Gunpowder, min: 0, max: 2 }]),
  }),
  spider: Object.freeze({
    kind: 'spider', disposition: 'hostile', maxHealth: 16, width: 1.4, height: 0.9,
    eyeHeight: 0.65, speed: 3.2, detectionRange: 16, attackRange: 1.55,
    attackDamage: 2, attackCooldownSeconds: 0.9,
    loot: Object.freeze([{ itemId: ItemId.String, min: 0, max: 2 }]),
  }),
});

export function getMobDefinition(kind: MobKind): MobDefinition {
  return MOB_DEFINITIONS[kind];
}

export function isHostileMob(kind: MobKind): boolean {
  return MOB_DEFINITIONS[kind].disposition === 'hostile';
}
