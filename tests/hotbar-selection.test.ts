import { describe, expect, it } from 'vitest';
import {
  noteHotbarSelect,
  resolveHotbarSelection,
} from '../src/net/hotbarSelection';

describe('hotbar selection vs inventory echo', () => {
  it('keeps select→use on the new slot until the server acks that command', () => {
    const pending = noteHotbarSelect(10, 1);
    expect(pending).toEqual({ slot: 1, sinceInputSeq: 10 });
    expect(resolveHotbarSelection(pending, 0, 10)).toEqual({ slot: 1, pending });
    expect(resolveHotbarSelection(pending, 1, 10)).toEqual({ slot: 1, pending: undefined });
    expect(resolveHotbarSelection(pending, 0, 11)).toEqual({ slot: 0, pending: undefined });
  });

  it('covers select then left click, right click, and place without rollback', () => {
    for (const slot of [1, 3, 5, 8]) {
      const pending = noteHotbarSelect(4, slot);
      const duringUse = resolveHotbarSelection(pending, 0, 4);
      expect(duringUse.slot).toBe(slot);
      expect(duringUse.pending).toEqual(pending);
    }
  });

  it('rapid 1→2→3 then use keeps the last local slot', () => {
    let pending = noteHotbarSelect(1, 0);
    pending = noteHotbarSelect(1, 1);
    pending = noteHotbarSelect(2, 2);
    expect(resolveHotbarSelection(pending, 0, 2).slot).toBe(2);
    expect(resolveHotbarSelection(pending, 2, 3)).toEqual({ slot: 2, pending: undefined });
  });

  it('does not let an older snapshot overwrite a newer local selection', () => {
    const pending = noteHotbarSelect(20, 5);
    expect(resolveHotbarSelection(pending, 4, 19).slot).toBe(5);
    expect(resolveHotbarSelection(pending, 4, 20).slot).toBe(5);
    expect(resolveHotbarSelection(undefined, 4, 21).slot).toBe(4);
  });
});
