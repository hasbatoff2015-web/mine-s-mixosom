import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot, RemotePlayerInfo } from '../shared/protocol';
import { IDLE_PLAYER_PRESENTATION } from '../shared/playerPresentation';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import { REMOTE_TICK_MS } from '../src/net/remotePlayerInterpolation';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import { VoxelWorld } from '../src/world/World';
import { ItemId } from '../src/items';

const remoteInfo: RemotePlayerInfo = {
  id: 'remote', name: 'Remote', x: 0, y: 70, z: 0, yaw: 0, pitch: 0,
};

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 'remote', name: 'Remote', x: 2, y: 70, z: 0,
    yaw: 0.6, pitch: 0.25, vx: 3, vy: 0, vz: 1,
    health: 20, gamemode: 'survival', sneaking: true, sprinting: true,
    onGround: true, selectedSlot: 3, invisible: true,
    ...overrides,
  };
}

describe('remote player view presentation', () => {
  it('shows authoritative Totems in either hand without hiding the selected item', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const view = new RemotePlayerView(remoteInfo, { visual, world: new VoxelWorld('remote-totem') });
    view.applySnapshot(snapshot({ invisible: false, presentation: {
      ...IDLE_PLAYER_PRESENTATION, heldItemId: ItemId.DiamondSword, offhandItemId: ItemId.TotemOfUndying,
    } }), 50, 1);
    view.interpolate(50, 1 / 60);
    expect(visual.heldItem).toBe(ItemId.DiamondSword);
    expect(visual.offhandItem).toBe(ItemId.TotemOfUndying);
    expect(visual.rig.heldItem.parent).toBe(visual.rig.rightArm);
    expect(visual.rig.offhandItem.parent).toBe(visual.rig.leftArm);
    expect(visual.rig.offhandItem.children).toHaveLength(1);
    expect(visual.rig.offhandItem.position.x).toBeGreaterThan(0);
    visual.setAppearance({ ...DEFAULT_PLAYER_APPEARANCE, model: 'slim' });
    expect(visual.rig.offhandItem.position.x).toBeGreaterThan(0);
    view.applySnapshot(snapshot({ invisible: false, presentation: {
      ...IDLE_PLAYER_PRESENTATION, heldItemId: ItemId.TotemOfUndying, offhandItemId: null,
    } }), 100, 2);
    view.interpolate(100, 1 / 60);
    expect(visual.heldItem).toBe(ItemId.TotemOfUndying);
    expect(visual.offhandItem).toBeUndefined();
    expect(visual.rig.heldItem.children).toHaveLength(1);
    view.applySnapshot(snapshot({ invisible: false, presentation: {
      ...IDLE_PLAYER_PRESENTATION, heldItemId: ItemId.TotemOfUndying, offhandItemId: ItemId.TotemOfUndying,
    } }), 150, 3);
    view.interpolate(150, 1 / 60);
    expect(visual.rig.heldItem.children).toHaveLength(1);
    expect(visual.rig.offhandItem.children).toHaveLength(1);
    view.applySnapshot(snapshot({ presentation: {
      ...IDLE_PLAYER_PRESENTATION, heldItemId: ItemId.Bow, offhandItemId: null,
    } }), 200, 4);
    view.interpolate(200, 1 / 60);
    expect(visual.heldItem).toBe(ItemId.Bow);
    expect(visual.offhandItem).toBeUndefined();
    expect(visual.rig.offhandItem.children).toHaveLength(0);
    view.dispose();
    geometries.dispose(); items.dispose(); skins.dispose();
  });

  it('holds the spawn pose until a serverTick timeline exists', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const world = new VoxelWorld('remote-player-visual');
    const view = new RemotePlayerView(remoteInfo, { visual, world }, 0);
    view.interpolate(500, 1 / 60, 0.7);
    expect(view.group.position.x).toBe(0);
    expect(view.group.position.y).toBe(70);
    view.dispose();
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });

  it('keeps interpolation ownership while rendering the remote through canonical PlayerVisual', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const world = new VoxelWorld('remote-player-visual');
    const view = new RemotePlayerView(remoteInfo, { visual, world }, 0);

    expect(view.group.children).toContain(visual.root);
    expect(view.group.getObjectByName('player-visual')).toBe(visual.root);
    let placeholderBox = false;
    view.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) placeholderBox = true;
    });
    expect(placeholderBox).toBe(false);
    expect(visual.appearance).toEqual(DEFAULT_PLAYER_APPEARANCE);
    expect(skins.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(1);

    for (let tick = 10; tick <= 16; tick += 1) {
      view.applySnapshot(snapshot({
        x: (tick - 10) * 0.2,
        yaw: 0.6,
        pitch: 0.25,
        vx: 4,
        vz: 0,
        equipment: {
          head: 'iron_helmet', chest: 'diamond_chestplate', legs: null, feet: null,
        },
        presentation: { ...IDLE_PLAYER_PRESENTATION, heldItemId: 'diamond_sword' },
      }), tick * REMOTE_TICK_MS, tick);
    }
    const pose = view.interpolate(16 * REMOTE_TICK_MS, 1 / 60, 0.7);
    expect(pose).toBeDefined();
    expect(view.group.position.x).toBeCloseTo(pose!.x);
    expect(visual.rig.head.rotation.x).toBeCloseTo(0.25);
    expect((visual.rig.head.getObjectByName('player:head:base') as THREE.Mesh).visible).toBe(false);
    expect((visual.rig.head.getObjectByName('player:head:outer') as THREE.Mesh).visible).toBe(false);
    expect(visual.armor.meshes('head')[0]!.base.visible).toBe(true);
    expect(visual.armor.meshes('chest').every((pair) => pair.base.visible)).toBe(true);
    expect(visual.heldItem).toBe('diamond_sword');
    expect(visual.rig.heldItem.visible).toBe(true);

    for (let tick = 17; tick <= 23; tick += 1) {
      view.applySnapshot(snapshot({
        invisible: false,
        equipment: {
          head: 'iron_helmet', chest: 'diamond_chestplate', legs: null, feet: null,
        },
        presentation: { ...IDLE_PLAYER_PRESENTATION, heldItemId: 'diamond_sword' },
      }), tick * REMOTE_TICK_MS, tick);
    }
    view.interpolate(23 * REMOTE_TICK_MS, 1 / 60, 0.7);
    expect((visual.rig.head.getObjectByName('player:head:base') as THREE.Mesh).visible).toBe(true);
    expect((visual.rig.head.getObjectByName('player:head:outer') as THREE.Mesh).visible).toBe(true);
    expect(visual.armor.meshes('head')[0]!.base.visible).toBe(true);
    expect(visual.armor.meshes('chest').every((pair) => pair.base.visible)).toBe(true);
    expect(visual.rig.heldItem.visible).toBe(true);

    view.reset(remoteInfo);
    expect(view.buffer.sampleCount).toBe(0);
    view.dispose();
    expect(skins.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(0);
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });

  it('drives locomotion from interpolated velocity, not packet rate', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const world = new VoxelWorld('remote-player-visual');
    const view = new RemotePlayerView(remoteInfo, { visual, world }, 0);
    for (let tick = 20; tick <= 28; tick += 1) {
      view.applySnapshot(snapshot({
        x: (tick - 20) * 0.2,
        vx: 4,
        vz: 0,
        sprinting: true,
        onGround: true,
        invisible: false,
      }), tick * REMOTE_TICK_MS, tick);
    }
    view.interpolate(28 * REMOTE_TICK_MS, 1 / 20, 1);
    expect(visual.rig.rightLeg.rotation.x).not.toBe(0);
    view.dispose();
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });
});
