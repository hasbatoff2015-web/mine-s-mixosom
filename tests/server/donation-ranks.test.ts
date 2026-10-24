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
  formatRankExpiry,
  parseRankTestDuration,
  permissionNodesForRank,
  sanitizeAnnouncementText,
} from '../../shared/donationRanks';
import { resolveHomeLimit } from '../../shared/homes';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { AuctionService, syncAuction } from '../../server/services/auction';
import { attemptCoordinateTeleport } from '../../server/services/coordinateTeleport';
import { DonationRankService } from '../../server/services/donationRanks';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';
import { PermissionService } from '../../server/services/permissions';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const ADA = '11111111-1111-4111-8111-111111111111';

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
    expect(service.limit(ADA, 'homes')).toBe(3);
    expect(service.limit(ADA, 'claims')).toBe(3);
    expect(service.limit(ADA, 'auction')).toBe(7);
    expect(RANK_LIMITS.default).toMatchObject({ homes: 3, claims: 3, auction: 7 });
  });

  it('matches the rank table and lets TITAN include every lower benefit', async () => {
    const { service, permissions } = await ranks();
    const now = Date.now();
    for (const rank of ['vip', 'premium', 'boss', 'titan'] as const) {
      expect(service.grant(ADA, rank, { now, durationMs: DONATION_RANK_DURATION_MS }).ok).toBe(true);
      expect(service.limit(ADA, 'homes', now + 1)).toBe(RANK_LIMITS[rank].homes);
      expect(service.limit(ADA, 'claims', now + 1)).toBe(RANK_LIMITS[rank].claims);
      expect(service.limit(ADA, 'auction', now + 1)).toBe(RANK_LIMITS[rank].auction);
    }
    const nodes = permissionNodesForRank('titan');
    expect(nodes).toEqual(expect.arrayContaining([
      'enderchest.use', 'announce.use', 'back.death', 'tp.coords', 'invsee.use', 'nick.color',
      'pet.bee', 'pet.creeper',
      'kit.use.vip', 'kit.use.prem', 'kit.use.boss', 'kit.use.titan',
      'kit.use.food_vip', 'kit.use.food_titan',
    ]));
    expect(permissionNodesForRank('premium')).not.toContain('pet.bee');
    expect(permissionNodesForRank('boss')).toContain('pet.bee');
    expect(permissionNodesForRank('boss')).not.toContain('pet.creeper');
    expect(permissionNodesForRank('titan')).toContain('pet.creeper');
    expect(permissionNodesForRank('vip')).toContain('enderchest.use');
    expect(permissionNodesForRank('vip')).not.toContain('announce.use');
    expect(nodes).not.toContain('invsee.edit');
    expect(donationNodesAreNonAdmin(nodes)).toBe(true);
    expect(permissions.has(ADA, 'enderchest.use')).toBe(true);
    expect(permissions.has(ADA, 'server.admin')).toBe(false);
    expect(permissions.has(ADA, 'plugins.manage')).toBe(false);
    expect(permissions.isOperator(ADA)).toBe(false);
  });

  it('expires immediately, keeps objects, and reloads after a restart', async () => {
    const { service, permissions, dir } = await ranks();
    const now = 5_000;
    expect(service.grant(ADA, 'boss', { now, durationMs: 1_000, source: 'op' }).ok).toBe(true);
    expect(service.effectiveRank(ADA, now + 999)).toBe('boss');
    expect(service.effectiveRank(ADA, now + 1_000)).toBe('default');
    expect(permissions.has(ADA, 'announce.use')).toBe(false);
    expect(service.limit(ADA, 'homes', now + 1_000)).toBe(3);

    const again = new DonationRankService(new JsonFileStore(dir), (value) => value.trim().toLowerCase());
    again.load();
    expect(again.effectiveRank(ADA, now + 100)).toBe('boss');
    expect(again.activeGrant(ADA, now + 100)?.source).toBe('op');
    expect(again.effectiveRank(ADA, now + 1_000)).toBe('default');
  });

  it('adds an extension to the current end and starts from now after expiry', async () => {
    const { service } = await ranks();
    const now = 10_000;
    service.grant(ADA, 'vip', { now, durationMs: 5_000 });
    const extended = service.extend(ADA, { now: now + 1_000, durationMs: 30 * DONATION_DAY_MS });
    expect(extended.ok).toBe(true);
    expect(extended.expiresAt).toBe(now + 5_000 + 30 * DONATION_DAY_MS);
    expect(service.effectiveRank(ADA, extended.expiresAt! - 1)).toBe('vip');

    const expiredAt = extended.expiresAt! + 10;
    const renewed = service.extend(ADA, { now: expiredAt, durationMs: 2_000 });
    expect(renewed.ok).toBe(true);
    expect(renewed.expiresAt).toBe(expiredAt + 2_000);
    expect(service.effectiveRank(ADA, expiredAt)).toBe('vip');
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
    const failed = service.consumeIf(ADA, 'announce', 1, () => false);
    expect(failed.ok).toBe(false);
    expect(service.peekCooldown(ADA, 'announce', 1).used).toBe(0);
    let nested: { ok: boolean } | undefined;
    const first = service.consumeIf(ADA, 'announce', 1, () => {
      nested = service.consumeIf(ADA, 'announce', 1, () => true);
      return true;
    });
    expect(first.ok).toBe(true);
    expect(nested?.ok).toBe(false);
    expect(service.peekCooldown(ADA, 'announce', 1).used).toBe(1);
  });

  it('keeps a cooldown reservation when the action fails and the rollback cannot be saved', async () => {
    const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-donate-disk-'));
    dirs.push(dir);
    class FlakyStore extends JsonFileStore {
      failNext = 0;
      override save(name: string, value: unknown): void {
        if (this.failNext > 0) {
          this.failNext -= 1;
          throw new Error('disk');
        }
        super.save(name, value);
      }
    }
    const store = new FlakyStore(dir);
    const service = new DonationRankService(store);
    service.load();
    store.failNext = 1;
    let ran = 0;
    const blocked = service.consumeIf(ADA, 'coords', 1, () => {
      ran += 1;
      return true;
    }, 1_000);
    expect(blocked.ok).toBe(false);
    expect(ran).toBe(0);
    expect(service.peekCooldown(ADA, 'coords', 1, 1_000).allowed).toBe(true);

    const rolled = service.consumeIf(ADA, 'coords', 1, () => {
      store.failNext = 1;
      return false;
    }, 2_000);
    expect(rolled.ok).toBe(false);
    expect(service.peekCooldown(ADA, 'coords', 1, 2_000).allowed).toBe(false);
    const again = new DonationRankService(new JsonFileStore(dir));
    again.load();
    expect(again.peekCooldown(ADA, 'coords', 1, 2_000).allowed).toBe(false);
  });

  it('keeps kit cooldowns across a reload without touching the start ledger', async () => {
    const { service, dir } = await ranks();
    const now = 50_000;
    expect(service.consumeIf(ADA, 'kit:vip', 1, () => true, now).ok).toBe(true);
    expect(service.peekCooldown(ADA, 'kit:vip', 1, now + DONATION_WEEK_MS - 1).allowed).toBe(false);
    const again = new DonationRankService(new JsonFileStore(dir));
    again.load();
    expect(again.peekCooldown(ADA, 'kit:vip', 1, now + 10).allowed).toBe(false);
    expect(again.peekCooldown(ADA, 'kit:food_vip', 1, now + 10).allowed).toBe(true);
    expect(again.peekCooldown(ADA, 'kit:vip', 1, now + DONATION_WEEK_MS).allowed).toBe(true);
  });

  it('does not spend a coordinate teleport that fails validation', () => {
    let teleports = 0;
    const denied = attemptCoordinateTeleport({
      hasPermission: () => false,
      isOperator: () => false,
      teleport: () => { teleports += 1; return { ok: true }; },
      peekCooldown: () => ({ allowed: true, remainingMs: 0 }),
      consume: (_id, _now, commit) => (commit() ? { ok: true } : { ok: false, error: 'no' }),
    }, ADA, { x: 1, y: 70, z: 1 });
    expect(denied.ok).toBe(false);
    expect(teleports).toBe(0);

    let consumed = 0;
    const badY = attemptCoordinateTeleport({
      hasPermission: () => true,
      isOperator: () => false,
      teleport: () => { teleports += 1; return { ok: true }; },
      peekCooldown: () => ({ allowed: true, remainingMs: 0 }),
      consume: (_id, _now, commit) => { consumed += 1; return commit() ? { ok: true } : { ok: false, error: 'no' }; },
    }, ADA, { x: 1, y: 99_999, z: 1 });
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
      const nested = syncAuction(auction.createListing('seller', 'Ada', inventory, 1, 1, 10, undefined, 1));
      expect(nested.ok).toBe(false);
    };
    const created = syncAuction(auction.createListing('seller', 'Ada', inventory, 0, 1, 10, undefined, 1));
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

function testConfig(dataDir: string, rankTestEnabled = false) {
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
    rankTestEnabled,
  };
}

describe('donation commands on the anarchy world', () => {
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
  });

  async function boot(rankTestEnabled = false): Promise<WorldInstance> {
    const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-donate-world-'));
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir, rankTestEnabled));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in result) throw new Error(result.error);
    if (name === 'Op' && !sessionToken) world.permissions.op(result.player.id);
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
    expect(chat(world, ada, '/ec').some((line) => line.includes('прав'))).toBe(true);
    expect(chat(world, ada, '/an hello').some((line) => line.includes('прав'))).toBe(true);
    expect(chat(world, ada, '/invsee Bob').some((line) => line.includes('прав'))).toBe(true);
    expect(chat(world, ada, '/invseeop Bob').some((line) => line.includes('прав'))).toBe(true);
    expect(chat(world, ada, '/tpa 8 70 8').some((line) => line.includes('прав'))).toBe(true);
    expect(ada.player.window.kind).toBe('inventory');
    expect(chat(world, ada, '/tpa Bob').some((line) => line.includes('прав'))).toBe(true);
    expect(world.commands.find('tp')?.usage).toBe('/tp <x> <y> <z>');
    expect(chat(world, ada, '/tp 8 70 8').some((line) => line.includes('прав'))).toBe(true);
    expect(chat(world, ada, '/nickcolor aqua').some((line) => line.includes('PREMIUM'))).toBe(true);
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
    const extended = world.donation.extend(ada.player.id, { durationMs: DONATION_DAY_MS });
    expect(extended.expiresAt).toBe(grant!.expiresAt + DONATION_DAY_MS);

    await world.save();
    const playerId = ada.player.id;
    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    expect(again.donation.effectiveRank(playerId)).toBe('vip');
    expect(again.donation.activeGrant(playerId)?.expiresAt).toBe(extended.expiresAt);
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
    expect(world.homes.list(ada.player.id)).toHaveLength(4);
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
    chat(world, op, '/donate revoke Ada');
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, 'после');
    const faded = ada.sink.payloads.find((payload) => {
      const record = payload as { type?: string; kind?: string };
      return record.type === 'chat' && record.kind === 'player';
    }) as { nameStyle?: { nameColor?: string } };
    expect(faded.nameStyle?.nameColor).toBeUndefined();
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
    expect(chat(world, ada, '/tp 4 70 4').some((line) => line.includes('Teleported'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(4, 1);
    ada.player.controller.teleport([start.x, start.y, start.z]);
    expect(chat(world, ada, '/tp 9 70 9').some((line) => line.includes('через'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(start.x, 1);
    expect(chat(world, ada, '/tpa not-a-player').some((line) => line.includes('прав'))).toBe(true);
    expect(chat(world, op, '/tp 6 70 6').some((line) => line.includes('Teleported'))).toBe(true);
    expect(chat(world, op, '/tp 7 70 7').some((line) => line.includes('Teleported'))).toBe(true);
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

    expect(chat(world, ada, '/invseeop Bob').some((line) => line.includes('прав'))).toBe(true);
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

  it('rejects /ranktest on production and lets only OP use it on DEV', async () => {
    expect(loadServerConfig({}).rankTestEnabled).toBe(false);
    expect(loadServerConfig({ FC_RANK_TEST: '1' }).rankTestEnabled).toBe(true);
    expect(loadServerConfig({ FC_RANK_TEST: 'true' }).rankTestEnabled).toBe(true);
    expect(loadServerConfig({ FC_RANK_TEST: '0' }).rankTestEnabled).toBe(false);
    expect(parseRankTestDuration('30s')).toEqual({ ok: true, ms: 30_000 });
    expect(parseRankTestDuration('30').ok).toBe(false);

    const production = await boot(false);
    const prodOp = join(production, 'Op');
    const prodAda = join(production, 'Ada');
    expect(chat(production, prodOp, '/ranktest set Ada titan 30s').some((line) => line.includes('только на DEV'))).toBe(true);
    expect(production.donation.effectiveRank(prodAda.player.id)).toBe('default');
    expect(production.permissions.has(prodAda.player.id, 'server.admin')).toBe(false);

    const world = await boot(true);
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/ranktest set Ada titan 30s').some((line) => line.includes('прав'))).toBe(true);
    expect(world.donation.effectiveRank(ada.player.id)).toBe('default');
    expect(chat(world, op, '/ranktest set Ada titan 1s').some((line) => line.includes('titan'))).toBe(true);
    expect(world.donation.effectiveRank(ada.player.id)).toBe('titan');
    expect(world.permissions.has(ada.player.id, 'invsee.use')).toBe(true);
    expect(world.permissions.has(ada.player.id, 'server.admin')).toBe(false);
    expect(world.permissions.has(ada.player.id, 'plugins.manage')).toBe(false);
    const status = chat(world, op, '/ranktest status Ada').join('\n');
    expect(status).toContain('Ранг: titan');
    expect(status).toContain('ещё');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(world.donation.effectiveRank(ada.player.id)).toBe('default');
    expect(world.permissions.has(ada.player.id, 'invsee.use')).toBe(false);
    expect(chat(world, op, '/ranktest status Ada').join('\n')).toContain('Ранг: default');

    expect(chat(world, op, '/ranktest set Ada premium 5m').some((line) => line.includes('premium'))).toBe(true);
    expect(world.donation.effectiveRank(ada.player.id)).toBe('premium');
    expect(world.permissions.has(ada.player.id, 'enderchest.use')).toBe(true);
    expect(chat(world, op, '/ranktest clear Ada').some((line) => line.includes('снят'))).toBe(true);
    expect(world.donation.effectiveRank(ada.player.id)).toBe('default');
    expect(world.permissions.has(ada.player.id, 'enderchest.use')).toBe(false);
  });

  it('renders the donate menu from the live rank and uses the same /tp check', async () => {
    const world = await boot(true);
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    const menuOf = () => ada.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').at(-1) as {
      screen?: string;
      message?: string;
      donate?: { rankLabel?: string; actions?: { id: string; available: boolean }[] };
    };
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'donate' });
    expect(menuOf().screen).toBe('donate');
    expect(menuOf().donate?.rankLabel).toBe('Без привилегии');
    expect(menuOf().donate?.actions?.find((action) => action.id === 'tp')?.available).toBe(false);
    expect(menuOf().donate?.actions?.some((action) => action.id === 'invseeop')).toBe(false);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'donate_tp', x: 8, y: 70, z: 8 });
    expect(menuOf().message).toContain('прав');
    expect(ada.player.controller.position.x).not.toBeCloseTo(8, 0);
    expect(chat(world, op, '/ranktest set Ada titan 1h').some((line) => line.includes('titan'))).toBe(true);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'donate' });
    expect(menuOf().donate?.rankLabel).toBe('TITAN');
    expect(menuOf().donate?.actions?.find((action) => action.id === 'nickcolor')?.available).toBe(true);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'donate_color', color: 'gold', name: 'gold' });
    expect(world.donation.nickColor(ada.player.id)).toBe('gold');
    expect(menuOf().screen).toBe('donate-color');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'back' });
    expect(menuOf().screen).toBe('donate');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'back' });
    expect(menuOf().screen).toBe('root');
    world.handleMenuAction(op.player, { type: 'menu_action', action: 'open', screen: 'donate' });
    const opMenu = op.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').at(-1) as {
      donate?: { rankLabel?: string; showInvseeOp?: boolean; remainingLabel?: string };
    };
    expect(opMenu.donate?.rankLabel).toBe('OP');
    expect(opMenu.donate?.showInvseeOp).toBe(true);
    expect(opMenu.donate?.remainingLabel).toBe('Права оператора не истекают');
    expect(JSON.stringify(opMenu.donate)).not.toContain('Оператор. Донат-ранга нет');
  });

  it('remembers a real death for /back after respawn and restart', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const origin = ada.player.controller.position.x;
    ada.player.controller.teleport([origin + 24, ada.player.controller.position.y, ada.player.controller.position.z]);
    const diedX = ada.player.controller.position.x;
    expect(chat(world, ada, '/kill').every((line) => !line.includes('Teleported'))).toBe(true);
    expect(ada.player.survival.dead).toBe(true);
    expect(world.teleportHistory.peekDeath(ada.player.id)?.x).toBeCloseTo(diedX, 1);
    world.events.emit('entityDeath', {
      entityId: 'mob-1',
      cause: 'melee',
      playerId: ada.player.id,
      attackerId: ada.player.id,
      mobKind: 'zombie',
    });
    expect(world.teleportHistory.peekDeath(ada.player.id)?.x).toBeCloseTo(diedX, 1);
    expect(world.respawn(ada.player)).toBe(true);
    expect(ada.player.controller.position.x).not.toBeCloseTo(diedX, 0);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'donate' });
    const menu = ada.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').at(-1) as {
      donate?: { deathPoint?: { x: number }; actions?: { id: string; label: string; detail: string }[] };
    };
    expect(menu.donate?.deathPoint?.x).toBeCloseTo(diedX, 1);
    expect(menu.donate?.actions?.find((action) => action.id === 'back')?.label).toBe('Вернуться в место последней смерти');
    expect(menu.donate?.actions?.find((action) => action.id === 'back')?.detail).toContain('BOSS');
    expect(chat(world, ada, '/back').some((line) => line.includes('BOSS'))).toBe(true);
    world.donation.grant(ada.player.id, 'titan');
    expect(chat(world, ada, '/back').some((line) => line.includes('death'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(diedX, 1);

    const id = ada.player.id;
    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    expect(again.teleportHistory.peekDeath(id)?.x).toBeCloseTo(diedX, 1);
  });

  it('colors an operator name without a donate rank and leaves the message text plain', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/nickcolor dark_green').some((line) => line.includes('PREMIUM'))).toBe(true);
    expect(chat(world, op, '/nickcolor dark_green').some((line) => line.includes('dark_green'))).toBe(true);
    op.sink.payloads.length = 0;
    world.handleChat(op.player, 'привет');
    const said = op.sink.payloads.find((payload) => {
      const record = payload as { type?: string; kind?: string };
      return record.type === 'chat' && record.kind === 'player';
    }) as { text?: string; nameStyle?: { prefix?: string; prefixColor?: string; nameColor?: string } };
    expect(said.text).toBe('привет');
    expect(said.nameStyle?.prefix).toBe('[ADMIN]');
    expect(said.nameStyle?.prefixColor).toBe('yellow');
    expect(said.nameStyle?.nameColor).toBe('dark_green');
    const token = op.player.sessionToken;
    await world.save();
    const dir = world.config.dataDir;
    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const again = new WorldInstance(testConfig(dir));
    worlds.push(again);
    await again.initialize();
    await again.loadPlugins();
    await again.plugins.enableAll();
    const op2 = join(again, 'Op', token);
    expect(again.donation.nameStyle(op2.player.id, true)?.nameColor).toBe('dark_green');
    expect(again.donation.nameStyle(op2.player.id, true)?.prefixColor).toBe('yellow');
  });

  it('lets VIP open /ec, discounts clan creation, and keeps spectator for OP', async () => {
    const expiry = Date.UTC(2026, 10, 15, 18, 30, 0);
    const label = formatRankExpiry(expiry, expiry - (27 * 24 + 4) * 60 * 60 * 1000);
    expect(label.startsWith('До 15 ноября')).toBe(true);
    expect(label).toContain('27 дней');
    expect(label).toContain('4 часа');
    expect(label).not.toContain(':');

    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/ec').some((line) => line.includes('прав'))).toBe(true);
    chat(world, op, '/donate grant Ada vip');
    expect(chat(world, ada, '/ec').some((line) => line.includes('открыт'))).toBe(true);
    expect(ada.player.window.kind).toBe('portal-chest');

    world.economy.deposit(ada.player.id, 10_000, 'ADMIN_GIVE');
    const created = world.clan.createClan(ada.player.id, 'VipClan', 'crown');
    expect(created.ok).toBe(true);
    expect(world.economy.getBalance(ada.player.id)).toBe(10_100 - 5_000);
    const plain = join(world, 'Bob');
    world.economy.deposit(plain.player.id, 10_000, 'ADMIN_GIVE');
    const full = world.clan.createClan(plain.player.id, 'BobClan', 'shield');
    expect(full.ok).toBe(true);
    expect(world.economy.getBalance(plain.player.id)).toBe(10_100 - 10_000);

    expect(chat(world, ada, '/gamemode spectator').some((line) => line.includes('прав'))).toBe(true);
    expect(ada.player.gamemode).toBe('survival');
    expect(chat(world, op, '/gamemode 2').some((line) => line.includes('Наблюдатель'))).toBe(true);
    expect(op.player.gamemode).toBe('spectator');
    expect(op.player.controller.noclip).toBe(true);
    expect(op.player.snapshot().invisible).toBe(false);
    expect(op.player.snapshot().gamemode).toBe('spectator');
    expect(world.gameplay.breakBlock(op.player, 1, 70, 1).ok).toBe(false);
    expect(chat(world, op, '/gamemode survival').some((line) => line.includes('Выживание'))).toBe(true);
    expect(op.player.controller.noclip).toBe(false);
  });

  it('keeps give, time, and predsim for OP and /back for BOSS, TITAN, and OP', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    for (const rank of ['vip', 'premium', 'boss', 'titan'] as const) {
      world.donation.grant(ada.player.id, rank);
      expect(chat(world, ada, '/give dirt 1').some((line) => line.includes('прав'))).toBe(true);
      expect(chat(world, ada, '/time day').some((line) => line.includes('прав'))).toBe(true);
      expect(chat(world, ada, '/predsim 5').some((line) => line.includes('прав'))).toBe(true);
    }
    world.donation.revoke(ada.player.id);
    expect(ada.player.inventory.has('dirt', 1)).toBe(false);
    expect(chat(world, op, '/give dirt 1').some((line) => line.includes('Gave'))).toBe(true);
    expect(ada.player.inventory.has('dirt', 1)).toBe(false);
    expect(op.player.inventory.has('dirt', 1)).toBe(true);
    expect(chat(world, op, '/time night').some((line) => line.includes('night'))).toBe(true);
    expect(world.world.timeOfDay).toBe(13_000);
    expect(chat(world, op, '/predsim 5').some((line) => line.includes('identical=yes'))).toBe(true);

    expect(chat(world, ada, '/back').some((line) => line.includes('BOSS'))).toBe(true);
    world.donation.grant(ada.player.id, 'vip');
    expect(chat(world, ada, '/back').some((line) => line.includes('BOSS'))).toBe(true);
    world.donation.grant(ada.player.id, 'premium');
    expect(chat(world, ada, '/back').some((line) => line.includes('BOSS'))).toBe(true);
    ada.player.controller.teleport([40, 70, 40]);
    world.events.emit('entityDeath', {
      entityId: ada.player.id,
      cause: 'generic',
      playerId: ada.player.id,
    });
    const diedX = ada.player.controller.position.x;
    ada.player.controller.teleport([10, 70, 10]);
    world.donation.grant(ada.player.id, 'boss');
    expect(chat(world, ada, '/back').some((line) => line.includes('death'))).toBe(true);
    expect(ada.player.controller.position.x).toBeCloseTo(diedX, 1);
    ada.player.controller.teleport([12, 70, 12]);
    world.events.emit('entityDeath', { entityId: ada.player.id, cause: 'generic', playerId: ada.player.id });
    ada.player.controller.teleport([14, 70, 14]);
    expect(chat(world, ada, '/back').some((line) => line.includes('через'))).toBe(true);
  });
});
