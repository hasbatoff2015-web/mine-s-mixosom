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
});
