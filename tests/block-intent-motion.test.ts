import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { viewDirectionFromLook } from '../src/player/localAim';
import { angularError } from '../shared/playerActions';
import { validateBlockTargetIntent } from '../src/gameplay/actionValidation';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

describe('block intent vs delayed server ray', () => {
  it('walking / jump / flick still validate client target A', () => {
    const world = new VoxelWorld('intent-move');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    chunk.set(5, 40, 5, BlockId.Stone);
    chunk.set(5, 41, 5, BlockId.OakLog);
    chunk.set(5, 42, 5, BlockId.OakLog);
    const eyes = [
      { x: 5.5, y: 41.62, z: 3.5 },
      { x: 5.2, y: 41.62, z: 3.4 },
      { x: 5.8, y: 42.1, z: 3.6 },
    ];
    const intent = {
      targetX: 5, targetY: 41, targetZ: 5,
      faceX: 0, faceY: 0, faceZ: -1,
      hitX: 5.5, hitY: 41.5, hitZ: 5,
    };
    for (const eye of eyes) {
      const result = validateBlockTargetIntent(world, eye, intent);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.hit.y).toBe(41);
    }
  });
});

describe('bow captured aim', () => {
  it('later yaw cannot change a captured release direction', () => {
    const captured = { yaw: 0.25, pitch: -0.1 };
    const later = { yaw: 1.4, pitch: 0.3 };
    const dir = viewDirectionFromLook(captured.yaw, captured.pitch);
    const laterDir = viewDirectionFromLook(later.yaw, later.pitch);
    expect(dir.distanceTo(laterDir)).toBeGreaterThan(0.5);
    expect(angularError(captured.yaw, captured.pitch, captured.yaw, captured.pitch)).toBeLessThan(1e-9);
  });
});
