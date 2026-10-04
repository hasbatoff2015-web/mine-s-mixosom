import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { noteHotbarSelect, resolveHotbarSelection } from '../src/net/hotbarSelection';

describe('hotbar wheel is not a physics tick', () => {
  const source = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
  const start = source.indexOf('private commitOnlineHotbarSelect');
  const end = source.indexOf('private openChat', start);
  const body = source.slice(start, end);
  const selectStart = source.indexOf('private selectHotbar');
  const selectBody = source.slice(selectStart, start);

  it('does not allocate inputSeq, send an input, or predict from a wheel or digit', () => {
    expect(start).toBeGreaterThan(0);
    expect(selectStart).toBeGreaterThan(0);
    expect(body).toContain('noteHotbarSelect');
    expect(body).not.toContain('inputSeq += 1');
    expect(body).not.toContain('predictLocalMove');
    expect(body).not.toContain("type: 'input'");
    expect(body).not.toContain('jump: false');
    expect(selectBody).not.toContain('predictLocalMove');
    expect(selectBody).not.toContain('inputSeq');
  });

  it('fifty selections between physics ticks do not advance the command seq', () => {
    let inputSeq = 4;
    let pending = noteHotbarSelect(inputSeq, 0);
    for (let slot = 0; slot < 50; slot += 1) {
      pending = noteHotbarSelect(inputSeq, slot % 9);
    }
    expect(inputSeq).toBe(4);
    expect(pending.slot).toBe(49 % 9);
    expect(pending.sinceInputSeq).toBe(4);
    expect(resolveHotbarSelection(pending, 0, inputSeq).slot).toBe(pending.slot);
    inputSeq += 1;
    expect(resolveHotbarSelection(pending, 0, inputSeq).slot).toBe(0);
  });
});
