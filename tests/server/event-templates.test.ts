import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { VoxelWorld } from '../../src/world/World';
import { volumeFromCorners } from '../../server/services/selection';
import {
  captureTemplateFromWorld,
  createDefaultChestShrineTemplate,
  placedVolume,
  rotateFacing,
  rotateOffset,
  parseEventTemplateName,
} from '../../server/services/eventTemplates';

describe('event templates', () => {
  it('parses names and ships a 5×5 default shrine anchored on the chest', () => {
    expect(parseEventTemplateName('Chest_Shrine')).toBe('chest_shrine');
    expect(parseEventTemplateName('../x')).toBeUndefined();
    const template = createDefaultChestShrineTemplate();
    expect(template.width).toBe(5);
    expect(template.depth).toBe(5);
    expect(template.blocks.some((cell) => cell.dx === 0 && cell.dy === 0 && cell.dz === 0 && cell.blockId === BlockId.EventChest)).toBe(true);
    const volume = placedVolume(template, { x: 10, y: 40, z: 10 }, 0);
    expect(volume.maxX - volume.minX).toBe(4);
    expect(volume.maxZ - volume.minZ).toBe(4);
  });

  it('rotates offsets and chest facing by 90° steps around the anchor', () => {
    expect(rotateOffset(0, 1, -2, 90)).toEqual({ x: 2, y: 1, z: 0 });
    expect(rotateOffset(0, 1, -2, 180)).toEqual({ x: 0, y: 1, z: 2 });
    expect(rotateOffset(0, 1, -2, 270)).toEqual({ x: -2, y: 1, z: 0 });
    expect(rotateFacing('north', 90)).toBe('east');
    expect(rotateFacing('north', 180)).toBe('south');
    expect(rotateFacing('east', 270)).toBe('north');
    const template = createDefaultChestShrineTemplate();
    const rotated = placedVolume(template, { x: 0, y: 40, z: 0 }, 90);
    expect(rotated.minX).toBe(-2);
    expect(rotated.maxX).toBe(2);
  });

  it('saves a template only when the selection contains exactly one chest', () => {
    const world = new VoxelWorld('template-save');
    world.setBlock(4, 40, 4, BlockId.StoneBricks);
    world.setBlock(5, 40, 5, BlockId.StoneBricks);
    const volume = volumeFromCorners({ x: 4, y: 40, z: 4 }, { x: 6, y: 42, z: 6 });
    expect(captureTemplateFromWorld(world, volume, 'empty').ok).toBe(false);

    world.setBlock(5, 41, 5, BlockId.Chest);
    const one = captureTemplateFromWorld(world, volume, 'shrine');
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.template.name).toBe('shrine');
      expect(one.template.blocks.some((cell) => cell.dx === 0 && cell.dy === 0 && cell.dz === 0)).toBe(true);
    }

    world.setBlock(6, 41, 6, BlockId.Chest);
    const two = captureTemplateFromWorld(world, volume, 'shrine');
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error).toMatch(/ровно один/);
  });
});
