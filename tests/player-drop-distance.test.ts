import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import {
  PLAYER_DROP_HOP,
  PLAYER_DROP_HORIZONTAL_SPEED,
  PLAYER_DROP_LOOK_SPEED,
  DroppedItemManager,
  playerDropVelocity,
} from '../src/entities/DroppedItemManager';
import { HeadlessEntityHost } from '../src/entities';
import { Vec3 } from '../src/math/vec3';
import { VoxelWorld } from '../src/world/World';

function runway(): VoxelWorld {
  const world = new VoxelWorld('player-drop-runway');
  for (let x = 0; x < 64; x += 1) {
    for (let z = 4; z <= 12; z += 1) world.setBlock(x, 20, z, BlockId.Stone);
  }
  return world;
}

function landX(manager: DroppedItemManager, id: string): number {
  const entity = manager.get(id);
  if (!entity) throw new Error('missing drop');
  for (let tick = 0; tick < 200 && !entity.onGround; tick += 1) manager.update(FIXED_DT);
  return entity.position.x;
}

describe('player item throw', () => {
  it('doubles horizontal travel and keeps the vertical hop', () => {
    expect(PLAYER_DROP_HORIZONTAL_SPEED).toBe(6.4);
    expect(PLAYER_DROP_LOOK_SPEED).toBe(3.2);
    expect(PLAYER_DROP_HOP).toBe(1.6);

    const level = playerDropVelocity({ x: 1, y: 0, z: 0 });
    expect(level.x).toBeCloseTo(6.4, 5);
    expect(level.y).toBeCloseTo(1.6, 5);
    expect(level.z).toBeCloseTo(0, 5);

    const up = playerDropVelocity({ x: 0, y: 1, z: 0 });
    expect(up.x).toBeCloseTo(0, 5);
    expect(up.z).toBeCloseTo(0, 5);
    expect(up.y).toBeCloseTo(PLAYER_DROP_LOOK_SPEED + PLAYER_DROP_HOP, 5);
    expect(up.y).toBeLessThan(6);

    const down = playerDropVelocity({ x: 0, y: -1, z: 0 });
    expect(down.x).toBeCloseTo(0, 5);
    expect(down.y).toBeCloseTo(-PLAYER_DROP_LOOK_SPEED + PLAYER_DROP_HOP, 5);

    const diagonal = playerDropVelocity({ x: 1, y: 1, z: 0 });
    const length = Math.hypot(1, 1);
    expect(diagonal.x).toBeCloseTo((1 / length) * PLAYER_DROP_HORIZONTAL_SPEED, 5);
    expect(diagonal.y).toBeCloseTo((1 / length) * PLAYER_DROP_LOOK_SPEED + PLAYER_DROP_HOP, 5);

    const world = runway();
    const manager = new DroppedItemManager(new HeadlessEntityHost(), world, { pickupDelaySeconds: 30 });
    const origin = new Vec3(2.5, 21.2, 8.5);
    const tossed = manager.drop({ itemId: 'cobblestone', count: 1 }, origin, { x: 1, y: 0, z: 0 });
    const previous = manager.spawn(
      { itemId: 'dirt', count: 1 },
      origin.clone(),
      { velocity: new Vec3(3.2, PLAYER_DROP_HOP, 0), pickupDelaySeconds: 30 },
    );
    expect(tossed.stack.count).toBe(1);
    expect(tossed.pickupDelaySeconds).toBeCloseTo(1.25, 5);
    const tossedX = landX(manager, tossed.id);
    const previousX = landX(manager, previous.id);
    const tossedDistance = tossedX - origin.x;
    const previousDistance = previousX - origin.x;
    expect(previousDistance).toBeGreaterThan(0.5);
    expect(tossedDistance / previousDistance).toBeGreaterThan(1.8);
    expect(tossedDistance / previousDistance).toBeLessThan(2.2);
    expect(manager.get(tossed.id)?.stack.count).toBe(1);
    expect(manager.get(previous.id)?.stack.count).toBe(1);
  });
});