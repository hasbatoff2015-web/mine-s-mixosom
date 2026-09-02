import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot, RemotePlayerInfo } from '../shared/protocol';
import { RemotePlayerView, sampleRemotePose, type RemotePoseSample } from '../src/net/RemotePlayerView';
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

describe('remote player interpolation', () => {
  it('lerps previous → current over the delayed render time instead of snapping to the latest pose', () => {
    const samples: RemotePoseSample[] = [
      { x: 0, y: 70, z: 0, yaw: 0, at: 1_000 },
      { x: 2, y: 70, z: 0, yaw: 0, at: 1_050 },
    ];
    const mid = sampleRemotePose(samples, 1_105, 80);
    expect(mid).toBeDefined();
    expect(mid!.x).toBeCloseTo(1, 5);
    const held = sampleRemotePose(samples, 1_200, 80);
    expect(held!.x).toBeCloseTo(2, 5);
  });

  it('does not jump to the newest sample the instant it arrives', () => {
    const samples: RemotePoseSample[] = [
      { x: 0, y: 70, z: 0, yaw: 0, at: 50 },
      { x: 4, y: 70, z: 0, yaw: 0, at: 100 },
    ];
    const justArrived = sampleRemotePose(samples, 100, 80);
    expect(justArrived!.x).toBeCloseTo(0, 5);
  });

  it('keeps interpolation ownership while rendering the remote through canonical PlayerVisual', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const world = new VoxelWorld('remote-player-visual');
    const view = new RemotePlayerView(remoteInfo, { visual, world }, 1_000);

    expect(view.group.children).toContain(visual.root);
    expect(view.group.getObjectByName('player-visual')).toBe(visual.root);
    let placeholderBox = false;
    view.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) placeholderBox = true;
    });
    expect(placeholderBox).toBe(false);
    expect(visual.appearance).toEqual(DEFAULT_PLAYER_APPEARANCE);
    expect(skins.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(1);

    view.applySnapshot(snapshot(), 1_050, 7);
    view.interpolate(1_200, 1 / 60, 0.7);

    expect(view.group.position.x).toBeCloseTo(2);
    expect(visual.rig.head.rotation.x).toBeCloseTo(0.25);
    expect(visual.rig.rightLeg.rotation.x).not.toBe(0);
    expect((visual.rig.head.getObjectByName('player:head:base') as THREE.Mesh).visible).toBe(false);
    // selectedSlot alone is not an authoritative item id; do not fabricate a held item.
    expect(visual.heldItem).toBeUndefined();

    view.dispose();
    expect(skins.referenceCount(DEFAULT_PLAYER_APPEARANCE.skinId)).toBe(0);
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });
});
