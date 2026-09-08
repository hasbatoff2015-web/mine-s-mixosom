import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot, RemotePlayerInfo } from '../shared/protocol';
import { IDLE_PLAYER_PRESENTATION } from '../shared/playerPresentation';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import { REMOTE_TICK_MS } from '../src/net/remotePlayerInterpolation';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import {
  NAMEPLATE_HEIGHT_OFFSET,
  NAMEPLATE_MAX_DISTANCE,
  PlayerNameplate,
  nameplateLines,
  nameplateOpacity,
} from '../src/rendering/player/PlayerNameplate';
import { VoxelWorld } from '../src/world/World';
import gameSource from '../src/core/Game.ts?raw';

const remoteInfo: RemotePlayerInfo = {
  id: 'remote', name: 'Misha', x: 0, y: 70, z: 0, yaw: 0, pitch: 0, health: 20,
  appearance: DEFAULT_PLAYER_APPEARANCE,
};

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 'remote', name: 'Misha', x: 2, y: 70, z: 0,
    yaw: 0.6, pitch: 0.25, vx: 3, vy: 0, vz: 1,
    health: 20, gamemode: 'survival', sneaking: false, sprinting: false,
    onGround: true, selectedSlot: 3, invisible: false,
    ...overrides,
  };
}

function makeView(info: RemotePlayerInfo = remoteInfo): {
  view: RemotePlayerView;
  visual: PlayerVisual;
  dispose(): void;
} {
  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const items = new ItemVisualFactory();
  const visual = new PlayerVisual(skins, geometries, items, info.appearance ?? DEFAULT_PLAYER_APPEARANCE);
  const world = new VoxelWorld('nameplate');
  const view = new RemotePlayerView(info, { visual, world }, 0);
  return {
    view,
    visual,
    dispose() {
      view.dispose();
      geometries.dispose();
      items.dispose();
      skins.dispose();
    },
  };
}

describe('player nameplate', () => {
  it('shows nickname and health on two lines', () => {
    expect(nameplateLines('Misha', 20)).toEqual(['Misha', '❤ 20']);
    const plate = new PlayerNameplate('Misha', 20);
    expect(plate.lines).toEqual(['Misha', '❤ 20']);
    expect(plate.setIdentity('Misha', 18)).toBe(true);
    expect(plate.lines).toEqual(['Misha', '❤ 18']);
    expect(plate.setIdentity('Misha', 18)).toBe(false);
    plate.dispose();
  });

  it('updates health text from authoritative snapshots and heals', () => {
    const { view, dispose } = makeView();
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 20']);
    view.applySnapshot(snapshot({ health: 18 }), 10 * REMOTE_TICK_MS, 10);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 18']);
    view.applySnapshot(snapshot({ health: 14 }), 11 * REMOTE_TICK_MS, 11);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 14']);
    view.applySnapshot(snapshot({ health: 20 }), 12 * REMOTE_TICK_MS, 12);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 20']);
    view.applySnapshot(snapshot({ health: 0, dead: true }), 13 * REMOTE_TICK_MS, 13);
    expect(view.nameplate.lines).toEqual(['Misha', '❤ 0']);
    dispose();
  });

  it('follows interpolated remote feet instead of the raw snapshot pose', () => {
    const { view, dispose } = makeView();
    for (let tick = 10; tick <= 16; tick += 1) {
      view.applySnapshot(snapshot({
        x: (tick - 10) * 0.2,
        y: 70,
        presentation: IDLE_PLAYER_PRESENTATION,
      }), tick * REMOTE_TICK_MS, tick);
    }
    const pose = view.interpolate(16 * REMOTE_TICK_MS, 1 / 60, 0.7);
    expect(pose).toBeDefined();
    expect(view.group.position.x).toBeCloseTo(pose!.x);
    expect(view.nameplate.sprite.parent).toBe(view.group);
    const world = new THREE.Vector3();
    view.nameplate.sprite.getWorldPosition(world);
    expect(world.x).toBeCloseTo(view.group.position.x);
    expect(world.y).toBeCloseTo(view.group.position.y + NAMEPLATE_HEIGHT_OFFSET);
    dispose();
  });

  it('billboards with Sprite and hides with invisibility plus distance', () => {
    const { view, dispose } = makeView();
    expect(view.nameplate.sprite).toBeInstanceOf(THREE.Sprite);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 71, 2);
    view.interpolate(0, 0, 1);
    view.updateNameplate(camera);
    expect(view.nameplate.sprite.visible).toBe(true);
    camera.position.set(0, 71, NAMEPLATE_MAX_DISTANCE + 8);
    view.updateNameplate(camera);
    expect(view.nameplate.sprite.visible).toBe(false);
    expect(nameplateOpacity(NAMEPLATE_MAX_DISTANCE)).toBe(0);
    expect(nameplateOpacity(0)).toBe(1);

    for (let tick = 20; tick <= 24; tick += 1) {
      view.applySnapshot(snapshot({ invisible: true, x: 0, y: 70, z: 0 }), tick * REMOTE_TICK_MS, tick);
    }
    camera.position.set(0, 71, 2);
    view.interpolate(24 * REMOTE_TICK_MS, 1 / 60, 1);
    view.updateNameplate(camera);
    expect(view.nameplate.sprite.visible).toBe(false);
    dispose();
  });

  it('applies remote appearance metadata to PlayerVisual without a second model pipeline', () => {
    const slim = createPlayerAppearance({ skinId: 'e3eb6f99ea1c3fe1', model: 'slim' });
    const { view, visual, dispose } = makeView({ ...remoteInfo, appearance: slim });
    expect(visual.appearance.skinId).toBe(slim.skinId);
    view.setAppearance(DEFAULT_PLAYER_APPEARANCE);
    expect(visual.appearance).toEqual(DEFAULT_PLAYER_APPEARANCE);
    dispose();
  });

  it('does not attach a local first-person nameplate in Game', () => {
    expect(gameSource).toContain('remote.updateNameplate(this.camera)');
    expect(gameSource).not.toContain('new PlayerNameplate(');
    expect(gameSource).toContain('session.playerVisual.setVisible(');
  });
});
