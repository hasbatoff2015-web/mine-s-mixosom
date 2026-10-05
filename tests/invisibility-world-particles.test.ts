import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { FirstPersonRenderer } from '../src/rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import {
  INVISIBILITY_WORLD_PARTICLE_GROUP,
  WORLD_INVIS_MAX_DRIFT,
  WORLD_INVIS_MAX_INTERVAL,
  WORLD_INVIS_MAX_LIFE,
  WORLD_INVIS_MAX_RISE,
  WORLD_INVIS_MAX_SIZE,
  WORLD_INVIS_MAX_Y,
  WORLD_INVIS_MIN_INTERVAL,
  WORLD_INVIS_MIN_LIFE,
  WORLD_INVIS_MIN_SIZE,
  WORLD_INVIS_MIN_Y,
  WORLD_INVIS_PARTICLE_MAX_OPACITY,
  WORLD_INVIS_PARTICLE_POOL,
  WORLD_INVIS_PARTICLE_TINT,
  WORLD_INVIS_SPAWN_RADIUS,
  WORLD_INVIS_RELOCATE_RESET_DISTANCE,
  invisibilitySwirlFrames,
  invisibilityWorldParticleOpacity,
} from '../src/rendering/InvisibilityWorldParticles';
import { POTION_PARTICLE_MAX_OPACITY, POTION_SWIRL_FRAMES, potionSwirlUv } from '../src/rendering/potionParticles';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual, type PlayerVisualFrameState } from '../src/rendering/player/PlayerVisual';

const frame = {
  viewYaw: 0,
  viewPitch: 0,
  movementSpeed: 0,
  onGround: true,
  sneaking: false,
  sprinting: false,
  verticalVelocity: 0,
  mining: false,
  bowCharge: 0,
  swordBlocking: false,
  foodUseProgress: 0,
  hurtFlash: 0,
} satisfies Omit<PlayerVisualFrameState, 'invisible'>;

function createVisual(): {
  visual: PlayerVisual;
  dispose: () => void;
} {
  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const items = new ItemVisualFactory();
  const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
  return {
    visual,
    dispose() {
      visual.dispose();
      geometries.dispose();
      items.dispose();
      skins.dispose();
    },
  };
}

function sprites(visual: PlayerVisual): THREE.Sprite[] {
  return visual.invisibilityParticles.group.children.filter((child): child is THREE.Sprite => child instanceof THREE.Sprite);
}

function present(visual: PlayerVisual, deltaSeconds: number, invisible: boolean): void {
  visual.update(deltaSeconds, { ...frame, invisible });
  visual.updateWorldParticles(deltaSeconds);
}

function worldPosition(sprite: THREE.Sprite, target = new THREE.Vector3()): THREE.Vector3 {
  return sprite.getWorldPosition(target);
}

describe('invisibility world particles', () => {
  it('keeps a sparse neutral swirl inside the player volume', () => {
    expect(WORLD_INVIS_PARTICLE_POOL).toBe(7);
    expect(WORLD_INVIS_PARTICLE_MAX_OPACITY).toBeGreaterThanOrEqual(0.45);
    expect(WORLD_INVIS_PARTICLE_MAX_OPACITY).toBeLessThanOrEqual(0.58);
    expect(WORLD_INVIS_PARTICLE_MAX_OPACITY).toBeGreaterThan(POTION_PARTICLE_MAX_OPACITY);
    expect(WORLD_INVIS_PARTICLE_TINT).toBe(0xf6f6f6);
    expect(WORLD_INVIS_SPAWN_RADIUS).toBeGreaterThanOrEqual(0.28);
    expect(WORLD_INVIS_SPAWN_RADIUS).toBeLessThanOrEqual(0.38);
    expect(WORLD_INVIS_MIN_Y).toBeLessThanOrEqual(0.15);
    expect(WORLD_INVIS_MAX_Y).toBeGreaterThanOrEqual(1.75);
    expect(WORLD_INVIS_MIN_LIFE).toBeGreaterThanOrEqual(1.3);
    expect(WORLD_INVIS_MAX_LIFE).toBeLessThanOrEqual(2);
    expect(WORLD_INVIS_MIN_INTERVAL).toBeGreaterThanOrEqual(0.28);
    expect(WORLD_INVIS_MAX_INTERVAL).toBeLessThanOrEqual(0.45);
    expect(WORLD_INVIS_MIN_SIZE).toBeGreaterThanOrEqual(0.1);
    expect(WORLD_INVIS_MAX_SIZE).toBeLessThanOrEqual(0.16);
    expect(invisibilityWorldParticleOpacity(0)).toBe(0);
    expect(invisibilityWorldParticleOpacity(0.5)).toBeCloseTo(WORLD_INVIS_PARTICLE_MAX_OPACITY);
    expect(invisibilityWorldParticleOpacity(1)).toBeCloseTo(0);
    expect(invisibilityWorldParticleOpacity(0.9)).toBeLessThan(WORLD_INVIS_PARTICLE_MAX_OPACITY);

    const shared = invisibilitySwirlFrames();
    expect(shared).toHaveLength(POTION_SWIRL_FRAMES);
    const uv = potionSwirlUv(3);
    expect(shared[3]!.offset.x).toBeCloseTo(uv.offsetX);
    expect(shared[3]!.offset.y).toBeCloseTo(uv.offsetY);
    expect(shared[3]!.repeat.x).toBeCloseTo(uv.repeat);
    expect(shared[0]!.magFilter).toBe(THREE.NearestFilter);
    expect(shared[0]!.minFilter).toBe(THREE.NearestFilter);
    expect(shared[0]!.generateMipmaps).toBe(false);

    const created = createVisual();
    const { visual } = created;
    const particles = visual.invisibilityParticles;
    expect(particles.active).toBe(false);
    expect(particles.group.visible).toBe(false);
    expect(particles.activeCount).toBe(0);
    expect(particles.poolSize).toBe(WORLD_INVIS_PARTICLE_POOL);
    expect(particles.group.parent).toBe(visual.root);
    expect(visual.root.getObjectByName('player-visual:yaw')!.children).not.toContain(particles.group);
    expect(visual.rig.head.children).not.toContain(particles.group);

    present(visual, 0.05, false);
    expect(particles.active).toBe(false);
    expect(particles.activeCount).toBe(0);
    expect(sprites(visual).every((sprite) => sprite.visible === false)).toBe(true);

    const identities = sprites(visual).map((sprite) => sprite.uuid);
    visual.setHeldItem('diamond_sword');
    visual.setArmor({ head: 'iron_helmet', chest: null, legs: null, feet: null });
    present(visual, 0.05, true);
    expect(particles.active).toBe(true);
    expect(particles.group.visible).toBe(true);
    expect(particles.activeCount).toBeGreaterThanOrEqual(1);
    expect(particles.activeCount).toBeLessThanOrEqual(2);
    expect((visual.rig.head.getObjectByName('player:head:base') as THREE.Mesh).visible).toBe(false);
    expect((visual.rig.body.getObjectByName('player:body:base') as THREE.Mesh).visible).toBe(false);
    expect((visual.rig.body.getObjectByName('player:body:outer') as THREE.Mesh).visible).toBe(false);
    expect(visual.rig.heldItem.visible).toBe(true);
    expect(visual.armor.meshes('head')[0]!.base.visible).toBe(true);
    expect(visual.root.visible).toBe(true);

    const framesSeen = new Set<number>();
    let sawStrong = false;
    const started = particles.spawnCount;
    const materialVersions = new Map(sprites(visual).map((sprite) => [sprite.uuid, sprite.material.version]));
    for (let step = 0; step < 80; step += 1) {
      present(visual, 0.05, true);
      expect(particles.activeCount).toBeLessThanOrEqual(WORLD_INVIS_PARTICLE_POOL);
      expect(sprites(visual)).toHaveLength(WORLD_INVIS_PARTICLE_POOL);
      expect(sprites(visual).map((sprite) => sprite.uuid)).toEqual(identities);
      for (const sprite of sprites(visual)) {
        const material = sprite.material;
        expect(material.depthTest).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(material.transparent).toBe(true);
        expect(material.fog).toBe(true);
        expect(material.toneMapped).toBe(false);
        expect(material.blending).toBe(THREE.NormalBlending);
        expect(material.color.getHex()).toBe(WORLD_INVIS_PARTICLE_TINT);
        expect(material.opacity).toBeLessThanOrEqual(WORLD_INVIS_PARTICLE_MAX_OPACITY + 1e-6);
        expect(material.opacity).toBeGreaterThanOrEqual(0);
        expect(shared).toContain(material.map);
        expect(material.version).toBe(materialVersions.get(sprite.uuid));
        if (material.opacity >= 0.5) sawStrong = true;
        if (!sprite.visible) continue;
        framesSeen.add(sprite.userData.frame as number);
        expect(sprite.position.y).toBeGreaterThanOrEqual(WORLD_INVIS_MIN_Y - 1e-4);
        expect(sprite.position.y).toBeLessThanOrEqual(WORLD_INVIS_MAX_Y + WORLD_INVIS_MAX_RISE + 1e-4);
        expect(Math.hypot(sprite.position.x, sprite.position.z))
          .toBeLessThanOrEqual(WORLD_INVIS_SPAWN_RADIUS + WORLD_INVIS_MAX_DRIFT + 1e-4);
        expect(sprite.scale.x).toBeGreaterThanOrEqual(WORLD_INVIS_MIN_SIZE * 0.9);
        expect(sprite.scale.x).toBeLessThanOrEqual(WORLD_INVIS_MAX_SIZE + 1e-6);
      }
    }
    expect(sprites(visual).some((sprite) => sprite.visible)).toBe(true);
    expect(sawStrong).toBe(true);
    expect(Math.max(...framesSeen)).toBeGreaterThanOrEqual(6);
    const spawned = particles.spawnCount - started;
    expect(spawned).toBeGreaterThanOrEqual(6);
    expect(spawned).toBeLessThanOrEqual(18);

    visual.setVisible(false);
    expect(visual.root.visible).toBe(false);
    expect(particles.group.parent).toBe(visual.root);
    expect(particles.active).toBe(true);

    present(visual, 0.05, false);
    expect(particles.active).toBe(false);
    expect(particles.group.visible).toBe(false);
    expect(particles.activeCount).toBe(0);
    expect(sprites(visual).every((sprite) => sprite.visible === false)).toBe(true);
    expect((visual.rig.head.getObjectByName('player:head:base') as THREE.Mesh).visible).toBe(true);

    const other = createVisual();
    present(other.visual, 0.05, true);
    const sharedMap = sprites(other.visual)[0]!.material.map;
    expect(shared).toContain(sharedMap);
    created.dispose();
    expect(visual.root.getObjectByName(INVISIBILITY_WORLD_PARTICLE_GROUP)).toBeUndefined();
    expect(particles.group.parent).toBeNull();
    expect(particles.group.children).toHaveLength(0);
    expect(() => present(other.visual, 0.05, true)).not.toThrow();
    expect(shared).toContain(sprites(other.visual)[0]!.material.map);
    other.dispose();

    const factory = new ItemVisualFactory();
    const viewmodel = new FirstPersonRenderer(factory);
    expect(viewmodel.scene.getObjectByName(INVISIBILITY_WORLD_PARTICLE_GROUP)).toBeUndefined();
    expect(viewmodel.scene.getObjectByName('first-person:potion-overlay')).toBeTruthy();
    viewmodel.dispose();
    factory.dispose();
  });

  it('keeps an existing swirl behind a moving player and spawns the next one at the new position', () => {
    const created = createVisual();
    const { visual } = created;
    visual.root.position.set(0, 0, 0);
    present(visual, 0.05, true);
    const sprite = sprites(visual).find((entry) => entry.visible);
    expect(sprite).toBeTruthy();
    const before = worldPosition(sprite!).clone();
    visual.root.position.set(2, 0, 0);
    present(visual, 0.016, true);
    const moved = worldPosition(sprite!);
    expect(Math.abs(moved.x - before.x)).toBeLessThan(0.15);
    expect(Math.abs(moved.x - (before.x + 2))).toBeGreaterThan(1);

    const seen = new Set(sprites(visual).filter((entry) => entry.visible).map((entry) => entry.uuid));
    let fresh: THREE.Sprite | undefined;
    for (let step = 0; step < 20 && !fresh; step += 1) {
      present(visual, 0.05, true);
      fresh = sprites(visual).find((entry) => entry.visible && !seen.has(entry.uuid));
    }
    expect(fresh).toBeTruthy();
    const freshWorld = worldPosition(fresh!);
    expect(Math.hypot(freshWorld.x - visual.root.position.x, freshWorld.z - visual.root.position.z))
      .toBeLessThanOrEqual(WORLD_INVIS_SPAWN_RADIUS + WORLD_INVIS_MAX_DRIFT + 0.05);
    expect(Math.abs(worldPosition(sprite!).x - before.x)).toBeLessThan(0.2);
    created.dispose();
  });

  it('does not swing an old swirl around the player when the root turns', () => {
    const created = createVisual();
    const random = Math.random;
    Math.random = () => 0.25;
    try {
      present(created.visual, 0.05, true);
    } finally {
      Math.random = random;
    }
    const sprite = sprites(created.visual).find((entry) => entry.visible);
    expect(sprite).toBeTruthy();
    const before = worldPosition(sprite!).clone();
    expect(Math.hypot(before.x, before.z)).toBeGreaterThan(0.1);
    created.visual.root.rotation.y = Math.PI / 2;
    present(created.visual, 0.016, true);
    expect(worldPosition(sprite!).distanceTo(before)).toBeLessThan(0.05);
    created.dispose();
  });

  it('drops the old cloud when the player relocates by at least six blocks', () => {
    const created = createVisual();
    const { visual } = created;
    present(visual, 0.05, true);
    expect(sprites(visual).some((entry) => entry.visible)).toBe(true);
    visual.root.position.set(WORLD_INVIS_RELOCATE_RESET_DISTANCE + 2, 0, 0);
    present(visual, 0.05, true);
    const visible = sprites(visual).filter((entry) => entry.visible);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThanOrEqual(WORLD_INVIS_PARTICLE_POOL);
    for (const sprite of visible) {
      const point = worldPosition(sprite);
      expect(Math.abs(point.x)).toBeGreaterThan(1);
      expect(Math.hypot(point.x - visual.root.position.x, point.z))
        .toBeLessThanOrEqual(WORLD_INVIS_SPAWN_RADIUS + WORLD_INVIS_MAX_DRIFT + 0.08);
    }
    created.dispose();
  });
});
