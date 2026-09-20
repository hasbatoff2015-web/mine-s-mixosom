import { describe, expect, it } from 'vitest';
import {
  cuboidSizeOf,
  formatCuboidSize,
  PlayerSelectionService,
  volumeFromCorners,
} from '../../server/services/selection';

describe('shared wand selection', () => {
  it('cycles first click to pos1, second to pos2, then restarts', () => {
    const selection = new PlayerSelectionService();
    const first = selection.click('p', { x: 1, y: 2, z: 3 });
    expect(first.slot).toBe(1);
    expect(first.volume).toBeUndefined();
    const second = selection.click('p', { x: 4, y: 6, z: 8 });
    expect(second.slot).toBe(2);
    expect(second.volume).toEqual(volumeFromCorners({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 8 }));
    expect(formatCuboidSize(cuboidSizeOf(second.volume!))).toBe('4 × 5 × 6');
    const restart = selection.click('p', { x: 0, y: 0, z: 0 });
    expect(restart.slot).toBe(1);
    expect(selection.volume('p')).toBeUndefined();
  });

  it('tracks wand mode separately from the cuboid corners', () => {
    const selection = new PlayerSelectionService();
    expect(selection.isWandActive('p')).toBe(false);
    selection.activateWand('p');
    expect(selection.isWandActive('p')).toBe(true);
    selection.click('p', { x: 1, y: 1, z: 1 });
    selection.click('p', { x: 2, y: 2, z: 2 });
    selection.clear('p');
    expect(selection.volume('p')).toBeUndefined();
    expect(selection.isWandActive('p')).toBe(true);
    selection.forget('p');
    expect(selection.isWandActive('p')).toBe(false);
  });
});
