import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId, type BlockRenderState } from '../src/blocks';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { MobManager } from '../src/entities/MobManager';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));
function fixture(owner: 'player' | 'skeleton', block = BlockId.Stone, state?: BlockRenderState) {
  const world = new VoxelWorld('embedded-support');
  const chunk = new Chunk(0, 0); world.chunks.set('0,0', chunk);
  chunk.set(8, 40, 8, block);
  if (state) world.setBlockState(8, 40, 8, state);
  const scene = new THREE.Scene();
  const mobs = new MobManager(scene, world, { automaticSpawning: false, random: () => 0.5 });
  const player = new PlayerArrowManager(scene, world, mobs, { random: () => 0.5 });
  cleanup.push(() => { player.dispose(); mobs.dispose(); });
  let arrow: any;
  if (owner === 'player') {
    player.spawn(new THREE.Vector3(8.5, 40.5, 10.5), new THREE.Vector3(0, 0, -1), 3, 6, false);
    arrow = (player as any).arrows[0];
  } else {
    const mob = mobs.spawn('skeleton', new THREE.Vector3(8.5, 39, 12.5), { force: true })!;
    (mobs as any).spawnArrow(mob, new THREE.Vector3(8.5, 40.5, 0), {});
    arrow = [...(mobs as any).projectiles.values()][0];
    arrow.position.set(8.5, 40.5, 10.5);
  }
  arrow.velocity.set(0, 0, -3);
  const tick = () => owner === 'player' ? player.tick(0.05) : (mobs as any).updateProjectiles(0.05, undefined, {});
  tick(); expect(arrow.inGround).toBe(true);
  return { world, arrow, tick };
}
describe.each(['player', 'skeleton'] as const)('%s embedded support', (owner) => {
  it('retains pose on unchanged solid support, including stable quaternion', () => {
    const { arrow, tick } = fixture(owner);
    const before = arrow.position.clone(), rotation = arrow.visual.quaternion.clone();
    for (let i = 0; i < 20; i++) tick();
    expect(arrow.position.equals(before)).toBe(true);
    expect(arrow.visual.quaternion.equals(rotation)).toBe(true);
  });
  it.each([BlockId.Air, BlockId.Water])('releases after support becomes %s, using existing gravity/drag and mesh', (block) => {
    const { world, arrow, tick } = fixture(owner);
    const visual = arrow.visual, geometry = visual.geometry, beforeY = arrow.position.y;
    expect(arrow.embedded.impactVelocity.z).toBe(-3);
    world.applyBlockBatch([{ x: 8, y: 40, z: 8, block }], { deferLighting: true });
    tick();
    expect(arrow.inGround).toBe(false);
    expect(arrow.velocity.y).toBeLessThan(0);
    expect(Math.abs(arrow.velocity.z)).toBeLessThanOrEqual(0.6);
    tick(); tick();
    expect(arrow.position.y).toBeLessThan(beforeY);
    expect(arrow.visual).toBe(visual); expect(arrow.visual.geometry).toBe(geometry);
    expect(arrow.embedded).toBeUndefined();
  });
  it('releases when a door changes shape away from the recorded impact point', () => {
    const { world, arrow, tick } = fixture(owner, BlockId.OakDoor, { facing: 'north', open: false });
    world.setBlockState(8, 40, 8, { facing: 'north', open: true });
    tick();
    expect(arrow.inGround).toBe(false);
  });
  it('does not release just because an unrelated block changed', () => {
    const { world, arrow, tick } = fixture(owner);
    world.setBlock(9, 40, 8, BlockId.Glass);
    tick(); expect(arrow.inGround).toBe(true);
  });
});
