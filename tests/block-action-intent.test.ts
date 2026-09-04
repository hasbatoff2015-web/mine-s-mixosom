import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  resolveClientTargetVersusServerRay,
  validateBlockTargetIntent,
} from '../src/gameplay/actionValidation';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { Vec3 } from '../src/math/vec3';

function stoneWorld() {
  const world = new VoxelWorld('block-intent');
  const chunk = new Chunk(0, 0);
  world.chunks.set('0,0', chunk);
  chunk.set(5, 40, 5, BlockId.Stone);
  chunk.set(5, 41, 5, BlockId.OakLog);
  chunk.set(5, 42, 5, BlockId.OakLog);
  return world;
}

const eye = { x: 5.5, y: 41.62, z: 3.5 };

function intentFor(x: number, y: number, z: number, face = { x: 0, y: 0, z: -1 }) {
  return {
    targetX: x,
    targetY: y,
    targetZ: z,
    faceX: face.x,
    faceY: face.y,
    faceZ: face.z,
    hitX: x + 0.5,
    hitY: y + 0.5,
    hitZ: z + 0.5 + face.z * 0.5,
  };
}

describe('block action intent contract', () => {
  it('accepts a valid client target', () => {
    const world = stoneWorld();
    const result = validateBlockTargetIntent(world, eye, intentFor(5, 41, 5));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hit.x).toBe(5);
      expect(result.value.hit.y).toBe(41);
      expect(result.value.hit.z).toBe(5);
    }
  });

  it('rejects an invalid face instead of guessing', () => {
    const world = stoneWorld();
    const result = validateBlockTargetIntent(world, eye, {
      ...intentFor(5, 41, 5),
      faceX: 0.3, faceY: 0.3, faceZ: 0.3,
    });
    expect(result).toEqual({ ok: false, reason: 'face' });
  });

  it('rejects a non-finite hit', () => {
    const world = stoneWorld();
    const result = validateBlockTargetIntent(world, eye, {
      ...intentFor(5, 41, 5),
      hitX: Number.NaN, hitY: 41.5, hitZ: 5,
    });
    expect(result).toEqual({ ok: false, reason: 'hit' });
  });

  it('rejects out of reach', () => {
    const world = stoneWorld();
    const result = validateBlockTargetIntent(world, eye, intentFor(5, 41, 5), { reach: 0.2 });
    expect(result).toEqual({ ok: false, reason: 'reach' });
  });

  it('rejects empty / stale target', () => {
    const world = stoneWorld();
    const result = validateBlockTargetIntent(world, eye, intentFor(6, 41, 5));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason === 'empty' || result.reason === 'los').toBe(true);
  });

  it('never substitutes server current ray B for client target A', () => {
    const client = { x: 5, y: 41, z: 5 };
    const serverRay = { x: 5, y: 42, z: 5 };
    const resolved = resolveClientTargetVersusServerRay(client, serverRay);
    expect(resolved.mode).toBe('accept-client');
    expect(resolved.client).toEqual(client);
    expect(resolved.serverRay).toEqual(serverRay);
  });

  it('LOS toward A does not silently become B', () => {
    const world = stoneWorld();
    const a = intentFor(5, 41, 5);
    const validated = validateBlockTargetIntent(world, eye, a);
    expect(validated.ok).toBe(true);
    const serverRay = world.raycast(
      new Vec3(eye.x, eye.y, eye.z),
      new Vec3(0, 0.4, 1),
      8,
    );
    if (validated.ok) {
      const decision = resolveClientTargetVersusServerRay(
        { x: validated.value.hit.x, y: validated.value.hit.y, z: validated.value.hit.z },
        serverRay ? { x: serverRay.x, y: serverRay.y, z: serverRay.z } : undefined,
      );
      expect(decision.client.y).toBe(41);
      expect(decision.client.y).not.toBe(42);
    }
  });
});
