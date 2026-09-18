import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { WORLD_HEIGHT } from '../src/core/constants';
import {
  MOB_HURT_FLASH_SECONDS,
  MobManager,
  mobHurtFlashIntensity,
} from '../src/entities';
import { eventsForEntity } from '../src/net/entityEvents';
import { applyEntitySnapshots, applyNetworkEntityEvents } from '../src/net/applyEntitySnapshots';
import { EntityInterpolationBuffer } from '../src/net/entitySnapshotInterpolation';
import { VoxelWorld } from '../src/world/World';
import type { NetworkEntityEvent } from '../shared/protocol';
import { parseServerMessage } from '../shared/protocol';
import { EventBus } from '../server/events';
import { ServerGameplay } from '../server/gameplay';
import { DroppedItemManager } from '../src/entities/DroppedItemManager';
import { FallingBlockManager } from '../src/entities/FallingBlockManager';
import { MinecartManager } from '../src/entities/MinecartManager';
import { RedstoneSystem } from '../src/redstone';
import { createThreeEntityHost } from '../src/entities/ThreeEntityHost';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { Vec3 } from '../src/math/vec3';
import { embedArrow } from '../src/combat/ArrowPhysics';

function platform(world: VoxelWorld, y = 40): void {
  world.getChunk(0, 0);
  for (let x = 2; x <= 12; x += 1) {
    for (let z = 2; z <= 12; z += 1) {
      world.setBlock(x, y, z, BlockId.Stone);
      for (let above = y + 1; above < WORLD_HEIGHT && above <= y + 4; above += 1) {
        world.setBlock(x, above, z, BlockId.Air);
      }
    }
  }
}

function sessionOf(world: VoxelWorld) {
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

describe('network visual events', () => {
  it('parses an entity_event targeting one entity id', () => {
    const parsed = parseServerMessage({
      type: 'entity_event',
      tick: 4,
      events: [
        { entityId: 'mob-a', kind: 'hurt' },
        { entityId: 'mob-b', kind: 'death' },
      ],
    });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.type).toBe('entity_event');
    if (parsed.type !== 'entity_event') return;
    expect(eventsForEntity(parsed.events, 'mob-a')).toEqual([{ entityId: 'mob-a', kind: 'hurt' }]);
  });

  it('hurt events flash only the targeted entity', () => {
    const world = new VoxelWorld('net-hurt');
    platform(world);
    const session = sessionOf(world);
    const a = session.mobs.spawn('zombie', new THREE.Vector3(5.5, 41, 5.5), { force: true, id: 'mob-a' })!;
    const b = session.mobs.spawn('cow', new THREE.Vector3(8.5, 41, 5.5), { force: true, id: 'mob-b' })!;
    const events: NetworkEntityEvent[] = [{ entityId: 'mob-a', kind: 'hurt' }];
    applyNetworkEntityEvents(session, events);
    expect(a.hurtFlashSeconds).toBe(MOB_HURT_FLASH_SECONDS);
    expect(b.hurtFlashSeconds).toBe(0);
    expect(mobHurtFlashIntensity(b.hurtFlashSeconds)).toBe(0);
  });

  it('death events put only the targeted entity into the die pose', () => {
    const world = new VoxelWorld('net-death');
    platform(world);
    const session = sessionOf(world);
    const a = session.mobs.spawn('zombie', new THREE.Vector3(5.5, 41, 5.5), { force: true, id: 'mob-a' })!;
    const b = session.mobs.spawn('pig', new THREE.Vector3(8.5, 41, 5.5), { force: true, id: 'mob-b' })!;
    applyNetworkEntityEvents(session, [{ entityId: 'mob-a', kind: 'death' }]);
    expect(a.state).toBe('die');
    expect(b.state).not.toBe('die');
    expect(session.mobs.shouldKeepRemoteDeath('mob-a')).toBe(true);
  });

  it('arrow spawn snapshots create a matching client render entity', () => {
    const world = new VoxelWorld('net-arrow');
    platform(world);
    const session = sessionOf(world);
    const interpolator = new EntityInterpolationBuffer();
    applyEntitySnapshots(session, [{
      id: 'arrow-9',
      kind: 'arrow',
      x: 6, y: 42, z: 6,
      vx: 1, vy: 0, vz: 0,
    }], { interpolator, tick: 1, now: 1_000 });
    expect(session.arrows.entities.some((arrow) => arrow.id === 'arrow-9')).toBe(true);
    expect(interpolator.sample('arrow-9', 1_000)?.x).toBe(6);
  });

  it('keeps an embedded network arrow aligned to its impact instead of random spread', () => {
    const world = new VoxelWorld('net-embedded-arrow');
    platform(world);
    const session = sessionOf(world);
    const interpolator = new EntityInterpolationBuffer();
    applyEntitySnapshots(session, [{
      id: 'arrow-embedded', kind: 'arrow', x: 6, y: 42, z: 6,
      vx: 0, vy: 0, vz: 0, state: 'embedded',
      impactVx: 0.8, impactVy: -0.2, impactVz: 0.1,
    }], { interpolator, tick: 1, now: 1_000 });
    const arrow = session.arrows.entities[0]!;
    expect(arrow.inGround).toBe(true);
    expect(arrow.visualDirection.toArray()).toEqual([0.8, -0.2, 0.1]);
    session.arrows.applyRenderPose(arrow.id, 6, 42, 6, 0, 0, 0);
    expect(arrow.visualDirection.toArray()).toEqual([0.8, -0.2, 0.1]);
  });

  it('sends the retained impact trajectory when a server arrow embeds', () => {
    const world = new VoxelWorld('server-embedded-arrow');
    platform(world);
    world.setBlock(6, 42, 7, BlockId.Stone);
    const gameplay = new ServerGameplay(world, new EventBus());
    const hit = world.raycast(new Vec3(6.5, 42.5, 6.5), new Vec3(0, 0, 1), 2)!;
    gameplay.arrows.spawn(new Vec3(6.5, 42.5, 6.5), new Vec3(0, 0, 1), 1, 0, false);
    const arrow = gameplay.arrows.entities[0]!;
    arrow.embedded = embedArrow(hit, new Vec3(0.1, -0.2, 0.9));
    arrow.inGround = true;
    arrow.velocity.set(0, 0, 0);
    expect(gameplay.snapshotsNear(new Vec3(6.5, 42.5, 6.5)).find((snapshot) => snapshot.id === arrow.id))
      .toMatchObject({ state: 'embedded', vx: 0, vy: 0, vz: 0,
        impactVx: 0.1, impactVy: -0.2, impactVz: 0.9 });
  });

  it('buffers authoritative firework positions for render-frame interpolation', () => {
    const world = new VoxelWorld('net-firework-interp');
    const session = sessionOf(world);
    const interpolator = new EntityInterpolationBuffer();
    applyEntitySnapshots(session, [{ id: 'firework-1', kind: 'firework', x: 1, y: 70, z: 1 }],
      { interpolator, tick: 1, now: 1_000 });
    applyEntitySnapshots(session, [{ id: 'firework-1', kind: 'firework', x: 1, y: 71, z: 1 }],
      { interpolator, tick: 2, now: 1_050 });
    expect(interpolator.sample('firework-1', 1_100)?.y).toBeGreaterThan(70);
    expect(interpolator.sample('firework-1', 1_100)?.y).toBeLessThan(71);
  });

  it('arrow despawn removes the render entity without leaving a track to lerp', () => {
    const world = new VoxelWorld('net-arrow-despawn');
    platform(world);
    const session = sessionOf(world);
    const interpolator = new EntityInterpolationBuffer();
    applyEntitySnapshots(session, [{
      id: 'arrow-9', kind: 'arrow', x: 6, y: 42, z: 6, vx: 1, vy: 0, vz: 0,
    }], { interpolator, tick: 1, now: 1_000 });
    applyEntitySnapshots(session, [], { interpolator, tick: 2, now: 1_050 });
    expect(session.arrows.entities.some((arrow) => arrow.id === 'arrow-9')).toBe(false);
    expect(interpolator.sample('arrow-9', 1_050)).toBeUndefined();
    applyNetworkEntityEvents(session, [{ entityId: 'arrow-9', kind: 'projectile_hit' }]);
    expect(session.arrows.count).toBe(0);
  });

  it('server damage emits a hurt event for only that entity id', () => {
    const world = new VoxelWorld('server-hurt-event');
    platform(world);
    const gameplay = new ServerGameplay(world, new EventBus());
    const zombie = gameplay.mobs.spawn('zombie', new THREE.Vector3(5.5, 41, 5.5), { force: true, id: 'mob-z' })!;
    const cow = gameplay.mobs.spawn('cow', new THREE.Vector3(8.5, 41, 5.5), { force: true, id: 'mob-c' })!;
    expect(gameplay.mobs.damage(zombie, 2, { source: 'player' })).toBe(true);
    const events = gameplay.consumeEntityEvents();
    expect(events.some((event) => event.entityId === zombie.id && event.kind === 'hurt')).toBe(true);
    expect(events.some((event) => event.entityId === cow.id)).toBe(false);
    expect(cow.hurtFlashSeconds).toBe(0);
  });

  it('snapshot hurt rising edge flashes only that mob id', () => {
    const world = new VoxelWorld('net-snap-hurt');
    platform(world);
    const session = sessionOf(world);
    const interpolator = new EntityInterpolationBuffer();
    applyEntitySnapshots(session, [
      { id: 'mob-a', kind: 'mob', mobKind: 'zombie', x: 5.5, y: 41, z: 5.5, hurt: false, health: 10 },
      { id: 'mob-b', kind: 'mob', mobKind: 'cow', x: 8.5, y: 41, z: 5.5, hurt: false, health: 8 },
    ], { interpolator, tick: 1, now: 1_000 });
    applyEntitySnapshots(session, [
      { id: 'mob-a', kind: 'mob', mobKind: 'zombie', x: 5.5, y: 41, z: 5.5, hurt: true, health: 7 },
      { id: 'mob-b', kind: 'mob', mobKind: 'cow', x: 8.5, y: 41, z: 5.5, hurt: false, health: 8 },
    ], { interpolator, tick: 2, now: 1_050 });
    expect(session.mobs.get('mob-a')?.hurtFlashSeconds).toBe(MOB_HURT_FLASH_SECONDS);
    expect(session.mobs.get('mob-b')?.hurtFlashSeconds).toBe(0);
  });
});
