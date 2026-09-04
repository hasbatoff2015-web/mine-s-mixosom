import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot, RemotePlayerInfo } from '../shared/protocol';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import { REMOTE_TICK_MS } from '../src/net/remotePlayerInterpolation';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import { VoxelWorld } from '../src/world/World';

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
      }), tick * REMOTE_TICK_MS, tick);
    }
    const pose = view.interpolate(16 * REMOTE_TICK_MS, 1 / 60, 0.7);
    expect(pose).toBeDefined();
    expect(view.group.position.x).toBeCloseTo(pose!.x);
    expect(visual.rig.head.rotation.x).toBeCloseTo(0.25);
    expect((visual.rig.head.getObjectByName('player:head:base') as THREE.Mesh).visible).toBe(false);
    expect(visual.heldItem).toBeUndefined();

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
