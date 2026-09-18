import * as THREE from 'three';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getItemDefinition, itemHeldMeshKind, itemIconDescriptor } from '../src/items';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { FARMLAND_BOX } from '../src/rendering/specialBlockGeometry';
import { BED_SHEET_KEY } from '../src/rendering/TextureAtlas';

function modelSize(itemId: string): THREE.Vector3 {
  const model = new ItemVisualFactory().createItemModel(itemId);
  const mesh = model.children[0] as THREE.Mesh;
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
}

describe('utility inventory icons', () => {
  it('uses a 3D bed preview from the entity sheet, not white wool', () => {
    expect(itemHeldMeshKind('white_bed')).toBe('special_model');
    expect(itemIconDescriptor('white_bed')).toEqual({ kind: 'special_preview', category: 'generic' });
    expect(getItemDefinition('white_bed').texture).not.toBe('block/white_wool');
    expect(getItemDefinition('white_bed').texture).not.toBe('item/white_wool');
    const size = modelSize('white_bed');
    expect(size.z).toBeGreaterThan(size.y);
    expect(size.z).toBeGreaterThan(1.2);
    expect(BED_SHEET_KEY).toBe('entity/bed/white');
  });

  it('uses the tall oak door item sprite with preserved aspect', () => {
    expect(itemHeldMeshKind('oak_door')).toBe('generated');
    expect(itemIconDescriptor('oak_door')).toEqual({
      kind: 'texture',
      texturePath: 'item/oak_door',
      preserveAspect: true,
    });
    expect(existsSync(join(process.cwd(), 'public/textures/item/oak_door.png'))).toBe(true);
  });

  it('bakes farmland as a shallow 3D block with distinct top and side textures', () => {
    expect(itemHeldMeshKind('farmland')).toBe('special_model');
    expect(itemIconDescriptor('farmland')).toEqual({ kind: 'special_preview', category: 'generic' });
    const mesh = new ItemVisualFactory().createItemModel('farmland').children[0] as THREE.Mesh;
    expect(mesh.geometry.userData.iconBlockHeight).toBeCloseTo(15 / 16);
    expect(mesh.geometry.userData.iconTopTexture).toBe('block/farmland');
    expect(mesh.geometry.userData.iconSideTexture).toBe('block/dirt');
    expect(mesh.geometry.userData.iconTopTexture).not.toBe(mesh.geometry.userData.iconSideTexture);
    const size = modelSize('farmland');
    expect(size.y).toBeCloseTo(FARMLAND_BOX.maxY - FARMLAND_BOX.minY);
    expect(size.y).toBeLessThan(1);
  });

  it('uses the vanilla sugar cane item sprite instead of a block tile', () => {
    expect(itemHeldMeshKind('sugar_cane')).toBe('generated');
    expect(itemIconDescriptor('sugar_cane')).toEqual({
      kind: 'texture',
      texturePath: 'item/sugar_cane',
      preserveAspect: true,
    });
    expect(getItemDefinition('sugar_cane').texture).not.toBe('block/sugar_cane');
    expect(existsSync(join(process.cwd(), 'public/textures/item/sugar_cane.png'))).toBe(true);
  });

  it('leaves common icons on their previous descriptors', () => {
    expect(itemIconDescriptor('cobblestone')).toEqual({ kind: 'special_preview', category: 'generic' });
    expect(itemIconDescriptor('oak_planks').kind).toBe('special_preview');
    expect(itemIconDescriptor('diamond_sword')).toEqual({ kind: 'texture', texturePath: 'item/diamond_sword' });
    expect(itemIconDescriptor('apple')).toEqual({ kind: 'texture', texturePath: 'item/apple' });
  });
});
