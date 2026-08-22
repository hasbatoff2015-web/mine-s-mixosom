import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SPECIAL_ICON_FILL,
  SPECIAL_ICON_POSES,
  orthographicFitExtent,
} from '../src/items/itemIcons';
import { inventoryPaintMode, patchInventoryDynamic } from '../src/ui/inventoryLayout';
import {
  prepareSpecialIconPreview,
  specialIconFaceShade,
} from '../src/rendering/itemIconPreview';
import { bindEntityLightReceiver, createEntityMaterial } from '../src/rendering/worldLighting';

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

describe('special icon preview lighting', () => {
  it('keeps GUI face shades in a bright readable range', () => {
    expect(specialIconFaceShade(0, 1, 0)).toBe(1);
    expect(specialIconFaceShade(0, -1, 0)).toBeGreaterThanOrEqual(0.75);
    expect(specialIconFaceShade(0, 0, 1)).toBeGreaterThan(specialIconFaceShade(1, 0, 0));
    expect(specialIconFaceShade(1, 0, 0)).toBeGreaterThanOrEqual(0.8);
  });

  it('clones preview material and drops entity-light hooks without mutating the source', () => {
    const source = createEntityMaterial();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, source);
    bindEntityLightReceiver(mesh);
    const compile = source.onBeforeCompile;
    const hookedRender = mesh.onBeforeRender;
    const entityCacheKey = source.customProgramCacheKey();
    prepareSpecialIconPreview(mesh);
    const preview = mesh.material as THREE.MeshBasicMaterial;
    expect(mesh.material).not.toBe(source);
    expect(source.onBeforeCompile).toBe(compile);
    expect(source.customProgramCacheKey()).toBe(entityCacheKey);
    expect(preview.vertexColors).toBe(true);
    expect(preview.fog).toBe(false);
    expect(preview.toneMapped).toBe(false);
    expect(preview.customProgramCacheKey()).toBe('special-icon-preview-unlit-v1');
    expect(mesh.onBeforeRender).not.toBe(hookedRender);
    expect(mesh.geometry).not.toBe(geometry);
    expect(mesh.geometry.getAttribute('color')).toBeDefined();
    geometry.dispose();
    mesh.geometry.dispose();
    source.dispose();
    preview.dispose();
  });
});
