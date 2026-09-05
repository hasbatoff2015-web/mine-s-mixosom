import { describe, expect, it } from 'vitest';
import {
  CLAIM_PRIORITY_DEFAULT,
  CLAIM_PRIORITY_MAX,
  CLAIM_PRIORITY_MIN,
  DEFAULT_CLAIM_FLAGS,
  clampClaimPriority,
  claimsAt,
  effectiveFlag,
  effectiveFlags,
  migrateClaimStore,
  ownFlagLines,
  type Claim,
} from '../../server/services/claims';

function claim(partial: Partial<Claim> & Pick<Claim, 'name' | 'volume'>): Claim {
  return {
    id: partial.id ?? partial.name,
    owner: partial.owner ?? 'ada',
    worldId: partial.worldId ?? 'anarchy',
    members: partial.members ?? [],
    priority: partial.priority ?? CLAIM_PRIORITY_DEFAULT,
    flags: partial.flags ?? {},
    ...partial,
  };
}

const spawnVolume = { minX: 0, minY: 0, minZ: 0, maxX: 20, maxY: 80, maxZ: 20 };
const arenaVolume = { minX: 5, minY: 0, minZ: 5, maxX: 10, maxY: 80, maxZ: 10 };

describe('claim flag defaults and migration', () => {
  it('uses the Claims V1 defaults and has no fire-spread flag', () => {
    expect(DEFAULT_CLAIM_FLAGS).toEqual({
      pvp: false,
      'mob-spawn': true,
      'mob-damage': true,
      'block-break': false,
      'block-place': false,
      explosions: true,
      'player-damage': true,
      'item-drop': true,
      'item-pickup': true,
    });
    expect(effectiveFlags([])).toEqual(DEFAULT_CLAIM_FLAGS);
    expect('fire-spread' in DEFAULT_CLAIM_FLAGS).toBe(false);
  });

  it('migrates old full-boolean claims and drops fire-spread', () => {
    const store = migrateClaimStore({
      claims: [{
        id: 'old-1',
        name: 'garden',
        owner: 'Ada',
        worldId: 'anarchy',
        volume: spawnVolume,
        members: ['Bob'],
        flags: {
          pvp: true,
          'mob-spawn': false,
          'mob-damage': false,
          'block-break': false,
          'block-place': false,
          explosions: false,
          'fire-spread': false,
          'player-damage': true,
          'item-drop': false,
          'item-pickup': false,
        },
      }],
    });
    expect(store.claims).toHaveLength(1);
    const migrated = store.claims[0]!;
    expect(migrated.owner).toBe('ada');
    expect(migrated.priority).toBe(0);
    expect(migrated.flags).toEqual({
      pvp: true,
      'mob-spawn': false,
      'mob-damage': false,
      'block-break': false,
      'block-place': false,
      explosions: false,
      'player-damage': true,
      'item-drop': false,
      'item-pickup': false,
    });
    expect(migrated.flags['fire-spread' as 'pvp']).toBeUndefined();
    expect(effectiveFlag([migrated], 'explosions')).toBe(false);
    expect(effectiveFlag([migrated], 'pvp')).toBe(true);
    expect(ownFlagLines(migrated).some((line) => line.includes('fire-spread'))).toBe(false);
  });

  it('clamps priority to the documented range', () => {
    expect(clampClaimPriority(Number.NaN)).toBe(0);
    expect(clampClaimPriority(-1_000_001)).toBe(CLAIM_PRIORITY_MIN);
    expect(clampClaimPriority(1_000_001)).toBe(CLAIM_PRIORITY_MAX);
    expect(clampClaimPriority(-12.9)).toBe(-12);
  });
});

describe('overlapping claims per-flag priority', () => {
  const spawn = claim({
    name: 'spawn',
    priority: 0,
    volume: spawnVolume,
    flags: { pvp: false, 'block-break': false, 'block-place': false },
  });
  const arena = claim({
    name: 'arena',
    priority: 10,
    volume: arenaVolume,
    flags: { pvp: true },
  });

  it('lets the arena override only pvp inside spawn', () => {
    const inside = claimsAt([spawn, arena], 'anarchy', 7, 10, 7);
    expect(inside.map((entry) => entry.name).sort()).toEqual(['arena', 'spawn']);
    expect(effectiveFlag(inside, 'pvp')).toBe(true);
    expect(effectiveFlag(inside, 'block-break')).toBe(false);
    expect(effectiveFlag(inside, 'block-place')).toBe(false);
    expect(effectiveFlag(inside, 'explosions')).toBe(true);
    expect(effectiveFlag(inside, 'mob-spawn')).toBe(true);
  });

  it('keeps spawn pvp=false outside the arena', () => {
    const outside = claimsAt([spawn, arena], 'anarchy', 2, 10, 2);
    expect(outside.map((entry) => entry.name)).toEqual(['spawn']);
    expect(effectiveFlag(outside, 'pvp')).toBe(false);
    expect(effectiveFlag(outside, 'block-break')).toBe(false);
  });

  it('does not copy every flag from the highest-priority claim', () => {
    const high = claim({
      name: 'high',
      priority: 50,
      volume: spawnVolume,
      flags: { pvp: true },
    });
    const low = claim({
      name: 'low',
      priority: 1,
      volume: spawnVolume,
      flags: { explosions: false, 'block-break': true },
    });
    const here = claimsAt([high, low], 'anarchy', 1, 1, 1);
    expect(effectiveFlag(here, 'pvp')).toBe(true);
    expect(effectiveFlag(here, 'explosions')).toBe(false);
    expect(effectiveFlag(here, 'block-break')).toBe(true);
    expect(effectiveFlag(here, 'item-drop')).toBe(DEFAULT_CLAIM_FLAGS['item-drop']);
  });
});
