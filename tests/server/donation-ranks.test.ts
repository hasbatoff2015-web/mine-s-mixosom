import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../../src/inventory';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import {
  DONATION_DAY_MS,
  DONATION_RANK_DURATION_MS,
  DONATION_WEEK_MS,
  RANK_LIMITS,
  announcementLine,
  donationNodesAreNonAdmin,
  permissionNodesForRank,
  sanitizeAnnouncementText,
} from '../../shared/donationRanks';
import { resolveHomeLimit } from '../../shared/homes';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { AuctionService } from '../../server/services/auction';
import { attemptCoordinateTeleport } from '../../server/services/coordinateTeleport';
import { DonationRankService } from '../../server/services/donationRanks';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';
import { PermissionService } from '../../server/services/permissions';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function ranks(): Promise<{ service: DonationRankService; permissions: PermissionService; dir: string }> {
  const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-donate-'));
  dirs.push(dir);
  const store = new JsonFileStore(dir);
  const permissions = new PermissionService(store);
  permissions.load();
  const service = new DonationRankService(store, (value) => permissions.keyFor(value));
  service.load();
  permissions.setExtraNodes((key) => service.permissionNodes(key));
  return { service, permissions, dir };
}

describe('donation rank limits and expiry', () => {
  it('gives default 3 homes, 3 claims and 7 auction lots', async () => {
    const { service } = await ranks();
    expect(service.limit('ada', 'homes')).toBe(3);
    expect(service.limit('ada', 'claims')).toBe(3);
    expect(service.limit('ada', 'auction')).toBe(7);
    expect(RANK_LIMITS.default).toMatchObject({ homes: 3, claims: 3, auction: 7 });
  });

  it('matches the rank table and lets TITAN include every lower benefit', async () => {
    const { service, permissions } = await ranks();
    const now = Date.now();
    for (const rank of ['vip', 'premium', 'boss', 'titan'] as const) {
      expect(service.grant('ada', rank, { now, durationMs: DONATION_RANK_DURATION_MS }).ok).toBe(true);
      expect(service.limit('ada', 'homes', now + 1)).toBe(RANK_LIMITS[rank].homes);
      expect(service.limit('ada', 'claims', now + 1)).toBe(RANK_LIMITS[rank].claims);
      expect(service.limit('ada', 'auction', now + 1)).toBe(RANK_LIMITS[rank].auction);
    }
    const nodes = permissionNodesForRank('titan');
    expect(nodes).toEqual(expect.arrayContaining([
      'enderchest.use', 'announce.use', 'back.death', 'tpa.coords', 'invsee.use', 'nick.color',
      'kit.use.vip', 'kit.use.prem', 'kit.use.boss', 'kit.use.titan',
      'kit.use.food_vip', 'kit.use.food_titan',
    ]));
    expect(nodes).not.toContain('invsee.edit');
    expect(donationNodesAreNonAdmin(nodes)).toBe(true);
    expect(permissions.has('ada', 'enderchest.use')).toBe(true);
    expect(permissions.has('ada', 'server.admin')).toBe(false);
    expect(permissions.has('ada', 'plugins.manage')).toBe(false);
    expect(permissions.isOperator('ada')).toBe(false);
  });

  it('expires immediately, keeps objects, and reloads after a restart', async () => {
    const { service, permissions, dir } = await ranks();
    const now = 5_000;
    expect(service.grant('ada', 'boss', { now, durationMs: 1_000, source: 'op' }).ok).toBe(true);
    expect(service.effectiveRank('ada', now + 999)).toBe('boss');
    expect(service.effectiveRank('ada', now + 1_000)).toBe('default');
    expect(permissions.has('ada', 'announce.use')).toBe(false);
    expect(service.limit('ada', 'homes', now + 1_000)).toBe(3);

    const again = new DonationRankService(new JsonFileStore(dir), (value) => value.trim().toLowerCase());
    again.load();
    expect(again.effectiveRank('ada', now + 100)).toBe('boss');
    expect(again.activeGrant('ada', now + 100)?.source).toBe('op');
    expect(again.effectiveRank('ada', now + 1_000)).toBe('default');
  });

  it('adds an extension to the current end and starts from now after expiry', async () => {
    const { service } = await ranks();
    const now = 10_000;
    service.grant('ada', 'vip', { now, durationMs: 5_000 });
    const extended = service.extend('ada', { now: now + 1_000, durationMs: 30 * DONATION_DAY_MS });
    expect(extended.ok).toBe(true);
    expect(extended.expiresAt).toBe(now + 5_000 + 30 * DONATION_DAY_MS);
    expect(service.effectiveRank('ada', extended.expiresAt! - 1)).toBe('vip');

    const expiredAt = extended.expiresAt! + 10;
    const renewed = service.extend('ada', { now: expiredAt, durationMs: 2_000 });
    expect(renewed.ok).toBe(true);
    expect(renewed.expiresAt).toBe(expiredAt + 2_000);
    expect(service.effectiveRank('ada', expiredAt)).toBe('vip');
  });

  it('does not raise the home cap by deleting homes when the rank drops', () => {
    expect(resolveHomeLimit({
      donation: 7, operator: false, wildcard: false, multiple: false, premiumNode: false,
    })).toBe(7);
    expect(resolveHomeLimit({
      donation: 3, operator: false, wildcard: false, multiple: false, premiumNode: false,
    })).toBe(3);
    expect(resolveHomeLimit({
      donation: 3, operator: false, wildcard: false, multiple: true, premiumNode: true,
    })).toBe(5);
  });

  it('rejects a forged announcement and builds the name on the server', () => {
    expect(sanitizeAnnouncementText('')).toBeUndefined();
    expect(sanitizeAnnouncementText('  \n\t')).toBeUndefined();
    expect(sanitizeAnnouncementText(`[VIP] ${'a'.repeat(200)}`)).toBeUndefined();
    expect(sanitizeAnnouncementText('Продаю §cресурсы &l[ADMIN]')).toBe('Продаю ресурсы');
    expect(announcementLine('Alex', 'Продаю ресурсы на аукционе!'))
      .toBe('[ОБЪЯВЛЕНИЕ ОТ ИГРОКА Alex] Продаю ресурсы на аукционе!');
  });

  it('does not spend a cooldown when the action fails, and blocks a nested call', async () => {
    const { service } = await ranks();
    const failed = service.consumeIf('ada', 'announce', 1, () => false);
    expect(failed.ok).toBe(false);
    expect(service.peekCooldown('ada', 'announce', 1).used).toBe(0);
    let nested: { ok: boolean } | undefined;
    const first = service.consumeIf('ada', 'announce', 1, () => {
      nested = service.consumeIf('ada', 'announce', 1, () => true);
      return true;
    });
    expect(first.ok).toBe(true);
    expect(nested?.ok).toBe(false);
    expect(service.peekCooldown('ada', 'announce', 1).used).toBe(1);
  });

  it('keeps kit cooldowns across a reload without touching the start ledger', async () => {
    const { service, dir } = await ranks();
    const now = 50_000;
    expect(service.consumeIf('ada', 'kit:vip', 1, () => true, now).ok).toBe(true);
    expect(service.peekCooldown('ada', 'kit:vip', 1, now + DONATION_WEEK_MS - 1).allowed).toBe(false);
    const again = new DonationRankService(new JsonFileStore(dir));
    again.load();
    expect(again.peekCooldown('ada', 'kit:vip', 1, now + 10).allowed).toBe(false);
    expect(again.peekCooldown('ada', 'kit:food_vip', 1, now + 10).allowed).toBe(true);
    expect(again.peekCooldown('ada', 'kit:vip', 1, now + DONATION_WEEK_MS).allowed).toBe(true);
  });

  it('does not spend a coordinate teleport that fails validation', () => {
    let teleports = 0;
    const denied = attemptCoordinateTeleport({
      hasPermission: () => false,
      isOperator: () => false,
      teleport: () => { teleports += 1; return { ok: true }; },
      peekCooldown: () => ({ allowed: true, remainingMs: 0 }),
      consume: (_id, _now, commit) => (commit() ? { ok: true } : { ok: false, error: 'no' }),
    }, 'ada', { x: 1, y: 70, z: 1 });
    expect(denied.ok).toBe(false);
    expect(teleports).toBe(0);

    let consumed = 0;
    const badY = attemptCoordinateTeleport({
      hasPermission: () => true,
      isOperator: () => false,
      teleport: () => { teleports += 1; return { ok: true }; },
      peekCooldown: () => ({ allowed: true, remainingMs: 0 }),
      consume: (_id, _now, commit) => { consumed += 1; return commit() ? { ok: true } : { ok: false, error: 'no' }; },
    }, 'ada', { x: 1, y: 99_999, z: 1 });
    expect(badY.ok).toBe(false);
    expect(teleports).toBe(0);
    expect(consumed).toBe(0);
  });

  it('stops two nested auction listings from passing one active cap', async () => {
    const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-donate-ah-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    economy.load();
    const auction = new AuctionService(store, economy);
    auction.load();
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('dirt', 5));
    inventory.setSlot(1, createItemStack('stone', 1));
    const original = inventory.setSlot.bind(inventory);
    inventory.setSlot = (slot, stack) => {
      original(slot, stack);
      if (slot !== 0) return;
      const nested = auction.createListing('seller', 'Ada', inventory, 1, 1, 10, undefined, 1);
      expect(nested.ok).toBe(false);
    };
    const created = auction.createListing('seller', 'Ada', inventory, 0, 1, 10, undefined, 1);
    expect(created.ok).toBe(true);
    expect(auction.activeCount('seller')).toBe(1);
  });
});

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function resultLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string; style?: string; nameStyle?: { prefix?: string } };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: pathJoin(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

describe('donation commands on the anarchy world', () => {
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-donate-world-'));
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function chat(world: WorldInstance, player: ReturnType<typeof join>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return resultLines(player.sink);
  }

  it('blocks donate commands for a default player and keeps /tpa requests', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    expect(chat(world, ada, '/ec').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, ada, '/an hello').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, ada, '/invsee Bob').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, ada, '/invseeop Bob').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, ada, '/tpa 8 70 8').some((line) => line.includes('permission'))).toBe(true);
    expect(ada.player.window.kind).toBe('inventory');
    expect(chat(world, ada, '/tpa Bob').some((line) => line.includes('Asked Bob'))).toBe(true);
    expect(world.commands.find('tp')?.usage).toBe('/tp <x> <y> <z>');
    expect(chat(world, ada, '/tp 8 70 8').some((line) => line.includes('Teleported'))).toBe(true);
  });

  it('grants 30 days, extends the current end, and keeps the rank across a restart', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    const before = Date.now();
    expect(chat(world, op, '/donate grant Ada vip').some((line) => line.includes('vip'))).toBe(true);
    const grant = world.donation.activeGrant(ada.player.id);
    expect(grant?.rank).toBe('vip');
    expect(grant!.expiresAt - grant!.grantedAt).toBe(DONATION_RANK_DURATION_MS);
    expect(grant!.expiresAt).toBeGreaterThanOrEqual(before + DONATION_RANK_DURATION_MS - 5_000);
    const extended = world.donation.extend('Ada', { durationMs: DONATION_DAY_MS });
    expect(extended.expiresAt).toBe(grant!.expiresAt + DONATION_DAY_MS);

    await world.save();
    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    expect(again.donation.effectiveRank('Ada')).toBe('vip');
    expect(again.donation.activeGrant('Ada')?.expiresAt).toBe(extended.expiresAt);
  });

  it('enforces home, claim and auction caps without deleting old objects', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    for (const name of ['a', 'b', 'c']) {
      expect(chat(world, ada, `/sethome ${name}`).some((line) => line.includes('set'))).toBe(true);
    }
    expect(chat(world, ada, '/sethome d').some((line) => line.includes('3 home'))).toBe(true);
    chat(world, op, '/donate grant Ada vip');
    expect(chat(world, ada, '/sethome d').some((line) => line.includes('set'))).toBe(true);
    chat(world, op, '/donate revoke Ada');
    expect(world.homes.list('Ada')).toHaveLength(4);
    expect(chat(world, ada, '/sethome e').some((line) => line.includes('3 home'))).toBe(true);

    const origin = ada.player.controller.position;
    for (let index = 0; index < 3; index += 1) {
      const base = origin.x + index * 30;
      ada.player.controller.teleport([base, origin.y, origin.z]);
      chat(world, ada, '/claim pos1');
      ada.player.controller.teleport([base + 2, origin.y + 2, origin.z + 2]);
      chat(world, ada, '/claim pos2');
      expect(chat(world, ada, `/claim create zone${index}`).some((line) => line.includes('created'))).toBe(true);
    }
    ada.player.controller.teleport([origin.x + 6, origin.y, origin.z]);
    chat(world, ada, '/claim pos1');
    ada.player.controller.teleport([origin.x + 7, origin.y + 1, origin.z + 1]);
    chat(world, ada, '/claim pos2');
    expect(chat(world, ada, '/claim create overflow').some((line) => line.includes('3 claims'))).toBe(true);
    expect(world.pluginStore.load<{ claims: unknown[] }>('claims/claims', { claims: [] }).claims).toHaveLength(3);

    for (let index = 0; index < 7; index += 1) {
      ada.player.inventory.setSlot(0, createItemStack('dirt', 1));
      world.handleAuctionAction(ada.player, {
        type: 'auction_action', action: 'create', slot: 0, amount: 1, price: '10',
      });
    }
    expect(world.auction.activeCount(ada.player.id)).toBe(7);
    ada.player.inventory.setSlot(0, createItemStack('dirt', 1));
    world.handleAuctionAction(ada.player, {
      type: 'auction_action', action: 'create', slot: 0, amount: 1, price: '10',
    });
    expect(world.auction.activeCount(ada.player.id)).toBe(7);
  });

  it('opens the existing portal chest, announces once, and colors the real nick', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    chat(world, op, '/donate grant Ada premium');
    ada.player.portalChest.slots[0] = createItemStack('diamond', 4);
    expect(chat(world, ada, '/ec').some((line) => line.includes('открыт'))).toBe(true);
    expect(ada.player.window.kind).toBe('portal-chest');
    expect(ada.player.portalChest.slots[0]?.itemId).toBe('diamond');
    world.applyInventoryAction(ada.player, { type: 'inventory_action', action: 'close' });

    bob.sink.payloads.length = 0;
    expect(chat(world, ada, '/an Продаю [VIP] ресурсы').some((line) => line.includes('отправлено'))).toBe(true);
    const heard = bob.sink.payloads.find((payload) => (payload as { type?: string }).type === 'chat') as {
      text?: string; style?: string;
    };
    expect(heard.style).toBe('announcement');
    expect(heard.text).toBe('[ОБЪЯВЛЕНИЕ ОТ ИГРОКА [PREMIUM] Ada] Продаю ресурсы');
    expect(chat(world, ada, '/an ещё раз').some((line) => line.includes('через'))).toBe(true);

    expect(chat(world, ada, '/nickcolor pink').some((line) => line.includes('Неизвестный'))).toBe(true);
    expect(chat(world, ada, '/nickcolor aqua').some((line) => line.includes('aqua'))).toBe(true);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, 'привет');
    const said = ada.sink.payloads.find((payload) => {
      const record = payload as { type?: string; kind?: string };
      return record.type === 'chat' && record.kind === 'player';
    }) as { from?: string; text?: string; nameStyle?: { prefix?: string; nameColor?: string } };
    expect(said.from).toBe('Ada');
    expect(said.text).toBe('привет');
    expect(said.nameStyle?.prefix).toBe('[PREMIUM]');
    expect(said.nameStyle?.nameColor).toBe('aqua');
  });

  it('limits death back and coordinate teleport to successful moves', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    chat(world, op, '/donate grant Ada titan');
    const start = { ...ada.player.controller.position };
    const markDeath = () => {
      world.events.emit('entityDeath', {
        entityId: ada.player.id,
        playerId: ada.player.id,
        cause: 'generic',
      });
    };
    markDeath();
    ada.player.controller.teleport([start.x + 30, start.y, start.z]);
    expect(chat(world, ada, '/back').some((line) => line.includes('death'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(start.x, 1);
    ada.player.controller.teleport([start.x + 40, start.y, start.z]);
    markDeath();
    ada.player.controller.teleport([start.x + 50, start.y, start.z]);
    expect(chat(world, ada, '/back').some((line) => line.includes('death'))).toBe(true);
    markDeath();
    ada.player.controller.teleport([start.x + 60, start.y, start.z]);
    expect(chat(world, ada, '/back').some((line) => line.includes('через'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(start.x + 60, 1);

    const before = { ...ada.player.controller.position };
    expect(chat(world, ada, '/tpa 4 70 4').some((line) => line.includes('Teleported'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(4, 1);
    ada.player.controller.teleport([start.x, start.y, start.z]);
    expect(chat(world, ada, '/tpa 9 70 9').some((line) => line.includes('через'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(start.x, 1);
    expect(chat(world, ada, '/tpa not-a-player').some((line) => line.includes('not online'))).toBe(true);
    expect(chat(world, op, '/tpa 6 70 6').some((line) => line.includes('Teleported'))).toBe(true);
    expect(chat(world, op, '/tpa 7 70 7').some((line) => line.includes('Teleported'))).toBe(true);
    expect(before.x).toBeTypeOf('number');
  });

  it('keeps /invsee read-only and lets only OP edit', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    chat(world, op, '/donate grant Ada titan');
    bob.player.inventory.setSlot(10, createItemStack('diamond', 3));
    bob.player.inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack('iron_helmet', 1));
    expect(chat(world, ada, '/invsee Bob').some((line) => line.includes('просмотра'))).toBe(true);
    expect(ada.player.window.kind).toBe('invsee');
    world.applyInventoryAction(ada.player, {
      type: 'inventory_action', action: 'click', key: 'container-1', button: 'left',
    });
    world.applyInventoryAction(ada.player, {
      type: 'inventory_action', action: 'click', key: 'container-36', button: 'left',
    });
    world.applyInventoryAction(ada.player, {
      type: 'inventory_action', action: 'move_stack', sourceKey: 'container-1', targetKey: 'inventory-0',
    });
    world.applyInventoryAction(ada.player, {
      type: 'inventory_action', action: 'open', kind: 'invsee-op',
    });
    expect(bob.player.inventory.getSlot(10)?.count).toBe(3);
    expect(bob.player.inventory.getSlot({ section: 'armor', slot: 'head' })?.itemId).toBe('iron_helmet');
    expect(ada.player.cursor).toBeNull();
    expect(ada.player.window.kind).toBe('invsee');

    expect(chat(world, ada, '/invseeop Bob').some((line) => line.includes('permission'))).toBe(true);
    expect(chat(world, op, '/invseeop Bob').some((line) => line.includes('изменения'))).toBe(true);
    expect(op.player.window.kind).toBe('invsee-op');
    world.applyInventoryAction(op.player, {
      type: 'inventory_action', action: 'click', key: 'container-1', button: 'left',
    });
    expect(op.player.cursor?.itemId).toBe('diamond');
    expect(bob.player.inventory.getSlot(10)).toBeNull();
    world.disconnect(bob.player.id);
    expect(op.player.window.kind).toBe('inventory');
  });
});
