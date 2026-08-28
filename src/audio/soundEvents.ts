import type { BlockSoundGroup } from '../blocks/types';

export type BlockSoundAction = 'hit' | 'break' | 'place' | 'step';

export type NamedSoundEventId =
  | 'explosion'
  | 'bow.shoot'
  | 'arrow.hit'
  | 'combat.hit'
  | 'player.hurt'
  | 'item.pickup'
  | 'food.eat'
  | 'potion.drink'
  | 'door.open'
  | 'door.close'
  | 'chest.open'
  | 'chest.close'
  | 'redstone.click'
  | 'fire.ignite'
  | 'water.splash'
  | 'glass.break';

export type MaterialSoundEventId = `block.${BlockSoundAction}.${BlockSoundGroup}`;

export type SoundEventId = NamedSoundEventId | MaterialSoundEventId;

export type SoundBus =
  | 'blockHit'
  | 'blockBreak'
  | 'blockPlace'
  | 'footstep'
  | 'explosion'
  | 'combat'
  | 'ui'
  | 'world';

export interface SoundEventProfile {
  readonly event: SoundEventId;
  readonly files: readonly string[];
  readonly volume: number;
  readonly pitchMin: number;
  readonly pitchMax: number;
  readonly positional: boolean;
  readonly maxDistance: number;
  readonly refDistance: number;
  readonly bus: SoundBus;
  readonly maxConcurrent: number;
  readonly priority: number;
}

export interface AudioVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AudioListenerPose extends AudioVec3 {
  readonly yaw?: number;
  readonly pitch?: number;
}

export interface PlaySoundOptions {
  readonly volume?: number;
  readonly pitch?: number;
  readonly positional?: boolean;
}

export function materialSoundEvent(
  action: BlockSoundAction,
  group: BlockSoundGroup,
): MaterialSoundEventId {
  return `block.${action}.${group}`;
}
