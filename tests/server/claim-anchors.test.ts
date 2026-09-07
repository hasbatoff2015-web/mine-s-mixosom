import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { MAX_WORLD_Y, MIN_WORLD_Y } from '../../src/core/constants';
import {
  BLOCK_CLAIM_OVERLAP_MESSAGE,
  CLAIM_ANCHOR_RADIUS,
  allocateBlockClaimName,
  claimAnchorKey,
  claimAnchorVolume,
  findClaimByAnchor,
  isClaimAnchorBlock,
  overlappingAnchorClaims,
  volumesOverlap,
} from '../../server/services/claimAnchors';
import {
  CLAIM_PRIORITY_DEFAULT,
  DEFAULT_CLAIM_FLAGS,
  migrateClaimStore,
  type Claim,
  type ClaimStore,
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

describe('claim anchor geometry', () => {
  it('maps iron/gold/diamond blocks to radii 10/20/30 and full world height', () => {
    expect(isClaimAnchorBlock(BlockId.IronBlock)).toBe(true);
    expect(isClaimAnchorBlock(BlockId.GoldBlock)).toBe(true);
    expect(isClaimAnchorBlock(BlockId.DiamondBlock)).toBe(true);
    expect(isClaimAnchorBlock(BlockId.Dirt)).toBe(false);
    expect(claimAnchorKey(BlockId.IronBlock)).toBe('iron_block');
    expect(CLAIM_ANCHOR_RADIUS).toEqual({ iron_block: 10, gold_block: 20, diamond_block: 30 });

    const iron = claimAnchorVolume(100, 64, 50, 'iron_block');
    expect(iron).toEqual({
      minX: 90, maxX: 110,
      minY: MIN_WORLD_Y, maxY: MAX_WORLD_Y,
      minZ: 40, maxZ: 60,
    });
    expect(claimAnchorVolume(0, 10, 0, 'gold_block')).toMatchObject({ minX: -20, maxX: 20, minY: 0, maxY: 255 });
    expect(claimAnchorVolume(0, 10, 0, 'diamond_block')).toMatchObject({ minX: -30, maxX: 30 });
  });

  it('treats inclusive AABB contact as overlap, including dx=20 for two iron radii', () => {
    const first = claimAnchorVolume(0, 10, 0, 'iron_block');
    const touching = claimAnchorVolume(20, 10, 0, 'iron_block');
    const separate = claimAnchorVolume(21, 10, 0, 'iron_block');
    expect(volumesOverlap(first, touching)).toBe(true);
    expect(volumesOverlap(first, separate)).toBe(false);
    expect(volumesOverlap(claimAnchorVolume(0, 10, 0, 'diamond_block'), claimAnchorVolume(0, 10, 0, 'iron_block'))).toBe(true);
  });
});

describe('claim anchor store helpers', () => {
  it('allocates per-owner sequential names and does not reuse deleted numbers', () => {
    const store: ClaimStore = { claims: [] };
    expect(allocateBlockClaimName(store, 'Ada')).toBe('1');
    store.claims.push(claim({ name: '1', owner: 'ada', volume: claimAnchorVolume(0, 1, 0, 'iron_block') }));
    expect(allocateBlockClaimName(store, 'ada')).toBe('2');
    store.claims.push(claim({ name: '2', owner: 'ada', volume: claimAnchorVolume(21, 1, 0, 'iron_block') }));
    expect(allocateBlockClaimName(store, 'Bob')).toBe('1');
    store.claims = store.claims.filter((entry) => entry.name !== '2');
    expect(allocateBlockClaimName(store, 'ada')).toBe('3');
    expect(store.blockClaimSeq).toEqual({ ada: 3, bob: 1 });
  });

  it('skips a number already used by that owner via /claim create', () => {
    const store: ClaimStore = {
      claims: [claim({ name: '1', owner: 'ada', volume: { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 } })],
    };
    expect(allocateBlockClaimName(store, 'ada')).toBe('2');
  });

  it('looks up block-claims by stored anchor coords, not by volume scan', () => {
    const iron = claim({
      name: '1',
      volume: claimAnchorVolume(8, 40, 8, 'iron_block'),
      anchor: { x: 8, y: 40, z: 8, block: 'iron_block' },
    });
    const other = claim({
      name: '2',
      volume: claimAnchorVolume(40, 40, 8, 'iron_block'),
      anchor: { x: 40, y: 40, z: 8, block: 'iron_block' },
    });
    expect(findClaimByAnchor([iron, other], 'anarchy', 8, 40, 8)?.name).toBe('1');
    expect(findClaimByAnchor([iron, other], 'anarchy', 9, 40, 8)).toBeUndefined();
    expect(overlappingAnchorClaims([iron, other], 'anarchy', claimAnchorVolume(8, 40, 8, 'iron_block')).map((entry) => entry.name)).toEqual(['1']);
    expect(overlappingAnchorClaims(
      [iron, other],
      'anarchy',
      claimAnchorVolume(8, 40, 8, 'diamond_block'),
    ).map((entry) => entry.name).sort()).toEqual(['1', '2']);
    expect(BLOCK_CLAIM_OVERLAP_MESSAGE).toContain('блок-приват');
  });
});

describe('claim store migration with anchors', () => {
  it('keeps old claims without inventing anchors or sequence counters', () => {
    const store = migrateClaimStore({
      claims: [{
        id: 'old-1',
        name: 'garden',
        owner: 'Ada',
        worldId: 'anarchy',
        volume: { minX: 0, minY: 0, minZ: 0, maxX: 4, maxY: 8, maxZ: 4 },
        members: [],
        flags: { pvp: false },
      }],
    });
    expect(store.claims).toHaveLength(1);
    expect(store.claims[0]!.anchor).toBeUndefined();
    expect(store.blockClaimSeq).toBeUndefined();
    expect(store.claims[0]!.flags).toEqual({ pvp: false });
    expect(DEFAULT_CLAIM_FLAGS['block-break']).toBe(false);
  });

  it('round-trips block-claim anchors and per-owner sequence', () => {
    const store = migrateClaimStore({
      claims: [{
        id: 'ada:1:1',
        name: '1',
        owner: 'Ada',
        worldId: 'anarchy',
        volume: claimAnchorVolume(3, 10, 3, 'iron_block'),
        members: [],
        flags: {},
        anchor: { x: 3, y: 10, z: 3, block: 'iron_block' },
      }],
      blockClaimSeq: { Ada: 2.9, bob: -1, skip: 'nope' },
    });
    expect(store.claims[0]!.anchor).toEqual({ x: 3, y: 10, z: 3, block: 'iron_block' });
    expect(store.blockClaimSeq).toEqual({ ada: 2 });
  });

  it('drops malformed anchors instead of fabricating a block-claim', () => {
    const store = migrateClaimStore({
      claims: [{
        id: 'bad',
        name: '1',
        owner: 'ada',
        worldId: 'anarchy',
        volume: claimAnchorVolume(0, 1, 0, 'gold_block'),
        members: [],
        flags: {},
        anchor: { x: 0.5, y: 1, z: 0, block: 'gold_block' },
      }],
    });
    expect(store.claims[0]!.anchor).toBeUndefined();
  });
});
