import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import {
  DroppedItemManager,
  FallingBlockManager,
  MinecartManager,
  MobManager,
} from '../src/entities';
import { creeperFuseVisualScale } from '../src/entities/ThreeEntityHost';
import { applyEntitySnapshots } from '../src/net/applyEntitySnapshots';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { RedstoneSystem } from '../src/redstone';
import { createThreeEntityHost } from '../src/entities/ThreeEntityHost';
import { VoxelWorld } from '../src/world/World';
import { EventBus } from '../server/events';
import { ServerGameplay } from '../server/gameplay';
import { Vec3 } from '../src/math/vec3';

function clientSession(world: VoxelWorld) {
  const scene = new THREE.Scene();
  const visuals = new ItemVisualFactory();
  const mobs = new MobManager(scene, world, { automaticSpawning: false });
  return {
    drops: new DroppedItemManager(scene, world, { visualFactory: visuals }),
    falling: new FallingBlockManager(scene, world, visuals),
    mobs,
    arrows: new PlayerArrowManager(scene, world, mobs),
    minecarts: new MinecartManager(scene, world, visuals),
    redstone: new RedstoneSystem(world, { host: createThreeEntityHost(scene, { itemVisuals: visuals }) }),
  };
}

function expectCreeperScale(visual: THREE.Object3D, fuseSeconds: number): void {
  const [x, y, z] = creeperFuseVisualScale(fuseSeconds);
  expect(visual.scale.x).toBeCloseTo(x);
  expect(visual.scale.y).toBeCloseTo(y);
  expect(visual.scale.z).toBeCloseTo(z);
}

describe('multiplayer creeper fuse', () => {
  it('carries fuseSeconds through the snapshot into the existing swell', () => {
    const world = new VoxelWorld('creeper-fuse-net');
    const gameplay = new ServerGameplay(world, new EventBus());
    const serverCreeper = gameplay.mobs.spawn('creeper', new THREE.Vector3(4, 70, 4), {
      force: true,
      id: 'creep-1',
    })!;
    gameplay.mobs.spawn('zombie', new THREE.Vector3(6, 70, 4), { force: true, id: 'zombie-1' });
    serverCreeper.fuseSeconds = 0.75;

    const origin = new Vec3(4, 70, 4);
    const first = gameplay.snapshotsNear(origin);
    const creepSnap = first.find((snapshot) => snapshot.id === 'creep-1');
    const zombieSnap = first.find((snapshot) => snapshot.id === 'zombie-1');
    expect(creepSnap).toMatchObject({ kind: 'mob', mobKind: 'creeper', fuse: 0.75 });
    expect(zombieSnap?.fuse).toBeUndefined();

    const session = clientSession(world);
    applyEntitySnapshots(session, first);
    const clientCreeper = session.mobs.get('creep-1')!;
    expect(clientCreeper.fuseSeconds).toBe(0.75);
    expect(session.mobs.get('zombie-1')?.fuseSeconds).toBe(0);
    session.mobs.interpolateVisuals(1);
    const visual = clientCreeper.visual as THREE.Object3D;
    expectCreeperScale(visual, 0.75);
    expect(visual.scale.y).toBeGreaterThan(1);

    serverCreeper.fuseSeconds = 1.2;
    applyEntitySnapshots(session, gameplay.snapshotsNear(origin));
    expect(clientCreeper.fuseSeconds).toBe(1.2);
    session.mobs.interpolateVisuals(1);
    expectCreeperScale(visual, 1.2);
    expect(visual.scale.y).toBeGreaterThan(creeperFuseVisualScale(0.75)[1]);

    serverCreeper.fuseSeconds = 0;
    const cleared = gameplay.snapshotsNear(origin).find((snapshot) => snapshot.id === 'creep-1');
    expect(cleared?.fuse).toBe(0);
    applyEntitySnapshots(session, gameplay.snapshotsNear(origin));
    expect(clientCreeper.fuseSeconds).toBe(0);
    session.mobs.interpolateVisuals(1);
    expectCreeperScale(visual, 0);
    expect(visual.scale.toArray()).toEqual([1, 1, 1]);

    applyEntitySnapshots(session, [{
      id: 'creep-1', kind: 'mob', mobKind: 'creeper', x: 4, y: 70, z: 4, fuse: 0.4,
    }]);
    expect(clientCreeper.fuseSeconds).toBe(0.4);
    applyEntitySnapshots(session, [{
      id: 'creep-1', kind: 'mob', mobKind: 'creeper', x: 4, y: 70, z: 4,
    }]);
    expect(clientCreeper.fuseSeconds).toBe(0);
    session.mobs.interpolateVisuals(1);
    expectCreeperScale(visual, 0);
    session.mobs.dispose();
  });
});
