import { describe, expect, it } from 'vitest';
import { isQuietWorldQueryEnabled, quietWorldRenderDistance } from '../src/debug/quietWorld';

describe('quietWorld DEV flag', () => {
  it('caps render distance to 1 only when the query is set', () => {
    expect(isQuietWorldQueryEnabled('')).toBe(false);
    expect(quietWorldRenderDistance(4, '')).toBe(4);
    expect(isQuietWorldQueryEnabled('?quietWorld=1')).toBe(true);
    expect(quietWorldRenderDistance(4, '?quietWorld=1')).toBe(1);
  });
});
