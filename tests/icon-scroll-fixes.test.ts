import { describe, expect, it } from 'vitest';
import {
  SPECIAL_ICON_FILL,
  SPECIAL_ICON_POSES,
  orthographicFitExtent,
} from '../src/items/itemIcons';
import { inventoryPaintMode, patchInventoryDynamic } from '../src/ui/inventoryLayout';

describe('special icon auto-fit', () => {
  it('uses one shared rotation and no per-item padding', () => {
    const rotations = Object.values(SPECIAL_ICON_POSES).map((pose) => pose.rotationDeg.join(','));
    expect(new Set(rotations).size).toBe(1);
    expect(SPECIAL_ICON_POSES.stairs).not.toHaveProperty('padding');
    expect(SPECIAL_ICON_POSES.button).not.toHaveProperty('padding');
  });

  it('fits the dominant XY size to the fill fraction, independent of material', () => {
    const cube = orthographicFitExtent(1, 1);
    expect(cube).toBeCloseTo(0.5 / SPECIAL_ICON_FILL, 6);
    const button = orthographicFitExtent(0.25, 0.25);
    expect(button).toBeLessThan(cube * 0.4);
    const plate = orthographicFitExtent(1, 0.4);
    expect(plate).toBeCloseTo(cube, 6);
    const oldSpherePadding = Math.sqrt(3) / 2 * 1.18;
    expect(cube).toBeLessThan(oldSpherePadding * 0.75);
  });
});

describe('creative inventory scroll lifecycle', () => {
  it('patches an open inventory instead of remounting', () => {
    expect(inventoryPaintMode(false)).toBe('mount');
    expect(inventoryPaintMode(true)).toBe('patch-dynamic');
  });

  it('keeps catalog identity and scrollTop when patching dynamic panels', () => {
    const catalog = { id: 'catalog', innerHTML: 'catalog' };
    const dynamic = { innerHTML: 'before' };
    const cursor = { innerHTML: '' };
    const windowEl = {
      scrollTop: 700,
      catalog,
      querySelector(selector: string) {
        if (selector === '[data-inventory-dynamic]') return dynamic;
        if (selector === '#cursor-stack') return cursor;
        if (selector === '[data-creative-catalog]') return catalog;
        return null;
      },
    };
    expect(patchInventoryDynamic(windowEl, '<div>after</div>', 'held')).toBe(true);
    expect(windowEl.scrollTop).toBe(700);
    expect(windowEl.catalog).toBe(catalog);
    expect(dynamic.innerHTML).toBe('<div>after</div>');
    expect(cursor.innerHTML).toBe('held');
  });
});
