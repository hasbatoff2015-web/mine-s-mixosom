import { describe, expect, it } from 'vitest';
import { itemHeldMeshKind, itemIconDescriptor, ITEMS, SPECIAL_ICON_POSES, usesCanonicalSpecialPreview } from '../src/items';
import { SPECIAL_ICON_PREVIEW_POLICY } from '../src/rendering/itemIconPreview';
import { specialPreviewEntityTexturePaths } from '../src/rendering/ItemVisualFactory';
import { CHEST_TEXTURE_KEY } from '../src/rendering/chestModel';

describe('generic special preview contract', () => {
  it('routes every special_model through special_preview + shared auto-fit pose', () => {
    const specials = ITEMS.filter((item) => itemHeldMeshKind(item) === 'special_model');
    expect(specials.length).toBeGreaterThan(0);
    for (const item of specials) {
      const descriptor = itemIconDescriptor(item);
      expect(descriptor.kind, item.id).toBe('special_preview');
      expect(usesCanonicalSpecialPreview(item), item.id).toBe(true);
      expect(descriptor.category, item.id).toBeDefined();
      const pose = SPECIAL_ICON_POSES[descriptor.category ?? 'generic'];
      expect(pose, item.id).toBeDefined();
      expect(pose).not.toHaveProperty('scale');
      expect(pose).not.toHaveProperty('brightness');
      expect(pose.rotationDeg).toEqual(SPECIAL_ICON_POSES.generic.rotationDeg);
    }
    expect(itemIconDescriptor('chest')).toEqual({ kind: 'special_preview', category: 'chest' });
    expect(SPECIAL_ICON_POSES.generic).toEqual(SPECIAL_ICON_POSES.stairs);
  });

  it('uses one unlit sRGB preview policy without world-light shaders', () => {
    expect(SPECIAL_ICON_PREVIEW_POLICY.autoFit).toBe(true);
    expect(SPECIAL_ICON_PREVIEW_POLICY.colorSpace).toBe('srgb');
    expect(SPECIAL_ICON_PREVIEW_POLICY.unlitMaterial).toBe(true);
    expect(SPECIAL_ICON_PREVIEW_POLICY.stripsWorldLight).toBe(true);
    expect(SPECIAL_ICON_PREVIEW_POLICY.programCacheKey).toBe('special-icon-preview-unlit-v1');
  });

  it('preloads entity textures used by special previews (chest) without brightness hacks', () => {
    expect(specialPreviewEntityTexturePaths()).toContain(CHEST_TEXTURE_KEY);
    expect(CHEST_TEXTURE_KEY).toBe('entity/chest/normal');
  });
});
