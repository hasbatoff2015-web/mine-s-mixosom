import { describe, expect, it } from 'vitest';
import { formatBreakAttempt } from '../../server/breakDiagnostics';

describe('break attempt diagnostics', () => {
  it('includes player, coords, block ids, cancel, and mining state', () => {
    const line = formatBreakAttempt({
      playerId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      playerName: 'Ada',
      gamemode: 'survival',
      x: 8, y: 70, z: 12,
      blockId: 3,
      miningTarget: { x: 8, y: 70, z: 12 },
      miningProgress: 0.4,
      commandSeq: 12,
      stage: 'tryBreak.intent',
      reason: 'los',
      eventCancelled: false,
      blockAfter: 3,
      mutated: false,
      claimOverlap: 0,
    });
    expect(line).toContain('REJECT los');
    expect(line).toContain('Ada/aaaaaaaa');
    expect(line).toContain('at=8,70,12');
    expect(line).toContain('id=3');
    expect(line).toContain('mutated=0');
    expect(line).toContain('stage=tryBreak.intent');
    expect(line).toContain('cancelled=0');
    expect(line).toContain('mine=8,70,12@0.400');
    expect(line).toContain('cmd=12');
    expect(line).toContain('claims=0');
  });
});
