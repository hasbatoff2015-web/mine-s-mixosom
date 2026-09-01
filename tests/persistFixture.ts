import { BlockId } from '../src/blocks';
import { Inventory } from '../src/inventory';
import { parseWorldSnapshot } from '../src/save/snapshot';
import { WORLD_SCHEMA_VERSION, type WorldSnapshot } from '../src/save/types';

export function inventoryWithDiamond(): unknown {
  const inventory = new Inventory();
  inventory.addItem('diamond', 3);
  inventory.setSlot({ section: 'armor', slot: 'chest' }, { itemId: 'iron_chestplate', count: 1 });
  return inventory.serialize();
}

export function sampleSnapshot(overrides?: Partial<WorldSnapshot>): WorldSnapshot {
  return parseWorldSnapshot({
    schemaVersion: WORLD_SCHEMA_VERSION,
    summary: {
      id: 'sp-test',
      name: 'Тест',
      seed: 'seed-1',
      mode: 'survival',
      createdAt: 10,
      updatedAt: 20,
      playTimeSeconds: 12,
    },
    timeOfDay: 6000,
    weather: 'clear',
    player: {
      position: [8.5, 64, 8.5],
      velocity: [0.1, 0, -0.2],
      yaw: 1.2,
      pitch: 0.15,
      health: 18,
      hunger: 16,
      saturation: 4,
      absorption: 4,
      absorptionTicks: 200,
      selectedSlot: 2,
      spawnPoint: [8.5, 64, 8.5],
      inventory: inventoryWithDiamond(),
    },
    modifications: { '0,0': { '20': BlockId.Dirt } },
    chests: { '1,2,3': { slots: [] } },
    furnaces: {},
    droppedItems: [{
      id: 'drop-1',
      stack: { itemId: 'stick', count: 2 },
      position: [1, 64, 1],
      velocity: [0, 0, 0],
      ageSeconds: 1,
      pickupDelaySeconds: 0.4,
    }],
    mobs: [{
      id: 'mob-1',
      kind: 'pig',
      position: [4, 64, 4],
      velocity: [0, 0, 0],
      health: 10,
      state: 'idle',
      ageSeconds: 3,
      fuseSeconds: 0,
    }],
    minecarts: [{
      id: 'cart-1',
      position: [2, 64, 2],
      velocity: [0, 0, 0],
      yaw: 0,
      variant: 'normal',
      fuseTicks: 0,
      onRail: false,
    }],
    fallingBlocks: [],
    blockStates: { '5,64,5': { facing: 'north' } },
    redstone: { version: 2, sources: [], primedTnt: [] },
    serverWorld: {
      id: 'sp-test',
      initialized: true,
      spawnImported: true,
      importVersion: 3,
      spawn: [8.5, 64, 8.5],
    },
    ...overrides,
  });
}
