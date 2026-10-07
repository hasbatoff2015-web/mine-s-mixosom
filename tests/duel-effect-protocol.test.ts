import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '../shared/protocol';

describe('duel_effect protocol', () => {
  it('parses one fight-start burst and rejects bad coordinates or effects', () => {
    expect(parseServerMessage({
      type: 'duel_effect',
      effect: 'fight_start_burst',
      x: 20.5,
      y: 102.95,
      z: 21.5,
    })).toEqual({
      type: 'duel_effect',
      effect: 'fight_start_burst',
      x: 20.5,
      y: 102.95,
      z: 21.5,
    });
    expect(parseServerMessage({
      type: 'duel_effect',
      effect: 'fight_start_burst',
      x: Number.NaN,
      y: 1,
      z: 1,
    })).toEqual({ error: 'duel_effect coordinates invalid' });
    expect(parseServerMessage({
      type: 'duel_effect',
      effect: 'fight_start_burst',
      x: 1,
      y: Number.POSITIVE_INFINITY,
      z: 1,
    })).toEqual({ error: 'duel_effect coordinates invalid' });
    expect(parseServerMessage({
      type: 'duel_effect',
      effect: 'sparkle',
      x: 1,
      y: 1,
      z: 1,
    })).toEqual({ error: 'duel_effect.effect invalid' });
    expect(parseServerMessage({ type: 'duel_boom' })).toEqual({ error: 'unknown message type duel_boom' });
  });

  it('parses one duel_start look and rejects non-finite angles', () => {
    expect(parseServerMessage({
      type: 'player_look',
      reason: 'duel_start',
      yaw: -Math.PI / 2,
      pitch: 0.2,
    })).toEqual({
      type: 'player_look',
      reason: 'duel_start',
      yaw: -Math.PI / 2,
      pitch: 0.2,
    });
    expect(parseServerMessage({
      type: 'player_look',
      reason: 'duel_restore',
      yaw: 1.25,
      pitch: -0.4,
    })).toEqual({
      type: 'player_look',
      reason: 'duel_restore',
      yaw: 1.25,
      pitch: -0.4,
    });
    expect(parseServerMessage({
      type: 'player_look',
      reason: 'tick',
      yaw: 0,
      pitch: 0,
    })).toEqual({ error: 'player_look.reason invalid' });
    expect(parseServerMessage({
      type: 'player_look',
      reason: 'duel_start',
      yaw: Number.NaN,
      pitch: 0,
    })).toEqual({ error: 'player_look invalid' });
    expect(parseServerMessage({
      type: 'player_look',
      reason: 'duel_start',
      yaw: 0,
      pitch: Number.POSITIVE_INFINITY,
    })).toEqual({ error: 'player_look invalid' });
  });
});
