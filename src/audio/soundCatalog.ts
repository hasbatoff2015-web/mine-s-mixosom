import type { BlockSoundGroup } from '../blocks/types';
import {
  materialSoundEvent,
  type BlockSoundAction,
  type NamedSoundEventId,
  type SoundEventId,
  type SoundEventProfile,
} from './soundEvents';

const MATERIAL_FILES: Readonly<Record<BlockSoundGroup, readonly string[]>> = {
  stone: ['stone_1.mp3', 'stone_2.mp3'],
  wood: ['wood_1.mp3', 'wood_2.mp3'],
  dirt: ['dirt_1.mp3', 'dirt_2.mp3'],
  sand: ['sand_1.mp3', 'sand_2.mp3'],
  wool: ['wool_1.mp3', 'wool_2.mp3'],
  glass: ['glass_1.mp3'],
};

const MATERIAL_ACTIONS: Readonly<Record<BlockSoundAction, {
  volume: number;
  pitchMin: number;
  pitchMax: number;
  maxDistance: number;
  bus: SoundEventProfile['bus'];
  maxConcurrent: number;
  priority: number;
}>> = {
  hit: {
    volume: 0.32, pitchMin: 0.92, pitchMax: 1.02,
    maxDistance: 16, bus: 'blockHit', maxConcurrent: 4, priority: 3,
  },
  break: {
    volume: 0.72, pitchMin: 0.96, pitchMax: 1.08,
    maxDistance: 20, bus: 'blockBreak', maxConcurrent: 6, priority: 5,
  },
  place: {
    volume: 0.48, pitchMin: 0.90, pitchMax: 1.04,
    maxDistance: 16, bus: 'blockPlace', maxConcurrent: 4, priority: 4,
  },
  step: {
    volume: 0.16, pitchMin: 0.94, pitchMax: 1.06,
    maxDistance: 12, bus: 'footstep', maxConcurrent: 2, priority: 2,
  },
};

const NAMED: readonly SoundEventProfile[] = [
  named('explosion', ['explosion.mp3'], {
    volume: 1, pitchMin: 0.94, pitchMax: 1.06, positional: true,
    maxDistance: 48, refDistance: 4, bus: 'explosion', maxConcurrent: 2, priority: 10,
  }),
  named('bow.shoot', ['bow_shoot.mp3'], {
    volume: 0.55, pitchMin: 0.96, pitchMax: 1.06, positional: false,
    maxDistance: 16, bus: 'combat', maxConcurrent: 3, priority: 6,
  }),
  named('arrow.hit', ['arrow_hit.mp3'], {
    volume: 0.55, pitchMin: 0.94, pitchMax: 1.08, positional: true,
    maxDistance: 24, bus: 'combat', maxConcurrent: 4, priority: 6,
  }),
  named('combat.hit', ['combat_hit.mp3'], {
    volume: 0.62, pitchMin: 0.94, pitchMax: 1.08, positional: true,
    maxDistance: 20, bus: 'combat', maxConcurrent: 4, priority: 7,
  }),
  named('player.hurt', ['player_hurt.mp3'], {
    volume: 0.7, pitchMin: 0.94, pitchMax: 1.06, positional: false,
    maxDistance: 16, bus: 'combat', maxConcurrent: 2, priority: 8,
  }),
  named('item.pickup', ['item_pickup.mp3'], {
    volume: 0.4, pitchMin: 0.96, pitchMax: 1.08, positional: false,
    maxDistance: 12, bus: 'ui', maxConcurrent: 3, priority: 5,
  }),
  named('food.eat', ['food_eat.mp3'], {
    volume: 0.45, pitchMin: 0.94, pitchMax: 1.08, positional: false,
    maxDistance: 12, bus: 'ui', maxConcurrent: 2, priority: 4,
  }),
  named('potion.drink', ['potion_drink.mp3'], {
    volume: 0.5, pitchMin: 0.96, pitchMax: 1.05, positional: false,
    maxDistance: 12, bus: 'ui', maxConcurrent: 2, priority: 4,
  }),
  named('door.open', ['door_open.mp3'], {
    volume: 0.55, pitchMin: 0.96, pitchMax: 1.04, positional: true,
    maxDistance: 18, bus: 'world', maxConcurrent: 3, priority: 5,
  }),
  named('door.close', ['door_close.mp3'], {
    volume: 0.55, pitchMin: 0.96, pitchMax: 1.04, positional: true,
    maxDistance: 18, bus: 'world', maxConcurrent: 3, priority: 5,
  }),
  named('chest.open', ['chest_open.mp3'], {
    volume: 0.55, pitchMin: 0.96, pitchMax: 1.04, positional: true,
    maxDistance: 16, bus: 'world', maxConcurrent: 2, priority: 5,
  }),
  named('chest.close', ['chest_close.mp3'], {
    volume: 0.55, pitchMin: 0.96, pitchMax: 1.04, positional: true,
    maxDistance: 16, bus: 'world', maxConcurrent: 2, priority: 5,
  }),
  named('redstone.click', ['click.mp3'], {
    volume: 0.4, pitchMin: 0.92, pitchMax: 1.08, positional: true,
    maxDistance: 14, bus: 'world', maxConcurrent: 4, priority: 5,
  }),
  named('fire.ignite', ['fire_ignite.mp3'], {
    volume: 0.5, pitchMin: 0.94, pitchMax: 1.08, positional: true,
    maxDistance: 16, bus: 'world', maxConcurrent: 3, priority: 5,
  }),
  named('water.splash', ['water_splash.mp3'], {
    volume: 0.5, pitchMin: 0.94, pitchMax: 1.08, positional: true,
    maxDistance: 16, bus: 'world', maxConcurrent: 3, priority: 5,
  }),
  named('glass.break', ['glass_1.mp3'], {
    volume: 0.72, pitchMin: 0.96, pitchMax: 1.08, positional: true,
    maxDistance: 20, bus: 'blockBreak', maxConcurrent: 6, priority: 5,
  }),
];

function named(
  event: NamedSoundEventId,
  files: readonly string[],
  rest: Omit<SoundEventProfile, 'event' | 'files' | 'refDistance'> & { refDistance?: number },
): SoundEventProfile {
  return {
    event,
    files,
    refDistance: rest.refDistance ?? 2,
    volume: rest.volume,
    pitchMin: rest.pitchMin,
    pitchMax: rest.pitchMax,
    positional: rest.positional,
    maxDistance: rest.maxDistance,
    bus: rest.bus,
    maxConcurrent: rest.maxConcurrent,
    priority: rest.priority,
  };
}

function materialProfile(action: BlockSoundAction, group: BlockSoundGroup): SoundEventProfile {
  const spec = MATERIAL_ACTIONS[action];
  return {
    event: materialSoundEvent(action, group),
    files: MATERIAL_FILES[group],
    volume: spec.volume,
    pitchMin: spec.pitchMin,
    pitchMax: spec.pitchMax,
    positional: true,
    maxDistance: spec.maxDistance,
    refDistance: action === 'step' ? 1.5 : 2,
    bus: spec.bus,
    maxConcurrent: spec.maxConcurrent,
    priority: spec.priority,
  };
}

const MATERIAL_GROUPS = Object.keys(MATERIAL_FILES) as BlockSoundGroup[];
const MATERIAL_ACTION_LIST = Object.keys(MATERIAL_ACTIONS) as BlockSoundAction[];

const ALL_PROFILES: readonly SoundEventProfile[] = [
  ...MATERIAL_ACTION_LIST.flatMap((action) => MATERIAL_GROUPS.map((group) => materialProfile(action, group))),
  ...NAMED,
];

export const SOUND_CATALOG: ReadonlyMap<SoundEventId, SoundEventProfile> = new Map(
  ALL_PROFILES.map((profile) => [profile.event, profile]),
);

export const SFX_BASE_PATH = 'audio/sfx/';

export function getSoundProfile(event: SoundEventId): SoundEventProfile | undefined {
  return SOUND_CATALOG.get(event);
}

export function catalogFiles(): readonly string[] {
  const unique = new Set<string>();
  for (const profile of SOUND_CATALOG.values()) {
    for (const file of profile.files) unique.add(file);
  }
  return [...unique].sort();
}

export function resolveCatalogEvent(event: SoundEventId): SoundEventProfile | undefined {
  if (event === 'glass.break') return SOUND_CATALOG.get('block.break.glass') ?? SOUND_CATALOG.get(event);
  return SOUND_CATALOG.get(event);
}

/** Production source-file budget: material variants plus named one-shots. */
export const PRODUCTION_SFX_FILE_BUDGET = 26;
