import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import {
  appearanceForRemoteSpawn,
  bufferPendingAppearance,
  takePendingAppearance,
} from '../src/net/remoteAppearance';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import { VoxelWorld } from '../src/world/World';

const slim = createPlayerAppearance({
  skinId: 'e3eb6f99ea1c3fe1',
  model: 'slim',
});

describe('remote appearance join without reconnect', () => {
  it('uses the first snapshot skin instead of the default', () => {
    expect(appearanceForRemoteSpawn(slim, undefined).skinId).toBe(slim.skinId);
    expect(appearanceForRemoteSpawn(undefined, slim).skinId).toBe(slim.skinId);
    expect(appearanceForRemoteSpawn(undefined, undefined).skinId).toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
  });

  it('buffers an appearance that arrives before the remote visual exists', () => {
    const pending = new Map<string, typeof slim>();
    expect(bufferPendingAppearance(pending, 'bob', slim, false)).toBe('buffered');
    expect(takePendingAppearance(pending, 'bob')).toEqual(slim);
    expect(pending.size).toBe(0);
    expect(bufferPendingAppearance(pending, 'bob', slim, true)).toBe('applied');
    expect(pending.size).toBe(0);
  });

  it('applies a later appearance update to an existing remote visual', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const world = new VoxelWorld('remote-skin');
    const view = new RemotePlayerView({
      id: 'bob', name: 'Bob', x: 0, y: 70, z: 0, yaw: 0, pitch: 0, health: 20,
      appearance: DEFAULT_PLAYER_APPEARANCE,
    }, { visual, world }, 0);
    expect(view.visual.appearance.skinId).toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
    view.setAppearance(slim);
    expect(view.visual.appearance.skinId).toBe(slim.skinId);
    view.reset({
      id: 'bob', name: 'Bob', x: 1, y: 70, z: 1, yaw: 0, pitch: 0, health: 20,
      appearance: slim,
    }, 1);
    expect(view.visual.appearance.skinId).toBe(slim.skinId);
    view.dispose();
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });

  it('lets a buffered non-default skin win a spawn that omitted appearance', () => {
    const pending = new Map<string, typeof slim>();
    bufferPendingAppearance(pending, 'bob', slim, false);
    const appearance = appearanceForRemoteSpawn(undefined, takePendingAppearance(pending, 'bob'));
    expect(appearance.skinId).toBe(slim.skinId);
    expect(appearance.skinId).not.toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
  });
});
