import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import {
  DROPPED_ITEM_VISUALS_PER_FRAME,
  DroppedItemManager,
  FallingBlockManager,
  HeadlessEntityHost,
  MinecartManager,
  MobManager,
} from '../src/entities';
import { MEGA_ZOMBIE_LOOT_ORIGIN_RADIUS, MEGA_ZOMBIE_LOOT_UP_MIN, MEGA_ZOMBIE_MAX_HEALTH } from '../src/entities/megaZombie';
import { rollMegaZombieLoot } from '../src/entities/megaZombieLoot';
import { createItemStack } from '../src/inventory';
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

  it('spawns split item entities for boss loot and three staggered firework rockets', () => {
    const world = new VoxelWorld('mega-loot-net');
    const gameplay = new ServerGameplay(world, new EventBus());
    const rolled = rollMegaZombieLoot(() => 0);
    const ids = gameplay.scatterBossLoot(rolled, new Vec3(10, 70, 10));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(rolled.length);
    const items = [...gameplay.drops.entities];
    expect(items).toHaveLength(ids.length);
    for (const item of items) {
      expect(Math.abs(item.position.x - 10)).toBeLessThanOrEqual(MEGA_ZOMBIE_LOOT_ORIGIN_RADIUS + 1e-6);
      expect(Math.abs(item.position.z - 10)).toBeLessThanOrEqual(MEGA_ZOMBIE_LOOT_ORIGIN_RADIUS + 1e-6);
      expect(item.velocity.y).toBeGreaterThanOrEqual(MEGA_ZOMBIE_LOOT_UP_MIN);
      expect(Math.abs(item.velocity.x) + Math.abs(item.velocity.z)).toBeGreaterThan(0);
    }
    gameplay.launchBossFireworks(new Vec3(10, 70, 10));
    expect(gameplay.fireworks.entities).toHaveLength(3);
    expect(gameplay.fireworks.entities.map((rocket) => rocket.flight).sort()).toEqual([1, 2, 3]);
    const rockets = gameplay.snapshotsNear(new Vec3(10, 70, 10)).filter((entity) => entity.kind === 'firework');
    expect(rockets).toHaveLength(3);

    const session = clientSession(world);
    const serverCount = gameplay.drops.count;
    applyEntitySnapshots(session, gameplay.snapshotsNear(new Vec3(10, 70, 10)));
    expect(session.drops.count).toBe(serverCount);
    expect(gameplay.drops.count).toBe(serverCount);
    const immediate = session.drops.entities.filter((item) => item.visual).length;
    expect(immediate).toBeLessThanOrEqual(DROPPED_ITEM_VISUALS_PER_FRAME);
    expect(immediate).toBeGreaterThan(0);
    session.drops.update(1);
    expect(session.drops.count).toBe(serverCount);
    for (let frame = 0; frame < 12; frame += 1) session.drops.interpolateVisuals(1);
    expect(session.drops.entities.every((item) => item.visual)).toBe(true);
    const removed = session.drops.entities[0]!;
    session.drops.remove(removed.id);
    session.drops.interpolateVisuals(1);
    expect(session.drops.get(removed.id)).toBeUndefined();
    session.drops.dispose();
    session.mobs.dispose();
    let leftover = 0;
    session.scene.traverse((object) => {
      if (object.name.startsWith('dropped-item')) leftover += 1;
    });
    expect(leftover).toBe(0);
  });

  it('builds only a few dropped-item meshes on the frame a burst appears', () => {
    const scene = new THREE.Scene();
    const world = new VoxelWorld('mega-visual-budget');
    const drops = new DroppedItemManager(scene, world);
    for (let index = 0; index < 24; index += 1) {
      drops.spawn(createItemStack('stone', 8), new THREE.Vector3(index, 70, 0), { merge: false, id: `pile-${index}` });
    }
    expect(drops.count).toBe(24);
    expect(drops.entities.filter((item) => item.visual).length).toBe(DROPPED_ITEM_VISUALS_PER_FRAME);
    drops.interpolateVisuals(1);
    expect(drops.entities.filter((item) => item.visual).length).toBe(DROPPED_ITEM_VISUALS_PER_FRAME * 2);
    const queued = drops.entities.find((item) => !item.visual);
    expect(queued).toBeDefined();
    drops.remove(queued!.id);
    for (let frame = 0; frame < 8; frame += 1) drops.interpolateVisuals(1);
    expect(drops.get(queued!.id)).toBeUndefined();
    expect(drops.entities.every((item) => item.visual)).toBe(true);
    drops.dispose();
  });

  it('uses one headless host on the server', () => {
    const gameplay = new ServerGameplay(new VoxelWorld('mega-host'), new EventBus());
    expect(gameplay.host).toBeInstanceOf(HeadlessEntityHost);
  });
});
