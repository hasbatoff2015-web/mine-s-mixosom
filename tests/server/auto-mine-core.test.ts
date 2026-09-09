import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { VoxelWorld } from '../../src/world/World';
import {
  AUTOMINE_ALLOWED_BLOCKS,
  AUTOMINE_COMPOSITION,
  AUTOMINE_MAX_EDGE,
  AUTOMINE_WEIGHT_TOTAL,
  AutoMineManager,
  automineWeightSum,
  cuboidSize,
  formatAutoMinePercent,
  parseAutoMineName,
  parseAutoMineStore,
  playerInsideVolume,
  selectAutoMineBlock,
  selectAutoMineBlockSlot,
  validateAutoMineVolume,
  volumeFromSelection,
  voxelAt,
  type AutoMineHost,
  type AutoMinePlayerRef,
  type AutoMineStore,
  type AutoMineTeleport,
} from '../../server/services/autoMine';
import { volumeFromCorners } from '../../server/services/selection';

describe('AutoMine selection and cuboid', () => {
  it('normalizes reversed corners and includes both endpoints', () => {
    const volume = volumeFromCorners({ x: 24, y: 64, z: 24 }, { x: 10, y: 50, z: 10 });
    expect(volume).toEqual({ minX: 10, minY: 50, minZ: 10, maxX: 24, maxY: 64, maxZ: 24 });
    expect(cuboidSize(volume)).toEqual({ width: 15, height: 15, depth: 15, blocks: 3375 });
  });

  it('sets first then second point and reports inclusive size', () => {
    const manager = new AutoMineManager(unusedHost());
    expect(manager.setSelectionPoint('p', { x: 10, y: 50, z: 10 }).slot).toBe(1);
    const second = manager.setSelectionPoint('p', { x: 24, y: 64, z: 24 });
    expect(second.slot).toBe(2);
    expect(second.volume && cuboidSize(second.volume).blocks).toBe(3375);
  });

  it('restarts the selection after both corners are set', () => {
    const manager = new AutoMineManager(unusedHost());
    manager.setSelectionPoint('p', { x: 0, y: 4, z: 0 });
    manager.setSelectionPoint('p', { x: 1, y: 5, z: 1 });
    const again = manager.setSelectionPoint('p', { x: 8, y: 8, z: 8 });
    expect(again.slot).toBe(1);
    expect(volumeFromSelection(manager.selectionOf('p'))).toBeUndefined();
  });

  it('treats boundary blocks as inside', () => {
    const volume = volumeFromCorners({ x: 10, y: 50, z: 10 }, { x: 24, y: 64, z: 24 });
    expect(playerInsideVolume({ x: 10, y: 50, z: 10 }, volume)).toBe(true);
    expect(playerInsideVolume({ x: 24.99, y: 64.2, z: 24.1 }, volume)).toBe(true);
    expect(playerInsideVolume({ x: 25, y: 64, z: 24 }, volume)).toBe(false);
    expect(playerInsideVolume({ x: 9.99, y: 50, z: 10 }, volume)).toBe(false);
  });

  it('rejects oversized volumes', () => {
    const volume = volumeFromCorners({ x: 0, y: 0, z: 0 }, { x: AUTOMINE_MAX_EDGE, y: 1, z: 1 });
    expect(validateAutoMineVolume(volume, 'anarchy', 'anarchy')).toMatch(/больше/);
  });
});

describe('AutoMine names', () => {
  it('normalizes case and rejects dangerous names', () => {
    expect(parseAutoMineName('SpawnMine')).toBe('spawnmine');
    expect(parseAutoMineName('spawn_mine_2')).toBe('spawn_mine_2');
    expect(parseAutoMineName('../etc')).toBeUndefined();
    expect(parseAutoMineName('a'.repeat(25))).toBeUndefined();
    expect(parseAutoMineName('')).toBeUndefined();
  });
});

describe('AutoMine weights', () => {
  it('keeps twelve block types, 100% sum, obsidian=coal, titanium rarest', () => {
    expect(AUTOMINE_COMPOSITION).toHaveLength(12);
    expect(new Set(AUTOMINE_COMPOSITION.map((entry) => entry.blockId)).size).toBe(12);
    expect(automineWeightSum()).toBe(AUTOMINE_WEIGHT_TOTAL);
    expect(AUTOMINE_WEIGHT_TOTAL).toBe(10_000);
    const coal = AUTOMINE_COMPOSITION.find((entry) => entry.blockId === BlockId.CoalOre)!;
    const obsidian = AUTOMINE_COMPOSITION.find((entry) => entry.blockId === BlockId.Obsidian)!;
    const titanium = AUTOMINE_COMPOSITION.find((entry) => entry.blockId === BlockId.TitaniumOre)!;
    expect(obsidian.weight).toBe(coal.weight);
    expect(titanium.weight).toBe(Math.min(...AUTOMINE_COMPOSITION.map((entry) => entry.weight)));
    expect(titanium.weight).toBe(5);
    expect(formatAutoMinePercent(1800)).toBe('18%');
    expect(formatAutoMinePercent(250)).toBe('2.5%');
    expect(formatAutoMinePercent(45)).toBe('0.45%');
    expect(formatAutoMinePercent(5)).toBe('0.05%');
  });

  it('does not collide TitaniumOre with TNT ids', () => {
    expect(BlockId.TitaniumOre).toBe(161);
    expect(BlockId.TntPowerful).toBe(162);
    expect(BlockId.TntDestructive).toBe(163);
    expect(BlockId.TitaniumOre).not.toBe(BlockId.Tnt);
    expect(BlockId.TitaniumOre).not.toBe(BlockId.TntPowerful);
  });

  it('selects cumulative ranges deterministically', () => {
    expect(selectAutoMineBlockSlot(0)).toBe(BlockId.OakLog);
    expect(selectAutoMineBlockSlot(1799)).toBe(BlockId.OakLog);
    expect(selectAutoMineBlockSlot(1800)).toBe(BlockId.BirchLog);
    expect(selectAutoMineBlockSlot(3199)).toBe(BlockId.BirchLog);
    expect(selectAutoMineBlockSlot(3200)).toBe(BlockId.SpruceLog);
    expect(selectAutoMineBlockSlot(4599)).toBe(BlockId.SpruceLog);
    expect(selectAutoMineBlockSlot(4600)).toBe(BlockId.Stone);
    expect(selectAutoMineBlockSlot(7099)).toBe(BlockId.Stone);
    expect(selectAutoMineBlockSlot(7100)).toBe(BlockId.Gravel);
    expect(selectAutoMineBlockSlot(8099)).toBe(BlockId.Gravel);
    expect(selectAutoMineBlockSlot(8100)).toBe(BlockId.CoalOre);
    expect(selectAutoMineBlockSlot(8599)).toBe(BlockId.CoalOre);
    expect(selectAutoMineBlockSlot(8600)).toBe(BlockId.RedstoneOre);
    expect(selectAutoMineBlockSlot(8999)).toBe(BlockId.RedstoneOre);
    expect(selectAutoMineBlockSlot(9000)).toBe(BlockId.GoldOre);
    expect(selectAutoMineBlockSlot(9249)).toBe(BlockId.GoldOre);
    expect(selectAutoMineBlockSlot(9250)).toBe(BlockId.IronOre);
    expect(selectAutoMineBlockSlot(9449)).toBe(BlockId.IronOre);
    expect(selectAutoMineBlockSlot(9450)).toBe(BlockId.Obsidian);
    expect(selectAutoMineBlockSlot(9949)).toBe(BlockId.Obsidian);
    expect(selectAutoMineBlockSlot(9950)).toBe(BlockId.DiamondOre);
    expect(selectAutoMineBlockSlot(9994)).toBe(BlockId.DiamondOre);
    expect(selectAutoMineBlockSlot(9995)).toBe(BlockId.TitaniumOre);
    expect(selectAutoMineBlockSlot(9999)).toBe(BlockId.TitaniumOre);
    expect(selectAutoMineBlock(0)).toBe(BlockId.OakLog);
    expect(selectAutoMineBlock(0.18)).toBe(BlockId.BirchLog);
    expect(selectAutoMineBlock(0.9995)).toBe(BlockId.TitaniumOre);
    expect(selectAutoMineBlock(1)).toBe(BlockId.TitaniumOre);
  });
});

describe('AutoMine persistence parse', () => {
  it('loads valid mines and skips malformed entries', () => {
    const store = parseAutoMineStore({
      mines: [
        {
          name: 'SpawnMine',
          worldId: 'anarchy',
          minX: 0, minY: 4, minZ: 0, maxX: 1, maxY: 5, maxZ: 1,
          intervalSeconds: 60,
          teleport: { worldId: 'anarchy', x: 1, y: 6, z: 1, yaw: 0.2, pitch: -0.1 },
          nextResetAt: 50,
        },
        { name: '../bad' },
        { name: 'spawnmine', worldId: 'anarchy', minX: 0, minY: 4, minZ: 0, maxX: 1, maxY: 5, maxZ: 1 },
        null,
        { name: 'ok2', worldId: 'anarchy', minX: 2, minY: 4, minZ: 2, maxX: 3, maxY: 5, maxZ: 3, intervalSeconds: 1 },
      ],
    });
    expect(store.mines.map((mine) => mine.name)).toEqual(['spawnmine', 'ok2']);
    expect(store.mines[0]?.intervalSeconds).toBe(60);
    expect(store.mines[1]?.intervalSeconds).toBeNull();
  });
});

describe('AutoMine generation workload', () => {
  it('fills only allowed blocks, batched, and reset replaces the whole volume', () => {
    const world = new VoxelWorld('automine-gen');
    const volume = volumeFromCorners({ x: 4, y: 40, z: 4 }, { x: 6, y: 42, z: 6 });
    const size = cuboidSize(volume);
    for (let i = 0; i < size.blocks; i += 1) {
      const pos = voxelAt(volume, i);
      world.setBlock(pos.x, pos.y, pos.z, BlockId.Dirt);
    }
    const batchSizes: number[] = [];
    const original = world.applyBlockBatch.bind(world);
    world.applyBlockBatch = ((mutations, options) => {
      batchSizes.push(mutations.length);
      return original(mutations, options);
    }) as VoxelWorld['applyBlockBatch'];

    const host = memoryHost(world);
    const manager = new AutoMineManager(host);
    manager.enabled = true;
    manager.blocksPerTick = 5;
    const created = manager.create('pit', volume, 'anarchy');
    expect(created.ok).toBe(true);
    expect(manager.statusOf('pit')).toBe('RESETTING');
    manager.tick();
    expect(manager.isResetting('pit')).toBe(true);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(5);
    drain(manager, 'pit');
    expect(manager.statusOf('pit')).toBe('READY');
    expect(countVolume(world, volume)).toBe(size.blocks);
    expect(dirtCount(world, volume)).toBe(0);
    for (let i = 0; i < size.blocks; i += 1) {
      const pos = voxelAt(volume, i);
      expect(AUTOMINE_ALLOWED_BLOCKS.has(world.getBlock(pos.x, pos.y, pos.z))).toBe(true);
    }

    for (let i = 0; i < size.blocks; i += 1) {
      const pos = voxelAt(volume, i);
      world.setBlock(pos.x, pos.y, pos.z, BlockId.Dirt);
    }
    host.teleportDest = { worldId: 'anarchy', x: 0.5, y: 50, z: 0.5, yaw: 1, pitch: 0.2 };
    expect(manager.setTeleport('pit', host.teleportDest).ok).toBe(true);
    expect(manager.requestReset('pit', { manual: true }).ok).toBe(true);
    expect(manager.requestReset('pit', { manual: true }).ok).toBe(false);
    drain(manager, 'pit');
    expect(dirtCount(world, volume)).toBe(0);
    expect(countVolume(world, volume)).toBe(size.blocks);
  });

  it('fills an inclusive 15×15×15 volume without a giant single-tick loop', () => {
    const world = new VoxelWorld('automine-15');
    const volume = volumeFromCorners({ x: 10, y: 50, z: 10 }, { x: 24, y: 64, z: 24 });
    expect(cuboidSize(volume).blocks).toBe(3375);
    const batchSizes: number[] = [];
    const original = world.applyBlockBatch.bind(world);
    world.applyBlockBatch = ((mutations, options) => {
      batchSizes.push(mutations.length);
      return original(mutations, options);
    }) as VoxelWorld['applyBlockBatch'];
    const host = memoryHost(world);
    const manager = new AutoMineManager(host);
    manager.enabled = true;
    manager.blocksPerTick = 64;
    expect(manager.create('spawnmine', volume, 'anarchy').ok).toBe(true);
    manager.tick();
    expect(manager.isResetting('spawnmine')).toBe(true);
    expect(Math.max(...batchSizes)).toBe(64);
    drain(manager, 'spawnmine', 80);
    expect(cuboidSize(volume).blocks).toBe(countVolume(world, volume));
    expect(dirtCount(world, volume)).toBe(0);
  });

  it('does not start overlapping resets and restores originals on delete', () => {
    const world = new VoxelWorld('automine-del');
    const volume = volumeFromCorners({ x: 1, y: 20, z: 1 }, { x: 2, y: 21, z: 2 });
    world.setBlock(1, 20, 1, BlockId.Bricks);
    const host = memoryHost(world);
    const manager = new AutoMineManager(host);
    manager.enabled = true;
    manager.blocksPerTick = 2;
    expect(manager.create('box', volume, 'anarchy').ok).toBe(true);
    expect(manager.delete('box').ok).toBe(true);
    expect(manager.requestReset('box', { manual: true }).ok).toBe(false);
    drainMissing(manager, 'box');
    expect(manager.get('box')).toBeUndefined();
    expect(world.getBlock(1, 20, 1)).toBe(BlockId.Bricks);
  });
});

describe('AutoMine evacuation and timer', () => {
  it('teleports players inside and on the boundary, not outside or other worlds', () => {
    const world = new VoxelWorld('automine-evac');
    const volume = volumeFromCorners({ x: 10, y: 50, z: 10 }, { x: 12, y: 52, z: 12 });
    const teleported: string[] = [];
    const looks = new Map<string, { yaw: number; pitch: number }>();
    const players: AutoMinePlayerRef[] = [
      playerRef('inside', 11.2, 51.1, 11.4, 0.1, 0.2),
      playerRef('edge', 12.0, 52.0, 12.0, 0.3, -0.4),
      playerRef('outside', 13.0, 51.0, 11.0, 0, 0),
    ];
    const host = memoryHost(world, {
      players: () => players,
      teleport: (id, dest) => {
        teleported.push(id);
        looks.set(id, { yaw: dest.yaw, pitch: dest.pitch });
        return { ok: true };
      },
    });
    const manager = new AutoMineManager(host);
    manager.enabled = true;
    manager.blocksPerTick = 64;
    manager.create('cave', volume, 'anarchy');
    drain(manager, 'cave');
    const dest: AutoMineTeleport = { worldId: 'anarchy', x: 1.5, y: 70, z: 2.5, yaw: 1.25, pitch: -0.5 };
    manager.setTeleport('cave', dest);
    expect(manager.requestReset('cave', { manual: true }).ok).toBe(true);
    expect(teleported.sort()).toEqual(['edge', 'inside']);
    expect(looks.get('inside')).toEqual({ yaw: 1.25, pitch: -0.5 });
    teleported.length = 0;
    drain(manager, 'cave');

    const mine = manager.get('cave')!;
    (mine as { worldId: string }).worldId = 'other';
    expect(manager.requestReset('cave', { manual: true }).ok).toBe(false);
    expect(teleported).toEqual([]);
  });

  it('schedules the next reset after finish, runs one overdue reset, and ignores missing teleport', () => {
    const world = new VoxelWorld('automine-timer');
    const volume = volumeFromCorners({ x: 0, y: 10, z: 0 }, { x: 1, y: 11, z: 1 });
    let now = 1_000_000;
    const host = memoryHost(world, { now: () => now });
    const manager = new AutoMineManager(host);
    manager.enabled = true;
    manager.create('timed', volume, 'anarchy');
    drain(manager, 'timed');
    const resetWithoutTp = manager.requestReset('timed', { manual: true });
    expect(resetWithoutTp.ok).toBe(false);
    if (resetWithoutTp.ok) throw new Error('expected teleport error');
    expect(resetWithoutTp.error).toMatch(/телепорта/);
    expect(manager.setIntervalSeconds('timed', 60).ok).toBe(true);
    expect(manager.get('timed')?.nextResetAt).toBeNull();
    const dest: AutoMineTeleport = { worldId: 'anarchy', x: 8, y: 20, z: 8, yaw: 0, pitch: 0 };
    expect(manager.setTeleport('timed', dest).ok).toBe(true);
    expect(manager.get('timed')?.nextResetAt).toBe(now + 60_000);
    now += 59_000;
    manager.tick(now);
    expect(manager.isResetting('timed')).toBe(false);
    now += 2_000;
    manager.tick(now);
    expect(manager.isResetting('timed')).toBe(true);
    drain(manager, 'timed');
    expect(manager.get('timed')?.nextResetAt).toBe(now + 60_000);

    const saved: AutoMineStore = { mines: [...host.store.mines] };
    now += 10_000_000;
    const again = new AutoMineManager({ ...host, loadStore: () => saved });
    again.enabled = true;
    again.blocksPerTick = 1;
    again.load();
    again.tick(now);
    expect(again.isResetting('timed')).toBe(true);
    again.tick(now);
    expect(again.isResetting('timed')).toBe(true);
    drain(again, 'timed');
    expect(again.get('timed')?.nextResetAt).toBe(now + 60_000);
  });
});

function unusedHost(): AutoMineHost {
  return memoryHost(new VoxelWorld('unused'));
}

function playerRef(
  id: string,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): AutoMinePlayerRef {
  return {
    id,
    position: () => ({ x, y, z }),
    snapshot: () => ({ yaw, pitch }),
  };
}

function memoryHost(world: VoxelWorld, extra: Partial<AutoMineHost> = {}): AutoMineHost & {
  store: AutoMineStore;
  originals: Map<string, { blocks: number[] }>;
  teleportDest: AutoMineTeleport | null;
} {
  const store: AutoMineStore = { mines: [] };
  const originals = new Map<string, { blocks: number[] }>();
  const host: AutoMineHost & {
    store: AutoMineStore;
    originals: Map<string, { blocks: number[] }>;
    teleportDest: AutoMineTeleport | null;
  } = {
    world,
    store,
    originals,
    teleportDest: null,
    worldId: () => 'anarchy',
    now: () => Date.now(),
    random: () => 0.5,
    loadStore: () => store,
    saveStore: (next: AutoMineStore) => { store.mines = next.mines; },
    loadOriginals: (name: string) => originals.get(name),
    saveOriginals: (name: string, blocks: readonly number[]) => {
      originals.set(name, { blocks: [...blocks] });
    },
    players: () => [],
    teleport: () => ({ ok: true }),
    send: () => undefined,
    notifyAdmins: () => undefined,
    log: () => undefined,
    ...extra,
  };
  return host;
}

function drain(manager: AutoMineManager, name: string, ticks = 80): void {
  for (let i = 0; i < ticks; i += 1) {
    if (!manager.isResetting(name)) return;
    manager.tick();
  }
  throw new Error(`AutoMine '${name}' did not finish in ${ticks} ticks`);
}

function drainMissing(manager: AutoMineManager, name: string, ticks = 80): void {
  for (let i = 0; i < ticks; i += 1) {
    if (!manager.get(name) && !manager.isResetting(name)) return;
    manager.tick();
  }
  throw new Error(`AutoMine '${name}' was not deleted in ${ticks} ticks`);
}

function countVolume(world: VoxelWorld, volume: ReturnType<typeof volumeFromCorners>): number {
  let count = 0;
  const size = cuboidSize(volume);
  for (let i = 0; i < size.blocks; i += 1) {
    const pos = voxelAt(volume, i);
    if (world.getBlock(pos.x, pos.y, pos.z) !== BlockId.Air) count += 1;
  }
  return count;
}

function dirtCount(world: VoxelWorld, volume: ReturnType<typeof volumeFromCorners>): number {
  let count = 0;
  const size = cuboidSize(volume);
  for (let i = 0; i < size.blocks; i += 1) {
    const pos = voxelAt(volume, i);
    if (world.getBlock(pos.x, pos.y, pos.z) === BlockId.Dirt) count += 1;
  }
  return count;
}
