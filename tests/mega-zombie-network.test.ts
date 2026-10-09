import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import {
  DroppedItemManager,
  FallingBlockManager,
  HeadlessEntityHost,
  MinecartManager,
  MobManager,
} from '../src/entities';
import { MEGA_ZOMBIE_MAX_HEALTH } from '../src/entities/megaZombie';
import { createThreeEntityHost } from '../src/entities/ThreeEntityHost';
import { Vec3 } from '../src/math/vec3';
import { applyEntitySnapshots } from '../src/net/applyEntitySnapshots';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { RedstoneSystem } from '../src/redstone';
import { VoxelWorld } from '../src/world/World';
import { EventBus } from '../server/events';
import { ServerGameplay } from '../server/gameplay';

function clientSession(world: VoxelWorld) {
  const scene = new THREE.Scene();
  const visuals = new ItemVisualFactory();
  const mobs = new MobManager(scene, world, { automaticSpawning: false });
  return {
    scene,
    drops: new DroppedItemManager(scene, world, { visualFactory: visuals }),
    falling: new FallingBlockManager(scene, world, visuals),
    mobs,
    arrows: new PlayerArrowManager(scene, world, mobs),
    minecarts: new MinecartManager(scene, world, visuals),
    redstone: new RedstoneSystem(world, { host: createThreeEntityHost(scene, { itemVisuals: visuals }) }),
  };
}

describe('mega zombie replication', () => {
  it('replicates spawn, health, fire, death, and a late join beyond interest radius', () => {
    const world = new VoxelWorld('mega-net');
    const gameplay = new ServerGameplay(world, new EventBus());
    const boss = gameplay.mobs.spawn('mega_zombie', new Vec3(4, 70, 4), { force: true, id: 'mega-net' })!;
    boss.fireTicks = 40;
    const far = gameplay.snapshotsNear(new Vec3(4, 70, 80));
    const snap = far.find((entity) => entity.id === 'mega-net');
    expect(snap).toMatchObject({
      kind: 'mob',
      mobKind: 'mega_zombie',
      health: MEGA_ZOMBIE_MAX_HEALTH,
      maxHealth: MEGA_ZOMBIE_MAX_HEALTH,
      onFire: true,
    });

    const session = clientSession(world);
    applyEntitySnapshots(session, far);
    const client = session.mobs.get('mega-net');
    expect(client).toBeDefined();
    expect(client?.health).toBe(MEGA_ZOMBIE_MAX_HEALTH);
    expect(client?.isOnFire).toBe(true);
    session.mobs.interpolateVisuals(1);
    const visual = client?.visual as THREE.Object3D;
    expect(visual.scale.x).toBeCloseTo(1.3);
    expect(visual.getObjectByName('mob:mega_zombie:forearm1')?.parent?.name).toBe('mob:mega_zombie:arm1');
    expect(visual.getObjectByName('mob:mega_zombie:arm1')?.parent?.name).toBe('mob:mega_zombie:chest');
    expect(visual.getObjectByName('mob:mega_zombie:chest')?.parent?.name).toBe('mob:mega_zombie:waist');
    expect(visual.getObjectByName('mob:mega_zombie:foreleg1')?.parent?.name).toBe('mob:mega_zombie:leg1');
    expect(visual.getObjectByName('mob:mega_zombie:leg1')?.parent?.name).toBe('mob:mega_zombie:pelvis');
    expect(visual.getObjectByName('mob:mega_zombie:head')?.parent?.name).toBe('mob:mega_zombie:chest');
    const overlay = visual.getObjectByName('fire-overlay');
    expect(overlay?.visible).toBe(true);
    expect(overlay?.children.length).toBeGreaterThan(1);

    boss.health = 1500;
    boss.fireTicks = 0;
    boss.contactBurning = false;
    boss.sunlightBurning = false;
    applyEntitySnapshots(session, gameplay.snapshotsNear(new Vec3(4, 70, 4)));
    expect(client?.health).toBe(1500);
    expect(client?.isOnFire).toBe(false);

    boss.health = 0;
    boss.state = 'die';
    applyEntitySnapshots(session, gameplay.snapshotsNear(new Vec3(4, 70, 4)));
    expect(client?.state).toBe('die');

    gameplay.mobs.remove(boss.id);
    session.mobs.tickRemoteVisuals(1.3);
    applyEntitySnapshots(session, gameplay.snapshotsNear(new Vec3(4, 70, 4)));
    expect(session.mobs.get('mega-net')).toBeUndefined();
    session.mobs.dispose();
  });

  it('spawns item entities for boss loot and three firework rockets', () => {
    const world = new VoxelWorld('mega-loot-net');
    const gameplay = new ServerGameplay(world, new EventBus());
    const ids = gameplay.scatterBossLoot([
      { itemId: 'diamond', count: 8 },
      { itemId: 'coal', count: 20 },
    ], new Vec3(10, 70, 10));
    expect(ids).toHaveLength(2);
    const items = [...gameplay.drops.entities];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(Math.abs(item.position.x - 10)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(item.position.z - 10)).toBeLessThanOrEqual(0.5);
      expect(item.velocity.y).toBeGreaterThanOrEqual(7.5);
      expect(Math.abs(item.velocity.x)).toBeGreaterThan(0);
    }
    gameplay.launchBossFireworks(new Vec3(10, 70, 10));
    expect(gameplay.fireworks.entities).toHaveLength(3);
    const rockets = gameplay.snapshotsNear(new Vec3(10, 70, 10)).filter((entity) => entity.kind === 'firework');
    expect(rockets).toHaveLength(3);
  });

  it('uses one headless host on the server', () => {
    const gameplay = new ServerGameplay(new VoxelWorld('mega-host'), new EventBus());
    expect(gameplay.host).toBeInstanceOf(HeadlessEntityHost);
  });
});
