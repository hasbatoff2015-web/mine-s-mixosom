import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '../shared/protocol';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import {
  REMOTE_INTERP_DELAY_MS,
  REMOTE_TICK_MS,
  remoteSampleFromSnapshot,
} from '../src/net/remotePlayerInterpolation';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import { VoxelWorld } from '../src/world/World';

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 'remote', name: 'Burning', x: 2, y: 70, z: 0,
    yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
    health: 18, gamemode: 'survival', sneaking: false, sprinting: false,
    onGround: true, selectedSlot: 0, invisible: false, onFire: false,
    ...overrides,
  };
}

function makeView() {
  const skins = new MinecraftSkinRegistry();
  const geometries = new PlayerSkinGeometryCache();
  const items = new ItemVisualFactory();
  const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
  const world = new VoxelWorld('remote-fire');
  const view = new RemotePlayerView({
    id: 'remote', name: 'Burning', x: 0, y: 70, z: 0, yaw: 0, pitch: 0, health: 20,
    appearance: DEFAULT_PLAYER_APPEARANCE,
    onFire: true,
  }, { visual, world }, 0);
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

describe('remote player fire visual', () => {
  it('carries discrete onFire on snapshots without interpolating it', () => {
    const sample = remoteSampleFromSnapshot(snapshot({ onFire: true }), 10, 0);
    expect(sample.onFire).toBe(true);
    const off = remoteSampleFromSnapshot(snapshot({ onFire: false }), 11, 50);
    expect(off.onFire).toBe(false);
  });

  it('shows and hides the shared fire overlay from authoritative snapshots', () => {
    const { view, visual, dispose } = makeView();
    const now = 20 * REMOTE_TICK_MS + REMOTE_INTERP_DELAY_MS;
    view.applySnapshot(snapshot({ onFire: true }), now - REMOTE_TICK_MS, 18);
    view.applySnapshot(snapshot({ onFire: true }), now, 20);
    view.interpolate(now + REMOTE_INTERP_DELAY_MS, 0.05);
    expect(visual.fireOverlayVisible).toBe(true);
    view.applySnapshot(snapshot({ onFire: false }), now + 2 * REMOTE_TICK_MS, 22);
    view.applySnapshot(snapshot({ onFire: false }), now + 3 * REMOTE_TICK_MS, 23);
    view.interpolate(now + 3 * REMOTE_TICK_MS + REMOTE_INTERP_DELAY_MS, 0.05);
    expect(visual.fireOverlayVisible).toBe(false);
    dispose();
  });

  it('does not replace mob entity fire with a damage-based hack', () => {
    expect(remoteSampleFromSnapshot(snapshot(), 1, 0).onFire).toBe(false);
  });
});
