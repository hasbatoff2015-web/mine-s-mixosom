import { describe, expect, it } from 'vitest';
import type { PlayerEquipmentState, PlayerSnapshot, RemotePlayerInfo } from '../shared/protocol';
import { ServerPlayer } from '../server/WorldInstance';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { RemotePlayerView } from '../src/net/RemotePlayerView';
import { PlayerController } from '../src/player/PlayerController';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
import { getArmorPoints } from '../src/survival';
import { VoxelWorld } from '../src/world/World';

const MIXED: PlayerEquipmentState = {
  head: ItemId.IronHelmet,
  chest: ItemId.DiamondChestplate,
  legs: ItemId.GoldLeggings,
  feet: ItemId.LeatherBoots,
};

function serverPlayer(id: string): ServerPlayer {
  return new ServerPlayer(
    id,
    `token-${id}`,
    id,
    new PlayerController({ position: [0, 70, 0] }),
    new Inventory(),
    'survival',
    0,
  );
}

function equip(player: ServerPlayer, equipment: PlayerEquipmentState): void {
  for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
    const itemId = equipment[slot];
    player.inventory.setSlot(
      { section: 'armor', slot },
      itemId ? createItemStack(itemId) : null,
    );
  }
}

describe('authoritative player armor equipment snapshots', () => {
  it('projects exact server inventory ids and keeps armor damage totals unchanged', () => {
    const playerA = serverPlayer('A');
    const playerB = serverPlayer('B');
    equip(playerA, MIXED);
    expect(playerA.snapshot().equipment).toEqual(MIXED);
    expect(playerA.remoteInfo().equipment).toEqual(MIXED);
    expect(playerB.snapshot().equipment).toEqual({ head: null, chest: null, legs: null, feet: null });
    expect(getArmorPoints(playerA.inventory)).toBe(14);

    playerA.inventory.setSlot({ section: 'armor', slot: 'chest' }, null);
    expect(playerA.snapshot().equipment).toEqual({ ...MIXED, chest: null });
    expect(getArmorPoints(playerA.inventory)).toBe(6);
  });

  it('applies equip, unequip, and death to one existing remote visual without stale pieces', () => {
    const playerA = serverPlayer('A');
    equip(playerA, MIXED);
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    const world = new VoxelWorld('armor-network');
    const info: RemotePlayerInfo = playerA.remoteInfo();
    const view = new RemotePlayerView(info, { visual, world }, 0);
    expect(visual.armor.equipment).toEqual(MIXED);

    playerA.inventory.setSlot({ section: 'armor', slot: 'chest' }, null);
    view.applySnapshot(playerA.snapshot(), 50, 1);
    expect(visual.armor.equipment).toEqual({ ...MIXED, chest: null });
    expect(visual.armor.meshes('chest').every((pair) => !pair.base.visible)).toBe(true);
    expect(visual.armor.meshes('head')[0]!.base.visible).toBe(true);

    view.applySnapshot({ ...playerA.snapshot(), dead: true } satisfies PlayerSnapshot, 100, 2);
    expect(visual.armor.equipment).toEqual({ head: null, chest: null, legs: null, feet: null });
    for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
      expect(visual.armor.meshes(slot).every((pair) => !pair.base.visible && !pair.overlay.visible)).toBe(true);
    }

    equip(playerA, { head: null, chest: null, legs: null, feet: null });
    view.reset(playerA.remoteInfo(), 150);
    expect(visual.armor.equipment).toEqual({ head: null, chest: null, legs: null, feet: null });
    equip(playerA, { head: ItemId.DiamondHelmet, chest: null, legs: null, feet: null });
    view.reset(playerA.remoteInfo(), 200);
    expect(visual.armor.equipment).toEqual({
      head: ItemId.DiamondHelmet, chest: null, legs: null, feet: null,
    });
    expect(visual.armor.meshes('head')[0]!.base.visible).toBe(true);
    expect(visual.armor.meshes('chest').every((pair) => !pair.base.visible)).toBe(true);
    view.dispose();
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });
});
