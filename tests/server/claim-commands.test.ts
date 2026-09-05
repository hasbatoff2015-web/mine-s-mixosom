import { describe, expect, it } from 'vitest';
import { findClaimByName, parseClaimFlagArgs, parseClaimMemberArgs } from '../../server/services/claimCommands';
import { CLAIM_PRIORITY_DEFAULT, type Claim } from '../../server/services/claims';

describe('claim command argument parser', () => {
  it('keeps standing flag syntax and named flag syntax distinct', () => {
    expect(parseClaimFlagArgs(['mob-spawn', 'false'])).toEqual({
      ok: true, flag: 'mob-spawn', value: false,
    });
    expect(parseClaimFlagArgs(['spawn', 'mob-spawn', 'false'])).toEqual({
      ok: true, claimName: 'spawn', flag: 'mob-spawn', value: false,
    });
    expect(parseClaimFlagArgs(['arena', 'pvp', 'true'])).toEqual({
      ok: true, claimName: 'arena', flag: 'pvp', value: true,
    });
    expect(parseClaimFlagArgs(['pvp', 'true'])).toEqual({
      ok: true, flag: 'pvp', value: true,
    });
    expect(parseClaimFlagArgs(['pvp', 'pvp', 'false'])).toEqual({
      ok: true, claimName: 'pvp', flag: 'pvp', value: false,
    });
    expect(parseClaimFlagArgs(['spawn', 'true'])).toEqual({ ok: false });
    expect(parseClaimFlagArgs(['mob-spawn'])).toEqual({ ok: false });
  });

  it('parses standing vs named member args without guessing', () => {
    expect(parseClaimMemberArgs(['bob'])).toEqual({ ok: true, player: 'bob' });
    expect(parseClaimMemberArgs(['spawn', 'bob'])).toEqual({
      ok: true, claimName: 'spawn', player: 'bob',
    });
    expect(parseClaimMemberArgs([])).toEqual({ ok: false });
  });

  it('prefers the caller-owned claim when names collide', () => {
    const volume = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    const claims: Claim[] = [
      {
        id: 'other', name: 'spawn', owner: 'bob', worldId: 'anarchy', volume,
        members: [], priority: CLAIM_PRIORITY_DEFAULT, flags: {},
      },
      {
        id: 'mine', name: 'spawn', owner: 'ada', worldId: 'anarchy', volume,
        members: [], priority: CLAIM_PRIORITY_DEFAULT, flags: { pvp: true },
      },
    ];
    expect(findClaimByName(claims, 'spawn', 'ada')?.id).toBe('mine');
    expect(findClaimByName(claims, 'missing')).toBeUndefined();
  });
});
